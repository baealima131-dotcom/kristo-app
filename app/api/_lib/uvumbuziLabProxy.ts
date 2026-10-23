/**
 * Kristo server → UVUMBUZI Lab relay.
 *
 * The mobile app only ever talks to Kristo with its normal Kristo session.
 * Kristo verifies that session, mints a 5-minute Lab token server-side and
 * forwards an ALLOW-LISTED bridge request. The Lab token and the Lab address
 * never reach the phone, and the Lab enforces project permissions itself.
 *
 * Pure (no Next.js imports) so it can be tested against a real Lab server.
 */
import crypto from "node:crypto";
import {
  issueUvumbuziBridgeToken,
  uvumbuziBridgeConfigFromEnv,
  type UvumbuziBridgeConfig,
} from "./uvumbuziBridgeToken";

export type LabProxyConfig = { labUrl: string; bridge: UvumbuziBridgeConfig };

/**
 * Kristo-side identity helpers, injected so the relay stays testable without Next.js.
 * Only PUBLIC Kristo IDs (e.g. "KR7-830906M") ever leave this server; internal user
 * ids are what the Lab stores, and names, emails and phones are never added.
 */
export type LabPeopleDirectory = {
  /** Public Kristo ID -> internal user id, or null when no such account exists. */
  resolveKristoId(kristoId: string): Promise<string | null>;
  /** Internal user ids -> public Kristo IDs (ids without one are simply omitted). */
  publicIds(userIds: string[]): Promise<Record<string, string>>;
};

/**
 * Sliding-window limiter per verified user. In-memory, so on serverless hosting it
 * limits per instance; that still blunts runaway clients and Kristo-ID guessing.
 */
export class RelayRateLimiter {
  private hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }
  /** Returns seconds to wait, or 0 when the call is allowed (and counted). */
  take(key: string): number {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((this.windowMs - (t - recent[0])) / 1000));
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((x) => t - x < this.windowMs)) this.hits.delete(k);
    return 0;
  }
}

/** Defaults: 120 Lab calls per user per minute; 20 Kristo-ID invite lookups per user per 10 minutes. */
const defaultLimits = { calls: new RelayRateLimiter(120, 60_000), invites: new RelayRateLimiter(20, 600_000) };

export type RelayAuditEvent = {
  event: "UVUMBUZI_RELAY";
  /** Short one-way hash of the Kristo user id: correlates a user's calls without logging the id. */
  user: string;
  method: string;
  /** Route pattern with ids removed, e.g. "projects/:id/history". */
  route: string;
  status: number;
  ms: number;
  reason?: string;
};

function routePattern(method: string, segments: string[]): string {
  const hit = ROUTES.find(([m, pattern]) => {
    const parts = pattern.split("/");
    return m === method && parts.length === segments.length && parts.every((p, i) => p === ":id" || p === segments[i]);
  });
  return hit ? hit[1] : "(refused)";
}

function userTag(userId: string): string {
  return userId ? crypto.createHash("sha256").update(`uvumbuzi-audit:${userId}`).digest("hex").slice(0, 12) : "anonymous";
}

/** Public Kristo ID format, e.g. KR7-830906M or KR7-DEMO1. */
export const KRISTO_PUBLIC_ID = /^KR[0-9A-Z]?-[0-9A-Z]{3,20}$/i;
export type LabProxyResult = { status: number; body: unknown };

const SEGMENT = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_BODY_BYTES = 20_000;
const TIMEOUT_MS = 10_000;

/** Bridge routes a Kristo user may reach. `link-project` (local bootstrap) is deliberately absent. */
const ROUTES: Array<[method: "GET" | "POST", pattern: string]> = [
  ["GET", "me"],
  ["POST", "projects"],
  ["GET", "projects/:id/history"],
  ["POST", "projects/:id/supervisors/:id/limit"],
  ["GET", "projects/:id/operations"],
  ["POST", "projects/:id/church-outreach"],
  ["GET", "confirmations"],
  ["POST", "confirmations/:id/respond"],
  ["GET", "projects/:id/invitations"],
  ["POST", "projects/:id/invitations"],
  ["POST", "invitations/redeem"],
  ["GET", "projects/:id/tasks"],
  ["POST", "projects/:id/tasks"],
  ["POST", "projects/:id/members"],
  ["POST", "projects/:id/members/:id/role"],
  ["GET", "projects/:id/proposals"],
  ["POST", "projects/:id/proposals"],
  ["GET", "tasks/:id/reports"],
  ["POST", "tasks/:id/reports"],
  ["POST", "tasks/:id/decision"],
  ["POST", "proposals/:id/decision"],
  ["POST", "proposals/:id/withdraw"],
];

