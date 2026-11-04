import "server-only";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJson } from "@/lib/llm";
import type { GrowthSettings } from "@/lib/settings";
import { nextSlots } from "@/lib/time";
import { typographic } from "@/lib/typography";
import { resolveVisuals, VISUAL_KEYS, VISUALS_INFO } from "@/lib/content/visuals";
import { spanishRatio, type GenerateSummary, type PostMeta } from "@/lib/content/generate";

// Agente de guiones de reels: un reel por cada horario configurado (por defecto diario).
// El video se genera después (render.ts) y se guarda en Supabase Storage.

type ReelGen = {
  tema: string; gancho: string; idea_1: string; idea_2: string; idea_3: string; cierre: string; caption: string;
  visual_gancho: string; visual_1: string; visual_2: string; visual_3: string;
};

// Formatos de concepto: rotan para que cada reel se piense distinto
const FORMATS = [
  "Mito contra realidad: el gancho enuncia una creencia común de los directivos; las ideas la desmontan.",
  "Pregunta incómoda: el gancho es una pregunta que un director no puede contestar con certeza hoy.",
  "Antes y después: cómo se ve la operación sin visibilidad y cómo se ve con ella.",
  "Error común: un error frecuente de las empresas, por qué pasa y qué hacer en su lugar.",
  "Escena cotidiana: una situación concreta del día a día (alguien pregunta en qué quedó algo, alguien renuncia, una junta de seguimiento) y lo que revela.",
  "Manual contra realidad: lo que dice el proceso escrito frente a lo que la gente hace de verdad.",
  "Costo oculto: algo que parece normal y en realidad cuesta tiempo o dinero, sin inventar cifras.",
  "Señales: tres señales de que una empresa depende de lo que nadie escribió.",
];

const visualField = (d: string) => ({
  type: "string",
  enum: VISUAL_KEYS,
  description: `${d}. Opciones: ${VISUAL_KEYS.map((k) => `${k} = ${VISUALS_INFO[k]}`).join("; ")}`,
});

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tema", "gancho", "idea_1", "idea_2", "idea_3", "cierre", "caption", "visual_gancho", "visual_1", "visual_2", "visual_3"],
  properties: {
    tema: { type: "string", description: "Título interno, máximo 80 caracteres" },
    gancho: { type: "string", description: "Frase que detiene el scroll en el primer segundo: 3 a 7 palabras, provocadora pero cierta" },
    idea_1: { type: "string", description: "Primera idea corta y concreta, 5 a 10 palabras" },
    idea_2: { type: "string", description: "Segunda idea corta y concreta, 5 a 10 palabras" },
    idea_3: { type: "string", description: "Tercera idea corta y concreta, 5 a 10 palabras" },
    cierre: { type: "string", description: "Cierre de 3 a 8 palabras que invite a pensar o actuar" },
    caption: { type: "string", description: "Caption de Instagram, 150 a 500 caracteres, con 3 a 5 hashtags al final" },
    visual_gancho: visualField("Animación que acompaña al gancho"),
    visual_1: visualField("Animación que ilustra la idea 1"),
    visual_2: visualField("Animación que ilustra la idea 2"),
    visual_3: visualField("Animación que ilustra la idea 3"),
  },
};

const clean = (t: string) => typographic(String(t ?? "")).replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
const limitWords = (t: string, n: number) => clean(t).split(" ").slice(0, n).join(" ");

