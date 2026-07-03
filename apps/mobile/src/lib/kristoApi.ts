import {
  dedupeInflight,
  headerUserId,
  requestKey,
  type TrafficOptions,
} from "@/src/lib/kristoTraffic";
import { resolveApiBase } from "@/src/lib/kristoEnv";
import { describeKristoSessionToken, getKristoHeaders, logKristoAuthHeadersDiag } from "@/src/lib/kristoHeaders";

type Json = any;

export type { TrafficOptions };

export type ApiErrorResult = {
  ok: false;
  error: string;
  code?: string;
  reason?: string;
  status?: number;
  debug?: unknown;
  activeSchedule?: unknown;
};

export function getApiBase() {
  return resolveApiBase();
}

function kristoUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBase();
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text.slice(0, 280) };
  }
}

function networkError(path: string, error: unknown): ApiErrorResult {
  const message = String((error as any)?.message || error || "Network request failed");
  if (__DEV__) {
    console.warn("[KRISTO API] request failed", { path, base: getApiBase(), error: message });
  }
  return {
    ok: false,
    error: `Could not reach ${getApiBase()}. ${message}`,
    reason: "network_error",
  };
}

function isExpectedRoomOnlyScheduleFeedNotFound(
  path: string,
  res: Response,
  body: any
): boolean {
  if (!path.includes("/api/church/feed") || res.status !== 404) return false;
  const error = String(body?.error || body?.message || "").trim().toLowerCase();
  return error.includes("feed item not found");
}

function httpError(path: string, res: Response, body: any): ApiErrorResult {
  const providerError = String(body?.error || body?.message || "").trim();
  const hint = String(body?.details?.hint || body?.details || "").trim();
  const fallback = `Request failed (${res.status})`;
  const error = providerError || hint || fallback;
  if (__DEV__) {
    const logPayload = {
      path,
      base: getApiBase(),
      status: res.status,
      body,
    };
    if (isExpectedRoomOnlyScheduleFeedNotFound(path, res, body)) {
      console.log("[KRISTO API] expected feed-not-found (room-only schedule)", logPayload);
    } else {
      console.warn("[KRISTO API] non-OK response", logPayload);
    }
  }
  const code = String(body?.code || "").trim() || undefined;
  return {
    ok: false,
    error,
    code,
    reason: String(body?.reason || "http_error"),
    status: res.status,
    debug: body?.details ?? body?.debug,
    activeSchedule: body?.activeSchedule,
  };
}

type HeadersRec = Record<string, string>;

function mergeHeaders(h?: HeadersRec) {
  const out: HeadersRec = {};
  if (h && typeof h === "object") Object.assign(out, h);
  return out;
}

/** Merge signed session token + identity headers into every authenticated request. */
function withAuthHeaders(init: RequestInit | undefined, path: string): RequestInit {
  const caller = mergeHeaders(init?.headers as any);
  const authInput = {
    userId: String(caller["x-kristo-user-id"] || "").trim() || undefined,
    role: (String(caller["x-kristo-role"] || "").trim() || undefined) as any,
    churchId: String(caller["x-kristo-church-id"] || "").trim() || undefined,
    sessionToken: String(caller["x-kristo-session-token"] || "").trim() || undefined,
  };
  const tokenMeta = describeKristoSessionToken(authInput);
  const auth = getKristoHeaders(authInput);
  const headers = { ...auth, ...caller };
  if (auth["x-kristo-session-token"] && !headers["x-kristo-session-token"]) {
    headers["x-kristo-session-token"] = auth["x-kristo-session-token"];
  }
  logKristoAuthHeadersDiag(path, headers, "kristoApi", tokenMeta);
  return { ...(init || {}), headers };
}

function stripFormDataContentType(headers: HeadersRec) {
  delete headers["content-type"];
  delete headers["Content-Type"];
}

