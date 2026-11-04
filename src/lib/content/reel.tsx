import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import ffmpegPath from "ffmpeg-static";

// Reel de marca 1080x1920 a 30 fps: texto que aparece palabra por palabra,
// barra de progreso, transición entre escenas y una base musical generada (sin derechos).
// Cada escena se codifica en su propio archivo; se unen sin recodificar y al final se agrega el audio.

export type ReelScript = {
  hook: string;      // frase de enganche, máximo ~7 palabras
  points: string[];  // 3 ideas cortas
  cta: string;       // cierre
  lang: "es" | "en";
  seed: number;      // varía la progresión musical
};

const W = 1080;
const H = 1920;
const FPS = 30;
const INK = "#18232E";
const PULSE = "#1A9E78";
const SAND = "#F4EFE6";
const MIST = "#8A9BA8";
const WORD_STEP = 0.16; // segundos entre palabras

const fontsDir = join(process.cwd(), "assets/fonts");
let fonts: Promise<{ serif: Buffer; sans: Buffer; sansBold: Buffer }> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(join(fontsDir, "instrument-serif-latin-400-normal.woff")),
    readFile(join(fontsDir, "dm-sans-latin-400-normal.woff")),
    readFile(join(fontsDir, "dm-sans-latin-600-normal.woff")),
  ]).then(([serif, sans, sansBold]) => ({ serif, sans, sansBold })));

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <g stroke={PULSE} strokeWidth="26" strokeLinecap="round" fill="none">
        <line x1="40" y1="92" x2="166" y2="92" />
        <line x1="346" y1="92" x2="472" y2="92" />
        <line x1="104" y1="92" x2="256" y2="244" />
        <line x1="408" y1="92" x2="256" y2="244" />
        <line x1="256" y1="244" x2="256" y2="432" />
      </g>
    </svg>
  );
}

// Palabras con las primeras `shown` visibles; las demás ocupan su lugar pero invisibles (sin saltos de línea)
function Words({ text, shown, size, font, weight, color, accentLast }: {
  text: string; shown: number; size: number; font: string; weight: number; color: string; accentLast?: boolean;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1.12, color }}>
      {words.map((w, i) => (
        <span
          key={i}
          style={{
            marginRight: size * 0.26,
            opacity: i < shown ? 1 : 0,
            color: accentLast && i === words.length - 1 ? PULSE : color,
          }}
        >
          {w}
        </span>
      ))}
    </div>
  );
}

function Frame({ children, footer = true }: { children: React.ReactNode; footer?: boolean }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: INK, padding: "140px 96px 120px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <Mark size={52} />
        <span style={{ fontFamily: "Instrument Serif", fontSize: 46, color: SAND }}>Tacit</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>{children}</div>
      {footer && (
        <div style={{ display: "flex", fontFamily: "DM Sans", fontSize: 32, color: MIST }}>tacit.guru</div>
      )}
    </div>
  );
}

async function png(el: React.ReactElement): Promise<Buffer> {
  const f = await loadFonts();
  const res = new ImageResponse(el, {
    width: W,
    height: H,
    fonts: [
      { name: "Instrument Serif", data: f.serif, weight: 400, style: "normal" },
      { name: "DM Sans", data: f.sans, weight: 400, style: "normal" },
      { name: "DM Sans", data: f.sansBold, weight: 600, style: "normal" },
    ],
  });
  return Buffer.from(await res.arrayBuffer());
}

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

type Scene = { frames: Buffer[]; step: number; duration: number };

async function buildScenes(s: ReelScript): Promise<Scene[]> {
  const scenes: Scene[] = [];

  // 1) Gancho: titular grande, palabra por palabra, la última en verde
  const hookN = wordCount(s.hook);
  const hookSize = s.hook.length > 40 ? 104 : s.hook.length > 26 ? 120 : 138;
  const hookFrames: Buffer[] = [];
  for (let k = 1; k <= hookN; k++) {
    hookFrames.push(await png(
      <Frame>
        <div style={{ width: 120, height: 10, backgroundColor: PULSE, borderRadius: 5, marginBottom: 56 }} />
        <Words text={s.hook} shown={k} size={hookSize} font="Instrument Serif" weight={400} color={SAND} accentLast />
      </Frame>,
    ));
  }
  scenes.push({ frames: hookFrames, step: WORD_STEP + 0.04, duration: Math.max(3.2, hookN * (WORD_STEP + 0.04) + 1.6) });

  // 2) Ideas numeradas
  for (let i = 0; i < s.points.length; i++) {
    const text = s.points[i];
    const n = wordCount(text);
    const frames: Buffer[] = [];
    for (let k = 1; k <= n; k++) {
      frames.push(await png(
        <Frame>
          <div style={{ display: "flex", fontFamily: "Instrument Serif", fontSize: 220, color: PULSE, lineHeight: 1, marginBottom: 40 }}>
            {String(i + 1).padStart(2, "0")}
          </div>
          <Words text={text} shown={k} size={text.length > 70 ? 64 : 76} font="DM Sans" weight={600} color={SAND} />
        </Frame>,
      ));
    }
    scenes.push({ frames, step: WORD_STEP, duration: Math.max(3.4, n * WORD_STEP + 1.8) });
  }

  // 3) Cierre con marca
  const ctaFrames = [await png(
    <Frame footer={false}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 48 }}>
        <Mark size={220} />
        <div style={{ display: "flex", fontFamily: "Instrument Serif", fontSize: 96, color: SAND, textAlign: "center", justifyContent: "center" }}>{s.cta}</div>
        <div style={{ display: "flex", fontFamily: "DM Sans", fontWeight: 600, fontSize: 52, color: PULSE }}>tacit.guru</div>
      </div>
    </Frame>,
  )];
  scenes.push({ frames: ctaFrames, step: 0, duration: 3.2 });
  return scenes;
}

