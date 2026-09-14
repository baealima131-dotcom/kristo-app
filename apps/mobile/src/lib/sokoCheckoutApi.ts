import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import {
  describeKristoSessionToken,
  getKristoHeaders,
  logKristoAuthHeadersDiag,
} from "@/src/lib/kristoHeaders";
import { getSessionSync, loadSession } from "@/src/lib/kristoSession";

export const SOKO_SESSION_EXPIRED_MESSAGE =
  "Your Kristo session expired. Sign in again to continue checkout.";

type CheckoutHttp = {
  get: typeof apiGet;
  post: typeof apiPost;
  patch: typeof apiPatch;
};

let http: CheckoutHttp = {
  get: apiGet,
  post: apiPost,
  patch: apiPatch,
};

let blockedToken = "";

export function setSokoCheckoutHttpForTests(next?: Partial<CheckoutHttp>) {
  http = {
    get: next?.get || apiGet,
    post: next?.post || apiPost,
    patch: next?.patch || apiPatch,
  };
}

export function resetSokoCheckoutAuthGateForTests() {
  blockedToken = "";
}

async function ensureCheckoutSession() {
  let session = getSessionSync();
  const hasToken = Boolean(String(session?.sessionToken || "").trim());
  const hasUser = Boolean(String(session?.userId || "").trim());
  if (!hasToken || !hasUser) {
    session = await loadSession();
  }
  return session;
}

function unauthorized(result: { status?: number; error?: string } | null | undefined) {
  const status = Number(result?.status || 0);
  const error = String(result?.error || "").trim().toLowerCase();
  return status === 401 || error === "unauthorized";
}

function checkoutHeaders(session: {
  userId?: string;
  role?: string;
  churchId?: string;
  sessionToken?: string;
}) {
  return getKristoHeaders({
    userId: String(session.userId || "").trim(),
    role: session.role as any,
    churchId: String(session.churchId || "").trim(),
    sessionToken: String(session.sessionToken || "").trim(),
  }) as Record<string, string>;
}

function parseBody(body: unknown) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

function extraHeaderRecord(extraHeaders?: HeadersInit) {
  if (!extraHeaders || typeof extraHeaders !== "object" || Array.isArray(extraHeaders)) {
    return {} as Record<string, string>;
  }
  return extraHeaders as Record<string, string>;
}

async function send(
  path: string,
  method: string,
  body?: unknown,
  extraHeaders?: HeadersInit
) {
  const session = await ensureCheckoutSession();
  const userId = String(session?.userId || "").trim();
  const sessionToken = String(session?.sessionToken || "").trim();
  const tokenKey = `${userId}:${sessionToken}`;

  if (blockedToken && blockedToken === tokenKey) {
    throw new Error(SOKO_SESSION_EXPIRED_MESSAGE);
  }
  if (blockedToken && blockedToken !== tokenKey) {
    blockedToken = "";
  }

  if (!userId || !sessionToken) {
    blockedToken = tokenKey || "missing";
    throw new Error(SOKO_SESSION_EXPIRED_MESSAGE);
  }

  const payload = parseBody(body);
  const isFormData =
    typeof FormData !== "undefined" && payload instanceof FormData;
  const headers = {
    ...checkoutHeaders(session || {}),
    ...extraHeaderRecord(extraHeaders),
  };
  if (isFormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  } else if (method !== "GET") {
    headers["Content-Type"] =
      headers["Content-Type"] || headers["content-type"] || "application/json";
  }

  const tokenMeta = describeKristoSessionToken({ sessionToken });
  logKristoAuthHeadersDiag(path, headers, "sokoCheckout", tokenMeta);
  console.log("SOKO_API_REQUEST_START", {
    path: String(path || "").split("?")[0],
    method,
    hasUserId: Boolean(headers["x-kristo-user-id"]),
    hasSessionToken: Boolean(headers["x-kristo-session-token"]),
    hasRole: Boolean(headers["x-kristo-role"]),
    hasChurchId: Boolean(headers["x-kristo-church-id"]),
  });

  const started = Date.now();
  const init = { headers };
  let result: any;
  if (method === "GET") result = await http.get(path, init);
  else if (method === "PATCH") result = await http.patch(path, payload, init);
  else result = await http.post(path, payload, init);

  const status = Number(result?.status || 0);
  console.log("SOKO_API_REQUEST_END", {
    path: String(path || "").split("?")[0],
    status,
    ms: Date.now() - started,
  });

  if (unauthorized(result)) {
    blockedToken = tokenKey;
    console.warn("SOKO_API_REQUEST_FAILED", {
      path: String(path || "").split("?")[0],
      status: 401,
      hasUserId: Boolean(headers["x-kristo-user-id"]),
      hasSessionToken: Boolean(headers["x-kristo-session-token"]),
      hasRole: Boolean(headers["x-kristo-role"]),
      hasChurchId: Boolean(headers["x-kristo-church-id"]),
      message: "Unauthorized",
    });
    throw new Error(SOKO_SESSION_EXPIRED_MESSAGE);
  }

  return result;
}

