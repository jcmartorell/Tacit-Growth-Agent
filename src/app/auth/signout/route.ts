import { NextResponse } from "next/server";
import { createSessionClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Solo POST, para que un enlace externo no pueda cerrar la sesión.
export async function POST() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${publicEnv().siteUrl}/login`, { status: 303 });
}
