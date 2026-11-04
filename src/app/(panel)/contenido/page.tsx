import { createAdminClient } from "@/lib/supabase/admin";
import { fmtDate } from "@/lib/data";
import { toCdmxInput } from "@/lib/time";
import { connectionStatus } from "@/lib/content/connections";
import type { PostMeta } from "@/lib/content/generate";
import { resolveVisuals } from "@/lib/content/visuals";
import { disconnectChannel } from "./actions";
import { DisconnectButton, GenerateButton, IgConnectForm, PostCard, type PostView } from "./client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function ContenidoPage({ searchParams }: PageProps<"/contenido">) {
  const sp = await searchParams;
  const liOk = sp.li === "ok";
  const liError = typeof sp.li_error === "string" ? sp.li_error : null;

  const db = createAdminClient();
  const [{ data, error }, conn] = await Promise.all([
    db.from("posts")
      .select("id, channel, topic, body, status, scheduled_at, published_at, error, metrics, updated_at, image_url")
      .neq("status", "descartado")
      .order("scheduled_at", { ascending: true })
      .limit(200),
    connectionStatus(),
  ]);
  if (error) throw new Error(error.message);

  const posts: PostView[] = (data ?? []).map((r) => {
    const meta = (r.metrics as { meta?: PostMeta } | null)?.meta;
    return {
      id: r.id,
      channel: r.channel,
      topic: r.topic,
      body: r.body,
      status: r.status,
      when: toCdmxInput(r.scheduled_at),
      whenLabel: fmtDate(r.scheduled_at),
      publishedLabel: r.published_at ? fmtDate(r.published_at) : null,
      error: r.error,
      lang: meta?.lang ?? null,
      pillar: meta?.pillar ? meta.pillar.split(":")[0] : null,
      imageUrl: r.channel === "instagram" && meta?.headline ? `/api/img/${r.id}.jpg?v=${encodeURIComponent(String(r.updated_at))}` : null,
      format: meta?.format === "reel" ? "reel" : "image",
      videoUrl: meta?.format === "reel" ? r.image_url : null,
      reel: meta?.reel ? { hook: meta.reel.hook, points: meta.reel.points, cta: meta.reel.cta, visuals: resolveVisuals(meta.reel.seed, meta.reel.visuals), theme: meta.reel.theme === "dark" ? "dark" : "light" } : null,
      processing: Boolean(meta?.containerId),
    };
  });

  const byStatus = (s: string) => posts.filter((p) => p.status === s);
  const published = byStatus("publicado").reverse().slice(0, 20);

  return (
    <>
      <h1>Contenido</h1>
      <p className="muted">
        Cada viernes el agente prepara los posts de la semana siguiente: imágenes y un reel diario. Tú los apruebas o editas, y se publican solos a su hora.
      </p>

      <h2 style={{ marginTop: 20 }}>Cuentas conectadas</h2>
      {liOk && <p className="alert alert-ok">LinkedIn conectado.</p>}
      {liError && <p className="alert alert-error">LinkedIn: {liError}</p>}
      <div className="cards">
        <div className="card stack">
          <div className="label">LinkedIn (tu perfil)</div>
          {conn.linkedin.connected ? (
            <>
              <div>Conectado{conn.linkedin.name ? ` como ${conn.linkedin.name}` : ""}</div>
              <div className="muted small">Vence {fmtDate(conn.linkedin.expiresAt)}. Al vencer, reconecta.</div>
              {conn.linkedin.lastError && <p className="alert alert-error">{conn.linkedin.lastError}</p>}
              <div className="row-actions">
                <a className="btn-secondary as-button" href="/api/linkedin/start">Reconectar</a>
                <DisconnectButton action={disconnectChannel.bind(null, "linkedin")} label="Desconectar" />
              </div>
            </>
          ) : (
            <div><a className="as-button" style={{ background: "var(--ink)", color: "#fff" }} href="/api/linkedin/start">Conectar LinkedIn</a></div>
          )}
        </div>
        <div className="card stack">
          <div className="label">Instagram</div>
          {conn.instagram.connected ? (
            <>
              <div>Conectado como @{conn.instagram.username}</div>
              <div className="muted small">El acceso se renueva solo cada semana.</div>
              {conn.instagram.lastError && <p className="alert alert-error">{conn.instagram.lastError}</p>}
              <div className="row-actions">
                <DisconnectButton action={disconnectChannel.bind(null, "instagram")} label="Desconectar" />
              </div>
            </>
          ) : (
            <IgConnectForm />
          )}
        </div>
      </div>

      <h2>Generar</h2>
      <GenerateButton />

      <Section title="Por aprobar" empty="No hay posts por aprobar." items={byStatus("borrador")} />
      <Section title="Con error" empty="" items={byStatus("error")} hideEmpty />
      <Section title="Programados" empty="No hay posts programados." items={byStatus("aprobado")} />
      <Section title="Publicados (últimos 20)" empty="Todavía no se ha publicado nada." items={published} />
    </>
  );
}

function Section({ title, empty, items, hideEmpty }: { title: string; empty: string; items: PostView[]; hideEmpty?: boolean }) {
  if (hideEmpty && items.length === 0) return null;
  return (
    <>
      <h2 style={{ marginTop: 28 }}>{title} ({items.length})</h2>
      {items.length === 0 ? (
        <div className="table-wrap"><div className="empty">{empty}</div></div>
      ) : (
        <div className="queue">{items.map((p) => <PostCard key={`${p.id}-${p.status}`} p={p} />)}</div>
      )}
    </>
  );
}
