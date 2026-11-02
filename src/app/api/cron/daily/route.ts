import { NextResponse, type NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Lo llama Vercel Cron cada mañana (ver vercel.json).
// Vercel manda "Authorization: Bearer <CRON_SECRET>"; sin ese valor se rechaza.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Falta la variable de entorno CRON_SECRET." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const summary = await runPipeline("cron");
  return NextResponse.json(summary);
}
