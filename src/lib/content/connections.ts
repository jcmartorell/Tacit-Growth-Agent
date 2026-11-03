import "server-only";
import { getState, setState } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

// Tokens de las cuentas conectadas. Se guardan en la tabla settings (solo el servidor
// puede leerla: RLS sin políticas) y nunca se muestran en el panel.

export type IgConnection = {
  token: string | null;
  userId: string | null;
  username: string | null;
  connectedAt: string | null;
  refreshedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
};

export type LiConnection = {
  token: string | null;
  personUrn: string | null;
  name: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
};

const IG_EMPTY: IgConnection = { token: null, userId: null, username: null, connectedAt: null, refreshedAt: null, expiresAt: null, lastError: null };
const LI_EMPTY: LiConnection = { token: null, personUrn: null, name: null, connectedAt: null, expiresAt: null, lastError: null };

export const getIg = () => getState<IgConnection>("conn_instagram", IG_EMPTY);
export const setIg = (v: IgConnection) => setState("conn_instagram", v);
export const getLi = () => getState<LiConnection>("conn_linkedin", LI_EMPTY);
export const setLi = (v: LiConnection) => setState("conn_linkedin", v);

export async function disconnect(which: "instagram" | "linkedin") {
  const db = createAdminClient();
  const { error } = await db.from("settings").delete().eq("key", which === "instagram" ? "conn_instagram" : "conn_linkedin");
  if (error) throw new Error(error.message);
}

// Lo que el panel puede mostrar (sin tokens)
export async function connectionStatus() {
  const [ig, li] = await Promise.all([getIg(), getLi()]);
  return {
    instagram: { connected: Boolean(ig.token), username: ig.username, expiresAt: ig.expiresAt, lastError: ig.lastError },
    linkedin: { connected: Boolean(li.token), name: li.name, expiresAt: li.expiresAt, lastError: li.lastError },
  };
}
