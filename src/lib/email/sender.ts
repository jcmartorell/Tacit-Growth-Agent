import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, type EmailSettings } from "@/lib/settings";
import { acquireLock, releaseLock } from "@/lib/lock";
import { emailSchemaReady } from "@/lib/schema";
import { buildRaw, gmailAccessToken, sendMessage, threadState } from "@/lib/email/gmail";

// Motor de correo. Corre cada hora:
// 1) Revisa los hilos enviados: si alguien respondió o rebotó, detiene su secuencia.
// 2) Dentro del horario de envío, manda los seguimientos que tocan y los primeros correos
//    nuevos, respetando el límite diario que sube poco a poco (calentamiento del dominio).

export type EmailSummary = {
  status: "ok" | "skipped" | "error";
  reason?: string;
  revisados: number;
  respuestas: number;
  rebotes: number;
  enviados: number;
  seguimientos: number;
  limiteHoy: number;
  enviadosHoy: number;
  errores: string[];
};

const OFFSET = 6; // CDMX = UTC-6 todo el año

function cdmxNow() {
  const d = new Date(Date.now() - OFFSET * 3_600_000);
  return { hour: d.getUTCHours(), weekday: d.getUTCDay(), startOfDayUtc: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), OFFSET)) };
}

export function dailyCap(e: EmailSettings, now = new Date()): number {
  if (!e.rampStart) return e.startDailyCap;
  const weeks = Math.max(0, Math.floor((now.getTime() - new Date(e.rampStart).getTime()) / (7 * 86_400_000)));
  return Math.min(e.maxDailyCap, e.startDailyCap + e.weeklyIncrease * weeks);
}

function compose(body: string, e: EmailSettings) {
  return `${body.trim()}\n\n${e.fromName}\nTacit · tacit.guru\n\n${e.footer.trim()}`.trim();
}

type Prospect = { id: string; full_name: string; email: string | null; status: string };
type Msg = {
  id: string; prospect_id: string; kind: string; subject: string | null; body: string; status: string;
  due_at: string | null; sent_at: string | null; gmail_thread_id: string | null; rfc_message_id: string | null;
};

async function stopSequence(prospectId: string, status: "respondio" | "rebotado") {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const r1 = await db
    .from("prospects")
    .update(status === "respondio"
      ? { status, replied_at: now, reply_channel: "email" }
      : { status, discard_reason: "El correo rebotó" })
    .eq("id", prospectId);
  if (r1.error) throw new Error(r1.error.message);
  const r2 = await db.from("outreach_messages").update({ status: "descartado" }).eq("prospect_id", prospectId).in("status", ["borrador", "aprobado"]);
  if (r2.error) throw new Error(r2.error.message);
}

