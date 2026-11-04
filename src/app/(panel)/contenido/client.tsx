"use client";

import { useActionState, useState, useTransition } from "react";
import {
  backToDraft, connectIg, discardPost, generateNow, publishNow, renderReelNow, saveReelScript, savePost, type ConnState,
} from "./actions";
import { unwrap } from "@/lib/action-result";

export type PostView = {
  id: string;
  channel: string;
  topic: string | null;
  body: string;
  status: string;
  when: string;          // "YYYY-MM-DDTHH:mm" CDMX
  whenLabel: string;
  publishedLabel: string | null;
  error: string | null;
  lang: string | null;
  pillar: string | null;
  imageUrl: string | null;
  format: "image" | "reel";
  videoUrl: string | null;
  reel: { hook: string; points: string[]; cta: string } | null;
  processing: boolean;
};

const CHANNEL: Record<string, string> = { instagram: "Instagram", linkedin_personal: "LinkedIn" };
const LIMIT: Record<string, number> = { instagram: 2200, linkedin_personal: 3000 };

function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<unknown>, okText?: string) =>
    start(async () => {
      setMsg(null);
      try {
        unwrap(await fn());
        if (okText) setMsg({ ok: true, text: okText });
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
      }
    });
  return { pending, msg, setMsg, run };
}

export function PostCard({ p }: { p: PostView }) {
  const [body, setBody] = useState(p.body);
  const [when, setWhen] = useState(p.when);
  const { pending, msg, run } = useAction();
  const editable = p.status === "borrador" || p.status === "aprobado" || p.status === "error";
  const max = LIMIT[p.channel] ?? 3000;

  return (
    <article className="card queue-item">
      <header className="queue-head">
        <div>
          <span className="pill">{p.format === "reel" ? "Instagram Reel" : CHANNEL[p.channel] ?? p.channel}</span>{" "}
          <span className="pill">{p.status}</span>{" "}
          {p.lang && <span className="pill">{p.lang.toUpperCase()}</span>}
          <div className="queue-name" style={{ marginTop: 6 }}>{p.topic}</div>
          {p.pillar && <div className="muted small">{p.pillar}</div>}
        </div>
        <div className="muted small">{p.publishedLabel ? `Publicado ${p.publishedLabel}` : `Programado ${p.whenLabel}`}</div>
      </header>

      {p.error && <p className="alert alert-error">{p.error}</p>}

      {p.processing && p.status === "aprobado" && (
        <p className="alert alert-ok">Instagram está procesando el video; se publica en la siguiente revisión (máximo 1 hora).</p>
      )}
      <div className="post-grid">
        {p.format === "reel" && (
          p.videoUrl ? (
            <video src={p.videoUrl} className="post-img" style={{ aspectRatio: "9 / 16" }} controls playsInline preload="metadata" />
          ) : (
            <div className="post-img reel-pending stack">
              <span className="small">Video pendiente</span>
              <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => renderReelNow(p.id), "Video generado.")}>
                {pending ? "Generando… (~30 s)" : "Generar video ahora"}
              </button>
            </div>
          )
        )}
        {p.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="Imagen del post" className="post-img" loading="lazy" />
        )}
        <div className="stack" style={{ flex: 1 }}>
          {p.format === "reel" && p.reel && editable && <ReelScriptEditor id={p.id} reel={p.reel} hasVideo={Boolean(p.videoUrl)} />}
          {editable && p.format === "reel" && <span className="small muted">Texto de la publicación (caption)</span>}
          {editable ? (
            <>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={p.channel === "instagram" ? 10 : 14} />
              <div className={`small ${body.length > max ? "inline-error" : "muted"}`}>{body.length} / {max} caracteres</div>
              <label className="small">
                Fecha y hora (CDMX){" "}
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </label>
            </>
          ) : (
            <pre className="message">{p.body}</pre>
          )}
        </div>
      </div>

      {editable && (
        <div className="row-actions">
          {p.status !== "aprobado" ? (
            <button type="button" disabled={pending} onClick={() => run(() => savePost(p.id, body, when, true), "Aprobado. Se publicará a su hora.")}>
              Aprobar
            </button>
          ) : (
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => savePost(p.id, body, when, true), "Cambios guardados.")}>
              Guardar cambios
            </button>
          )}
          {p.status === "borrador" && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => savePost(p.id, body, when, false), "Borrador guardado.")}>
              Guardar sin aprobar
            </button>
          )}
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => publishNow(p.id), "Publicación ejecutada.")}>
            {pending ? "…" : "Publicar ya"}
          </button>
          {p.status !== "borrador" && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => backToDraft(p.id))}>
              Regresar a borrador
            </button>
          )}
          <button type="button" className="btn-danger" disabled={pending} onClick={() => run(() => discardPost(p.id))}>
            Descartar
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? "alert alert-ok" : "alert alert-error"}>{msg.text}</p>}
    </article>
  );
}

