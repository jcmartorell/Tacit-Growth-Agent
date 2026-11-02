import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

// Cliente con llave service_role: salta RLS. NUNCA debe llegar al navegador.
// "server-only" hace que el build falle si alguien lo importa en un componente de cliente.
export function createAdminClient() {
  const { supabaseUrl } = publicEnv();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Falta la variable de entorno SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(supabaseUrl, key.trim(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
