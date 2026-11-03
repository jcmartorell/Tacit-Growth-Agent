"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fromCdmxInput } from "@/lib/time";
import { generateUpcoming, type GenerateSummary } from "@/lib/content/generate";
import { publishDue, type PublishSummary } from "@/lib/content/publish";
import { connectInstagram } from "@/lib/content/instagram";
import { disconnect } from "@/lib/content/connections";

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

export async function generateNow(): Promise<GenerateSummary> {
  await requireUser();
  const r = await generateUpcoming();
  refresh();
  return r;
}

// Guarda el texto y la hora; si approve=true lo deja listo para publicarse solo
export async function savePost(id: string, body: string, when: string, approve: boolean) {
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
}

export async function discardPost(id: string) {
  await requireUser();
  const db = createAdminClient();
  const { error } = await db.from("posts").update({ status: "descartado" }).eq("id", id).neq("status", "publicado");
  if (error) throw new Error(error.message);
  refresh();
}

export async function backToDraft(id: string) {
  await requireUser();
  const db = createAdminClient();
  const { error } = await db.from("posts").update({ status: "borrador", error: null }).eq("id", id).in("status", ["aprobado", "error"]);
  if (error) throw new Error(error.message);
  refresh();
}

// Publica ya: pone la hora en este momento y corre la publicación
export async function publishNow(id: string): Promise<PublishSummary> {
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
  return r;
}

export type ConnState = { ok: boolean; message: string } | null;

export async function connectIg(_prev: ConnState, form: FormData): Promise<ConnState> {
  await requireUser();
  try {
    const c = await connectInstagram(String(form.get("token") ?? ""));
    refresh();
    return { ok: true, message: `Instagram conectado: @${c.username ?? c.userId}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function disconnectChannel(which: "instagram" | "linkedin") {
  await requireUser();
  await disconnect(which);
  refresh();
}
