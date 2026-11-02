import type { NextConfig } from "next";

// Panel interno: todo se calcula en cada petición. Sin caché de componentes
// para evitar datos viejos o rutas cacheadas en silencio.
const nextConfig: NextConfig = {};

export default nextConfig;
