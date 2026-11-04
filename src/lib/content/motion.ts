import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import ffmpegPath from "ffmpeg-static";

// Reel 1080x1920 a 30 fps con el estilo de tacit.guru: fondo claro, esfera de partículas de colores,
// grafo 3D, flujo en perspectiva, red que se ordena y partículas que forman la marca.
// Cada cuadro se dibuja en canvas y se manda crudo a ffmpeg, que agrega la música generada (sin derechos).

export type ReelScript = {
  hook: string;      // gancho, máximo ~9 palabras
  points: string[];  // 3 ideas cortas
  cta: string;       // cierre
  lang: "es" | "en";
  seed: number;      // varía colores, formas y música
  music?: MusicStyle;
};

const W = 1080;
const H = 1920;
const FPS = 30;
const BG = "#FDFCFA";
const INK = "#18232E";
const PULSE = "#1A9E78";
const MIST = "#8A9BA8";
const GRID = "#D9D3C7";
// Colores de la esfera de la web
const PALETTE = ["#2A7A2A", "#9A2A7A", "#1A7A6A", "#AA3A2A", "#5A3AAA", "#2A5A9A", "#AA6A1A", "#0A9A8A", "#BA2A9A", "#2A9A2A", "#DA7A1A", "#DA3A3A"];

const MARGIN = 96;
const TEXT_TOP = 330;
const TEXT_MAX_H = 560;
const CX = 540;
const CY = 1300;

// ---------- utilidades ----------
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x: number) => { const t = clamp(x); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeBack = (x: number) => { if (x <= 0) return 0; if (x >= 1) return 1; const t = x; const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

function rng(seed: number) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, k: number) {
  const x = hexRgb(a), y = hexRgb(b);
  return `rgb(${Math.round(lerp(x[0], y[0], k))},${Math.round(lerp(x[1], y[1], k))},${Math.round(lerp(x[2], y[2], k))})`;
}

type V3 = { x: number; y: number; z: number };
// Gira en Y y luego en X. z positivo = hacia la cámara.
function rot(v: V3, ry: number, rx: number): V3 {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return { x: x1, y: v.y * cx - z1 * sx, z: v.y * sx + z1 * cx };
}
const CAM = 3.2;
function proj(v: V3, scale: number, cx = CX, cy = CY) {
  const s = CAM / (CAM - v.z);
  return { x: cx + v.x * scale * s, y: cy + v.y * scale * s, s, z: v.z };
}
const v3lerp = (a: V3, b: V3, k: number): V3 => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });

function fibSphere(n: number, r: () => number, jitter = 0): V3[] {
  const out: V3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = g * i;
    const k = 1 + (r() * 2 - 1) * jitter;
    out.push({ x: Math.cos(th) * rad * k, y: y * k, z: Math.sin(th) * rad * k });
  }
  return out;
}

// ---------- fuentes ----------
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = join(process.cwd(), "assets/fonts");
  const ok = [
    GlobalFonts.registerFromPath(join(dir, "instrument-serif-latin-400-normal.woff"), "Instrument Serif"),
    GlobalFonts.registerFromPath(join(dir, "dm-sans-latin-400-normal.woff"), "DM Sans"),
    GlobalFonts.registerFromPath(join(dir, "dm-sans-latin-600-normal.woff"), "DM Sans"),
  ];
  if (ok.some((k) => !k)) throw new Error("No se pudieron cargar las fuentes del reel.");
  fontsReady = true;
}

// ---------- texto ----------
type Word = { text: string; x: number; y: number; accent: boolean };
type TextBlock = { words: Word[]; font: string; size: number; bottom: number };

function layout(ctx: SKRSContext2D, text: string, family: string, weight: number, size0: number, top: number, opts: { accentLast?: boolean; center?: boolean; maxH?: number } = {}): TextBlock {
  const words = text.split(/\s+/).filter(Boolean);
  const maxW = W - MARGIN * 2;
  for (let size = size0; size >= 40; size -= 6) {
    const font = `${weight} ${size}px "${family}"`;
    ctx.font = font;
    const space = ctx.measureText(" ").width;
    const lineH = size * 1.12;
    const lines: { w: string; width: number }[][] = [[]];
    let lineW = 0;
    let tooWide = false;
    for (const w of words) {
      const ww = ctx.measureText(w).width;
      if (ww > maxW) tooWide = true;
      const cur = lines[lines.length - 1];
      const add = cur.length ? space + ww : ww;
      if (cur.length && lineW + add > maxW) {
        lines.push([{ w, width: ww }]);
        lineW = ww;
      } else {
        cur.push({ w, width: ww });
        lineW += add;
      }
    }
    const height = lines.length * lineH;
    if ((tooWide || height > (opts.maxH ?? TEXT_MAX_H)) && size - 6 >= 40) continue;
    const out: Word[] = [];
    lines.forEach((line, li) => {
      const total = line.reduce((a, b) => a + b.width, 0) + space * (line.length - 1);
      let x = opts.center ? (W - total) / 2 : MARGIN;
      const y = top + size + li * lineH;
      for (const it of line) {
        out.push({ text: it.w, x, y, accent: false });
        x += it.width + space;
      }
    });
    if (opts.accentLast && out.length) out[out.length - 1].accent = true;
    return { words: out, font, size, bottom: top + height };
  }
  throw new Error("Texto imposible de acomodar.");
}