export async function sokoCheckoutJson(path: string, init?: RequestInit) {
  const method = String(init?.method || "GET").trim().toUpperCase() || "GET";
  const result = await send(path, method, init?.body, init?.headers);
  if (result?.ok === false) {
    throw new Error(String(result?.error || "Request failed."));
  }
  return result;
}

export async function sokoCheckoutRaw(path: string, init?: RequestInit) {
  const method = String(init?.method || "GET").trim().toUpperCase() || "GET";
  try {
    const result = await send(path, method, init?.body, init?.headers);
    return {
      status: Number(result?.status || (result?.ok === false ? 400 : 200)),
      data: result && typeof result === "object" ? result : {},
    };
  } catch (error) {
    if (String((error as Error)?.message || "") === SOKO_SESSION_EXPIRED_MESSAGE) {
      throw error;
    }
    return {
      status: 0,
      data: { ok: false, error: String((error as Error)?.message || error || "Request failed.") },
    };
  }
}

export async function sokoListBuyerSellerConversations() {
  return sokoCheckoutJson("/api/soko/conversations", { method: "GET" });
}

export type SokoBuyerSellerThread = {
  conversationId: string;
  productId: string;
  peerUserId: string;
  title: string;
  subtitle: string;
};

export type SokoBuyerSellerMessage = {
  id: string;
  text: string;
  mine: boolean;
  time: string;
};

function asSokoThread(row: any, fallbackProductId = ""): SokoBuyerSellerThread {
  const conversationId = String(row?.id || row?.conversationId || "").trim();
  if (!conversationId) {
    throw new Error("Could not start chat.");
  }
  return {
    conversationId,
    productId: String(row?.productId || fallbackProductId || "").trim(),
    peerUserId: String(row?.peerUserId || "").trim(),
    title: String(row?.title || row?.productTitle || "Seller"),
    subtitle: String(row?.subtitle || row?.lastMessagePreview || ""),
  };
}

function messageClock(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  try {
    return new Date(parsed).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export async function sokoOpenBuyerSellerConversation(productId: string) {
  const listingId = String(productId || "").trim();
  if (!listingId) {
    throw new Error("This listing is not available for messaging yet.");
  }
  const data = await sokoCheckoutJson("/api/soko/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: listingId }),
  });
  return asSokoThread(data?.conversation || data, listingId);
}

export async function sokoListBuyerSellerMessages(conversationId: string) {
  const id = String(conversationId || "").trim();
  if (!id) throw new Error("conversationId is required.");
  const query = new URLSearchParams({ conversationId: id, limit: "80" });
  const data = await sokoCheckoutJson(
    `/api/soko/conversations/messages?${query.toString()}`,
    { method: "GET" }
  );
  const rows = Array.isArray(data?.messages) ? data.messages : [];
  return rows
    .map((row: any, index: number) => ({
      id: String(row?.id || `m-${index}`),
      text: String(row?.text || ""),
      mine: row?.mine === true,
      time: messageClock(row?.createdAt),
    }))
    .filter((row: SokoBuyerSellerMessage) => row.text);
}

export async function sokoSendBuyerSellerMessage(
  conversationId: string,
  text: string
) {
  const id = String(conversationId || "").trim();
  const trimmed = String(text || "").trim();
  if (!id) throw new Error("conversationId is required.");
  if (!trimmed) return;
  return sokoCheckoutJson("/api/soko/conversations/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: id, text: trimmed }),
  });
}
