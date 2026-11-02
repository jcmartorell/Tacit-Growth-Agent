"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, parseList, saveSettings, type GrowthSettings } from "@/lib/settings";
import { runPipeline, type RunSummary } from "@/lib/pipeline/run";

// Todas las acciones verifican la sesión primero: una server action es un endpoint público.

const ORDER = ["invitacion", "mensaje", "seguimiento_1", "seguimiento_2"] as const;
type Kind = (typeof ORDER)[number];

function refresh() {
  revalidatePath("/", "layout");
}

export async function markSent(messageId: string) {
  await requireUser();
  const db = createAdminClient();
  const { data: msg, error } = await db
    .from("outreach_messages")
    .select("id, kind, prospect_id")
    .eq("id", messageId)
    .single();
  if (error || !msg) throw new Error("Mensaje no encontrado.");

  const now = new Date();
  const upd = await db.from("outreach_messages").update({ status: "enviado", sent_at: now.toISOString() }).eq("id", msg.id);
  if (upd.error) throw new Error(upd.error.message);

  // Programa el siguiente mensaje de la secuencia
  const idx = ORDER.indexOf(msg.kind as Kind);
  const next = ORDER[idx + 1];
  if (next) {
    const s = await getSettings();
    const days = s.followUpDays[next as Exclude<Kind, "invitacion">];
    const due = new Date(now.getTime() + days * 86_400_000).toISOString();
    const r = await db
      .from("outreach_messages")
      .update({ due_at: due })
      .eq("prospect_id", msg.prospect_id)
      .eq("kind", next)
      .eq("status", "borrador");
    if (r.error) throw new Error(r.error.message);
  }
  if (msg.kind === "invitacion") {
    const r = await db.from("prospects").update({ status: "enviado" }).eq("id", msg.prospect_id);
    if (r.error) throw new Error(r.error.message);
  }
  refresh();
}

async function closeSequence(prospectId: string, status: "respondio" | "reunion" | "descartado", reason?: string) {
  await requireUser();
  const db = createAdminClient();
  const r1 = await db
    .from("prospects")
    .update({ status, ...(reason ? { discard_reason: reason } : {}) })
    .eq("id", prospectId);
  if (r1.error) throw new Error(r1.error.message);
  // Los mensajes que no se mandaron ya no aplican
  const r2 = await db
    .from("outreach_messages")
    .update({ status: "descartado" })
    .eq("prospect_id", prospectId)
    .eq("status", "borrador");
  if (r2.error) throw new Error(r2.error.message);
  refresh();
}

export async function markReplied(prospectId: string) {
  await closeSequence(prospectId, "respondio");
}

export async function markMeeting(prospectId: string) {
  await closeSequence(prospectId, "reunion");
}

export async function discardProspect(prospectId: string) {
  await closeSequence(prospectId, "descartado", "Descartado manualmente");
}

export async function runNow(): Promise<RunSummary> {
  await requireUser();
  const summary = await runPipeline("manual");
  refresh();
  return summary;
}

export type SaveState = { ok: boolean; message: string } | null;

export async function saveConfig(_prev: SaveState, form: FormData): Promise<SaveState> {
  await requireUser();
  const current = await getSettings();
  const num = (name: string, fallback: number, min: number, max: number) => {
    const n = Number(form.get(name));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const text = (name: string) => String(form.get(name) ?? "");

  const next: GrowthSettings = {
    ...current,
    active: form.get("active") === "on",
    dailyLimit: num("dailyLimit", current.dailyLimit, 1, 50),
    titles: parseList(text("titles")),
    seniorities: parseList(text("seniorities")),
    locations: parseList(text("locations")).map((l) => l.toLowerCase()),
    minEmployees: num("minEmployees", current.minEmployees, 0, 100000),
    excludeTitleWords: parseList(text("excludeTitleWords")),
    searches: [
      {
        key: "stack",
        label: "Usan el stack que Tacit conecta",
        technologies: parseList(text("technologies")).map((t) => t.toLowerCase().replace(/[\s.]+/g, "_")),
        industries: [],
      },
      {
        key: "sector",
        label: "Servicios y tecnología",
        technologies: [],
        industries: parseList(text("industries")).map((i) => i.toLowerCase()),
      },
    ],
    tacitContext: text("tacitContext").trim() || current.tacitContext,
    writingRules: text("writingRules").trim() || current.writingRules,
    followUpDays: {
      mensaje: num("fu_mensaje", current.followUpDays.mensaje, 0, 60),
      seguimiento_1: num("fu_s1", current.followUpDays.seguimiento_1, 1, 60),
      seguimiento_2: num("fu_s2", current.followUpDays.seguimiento_2, 1, 60),
    },
  };

  if (next.titles.length === 0) return { ok: false, message: "Agrega al menos un puesto." };
  await saveSettings(next);
  refresh();
  return { ok: true, message: "Configuración guardada." };
}
