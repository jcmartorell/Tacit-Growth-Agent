import "server-only";
import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/env";

// Verificación real de acceso. Se llama en el layout del panel y en cada ruta de API.
// getUser() valida la sesión contra Supabase (no confía solo en la cookie).
export async function getAuthorizedUser() {
  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  if (!isAllowedEmail(data.user.email)) return null;
  return data.user;
}

export async function requireUser() {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login");
  return user;
}
