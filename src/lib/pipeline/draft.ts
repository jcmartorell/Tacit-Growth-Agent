import "server-only";
import { generateJson } from "@/lib/llm";
import type { GrowthSettings } from "@/lib/settings";
import type { EnrichedPerson } from "@/lib/apollo";

// Agente redactor: con los datos de Apollo arma el ángulo y los 4 mensajes de LinkedIn.
// No navega la web: solo usa lo que Apollo sabe de la persona y su empresa.

export const INVITE_MAX = 200; // límite seguro de nota de invitación en LinkedIn

export type Draft = {
  angulo: string;
  invitacion: string;
  mensaje: string;
  seguimiento_1: string;
  seguimiento_2: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["angulo", "invitacion", "mensaje", "seguimiento_1", "seguimiento_2"],
  properties: {
    angulo: { type: "string", description: "1-2 frases: por qué Tacit le sirve a esta persona/empresa, basado solo en los datos" },
    invitacion: { type: "string", description: `Nota de invitación de LinkedIn, máximo ${INVITE_MAX} caracteres` },
    mensaje: { type: "string", description: "Primer mensaje tras aceptar la invitación, máximo 600 caracteres" },
    seguimiento_1: { type: "string", description: "Seguimiento corto si no responde, máximo 350 caracteres" },
    seguimiento_2: { type: "string", description: "Último seguimiento, cierre amable, máximo 250 caracteres" },
  },
};

// Limpieza determinística de estilo
export function clean(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// Recorta en el último fin de frase o espacio antes del límite
export function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (lastStop > max * 0.5) return cut.slice(0, lastStop + 1).trim();
  return cut.slice(0, cut.lastIndexOf(" ")).trim();
}

function profile(p: EnrichedPerson) {
  return [
    `Nombre: ${p.fullName}`,
    `Puesto: ${p.title ?? "desconocido"}`,
    p.headline ? `Titular de LinkedIn: ${p.headline}` : null,
    `Empresa: ${p.companyName ?? "desconocida"}`,
    p.industry ? `Industria: ${p.industry}` : null,
    p.companySize ? `Empleados aprox.: ${p.companySize}` : null,
    p.country ? `País: ${p.country}` : null,
    p.companyDescription ? `Descripción de la empresa: ${p.companyDescription}` : null,
    p.companyKeywords.length ? `Palabras clave: ${p.companyKeywords.join(", ")}` : null,
    p.technologies.length ? `Herramientas que usa la empresa: ${p.technologies.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function draftMessages(p: EnrichedPerson, lang: "es" | "en", s: GrowthSettings): Promise<Draft> {
  const system = [
    "Eres quien redacta la prospección en LinkedIn del fundador de Tacit, Juan Carlos Martorell.",
    "Escribes en primera persona, como él.",
    `Qué es Tacit: ${s.tacitContext}`,
    `Reglas de estilo: ${s.writingRules}`,
    "Nunca inventes datos sobre la persona o su empresa: usa solo lo que viene en el perfil. Si un dato no está, no lo menciones.",
    "Menciona el nombre de pila de la persona. No uses frases como 'vi tu perfil' ni halagos genéricos.",
    lang === "es" ? "Escribe todo en español de México." : "Write everything in natural US English.",
  ].join("\n\n");

  const prompt = `Perfil del prospecto:\n${profile(p)}\n\nRedacta el ángulo y los cuatro mensajes. La invitación debe tener máximo ${INVITE_MAX} caracteres contando espacios.`;

  const detail = { prospect: p.fullName, company: p.companyName };
  let d = await generateJson<Draft>({ agent: "redactor", system, prompt, schema: SCHEMA, maxTokens: 1500, detail });

  // Si la invitación se pasa del límite, se pide una sola corrección
  if (clean(d.invitacion).length > INVITE_MAX) {
    const retry = await generateJson<Draft>({
      agent: "redactor",
      system,
      prompt: `${prompt}\n\nTu invitación anterior tenía ${d.invitacion.length} caracteres. Reescríbela con máximo ${INVITE_MAX - 20}. Devuelve los cinco campos.`,
      schema: SCHEMA,
      maxTokens: 1500,
      detail: { ...detail, retry: true },
    });
    d = { ...d, invitacion: retry.invitacion };
  }

  return {
    angulo: clean(d.angulo),
    invitacion: fit(clean(d.invitacion), INVITE_MAX),
    mensaje: fit(clean(d.mensaje), 800),
    seguimiento_1: fit(clean(d.seguimiento_1), 500),
    seguimiento_2: fit(clean(d.seguimiento_2), 400),
  };
}
