import "server-only";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJson } from "@/lib/llm";
import type { GrowthSettings } from "@/lib/settings";
import { nextSlots } from "@/lib/time";
import { spanishRatio, type GenerateSummary, type PostMeta } from "@/lib/content/generate";

// Agente de guiones de reels: un reel por cada horario configurado (por defecto diario).
// El video se genera después (render.ts) y se guarda en Supabase Storage.

type ReelGen = { tema: string; gancho: string; idea_1: string; idea_2: string; idea_3: string; cierre: string; caption: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tema", "gancho", "idea_1", "idea_2", "idea_3", "cierre", "caption"],
  properties: {
    tema: { type: "string", description: "Título interno, máximo 80 caracteres" },
    gancho: { type: "string", description: "Frase que detiene el scroll en el primer segundo: 3 a 7 palabras, provocadora pero cierta" },
    idea_1: { type: "string", description: "Primera idea corta y concreta, 5 a 10 palabras" },
    idea_2: { type: "string", description: "Segunda idea corta y concreta, 5 a 10 palabras" },
    idea_3: { type: "string", description: "Tercera idea corta y concreta, 5 a 10 palabras" },
    cierre: { type: "string", description: "Cierre de 3 a 8 palabras que invite a pensar o actuar" },
    caption: { type: "string", description: "Caption de Instagram, 150 a 500 caracteres, con 3 a 5 hashtags al final" },
  },
};

const clean = (t: string) => String(t ?? "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
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
  let counter = reels.length;

  for (const slot of slots) {
    if (taken.has(slot.toISOString())) continue;
    const pillar = s.content.pillars[counter % Math.max(1, s.content.pillars.length)] ?? "Tacit";
    const lang = s.content.languages[counter % Math.max(1, s.content.languages.length)] ?? "es";
    counter += 1;

    const langRule = lang === "es"
      ? "IDIOMA OBLIGATORIO: español de México en todos los campos."
      : "MANDATORY LANGUAGE: natural US English in every field, even though these instructions are in Spanish.";
    const system = [
      langRule,
      "Escribes guiones de reels de Instagram para Tacit, la empresa de Juan Carlos Martorell.",
      `Qué es Tacit: ${s.tacitContext}`,
      "Formato: texto animado en pantalla, sin voz. Se lee en 15 segundos: gancho, tres ideas y cierre.",
      "El gancho debe detener el scroll: una afirmación concreta y sorprendente sobre cómo operan las empresas, no una pregunta genérica.",
      "Cada idea es una frase corta que se entiende sola. Nada de clichés, emojis ni signos de exclamación.",
      "No inventes cifras ni clientes.",
      s.content.guide ? `Indicaciones de Juan Carlos para los textos (tienen prioridad): ${s.content.guide}` : "",
      r.guide ? `Indicaciones específicas para reels (tienen prioridad): ${r.guide}` : "",
      langRule,
    ].filter(Boolean).join("\n\n");
    const prompt = [
      `Eje temático: ${pillar}`,
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
          seed: Math.floor(Math.random() * 1000),
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
    } catch (e) {
      sum.errores.push(`Reel ${slot.toISOString()}: ${(e as Error).message}`);
    }
  }
  return sum;
}
