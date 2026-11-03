import "server-only";
import { getState, setState } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

// Gmail API con OAuth de Google Workspace (app "Interna": no requiere verificación de Google).
// Permisos: enviar correo y leer (solo para detectar respuestas y rebotes en los hilos enviados).

const ACCOUNTS = (process.env.GOOGLE_OAUTH_BASE || "https://accounts.google.com").replace(/\/+$/, "");
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const GMAIL = (process.env.GMAIL_API_BASE || "https://gmail.googleapis.com").replace(/\/+$/, "");
export const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

export type GmailConnection = {
  refreshToken: string | null;
  email: string | null;
  connectedAt: string | null;
  lastError: string | null;
};
const EMPTY: GmailConnection = { refreshToken: null, email: null, connectedAt: null, lastError: null };
export const getGmail = () => getState<GmailConnection>("conn_gmail", EMPTY);
const setGmail = (v: GmailConnection) => setState("conn_gmail", v);

export async function disconnectGmail() {
  const db = createAdminClient();
  const { error } = await db.from("settings").delete().eq("key", "conn_gmail");
  if (error) throw new Error(error.message);
}

function creds() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en Vercel.");
  return { id, secret };
}

export const gmailRedirectUri = () => `${publicEnv().siteUrl}/api/google/callback`;

export function gmailAuthorizeUrl(state: string) {
  const { id } = creds();
  const u = new URL(`${ACCOUNTS}/o/oauth2/v2/auth`);
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", gmailRedirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES);
  u.searchParams.set("access_type", "offline"); // para recibir refresh token
  u.searchParams.set("prompt", "consent");      // fuerza el refresh token aunque ya se haya autorizado antes
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !body.access_token) {
    throw new Error(`Google token: ${(body.error_description as string) ?? (body.error as string) ?? `HTTP ${res.status}`}`);
  }
  return body as { access_token: string; refresh_token?: string };
}

export async function gmailExchangeCode(code: string) {
  const { id, secret } = creds();
  const t = await tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: gmailRedirectUri(), client_id: id, client_secret: secret,
  });
  if (!t.refresh_token) throw new Error("Google no entregó acceso permanente. Desconecta la app en tu cuenta de Google e intenta de nuevo.");
  const profile = await gmailFetch("/gmail/v1/users/me/profile", t.access_token);
  await setGmail({
    refreshToken: t.refresh_token,
    email: String(profile.emailAddress ?? "").toLowerCase() || null,
    connectedAt: new Date().toISOString(),
    lastError: null,
  });
}

// Token de acceso de corta duración (1 h), pedido en cada ejecución
export async function gmailAccessToken(): Promise<{ token: string; email: string }> {
  const c = await getGmail();
  if (!c.refreshToken || !c.email) throw new Error("Gmail no está conectado.");
  const { id, secret } = creds();
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: c.refreshToken, client_id: id, client_secret: secret });
    if (c.lastError) await setGmail({ ...c, lastError: null });
    return { token: t.access_token, email: c.email };
  } catch (e) {
    await setGmail({ ...c, lastError: `Acceso a Gmail rechazado: ${(e as Error).message}. Reconecta Gmail.` });
    throw e;
  }
}

async function gmailFetch(path: string, token: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${GMAIL}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = body.error as { message?: string } | undefined;
    throw new Error(`Gmail ${path}: ${err?.message ?? `HTTP ${res.status}`}`);
  }
  return body;
}

// ---------- Construcción del mensaje (RFC 2822) ----------

// Quita saltos de línea para impedir inyección de encabezados
const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
const encWord = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`);
const b64Wrapped = (v: string) => Buffer.from(v, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");

export function buildRaw(m: {
  fromName: string; fromEmail: string; toName: string; toEmail: string;
  subject: string; body: string; inReplyTo?: string | null;
}): string {
  const to = oneLine(m.toEmail);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error(`Correo de destino inválido: ${to}`);
  const headers = [
    `From: ${encWord(oneLine(m.fromName))} <${oneLine(m.fromEmail)}>`,
    `To: ${encWord(oneLine(m.toName))} <${to}>`,
    `Subject: ${encWord(oneLine(m.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (m.inReplyTo) {
    headers.push(`In-Reply-To: ${oneLine(m.inReplyTo)}`, `References: ${oneLine(m.inReplyTo)}`);
  }
  const text = m.body.replace(/\r?\n/g, "\r\n");
  const raw = `${headers.join("\r\n")}\r\n\r\n${b64Wrapped(text)}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export async function sendMessage(token: string, raw: string, threadId?: string | null) {
  const sent = await gmailFetch("/gmail/v1/users/me/messages/send", token, {
    method: "POST",
    body: threadId ? { raw, threadId } : { raw },
  });
  const id = String(sent.id ?? "");
  const thread = String(sent.threadId ?? "");
  if (!id || !thread) throw new Error("Gmail no devolvió el id del mensaje.");
  // Message-ID real (lo pone Gmail) para que los seguimientos queden en el mismo hilo del destinatario
  const meta = await gmailFetch(`/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Message-ID`, token);
  const hdrs = ((meta.payload as { headers?: { name: string; value: string }[] } | undefined)?.headers ?? []);
  const rfc = hdrs.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
  return { id, threadId: thread, rfcMessageId: rfc };
}

export type ThreadState = "sin_respuesta" | "respondio" | "rebote";

// Revisa un hilo: ¿alguien distinto a nosotros escribió? ¿es un rebote?
export async function threadState(token: string, threadId: string, ownEmail: string): Promise<ThreadState> {
  const t = await gmailFetch(`/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From`, token);
  const msgs = (t.messages as { payload?: { headers?: { name: string; value: string }[] } }[] | undefined) ?? [];
  let state: ThreadState = "sin_respuesta";
  for (const m of msgs) {
    const from = (m.payload?.headers ?? []).find((h) => h.name.toLowerCase() === "from")?.value.toLowerCase() ?? "";
    if (!from || from.includes(ownEmail)) continue;
    if (/mailer-daemon|postmaster|mail delivery/.test(from)) state = "rebote";
    else return "respondio";
  }
  return state;
}
