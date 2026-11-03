import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Configuración del motor. Se guarda en la tabla settings (clave "growth").
// Si no existe, se usan los valores por defecto de abajo.

export type Search = {
  key: string;            // identificador estable de la búsqueda
  label: string;          // nombre visible
  technologies: string[]; // UIDs de tecnologías Apollo (cualquiera de)
  industries: string[];   // nombres exactos de industria Apollo, en minúsculas
};

export type GrowthSettings = {
  active: boolean;              // apaga/prende el motor diario
  dailyLimit: number;           // prospectos nuevos por día (cada uno cuesta ~1 crédito Apollo)
  titles: string[];             // palabras clave del puesto
  seniorities: string[];        // niveles Apollo
  locations: string[];          // países de la persona
  minEmployees: number;         // 0 = sin mínimo
  excludeTitleWords: string[];  // descarta si el puesto contiene alguna
  searches: Search[];           // se combinan con O: stack O sector
  tacitContext: string;         // qué es Tacit, para el redactor
  writingRules: string;         // reglas de estilo del redactor
  followUpDays: { mensaje: number; seguimiento_1: number; seguimiento_2: number };
  content: ContentSettings;
};

export type ContentSettings = {
  active: boolean;        // genera la semana automáticamente los viernes
  channels: ("instagram" | "linkedin_personal")[];
  days: number[];         // días de publicación (0=domingo … 6=sábado), hora CDMX
  hour: number;           // hora de publicación en CDMX
  pillars: string[];      // temas que rotan
  languages: ("es" | "en")[]; // se alternan en orden
};

export const DEFAULT_CONTENT: ContentSettings = {
  active: true,
  channels: ["linkedin_personal", "instagram"],
  days: [1, 3, 5],
  hour: 9,
  pillars: [
    "Conocimiento tácito: lo que la gente sabe y no está escrito, y qué se pierde cuando alguien se va",
    "Adopción de IA real: por qué fallan las implementaciones de agentes y cómo hacerlo bien",
    "Operación y eficiencia: cuellos de botella, decisiones y cómo opera de verdad una empresa",
    "Detrás de Tacit: lo que estamos construyendo y aprendizajes como fundador",
  ],
  languages: ["es", "en"],
};

export const DEFAULT_SETTINGS: GrowthSettings = {
  active: true,
  dailyLimit: 10,
  titles: [
    "operations", "operaciones", "COO", "CEO", "director general", "managing director",
    "human resources", "recursos humanos", "people", "talent", "CTO", "transformation",
    "transformación", "innovation", "innovación",
  ],
  seniorities: ["c_suite", "vp", "head", "director"],
  locations: ["mexico", "united states"],
  minEmployees: 50,
  excludeTitleWords: ["intern", "becario", "assistant", "asistente", "student", "estudiante"],
  searches: [
    {
      key: "stack",
      label: "Usan el stack que Tacit conecta",
      technologies: ["slack", "google_apps", "gmail", "microsoft_office_365", "office_365", "zoom"],
      industries: [],
    },
    {
      key: "sector",
      label: "Servicios y tecnología",
      technologies: [],
      industries: [
        "information technology & services", "computer software", "management consulting",
        "marketing & advertising", "logistics & supply chain", "financial services",
        "accounting", "legal services", "staffing & recruiting", "internet",
      ],
    },
  ],
  tacitContext:
    "Tacit (tacit.guru) hace un diagnóstico de cómo opera realmente una empresa a partir del conocimiento " +
    "de su gente: quién sabe qué, dónde se toman las decisiones, dónde hay cuellos de botella e ineficiencias. " +
    "Con ese diagnóstico implementa agentes simples en los puntos clave de la operación y expande desde ahí, " +
    "para que la empresa adopte IA sin chocar con cómo trabaja hoy. Ideal para empresas que tienen interés y " +
    "presupuesto en IA pero no la capacidad operativa para una transformación real.",
  writingRules:
    "Tono natural y directo, como de persona a persona, nada corporativo ni de marketing. " +
    "Primero deja claro qué es Tacit en una frase. Sin exageraciones, sin promesas de cifras. " +
    "Sin guiones largos (—). Sin emojis. Una sola pregunta o llamada a la acción al final, ligera.",
  followUpDays: { mensaje: 3, seguimiento_1: 7, seguimiento_2: 7 },
  content: DEFAULT_CONTENT,
};

const KEY = "growth";

export async function getSettings(): Promise<GrowthSettings> {
  const db = createAdminClient();
  const { data, error } = await db.from("settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(`Error leyendo configuración: ${error.message}`);
  if (!data) return DEFAULT_SETTINGS;
  // Mezcla con los valores por defecto para que un campo nuevo nunca quede vacío
  const saved = data.value as Partial<GrowthSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    followUpDays: { ...DEFAULT_SETTINGS.followUpDays, ...(saved.followUpDays ?? {}) },
    content: { ...DEFAULT_CONTENT, ...(saved.content ?? {}) },
  };
}

export async function saveSettings(s: GrowthSettings) {
  const db = createAdminClient();
  const { error } = await db.from("settings").upsert({ key: KEY, value: s });
  if (error) throw new Error(`Error guardando configuración: ${error.message}`);
}

// Estado interno (páginas de Apollo ya recorridas, candado de ejecución)
export async function getState<T>(key: string, fallback: T): Promise<T> {
  const db = createAdminClient();
  const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`Error leyendo estado ${key}: ${error.message}`);
  return (data?.value as T) ?? fallback;
}

export async function setState(key: string, value: unknown) {
  const db = createAdminClient();
  const { error } = await db.from("settings").upsert({ key, value });
  if (error) throw new Error(`Error guardando estado ${key}: ${error.message}`);
}

// Convierte "a, b,  c" en ["a","b","c"]
export function parseList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
