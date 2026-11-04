import type { NextConfig } from "next";

// Panel interno: todo se calcula en cada petición. Sin caché de componentes
// para evitar datos viejos o rutas cacheadas en silencio.
const nextConfig: NextConfig = {
  // Las fuentes de la imagen de los posts se leen del disco: hay que incluirlas en el deploy
  outputFileTracingIncludes: {
    // Las claves son globs (picomatch): "*" cubre el segmento dinámico [id]
    "/api/img/*": ["./assets/fonts/**"],
    // Reels: fuentes y el binario de ffmpeg en las rutas que generan o publican video
    "/api/cron/*": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg", "./node_modules/@napi-rs/canvas-linux-x64-gnu/**"],
    "/contenido": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg", "./node_modules/@napi-rs/canvas-linux-x64-gnu/**"],
  },
  serverExternalPackages: ["sharp", "ffmpeg-static", "@napi-rs/canvas"],
};

export default nextConfig;