function ReelScriptEditor({ id, reel, hasVideo }: { id: string; reel: { hook: string; points: string[]; cta: string }; hasVideo: boolean }) {
  const [hook, setHook] = useState(reel.hook);
  const [points, setPoints] = useState<string[]>([0, 1, 2].map((i) => reel.points[i] ?? ""));
  const [cta, setCta] = useState(reel.cta);
  const { pending, msg, run } = useAction();
  const changed = hook !== reel.hook || cta !== reel.cta || points.some((x, i) => x !== (reel.points[i] ?? ""));
  return (
    <details className="reel-script" open={!hasVideo}>
      <summary className="small"><strong>Textos del video</strong> (editar)</summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <label className="small">Gancho (primer segundo, máx. 12 palabras)
          <input value={hook} onChange={(e) => setHook(e.target.value)} />
        </label>
        {points.map((v, i) => (
          <label key={i} className="small">Idea {i + 1} (máx. 16 palabras)
            <input value={v} onChange={(e) => setPoints(points.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
        <label className="small">Cierre (máx. 12 palabras)
          <input value={cta} onChange={(e) => setCta(e.target.value)} />
        </label>
        <div className="row-actions">
          <button type="button" disabled={pending || !changed} onClick={() => run(() => saveReelScript(id, hook, points, cta), "Textos guardados y video nuevo generado.")}>
            {pending ? "Generando video… (~40 s)" : "Guardar textos y regenerar video"}
          </button>
          {hasVideo && !changed && (
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => renderReelNow(id), "Video regenerado.")}>
              {pending ? "…" : "Regenerar video"}
            </button>
          )}
        </div>
        {msg && <p className={msg.ok ? "alert alert-ok" : "alert alert-error"}>{msg.text}</p>}
      </div>
    </details>
  );
}

export function GenerateButton() {
  const { pending, msg, setMsg, run } = useAction();
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = unwrap(await generateNow());
              setMsg({
                ok: r.errores.length === 0,
                text: r.creados > 0
                  ? `Listo: ${r.creados} posts nuevos para aprobar.${r.errores.length ? ` Errores: ${r.errores.join(" · ")}` : ""}`
                  : r.errores.length ? `Errores: ${r.errores.join(" · ")}` : "Los próximos horarios ya tienen post.",
              });
            })
          }
        >
          {pending ? "Generando… (puede tardar 1 minuto)" : "Generar próximos posts"}
        </button>
      </div>
      {msg && <p className={msg.ok ? "alert alert-ok" : "alert alert-error"}>{msg.text}</p>}
    </div>
  );
}

export function IgConnectForm() {
  const [state, action, pending] = useActionState<ConnState, FormData>(connectIg, null);
  return (
    <form action={action} className="stack">
      <label htmlFor="ig-token">Token de acceso de Instagram</label>
      <input id="ig-token" name="token" type="password" autoComplete="off" required placeholder="Pega aquí el token generado en Meta" />
      <label htmlFor="ig-id">ID de la cuenta de Instagram</label>
      <input id="ig-id" name="igId" inputMode="numeric" autoComplete="off" placeholder="El número que aparece en Meta junto a tu usuario" />
      <div><button type="submit" disabled={pending}>{pending ? "Verificando…" : "Conectar Instagram"}</button></div>
      {state && <p className={state.ok ? "alert alert-ok" : "alert alert-error"}>{state.message}</p>}
    </form>
  );
}

export function DisconnectButton({ action, label }: { action: () => Promise<unknown>; label: string }) {
  const { pending, msg, run } = useAction();
  return (
    <span className="action">
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(action)}>{label}</button>
      {msg && !msg.ok && <span className="inline-error">{msg.text}</span>}
    </span>
  );
}
