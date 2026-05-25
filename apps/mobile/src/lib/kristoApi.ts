type Json = any;

export type ApiErrorResult = {
  ok: false;
  error: string;
  reason?: string;
  status?: number;
  debug?: unknown;
};

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "https://kristo-app.vercel.app").replace(/\/$/, "");

export function getApiBase() {
  return API_BASE;
}

function kristoUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
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
    console.warn("[KRISTO API] request failed", { path, base: API_BASE, error: message });
  }
  return {
    ok: false,
    error: `Could not reach ${API_BASE}. ${message}`,
    reason: "network_error",
  };
}

function httpError(path: string, res: Response, body: any): ApiErrorResult {
  const providerError = String(body?.error || body?.message || "").trim();
  const hint = String(body?.details?.hint || body?.details || "").trim();
  const fallback = `Request failed (${res.status})`;
  const error = providerError || hint || fallback;
  if (__DEV__) {
    console.warn("[KRISTO API] non-OK response", {
      path,
      base: API_BASE,
      status: res.status,
      body,
    });
  }
  return {
    ok: false,
    error,
    reason: String(body?.reason || "http_error"),
    status: res.status,
    debug: body?.details ?? body?.debug,
  };
}

type HeadersRec = Record<string, string>;

function mergeHeaders(h?: HeadersRec) {
  const out: HeadersRec = {};
  if (h && typeof h === "object") Object.assign(out, h);
  return out;
}

// apiGet(path, { headers }) style
export async function apiGet<T = Json>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(kristoUrl(path), { ...(init || {}), method: "GET" });
    const body = await safeJson(res);
    if (!res.ok) return httpError(path, res, body) as T;
    return (body ?? { ok: false, error: "Empty server response", status: res.status }) as T;
  } catch (error) {
    return networkError(path, error) as T;
  }
}

// Backward compatible:
// apiPost(path, body, headersRecord)
// apiPost(path, body, { headers: headersRecord })
export async function apiPost<T = Json>(path: string, body?: any, arg?: HeadersRec | RequestInit) {
  const init: RequestInit =
    arg && typeof arg === "object" && "headers" in arg ? (arg as RequestInit) : ({ headers: arg as any } as RequestInit);

  const headers = mergeHeaders(init.headers as any);

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  let payload: any = undefined;
  if (body != null) {
    if (isFormData) {
      payload = body;
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
      ...(init || {}),
      method: "POST",
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

export async function apiPatch<T = Json>(path: string, body?: any, arg?: HeadersRec | RequestInit) {
  const init: RequestInit =
    arg && typeof arg === "object" && "headers" in arg ? (arg as RequestInit) : ({ headers: arg as any } as RequestInit);

  const headers = mergeHeaders(init.headers as any);

  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  let payload: any = undefined;
  if (body != null) {
    if (isFormData) {
      payload = body;
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
      ...(init || {}),
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
    const res = await fetch(kristoUrl(path), { ...(init || {}), method: "DELETE" });
    const parsed = await safeJson(res);
    if (!res.ok) return httpError(path, res, parsed) as T;
    return (parsed ?? { ok: false, error: "Empty server response", status: res.status }) as T;
  } catch (error) {
    return networkError(path, error) as T;
  }
}
