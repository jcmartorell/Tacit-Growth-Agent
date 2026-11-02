import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Prueba pública de salud: confirma que la app arrancó y que la base de datos responde.
// No devuelve ningún dato, solo ok / error.
const TABLES = ["settings", "prospects", "outreach_messages", "posts", "agent_runs"] as const;

export async function GET() {
  try {
    const db = createAdminClient();
    const missing: string[] = [];
    for (const t of TABLES) {
      const { error } = await db.from(t).select("*", { count: "exact", head: true });
      if (error) missing.push(t);
    }
    if (missing.length > 0) {
      return NextResponse.json({ ok: false, db: "error", tablas_con_error: missing }, { status: 500 });
    }
    return NextResponse.json({ ok: true, db: "ok" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error desconocido";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
