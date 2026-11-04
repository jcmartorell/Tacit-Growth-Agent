"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fromCdmxInput } from "@/lib/time";
import { generateUpcoming } from "@/lib/content/generate";
import { publishDue } from "@/lib/content/publish";
import { connectInstagram } from "@/lib/content/instagram";
import { disconnect } from "@/lib/content/connections";
import { renderReelForPost } from "@/lib/content/render";
import { typographic } from "@/lib/typography";
import type { PostMeta } from "@/lib/content/generate";

// Cada acción verifica la sesión: una server action es un endpoint público.

const LIMITS: Record<string, number> = { instagram: 2200, linkedin_personal: 3000 };

function refresh() {
  revalidatePath("/contenido");
  revalidatePath("/");
}

async function loadPost(id: string) {
  const db = createAdminClient();
  const { data, error } = await db.from("posts").select("id, channel, status").eq("id", id).single();
  if (error || !data) throw new Error("Post no encontrado.");
  return data;
}

export async function generateNow() {
  return guard(async () => {
    await requireUser();
    const r = await generateUpcoming();
    refresh();
    return r;
  });
}

// Guarda el texto y la hora; si approve=true lo deja listo para publicarse solo
export async function savePost(id: string, body: string, when: string, approve: boolean) {
  return guard(async () => {
    await requireUser();
    const post = await loadPost(id);
    if (post.status === "publicado") throw new Error("Este post ya se publicó.");
    const text = body.trim();
    if (!text) throw new Error("El texto está vacío.");
    const max = LIMITS[post.channel] ?? 3000;
    if (text.length > max) throw new Error(`El texto tiene ${text.length} caracteres; el máximo es ${max}.`);
    const iso = fromCdmxInput(when);
    if (!iso) throw new Error("Fecha u hora inválida.");
    // Si la hora ya pasó, se publica en la siguiente revisión (máximo 1 hora)
    const db = createAdminClient();
    const { error } = await db
      .from("posts")
      .update({ body: text, scheduled_at: iso, ...(approve ? { status: "aprobado", error: null } : {}) })
      .eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
  });
}

export async function discardPost(id: string) {
  return guard(async () => {
    await requireUser();
    const db = createAdminClient();
    const { error } = await db.from("posts").update({ status: "descartado" }).eq("id", id).neq("status", "publicado");
    if (error) throw new Error(error.message);
    refresh();
  });
}

export async function backToDraft(id: string) {
  return guard(async () => {
    await requireUser();
    const db = createAdminClient();
    const { error } = await db.from("posts").update({ status: "borrador", error: null }).eq("id", id).in("status", ["aprobado", "error"]);
    if (error) throw new Error(error.message);
    refresh();
  });
}

// Publica ya: pone la hora en este momento y corre la publicación
export async function publishNow(id: string) {
  return guard(async () => {
    await requireUser();
    const post = await loadPost(id);
    if (post.status === "publicado") throw new Error("Este post ya se publicó.");
    const db = createAdminClient();
    const { error } = await db
      .from("posts")
      .update({ status: "aprobado", error: null, scheduled_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);
    const r = await publishDue();
    refresh();
    if (r.skipped) throw new Error("Hay otra publicación en curso; intenta en un minuto.");
    if (r.errores.length) throw new Error(r.errores.join(" · "));
    return r;
  });
}

export async function renderReelNow(id: string) {
  return guard(async () => {
    await requireUser();
    const db = createAdminClient();
    const { data, error } = await db.from("posts").select("id, image_url, metrics, status").eq("id", id).single();
    if (error || !data) throw new Error("Post no encontrado.");
    if (data.status === "publicado") throw new Error("Este reel ya se publicó.");
    await renderReelForPost(data as never);
    refresh();
  });
}

// Edita el guion de un reel: guarda los textos y vuelve a generar el video
export async function saveReelScript(id: string, hook: string, points: string[], cta: string) {
  return guard(async () => {
    await requireUser();
    const one = (t: string) => typographic(String(t ?? "")).replace(/\s+/g, " ").trim();
    const words = (t: string) => t.split(" ").filter(Boolean).length;
    const h = one(hook), c = one(cta);
    const ps = points.map(one).filter(Boolean);
    if (!h || !c || ps.length === 0) throw new Error("El gancho, al menos una idea y el cierre son obligatorios.");
    if (ps.length > 3) throw new Error("Máximo 3 ideas.");
    if (words(h) > 12) throw new Error("El gancho debe tener máximo 12 palabras.");
    if (ps.some((x) => words(x) > 16)) throw new Error("Cada idea debe tener máximo 16 palabras.");
    if (words(c) > 12) throw new Error("El cierre debe tener máximo 12 palabras.");

    const db = createAdminClient();
    const { data, error } = await db.from("posts").select("id, image_url, metrics, status").eq("id", id).single();
    if (error || !data) throw new Error("Post no encontrado.");
    if (data.status === "publicado") throw new Error("Este reel ya se publicó.");
    const metrics = (data.metrics ?? {}) as { meta?: PostMeta };
    const meta = metrics.meta;
    if (meta?.format !== "reel" || !meta.reel) throw new Error("El post no es un reel.");
    const nextMeta: PostMeta = { ...meta, reel: { ...meta.reel, hook: h, points: ps, cta: c }, containerId: undefined, renderedAt: undefined };
    const upd = await db.from("posts").update({ image_url: null, metrics: { ...metrics, meta: nextMeta } }).eq("id", id);
    if (upd.error) throw new Error(upd.error.message);
    refresh();
    // Genera el video ya; si falla, el guion queda guardado y la revisión de cada hora lo reintenta
    try {
      await renderReelForPost({ id, image_url: null, metrics: { ...metrics, meta: nextMeta } });
    } catch (e) {
      refresh();
      throw new Error(`Guion guardado, pero el video falló: ${(e as Error).message}. Se reintentará solo en la siguiente hora.`);
    }
    refresh();
  });
}

export type ConnState = { ok: boolean; message: string } | null;

export async function connectIg(_prev: ConnState, form: FormData): Promise<ConnState> {
  await requireUser();
  try {
    const c = await connectInstagram(String(form.get("token") ?? ""), String(form.get("igId") ?? ""));
    refresh();
    return { ok: true, message: `Instagram conectado: @${c.username ?? c.userId}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function disconnectChannel(which: "instagram" | "linkedin") {
  return guard(async () => {
    await requireUser();
    await disconnect(which);
    refresh();
  });
}