export async function runEmail(trigger: "cron" | "manual"): Promise<EmailSummary> {
  const sum: EmailSummary = { status: "ok", revisados: 0, respuestas: 0, rebotes: 0, enviados: 0, seguimientos: 0, limiteHoy: 0, enviadosHoy: 0, errores: [] };
  if (!(await emailSchemaReady())) return { ...sum, status: "skipped", reason: "Falta correr la migración 002 en Supabase." };
  const s = await getSettings();
  const e = s.email;
  if (!e.active) return { ...sum, status: "skipped", reason: "El envío por correo está apagado en Configuración." };
  if (!(await acquireLock("correo", 15))) return { ...sum, status: "skipped", reason: "Ya hay un envío en curso." };

  const db = createAdminClient();
  const started = new Date().toISOString();
  try {
    const { token, email: ownEmail } = await gmailAccessToken();

    // ---- 1) Respuestas y rebotes en hilos activos
    const { data: active, error: e1 } = await db
      .from("outreach_messages")
      .select("prospect_id, gmail_thread_id, prospect:prospects!inner(status)")
      .eq("kind", "correo_1")
      .eq("status", "enviado")
      .not("gmail_thread_id", "is", null)
      .eq("prospect.status", "enviado")
      .limit(300);
    if (e1) throw new Error(`Leer hilos: ${e1.message}`);
    for (const t of active ?? []) {
      sum.revisados += 1;
      try {
        const st = await threadState(token, t.gmail_thread_id as string, ownEmail);
        if (st === "respondio") { await stopSequence(t.prospect_id as string, "respondio"); sum.respuestas += 1; }
        if (st === "rebote") { await stopSequence(t.prospect_id as string, "rebotado"); sum.rebotes += 1; }
      } catch (err) {
        sum.errores.push(`Revisar hilo: ${(err as Error).message}`);
      }
    }

    // ---- 2) Envío, solo en días hábiles y dentro del horario
    const now = cdmxNow();
    if (trigger === "cron" && (now.weekday === 0 || now.weekday === 6 || now.hour < e.sendFrom || now.hour >= e.sendTo)) {
      return { ...sum, reason: "Fuera del horario de envío; solo se revisaron respuestas." };
    }

    const cap = dailyCap(e);
    const { count: sentToday, error: e2 } = await db
      .from("outreach_messages")
      .select("*", { count: "exact", head: true })
      .eq("kind", "correo_1")
      .gte("sent_at", now.startOfDayUtc.toISOString());
    if (e2) throw new Error(`Contar enviados: ${e2.message}`);
    sum.limiteHoy = cap;
    sum.enviadosHoy = sentToday ?? 0;
    const remaining = Math.max(0, cap - (sentToday ?? 0));
    const hoursLeft = Math.max(1, e.sendTo - now.hour);
    const thisRun = trigger === "manual" ? remaining : Math.ceil(remaining / hoursLeft); // reparte en el día

    const loadSet = async (prospectId: string) => {
      const { data, error } = await db
        .from("outreach_messages")
        .select("id, prospect_id, kind, subject, body, status, due_at, sent_at, gmail_thread_id, rfc_message_id")
        .eq("prospect_id", prospectId)
        .in("kind", ["correo_1", "correo_2", "correo_3"]);
      if (error) throw new Error(error.message);
      return (data ?? []) as Msg[];
    };

    const sendOne = async (m: Msg, p: Prospect) => {
      if (!p.email) throw new Error("Sin correo");
      const set = await loadSet(p.id);
      const first = set.find((x) => x.kind === "correo_1");
      const isFollowUp = m.kind !== "correo_1";
      if (isFollowUp && !first?.gmail_thread_id) throw new Error("No existe el hilo del primer correo");
      const lastSent = set.filter((x) => x.sent_at).sort((a, b) => (a.sent_at! < b.sent_at! ? 1 : -1))[0];
      const subject = (first?.subject ?? m.subject ?? "Tacit").trim();
      const raw = buildRaw({
        fromName: e.fromName, fromEmail: ownEmail, toName: p.full_name, toEmail: p.email,
        subject: isFollowUp ? `Re: ${subject}` : subject,
        body: compose(m.body, e),
        inReplyTo: isFollowUp ? lastSent?.rfc_message_id ?? first?.rfc_message_id : null,
      });
      const sent = await sendMessage(token, raw, isFollowUp ? first!.gmail_thread_id : null);
      const nowIso = new Date().toISOString();
      const u = await db
        .from("outreach_messages")
        .update({ status: "enviado", sent_at: nowIso, gmail_message_id: sent.id, gmail_thread_id: sent.threadId, rfc_message_id: sent.rfcMessageId })
        .eq("id", m.id);
      if (u.error) throw new Error(u.error.message);
      // Programa el siguiente correo del hilo
      const next = m.kind === "correo_1" ? "correo_2" : m.kind === "correo_2" ? "correo_3" : null;
      if (next) {
        const days = m.kind === "correo_1" ? e.followUpDays[0] : e.followUpDays[1];
        await db.from("outreach_messages")
          .update({ due_at: new Date(Date.now() + days * 86_400_000).toISOString() })
          .eq("prospect_id", p.id).eq("kind", next).eq("status", "borrador");
      }
      if (m.kind === "correo_1" && p.status === "listo") {
        await db.from("prospects").update({ status: "enviado" }).eq("id", p.id);
      }
    };

    // 2a) Seguimientos que tocan (no cuentan contra el límite de nuevos)
    const { data: due, error: e3 } = await db
      .from("outreach_messages")
      .select("id, prospect_id, kind, subject, body, status, due_at, sent_at, gmail_thread_id, rfc_message_id, prospect:prospects!inner(id, full_name, email, status)")
      .in("kind", ["correo_2", "correo_3"])
      .eq("status", "borrador")
      .lte("due_at", new Date().toISOString())
      .eq("prospect.status", "enviado")
      .order("due_at", { ascending: true })
      .limit(50);
    if (e3) throw new Error(`Leer seguimientos: ${e3.message}`);
    for (const row of due ?? []) {
      try {
        await sendOne(row as unknown as Msg, row.prospect as unknown as Prospect);
        sum.seguimientos += 1;
      } catch (err) {
        sum.errores.push(`Seguimiento a ${(row.prospect as unknown as Prospect).full_name}: ${(err as Error).message}`);
      }
    }

    // 2b) Primeros correos nuevos, hasta el límite de esta corrida
    if (thisRun > 0) {
      const { data: fresh, error: e4 } = await db
        .from("outreach_messages")
        .select("id, prospect_id, kind, subject, body, status, due_at, sent_at, gmail_thread_id, rfc_message_id, prospect:prospects!inner(id, full_name, email, status)")
        .eq("kind", "correo_1")
        .in("status", e.requireApproval ? ["aprobado"] : ["borrador", "aprobado"])
        .lte("due_at", new Date().toISOString())
        .in("prospect.status", ["listo", "enviado"])
        .not("prospect.email", "is", null)
        .order("due_at", { ascending: true })
        .limit(thisRun);
      if (e4) throw new Error(`Leer correos nuevos: ${e4.message}`);
      for (const row of fresh ?? []) {
        try {
          await sendOne(row as unknown as Msg, row.prospect as unknown as Prospect);
          sum.enviados += 1;
          sum.enviadosHoy += 1;
        } catch (err) {
          sum.errores.push(`Correo a ${(row.prospect as unknown as Prospect).full_name}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    sum.status = "error";
    sum.errores.push((err as Error).message);
  } finally {
    await releaseLock("correo");
    await db.from("agent_runs").insert({
      agent: "correo", model: null, status: sum.status === "error" ? "error" : "ok",
      detail: { trigger, ...sum }, started_at: started, finished_at: new Date().toISOString(),
    });
  }
  return sum;
}
