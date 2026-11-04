"use client";

import { useActionState, useState, useTransition } from "react";
import { runNow, saveConfig, sendEmailNow, type SaveState } from "../actions";
import type { GrowthSettings } from "@/lib/settings";
import type { RunSummary } from "@/lib/pipeline/run";

export function RunNowButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div>
        <button
          type="button"
          disabled={disabled || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setResult(null);
              try {
                setResult(await runNow());
              } catch (e) {
                setError(e instanceof Error ? e.message : "Error");
              }
            })
          }
        >
          {pending ? "Corriendo… (no cierres esta página)" : "Ejecutar ahora"}
        </button>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {result && (
        <div className={result.errores.length ? "alert alert-error" : "alert alert-ok"}>
          {result.status === "skipped" ? (
            <>No corrió: {result.reason}</>
          ) : (
            <>
              Nuevos: {result.enriquecidos} · Descartados: {result.descartados} · Redactados: {result.redactados}
              {result.searches.length > 0 && (
                <> · Apollo: {result.searches.map((s) => `${s.key} ${s.total ?? "?"} resultados`).join(", ")}</>
              )}
              {result.errores.length > 0 && (
                <ul className="small">{result.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const join = (a: string[]) => a.join(", ");

export function SendEmailButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || pending}
          onClick={() =>
            start(async () => {
              setMsg(null);
              try {
                const r = await sendEmailNow();
                setMsg({
                  ok: r.errores.length === 0 && r.status !== "error",
                  text: r.status === "skipped"
                    ? `No corrió: ${r.reason}`
                    : `Revisados ${r.revisados} · Respuestas ${r.respuestas} · Rebotes ${r.rebotes} · Enviados ${r.enviados} · Seguimientos ${r.seguimientos} · Hoy ${r.enviadosHoy}/${r.limiteHoy}${r.errores.length ? ` · Errores: ${r.errores.join(" · ")}` : ""}`,
                });
              } catch (e) {
                setMsg({ ok: false, text: e instanceof Error ? e.message : "Error" });
              }
            })
          }
        >
          {pending ? "Enviando…" : "Revisar y enviar correos ahora"}
        </button>
      </div>
      {msg && <p className={msg.ok ? "alert alert-ok" : "alert alert-error"}>{msg.text}</p>}
    </div>
  );
}

export function ConfigForm({ settings: s }: { settings: GrowthSettings }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveConfig, null);
  const stack = s.searches.find((x) => x.key === "stack");
  const sector = s.searches.find((x) => x.key === "sector");

  return (
    <form action={action} className="stack config-form">
      <label className="check">
        <input type="checkbox" name="active" defaultChecked={s.active} /> Motor automático encendido
      </label>

      <label htmlFor="dailyLimit">Prospectos nuevos por día (cada uno gasta ~1 crédito de Apollo)</label>
      <input id="dailyLimit" name="dailyLimit" type="number" min={1} max={50} defaultValue={s.dailyLimit} />

      <fieldset>
        <legend>A quién buscar</legend>
        <label htmlFor="titles">Puestos (palabras clave, separadas por coma)</label>
        <textarea id="titles" name="titles" rows={3} defaultValue={join(s.titles)} />
        <label htmlFor="seniorities">Niveles (c_suite, vp, head, director, manager…)</label>
        <input id="seniorities" name="seniorities" defaultValue={join(s.seniorities)} />
        <label htmlFor="locations">Países de la persona (en inglés: mexico, united states…)</label>
        <input id="locations" name="locations" defaultValue={join(s.locations)} />
        <label htmlFor="companyLocations">País de la sede de la empresa (en inglés; vacío = cualquiera)</label>
        <input id="companyLocations" name="companyLocations" defaultValue={join(s.companyLocations)} />
        <label htmlFor="minEmployees">Mínimo de empleados de la empresa (0 = sin mínimo)</label>
        <input id="minEmployees" name="minEmployees" type="number" min={0} defaultValue={s.minEmployees} />
        <label htmlFor="maxEmployees">Máximo de empleados de la empresa (0 = sin máximo)</label>
        <input id="maxEmployees" name="maxEmployees" type="number" min={0} defaultValue={s.maxEmployees} />
        <label htmlFor="excludeTitleWords">Descartar si el puesto contiene</label>
        <input id="excludeTitleWords" name="excludeTitleWords" defaultValue={join(s.excludeTitleWords)} />
      </fieldset>

      <fieldset>
        <legend>Búsqueda 1: usan el stack que Tacit conecta</legend>
        <label htmlFor="technologies">Tecnologías (identificadores de Apollo, separados por coma)</label>
        <input id="technologies" name="technologies" defaultValue={join(stack?.technologies ?? [])} />
      </fieldset>

      <fieldset>
        <legend>Búsqueda 2: servicios y tecnología</legend>
        <label htmlFor="industries">Industrias (nombres de Apollo en minúsculas, separados por coma)</label>
        <textarea id="industries" name="industries" rows={3} defaultValue={join(sector?.industries ?? [])} />
      </fieldset>

      <fieldset>
        <legend>Cómo escribe el agente</legend>
        <label htmlFor="tacitContext">Qué es Tacit</label>
        <textarea id="tacitContext" name="tacitContext" rows={5} defaultValue={s.tacitContext} />
        <label htmlFor="writingRules">Reglas de estilo</label>
        <textarea id="writingRules" name="writingRules" rows={4} defaultValue={s.writingRules} />
      </fieldset>

      <fieldset>
        <legend>Seguimientos (días después del mensaje anterior)</legend>
        <div className="inline-fields">
          <label>Mensaje <input name="fu_mensaje" type="number" min={0} defaultValue={s.followUpDays.mensaje} /></label>
          <label>Seguimiento 1 <input name="fu_s1" type="number" min={1} defaultValue={s.followUpDays.seguimiento_1} /></label>
          <label>Seguimiento 2 <input name="fu_s2" type="number" min={1} defaultValue={s.followUpDays.seguimiento_2} /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Envío automático por correo</legend>
        <label className="check">
          <input type="checkbox" name="e_active" defaultChecked={s.email.active} /> Envío por correo encendido
        </label>
        <label className="check">
          <input type="checkbox" name="e_approval" defaultChecked={s.email.requireApproval} /> El primer correo de cada prospecto espera mi aprobación (en Hoy)
        </label>
        <label htmlFor="e_fromName">Nombre del remitente</label>
        <input id="e_fromName" name="e_fromName" defaultValue={s.email.fromName} />
        <span className="small">Calentamiento del dominio: correos nuevos por día</span>
        <div className="inline-fields">
          <label>Primera semana <input name="e_start" type="number" min={1} defaultValue={s.email.startDailyCap} /></label>
          <label>Aumento por semana <input name="e_increase" type="number" min={0} defaultValue={s.email.weeklyIncrease} /></label>
          <label>Máximo por día <input name="e_max" type="number" min={1} defaultValue={s.email.maxDailyCap} /></label>
        </div>
        <span className="small">Horario de envío (CDMX, lunes a viernes)</span>
        <div className="inline-fields">
          <label>Desde <input name="e_from" type="number" min={0} max={23} defaultValue={s.email.sendFrom} /></label>
          <label>Hasta <input name="e_to" type="number" min={1} max={24} defaultValue={s.email.sendTo} /></label>
        </div>
        <span className="small">Días entre correos del mismo hilo</span>
        <div className="inline-fields">
          <label>Correo 1 → 2 <input name="e_fu1" type="number" min={1} defaultValue={s.email.followUpDays[0]} /></label>
          <label>Correo 2 → 3 <input name="e_fu2" type="number" min={1} defaultValue={s.email.followUpDays[1]} /></label>
        </div>
        <label htmlFor="e_footer">Pie del correo (para EE.UU. la ley pide incluir una dirección postal)</label>
        <textarea id="e_footer" name="e_footer" rows={3} defaultValue={s.email.footer} />
      </fieldset>

      <fieldset>
        <legend>Aprendizaje</legend>
        <label className="check">
          <input type="checkbox" name="l_active" defaultChecked={s.learning.active} /> Ajustar solo a quién buscar y cómo escribir según las respuestas
        </label>
        <span className="small muted">Reparte los prospectos del día hacia la búsqueda que más respuestas consigue (desde 20 contactados) y le da al redactor los correos que sí obtuvieron respuesta.</span>
      </fieldset>

      <fieldset>
        <legend>Contenido en redes</legend>
        <label className="check">
          <input type="checkbox" name="c_active" defaultChecked={s.content.active} /> Generar la semana automáticamente cada viernes
        </label>
        <div className="inline-fields">
          <label className="check"><input type="checkbox" name="c_ch_linkedin" defaultChecked={s.content.channels.includes("linkedin_personal")} /> LinkedIn</label>
          <label className="check"><input type="checkbox" name="c_ch_instagram" defaultChecked={s.content.channels.includes("instagram")} /> Instagram</label>
        </div>
        <span className="small">Días de publicación</span>
        <div className="inline-fields">
          {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d, i) => (
            <label key={d} className="check"><input type="checkbox" name={`c_day_${i}`} defaultChecked={s.content.days.includes(i)} /> {d}</label>
          ))}
        </div>
        <label htmlFor="c_hour">Hora de publicación (CDMX, 0 a 23)</label>
        <input id="c_hour" name="c_hour" type="number" min={0} max={23} defaultValue={s.content.hour} />
        <label htmlFor="c_pillars">Temas (uno por línea; rotan en orden)</label>
        <textarea id="c_pillars" name="c_pillars" rows={5} defaultValue={s.content.pillars.join("\n")} />
        <label htmlFor="c_langs">Idiomas (se alternan en orden: es, en)</label>
        <input id="c_langs" name="c_langs" defaultValue={s.content.languages.join(", ")} />
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" name="r_active" defaultChecked={s.content.reels.active} /> Reels de Instagram (texto animado con música)
        </label>
        <span className="small">Días de reel</span>
        <div className="inline-fields">
          {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d, i) => (
            <label key={d} className="check"><input type="checkbox" name={`r_day_${i}`} defaultChecked={s.content.reels.days.includes(i)} /> {d}</label>
          ))}
        </div>
        <label htmlFor="r_hour">Hora del reel (CDMX, 0 a 23)</label>
        <input id="r_hour" name="r_hour" type="number" min={0} max={23} defaultValue={s.content.reels.hour} />
      </fieldset>

      <div>
        <button type="submit" disabled={pending}>{pending ? "Guardando…" : "Guardar configuración"}</button>
      </div>
      {state && <p className={state.ok ? "alert alert-ok" : "alert alert-error"}>{state.message}</p>}
    </form>
  );
}
