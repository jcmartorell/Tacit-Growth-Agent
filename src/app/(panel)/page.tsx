import { countAll, countBy, monthCostUsd } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ResumenPage() {
  const [prospects, listos, enviados, reuniones, postsPorAprobar, publicados, costo] = await Promise.all([
    countAll("prospects"),
    countBy("prospects", "listo"),
    countBy("prospects", "enviado"),
    countBy("prospects", "reunion"),
    countBy("posts", "borrador"),
    countBy("posts", "publicado"),
    monthCostUsd(),
  ]);

  return (
    <>
      <h1>Resumen</h1>
      <p className="muted">Estado general del motor de growth.</p>

      <h2>Prospección</h2>
      <div className="cards">
        <Card label="Prospectos totales" value={prospects} />
        <Card label="Listos para enviar" value={listos} />
        <Card label="Enviados" value={enviados} />
        <Card label="Reuniones" value={reuniones} />
      </div>

      <h2>Contenido</h2>
      <div className="cards">
        <Card label="Posts por aprobar" value={postsPorAprobar} />
        <Card label="Posts publicados" value={publicados} />
      </div>

      <h2>Costo de LLM</h2>
      <div className="cards">
        <Card label="Este mes (USD)" value={`$${costo.toFixed(2)}`} />
      </div>
    </>
  );
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
