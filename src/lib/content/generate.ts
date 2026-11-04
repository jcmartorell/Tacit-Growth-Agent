import "server-only";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJson } from "@/lib/llm";
import { getSettings, type GrowthSettings } from "@/lib/settings";
import { nextSlots } from "@/lib/time";
import { generateReels } from "@/lib/content/reel-gen";

// Agente de contenido: para cada horario libre de la semana genera un tema
// y sus versiones para LinkedIn e Instagram (texto + textos de la imagen).

export type PostMeta = {
  group: string;      // mismo id para las versiones LinkedIn/Instagram del mismo tema
  lang: "es" | "en";
  pillar: string;
  headline: string;   // título de la imagen
  subline: string;    // subtítulo de la imagen
  format?: "image" | "reel";
  reel?: { hook: string; points: string[]; cta: string; seed: number };
  containerId?: string; // contenedor de Instagram en proceso (reels)
  renderedAt?: string;
};

type Gen = {
  tema: string;
  linkedin: string;
  instagram: string;
  imagen_titulo: string;
  imagen_subtitulo: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tema", "linkedin", "instagram", "imagen_titulo", "imagen_subtitulo"],
  properties: {
    tema: { type: "string", description: "Título interno del tema, máximo 80 caracteres" },
    linkedin: { type: "string", description: "Post de LinkedIn, 600 a 1200 caracteres" },
    instagram: { type: "string", description: "Caption de Instagram, 300 a 900 caracteres, con 3 a 5 hashtags al final" },
    imagen_titulo: { type: "string", description: "Frase central de la imagen, máximo 70 caracteres" },
    imagen_subtitulo: { type: "string", description: "Línea de apoyo de la imagen, máximo 110 caracteres" },
  },
};

// Revisión determinística de idioma: proporción de palabras muy comunes del español
const ES_WORDS = new Set(["que", "de", "la", "el", "los", "las", "una", "para", "con", "por", "se", "es", "en", "del", "lo", "su", "como", "pero", "más", "y"]);
export function spanishRatio(text: string): number {
  const words = text.toLowerCase().match(/[a-záéíóúñü]+/g) ?? [];
  if (words.length === 0) return 0;
  return words.filter((w) => ES_WORDS.has(w)).length / words.length;
}
export function languageOk(g: Gen, lang: "es" | "en"): boolean {
  const r = spanishRatio(`${g.linkedin} ${g.instagram} ${g.imagen_titulo}`);
  return lang === "es" ? r > 0.12 : r < 0.06;
}

const clean = (t: string) => t.replace(/\s*[—–]\s*/g, ", ").trim();
const cut = (t: string, max: number) => (t.length <= max ? t : t.slice(0, t.lastIndexOf(" ", max)).trim());

export type GenerateSummary = { creados: number; horarios: number; errores: string[] };

export async function generateUpcoming(settings?: GrowthSettings): Promise<GenerateSummary> {
  const s = settings ?? (await getSettings());
  const posts = await generatePosts(s);
  const reels = await generateReels(s).catch((e) => ({ creados: 0, horarios: 0, errores: [`Reels: ${(e as Error).message}`] }));
  return {
    creados: posts.creados + reels.creados,
    horarios: posts.horarios + reels.horarios,
    errores: [...posts.errores, ...reels.errores],
  };
}

