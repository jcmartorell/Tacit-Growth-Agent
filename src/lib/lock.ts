import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Candado atómico por nombre: una fila con clave única en settings.
// Solo una ejecución puede insertarla; la otra recibe "duplicate key" (23505).
// Un candado más viejo que maxMinutes se considera abandonado y se borra.

export async function acquireLock(name: string, maxMinutes: number): Promise<boolean> {
  const db = createAdminClient();
  const key = `lock_${name}`;
  const expired = new Date(Date.now() - maxMinutes * 60_000).toISOString();
  const stale = await db.from("settings").delete().eq("key", key).lt("updated_at", expired);
  if (stale.error) throw new Error(`Candado ${name}: ${stale.error.message}`);
  const { error } = await db.from("settings").insert({ key, value: { at: new Date().toISOString() } });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Candado ${name}: ${error.message}`);
}

export async function releaseLock(name: string) {
  const db = createAdminClient();
  await db.from("settings").delete().eq("key", `lock_${name}`);
}
