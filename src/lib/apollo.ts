import "server-only";

// Cliente mínimo de Apollo.
// Búsqueda (mixed_people/api_search): 0 créditos, devuelve id, nombre, puesto (apellido oculto).
// Enriquecimiento (people/bulk_match): ~1 crédito por persona, devuelve LinkedIn, apellido y empresa.

const BASE = (process.env.APOLLO_BASE_URL || "https://api.apollo.io").replace(/\/+$/, "");

function apiKey() {
  const k = process.env.APOLLO_API_KEY;
  if (!k || !k.trim()) throw new Error("Falta la variable de entorno APOLLO_API_KEY.");
  return k.trim();
}

async function call(path: string, init: RequestInit & { query?: URLSearchParams } = {}) {
  const url = `${BASE}${path}${init.query ? `?${init.query.toString()}` : ""}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": apiKey(),
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : text.slice(0, 300);
    throw new Error(`Apollo ${path} respondió ${res.status}: ${msg}`);
  }
  return body as Record<string, unknown>;
}

export type SearchFilters = {
  titles: string[];
  seniorities: string[];
  locations: string[];
  minEmployees: number;
  maxEmployees: number;
  companyLocations: string[];
  technologies: string[];
  industries: string[];
};

export type SearchHit = { id: string; firstName: string; title: string | null; company: string | null };

// Rangos de empleados que Apollo entiende ("min,max")
export function employeeRanges(min: number, max: number): string[] {
  const all: [number, number][] = [
    [1, 10], [11, 50], [51, 200], [201, 500], [501, 1000], [1001, 5000], [5001, 10000], [10001, 1000000],
  ];
  const lo0 = min > 1 ? min : 1;
  const hi0 = max > 0 ? max : 1000000;
  if (lo0 <= 1 && hi0 >= 1000000) return []; // sin filtro
  return all
    .filter(([lo, hi]) => hi >= lo0 && lo <= hi0)
    .map(([lo, hi]) => `${Math.max(lo, lo0)},${Math.min(hi, hi0)}`);
}

export async function searchPeople(f: SearchFilters, page: number, perPage = 25) {
  const q = new URLSearchParams();
  f.titles.forEach((t) => q.append("person_titles[]", t));
  q.set("include_similar_titles", "true");
  f.seniorities.forEach((s) => q.append("person_seniorities[]", s));
  f.locations.forEach((l) => q.append("person_locations[]", l));
  f.companyLocations.forEach((l) => q.append("organization_locations[]", l));
  employeeRanges(f.minEmployees, f.maxEmployees).forEach((r) => q.append("organization_num_employees_ranges[]", r));
  f.technologies.forEach((t) => q.append("currently_using_any_of_technology_uids[]", t));
  f.industries.forEach((i) => q.append("organization_industries[]", i));
  q.set("page", String(page));
  q.set("per_page", String(perPage));

  const body = await call("/api/v1/mixed_people/api_search", { method: "POST", query: q });
  const people = Array.isArray(body.people) ? (body.people as Record<string, unknown>[]) : [];
  const hits: SearchHit[] = people
    .filter((p) => typeof p.id === "string")
    .map((p) => ({
      id: p.id as string,
      firstName: String(p.first_name ?? ""),
      title: (p.title as string) ?? null,
      company: ((p.organization as Record<string, unknown> | undefined)?.name as string) ?? null,
    }));
  const total = typeof body.total_entries === "number" ? body.total_entries : null;
  return { hits, total };
}

export type EnrichedPerson = {
  id: string;
  fullName: string;
  title: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  email: string | null;
  emailStatus: string | null; // Apollo: verified, guessed, unavailable…
  country: string | null;
  city: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companySize: number | null;
  industry: string | null;
  companyDescription: string | null;
  companyKeywords: string[];
  technologies: string[];
  raw: Record<string, unknown>;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function toEnriched(m: Record<string, unknown>): EnrichedPerson | null {
  const id = str(m.id);
  if (!id) return null;
  const org = (m.organization ?? {}) as Record<string, unknown>;
  const name = str(m.name) ?? [str(m.first_name), str(m.last_name)].filter(Boolean).join(" ");
  const techs = Array.isArray(org.technology_names)
    ? (org.technology_names as unknown[]).map(String)
    : Array.isArray(org.current_technologies)
      ? (org.current_technologies as Record<string, unknown>[]).map((t) => String(t.name ?? t.uid ?? "")).filter(Boolean)
      : [];
  const size = typeof org.estimated_num_employees === "number" ? org.estimated_num_employees : null;
  return {
    id,
    fullName: name || "Sin nombre",
    title: str(m.title),
    headline: str(m.headline),
    linkedinUrl: str(m.linkedin_url),
    email: str(m.email)?.toLowerCase() ?? null,
    emailStatus: str(m.email_status),
    country: str(m.country) ?? str(org.country),
    city: str(m.city),
    companyName: str(org.name),
    companyDomain: str(org.primary_domain) ?? str(org.website_url),
    companySize: size,
    industry: str(org.industry),
    companyDescription: str(org.short_description),
    companyKeywords: Array.isArray(org.keywords) ? (org.keywords as unknown[]).map(String).slice(0, 15) : [],
    technologies: techs.slice(0, 30),
    raw: m,
  };
}

// Enriquecimiento en grupos de 10 (límite de Apollo)
export async function enrichPeople(ids: string[]): Promise<EnrichedPerson[]> {
  const out: EnrichedPerson[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const q = new URLSearchParams({ reveal_personal_emails: "false", reveal_phone_number: "false" });
    const body = await call("/api/v1/people/bulk_match", {
      method: "POST",
      query: q,
      body: JSON.stringify({ details: chunk.map((id) => ({ id })) }),
    });
    const matches = Array.isArray(body.matches) ? (body.matches as (Record<string, unknown> | null)[]) : [];
    for (const m of matches) {
      if (!m) continue;
      const e = toEnriched(m);
      if (e) out.push(e);
    }
  }
  return out;
}
