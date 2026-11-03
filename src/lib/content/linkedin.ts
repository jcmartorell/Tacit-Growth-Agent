import "server-only";
import { getLi, setLi } from "@/lib/content/connections";
import { publicEnv } from "@/lib/env";

// LinkedIn con los productos de autoservicio "Share on LinkedIn" y
// "Sign In with LinkedIn using OpenID Connect". Publica en tu perfil personal.
// El token dura 60 días; al vencer hay que reconectar desde el panel.

const OAUTH = (process.env.LINKEDIN_OAUTH_BASE || "https://www.linkedin.com").replace(/\/+$/, "");
const API = (process.env.LINKEDIN_API_BASE || "https://api.linkedin.com").replace(/\/+$/, "");
export const LI_SCOPES = "openid profile w_member_social";

function creds() {
  const id = process.env.LINKEDIN_CLIENT_ID?.trim();
  const secret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error("Faltan LINKEDIN_CLIENT_ID o LINKEDIN_CLIENT_SECRET en Vercel.");
  return { id, secret };
}

export function redirectUri() {
  return `${publicEnv().siteUrl}/api/linkedin/callback`;
}

export function authorizeUrl(state: string) {
  const { id } = creds();
  const u = new URL(`${OAUTH}/oauth/v2/authorization`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  u.searchParams.set("scope", LI_SCOPES);
  return u.toString();
}

export async function exchangeCode(code: string) {
  const { id, secret } = creds();
  const res = await fetch(`${OAUTH}/oauth/v2/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri(), client_id: id, client_secret: secret,
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !body.access_token) {
    throw new Error(`LinkedIn token: ${(body.error_description as string) ?? `HTTP ${res.status}`}`);
  }
  const token = String(body.access_token);
  const expiresIn = Number(body.expires_in ?? 60 * 86_400);

  const me = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const info = (await me.json().catch(() => ({}))) as Record<string, unknown>;
  if (!me.ok || !info.sub) throw new Error(`LinkedIn userinfo: HTTP ${me.status}`);

  await setLi({
    token,
    personUrn: `urn:li:person:${String(info.sub)}`,
    name: (info.name as string) ?? null,
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    lastError: null,
  });
}

export async function publishLinkedIn(text: string): Promise<string> {
  const c = await getLi();
  if (!c.token || !c.personUrn) throw new Error("LinkedIn no está conectado.");
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
    throw new Error("El acceso a LinkedIn venció. Reconecta LinkedIn en Contenido.");
  }
  const res = await fetch(`${API}/v2/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: c.personUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (res.status !== 201) {
    const t = await res.text().catch(() => "");
    if (res.status === 401) await setLi({ ...c, lastError: "LinkedIn rechazó el acceso. Reconecta LinkedIn." });
    throw new Error(`LinkedIn respondió ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.headers.get("x-restli-id") ?? "publicado";
}
