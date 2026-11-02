import { fmtDate, listPosts } from "@/lib/data";

export const dynamic = "force-dynamic";

const CHANNEL: Record<string, string> = {
  linkedin_personal: "LinkedIn (perfil)",
  linkedin_empresa: "LinkedIn (empresa)",
  instagram: "Instagram",
};

export default async function ContenidoPage() {
  const rows = await listPosts();

  return (
    <>
      <h1>Contenido</h1>
      <p className="muted">Posts de LinkedIn e Instagram. Aprobación y publicación llegan en las Fases 3 y 4.</p>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">Todavía no hay posts.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Canal</th><th>Tema</th><th>Estado</th><th>Programado</th><th>Publicado</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{CHANNEL[p.channel] ?? p.channel}</td>
                  <td>{p.topic ?? "—"}</td>
                  <td><span className="pill">{p.status}</span></td>
                  <td>{fmtDate(p.scheduled_at)}</td>
                  <td>{fmtDate(p.published_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