function run(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg no está disponible en el servidor."));
    const p = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg (${code}): ${err.slice(-600)}`))));
  });
}

// Base musical generada: progresión de 4 acordes, pulso suave a 112 bpm y hi-hat a contratiempo
function musicExpr(seed: number, total: number) {
  const progs = [
    [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]], // Am F C G
    [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]], // C G Am F
    [[146.83, 174.61, 220], [233.08, 293.66, 349.23], [174.61, 220, 261.63], [261.63, 329.63, 392]], // Dm Bb F C
  ];
  const prog = progs[Math.abs(seed) % progs.length];
  const bar = 4; // segundos por acorde
  const chord = (n: number) =>
    prog.reduceRight((acc, c, i) => `if(lt(mod(t,${bar * 4}),${bar * (i + 1)}),${c[n]},${acc})`, String(prog[0][n]));
  const beat = 60 / 112;
  const pad = `0.06*(sin(2*PI*${chord(0)}*t)+sin(2*PI*${chord(1)}*t)+0.8*sin(2*PI*${chord(2)}*t)+0.5*sin(2*PI*${chord(0)}*t/2))*(0.75+0.25*sin(2*PI*0.5*t))`;
  const kick = `0.35*sin(2*PI*(48+70*exp(-30*mod(t,${beat})))*mod(t,${beat}))*exp(-8*mod(t,${beat}))`;
  const hat = `0.025*(2*random(0)-1)*exp(-70*mod(t+${beat / 2},${beat}))`;
  const fade = `min(1,t/1.2)*min(1,(${total}-t)/1.6)`;
  return `(${pad}+${kick}+${hat})*${fade}`;
}

export async function renderReelMp4(script: ReelScript): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const scenes = await buildScenes(script);
    const total = scenes.reduce((a, s) => a + s.duration, 0);
    let offset = 0;
    const sceneFiles: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      // Lista para el demuxer concat: cada imagen dura un paso; la última se sostiene
      const lines: string[] = [];
      sc.frames.forEach((buf, k) => {
        const name = `s${i}_${k}.png`;
        lines.push(`file '${name}'`);
        const isLast = k === sc.frames.length - 1;
        lines.push(`duration ${isLast ? Math.max(0.5, sc.duration - sc.step * (sc.frames.length - 1)).toFixed(3) : sc.step.toFixed(3)}`);
      });
      lines.push(`file 's${i}_${sc.frames.length - 1}.png'`);
      await Promise.all(sc.frames.map((buf, k) => writeFile(join(dir, `s${i}_${k}.png`), buf)));
      await writeFile(join(dir, `s${i}.txt`), lines.join("\n"));

      const d = sc.duration.toFixed(3);
      // Barra de progreso continua entre escenas y entrada suave de cada escena
      const filter = [
        `[0:v]fps=${FPS},trim=duration=${d},setpts=PTS-STARTPTS,format=yuv420p,fade=t=in:st=0:d=0.28:color=0x18232E[bg]`,
        `[bg][1:v]overlay=x='-w+w*(t+${offset.toFixed(3)})/${total.toFixed(3)}':y=0:eval=frame:shortest=1,format=yuv420p[v]`,
      ].join(";");
      const tmp = `s${i}.part.mp4`;
      await run([
        "-f", "concat", "-safe", "0", "-i", `s${i}.txt`,
        "-f", "lavfi", "-i", `color=c=0x1A9E78:s=${W}x12:r=${FPS}:d=${d}`,
        "-filter_complex", filter, "-map", "[v]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), "-g", String(FPS * 2),
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-an", tmp,
      ], dir);
      await rename(join(dir, tmp), join(dir, `s${i}.mp4`));
      sceneFiles.push(`s${i}.mp4`);
      offset += sc.duration;
    }

    await writeFile(join(dir, "scenes.txt"), sceneFiles.map((f) => `file '${f}'`).join("\n"));
    await run(["-f", "concat", "-safe", "0", "-i", "scenes.txt", "-c", "copy", "video.mp4"], dir);

    const expr = musicExpr(script.seed, total);
    await run([
      "-i", "video.mp4",
      "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}|${expr}':s=48000:d=${total.toFixed(3)}`,
      "-filter_complex", "[1:a]lowpass=f=4200,aecho=0.8:0.6:180:0.25[a]",
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
      "-shortest", "-movflags", "+faststart", "-use_editlist", "0", "out.part.mp4",
    ], dir);
    await rename(join(dir, "out.part.mp4"), join(dir, "out.mp4"));
    return await readFile(join(dir, "out.mp4"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
