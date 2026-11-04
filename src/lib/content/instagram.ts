import "server-only";
import { getIg, setIg, type IgConnection } from "@/lib/content/connections";

// Publicación en Instagram. Acepta los dos tipos de token que da Meta:
// - Token de Instagram (empieza con "IG"): graph.instagram.com, dura 60 días y se renueva solo.
// - Token de Meta (inicio de sesión unificado / usuario del sistema): graph.facebook.com.
// Publicar es en dos pasos: crear contenedor con la URL de la imagen JPEG y luego publicarlo.

const IG_BASE = (process.env.INSTAGRAM_GRAPH_BASE || "https://graph.instagram.com").replace(/\/+$/, "");
const FB_BASE = (process.env.FACEBOOK_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "");
const VERSION = "v26.0";

type Host = "instagram" | "facebook";

async function call(host: Host, path: string, token: string, init: { method?: "GET" | "POST"; params?: Record<string, string> } = {}) {
  const url = new URL(`${host === "facebook" ? FB_BASE : IG_BASE}${path}`);
  Object.entries(init.params ?? {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.error) {
    const err = body.error as { message?: string } | undefined;
    throw new Error(`Instagram ${path}: ${err?.message ?? `HTTP ${res.status}`}`);
  }
  return body;
}
const ig = (path: string, token: string, init?: Parameters<typeof call>[3]) => call("instagram", path, token, init);

// Con un token de Meta, encuentra la cuenta de Instagram a la que da acceso
async function findIgAccountWithFacebookToken(token: string, idHint?: string): Promise<{ id: string; username: string | null; expiresAt: string | null }> {
  // 0) Si se dio el ID de la cuenta (lo muestra Meta junto al usuario), basta con verificarlo
  if (idHint) {
    const info = await call("facebook", `/${VERSION}/${idHint}`, token, { params: { fields: "username" } });
    return { id: idHint, username: (info.username as string) ?? null, expiresAt: null };
  }
  // 1) Los permisos concedidos dicen a qué cuenta de Instagram aplican
  let dbg: Record<string, unknown>;
  try {
    dbg = await call("facebook", `/${VERSION}/debug_token`, token, { params: { input_token: token } });
  } catch {
    throw new Error("Este tipo de token no permite encontrar la cuenta sola. Escribe el ID de la cuenta de Instagram (el número que aparece en Meta junto a tu usuario).");
  }
  const data = (dbg.data ?? {}) as { is_valid?: boolean; expires_at?: number; granular_scopes?: { scope: string; target_ids?: string[] }[] };
  if (data.is_valid === false) throw new Error("Meta dice que el token no es válido.");
  const expiresAt = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null; // 0 = no caduca
  const scopes = data.granular_scopes ?? [];
  let id: string | undefined = [...scopes.filter((g) => /instagram.*publish/.test(g.scope)), ...scopes.filter((g) => /instagram/.test(g.scope))]
    .flatMap((g) => g.target_ids ?? [])[0];
  // 2) Si no viene ahí, se busca en las páginas que administra el usuario
  if (!id) {
    const pages = await call("facebook", `/${VERSION}/me/accounts`, token, { params: { fields: "instagram_business_account{id,username}" } });
    const list = (pages.data as { instagram_business_account?: { id: string } }[] | undefined) ?? [];
    id = list.find((p) => p.instagram_business_account?.id)?.instagram_business_account?.id;
  }
  if (!id) throw new Error("El token no da acceso a ninguna cuenta de Instagram. Revisa que agregaste la cuenta al generarlo.");
  const info = await call("facebook", `/${VERSION}/${id}`, token, { params: { fields: "username" } });
  return { id, username: (info.username as string) ?? null, expiresAt };
}

// Valida un token pegado desde el panel de Meta y guarda la conexión
export async function connectInstagram(rawToken: string, rawIdHint = ""): Promise<IgConnection> {
  const token = rawToken.trim().replace(/\s+/g, "");
  const idHint = rawIdHint.replace(/\D/g, "") || undefined;
  if (token.length < 20) throw new Error("El token es demasiado corto. Cópialo completo.");
  const now = new Date().toISOString();

  let conn: IgConnection | null = null;
  let igError = "";
  try {
    const me = await ig(`/${VERSION}/me`, token, { params: { fields: "user_id,username" } });
    const userId = String(me.user_id ?? me.id ?? "");
    if (userId) {
      conn = {
        token, host: "instagram", userId, username: (me.username as string) ?? null,
        connectedAt: now, refreshedAt: now,
        expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(), // 60 días; se renueva cada semana
        lastError: null,
      };
    }
  } catch (e) {
    igError = (e as Error).message;
  }
  if (!conn) {
    try {
      const acc = await findIgAccountWithFacebookToken(token, idHint);
      conn = {
        token, host: "facebook", userId: acc.id, username: acc.username,
        connectedAt: now, refreshedAt: now, expiresAt: acc.expiresAt, lastError: null,
      };
    } catch (e) {
      void igError;
      throw new Error(`No se pudo validar el token: ${(e as Error).message}`);
    }
  }
  await setIg(conn);
  return conn;
}

// Renueva el token si tiene más de 7 días desde la última renovación (Meta exige 24 h mínimo)
export async function refreshInstagramIfNeeded(): Promise<string> {
  const c = await getIg();
  if (!c.token) return "sin conexión";
  if (c.host === "facebook") return "no requiere renovación";
  const last = c.refreshedAt ? new Date(c.refreshedAt).getTime() : 0;
  if (Date.now() - last < 7 * 86_400_000) return "vigente";
  try {
    const r = await ig("/refresh_access_token", c.token, { params: { grant_type: "ig_refresh_token", access_token: c.token } });
    const expiresIn = Number(r.expires_in ?? 0);
    await setIg({
      ...c,
      token: String(r.access_token),
      refreshedAt: new Date().toISOString(),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : c.expiresAt,
      lastError: null,
    });
    return "renovado";
  } catch (e) {
    await setIg({ ...c, lastError: `No se pudo renovar el token: ${(e as Error).message}` });
    return "error";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function publishInstagram(imageUrl: string, caption: string): Promise<string> {
  const c = await getIg();
  if (!c.token || !c.userId) throw new Error("Instagram no está conectado.");

  const host: Host = c.host ?? "instagram";
  const container = await call(host, `/${VERSION}/${c.userId}/media`, c.token, {
    method: "POST",
    params: { image_url: imageUrl, caption },
  });
  const creationId = String(container.id ?? "");
  if (!creationId) throw new Error("Instagram no devolvió el contenedor.");

  // Espera a que Instagram termine de procesar la imagen (máximo ~60 s)
  for (let i = 0; i < 12; i++) {
    const st = await call(host, `/${VERSION}/${creationId}`, c.token, { params: { fields: "status_code" } });
    const code = String(st.status_code ?? "");
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED") throw new Error(`Instagram rechazó la imagen (${code}).`);
    await sleep(5000);
  }

  const pub = await call(host, `/${VERSION}/${c.userId}/media_publish`, c.token, {
    method: "POST",
    params: { creation_id: creationId },
  });
  const mediaId = String(pub.id ?? "");
  if (!mediaId) throw new Error("Instagram no devolvió el id del post publicado.");
  return mediaId;
}
