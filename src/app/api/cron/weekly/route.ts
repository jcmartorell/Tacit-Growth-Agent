import { NextResponse, type NextRequest } from "next/server";
import { generateUpcoming } from "@/lib/content/generate";
import { getSettings } from "@/lib/settings";
import { rejectIfNotCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Viernes: prepara los posts de la semana siguiente para que los apruebes
export async function GET(request: NextRequest) {
  const denied = rejectIfNotCron(request);
  if (denied) return denied;
  const s = await getSettings();
  if (!s.content.active) return NextResponse.json({ skipped: "Contenido automático apagado." });
  return NextResponse.json(await generateUpcoming(s));
}
