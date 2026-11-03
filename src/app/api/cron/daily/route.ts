import { NextResponse, type NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline/run";
import { rejectIfNotCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Prospección diaria (ver vercel.json)
export async function GET(request: NextRequest) {
  const denied = rejectIfNotCron(request);
  if (denied) return denied;
  return NextResponse.json(await runPipeline("cron"));
}
