import Link from "next/link";
import { fmtDate, listProspects } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ProspectosPage() {
  const rows = await listProspects();

  return (
    <>
      <h1>Prospectos</h1>
      <p className="muted">Todos los que trajo el motor, incluidos los descartados y su motivo.</p>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">Todavía no hay prospectos. Corre el motor desde Configuración o espera a la corrida de mañana.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th><th>Puesto</th><th>Empresa</th><th>Empleados</th>
                <th>País</th><th>Estado</th><th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/prospectos/${p.id}`}>{p.full_name}</Link></td>
                  <td>{p.title ?? "—"}</td>
                  <td>{p.company_name ?? "—"}</td>
                  <td>{p.company_size ?? "—"}</td>
                  <td>{p.country ?? "—"}</td>
                  <td>
                    <span className="pill">{p.status}</span>
                    {p.discard_reason && <div className="muted small">{p.discard_reason}</div>}
                  </td>
                  <td>{fmtDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
