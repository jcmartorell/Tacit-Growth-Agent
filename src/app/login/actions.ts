"use server";

import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import { isAllowedEmail, publicEnv } from "@/lib/env";

export type LoginState = { ok: boolean; message: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Un solo formulario con dos botones:
// - "Entrar" usa correo + contraseña (no envía correo, sin límite de envíos)
// - "Enviar enlace" manda un enlace mágico al correo
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const mode = String(formData.get("mode") ?? "password");

  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: "Escribe un correo válido." };
  }
  if (!isAllowedEmail(email)) {
    return { ok: false, message: "Este correo no está autorizado." };
  }

  const supabase = await createSessionClient();

  if (mode === "password") {
    if (!password) {
      return { ok: false, message: "Escribe tu contraseña o usa \"Enviar enlace\"." };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error("[login] signInWithPassword:", error.message);
      return { ok: false, message: "Correo o contraseña incorrectos." };
    }
    redirect("/");
  }

  const { siteUrl } = publicEnv();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback` },
  });
  if (error) {
    console.error("[login] signInWithOtp:", error.message);
    return { ok: false, message: `No se pudo enviar el enlace: ${error.message}` };
  }
  return { ok: true, message: "Listo. Abre el enlace del correo en este mismo navegador." };
}
