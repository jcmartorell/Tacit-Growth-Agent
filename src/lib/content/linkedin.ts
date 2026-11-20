import "server-only";
import { getLi, setLi, type LiConnection } from "@/lib/content/connections";
import { publicEnv } from "@/lib/env";

// LinkedIn: publica SOLO en la página de empresa de Tacit, nunca en el perfil personal.
// Requiere una app de LinkedIn con el producto "Community Management API" (aprobación de LinkedIn)
// y que quien conecta sea administrador de la página. El token dura 60 días; al vencer se reconecta.

const OAUTH = (process.env.LINKEDIN_OAUTH_BASE || "https://www.linkedin.com").replace(/\/+$/, "");
const API = (process.env.LINKEDIN_API_BASE || "https://api.linkedin.com").replace(/\/+$/, "");
const VERSION = process.env.LINKEDIN_API_VERSION?.trim() || "202605";
export const LI_SCOPES = process.env.LINKEDIN_SCOPES?.trim() || "w_organization_social rw_organization_admin";

export const LI_PAGE_PENDING =
  "No se publicó: LinkedIn todavía no está conectado a la página de Tacit. Copia el texto, publícalo en la página y dale «Marcar como publicado».";

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

const restHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
});

// Páginas de empresa que administra quien conectó
async function adminOrganizations(token: string): Promise<string[]> {
  const res = await fetch(`${API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, {
    headers: restHeaders(token), signal: AbortSignal.timeout(30_000), cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { elements?: { organization?: string }[]; message?: string };
  if (!res.ok) throw new Error(`LinkedIn (páginas que administras): ${body.message ?? `HTTP ${res.status}`}`);
  return (body.elements ?? []).map((e) => e.organization).filter((o): o is string => Boolean(o));
}

async function organizationName(token: string, urn: string): Promise<string | null> {
  const id = urn.split(":").pop();
  const res = await fetch(`${API}/rest/organizations/${id}`, { headers: restHeaders(token), signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { localizedName?: string };
  return body.localizedName ?? null;
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

  const orgs = await adminOrganizations(token);
  const wanted = process.env.LINKEDIN_ORG_ID?.trim();
  const orgUrn = wanted ? orgs.find((o) => o.endsWith(`:${wanted}`)) : orgs.length === 1 ? orgs[0] : undefined;
  if (!orgUrn) {
    throw new Error(
      orgs.length === 0
        ? "Tu cuenta no aparece como administradora de ninguna página de empresa en LinkedIn."
        : wanted
          ? `No administras la página ${wanted}. Páginas encontradas: ${orgs.join(", ")}`
          : `Administras varias páginas (${orgs.join(", ")}). Pon en Vercel LINKEDIN_ORG_ID con el número de la de Tacit.`,
    );
  }
  await setLi({
    token,
    personUrn: null,
    orgUrn,
    name: (await organizationName(token, orgUrn)) ?? orgUrn,
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    lastError: null,
  });
}

// Texto en el formato "little text" de LinkedIn: estos caracteres se escapan o el post se corta
function littleText(t: string) {
  return t.replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => `\\${c}`);
}

async function liJson(c: { token: string }, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...restHeaders(c.token), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`LinkedIn ${path.split("?")[0]} respondió ${res.status}: ${text.slice(0, 200)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function putBytes(c: { token: string }, url: string, bytes: Uint8Array) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/octet-stream" },
    body: new Blob([new Uint8Array(bytes)]),
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  if (!res.ok && res.status !== 201) throw new Error(`LinkedIn (subir archivo) respondió ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.headers.get("etag");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mediaStatus(c: { token: string }, kind: "images" | "videos", urn: string): Promise<string> {
  const v = await liJson(c, "GET", `/rest/${kind}/${encodeURIComponent(urn)}`);
  return String(v.status ?? "");
}

async function connected() {
  const c = await getLi();
  // Sin página conectada no se publica nada (una conexión vieja de perfil personal se ignora)
  if (!c.token || !c.orgUrn) throw new Error(LI_PAGE_PENDING);
  if (c.expiresAt && new Date(c.expiresAt).getTime() < Date.now()) {
    throw new Error("El acceso a LinkedIn venció. Reconecta LinkedIn en Contenido.");
  }
  return { ...c, token: c.token, orgUrn: c.orgUrn };
}

// Imagen: se sube y se espera a que LinkedIn la procese (segundos)
export async function uploadLinkedInImage(jpeg: Uint8Array): Promise<string> {
  const c = await connected();
  const init = await liJson(c, "POST", "/rest/images?action=initializeUpload", { initializeUploadRequest: { owner: c.orgUrn } });
  const v = init.value as { uploadUrl?: string; image?: string } | undefined;
  if (!v?.uploadUrl || !v.image) throw new Error("LinkedIn no devolvió dónde subir la imagen.");
  await putBytes(c, v.uploadUrl, jpeg);
  for (let i = 0; i < 10; i++) {
    const st = await mediaStatus(c, "images", v.image);
    if (st === "AVAILABLE") return v.image;
    if (st === "PROCESSING_FAILED") throw new Error("LinkedIn no pudo procesar la imagen.");
    await sleep(1500);
  }
  return v.image; // normalmente ya está; si no, LinkedIn la toma al publicar
}

// Video: subida en partes; devuelve el URN. LinkedIn lo procesa después (puede tardar minutos).
export async function uploadLinkedInVideo(mp4: Uint8Array): Promise<string> {
  const c = await connected();
  const init = await liJson(c, "POST", "/rest/videos?action=initializeUpload", {
    initializeUploadRequest: { owner: c.orgUrn, fileSizeBytes: mp4.byteLength, uploadCaptions: false, uploadThumbnail: false },
  });
  const v = init.value as { video?: string; uploadToken?: string; uploadInstructions?: { uploadUrl: string; firstByte: number; lastByte: number }[] } | undefined;
  if (!v?.video || !v.uploadInstructions?.length) throw new Error("LinkedIn no devolvió dónde subir el video.");
  const etags: string[] = [];
  for (const part of v.uploadInstructions) {
    const etag = await putBytes(c, part.uploadUrl, mp4.subarray(part.firstByte, part.lastByte + 1));
    if (!etag) throw new Error("LinkedIn no confirmó una parte del video.");
    etags.push(etag);
  }
  await liJson(c, "POST", "/rest/videos?action=finalizeUpload", {
    finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken ?? "", uploadedPartIds: etags },
  });
  return v.video;
}

// Estado del video: "listo", "procesando" o lanza error si falló
export async function linkedInVideoReady(urn: string, waitSeconds = 40): Promise<boolean> {
  const c = await connected();
  const end = Date.now() + waitSeconds * 1000;
  for (;;) {
    const st = await mediaStatus(c, "videos", urn);
    if (st === "AVAILABLE") return true;
    if (st === "PROCESSING_FAILED") throw new Error("LinkedIn no pudo procesar el video.");
    if (Date.now() > end) return false;
    await sleep(4000);
  }
}

// Video lleva "title"; imagen lleva "altText" (texto alternativo)
function mediaBody(m: { id: string; title?: string }) {
  if (!m.title) return { id: m.id };
  return m.id.includes(":video:") ? { id: m.id, title: m.title.slice(0, 200) } : { id: m.id, altText: m.title.slice(0, 4000) };
}

async function publishAsOrganization(c: LiConnection & { token: string; orgUrn: string }, text: string, media?: { id: string; title?: string }): Promise<string> {
  const res = await fetch(`${API}/rest/posts`, {
    method: "POST",
    headers: { ...restHeaders(c.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      author: c.orgUrn,
      commentary: littleText(text),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(media ? { content: { media: mediaBody(media) } } : {}),
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (res.status !== 201) {
    const t = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) await setLi({ ...c, lastError: `LinkedIn rechazó publicar en la página (${res.status}). Reconecta LinkedIn.` });
    throw new Error(`LinkedIn respondió ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.headers.get("x-restli-id") ?? "publicado";
}

export async function publishLinkedIn(text: string, media?: { id: string; title?: string }): Promise<string> {
  const c = await connected();
  return publishAsOrganization(c, text, media);
}
