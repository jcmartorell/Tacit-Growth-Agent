import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSchemaReady } from "@/lib/schema";
import type { GrowthSettings } from "@/lib/settings";

// Aprendizaje determinístico (sin LLM): tasa de respuesta con un modelo Beta-Binomial.
// Para cada grupo: a = 1 + respuestas, b = 1 + (contactados - respuestas).
// La media a/(a+b) se usa para repartir los prospectos del día entre búsquedas,
// con un piso de exploración para que ninguna búsqueda deje de probarse.

const CONTACTED = ["enviado", "respondio", "reunion", "cerrado"];
const REPLIED = new Set(["respondio", "reunion", "cerrado"]);
const MIN_DATA = 20; // con menos contactados, el reparto es parejo

export type Rate = { key: string; contacted: number; replied: number; mean: number; low: number; high: number };

function rate(key: string, contacted: number, replied: number): Rate {
  const a = 1 + replied;
  const b = 1 + contacted - replied;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  return { key, contacted, replied, mean, low: Math.max(0, mean - 1.645 * sd), high: Math.min(1, mean + 1.645 * sd) };
}

type Row = { status: string; industry: string | null; title: string | null; research: { source?: string; language?: string } | null };

async function contactedRows(): Promise<Row[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("prospects")
    .select("status, industry, title, research")
    .in("status", CONTACTED)
    .limit(5000);
  if (error) throw new Error(`Aprendizaje: ${error.message}`);
  return (data ?? []) as Row[];
}

function groupBy(rows: Row[], keyOf: (r: Row) => string): Rate[] {
  const m = new Map<string, { n: number; r: number }>();
  for (const row of rows) {
    const k = keyOf(row);
    const g = m.get(k) ?? { n: 0, r: 0 };
    g.n += 1;
    if (REPLIED.has(row.status)) g.r += 1;
    m.set(k, g);
  }
  return [...m.entries()].map(([k, g]) => rate(k, g.n, g.r)).sort((x, y) => y.mean - x.mean);
}

// Agrupa puestos en familias para que las cifras signifiquen algo
export function titleFamily(title: string | null): string {
  const t = (title ?? "").toLowerCase();
  if (/(ceo|director general|managing director|founder|fundador|presidente|owner|dueñ)/.test(t)) return "Dirección general";
  if (/(operaci|operation|coo|supply|logist)/.test(t)) return "Operaciones";
  if (/(human|recursos humanos|people|talent|rh\b|hr\b)/.test(t)) return "Personas / RH";
  if (/(cto|cio|tecnolog|technolog|it\b|sistemas|digital|innovac|innovation|transform)/.test(t)) return "Tecnología / Innovación";
  return "Otro";
}

export async function learningStats() {
  const rows = await contactedRows();
  const total = rate("Total", rows.length, rows.filter((r) => REPLIED.has(r.status)).length);
  return {
    total,
    bySearch: groupBy(rows, (r) => r.research?.source ?? "sin dato"),
    byIndustry: groupBy(rows, (r) => r.industry ?? "sin dato"),
    byTitle: groupBy(rows, (r) => titleFamily(r.title)),
    byLanguage: groupBy(rows, (r) => r.research?.language ?? "sin dato"),
  };
}

// Reparto del límite diario entre búsquedas. Devuelve fracciones que suman 1.
export async function searchShares(s: GrowthSettings, keys: string[]): Promise<Record<string, number>> {
  const equal = Object.fromEntries(keys.map((k) => [k, 1 / keys.length]));
  if (!s.learning.active || keys.length < 2) return equal;
  const rows = await contactedRows();
  if (rows.length < MIN_DATA) return equal;

  const rates = new Map(groupBy(rows, (r) => r.research?.source ?? "").map((x) => [x.key, x.mean]));
  const means = keys.map((k) => rates.get(k) ?? 0.5); // sin datos: optimista (exploración)
  const sum = means.reduce((a, b) => a + b, 0);
  const floor = Math.min(Math.max(s.learning.minExploreShare, 0), 1 / keys.length);
  const free = 1 - floor * keys.length;
  return Object.fromEntries(keys.map((k, i) => [k, floor + free * (sum > 0 ? means[i] / sum : 1 / keys.length)]));
}

// Primeros correos que obtuvieron respuesta, para que el redactor aprenda de ellos
export async function winningEmails(lang: "es" | "en", limit = 3): Promise<string[]> {
  if (!(await emailSchemaReady())) return [];
  const db = createAdminClient();
  const { data, error } = await db
    .from("outreach_messages")
    .select("body, sent_at, prospect:prospects!inner(status, research)")
    .eq("kind", "correo_1")
    .eq("status", "enviado")
    .in("prospect.status", [...REPLIED])
    .order("sent_at", { ascending: false })
    .limit(30);
  if (error) return [];
  return (data ?? [])
    .filter((m) => ((m.prospect as unknown as Row).research?.language ?? "es") === lang)
    .slice(0, limit)
    .map((m) => m.body as string);
}
