import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

// Cliente de Supabase ligado a la sesión del usuario (cookies).
// Solo se usa para autenticación. Los datos se leen con el cliente admin.
export async function createSessionClient() {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: no se pueden escribir cookies ahí.
          // El proxy renueva la sesión, así que es seguro ignorarlo.
        }
      },
    },
  });
}
