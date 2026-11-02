import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

// Llamadas a Claude con registro automático de tokens y costo en agent_runs.

// Precio por millón de tokens (USD), según la documentación oficial de Anthropic
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export const WRITER_MODEL = "claude-sonnet-5-5";

let client: Anthropic | null = null;
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !key.trim()) throw new Error("Falta la variable de entorno ANTHROPIC_API_KEY.");
  if (!client) {
    client = new Anthropic({
      apiKey: key.trim(),
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
      timeout: 90_000,
      maxRetries: 2,
    });
  }
  return client;
}

export function costUsd(model: string, input: number, output: number) {
  const p = PRICES[model];
  if (!p) return 0;
  return (input * p.input + output * p.output) / 1_000_000;
}

async function logRun(row: {
  agent: string; model: string; status: "ok" | "error";
  input_tokens: number; output_tokens: number; cost_usd: number;
  detail: Record<string, unknown>; started_at: string;
}) {
  const db = createAdminClient();
  const { error } = await db.from("agent_runs").insert({ ...row, finished_at: new Date().toISOString() });
  if (error) console.error("[llm] no se pudo registrar agent_run:", error.message);
}

// Pide a Claude una respuesta JSON que cumpla el esquema dado.
export async function generateJson<T>(opts: {
  agent: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  detail?: Record<string, unknown>;
}): Promise<T> {
  const started = new Date().toISOString();
  const model = WRITER_MODEL;
  try {
    const res = await getClient().messages.create({
      model,
      max_tokens: opts.maxTokens ?? 2000,
      system: opts.system,
      messages: [{ role: "user", content: opts.prompt }],
      // Esfuerzo bajo y sin razonamiento previo: tarea de redacción corta, más barata
      output_config: { effort: "low", format: { type: "json_schema", schema: opts.schema } },
      thinking: { type: "between_tools" },
    });
    const input = res.usage?.input_tokens ?? 0;
    const output = res.usage?.output_tokens ?? 0;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(`Respuesta no es JSON válido: ${text.slice(0, 200)}`);
    }
    await logRun({
      agent: opts.agent, model, status: "ok", input_tokens: input, output_tokens: output,
      cost_usd: costUsd(model, input, output), detail: opts.detail ?? {}, started_at: started,
    });
    return parsed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logRun({
      agent: opts.agent, model, status: "error", input_tokens: 0, output_tokens: 0, cost_usd: 0,
      detail: { ...(opts.detail ?? {}), error: message }, started_at: started,
    });
    throw e;
  }
}
