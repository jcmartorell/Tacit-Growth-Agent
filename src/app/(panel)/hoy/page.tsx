import Link from "next/link";
import { getQueue, KIND_LABEL } from "@/lib/queue";
import { CopyButton, ActionButton } from "../ui";
import { discardProspect, markMeeting, markReplied, markSent } from "../actions";

export const dynamic = "force-dynamic";

export default async function HoyPage() {
  const items = await getQueue();

  return (
    <>
      <h1>Hoy</h1>
      <p className="muted">
        Mensajes que toca enviar. Abre el perfil, copia el texto, mándalo en LinkedIn y marca &quot;Enviado&quot;.
        El sistema programa solo el siguiente paso.
      </p>

      {items.length === 0 ? (
        <div className="table-wrap"><div className="empty">No hay nada pendiente por hoy.</div></div>
      ) : (
        <div className="queue">
          {items.map((m) => (
            <article key={m.id} className="card queue-item">
              <header className="queue-head">
                <div>
                  <span className="pill">{KIND_LABEL[m.kind] ?? m.kind}</span>{" "}
                  <Link href={`/prospectos/${m.prospect.id}`} className="queue-name">{m.prospect.full_name}</Link>
                  <div className="muted small">
                    {[m.prospect.title, m.prospect.company_name].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {m.prospect.linkedin_url && (
                  <a className="btn-secondary as-button" href={m.prospect.linkedin_url} target="_blank" rel="noreferrer">
                    Abrir LinkedIn
                  </a>
                )}
              </header>
              {m.prospect.research?.angulo && <p className="angle">{m.prospect.research.angulo}</p>}
              <pre className="message">{m.body}</pre>
              <div className="row-actions">
                <CopyButton text={m.body} />
                <ActionButton action={markSent.bind(null, m.id)} label="Enviado" pendingLabel="Guardando…" />
                {m.kind !== "invitacion" && (
                  <>
                    <ActionButton action={markReplied.bind(null, m.prospect.id)} label="Respondió" variant="secondary" />
                    <ActionButton action={markMeeting.bind(null, m.prospect.id)} label="Reunión" variant="secondary" />
                  </>
                )}
                <ActionButton action={discardProspect.bind(null, m.prospect.id)} label="Descartar" variant="danger" />
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