function drawText(ctx: SKRSContext2D, b: TextBlock, lt: number, dur: number, start: number, step: number, color = INK) {
  const out = clamp((dur - lt) / 0.35);
  ctx.font = b.font;
  ctx.textBaseline = "alphabetic";
  b.words.forEach((w, i) => {
    const k = easeOut((lt - start - i * step) / 0.45);
    if (k <= 0) return;
    ctx.globalAlpha = k * out;
    ctx.fillStyle = w.accent ? PULSE : color;
    ctx.fillText(w.text, w.x, w.y + (1 - k) * 34 - (1 - out) * 16);
  });
  ctx.globalAlpha = 1;
}

// ---------- escena base ----------
function drawMark(ctx: SKRSContext2D, x: number, y: number, size: number, color = PULSE) {
  const k = size / 512;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 26 * k;
  ctx.lineCap = "round";
  for (const [a, b, c, d] of MARK_SEGS) {
    ctx.beginPath();
    ctx.moveTo(x + a * k, y + b * k);
    ctx.lineTo(x + c * k, y + d * k);
    ctx.stroke();
  }
  ctx.restore();
}
const MARK_SEGS: [number, number, number, number][] = [
  [40, 92, 166, 92], [346, 92, 472, 92], [104, 92, 256, 244], [408, 92, 256, 244], [256, 244, 256, 432],
];

function drawChrome(ctx: SKRSContext2D, t: number, total: number) {
  drawMark(ctx, MARGIN, 112, 52);
  ctx.fillStyle = INK;
  ctx.font = `400 46px "Instrument Serif"`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Tacit", MARGIN + 66, 156);
  ctx.fillStyle = MIST;
  ctx.font = `400 30px "DM Sans"`;
  const label = "tacit.guru";
  ctx.fillText(label, W - MARGIN - ctx.measureText(label).width, 152);
  // barra de progreso
  ctx.fillStyle = "#EEE9DF";
  ctx.fillRect(0, 0, W, 8);
  ctx.fillStyle = PULSE;
  ctx.fillRect(0, 0, W * clamp(t / total), 8);
}

// ---------- visuales ----------
type Particle = { p: V3; from: V3; color: string; size: number; delay: number };

type World = {
  particles: Particle[];
  constellation: number[];
  graph: { nodes: V3[]; colors: string[]; edges: [number, number][]; order: number[] };
  flow: { stations: V3[]; path: V3[]; stationU: number[]; particles: { off: number; color: string; lane: number }[] };
  lattice: { pts: V3[]; chaos: V3[]; colors: string[]; delay: number[]; edges: [number, number][]; route: number[] };
  mark: { targets: { x: number; y: number }[]; from: { x: number; y: number }[]; delay: number[] };
};

