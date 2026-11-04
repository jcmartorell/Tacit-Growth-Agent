import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderReelMp4 } from "@/lib/content/motion";
import type { PostMeta } from "@/lib/content/generate";
import { getSettings } from "@/lib/settings";

// Genera el MP4 de un reel y lo guarda en Supabase Storage (bucket público "reels"),
// porque Instagram descarga el video desde una URL pública.

const BUCKET = "reels";
// Sube este número cuando cambie el diseño del video: los reels no publicados se regeneran solos
export const REEL_STYLE = 3;
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

type PostRow = { id: string; image_url: string | null; metrics: { meta?: PostMeta } | null };

export async function renderReelForPost(post: PostRow): Promise<string> {
  const meta = post.metrics?.meta;
  if (meta?.format !== "reel" || !meta.reel) throw new Error("El post no es un reel.");
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
    .update({ image_url: url, metrics: { ...(post.metrics ?? {}), meta: { ...meta, renderedAt: new Date().toISOString(), style: REEL_STYLE, music } } })
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
    .select("id, image_url, metrics, scheduled_at")
    .eq("channel", "instagram")
    .in("status", ["borrador", "aprobado"])
    .order("scheduled_at", { ascending: true })
    .limit(60);
  if (error) return { generados: 0, errores: [error.message] };
  // Sin video, o con video de un diseño anterior. Nunca si Instagram ya está procesando ese video.
  const pending = (data ?? []).filter((p) => {
    const meta = (p.metrics as { meta?: PostMeta } | null)?.meta;
    return meta?.format === "reel" && !meta.containerId && (!p.image_url || meta.style !== REEL_STYLE || (meta.music ?? "corporativo") !== music);
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
