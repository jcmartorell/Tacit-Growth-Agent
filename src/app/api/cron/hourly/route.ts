import { NextResponse, type NextRequest } from "next/server";
import { publishDue } from "@/lib/content/publish";
import { rejectIfNotCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Cada hora: publica los posts aprobados cuya hora llegó y renueva el token de Instagram
export async function GET(request: NextRequest) {
  const denied = rejectIfNotCron(request);
  if (denied) return denied;
  return NextResponse.json(await publishDue());
}
