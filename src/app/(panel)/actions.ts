"use server";

import { revalidatePath } from "next/cache";
import { guard } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, parseList, saveSettings, type GrowthSettings } from "@/lib/settings";
import { runPipeline } from "@/lib/pipeline/run";
import { runEmail } from "@/lib/email/sender";
import { disconnectGmail } from "@/lib/email/gmail";
import { emailSchemaReady } from "@/lib/schema";

// Todas las acciones verifican la sesión primero: una server action es un endpoint público.

const ORDER = ["invitacion", "mensaje", "seguimiento_1", "seguimiento_2"] as const;
type Kind = (typeof ORDER)[number];

function refresh() {
  revalidatePath("/", "layout");
}

export async function markSent(messageId: string) {
  return guard(async () => {
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
  });
}

async function closeSequence(prospectId: string, status: "respondio" | "reunion" | "descartado", reason?: string) {
  await requireUser();
  const db = createAdminClient();
  const replied = (status === "respondio" || status === "reunion") && (await emailSchemaReady());
  const r1 = await db
    .from("prospects")
    .update({
      status,
      ...(reason ? { discard_reason: reason } : {}),
      ...(replied ? { replied_at: new Date().toISOString() } : {}),
    })
    .eq("id", prospectId);
  if (r1.error) throw new Error(r1.error.message);
  // Los mensajes que no se mandaron ya no aplican
  const r2 = await db
    .from("outreach_messages")
    .update({ status: "descartado" })
    .eq("prospect_id", prospectId)
    .in("status", ["borrador", "aprobado"]);
  if (r2.error) throw new Error(r2.error.message);
  refresh();
}

export async function markReplied(prospectId: string) {
  return guard(async () => {
    await closeSequence(prospectId, "respondio");
  });
}

export async function markMeeting(prospectId: string) {
  return guard(async () => {
    await closeSequence(prospectId, "reunion");
  });
}

export async function discardProspect(prospectId: string) {
  return guard(async () => {
    await closeSequence(prospectId, "descartado", "Descartado manualmente");
  });
}

export async function runNow() {
  return guard(async () => {
    await requireUser();
    const summary = await runPipeline("manual");
    refresh();
    return summary;
  });
}

export async function sendEmailNow() {
  return guard(async () => {
    await requireUser();
    const r = await runEmail("manual");
    refresh();
    return r;
  });
}

export async function disconnectGmailAction() {
  return guard(async () => {
    await requireUser();
    await disconnectGmail();
    refresh();
  });
}

// Aprobar (o guardar) el primer correo de un prospecto, con asunto y texto editados
export async function approveEmail(messageId: string, subject: string, body: string, approve: boolean) {
  return guard(async () => {
    await requireUser();
    const sub = subject.replace(/[\r\n]+/g, " ").trim();
    const text = body.trim();
    if (!sub || !text) throw new Error("Asunto y texto son obligatorios.");
    if (sub.length > 120) throw new Error("El asunto es demasiado largo.");
    const db = createAdminClient();
    const { data: m, error } = await db.from("outreach_messages").select("prospect_id, kind, status").eq("id", messageId).single();
    if (error || !m) throw new Error("Correo no encontrado.");
    if (m.kind !== "correo_1" || m.status === "enviado") throw new Error("Este correo ya no se puede editar.");
    const r1 = await db.from("outreach_messages")
      .update({ subject: sub, body: text, ...(approve ? { status: "aprobado" } : {}) })
      .eq("id", messageId);
    if (r1.error) throw new Error(r1.error.message);
    // El asunto es el mismo para todo el hilo
    const r2 = await db.from("outreach_messages").update({ subject: sub })
      .eq("prospect_id", m.prospect_id).in("kind", ["correo_2", "correo_3"]);
    if (r2.error) throw new Error(r2.error.message);
    refresh();
  });
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
    maxEmployees: num("maxEmployees", current.maxEmployees, 0, 1000000),
    companyLocations: parseList(text("companyLocations")).map((l) => l.toLowerCase()),
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

  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => form.get(`c_day_${i}`) === "on");
  const channels = [
    ...(form.get("c_ch_linkedin") === "on" ? (["linkedin_personal"] as const) : []),
    ...(form.get("c_ch_instagram") === "on" ? (["instagram"] as const) : []),
  ];
  const languages = parseList(text("c_langs"))
    .map((l) => l.toLowerCase())
    .filter((l): l is "es" | "en" => l === "es" || l === "en");
  next.content = {
    active: form.get("c_active") === "on",
    channels: [...channels],
    days,
    hour: num("c_hour", current.content.hour, 0, 23),
    pillars: text("c_pillars").split("\n").map((l) => l.trim()).filter(Boolean),
    languages: languages.length ? languages : ["es"],
    guide: text("c_guide").trim().slice(0, 2000),
    reels: {
      active: form.get("r_active") === "on",
      days: [0, 1, 2, 3, 4, 5, 6].filter((i) => form.get(`r_day_${i}`) === "on"),
      hour: num("r_hour", current.content.reels.hour, 0, 23),
      guide: text("r_guide").trim().slice(0, 2000),
      music: (["piano", "corporativo", "metal"] as const).find((m) => m === text("r_music")) ?? "piano",
    },
  };

  const eActive = form.get("e_active") === "on";
  next.email = {
    active: eActive,
    requireApproval: form.get("e_approval") === "on",
    fromName: text("e_fromName").replace(/[\r\n]+/g, " ").trim() || current.email.fromName,
    startDailyCap: num("e_start", current.email.startDailyCap, 1, 100),
    weeklyIncrease: num("e_increase", current.email.weeklyIncrease, 0, 50),
    maxDailyCap: num("e_max", current.email.maxDailyCap, 1, 200),
    // La rampa empieza la primera vez que se enciende el envío
    rampStart: current.email.rampStart ?? (eActive ? new Date().toISOString() : null),
    sendFrom: num("e_from", current.email.sendFrom, 0, 23),
    sendTo: num("e_to", current.email.sendTo, 1, 24),
    followUpDays: [num("e_fu1", current.email.followUpDays[0], 1, 60), num("e_fu2", current.email.followUpDays[1], 1, 60)],
    footer: text("e_footer").trim() || current.email.footer,
  };
  next.learning = { ...current.learning, active: form.get("l_active") === "on" };
  if (next.email.sendTo <= next.email.sendFrom) return { ok: false, message: "La hora final de envío debe ser mayor que la inicial." };

  if (next.titles.length === 0) return { ok: false, message: "Agrega al menos un puesto." };
  if (next.maxEmployees > 0 && next.maxEmployees < next.minEmployees) {
    return { ok: false, message: "El máximo de empleados debe ser mayor que el mínimo." };
  }
  if (next.content.pillars.length === 0) return { ok: false, message: "Agrega al menos un tema de contenido." };
  await saveSettings(next);
  refresh();
  return { ok: true, message: "Configuración guardada." };
}