async function generatePosts(s: GrowthSettings): Promise<GenerateSummary> {
  const c = s.content;
  const db = createAdminClient();
  const summary: GenerateSummary = { creados: 0, horarios: 0, errores: [] };
  if (c.channels.length === 0 || c.days.length === 0) return summary;

  const slots = nextSlots(c.days, c.hour, new Date());
  summary.horarios = slots.length;
  if (slots.length === 0) return summary;

  // Horarios que ya tienen post (cualquier estado excepto descartado) no se vuelven a llenar
  const { data: taken, error } = await db
    .from("posts")
    .select("scheduled_at, metrics")
    .in("scheduled_at", slots.map((d) => d.toISOString()))
    .neq("status", "descartado");
  if (error) throw new Error(`Leer posts: ${error.message}`);
  const takenSet = new Set(
    (taken ?? [])
      .filter((r) => (r.metrics as { meta?: PostMeta } | null)?.meta?.format !== "reel")
      .map((r) => new Date(r.scheduled_at as string).toISOString()),
  );

  // Rotación: cuántos temas se han generado en total define el siguiente tema e idioma
  const { data: recent, error: e2 } = await db
    .from("posts")
    .select("topic, metrics, created_at")
    .order("created_at", { ascending: false })
    .limit(60);
  if (e2) throw new Error(`Leer temas: ${e2.message}`);
  const groups = new Set((recent ?? []).map((r) => (r.metrics as { meta?: PostMeta } | null)?.meta?.group).filter(Boolean));
  let counter = groups.size;
  const recentTopics = [...new Set((recent ?? []).map((r) => r.topic).filter(Boolean))].slice(0, 25);

  for (const slot of slots) {
    if (takenSet.has(slot.toISOString())) continue;
    const pillar = c.pillars[counter % Math.max(1, c.pillars.length)] ?? "Tacit";
    const lang = c.languages[counter % Math.max(1, c.languages.length)] ?? "es";
    counter += 1;

    const langRule = lang === "es"
      ? "IDIOMA OBLIGATORIO: español de México. Todos los campos van en español."
      : "MANDATORY LANGUAGE: US English. Every field (tema, linkedin, instagram, imagen_titulo, imagen_subtitulo) must be written in natural US English, even though these instructions are in Spanish. Do not write any Spanish.";
    const system = [
      langRule,
      "Escribes el contenido de redes de Juan Carlos Martorell, fundador de Tacit, en primera persona.",
      `Qué es Tacit: ${s.tacitContext}`,
      `Reglas de estilo: ${s.writingRules}`,
      "Contenido de valor real para directivos de operaciones, RH y tecnología de empresas medianas y grandes.",
      "Nada de clichés de LinkedIn, ni listas de emojis, ni frases motivacionales vacías. Una idea clara por post.",
      "No inventes cifras, clientes ni casos. Si das un ejemplo, que sea claramente ilustrativo.",
      "Menciona a Tacit solo si viene natural; la mayoría de los posts deben aportar valor sin vender.",
      langRule,
    ].join("\n\n");
    const prompt = [
      `Tema de esta semana: ${pillar}`,
      recentTopics.length ? `Temas ya publicados, no los repitas:\n- ${recentTopics.join("\n- ")}` : "",
      "Genera un tema concreto dentro de ese eje, el post de LinkedIn, el caption de Instagram y los textos de la imagen.",
      "La primera línea del post de LinkedIn debe enganchar por sí sola.",
      langRule,
    ].filter(Boolean).join("\n\n");

    try {
      const ask = (extra = "") =>
        generateJson<Gen>({
          agent: "contenido", system, prompt: prompt + extra, schema: SCHEMA, maxTokens: 2500,
          detail: { pillar, lang, slot: slot.toISOString(), retry: Boolean(extra) },
        });
      let g = await ask();
      if (!languageOk(g, lang)) {
        g = await ask(`\n\nTu respuesta anterior estaba en el idioma equivocado. ${langRule}`);
        if (!languageOk(g, lang)) throw new Error(`El agente no respetó el idioma (${lang}); no se guardó.`);
      }
      const meta: PostMeta = {
        group: randomUUID(),
        lang,
        pillar,
        headline: cut(clean(g.imagen_titulo), 90),
        subline: cut(clean(g.imagen_subtitulo), 140),
      };
      const rows = c.channels.map((channel) => ({
        channel,
        topic: cut(clean(g.tema), 120),
        body: channel === "instagram" ? cut(clean(g.instagram), 2100) : cut(clean(g.linkedin), 2900),
        status: "borrador",
        scheduled_at: slot.toISOString(),
        metrics: { meta },
      }));
      const ins = await db.from("posts").insert(rows);
      if (ins.error) throw new Error(ins.error.message);
      summary.creados += rows.length;
    } catch (e) {
      summary.errores.push(`${slot.toISOString()}: ${(e as Error).message}`);
    }
  }
  return summary;
}
