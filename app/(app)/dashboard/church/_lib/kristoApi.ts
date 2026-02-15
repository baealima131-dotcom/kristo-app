export type KristoHeaders = {
  userId?: string;
  role?: string;
  churchId?: string;
};

function pick(h?: KristoHeaders) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (h?.userId) headers["x-kristo-user-id"] = h.userId;
  if (h?.role) headers["x-kristo-role"] = h.role;
  if (h?.churchId) headers["x-kristo-church-id"] = h.churchId;
  return headers;
}


const __KRISTO_GET_TTL_MS__ = 1500;
const __KRISTO_GET_INFLIGHT__ = new Map<string, Promise<any>>();
const __KRISTO_GET_LAST_OK__ = new Map<string, { ts: number; data: any }>();

export async function apiGet<T>(url: string, h?: KristoHeaders): Promise<T> {
  const res = await fetch(url, { method: "GET", headers: pick(h) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `GET ${url} failed (${res.status})`);
  return json as T;
}

export async function apiPost<T>(url: string, body: any, h?: KristoHeaders): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: pick(h), body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `POST ${url} failed (${res.status})`);
  return json as T;
}

export async function apiPatch<T>(url: string, body: any, h?: KristoHeaders): Promise<T> {
  const res = await fetch(url, { method: "PATCH", headers: pick(h), body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `PATCH ${url} failed (${res.status})`);
  return json as T;
}

export async function apiDelete<T>(url: string, body: any, h?: KristoHeaders): Promise<T> {
  const res = await fetch(url, { method: "DELETE", headers: pick(h), body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `DELETE ${url} failed (${res.status})`);
  return json as T;
}
