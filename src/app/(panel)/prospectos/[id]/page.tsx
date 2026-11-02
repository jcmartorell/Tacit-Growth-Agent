import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { fmtDate } from "@/lib/data";
import { KIND_LABEL } from "@/lib/queue";
import { CopyButton, ActionButton } from "../../ui";
import { discardProspect, markMeeting, markReplied } from "../../actions";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function ProspectoPage({ params }: PageProps<"/prospectos/[id]">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const db = createAdminClient();
  const { data: p, error } = await db.from("prospects").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) notFound();
  const { data: msgs, error: e2 } = await db
    .from("outreach_messages")
    .select("id, kind, body, status, due_at, sent_at")
    .eq("prospect_id", id);
  if (e2) throw new Error(e2.message);

  const order = ["invitacion", "mensaje", "seguimiento_1", "seguimiento_2"];
  const sorted = (msgs ?? []).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const research = (p.research ?? {}) as { angulo?: string; source?: string; language?: string };
  const active = ["listo", "enviado"].includes(p.status);

  return (
    <>
      <p className="muted"><Link href="/prospectos">← Prospectos</Link></p>
      <h1>{p.full_name}</h1>
      <p className="muted">
        {[p.title, p.company_name, p.industry, p.company_size ? `${p.company_size} empleados` : null, p.country]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="row-actions">
        <span className="pill">{p.status}</span>
        {research.source && <span className="pill">búsqueda: {research.source}</span>}
        {p.linkedin_url && (
          <a className="btn-secondary as-button" href={p.linkedin_url} target="_blank" rel="noreferrer">Abrir LinkedIn</a>
        )}
        {active && (
          <>
            <ActionButton action={markReplied.bind(null, p.id)} label="Respondió" variant="secondary" />
            <ActionButton action={markMeeting.bind(null, p.id)} label="Reunión" variant="secondary" />
            <ActionButton action={discardProspect.bind(null, p.id)} label="Descartar" variant="danger" />
          </>
        )}
      </div>
      {p.discard_reason && <p className="alert alert-error" style={{ marginTop: 12 }}>Descartado: {p.discard_reason}</p>}
      {research.angulo && (
        <>
          <h2 style={{ marginTop: 24 }}>Ángulo</h2>
          <p className="angle">{research.angulo}</p>
        </>
      )}

      <h2 style={{ marginTop: 24 }}>Mensajes</h2>
      {sorted.length === 0 ? (
        <div className="table-wrap"><div className="empty">Sin mensajes todavía.</div></div>
      ) : (
        <div className="queue">
          {sorted.map((m) => (
            <article key={m.id} className="card queue-item">
              <header className="queue-head">
                <div>
                  <span className="pill">{KIND_LABEL[m.kind] ?? m.kind}</span>{" "}
                  <span className="pill">{m.status}</span>
                </div>
                <div className="muted small">
                  {m.sent_at ? `Enviado ${fmtDate(m.sent_at)}` : m.due_at ? `Toca ${fmtDate(m.due_at)}` : "Se programa al enviar el anterior"}
                </div>
              </header>
              <pre className="message">{m.body}</pre>
              <div className="row-actions"><CopyButton text={m.body} /></div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
