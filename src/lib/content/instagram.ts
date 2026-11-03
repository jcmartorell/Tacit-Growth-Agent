import "server-only";
import { getIg, setIg, type IgConnection } from "@/lib/content/connections";

// Instagram API con Instagram Login (graph.instagram.com). No requiere página de Facebook.
// Publicar es en dos pasos: crear contenedor con la URL de la imagen JPEG y luego publicarlo.

const BASE = (process.env.INSTAGRAM_GRAPH_BASE || "https://graph.instagram.com").replace(/\/+$/, "");
const VERSION = "v26.0";

async function ig(path: string, token: string, init: { method?: "GET" | "POST"; params?: Record<string, string> } = {}) {
  const url = new URL(`${BASE}${path}`);
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

// Valida un token pegado desde el panel de Meta y guarda la conexión
export async function connectInstagram(rawToken: string): Promise<IgConnection> {
  const token = rawToken.trim();
  if (token.length < 20) throw new Error("El token es demasiado corto. Cópialo completo.");
  const me = await ig(`/${VERSION}/me`, token, { params: { fields: "user_id,username" } });
  const now = new Date().toISOString();
  const conn: IgConnection = {
    token,
    userId: String(me.user_id ?? me.id ?? ""),
    username: (me.username as string) ?? null,
    connectedAt: now,
    refreshedAt: now,
    // Los tokens largos duran 60 días; se renuevan solos cada semana
    expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    lastError: null,
  };
  if (!conn.userId) throw new Error("Instagram no devolvió el id de la cuenta.");
  await setIg(conn);
  return conn;
}

// Renueva el token si tiene más de 7 días desde la última renovación (Meta exige 24 h mínimo)
export async function refreshInstagramIfNeeded(): Promise<string> {
  const c = await getIg();
  if (!c.token) return "sin conexión";
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

  const container = await ig(`/${VERSION}/${c.userId}/media`, c.token, {
    method: "POST",
    params: { image_url: imageUrl, caption },
  });
  const creationId = String(container.id ?? "");
  if (!creationId) throw new Error("Instagram no devolvió el contenedor.");

  // Espera a que Instagram termine de procesar la imagen (máximo ~60 s)
  for (let i = 0; i < 12; i++) {
    const st = await ig(`/${VERSION}/${creationId}`, c.token, { params: { fields: "status_code" } });
    const code = String(st.status_code ?? "");
    if (code === "FINISHED") break;
    if (code === "ERROR" || code === "EXPIRED") throw new Error(`Instagram rechazó la imagen (${code}).`);
    await sleep(5000);
  }

  const pub = await ig(`/${VERSION}/${c.userId}/media_publish`, c.token, {
    method: "POST",
    params: { creation_id: creationId },
  });
  const mediaId = String(pub.id ?? "");
  if (!mediaId) throw new Error("Instagram no devolvió el id del post publicado.");
  return mediaId;
}
