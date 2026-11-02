import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Cola de trabajo: mensajes en borrador cuya fecha ya llegó, de prospectos activos.

export const KIND_LABEL: Record<string, string> = {
  invitacion: "Invitación",
  mensaje: "Mensaje",
  seguimiento_1: "Seguimiento 1",
  seguimiento_2: "Seguimiento 2",
};

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
