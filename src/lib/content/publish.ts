import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { acquireLock, releaseLock } from "@/lib/lock";
import { publishInstagram, refreshInstagramIfNeeded } from "@/lib/content/instagram";
import { publishLinkedIn } from "@/lib/content/linkedin";

// Publica los posts aprobados cuya hora ya llegó. Corre cada hora (Vercel Cron).

export type PublishSummary = { publicados: number; errores: string[]; instagramToken: string; skipped?: boolean };

export function imageUrlFor(postId: string, version: string) {
  return `${publicEnv().siteUrl}/api/img/${postId}.jpg?v=${encodeURIComponent(version)}`;
}

export async function publishDue(): Promise<PublishSummary> {
  const summary: PublishSummary = { publicados: 0, errores: [], instagramToken: "sin revisar" };
  if (!(await acquireLock("publicar", 10))) return { ...summary, skipped: true };
  const db = createAdminClient();
  try {
    summary.instagramToken = await refreshInstagramIfNeeded();

    const { data, error } = await db
      .from("posts")
      .select("id, channel, body, updated_at")
      .eq("status", "aprobado")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(`Leer posts: ${error.message}`);

    for (const p of data ?? []) {
      try {
        const externalId =
          p.channel === "instagram"
            ? await publishInstagram(imageUrlFor(p.id, String(p.updated_at)), p.body)
            : await publishLinkedIn(p.body);
        const r = await db
          .from("posts")
          .update({ status: "publicado", published_at: new Date().toISOString(), external_id: externalId, error: null })
          .eq("id", p.id);
        if (r.error) throw new Error(r.error.message);
        summary.publicados += 1;
      } catch (e) {
        const msg = (e as Error).message;
        summary.errores.push(`${p.channel}: ${msg}`);
        await db.from("posts").update({ status: "error", error: msg }).eq("id", p.id);
      }
    }
  } finally {
    await releaseLock("publicar");
  }
  return summary;
}
