import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthorizedUser } from "@/lib/auth";
import { authorizeUrl } from "@/lib/content/linkedin";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Inicia la conexión con LinkedIn. Solo el usuario autorizado del panel puede hacerlo.
export async function GET() {
  const { siteUrl } = publicEnv();
  const user = await getAuthorizedUser();
  if (!user) return NextResponse.redirect(`${siteUrl}/login`);

  // "state" aleatorio en cookie para evitar que otro sitio complete la conexión por ti
  const state = randomBytes(16).toString("hex");
  let url: string;
  try {
    url = authorizeUrl(state);
  } catch (e) {
    return NextResponse.redirect(`${siteUrl}/contenido?li_error=${encodeURIComponent((e as Error).message)}`);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("li_state", state, { httpOnly: true, secure: siteUrl.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
