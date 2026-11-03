import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderPostJpeg } from "@/lib/content/image";
import type { PostMeta } from "@/lib/content/generate";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Imagen pública del post. Es pública porque Instagram la descarga desde esta URL al publicar.
// Solo expone la imagen de un post existente (id imposible de adivinar), nunca otros datos.
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/img/[id]">) {
  const { id } = await ctx.params;
  const clean = id.replace(/\.jpe?g$/i, "");
  if (!UUID_RE.test(clean)) return new NextResponse("No encontrado", { status: 404 });

  const db = createAdminClient();
  const { data, error } = await db.from("posts").select("metrics, status").eq("id", clean).maybeSingle();
  if (error || !data || data.status === "descartado") return new NextResponse("No encontrado", { status: 404 });
  const meta = (data.metrics as { meta?: PostMeta } | null)?.meta;
  if (!meta?.headline) return new NextResponse("Sin imagen", { status: 404 });

  const jpeg = await renderPostJpeg(meta.headline, meta.subline ?? "", meta.lang ?? "es");
  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.length),
      "Cache-Control": "public, max-age=300",
    },
  });
}