function buildWorld(seed: number): World {
  const r = rng(seed * 7919 + 17);
  const pick = () => PALETTE[Math.floor(r() * PALETTE.length)];

  // Esfera de partículas
  const sph = fibSphere(820, r, 0.05);
  const particles: Particle[] = sph.map((p) => {
    const dir = { x: r() * 2 - 1, y: r() * 2 - 1, z: r() * 2 - 1 };
    const m = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const d = 2.2 + r() * 2;
    return { p, from: { x: (dir.x / m) * d, y: (dir.y / m) * d, z: (dir.z / m) * d * 0.4 }, color: pick(), size: 3 + r() * 4.5, delay: r() * 0.7 };
  });
  const constellation = Array.from({ length: 7 }, () => Math.floor(r() * particles.length));

  // Grafo 3D: nodos en una esfera, cada uno unido a sus 3 vecinos más cercanos
  const nodes = fibSphere(26, r, 0.18);
  const edgesSet = new Set<string>();
  const edges: [number, number][] = [];
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }))
      .filter((o) => o.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!edgesSet.has(key)) { edgesSet.add(key); edges.push(i < j ? [i, j] : [j, i]); }
      });
  });
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].y - nodes[b].y);
  const graph = { nodes, colors: nodes.map(pick), edges, order };

  // Flujo sobre un plano: estaciones conectadas por una curva
  const stations: V3[] = [
    { x: -0.55, y: 0, z: -0.95 },
    { x: 0.5, y: 0, z: -0.4 },
    { x: -0.45, y: 0, z: 0.15 },
    { x: 0.4, y: 0, z: 0.75 },
  ];
  const path: V3[] = [];
  const stationU: number[] = [];
  const seg = 40;
  const P = [stations[0], ...stations, stations[stations.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    stationU.push(path.length);
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t;
      const f = (k: "x" | "z") =>
        0.5 * (2 * P[i][k] + (-P[i - 1][k] + P[i + 1][k]) * t + (2 * P[i - 1][k] - 5 * P[i][k] + 4 * P[i + 1][k] - P[i + 2][k]) * t2 + (-P[i - 1][k] + 3 * P[i][k] - 3 * P[i + 1][k] + P[i + 2][k]) * t3);
      path.push({ x: f("x"), y: 0, z: f("z") });
    }
  }
  stationU.push(path.length);
  path.push(stations[stations.length - 1]);
  const flow = {
    stations, path,
    stationU: stationU.map((i) => i / (path.length - 1)),
    particles: Array.from({ length: 64 }, (_, i) => ({ off: i / 64 + r() * 0.01, color: pick(), lane: r() * 2 - 1 })),
  };

  // Red que pasa del caos al orden: retícula 5x5x5
  const pts: V3[] = [];
  const n = 5;
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    pts.push({ x: (x / (n - 1)) * 2 - 1, y: (y / (n - 1)) * 2 - 1, z: (z / (n - 1)) * 2 - 1 });
  }
  const idx = (x: number, y: number, z: number) => x * n * n + y * n + z;
  const lEdges: [number, number][] = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) {
    if (x + 1 < n) lEdges.push([idx(x, y, z), idx(x + 1, y, z)]);
    if (y + 1 < n) lEdges.push([idx(x, y, z), idx(x, y + 1, z)]);
    if (z + 1 < n) lEdges.push([idx(x, y, z), idx(x, y, z + 1)]);
  }
  const route = [idx(0, 4, 0), idx(1, 4, 0), idx(2, 4, 0), idx(2, 3, 0), idx(2, 2, 0), idx(2, 2, 1), idx(2, 2, 2), idx(3, 2, 2), idx(4, 2, 2), idx(4, 1, 2), idx(4, 0, 2), idx(4, 0, 3), idx(4, 0, 4)];
  const lattice = {
    pts,
    chaos: pts.map(() => ({ x: (r() * 2 - 1) * 1.8, y: (r() * 2 - 1) * 1.8, z: (r() * 2 - 1) * 1.2 })),
    colors: pts.map(pick),
    delay: pts.map(() => r() * 0.6),
    edges: lEdges,
    route,
  };

  // Marca de Tacit formada por partículas
  const lens = MARK_SEGS.map(([a, b, c, d]) => Math.hypot(c - a, d - b));
  const totalLen = lens.reduce((a, b) => a + b, 0);
  const targets: { x: number; y: number }[] = [];
  const NM = 700;
  for (let i = 0; i < NM; i++) {
    let u = (i / NM) * totalLen;
    let s = 0;
    while (s < lens.length - 1 && u > lens[s]) { u -= lens[s]; s++; }
    const [a, b, c, d] = MARK_SEGS[s];
    const k = clamp(u / lens[s]);
    const nx = -(d - b) / lens[s], ny = (c - a) / lens[s];
    const off = (r() * 2 - 1) * 11;
    const px = lerp(a, c, k) + nx * off, py = lerp(b, d, k) + ny * off;
    targets.push({ x: CX + (px - 256) * 1.3, y: CY - 60 + (py - 262) * 1.3 });
  }
  const mark = {
    targets,
    from: targets.map(() => ({ x: -100 + r() * (W + 200), y: 250 + r() * (H - 250) })),
    delay: targets.map(() => r() * 0.5),
  };

  return { particles, constellation, graph, flow, lattice, mark };
}

