// Catálogo de animaciones de los reels (sin dependencias: lo usan el servidor y el panel).
// Animaciones disponibles para el gancho y las ideas (el cierre siempre forma la marca)
export const VISUALS_INFO = {
  sphere: "Nube de partículas que forma una esfera: el conocimiento disperso en una empresa",
  graph: "Grafo 3D de conocimiento que crece y transmite pulsos: conexiones entre personas e información",
  flow: "Flujo de trabajo en perspectiva con estaciones y partículas que lo recorren: procesos y ejecución",
  lattice: "Partículas caóticas que se ordenan en una red con una ruta marcada: del caos al procedimiento",
  chat: "Conversaciones de varias personas que fluyen hacia un punto central: la comunicación como fuente de verdad",
  orgchart: "Organigrama formal y luego aparece la red real de quién habla con quién: cómo opera de verdad la empresa",
  departure: "Una persona clave se va y su conocimiento se dispersa: rotación y conocimiento perdido",
  radar: "Radar que detecta puntos ocultos y los conecta: diagnóstico y visibilidad",
  timeline: "Línea de tiempo de un proyecto con el estatus de cada etapa: en qué quedó cada proyecto",
  calendar: "Calendario saturado de juntas que se disuelven en un solo resumen: estatus sin juntas",
  bars: "Barras 3D que crecen y una destaca: eficiencia, mejora e impacto",
  orbits: "Órbitas con nodos girando alrededor de un centro: personas y herramientas conectadas",
} as const;
export type VisualKey = keyof typeof VISUALS_INFO;
export const VISUAL_KEYS = Object.keys(VISUALS_INFO) as VisualKey[];

// Nombres cortos para el panel
export const VISUAL_LABELS: Record<VisualKey, string> = {
  sphere: "Esfera de partículas",
  graph: "Grafo 3D",
  flow: "Flujo en perspectiva",
  lattice: "Del caos al orden",
  chat: "Conversaciones al centro",
  orgchart: "Organigrama contra red real",
  departure: "Persona que se va",
  radar: "Radar",
  timeline: "Línea de tiempo",
  calendar: "Juntas que se disuelven",
  bars: "Barras 3D",
  orbits: "Órbitas",
};

// Animaciones del reel (gancho + 3 ideas): las elegidas si son válidas y distintas; el resto se completa según la semilla
export function resolveVisuals(seed: number, chosen?: string[]): VisualKey[] {
  let a = ((seed * 977 + 5) >>> 0) || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pool = VISUAL_KEYS.map((k) => ({ k, o: r() })).sort((x, y) => x.o - y.o).map((x) => x.k);
  const out: VisualKey[] = [];
  for (const v of chosen ?? []) {
    if ((VISUAL_KEYS as string[]).includes(v) && !out.includes(v as VisualKey)) out.push(v as VisualKey);
    if (out.length === 4) break;
  }
  for (const v of pool) { if (out.length === 4) break; if (!out.includes(v)) out.push(v); }
  return out;
}
