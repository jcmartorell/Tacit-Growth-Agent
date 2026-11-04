import { unstable_rethrow } from "next/navigation";

// En producción Next.js oculta el mensaje de los errores que lanza una server action.
// Por eso las acciones devuelven el error como dato y el cliente lo vuelve a lanzar con su texto.

export type ActionFailure = { actionError: string };

export async function guard<T>(fn: () => Promise<T>): Promise<T | ActionFailure> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e); // deja pasar redirect() y demás señales internas de Next
    return { actionError: e instanceof Error ? e.message : "Error inesperado." };
  }
}

export function unwrap<T>(r: T | ActionFailure): T {
  if (r && typeof r === "object" && "actionError" in r) throw new Error((r as ActionFailure).actionError);
  return r as T;
}