// Esfera de partículas (escena del gancho y fondo tenue de otras escenas)
function drawSphere(ctx: SKRSContext2D, w: World, t: number, lt: number, alpha: number, intro: boolean, scale = 400) {
  const ry = t * 0.22, rx = -0.35;
  const pts: { x: number; y: number; size: number; a: number; color: string }[] = [];
  for (const q of w.particles) {
    const v = intro ? v3lerp(q.from, q.p, easeOut((lt - q.delay) / 1.4)) : q.p;
    const r3 = rot(v, ry, rx);
    const pr = proj(r3, scale);
    const depth = clamp((r3.z + 1) / 2);
    pts.push({ x: pr.x, y: pr.y, size: q.size * pr.s, a: alpha * (0.2 + 0.8 * depth), color: q.color });
  }
  for (const p of pts) {
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  // Constelación: algunas partículas se unen con líneas
  if (intro) {
    const k = easeOut((lt - 1.2) / 1.2);
    if (k > 0) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      const cp = w.constellation.map((i) => {
        const r3 = rot(w.particles[i].p, ry, rx);
        return proj(r3, scale);
      });
      ctx.globalAlpha = alpha * 0.35 * k;
      ctx.beginPath();
      cp.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.globalAlpha = alpha * k;
      for (const p of cp) {
        ctx.fillStyle = PULSE;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7 * p.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// Grafo de conocimiento 3D que crece y transmite pulsos
function drawGraph(ctx: SKRSContext2D, w: World, t: number, lt: number, alpha: number) {
  drawSphere(ctx, w, t, lt, alpha * 0.12, false, 470);
  const g = w.graph;
  const ry = 0.6 + lt * 0.42, rx = -0.3 + 0.12 * Math.sin(lt * 0.8);
  const scale = 360;
  const appear = new Array<number>(g.nodes.length);
  g.order.forEach((ni, k) => (appear[ni] = 0.2 + k * 0.06));
  const P = g.nodes.map((v) => { const r3 = rot(v, ry, rx); return { ...proj(r3, scale), d: clamp((r3.z + 1) / 2) }; });

  ctx.lineCap = "round";
  g.edges.forEach(([a, b], j) => {
    const p = easeInOut((lt - Math.max(appear[a], appear[b]) - 0.1) / 0.45);
    if (p <= 0) return;
    const A = P[a], B = P[b];
    const depth = (A.d + B.d) / 2;
    ctx.globalAlpha = alpha * (0.15 + 0.4 * depth);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5 + 1.5 * depth;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(lerp(A.x, B.x, p), lerp(A.y, B.y, p));
    ctx.stroke();
    if (p >= 1 && j % 2 === 0) {
      const ph = (lt * 0.7 + j * 0.137) % 1;
      ctx.globalAlpha = alpha * (0.4 + 0.6 * depth);
      ctx.fillStyle = PULSE;
      ctx.beginPath();
      ctx.arc(lerp(A.x, B.x, ph), lerp(A.y, B.y, ph), 4 + 3 * depth, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const order = P.map((_, i) => i).sort((a, b) => P[a].z - P[b].z);
  for (const i of order) {
    const k = easeBack((lt - appear[i]) / 0.4);
    if (k <= 0) continue;
    const p = P[i];
    const hub = i === g.order[Math.floor(g.order.length / 2)];
    const rad = (hub ? 26 : 11 + 6 * p.d) * p.s * Math.max(0, k);
    if (hub) {
      const ring = (lt * 0.65) % 1;
      ctx.globalAlpha = alpha * (1 - ring) * 0.6;
      ctx.strokeStyle = PULSE;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad + ring * 70, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha * (0.45 + 0.55 * p.d);
    ctx.fillStyle = hub ? PULSE : g.colors[i];
    ctx.beginPath();
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = BG;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Flujo de trabajo en perspectiva: estaciones flotando sobre un plano y partículas que lo recorren
function drawFlow(ctx: SKRSContext2D, w: World, _t: number, lt: number, alpha: number) {
  const f = w.flow;
  const ry = 0.25 * Math.sin(lt * 0.45) + 0.08, rx = -0.95;
  const scale = 390;
  const cy = CY + 20;
  const P = (v: V3) => { const r3 = rot(v, ry, rx); return { ...proj(r3, scale, CX, cy), d: clamp((r3.z + 1.2) / 2.4) }; };

  // Retícula del plano
  const gridIn = easeOut(lt / 0.8);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  for (let i = -6; i <= 6; i++) {
    const u = i * 0.2;
    for (const [a, b] of [[{ x: u, y: 0, z: -1.3 }, { x: u, y: 0, z: 1.3 }], [{ x: -1.3, y: 0, z: u }, { x: 1.3, y: 0, z: u }]] as [V3, V3][]) {
      const A = P(a), B = P(b);
      ctx.globalAlpha = alpha * gridIn * (0.25 + 0.5 * (A.d + B.d) / 2) * (1 - Math.abs(u) / 1.5);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  }

  // Camino que se dibuja
  const reveal = easeInOut((lt - 0.3) / 1.6);
  const last = Math.floor(reveal * (f.path.length - 1));
  ctx.globalAlpha = alpha * 0.8;
  ctx.strokeStyle = PULSE;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i <= last; i++) {
    const p = P(f.path[i]);
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  const at = (u: number) => {
    const x = clamp(u) * (f.path.length - 1);
    const i = Math.min(f.path.length - 2, Math.floor(x));
    return v3lerp(f.path[i], f.path[i + 1], x - i);
  };

  // Partículas que fluyen
  if (reveal >= 1) {
    const flowIn = easeOut((lt - 1.9) / 0.6);
    for (const q of f.particles) {
      const u = (lt * 0.16 + q.off) % 1;
      const a = at(u), b = at(Math.min(1, u + 0.01));
      const nx = -(b.z - a.z), nz = b.x - a.x;
      const m = Math.hypot(nx, nz) || 1;
      const v = { x: a.x + (nx / m) * q.lane * 0.05, y: -0.02, z: a.z + (nz / m) * q.lane * 0.05 };
      const p = P(v);
      const s = 9 * p.s;
      ctx.globalAlpha = alpha * flowIn * (0.5 + 0.5 * p.d);
      ctx.fillStyle = q.color;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
  }

  // Estaciones: tarjetas flotantes como las de la web
  const order = f.stations.map((_, i) => i).sort((a, b) => P(f.stations[a]).z - P(f.stations[b]).z);
  for (const i of order) {
    // Aparece cuando la línea llega a la estación
    let lo = 0, hi = 1;
    for (let it = 0; it < 24; it++) { const m = (lo + hi) / 2; if (easeInOut(m) < f.stationU[i]) lo = m; else hi = m; }
    const k = easeBack((lt - (0.3 + hi * 1.6)) / 0.35);
    if (k <= 0) continue;
    const base = P(f.stations[i]);
    const top = P({ ...f.stations[i], y: -0.32 });
    ctx.globalAlpha = alpha * 0.5;
    ctx.strokeStyle = MIST;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const u = top.s * k; // unidad de la tarjeta (crece al aparecer)
    const cw = 230 * u, ch = 120 * u;
    const x = top.x - cw / 2, y = top.y - ch;
    // brillo cuando pasa una partícula
    const near = reveal >= 1 && f.particles.some((q) => Math.abs(((lt * 0.16 + q.off) % 1) - f.stationU[i]) < 0.012);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(24,35,46,0.08)";
    roundRect(ctx, x + 6 * u, y + 10 * u, cw, ch, 18 * u);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, x, y, cw, ch, 18 * u);
    ctx.fill();
    ctx.strokeStyle = near ? PULSE : "#E4DDD0";
    ctx.lineWidth = near ? 4 : 2;
    ctx.stroke();
    ctx.fillStyle = PALETTE[(i * 3 + 1) % PALETTE.length];
    ctx.fillRect(x + 22 * u, y + 26 * u, 22 * u, 22 * u);
    ctx.fillStyle = "#E9E4DA";
    roundRect(ctx, x + 58 * u, y + 28 * u, 140 * u, 16 * u, 8 * u); ctx.fill();
    roundRect(ctx, x + 22 * u, y + 70 * u, 180 * u, 14 * u, 7 * u); ctx.fill();
    roundRect(ctx, x + 22 * u, y + 94 * u, 120 * u, 14 * u, 7 * u); ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PULSE;
    ctx.beginPath();
    ctx.arc(base.x, base.y, 8 * base.s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Del caos al orden: partículas dispersas forman una red estructurada con una ruta marcada
function drawLattice(ctx: SKRSContext2D, w: World, _t: number, lt: number, alpha: number) {
  const L = w.lattice;
  const ry = 0.7 + lt * 0.32, rx = -0.42;
  const scale = 215;
  const pos = L.pts.map((p, i) => {
    const drift = { x: L.chaos[i].x + 0.15 * Math.sin(lt * 1.3 + i), y: L.chaos[i].y + 0.15 * Math.cos(lt * 1.1 + i * 0.7), z: L.chaos[i].z };
    const k = easeInOut((lt - 0.5 - L.delay[i]) / 1.5);
    const r3 = rot(v3lerp(drift, p, k), ry, rx);
    return { ...proj(r3, scale), d: clamp((r3.z + 1.4) / 2.8), k };
  });
  const settled = easeOut((lt - 2.4) / 0.7);
  if (settled > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.5;
    for (const [a, b] of L.edges) {
      ctx.globalAlpha = alpha * settled * (0.06 + 0.2 * (pos[a].d + pos[b].d) / 2);
      ctx.beginPath();
      ctx.moveTo(pos[a].x, pos[a].y);
      ctx.lineTo(pos[b].x, pos[b].y);
      ctx.stroke();
    }
  }
  const order = pos.map((_, i) => i).sort((a, b) => pos[a].z - pos[b].z);
  for (const i of order) {
    const p = pos[i];
    const s = (7 + 6 * p.d) * p.s;
    ctx.globalAlpha = alpha * (0.35 + 0.65 * p.d);
    ctx.fillStyle = L.colors[i];
    ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  }
  // Ruta (el procedimiento) que se ilumina
  const routeK = easeInOut((lt - 2.8) / 1.0);
  if (routeK > 0) {
    const n = L.route.length - 1;
    const upto = routeK * n;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = PULSE;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let j = 0; j <= Math.floor(upto); j++) {
      const p = pos[L.route[j]];
      if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    const j = Math.floor(upto);
    if (j < n) {
      const a = pos[L.route[j]], b = pos[L.route[j + 1]];
      ctx.lineTo(lerp(a.x, b.x, upto - j), lerp(a.y, b.y, upto - j));
    }
    ctx.stroke();
    for (let j2 = 0; j2 <= Math.floor(upto); j2++) {
      const p = pos[L.route[j2]];
      ctx.fillStyle = PULSE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9 * p.s, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// Cierre: las partículas forman la marca de Tacit
function drawMarkScene(ctx: SKRSContext2D, w: World, _t: number, lt: number, alpha: number) {
  const M = w.mark;
  for (let i = 0; i < M.targets.length; i++) {
    const k = easeInOut((lt - 0.2 - M.delay[i]) / 1.3);
    const a = M.from[i], b = M.targets[i];
    const bump = Math.sin(Math.PI * k) * 80;
    const x = lerp(a.x, b.x, k) + bump * Math.cos(i);
    const y = lerp(a.y, b.y, k) + bump * Math.sin(i);
    const breathe = k >= 1 ? 1 + 0.15 * Math.sin(lt * 3 + i * 0.3) : 1;
    const s = lerp(5, 7, k) * breathe;
    const color = w.particles[i % w.particles.length].color;
    ctx.globalAlpha = alpha * lerp(0.6, 1, k);
    ctx.fillStyle = k > 0.6 ? mix(color, PULSE, (k - 0.6) / 0.4) : color;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

type Visual = (ctx: SKRSContext2D, w: World, t: number, lt: number, alpha: number) => void;
const VISUALS: Visual[] = [
  (c, w, t, lt, a) => drawSphere(c, w, t, lt, a, true),
  drawGraph,
  drawFlow,
  drawLattice,
  drawMarkScene,
];

// ---------- guion a escenas ----------
type Scene = { start: number; dur: number; visual: number; draw: (ctx: SKRSContext2D, lt: number) => void };

function buildScenes(ctx: SKRSContext2D, s: ReelScript): { scenes: Scene[]; total: number } {
  const scenes: Scene[] = [];
  let t = 0;
  const words = (x: string) => x.split(/\s+/).filter(Boolean).length;

  // 1) Gancho
  const hookSize = s.hook.length > 42 ? 100 : s.hook.length > 26 ? 116 : 132;
  const hook = layout(ctx, s.hook, "Instrument Serif", 400, hookSize, TEXT_TOP + 40, { accentLast: true });
  const hookDur = Math.max(3.6, 0.5 + words(s.hook) * 0.14 + 2.3);
  scenes.push({
    start: t, dur: hookDur, visual: 0,
    draw: (c, lt) => {
      const out = clamp((hookDur - lt) / 0.35);
      c.globalAlpha = easeOut(lt / 0.4) * out;
      c.fillStyle = PULSE;
      c.fillRect(MARGIN, TEXT_TOP, 120 * easeOut(lt / 0.6), 10);
      c.globalAlpha = 1;
      drawText(c, hook, lt, hookDur, 0.35, 0.14);
    },
  });
  t += hookDur;

  // 2) Ideas
  const pts = s.points.slice(0, 3);
  pts.forEach((p, i) => {
    const label = `${String(i + 1).padStart(2, "0")} / ${String(pts.length).padStart(2, "0")}`;
    const block = layout(ctx, p, "Instrument Serif", 400, 88, TEXT_TOP + 70, { maxH: 500 });
    const dur = Math.max(4.2, 0.6 + words(p) * 0.12 + 2.8);
    scenes.push({
      start: t, dur, visual: 1 + (i % 3),
      draw: (c, lt) => {
        const out = clamp((dur - lt) / 0.35);
        c.globalAlpha = easeOut(lt / 0.4) * out;
        c.fillStyle = PULSE;
        c.font = `600 34px "DM Sans"`;
        c.fillText(label, MARGIN, TEXT_TOP + 34);
        c.globalAlpha = 1;
        drawText(c, block, lt, dur, 0.3, 0.12);
      },
    });
    t += dur;
  });

  // 3) Cierre
  const cta = layout(ctx, s.cta, "Instrument Serif", 400, 92, TEXT_TOP + 20, { center: true, maxH: 330 });
  const ctaDur = 4.4;
  scenes.push({
    start: t, dur: ctaDur, visual: 4,
    draw: (c, lt) => {
      drawText(c, cta, lt, ctaDur + 10, 0.3, 0.1);
      const k = easeOut((lt - 1.4) / 0.6);
      c.globalAlpha = k;
      c.fillStyle = PULSE;
      c.font = `600 52px "DM Sans"`;
      const label = "tacit.guru";
      c.fillText(label, (W - c.measureText(label).width) / 2, cta.bottom + 110 + (1 - k) * 20);
      c.globalAlpha = 1;
    },
  });
  t += ctaDur;
  return { scenes, total: t };
}

// ---------- música (generada, original, sin derechos) ----------
export type MusicStyle = "piano" | "corporativo" | "metal";

function ifChain(values: number[], seg: number) {
  return values.reduceRight((acc, v, i) => `if(lt(mod(t,${seg * values.length}),${seg * (i + 1)}),${v},${acc})`, String(values[0]));
}

function corporateExpr(seed: number, total: number) {
  const progs = [
    [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]], // Am F C G
    [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]], // C G Am F
    [[146.83, 174.61, 220], [233.08, 293.66, 349.23], [174.61, 220, 261.63], [261.63, 329.63, 392]], // Dm Bb F C
  ];
  const prog = progs[Math.abs(seed) % progs.length];
  const chord = (n: number) => ifChain(prog.map((c) => c[n]), 4);
  const beat = 60 / 112;
  const pad = `0.06*(sin(2*PI*${chord(0)}*t)+sin(2*PI*${chord(1)}*t)+0.8*sin(2*PI*${chord(2)}*t)+0.5*sin(2*PI*${chord(0)}*t/2))*(0.75+0.25*sin(2*PI*0.5*t))`;
  const kick = `0.35*sin(2*PI*(48+70*exp(-30*mod(t,${beat})))*mod(t,${beat}))*exp(-8*mod(t,${beat}))`;
  const hat = `0.025*(2*random(0)-1)*exp(-70*mod(t+${beat / 2},${beat}))`;
  const fade = `min(1,t/1.2)*min(1,(${total}-t)/1.6)`;
  return `(${pad}+${kick}+${hat})*${fade}`;
}

// Metal original: acordes de potencia (raíz, quinta, octava) en palm-mute con distorsión suave,
// doble bombo al final de cada vuelta, tarola en 2 y 4. Progresiones genéricas en mi menor.
function metalExpr(seed: number, total: number) {
  const progs = [
    [82.41, 65.41, 73.42, 82.41],  // E5 C5 D5 E5
    [82.41, 98.0, 110.0, 65.41],   // E5 G5 A5 C5
    [82.41, 87.31, 82.41, 73.42],  // E5 F5 E5 D5
  ];
  const bpm = 100;
  const beat = 60 / bpm, eighth = beat / 2, sixteenth = beat / 4, bar = beat * 4;
  const root = ifChain(progs[Math.abs(seed) % progs.length], bar);
  const tone = (mult: number) =>
    `(sin(2*PI*${root}*${mult}*t)+0.33*sin(6*PI*${root}*${mult}*t)+0.2*sin(10*PI*${root}*${mult}*t))`;
  const raw = `(${tone(1)}+0.8*${tone(1.5)}+0.5*${tone(2)})`;
  const dist = `(2.5*${raw}/(1+2.5*abs(${raw})))`;
  const chug = `(0.5+0.5*exp(-8*mod(t,${eighth})))`;
  const guitar = `0.22*${dist}*${chug}`;
  const loop = bar * 4;
  const kickAt = (period: number) => `sin(2*PI*(45+80*exp(-35*mod(t,${period})))*mod(t,${period}))*exp(-12*mod(t,${period}))`;
  const kick = `0.32*if(gte(mod(t,${loop}),${loop - bar}),${kickAt(sixteenth)},${kickAt(beat * 2)})`;
  const snare = `0.1*(2*random(0)-1)*exp(-16*mod(t+${beat},${beat * 2}))`;
  const hat = `0.03*(2*random(1)-1)*exp(-80*mod(t,${eighth}))`;
  const fade = `min(1,t/0.4)*min(1,(${total}-t)/1.4)`;
  return `(${guitar}+${kick}+${snare}+${hat})*${fade}`;
}

// Piano suave: arpegio lento sobre una progresión menor tipo balada (Em C G D y variantes),
// con bajo sostenido por compás y reverberación. Cada nota arranca y termina en cero (sin clics).
function pianoExpr(seed: number, total: number) {
  const progs = [
    [[164.81, 246.94, 329.63, 392.0], [130.81, 196.0, 261.63, 329.63], [196.0, 293.66, 392.0, 493.88], [146.83, 220.0, 293.66, 369.99]], // Em C G D
    [[220.0, 329.63, 440.0, 523.25], [174.61, 261.63, 349.23, 440.0], [130.81, 196.0, 261.63, 329.63], [196.0, 293.66, 392.0, 493.88]], // Am F C G
    [[164.81, 246.94, 329.63, 392.0], [220.0, 329.63, 440.0, 523.25], [130.81, 196.0, 261.63, 329.63], [123.47, 185.0, 246.94, 293.66]], // Em Am C Bm
  ];
  const prog = progs[Math.abs(seed) % progs.length];
  const bpm = 72;
  const eighth = 60 / bpm / 2;
  const bar = eighth * 8;
  const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
  const notes = prog.flatMap((c) => pattern.map((i) => c[i]));
  const f = ifChain(notes, eighth);
  const m = `mod(t,${eighth})`;
  const env = `(1-exp(-120*${m}))*exp(-2.6*${m})*min(1,(${eighth}-${m})/0.03)`;
  const note = `(sin(2*PI*${f}*${m})+0.45*sin(4*PI*${f}*${m})*exp(-6*${m})+0.18*sin(6*PI*${f}*${m})*exp(-9*${m}))`;
  const piano = `0.38*${note}*${env}`;
  const root = ifChain(prog.map((c) => c[0] / 2), bar);
  const mb = `mod(t,${bar})`;
  const bass = `0.26*(sin(2*PI*${root}*${mb})+0.3*sin(4*PI*${root}*${mb}))*(1-exp(-60*${mb}))*exp(-0.7*${mb})*min(1,(${bar}-${mb})/0.05)`;
  const fade = `min(1,t/1.0)*min(1,(${total}-t)/2.0)`;
  return `(${piano}+${bass})*${fade}`;
}

function audioFor(style: MusicStyle, seed: number, total: number) {
  if (style === "metal") return { expr: metalExpr(seed, total), filter: "[1:a]lowpass=f=5000,highpass=f=40,aecho=0.8:0.5:90:0.2,alimiter=limit=0.9[a]" };
  if (style === "corporativo") return { expr: corporateExpr(seed, total), filter: "[1:a]lowpass=f=4200,aecho=0.8:0.6:180:0.25,alimiter=limit=0.9[a]" };
  return { expr: pianoExpr(seed, total), filter: "[1:a]lowpass=f=5200,aecho=0.8:0.7:70|160|310:0.35|0.25|0.15,alimiter=limit=0.9[a]" };
}

// ---------- render ----------
export async function renderReelMp4(script: ReelScript): Promise<Buffer> {
  if (!ffmpegPath) throw new Error("ffmpeg no está disponible en el servidor.");
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const world = buildWorld(script.seed);
  const { scenes, total } = buildScenes(ctx, script);
  const frames = Math.round(total * FPS);
  const XFADE = 0.6;

  const drawFrame = (f: number) => {
    const t = f / FPS;
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    const found = scenes.findIndex((s) => t >= s.start && t < s.start + s.dur);
    const si = found === -1 ? scenes.length - 1 : found;
    const sc = scenes[si];
    const lt = t - sc.start;
    const k = si > 0 ? easeInOut(lt / XFADE) : 1;
    if (k < 1) {
      const prev = scenes[si - 1];
      VISUALS[prev.visual](ctx, world, t, t - prev.start, 1 - k);
    }
    VISUALS[sc.visual](ctx, world, t, lt, k);
    sc.draw(ctx, lt);
    drawChrome(ctx, t, total);
  };

  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const audio = audioFor(script.music ?? "piano", script.seed, total);
    const out = join(dir, "out.mp4");
    const p = spawn(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "pipe:0",
      "-f", "lavfi", "-i", `aevalsrc=exprs='${audio.expr}|${audio.expr}':s=48000:d=${total.toFixed(3)}`,
      "-filter_complex", audio.filter,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high",
      "-r", String(FPS), "-g", String(FPS * 2),
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-t", total.toFixed(3), "-movflags", "+faststart", "-use_editlist", "0", out,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    const done = new Promise<void>((resolve, reject) => {
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${code}): ${err.slice(-600)}`))));
    });
    let writeError: Error | null = null;
    p.stdin.on("error", (e) => (writeError = e));
    for (let f = 0; f < frames && !writeError; f++) {
      drawFrame(f);
      const buf = Buffer.from(canvas.data());
      await new Promise<void>((resolve) => p.stdin.write(buf, (e) => { if (e) writeError = e; resolve(); }));
    }
    p.stdin.end();
    await done;
    if (writeError) throw writeError;
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Para pruebas: dibuja un cuadro suelto como PNG
export function renderReelFramePng(script: ReelScript, t: number): Buffer {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const world = buildWorld(script.seed);
  const { scenes } = buildScenes(ctx, script);
  const si = scenes.findIndex((s) => t >= s.start && t < s.start + s.dur);
  const sc = scenes[si === -1 ? scenes.length - 1 : si];
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  VISUALS[sc.visual](ctx, world, t, t - sc.start, 1);
  sc.draw(ctx, t - sc.start);
  drawChrome(ctx, t, scenes[scenes.length - 1].start + scenes[scenes.length - 1].dur);
  return canvas.toBuffer("image/png");
}
