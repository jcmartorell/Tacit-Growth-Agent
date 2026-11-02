import { getSettings } from "@/lib/settings";
import { envStatus, fmtDate, listMotorRuns } from "@/lib/data";
import { ConfigForm, RunNowButton } from "./client";
import type { RunSummary } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // "Ejecutar ahora" puede tardar varios minutos

export default async function ConfiguracionPage() {
  const [settings, runs] = await Promise.all([getSettings(), listMotorRuns()]);
  const env = envStatus();
  const missing = Object.entries(env).filter(([, ok]) => !ok).map(([k]) => k);

  return (
    <>
      <h1>Configuración</h1>
      <p className="muted">
        El motor corre solo de lunes a viernes a las 8:00 (hora de CDMX). Aquí ajustas a quién busca y cómo escribe.
      </p>

      {missing.length > 0 && (
        <p className="alert alert-error">
          Faltan variables en Vercel: {missing.join(", ")}. Sin ellas el motor no puede correr.
        </p>
      )}

      <h2 style={{ marginTop: 20 }}>Ejecutar ahora</h2>
      <p className="muted">Corre el motor completo en este momento, sin esperar a mañana. Tarda de 1 a 3 minutos.</p>
      <RunNowButton disabled={!env.APOLLO_API_KEY || !env.ANTHROPIC_API_KEY} />

      <h2 style={{ marginTop: 28 }}>Últimas corridas</h2>
      <div className="table-wrap">
        {runs.length === 0 ? (
          <div className="empty">Todavía no ha corrido.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Fecha</th><th>Origen</th><th>Resultados en Apollo</th><th>Nuevos</th><th>Descartados</th><th>Redactados</th><th>Errores</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const d = (r.detail ?? {}) as Partial<RunSummary> & { trigger?: string };
                return (
                  <tr key={r.id}>
                    <td>{fmtDate(r.started_at)}</td>
                    <td>{d.trigger === "cron" ? "Automático" : "Manual"}</td>
                    <td>{(d.searches ?? []).map((s) => `${s.key}: ${s.total ?? "?"}`).join(" · ") || "—"}</td>
                    <td>{d.enriquecidos ?? 0}</td>
                    <td>{d.descartados ?? 0}</td>
                    <td>{d.redactados ?? 0}</td>
                    <td>
                      {(d.errores ?? []).length === 0 ? "—" : (
                        <details><summary>{d.errores!.length}</summary><ul className="small">{d.errores!.map((e, i) => <li key={i}>{e}</li>)}</ul></details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ marginTop: 28 }}>Perfil de cliente y redacción</h2>
      <ConfigForm settings={settings} />
    </>
  );
}
