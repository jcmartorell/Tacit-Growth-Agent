import { NextResponse, type NextRequest } from "next/server";
import { createSessionClient } from "@/lib/supabase/server";
import { isAllowedEmail, publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// El enlace del correo llega aquí con ?code=... y se cambia por una sesión.
export async function GET(request: NextRequest) {
  const { siteUrl } = publicEnv();
  const code = request.nextUrl.searchParams.get("code");
  const fail = (msg: string) =>
    NextResponse.redirect(`${siteUrl}/login?error=${encodeURIComponent(msg)}`);

  if (!code) return fail("Enlace inválido o incompleto.");

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return fail("El enlace expiró o se abrió en otro navegador. Pide uno nuevo.");
  }

  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return fail("Este correo no está autorizado.");
  }

  return NextResponse.redirect(`${siteUrl}/`);
}
