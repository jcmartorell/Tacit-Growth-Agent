"use server";

import { createSessionClient } from "@/lib/supabase/server";
import { isAllowedEmail, publicEnv } from "@/lib/env";

export type LoginState = { ok: boolean; message: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: "Escribe un correo válido." };
  }
  // Solo se envía enlace a correos de la lista ALLOWED_EMAILS
  if (!isAllowedEmail(email)) {
    return { ok: false, message: "Este correo no está autorizado." };
  }

  const { siteUrl } = publicEnv();
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });

  if (error) {
    console.error("[login] signInWithOtp:", error.message);
    return { ok: false, message: `No se pudo enviar el enlace: ${error.message}` };
  }
  return {
    ok: true,
    message: "Listo. Abre el enlace del correo en este mismo navegador.",
  };
}
