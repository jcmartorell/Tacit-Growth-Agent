import { getSettings } from "@/lib/settings";
import { envStatus, fmtDate, listMotorRuns } from "@/lib/data";
import { ConfigForm, RunNowButton, SendEmailButton } from "./client";
import { getGmail } from "@/lib/email/gmail";
import { dailyCap } from "@/lib/email/sender";
import { emailSchemaReady } from "@/lib/schema";
import { disconnectGmailAction } from "../actions";
import { ActionButton } from "../ui";
import type { RunSummary } from "@/lib/pipeline/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // "Ejecutar ahora" puede tardar varios minutos

export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  const sp = await searchParams;
  const [settings, runs, gmail, schemaV2] = await Promise.all([getSettings(), listMotorRuns(), getGmail(), emailSchemaReady()]);
  const googleReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
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

      <h2 style={{ marginTop: 28 }}>Correo</h2>
      {sp.g === "ok" && <p className="alert alert-ok">Gmail conectado.</p>}
      {typeof sp.g_error === "string" && <p className="alert alert-error">Gmail: {sp.g_error}</p>}
      {!schemaV2 && (
        <p className="alert alert-error">
          Falta correr la migración <b>002_email.sql</b> en Supabase. Mientras tanto el correo no puede encenderse.
        </p>
      )}
      <div className="card stack" style={{ maxWidth: 640 }}>
        {gmail.refreshToken ? (
          <>
            <div>Buzón conectado: <b>{gmail.email}</b></div>
            {gmail.lastError && <p className="alert alert-error">{gmail.lastError}</p>}
            <div className="muted small">
              Envío {settings.email.active ? "encendido" : "apagado"} · Límite de correos nuevos hoy: {dailyCap(settings.email)}
            </div>
            <div className="row-actions">
              <a className="btn-secondary as-button" href="/api/google/start">Reconectar</a>
              <ActionButton action={disconnectGmailAction} label="Desconectar" variant="secondary" />
            </div>
            <SendEmailButton disabled={!schemaV2} />
          </>
        ) : googleReady ? (
          <div><a className="as-button" style={{ background: "var(--ink)", color: "#fff" }} href="/api/google/start">Conectar Gmail</a></div>
        ) : (
          <div className="muted">Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel para conectar el buzón.</div>
        )}
      </div>

      <h2 style={{ marginTop: 28 }}>Perfil de cliente y redacción</h2>
      <ConfigForm settings={settings} />
    </>
  );
}
