// Filtro determinístico: decide sin LLM si un prospecto vale la pena.
// Funciones puras, sin acceso a base de datos, para poder probarlas solas.

import type { EnrichedPerson } from "@/lib/apollo";

export type FilterConfig = {
  minEmployees: number;
  maxEmployees: number;
  excludeTitleWords: string[];
  locations: string[];
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Equivalencias de país en español e inglés
const COUNTRY_ALIASES: Record<string, string[]> = {
  mexico: ["mexico", "méxico"],
  "united states": ["united states", "usa", "us", "estados unidos", "united states of america"],
};

function countryMatches(country: string | null, locations: string[]): boolean {
  if (!country || locations.length === 0) return true; // sin dato: no descartar
  const c = norm(country);
  return locations.some((loc) => {
    const l = norm(loc);
    const aliases = (COUNTRY_ALIASES[l] ?? [l]).map(norm);
    // Comparación exacta: "us" no debe coincidir con "australia"
    return aliases.some((a) => c === a);
  });
}

export function evaluate(p: EnrichedPerson, cfg: FilterConfig): { ok: true } | { ok: false; reason: string } {
  if (!p.linkedinUrl) return { ok: false, reason: "Sin perfil de LinkedIn" };

  const title = norm(p.title ?? "");
  const bad = cfg.excludeTitleWords.map(norm).find((w) => w && title.includes(w));
  if (bad) return { ok: false, reason: `Puesto excluido (${bad})` };

  if (cfg.minEmployees > 0 && p.companySize !== null && p.companySize < cfg.minEmployees) {
    return { ok: false, reason: `Empresa chica (${p.companySize} empleados)` };
  }
  if (cfg.maxEmployees > 0 && p.companySize !== null && p.companySize > cfg.maxEmployees) {
    return { ok: false, reason: `Empresa demasiado grande (${p.companySize} empleados)` };
  }

  if (!countryMatches(p.country, cfg.locations)) {
    return { ok: false, reason: `País fuera de objetivo (${p.country})` };
  }

  return { ok: true };
}

// Idioma del mensaje: español para México y Latinoamérica/España, inglés para el resto
const SPANISH = [
  "mexico", "spain", "espana", "colombia", "argentina", "chile", "peru", "ecuador", "guatemala",
  "costa rica", "panama", "uruguay", "paraguay", "bolivia", "venezuela", "dominican republic",
  "republica dominicana", "el salvador", "honduras", "nicaragua", "puerto rico",
];

export function languageFor(country: string | null): "es" | "en" {
  if (!country) return "es";
  const c = norm(country);
  return SPANISH.some((s) => c.includes(s)) ? "es" : "en";
}
