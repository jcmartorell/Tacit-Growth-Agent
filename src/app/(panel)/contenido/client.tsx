"use client";

import { useActionState, useState, useTransition } from "react";
import {
  backToDraft, connectIg, discardPost, generateNow, publishNow, savePost, type ConnState,
} from "./actions";

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
        await fn();
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
          <span className="pill">{CHANNEL[p.channel] ?? p.channel}</span>{" "}
          <span className="pill">{p.status}</span>{" "}
          {p.lang && <span className="pill">{p.lang.toUpperCase()}</span>}
          <div className="queue-name" style={{ marginTop: 6 }}>{p.topic}</div>
          {p.pillar && <div className="muted small">{p.pillar}</div>}
        </div>
        <div className="muted small">{p.publishedLabel ? `Publicado ${p.publishedLabel}` : `Programado ${p.whenLabel}`}</div>
      </header>

      {p.error && <p className="alert alert-error">{p.error}</p>}

      <div className="post-grid">
        {p.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="Imagen del post" className="post-img" loading="lazy" />
        )}
        <div className="stack" style={{ flex: 1 }}>
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
              const r = await generateNow();
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

export function DisconnectButton({ action, label }: { action: () => Promise<void>; label: string }) {
  const { pending, msg, run } = useAction();
  return (
    <span className="action">
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(action)}>{label}</button>
      {msg && !msg.ok && <span className="inline-error">{msg.text}</span>}
    </span>
  );
}
