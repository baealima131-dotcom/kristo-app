/**
 * Optional public counts for a Facebook video, read only through Meta's Graph API.
 *
 * oEmbed (used to confirm and embed the video) never returns counts. Graph API counts need an
 * access token, and for videos on Pages the app does not manage Meta also requires the
 * "Page Public Content Access" feature (App Review + business verification). Without a token or
 * without that access, every field comes back null: the video is still shown and played, the
 * missing counts are simply left empty. Nothing is scraped and no permission is worked around.
 *
 * Server-only. The token is sent in the Authorization header (never in the URL) and neither the
 * token nor Graph error bodies are logged or returned to callers.
 */
import { createHmac } from "crypto";

export type FacebookGraphVideoStats = {
  /** Exact creation time from Graph (more precise than oEmbed's calendar date). */
  publishedAt: string | null;
  /** Total reactions (likes included). Falls back to the likes edge when reactions are refused. */
  likes: number | null;
  comments: number | null;
};

export const EMPTY_FACEBOOK_GRAPH_STATS: FacebookGraphVideoStats = Object.freeze({
  publishedAt: null,
  likes: null,
  comments: null,
}) as FacebookGraphVideoStats;

const GRAPH_VERSION = "v27.0";
const VIDEO_ID = /^\d{5,25}$/;

type GraphCredentials = { token: string; appSecretProof: string | null };

/**
 * Reads credentials from the environment:
 * - FACEBOOK_GRAPH_ACCESS_TOKEN: a Page, system-user or user token with the needed access, or
 * - FACEBOOK_APP_ID + FACEBOOK_APP_SECRET: the app access token (works for public Page content
 *   only once the app has Page Public Content Access).
 * When FACEBOOK_APP_SECRET is set, appsecret_proof is added as Meta recommends.
 */
export function facebookGraphCredentialsFromEnv(env: Record<string, string | undefined> = process.env): GraphCredentials | null {
  const secret = String(env.FACEBOOK_APP_SECRET || "").trim();
  const appId = String(env.FACEBOOK_APP_ID || "").trim();
  const explicit = String(env.FACEBOOK_GRAPH_ACCESS_TOKEN || "").trim();
  const token = explicit || (appId && secret ? `${appId}|${secret}` : "");
  if (!token) return null;
  const appSecretProof = secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
  return { token, appSecretProof };
}

function safeCount(value: unknown): number | null {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

async function graphGet(
  videoId: string,
  fields: string,
  credentials: GraphCredentials,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<any | null> {
  const endpoint = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}`);
  endpoint.searchParams.set("fields", fields);
  if (credentials.appSecretProof) endpoint.searchParams.set("appsecret_proof", credentials.appSecretProof);
  try {
    const response = await fetchImpl(endpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${credentials.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });
    const body: any = await response.json().catch(() => null);
    // Permission (10/200), unsupported field (100), rate limit (4/17/32/613), bad token (190):
    // all mean "not available for this video right now".
    if (!response.ok || !body || body.error) return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Fetch whatever Meta allows for this video. Each value is requested separately so one refused
 * field (for example comments, which Graph can withhold) does not hide the others.
 */
export async function fetchFacebookGraphVideoStats(
  videoId: string | null | undefined,
  options: { credentials?: GraphCredentials | null; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<FacebookGraphVideoStats> {
  const id = String(videoId || "").trim();
  const credentials = options.credentials === undefined ? facebookGraphCredentialsFromEnv() : options.credentials;
  if (!VIDEO_ID.test(id) || !credentials) return { ...EMPTY_FACEBOOK_GRAPH_STATS };
  const timeoutMs = options.timeoutMs ?? 8000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const get = (fields: string) => graphGet(id, fields, credentials, timeoutMs, fetchImpl);

  const [created, reactions, comments] = await Promise.all([
    get("created_time"),
    get("reactions.limit(0).summary(total_count)"),
    get("comments.limit(0).summary(total_count)"),
  ]);

  let likes = safeCount(reactions?.reactions?.summary?.total_count);
  if (likes === null) {
    const likesEdge = await get("likes.limit(0).summary(total_count)");
    likes = safeCount(likesEdge?.likes?.summary?.total_count);
  }

  const createdMs = Date.parse(String(created?.created_time || ""));
  return {
    publishedAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
    likes,
    comments: safeCount(comments?.comments?.summary?.total_count),
  };
}