export function isAllowedLabRoute(method: string, segments: string[]): boolean {
  if (!segments.length || !segments.every((s) => SEGMENT.test(s) && !/^\.+$/.test(s))) return false;
  return ROUTES.some(([m, pattern]) => {
    if (m !== method) return false;
    const parts = pattern.split("/");
    return parts.length === segments.length && parts.every((p, i) => p === ":id" || p === segments[i]);
  });
}

function isAllowedLabUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    return false;
  }
}

export function labProxyConfigFromEnv(env: Record<string, string | undefined> = process.env): LabProxyConfig | null {
  const labUrl = String(env.UVUMBUZI_LAB_URL || "").trim().replace(/\/+$/, "");
  const bridge = uvumbuziBridgeConfigFromEnv(env);
  if (!labUrl || !bridge || !isAllowedLabUrl(labUrl)) return null;
  return { labUrl, bridge };
}

export async function proxyToLab(input: Parameters<typeof relay>[0] & {
  /** Receives one structured line per call; defaults to console.info (no bodies, no raw ids). */
  audit?: (e: RelayAuditEvent) => void;
}): Promise<LabProxyResult> {
  const started = Date.now();
  const result = await relay(input);
  const reason = (result.body as { reason?: unknown } | null)?.reason;
  (input.audit ?? ((e) => console.info(JSON.stringify(e))))({
    event: "UVUMBUZI_RELAY",
    user: userTag(input.verifiedUserId),
    method: input.method,
    route: routePattern(input.method, input.segments),
    status: result.status,
    ms: Date.now() - started,
    ...(typeof reason === "string" ? { reason } : {}),
  });
  return result;
}

