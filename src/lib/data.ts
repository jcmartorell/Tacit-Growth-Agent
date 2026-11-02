import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Consultas de lectura del panel. Si Supabase falla, se lanza un error con
// el nombre de la tabla para que sea fácil saber qué revisar.

function fail(table: string, message: string): never {
  throw new Error(`Error leyendo "${table}": ${message}`);
}

export async function countBy(table: "prospects" | "posts", status: string) {
  const db = createAdminClient();
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("status", status);
  if (error) fail(table, error.message);
  return count ?? 0;
}

export async function countAll(table: "prospects" | "posts" | "outreach_messages") {
  const db = createAdminClient();
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) fail(table, error.message);
  return count ?? 0;
}

// Costo de LLM del mes en curso (hora de Ciudad de México)
export async function monthCostUsd() {
  const db = createAdminClient();
  const now = new Date();
  const mx = new Date(now.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  // Inicio de mes en CDMX = día 1 00:00 a UTC-6 (México no usa horario de verano desde 2022)
  const start = new Date(Date.UTC(mx.getFullYear(), mx.getMonth(), 1, 6, 0, 0));
  const { data, error } = await db
    .from("agent_runs")
    .select("cost_usd")
    .gte("started_at", start.toISOString());
  if (error) fail("agent_runs", error.message);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

export async function listProspects() {
  const db = createAdminClient();
  const { data, error } = await db
    .from("prospects")
    .select("id, full_name, title, company_name, company_size, country, status, discard_reason, linkedin_url, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("prospects", error.message);
  return data ?? [];
}

export async function listPosts() {
  const db = createAdminClient();
  const { data, error } = await db
    .from("posts")
    .select("id, channel, topic, status, scheduled_at, published_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) fail("posts", error.message);
  return data ?? [];
}

export async function listAgentRuns() {
  const db = createAdminClient();
  const { data, error } = await db
    .from("agent_runs")
    .select("id, agent, model, status, input_tokens, output_tokens, cost_usd, started_at")
    .order("started_at", { ascending: false })
    .limit(100);
  if (error) fail("agent_runs", error.message);
  return data ?? [];
}

export function fmtDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "short",
    timeStyle: "short",
  });
}

// Últimas corridas del motor (agente "motor")
export async function listMotorRuns(limit = 10) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("agent_runs")
    .select("id, status, detail, started_at, finished_at")
    .eq("agent", "motor")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) fail("agent_runs", error.message);
  return data ?? [];
}

// Qué variables de entorno están configuradas (solo sí/no, nunca el valor)
export function envStatus() {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.trim());
  return {
    APOLLO_API_KEY: has("APOLLO_API_KEY"),
    ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY"),
    CRON_SECRET: has("CRON_SECRET"),
  };
}
