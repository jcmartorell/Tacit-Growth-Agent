import { NextResponse, type NextRequest } from "next/server";
import { getAuthorizedUser } from "@/lib/auth";
import { exchangeCode } from "@/lib/content/linkedin";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// LinkedIn regresa aquí con ?code=...&state=...
export async function GET(request: NextRequest) {
  const { siteUrl } = publicEnv();
  const back = (q: string) => {
    const res = NextResponse.redirect(`${siteUrl}/contenido?${q}`);
    res.cookies.delete("li_state");
    return res;
  };

  const user = await getAuthorizedUser();
  if (!user) return NextResponse.redirect(`${siteUrl}/login`);

  const p = request.nextUrl.searchParams;
  if (p.get("error")) return back(`li_error=${encodeURIComponent(p.get("error_description") ?? p.get("error")!)}`);
  const state = p.get("state");
  const code = p.get("code");
  if (!state || state !== request.cookies.get("li_state")?.value) {
    return back(`li_error=${encodeURIComponent("La conexión expiró o no coincide. Intenta de nuevo.")}`);
  }
  if (!code) return back(`li_error=${encodeURIComponent("LinkedIn no devolvió el código.")}`);

  try {
    await exchangeCode(code);
    return back("li=ok");
  } catch (e) {
    return back(`li_error=${encodeURIComponent((e as Error).message)}`);
  }
}
