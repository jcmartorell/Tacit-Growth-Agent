import "server-only";
import { typographic } from "@/lib/typography";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

// Imagen de marca 1080x1350 (4:5, formato vertical de Instagram), entregada en JPEG
// porque Instagram solo acepta JPEG.

export const IMG_WIDTH = 1080;
export const IMG_HEIGHT = 1350;

const fontsDir = join(process.cwd(), "assets/fonts");
let fontsPromise: Promise<{ serif: Buffer; sans: Buffer; sansBold: Buffer }> | null = null;
function loadFonts() {
  fontsPromise ??= Promise.all([
    readFile(join(fontsDir, "instrument-serif-latin-400-normal.woff")),
    readFile(join(fontsDir, "dm-sans-latin-400-normal.woff")),
    readFile(join(fontsDir, "dm-sans-latin-600-normal.woff")),
  ]).then(([serif, sans, sansBold]) => ({ serif, sans, sansBold }));
  return fontsPromise;
}

const INK = "#18232E";
const PULSE = "#1A9E78";
const SAND = "#F4EFE6";
const MIST = "#8A9BA8";

// Tamaño del título según su largo, para que nunca se desborde
function headlineSize(text: string) {
  if (text.length <= 30) return 104;
  if (text.length <= 50) return 88;
  if (text.length <= 70) return 76;
  return 64;
}

export async function renderPostJpeg(rawHeadline: string, rawSubline: string, lang: "es" | "en"): Promise<Buffer> {
  const headline = typographic(rawHeadline);
  const subline = typographic(rawSubline);
  const f = await loadFonts();
  const png = new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", backgroundColor: SAND, padding: "96px 88px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 512 512">
            <g stroke={PULSE} strokeWidth="26" strokeLinecap="round" fill="none">
              <line x1="40" y1="92" x2="166" y2="92" />
              <line x1="346" y1="92" x2="472" y2="92" />
              <line x1="104" y1="92" x2="256" y2="244" />
              <line x1="408" y1="92" x2="256" y2="244" />
              <line x1="256" y1="244" x2="256" y2="432" />
            </g>
          </svg>
          <span style={{ fontFamily: "Instrument Serif", fontSize: 48, color: INK }}>Tacit</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          <div style={{ width: 96, height: 8, backgroundColor: PULSE, borderRadius: 4 }} />
          <div style={{ fontFamily: "Instrument Serif", fontSize: headlineSize(headline), lineHeight: 1.08, color: INK }}>
            {headline}
          </div>
          {subline && (
            <div style={{ fontFamily: "DM Sans", fontSize: 40, lineHeight: 1.35, color: INK, opacity: 0.8 }}>
              {subline}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "DM Sans", fontSize: 30, color: MIST }}>
          <span style={{ fontWeight: 600, color: INK }}>tacit.guru</span>
          <span>{lang === "es" ? "El conocimiento de tu gente, en acción" : "Your people's knowledge, in action"}</span>
        </div>
      </div>
    ),
    {
      width: IMG_WIDTH,
      height: IMG_HEIGHT,
      fonts: [
        { name: "Instrument Serif", data: f.serif, weight: 400, style: "normal" },
        { name: "DM Sans", data: f.sans, weight: 400, style: "normal" },
        { name: "DM Sans", data: f.sansBold, weight: 600, style: "normal" },
      ],
    },
  );
  const buf = Buffer.from(await png.arrayBuffer());
  return sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
