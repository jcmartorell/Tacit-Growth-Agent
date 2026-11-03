import { learningStats, type Rate } from "@/lib/learning";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSchemaReady } from "@/lib/schema";

export const dynamic = "force-dynamic";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function funnel() {
  const db = createAdminClient();
  const count = async (statuses: string[]) => {
    const { count, error } = await db.from("prospects").select("*", { count: "exact", head: true }).in("status", statuses);
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const sentEmails = async () => {
    if (!(await emailSchemaReady())) return 0;
    const { count, error } = await db.from("outreach_messages").select("*", { count: "exact", head: true })
      .in("kind", ["correo_1", "correo_2", "correo_3"]).eq("status", "enviado");
    if (error) throw new Error(error.message);
    return count ?? 0;
  };
  const [traidos, listos, contactados, respondieron, reuniones, rebotados, correos] = await Promise.all([
    count(["nuevo", "descartado", "listo", "enviado", "respondio", "reunion", "cerrado", "rebotado"]),
    count(["listo"]),
    count(["enviado", "respondio", "reunion", "cerrado"]),
    count(["respondio", "reunion", "cerrado"]),
    count(["reunion", "cerrado"]),
    count(["rebotado"]),
    sentEmails(),
  ]);
  return { traidos, listos, contactados, respondieron, reuniones, rebotados, correos };
}

export default async function MetricasPage() {
  const [f, s] = await Promise.all([funnel(), learningStats()]);

  return (
    <>
      <h1>Métricas</h1>
      <p className="muted">
        Qué está funcionando. La tasa de respuesta se estima con un modelo bayesiano: con pocos datos el rango es amplio,
        y se angosta conforme hay más contactos. El motor usa estas cifras para decidir a quién buscar.
      </p>

      <div className="cards">
        <Card label="Prospectos traídos" value={f.traidos} />
        <Card label="Contactados" value={f.contactados} />
        <Card label="Respondieron" value={f.respondieron} />
        <Card label="Reuniones" value={f.reuniones} />
        <Card label="Correos enviados" value={f.correos} />
        <Card label="Rebotes" value={f.rebotados} />
      </div>

      <Table title="Por búsqueda (decide el reparto diario)" rows={s.bySearch} />
      <Table title="Por tipo de puesto" rows={s.byTitle} />
      <Table title="Por industria" rows={s.byIndustry} />
      <Table title="Por idioma" rows={s.byLanguage} />
    </>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return <div className="card"><div className="label">{label}</div><div className="value">{value}</div></div>;
}

function Table({ title, rows }: { title: string; rows: Rate[] }) {
  return (
    <>
      <h2 style={{ marginTop: 24 }}>{title}</h2>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">Todavía no hay contactos para medir.</div>
        ) : (
          <table>
            <thead><tr><th>Grupo</th><th>Contactados</th><th>Respondieron</th><th>Tasa estimada</th><th>Rango probable (90%)</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.key}</td><td>{r.contacted}</td><td>{r.replied}</td>
                  <td>{pct(r.mean)}</td><td className="muted">{pct(r.low)} a {pct(r.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
