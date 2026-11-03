import { NextResponse, type NextRequest } from "next/server";

// Vercel Cron manda "Authorization: Bearer <CRON_SECRET>". Devuelve una respuesta de error
// si no coincide, o null si la petición es válida.
export function rejectIfNotCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Falta la variable de entorno CRON_SECRET." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return null;
}
