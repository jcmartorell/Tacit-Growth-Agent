import { NextResponse, type NextRequest } from "next/server";
import { getAuthorizedUser } from "@/lib/auth";
import { gmailExchangeCode } from "@/lib/email/gmail";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { siteUrl } = publicEnv();
  const back = (q: string) => {
    const res = NextResponse.redirect(`${siteUrl}/configuracion?${q}`);
    res.cookies.delete("g_state");
    return res;
  };
  const user = await getAuthorizedUser();
  if (!user) return NextResponse.redirect(`${siteUrl}/login`);

  const p = request.nextUrl.searchParams;
  if (p.get("error")) return back(`g_error=${encodeURIComponent(p.get("error")!)}`);
  const state = p.get("state");
  if (!state || state !== request.cookies.get("g_state")?.value) {
    return back(`g_error=${encodeURIComponent("La conexión expiró o no coincide. Intenta de nuevo.")}`);
  }
  const code = p.get("code");
  if (!code) return back(`g_error=${encodeURIComponent("Google no devolvió el código.")}`);
  try {
    await gmailExchangeCode(code);
    return back("g=ok");
  } catch (e) {
    return back(`g_error=${encodeURIComponent((e as Error).message)}`);
  }
}