async function relay(input: {
  method: string;
  segments: string[];
  /** Raw request body text (POST only). */
  bodyText?: string;
  /** Kristo user id that the CALLER has already verified from a signed session. */
  verifiedUserId: string;
  config: LabProxyConfig;
  people?: LabPeopleDirectory;
  limits?: { calls: RelayRateLimiter; invites: RelayRateLimiter };
  fetchImpl?: typeof fetch;
}): Promise<LabProxyResult> {
  const { method, segments, config } = input;
  const limits = input.limits ?? defaultLimits;
  if (!input.verifiedUserId) return { status: 401, body: { ok: false, error: "Unauthorized" } };
  if (!isAllowedLabRoute(method, segments)) return { status: 404, body: { ok: false, error: "Not found" } };
  const wait = limits.calls.take(input.verifiedUserId);
  if (wait) return { status: 429, body: { ok: false, error: `Too many requests. Try again in ${wait} s.`, reason: "rate_limited", retryAfterSeconds: wait } };

  let body: string | undefined;
  if (method === "POST") {
    const text = input.bodyText ?? "";
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { status: 413, body: { ok: false, error: "Request too large" } };
    let parsed: unknown = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        return { status: 400, body: { ok: false, error: "Invalid JSON" } };
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: 400, body: { ok: false, error: "Body must be a JSON object" } };
    }
    // Invite ONLY by public Kristo ID: never permit clients to submit a raw
    // internal subject, even when they own the project. Resolution is performed
    // by this trusted Kristo server, not by the phone or Lab.
    const isInvite = segments.length === 3 && segments[0] === "projects" && segments[2] === "members";
    if (isInvite) {
      const keys = Object.keys(parsed);
      if (keys.length !== 1 || keys[0] !== "kristoId") {
        return { status: 400, body: { ok: false, error: "Invite by Kristo ID only", reason: "kristo_id_required" } };
      }
      const inviteKristoId = (parsed as { kristoId?: unknown }).kristoId;
      if (typeof inviteKristoId !== "string" || !KRISTO_PUBLIC_ID.test(inviteKristoId.trim())) {
        return { status: 400, body: { ok: false, error: "Enter a Kristo ID like KR7-12345AB", reason: "invalid_kristo_id" } };
      }
      if (!input.people) return { status: 503, body: { ok: false, error: "Kristo ID lookup is not available" } };
      const inviteWait = limits.invites.take(input.verifiedUserId);
      if (inviteWait) return { status: 429, body: { ok: false, error: `Too many invites. Try again in ${inviteWait} s.`, reason: "rate_limited", retryAfterSeconds: inviteWait } };
      const subject = await input.people.resolveKristoId(inviteKristoId.trim().toUpperCase());
      if (!subject) return { status: 404, body: { ok: false, error: "No Kristo account has that Kristo ID", reason: "unknown_kristo_id" } };
      parsed = { subject };
    }
    // An agent may request confirmation only from a real Kristo account.
    // Resolve the public Kristo ID on the trusted server; do not accept internal IDs from the browser.
    const churchOutreach = segments.length === 3 && segments[0] === "projects" && segments[2] === "church-outreach";
    if (churchOutreach) {
      const val = parsed as Record<string,unknown>;
      const keys = Object.keys(val);
      if (keys.some(k=>!["churchId","kristoId","note"].includes(k)) || typeof val.churchId !== "string" || typeof val.kristoId !== "string" ||
          !KRISTO_PUBLIC_ID.test(val.kristoId.trim()) || (val.note!==undefined && typeof val.note!=="string")) {
        return {status:400,body:{ok:false,error:"Provide churchId, Kristo ID and optional note only"}};
      }
      if (!input.people) return {status:503,body:{ok:false,error:"Kristo directory unavailable"}};
      const inviteWait = limits.invites.take(input.verifiedUserId);
      if (inviteWait) return {status:429,body:{ok:false,error:"Too many lookups",reason:"rate_limited"}};
      const churchPersonSubject = await input.people.resolveKristoId(val.kristoId.trim().toUpperCase());
      if (!churchPersonSubject) return {status:404,body:{ok:false,error:"Kristo ID not found"}};
      parsed = {churchId:val.churchId,note:val.note??"",churchPersonSubject};
    }
    body = JSON.stringify(parsed);
  }

  let token: string;
  try {
    token = issueUvumbuziBridgeToken(input.verifiedUserId, config.bridge).token;
  } catch {
    return { status: 422, body: { ok: false, error: "This account cannot use UVUMBUZI Lab" } };
  }

  const url = `${config.labUrl}/api/kristo/bridge/${segments.map(encodeURIComponent).join("/")}`;
  try {
    const res = await (input.fetchImpl ?? fetch)(url, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      ...(body === undefined ? {} : { body }),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = { ok: false, error: "Invalid response from UVUMBUZI Lab" };
    }
    if (!res.ok) {
      // Lab errors are { error: <code>, message }; Kristo clients show `error`, so surface the message.
      const e = (json && typeof json === "object" ? json : {}) as { error?: unknown; message?: unknown };
      const message = typeof e.message === "string" && e.message ? e.message : `UVUMBUZI Lab error (${res.status})`;
      return { status: res.status, body: { ok: false, error: message, code: typeof e.error === "string" ? e.error : undefined } };
    }
    return { status: res.status, body: await withPublicIds(segments, json, input.verifiedUserId, input.people) };
  } catch {
    return { status: 502, body: { ok: false, error: "UVUMBUZI Lab is not reachable" } };
  }
}

/** Every internal user id that appears in a Lab response the caller is already allowed to see. */
function subjectsIn(value: unknown, out: Set<string>, key = ""): void {
  if (typeof value === "string") {
    if (/(Subject|^subject|By|^targetId)$/.test(key) && /^[\w.:-]{1,200}$/.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v) => subjectsIn(v, out, key));
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) subjectsIn(v, out, k);
}

/** Adds `people: { [userId]: { kristoId } }` to `me` and project history, so screens show public Kristo IDs. */
async function withPublicIds(segments: string[], json: unknown, viewer: string, people?: LabPeopleDirectory): Promise<unknown> {
  if (!people || !json || typeof json !== "object" || Array.isArray(json)) return json;
  const isMe = segments.length === 1 && segments[0] === "me";
  const isHistory = segments.length === 3 && segments[0] === "projects" && segments[2] === "history";
  const isOperations = segments.length === 3 && segments[0] === "projects" && segments[2] === "operations";
  if (!isMe && !isHistory && !isOperations) return json;
  const ids = new Set<string>([viewer]);
  if (isHistory || isOperations) subjectsIn(json, ids);
  try {
    const map = await people.publicIds([...ids].slice(0, 500));
    const out: Record<string, { kristoId: string }> = {};
    for (const [id, kristoId] of Object.entries(map)) if (ids.has(id) && KRISTO_PUBLIC_ID.test(kristoId)) out[id] = { kristoId };
    return { ...(json as object), people: out, ...(isMe ? { kristoId: map[viewer] ?? null } : {}) };
  } catch {
    return json; // directory trouble must never block Lab access; screens fall back to short ids
  }
}
