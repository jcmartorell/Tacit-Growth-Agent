import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { acquireLock, releaseLock } from "@/lib/lock";
import { createReelContainer, publishInstagram, refreshInstagramIfNeeded, tryPublishReel } from "@/lib/content/instagram";
import { renderReelForPost } from "@/lib/content/render";
import { liMediaOf, type PostMeta } from "@/lib/content/generate";
import { renderPostJpeg } from "@/lib/content/image";
import { linkedInVideoReady, publishLinkedIn, uploadLinkedInImage, uploadLinkedInVideo } from "@/lib/content/linkedin";

// Publica los posts aprobados cuya hora ya llegó. Corre cada hora (Vercel Cron).

export type PublishSummary = { publicados: number; enProceso: number; errores: string[]; instagramToken: string; skipped?: boolean };

export function imageUrlFor(postId: string, version: string) {
  return `${publicEnv().siteUrl}/api/img/${postId}.jpg?v=${encodeURIComponent(version)}`;
}

export async function publishDue(): Promise<PublishSummary> {
  const summary: PublishSummary = { publicados: 0, enProceso: 0, errores: [], instagramToken: "sin revisar" };
  if (!(await acquireLock("publicar", 10))) return { ...summary, skipped: true };
  const db = createAdminClient();
  try {
    summary.instagramToken = await refreshInstagramIfNeeded();

    const { data, error } = await db
      .from("posts")
      .select("id, channel, body, updated_at, image_url, metrics")
      .eq("status", "aprobado")
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(`Leer posts: ${error.message}`);

    for (const p of data ?? []) {
      try {
        const meta = (p.metrics as { meta?: PostMeta } | null)?.meta;
        let externalId: string;
        if (p.channel === "instagram" && meta?.format === "reel") {
          // Reel: generar video si falta, crear contenedor una vez y publicar cuando Instagram termine
          let containerId = meta.containerId;
          if (!containerId) {
            const videoUrl = p.image_url ?? (await renderReelForPost(p as never));
            containerId = await createReelContainer(videoUrl, p.body);
            const fresh = await db.from("posts").select("metrics").eq("id", p.id).single();
            const m = (fresh.data?.metrics as { meta?: PostMeta } | null) ?? {};
            await db.from("posts").update({ metrics: { ...m, meta: { ...(m.meta ?? meta), containerId } } }).eq("id", p.id);
          }
          const published = await tryPublishReel(containerId);
          if (!published) {
            summary.enProceso += 1; // Instagram sigue procesando; se publica en la siguiente revisión
            continue;
          }
          externalId = published;
        } else if (p.channel === "instagram") {
          externalId = await publishInstagram(imageUrlFor(p.id, String(p.updated_at)), p.body);
        } else {
          const media = liMediaOf(meta);
          if (media === "image" && meta?.headline) {
            const jpeg = await renderPostJpeg(meta.headline, meta.subline ?? "", meta.lang ?? "es");
            const image = await uploadLinkedInImage(new Uint8Array(jpeg));
            externalId = await publishLinkedIn(p.body, { id: image, title: meta.headline });
          } else if (media === "video") {
            // Video: generar si falta, subir una vez y publicar cuando LinkedIn termine de procesarlo
            let urn = meta?.liVideoUrn;
            if (!urn) {
              const videoUrl = p.image_url && p.image_url.endsWith(".mp4") ? p.image_url : await renderReelForPost(p as never);
              const res = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
              if (!res.ok) throw new Error(`No se pudo leer el video (${res.status}).`);
              urn = await uploadLinkedInVideo(new Uint8Array(await res.arrayBuffer()));
              const fresh = await db.from("posts").select("metrics").eq("id", p.id).single();
              const m = (fresh.data?.metrics as { meta?: PostMeta } | null) ?? {};
              await db.from("posts").update({ metrics: { ...m, meta: { ...(m.meta ?? meta), liVideoUrn: urn } } }).eq("id", p.id);
            }
            if (!(await linkedInVideoReady(urn))) {
              summary.enProceso += 1; // LinkedIn sigue procesando; se publica en la siguiente revisión
              continue;
            }
            externalId = await publishLinkedIn(p.body, { id: urn, title: meta?.headline || undefined });
          } else {
            externalId = await publishLinkedIn(p.body);
          }
        }
        const r = await db
          .from("posts")
          .update({ status: "publicado", published_at: new Date().toISOString(), external_id: externalId, error: null })
          .eq("id", p.id);
        if (r.error) throw new Error(r.error.message);
        summary.publicados += 1;
      } catch (e) {
        const msg = (e as Error).message;
        summary.errores.push(`${p.channel}: ${msg}`);
        // Si falla, se olvida el contenedor o video subido para que un reintento empiece de cero
        const fresh = await db.from("posts").select("metrics").eq("id", p.id).single();
        const m = (fresh.data?.metrics as { meta?: PostMeta } | null) ?? (p.metrics as { meta?: PostMeta } | null) ?? {};
        const meta = m.meta ? { ...m.meta, containerId: undefined, liVideoUrn: undefined } : undefined;
        await db.from("posts").update({ status: "error", error: msg, ...(meta ? { metrics: { ...m, meta } } : {}) }).eq("id", p.id);
      }
    }
  } finally {
    await releaseLock("publicar");
  }
  return summary;
}
