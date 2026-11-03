import "server-only";
import { generateJson } from "@/lib/llm";
import type { GrowthSettings } from "@/lib/settings";
import type { EnrichedPerson } from "@/lib/apollo";

// Agente redactor: con los datos de Apollo arma el ángulo, los 4 mensajes de LinkedIn
// y la secuencia de 3 correos.
// No navega la web: solo usa lo que Apollo sabe de la persona y su empresa.

export const INVITE_MAX = 200; // límite seguro de nota de invitación en LinkedIn

export type Draft = {
  angulo: string;
  invitacion: string;
  mensaje: string;
  seguimiento_1: string;
  seguimiento_2: string;
  asunto: string;
  correo_1: string;
  correo_2: string;
  correo_3: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["angulo", "invitacion", "mensaje", "seguimiento_1", "seguimiento_2", "asunto", "correo_1", "correo_2", "correo_3"],
  properties: {
    angulo: { type: "string", description: "1-2 frases: por qué Tacit le sirve a esta persona/empresa, basado solo en los datos" },
    invitacion: { type: "string", description: `Nota de invitación de LinkedIn, máximo ${INVITE_MAX} caracteres` },
    mensaje: { type: "string", description: "Primer mensaje tras aceptar la invitación, máximo 600 caracteres" },
    seguimiento_1: { type: "string", description: "Seguimiento corto si no responde, máximo 350 caracteres" },
    seguimiento_2: { type: "string", description: "Último seguimiento, cierre amable, máximo 250 caracteres" },
    asunto: { type: "string", description: "Asunto del correo: 2 a 6 palabras, en minúsculas salvo nombres, sin signos de venta ni emojis" },
    correo_1: { type: "string", description: "Primer correo en frío: saludo con nombre de pila, 60 a 120 palabras, párrafos cortos, sin firma" },
    correo_2: { type: "string", description: "Seguimiento al correo 1 (va en el mismo hilo): 30 a 70 palabras, aporta un ángulo nuevo, sin firma" },
    correo_3: { type: "string", description: "Último correo del hilo: 20 a 50 palabras, cierre amable, sin firma" },
  },
};

// Limpieza determinística de estilo
export function clean(text: string | null | undefined): string {
  return String(text ?? "")
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

export async function draftMessages(
  p: EnrichedPerson,
  lang: "es" | "en",
  s: GrowthSettings,
  winners: string[] = [],
): Promise<Draft> {
  const langRule = lang === "es"
    ? "IDIOMA OBLIGATORIO: español de México en todos los campos."
    : "MANDATORY LANGUAGE: natural US English in every field, even though these instructions are in Spanish.";
  const system = [
    langRule,
    "Eres quien redacta la prospección por LinkedIn y por correo del fundador de Tacit, Juan Carlos Martorell.",
    "Escribes en primera persona, como él.",
    `Qué es Tacit: ${s.tacitContext}`,
    `Reglas de estilo: ${s.writingRules}`,
    "Nunca inventes datos sobre la persona o su empresa: usa solo lo que viene en el perfil. Si un dato no está, no lo menciones.",
    "Menciona el nombre de pila de la persona. No uses frases como 'vi tu perfil' ni halagos genéricos.",
    "Los correos no llevan firma ni pie: se agregan solos. No incluyas enlaces.",
    winners.length
      ? `Estos primeros correos SÍ obtuvieron respuesta. Aprende de su enfoque y tono, no los copies:\n---\n${winners.join("\n---\n")}\n---`
      : "",
    langRule,
  ].filter(Boolean).join("\n\n");

  const prompt = `Perfil del prospecto:\n${profile(p)}\n\nRedacta el ángulo, los cuatro mensajes de LinkedIn y los tres correos. La invitación debe tener máximo ${INVITE_MAX} caracteres contando espacios.`;

  const detail = { prospect: p.fullName, company: p.companyName };
  let d = await generateJson<Draft>({ agent: "redactor", system, prompt, schema: SCHEMA, maxTokens: 2500, detail });

  // Si la invitación se pasa del límite, se pide una sola corrección
  if (clean(d.invitacion).length > INVITE_MAX) {
    const retry = await generateJson<Draft>({
      agent: "redactor",
      system,
      prompt: `${prompt}\n\nTu invitación anterior tenía ${d.invitacion.length} caracteres. Reescríbela con máximo ${INVITE_MAX - 20}. Devuelve todos los campos.`,
      schema: SCHEMA,
      maxTokens: 2500,
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
    asunto: fit(clean(d.asunto).replace(/[\r\n]+/g, " "), 80),
    correo_1: fit(clean(d.correo_1), 1200),
    correo_2: fit(clean(d.correo_2), 700),
    correo_3: fit(clean(d.correo_3), 500),
  };
}
