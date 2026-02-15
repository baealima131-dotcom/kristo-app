type Json = any;

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");

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
    return { ok: false, error: text };
  }
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
    return (await safeJson(res)) as T;
  } catch {
    return null as any;
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
    return (await safeJson(res)) as T;
  } catch {
    return null as any;
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
    return (await safeJson(res)) as T;
  } catch {
    return null as any;
  }
}

export async function apiDelete<T = Json>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(kristoUrl(path), { ...(init || {}), method: "DELETE" });
    return (await safeJson(res)) as T;
  } catch {
    return null as any;
  }
}