// apiGet(path, { headers }, { screen, throttleMs })
export async function apiGet<T = Json>(path: string, init?: RequestInit, traffic?: TrafficOptions) {
  const userId = headerUserId(init?.headers);
  const key = requestKey("GET", path, userId);
  const screen = traffic?.screen || "api";
  const dedupe = traffic?.dedupe !== false;

  const run = async () => {
    try {
      const reqInit = withAuthHeaders(init, path);
      const res = await fetch(kristoUrl(path), { ...reqInit, method: "GET" });
      const body = await safeJson(res);
      if (!res.ok) return httpError(path, res, body) as T;
      return (body ?? { ok: false, error: "Empty server response", status: res.status }) as T;
    } catch (error) {
      return networkError(path, error) as T;
    }
  };

  if (!dedupe && !traffic?.throttleMs) return run();

  return dedupeInflight(key, run, {
    screen,
    endpoint: path,
    throttleMs: traffic?.throttleMs,
  });
}

// Backward compatible:
// apiPost(path, body, headersRecord)
// apiPost(path, body, { headers: headersRecord })
export async function apiPost<T = Json>(path: string, body?: any, arg?: HeadersRec | RequestInit) {
  const init: RequestInit =
    arg && typeof arg === "object" && "headers" in arg ? (arg as RequestInit) : ({ headers: arg as any } as RequestInit);

  const prepared = withAuthHeaders(init, path);
  const headers = mergeHeaders(prepared.headers as any);

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  let payload: any = undefined;
  if (body != null) {
    if (isFormData) {
      payload = body;
      stripFormDataContentType(headers);
    } else if (typeof body === "string") {
      payload = body;
      headers["content-type"] = headers["content-type"] || "application/json";
    } else {
      payload = JSON.stringify(body);
      headers["content-type"] = headers["content-type"] || "application/json";
    }
  }

  try {
    const res = await fetch(kristoUrl(path), {
      ...prepared,
      method: "POST",
      headers,
      body: payload,
    });
    const parsed = await safeJson(res);
    if (path.includes("/api/auth/delete-account")) {
      console.log("KRISTO_DELETE_ACCOUNT_HTTP", {
        path,
        status: res.status,
        ok: res.ok,
        body: parsed,
      });
    }
    if (!res.ok) {
      if (path.includes("/api/auth/delete-account")) {
        return {
          ok: false,
          error: "Couldn't delete account. Please try again.",
          reason: "http_error",
          status: res.status,
        } as T;
      }
      return httpError(path, res, parsed) as T;
    }
    const body = parsed ?? { ok: false, error: "Empty server response" };
    return (typeof body === "object" && body !== null
      ? { ...body, status: res.status }
      : { ok: false, error: "Empty server response", status: res.status }) as T;
  } catch (error) {
    if (path.includes("/api/auth/delete-account")) {
      console.log("KRISTO_DELETE_ACCOUNT_HTTP", {
        path,
        status: null,
        ok: false,
        body: null,
        error: String((error as any)?.message || error || "network_error"),
      });
    }
    return networkError(path, error) as T;
  }
}

export async function apiPatch<T = Json>(path: string, body?: any, arg?: HeadersRec | RequestInit) {
  const init: RequestInit =
    arg && typeof arg === "object" && "headers" in arg ? (arg as RequestInit) : ({ headers: arg as any } as RequestInit);

  const prepared = withAuthHeaders(init, path);
  const headers = mergeHeaders(prepared.headers as any);

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  let payload: any = undefined;
  if (body != null) {
    if (isFormData) {
      payload = body;
      stripFormDataContentType(headers);
    } else if (typeof body === "string") {
      payload = body;
      headers["content-type"] = headers["content-type"] || "application/json";
    } else {
      payload = JSON.stringify(body);
      headers["content-type"] = headers["content-type"] || "application/json";
    }
  }

  try {
    const res = await fetch(kristoUrl(path), {
      ...prepared,
      method: "PATCH",
      headers,
      body: payload,
    });
    const parsed = await safeJson(res);
    if (!res.ok) return httpError(path, res, parsed) as T;
    return (parsed ?? { ok: false, error: "Empty server response", status: res.status }) as T;
  } catch (error) {
    return networkError(path, error) as T;
  }
}

export async function apiDelete<T = Json>(path: string, init?: RequestInit) {
  try {
    const reqInit = withAuthHeaders(init, path);
    const res = await fetch(kristoUrl(path), { ...reqInit, method: "DELETE" });
    const parsed = await safeJson(res);
    if (!res.ok) return httpError(path, res, parsed) as T;
    return (parsed ?? { ok: false, error: "Empty server response", status: res.status }) as T;
  } catch (error) {
    return networkError(path, error) as T;
  }
}
