import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// ¿Ya se corrió la migración 002 (correo)? Mientras no, el motor trabaja como antes
// y el envío de correo queda apagado, para que nada falle por columnas que no existen.
let ready = false; // solo se recuerda el "sí"; el "no" se vuelve a revisar cada vez

export async function emailSchemaReady(): Promise<boolean> {
  if (ready) return true;
  const db = createAdminClient();
  const [a, b] = await Promise.all([
    db.from("outreach_messages").select("subject, gmail_thread_id, rfc_message_id").limit(1),
    db.from("prospects").select("email_status, replied_at, reply_channel").limit(1),
  ]);
  ready = !a.error && !b.error;
  return ready;
}
