import { fmtDate, listAgentRuns, monthCostUsd } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function CostosPage() {
  const [rows, costo] = await Promise.all([listAgentRuns(), monthCostUsd()]);

  return (
    <>
      <h1>Costos de agentes</h1>
      <p className="muted">Cada ejecución de un agente, con tokens y costo real. Este mes: ${costo.toFixed(2)} USD.</p>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">Todavía no hay ejecuciones de agentes.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Agente</th><th>Modelo</th><th>Estado</th>
                <th>Tokens entrada</th><th>Tokens salida</th><th>Costo USD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDate(r.started_at)}</td>
                  <td>{r.agent}</td>
                  <td>{r.model ?? "—"}</td>
                  <td><span className="pill">{r.status}</span></td>
                  <td>{r.input_tokens}</td>
                  <td>{r.output_tokens}</td>
                  <td>${Number(r.cost_usd).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
