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
import {
  issueUvumbuziBridgeToken,
  uvumbuziBridgeConfigFromEnv,
  type UvumbuziBridgeConfig,
} from "./uvumbuziBridgeToken";

export type LabProxyConfig = { labUrl: string; bridge: UvumbuziBridgeConfig };
export type LabProxyResult = { status: number; body: unknown };

const SEGMENT = /^[A-Za-z0-9_.:-]{1,200}$/;
const MAX_BODY_BYTES = 20_000;
const TIMEOUT_MS = 10_000;

/** Bridge routes a Kristo user may reach. `link-project` (local bootstrap) is deliberately absent. */
const ROUTES: Array<[method: "GET" | "POST", pattern: string]> = [
  ["GET", "me"],
  ["POST", "projects"],
  ["GET", "projects/:id/history"],
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

export async function proxyToLab(input: {
  method: string;
  segments: string[];
  /** Raw request body text (POST only). */
  bodyText?: string;
  /** Kristo user id that the CALLER has already verified from a signed session. */
  verifiedUserId: string;
  config: LabProxyConfig;
  fetchImpl?: typeof fetch;
}): Promise<LabProxyResult> {
  const { method, segments, config } = input;
  if (!input.verifiedUserId) return { status: 401, body: { ok: false, error: "Unauthorized" } };
  if (!isAllowedLabRoute(method, segments)) return { status: 404, body: { ok: false, error: "Not found" } };

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
    return { status: res.status, body: json };
  } catch {
    return { status: 502, body: { ok: false, error: "UVUMBUZI Lab is not reachable" } };
  }
}
