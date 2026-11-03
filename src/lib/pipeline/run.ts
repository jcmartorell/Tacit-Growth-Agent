import "server-only";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, getState, setState, type GrowthSettings, type Search } from "@/lib/settings";
import { enrichPeople, searchPeople, type EnrichedPerson } from "@/lib/apollo";
import { evaluate, languageFor } from "@/lib/pipeline/filter";
import { draftMessages } from "@/lib/pipeline/draft";
import { acquireLock, releaseLock } from "@/lib/lock";

// Motor diario completo:
// 1) Busca en Apollo (gratis) con cada búsqueda configurada (stack O sector)
// 2) Enriquece solo a los nuevos (cuesta créditos) hasta el límite diario
// 3) Filtra sin LLM y guarda
// 4) El agente redactor prepara los mensajes de los que pasaron

export type RunSummary = {
  status: "ok" | "skipped" | "error";
  reason?: string;
  searches: { key: string; total: number | null; page: number; nuevos: number }[];
  enriquecidos: number;
  descartados: number;
  redactados: number;
  errores: string[];
};

const LOCK_MINUTES = 15;
const MAX_PAGES_PER_SEARCH = 5;

type StoredProfile = Omit<EnrichedPerson, "raw">;

function filtersHash(s: GrowthSettings, search: Search) {
  const relevant = {
    titles: s.titles, seniorities: s.seniorities, locations: s.locations, minEmployees: s.minEmployees,
    technologies: search.technologies, industries: search.industries,
  };
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex").slice(0, 16);
}

async function existingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const db = createAdminClient();
  const { data, error } = await db.from("prospects").select("apollo_person_id").in("apollo_person_id", ids);
  if (error) throw new Error(`Error revisando duplicados: ${error.message}`);
  return new Set((data ?? []).map((r) => r.apollo_person_id as string));
}

// Paso 1: candidatos nuevos de una búsqueda, avanzando páginas guardadas
async function collect(s: GrowthSettings, search: Search, want: number, taken: Set<string>, summary: RunSummary) {
  const stateKey = `apollo_page_${search.key}`;
  const hash = filtersHash(s, search);
  const st = await getState<{ hash: string; page: number }>(stateKey, { hash, page: 1 });
  let page = st.hash === hash ? st.page : 1; // si cambió el perfil, empieza de nuevo
  const found: { id: string; source: string }[] = [];
  let total: number | null = null;

  for (let i = 0; i < MAX_PAGES_PER_SEARCH && found.length < want; i++) {
    const { hits, total: t } = await searchPeople(
      {
        titles: s.titles, seniorities: s.seniorities, locations: s.locations, minEmployees: s.minEmployees,
        technologies: search.technologies, industries: search.industries,
      },
      page,
    );
    total = t;
    if (hits.length === 0) {
      page = 1; // se acabaron los resultados: la próxima vez vuelve a empezar
      break;
    }
    const known = await existingIds(hits.map((h) => h.id));
    let consumedAll = true;
    for (const h of hits) {
      if (known.has(h.id) || taken.has(h.id)) continue;
      if (found.length >= want) {
        consumedAll = false; // quedan nuevos en esta página: la próxima corrida la vuelve a leer
        break;
      }
      taken.add(h.id);
      found.push({ id: h.id, source: search.key });
    }
    if (!consumedAll) break;
    page += 1;
  }

  await setState(stateKey, { hash, page });
  summary.searches.push({ key: search.key, total, page, nuevos: found.length });
  return found;
}

async function sourceProspects(s: GrowthSettings, summary: RunSummary) {
  const searches = s.searches.filter((x) => x.technologies.length > 0 || x.industries.length > 0);
  if (searches.length === 0) {
    summary.errores.push("No hay búsquedas configuradas con tecnologías o industrias.");
    return;
  }
  const taken = new Set<string>();
  const candidates: { id: string; source: string }[] = [];
  const perSearch = Math.ceil(s.dailyLimit / searches.length);

  for (const search of searches) {
    try {
      candidates.push(...(await collect(s, search, perSearch, taken, summary)));
    } catch (e) {
      summary.errores.push(`Búsqueda "${search.label}": ${(e as Error).message}`);
    }
  }
  const selected = candidates.slice(0, s.dailyLimit);
  if (selected.length === 0) return;

  const enriched = await enrichPeople(selected.map((c) => c.id));
  summary.enriquecidos = enriched.length;
  const sourceOf = new Map(selected.map((c) => [c.id, c.source]));

  const db = createAdminClient();
  for (const p of enriched) {
    const verdict = evaluate(p, { minEmployees: s.minEmployees, excludeTitleWords: s.excludeTitleWords, locations: s.locations });
    const { raw, ...profile } = p;
    void raw;
    const row = {
      apollo_person_id: p.id,
      full_name: p.fullName,
      title: p.title,
      company_name: p.companyName,
      company_domain: p.companyDomain,
      company_size: p.companySize,
      industry: p.industry,
      country: p.country,
      linkedin_url: p.linkedinUrl,
      status: verdict.ok ? "nuevo" : "descartado",
      discard_reason: verdict.ok ? null : verdict.reason,
      research: { source: sourceOf.get(p.id) ?? null, profile },
    };
    const { error } = await db.from("prospects").upsert(row, { onConflict: "apollo_person_id", ignoreDuplicates: true });
    if (error) summary.errores.push(`Guardar ${p.fullName}: ${error.message}`);
    else if (!verdict.ok) summary.descartados += 1;
  }
}

