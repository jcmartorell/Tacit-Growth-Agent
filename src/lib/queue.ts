import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Cola de trabajo: mensajes en borrador cuya fecha ya llegó, de prospectos activos.

export const KIND_LABEL: Record<string, string> = {
  invitacion: "Invitación",
  mensaje: "Mensaje",
  seguimiento_1: "Seguimiento 1",
  seguimiento_2: "Seguimiento 2",
  correo_1: "Correo 1",
  correo_2: "Correo 2",
  correo_3: "Correo 3",
};

// Solo LinkedIn va a la cola manual; el correo se envía solo
export const LINKEDIN_KINDS = ["invitacion", "mensaje", "seguimiento_1", "seguimiento_2"];

export type QueueItem = {
  id: string;
  kind: string;
  body: string;
  due_at: string;
  prospect: {
    id: string;
    full_name: string;
    title: string | null;
    company_name: string | null;
    linkedin_url: string | null;
    status: string;
    research: { angulo?: string } | null;
  };
};

export async function getQueue(): Promise<QueueItem[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("outreach_messages")
    .select("id, kind, body, due_at, prospect:prospects!inner(id, full_name, title, company_name, linkedin_url, status, research)")
    .eq("status", "borrador")
    .in("kind", LINKEDIN_KINDS)
    .lte("due_at", new Date().toISOString())
    .in("prospect.status", ["listo", "enviado"])
    .order("due_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Error leyendo la cola: ${error.message}`);
  return (data ?? []) as unknown as QueueItem[];
}

export async function countQueue(): Promise<number> {
  return (await getQueue()).length;
}

export type EmailApproval = {
  id: string;
  subject: string | null;
  body: string;
  prospect: { id: string; full_name: string; title: string | null; company_name: string | null; email: string | null };
};

// Primeros correos esperando aprobación (solo si el modo aprobación está encendido)
export async function getEmailApprovals(): Promise<EmailApproval[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("outreach_messages")
    .select("id, subject, body, prospect:prospects!inner(id, full_name, title, company_name, email, status)")
    .eq("kind", "correo_1")
    .eq("status", "borrador")
    .in("prospect.status", ["listo", "enviado"])
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`Error leyendo correos por aprobar: ${error.message}`);
  return (data ?? []) as unknown as EmailApproval[];
}
