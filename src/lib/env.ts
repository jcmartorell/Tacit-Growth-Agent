// Lee variables de entorno y falla con un mensaje claro si falta alguna.

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Falta la variable de entorno ${name}. Revisa .env.local o Vercel.`);
  }
  return value.trim();
}

// Públicas (se pueden usar en el navegador). Deben leerse con el nombre literal
// para que Next.js las incluya en el build.
export function publicEnv() {
  return {
    supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    siteUrl: required("NEXT_PUBLIC_SITE_URL", process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, ""),
  };
}

// Lista de correos autorizados, separados por coma. Comparación sin mayúsculas.
export function allowedEmails(): string[] {
  return required("ALLOWED_EMAILS", process.env.ALLOWED_EMAILS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedEmails().includes(email.trim().toLowerCase());
}