// Paso 4: redactar mensajes para prospectos en estado "nuevo"
async function draftPending(s: GrowthSettings, summary: RunSummary) {
  const db = createAdminClient();
  const { data, error } = await db
    .from("prospects")
    .select("id, full_name, research")
    .eq("status", "nuevo")
    .order("created_at", { ascending: true })
    .limit(s.dailyLimit * 2);
  if (error) {
    summary.errores.push(`Leer pendientes: ${error.message}`);
    return;
  }

  const queue = [...(data ?? [])];
  const worker = async () => {
    while (queue.length > 0) {
      const row = queue.shift()!;
      const research = (row.research ?? {}) as { profile?: StoredProfile; draft_errors?: number };
      const profile = research.profile;
      if (!profile) {
        await db.from("prospects").update({ status: "descartado", discard_reason: "Sin datos de perfil" }).eq("id", row.id);
        continue;
      }
      const lang = languageFor(profile.country);
      try {
        const d = await draftMessages({ ...profile, raw: {} }, lang, s);
        const now = new Date().toISOString();
        const msgs = [
          { prospect_id: row.id, kind: "invitacion", body: d.invitacion, status: "borrador", due_at: now },
          { prospect_id: row.id, kind: "mensaje", body: d.mensaje, status: "borrador", due_at: null },
          { prospect_id: row.id, kind: "seguimiento_1", body: d.seguimiento_1, status: "borrador", due_at: null },
          { prospect_id: row.id, kind: "seguimiento_2", body: d.seguimiento_2, status: "borrador", due_at: null },
        ];
        const ins = await db.from("outreach_messages").upsert(msgs, { onConflict: "prospect_id,kind" });
        if (ins.error) throw new Error(ins.error.message);
        const upd = await db
          .from("prospects")
          .update({ status: "listo", research: { ...research, angulo: d.angulo, language: lang } })
          .eq("id", row.id);
        if (upd.error) throw new Error(upd.error.message);
        summary.redactados += 1;
      } catch (e) {
        const n = (research.draft_errors ?? 0) + 1;
        summary.errores.push(`Redactar ${row.full_name}: ${(e as Error).message}`);
        // Tras 3 fallos se descarta para no gastar en un caso que siempre falla
        await db
          .from("prospects")
          .update(n >= 3
            ? { status: "descartado", discard_reason: "Falló la redacción 3 veces", research: { ...research, draft_errors: n } }
            : { research: { ...research, draft_errors: n } })
          .eq("id", row.id);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]); // 3 en paralelo
}

export async function runPipeline(trigger: "cron" | "manual"): Promise<RunSummary> {
  const summary: RunSummary = { status: "ok", searches: [], enriquecidos: 0, descartados: 0, redactados: 0, errores: [] };
  const db = createAdminClient();
  const started = new Date().toISOString();

  const settings = await getSettings();
  if (!settings.active && trigger === "cron") {
    return { ...summary, status: "skipped", reason: "El motor está apagado en Configuración." };
  }
  if (!(await acquireLock("motor", LOCK_MINUTES))) {
    return { ...summary, status: "skipped", reason: "Ya hay una ejecución en curso." };
  }

  try {
    try {
      await sourceProspects(settings, summary);
    } catch (e) {
      summary.errores.push(`Apollo: ${(e as Error).message}`);
    }
    await draftPending(settings, summary);
  } catch (e) {
    summary.status = "error";
    summary.errores.push((e as Error).message);
  } finally {
    await releaseLock("motor");
    await db.from("agent_runs").insert({
      agent: "motor",
      model: null,
      status: summary.errores.length > 0 && summary.redactados === 0 && summary.enriquecidos === 0 ? "error" : "ok",
      detail: { trigger, ...summary },
      started_at: started,
      finished_at: new Date().toISOString(),
    });
  }
  return summary;
}