export async function generateReels(s: GrowthSettings): Promise<GenerateSummary> {
  const r = s.content.reels;
  const sum: GenerateSummary = { creados: 0, horarios: 0, errores: [] };
  if (!r.active || r.days.length === 0 || !s.content.channels.includes("instagram")) return sum;

  const slots = nextSlots(r.days, r.hour, new Date());
  sum.horarios = slots.length;
  if (slots.length === 0) return sum;

  const db = createAdminClient();
  const { data: existing, error } = await db
    .from("posts")
    .select("scheduled_at, metrics, topic")
    .eq("channel", "instagram")
    .neq("status", "descartado")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Leer reels: ${error.message}`);
  const reels = (existing ?? []).filter((p) => (p.metrics as { meta?: PostMeta } | null)?.meta?.format === "reel");
  const taken = new Set(reels.map((p) => new Date(p.scheduled_at as string).toISOString()));
  const recentTopics = [...new Set(reels.map((p) => p.topic).filter(Boolean))].slice(0, 30);
  const recentVisuals = reels.slice(0, 3).map((p) => ((p.metrics as { meta?: PostMeta } | null)?.meta?.reel?.visuals ?? []).join(", ")).filter(Boolean);
  let counter = reels.length;

  for (const slot of slots) {
    if (taken.has(slot.toISOString())) continue;
    const pillar = s.content.pillars[counter % Math.max(1, s.content.pillars.length)] ?? "Tacit";
    const lang = s.content.languages[counter % Math.max(1, s.content.languages.length)] ?? "es";
    const format = FORMATS[counter % FORMATS.length];
    const theme: "light" | "dark" = counter % 2 === 0 ? "light" : "dark";
    counter += 1;

    const langRule = lang === "es"
      ? "IDIOMA OBLIGATORIO: español de México en todos los campos."
      : "MANDATORY LANGUAGE: natural US English in every field, even though these instructions are in Spanish.";
    const system = [
      langRule,
      "Escribes guiones de reels de Instagram para Tacit, la empresa de Juan Carlos Martorell.",
      `Qué es Tacit: ${s.tacitContext}`,
      "Formato: texto animado en pantalla, sin voz. Se lee en 15 segundos: gancho, tres ideas y cierre.",
      "El gancho debe detener el scroll: concreto y sorprendente sobre cómo operan las empresas, nunca genérico.",
      "Para cada parte eliges una animación distinta que ilustre exactamente lo que dice el texto; no repitas animación dentro del mismo reel.",
      "Cada idea es una frase corta que se entiende sola. Nada de clichés, emojis ni signos de exclamación.",
      "No inventes cifras ni clientes.",
      s.content.guide ? `Indicaciones de Juan Carlos para los textos (tienen prioridad): ${s.content.guide}` : "",
      r.guide ? `Indicaciones específicas para reels (tienen prioridad): ${r.guide}` : "",
      langRule,
    ].filter(Boolean).join("\n\n");
    const prompt = [
      `Eje temático: ${pillar}`,
      `Formato de este reel: ${format}`,
      recentVisuals.length ? `Animaciones de los últimos reels (usa otras combinaciones):\n- ${recentVisuals.join("\n- ")}` : "",
      recentTopics.length ? `Temas de reels anteriores, no los repitas:\n- ${recentTopics.join("\n- ")}` : "",
      "Escribe el guion del reel.",
    ].filter(Boolean).join("\n\n");

    try {
      const ask = (extra = "") => generateJson<ReelGen>({
        agent: "reels", system, prompt: prompt + extra, schema: SCHEMA, maxTokens: 1200,
        detail: { pillar, lang, slot: slot.toISOString(), retry: Boolean(extra) },
      });
      const ok = (g: ReelGen) => {
        const ratio = spanishRatio(`${g.gancho} ${g.idea_1} ${g.idea_2} ${g.idea_3} ${g.caption}`);
        return lang === "es" ? ratio > 0.1 : ratio < 0.06;
      };
      let g = await ask();
      if (!ok(g)) {
        g = await ask(`\n\nTu respuesta anterior estaba en el idioma equivocado. ${langRule}`);
        if (!ok(g)) throw new Error(`El agente no respetó el idioma (${lang}).`);
      }
      const ideas = [g.idea_1, g.idea_2, g.idea_3].map((i) => limitWords(i, 14)).filter(Boolean);
      if (!g.gancho || ideas.length < 3 || !g.cierre) throw new Error("Guion incompleto.");

      const seed = Math.floor(Math.random() * 1000);
      const meta: PostMeta = {
        group: randomUUID(),
        lang,
        pillar,
        headline: "",
        subline: "",
        format: "reel",
        reel: {
          hook: limitWords(g.gancho, 9),
          points: ideas,
          cta: limitWords(g.cierre, 10),
          seed,
          visuals: resolveVisuals(seed, [g.visual_gancho, g.visual_1, g.visual_2, g.visual_3]),
          theme,
          format: format.split(":")[0],
        },
      };
      const ins = await db.from("posts").insert({
        channel: "instagram",
        topic: clean(g.tema).slice(0, 120),
        body: String(g.caption ?? "").replace(/\s*[—–]\s*/g, ", ").trim().slice(0, 2100),
        status: "borrador",
        scheduled_at: slot.toISOString(),
        metrics: { meta },
      });
      if (ins.error) throw new Error(ins.error.message);
      sum.creados += 1;
      recentVisuals.unshift((meta.reel?.visuals ?? []).join(", "));
      recentVisuals.splice(3);
    } catch (e) {
      sum.errores.push(`Reel ${slot.toISOString()}: ${(e as Error).message}`);
    }
  }
  return sum;
}
