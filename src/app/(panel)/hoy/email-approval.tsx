"use client";

import { useState, useTransition } from "react";
import { approveEmail, discardProspect } from "../actions";

export function EmailApprovalCard(props: {
  id: string; prospectId: string; name: string; meta: string; email: string; subject: string; body: string;
}) {
  const [subject, setSubject] = useState(props.subject);
  const [body, setBody] = useState(props.body);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<unknown>, ok: string) =>
    start(async () => {
      setMsg(null);
      try { await fn(); setMsg({ ok: true, text: ok }); }
      catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" }); }
    });

  return (
    <article className="card queue-item">
      <header className="queue-head">
        <div>
          <span className="pill">Correo 1</span> <span className="queue-name">{props.name}</span>
          <div className="muted small">{props.meta} · {props.email}</div>
        </div>
      </header>
      <label className="small stack">Asunto <input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
      <div className="muted small">Al enviarse se agregan tu firma y el pie. Los seguimientos 2 y 3 salen solos si no responde.</div>
      <div className="row-actions">
        <button type="button" disabled={pending} onClick={() => run(() => approveEmail(props.id, subject, body, true), "Aprobado: sale en la próxima hora de envío.")}>
          Aprobar
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(() => approveEmail(props.id, subject, body, false), "Guardado.")}>
          Guardar
        </button>
        <button type="button" className="btn-danger" disabled={pending} onClick={() => run(() => discardProspect(props.prospectId), "Descartado.")}>
          Descartar prospecto
        </button>
      </div>
      {msg && <p className={msg.ok ? "alert alert-ok" : "alert alert-error"}>{msg.text}</p>}
    </article>
  );
}
