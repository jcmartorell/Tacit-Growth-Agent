import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAuthorizedUser } from "@/lib/auth";
import { gmailAuthorizeUrl } from "@/lib/email/gmail";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Inicia la conexión del buzón de Google Workspace. Solo el usuario autorizado del panel.
export async function GET() {
  const { siteUrl } = publicEnv();
  const user = await getAuthorizedUser();
  if (!user) return NextResponse.redirect(`${siteUrl}/login`);
  const state = randomBytes(16).toString("hex");
  let url: string;
  try {
    url = gmailAuthorizeUrl(state);
  } catch (e) {
    return NextResponse.redirect(`${siteUrl}/configuracion?g_error=${encodeURIComponent((e as Error).message)}`);
  }
  const res = NextResponse.redirect(url);
  res.cookies.set("g_state", state, { httpOnly: true, secure: siteUrl.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
