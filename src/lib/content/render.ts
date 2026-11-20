import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderReelMp4 } from "@/lib/content/motion";
import { hasVideo, type PostMeta } from "@/lib/content/generate";
import { scriptFromPost } from "@/lib/content/reel-gen";
import { getSettings } from "@/lib/settings";

// Genera el MP4 de un reel y lo guarda en Supabase Storage (bucket público "reels"),
// porque Instagram descarga el video desde una URL pública.

const BUCKET = "reels";
// Sube este número cuando cambie el diseño del video: los reels no publicados se regeneran solos
export const REEL_STYLE = 4;
let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  const db = createAdminClient();
  const { error } = await db.storage.createBucket(BUCKET, { public: true });
  if (error && !/already exists|duplicate|exists/i.test(error.message)) {
    throw new Error(`No se pudo crear el bucket de videos: ${error.message}`);
  }
  bucketReady = true;
}

type PostRow = { id: string; channel?: string; body?: string; image_url: string | null; metrics: { meta?: PostMeta } | null };

export async function renderReelForPost(post: PostRow): Promise<string> {
  let meta = post.metrics?.meta;
  const db0 = createAdminClient();
  // Lee canal y texto si no vienen (para posts de LinkedIn con video)
  if (!post.channel || post.body === undefined) {
    const { data } = await db0.from("posts").select("channel, body, metrics").eq("id", post.id).single();
    post = { ...post, channel: data?.channel, body: data?.body ?? "", metrics: (data?.metrics as PostRow["metrics"]) ?? post.metrics };
    meta = post.metrics?.meta;
  }
  if (!meta || !hasVideo(post.channel ?? "", meta)) throw new Error("Este post no lleva video.");
  if (!meta.reel) {
    // Post de LinkedIn sin guion todavía: se escribe a partir del texto del post
    meta = { ...meta, reel: await scriptFromPost(post.body ?? "", meta.lang) };
  }
  if (!meta.reel) throw new Error("Falta el guion del video.");
  await ensureBucket();
  const music = (await getSettings()).content.reels.music;
  const mp4 = await renderReelMp4({ ...meta.reel, lang: meta.lang, music });

  const db = createAdminClient();
  const path = `${post.id}-${Date.now()}.mp4`;
  const up = await db.storage.from(BUCKET).upload(path, mp4, { contentType: "video/mp4", upsert: true });
  if (up.error) throw new Error(`Subir video: ${up.error.message}`);
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  const upd = await db
    .from("posts")
    .update({ image_url: url, metrics: { ...(post.metrics ?? {}), meta: { ...meta, renderedAt: new Date().toISOString(), style: REEL_STYLE, music, liVideoUrn: undefined } } })
    .eq("id", post.id);
  if (upd.error) throw new Error(upd.error.message);
  return url;
}

// Genera los videos pendientes (los más próximos primero). Pocos por corrida para no exceder el tiempo.
export async function renderPendingReels(max = 2): Promise<{ generados: number; errores: string[] }> {
  const db = createAdminClient();
  const music = (await getSettings()).content.reels.music;
  const { data, error } = await db
    .from("posts")
    .select("id, channel, body, image_url, metrics, scheduled_at")
    .in("channel", ["instagram", "linkedin_personal"])
    .in("status", ["borrador", "aprobado"])
    .order("scheduled_at", { ascending: true })
    .limit(60);
  if (error) return { generados: 0, errores: [error.message] };
  // Sin video, o con video de un diseño anterior. Nunca si Instagram ya está procesando ese video.
  const pending = (data ?? []).filter((p) => {
    const meta = (p.metrics as { meta?: PostMeta } | null)?.meta;
    return hasVideo(p.channel as string, meta) && !meta?.containerId && !meta?.liVideoUrn
      && (!p.image_url || meta?.style !== REEL_STYLE || (meta?.music ?? "corporativo") !== music);
  }).slice(0, max);
  const out = { generados: 0, errores: [] as string[] };
  for (const p of pending) {
    try {
      await renderReelForPost(p as PostRow);
      out.generados += 1;
    } catch (e) {
      out.errores.push((e as Error).message);
    }
  }
  return out;
}
