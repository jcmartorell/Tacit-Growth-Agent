import { NextResponse, type NextRequest } from "next/server";
import { publishDue } from "@/lib/content/publish";
import { runEmail } from "@/lib/email/sender";
import { renderPendingReels } from "@/lib/content/render";
import { rejectIfNotCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cada hora: publica contenido aprobado, renueva el token de Instagram,
// revisa respuestas de correo y envía los correos que tocan.
export async function GET(request: NextRequest) {
  const denied = rejectIfNotCron(request);
  if (denied) return denied;
  const contenido = await publishDue().catch((e) => ({ error: (e as Error).message }));
  const correo = await runEmail("cron").catch((e) => ({ error: (e as Error).message }));
  // Genera con anticipación los videos de reels pendientes (2 por hora)
  const reels = await renderPendingReels(2).catch((e) => ({ error: (e as Error).message }));
  return NextResponse.json({ contenido, correo, reels });
}
