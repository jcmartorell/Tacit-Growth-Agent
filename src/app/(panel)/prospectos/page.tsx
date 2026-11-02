import { fmtDate, listProspects } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ProspectosPage() {
  const rows = await listProspects();

  return (
    <>
      <h1>Prospectos</h1>
      <p className="muted">Personas traídas de Apollo. Las acciones de envío llegan en la Fase 2.</p>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">Todavía no hay prospectos.</div>
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
                  <td>
                    {p.linkedin_url ? (
                      <a href={p.linkedin_url} target="_blank" rel="noreferrer">{p.full_name}</a>
                    ) : p.full_name}
                  </td>
                  <td>{p.title ?? "—"}</td>
                  <td>{p.company_name ?? "—"}</td>
                  <td>{p.company_size ?? "—"}</td>
                  <td>{p.country ?? "—"}</td>
                  <td><span className="pill">{p.status}</span></td>
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
