import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";
import { resolveApiBase } from "@/src/lib/kristoEnv";
import {
  describeKristoSessionToken,
  getKristoHeaders,
  logKristoAuthHeadersDiag,
} from "@/src/lib/kristoHeaders";
import { getSessionSync, loadSession, saveSession } from "@/src/lib/kristoSession";
import {
  CHECKOUT_AUTH_MISMATCH_MESSAGE,
  checkoutRequestAllowedWhileReconnecting,
  evaluateSessionRenewal,
  homeCheckoutUnauthorizedOutcome,
  isLiveCheckoutUnauthorized,
  KRISTO_SESSION_REISSUE_MESSAGE,
  shouldProbeCheckoutProfileSession,
  logCheckoutAuthEvent,
  SOKO_SESSION_EXPIRED_MESSAGE,
  SOKO_SESSION_NOT_RENEWED_MESSAGE,
} from "@/src/lib/sokoCheckoutReconnect";

export {
  CHECKOUT_AUTH_MISMATCH_MESSAGE,
  KRISTO_SESSION_REISSUE_MESSAGE,
  SOKO_SESSION_EXPIRED_MESSAGE,
  SOKO_SESSION_NOT_RENEWED_MESSAGE,
} from "@/src/lib/sokoCheckoutReconnect";

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
let reconnecting = false;
let silentRestoreAttempted = false;

export function setSokoCheckoutHttpForTests(next?: Partial<CheckoutHttp>) {
  http = {
    get: next?.get || apiGet,
    post: next?.post || apiPost,
    patch: next?.patch || apiPatch,
  };
}

export function resetSokoCheckoutAuthGateForTests() {
  blockedToken = "";
  reconnecting = false;
  silentRestoreAttempted = false;
}

export function getBlockedCheckoutToken() {
  return blockedToken;
}

export function setCheckoutReconnecting(next: boolean) {
  reconnecting = next === true;
}

export function isCheckoutReconnecting() {
  return reconnecting === true;
}

export function quarantineRejectedCheckoutToken(tokenKey: string) {
  const key = String(tokenKey || "").trim();
  if (!key || key === ":") return false;
  blockedToken = key;
  return true;
}

export function beginForcedCheckoutReauth() {
  const session = getSessionSync();
  const userId = String(session?.userId || "").trim();
  const sessionToken = String(session?.sessionToken || "").trim();
  const quarantined = quarantineRejectedCheckoutToken(
    blockedToken || `${userId}:${sessionToken}`
  );
  reconnecting = true;
  logCheckoutAuthEvent("home-checkout", "started", {
    quarantined,
    hasUserId: Boolean(userId),
    hasSessionToken: Boolean(sessionToken),
    reason: "member_reauth",
  });
}

export async function trySilentCheckoutSessionRestore() {
  if (silentRestoreAttempted) {
    return { restored: false, tokenChanged: false as const };
  }
  silentRestoreAttempted = true;
  const previousKey = blockedToken;
  const reloaded = await loadSession();
  const nextKey = `${String(reloaded?.userId || "").trim()}:${String(
    reloaded?.sessionToken || ""
  ).trim()}`;
  const renewal = evaluateSessionRenewal({
    blockedToken: previousKey,
    nextToken: nextKey,
  });
  if (!renewal.accepted) {
    return { restored: false, tokenChanged: false as const };
  }
  reconnecting = false;
  return {
    restored: true,
    tokenChanged: true as const,
    session: reloaded,
  };
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

async function checkoutProfileSessionStillValid() {
  try {
    const session = await ensureCheckoutSession();
    const result = await http.get("/api/auth/profile", {
      headers: checkoutHeaders(session || {}),
    });
    const status = Number((result as { status?: number })?.status || 0);
    return (
      (result as { ok?: boolean })?.ok === true ||
      status === 200 ||
      Boolean((result as { profile?: unknown })?.profile)
    );
  } catch {
    return false;
  }
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

function unauthorized(result: {
  status?: number;
  error?: string;
  details?: { hint?: unknown; code?: unknown };
} | null | undefined) {
  return isLiveCheckoutUnauthorized({
    status: result?.status,
    error: result?.error,
    details: result?.details,
    message: result?.error,
  });
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
  extraHeaders?: HeadersInit,
  options?: { silentRetried?: boolean }
): Promise<any> {
  const session = await ensureCheckoutSession();
  const userId = String(session?.userId || "").trim();
  const sessionToken = String(session?.sessionToken || "").trim();
  const tokenKey = `${userId}:${sessionToken}`;

  if (!checkoutRequestAllowedWhileReconnecting(reconnecting)) {
    throw new Error(SOKO_SESSION_EXPIRED_MESSAGE);
  }
  if (blockedToken && blockedToken === tokenKey) {
    throw new Error(SOKO_SESSION_EXPIRED_MESSAGE);
  }
  if (blockedToken && blockedToken !== tokenKey) {
    blockedToken = "";
    silentRestoreAttempted = false;
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
    const failedPath = String(path || "").split("?")[0];
    const canProbeProfile =
      failedPath !== "/api/auth/profile" &&
      shouldProbeCheckoutProfileSession(result);
    const profileOk = canProbeProfile
      ? await checkoutProfileSessionStillValid()
      : false;
    const outcome = homeCheckoutUnauthorizedOutcome({
      checkoutResult: result,
      profileFallbackOk: canProbeProfile ? profileOk : false,
    });
    if (outcome.mismatch) {
      console.log("CHECKOUT_AUTH_MISMATCH", {
        path: failedPath,
        status: 401,
        reason: outcome.reason,
        quarantined: false,
        source: "home-checkout",
        hasUserId: Boolean(userId),
        hasSessionToken: Boolean(sessionToken),
      });
      console.warn("SOKO_API_REQUEST_FAILED", {
        path: failedPath,
        status: 401,
        hasUserId: Boolean(headers["x-kristo-user-id"]),
        hasSessionToken: Boolean(headers["x-kristo-session-token"]),
        hasRole: Boolean(headers["x-kristo-role"]),
        hasChurchId: Boolean(headers["x-kristo-church-id"]),
        message: "Unauthorized",
      });
      throw new Error(outcome.throwMessage);
    }
    quarantineRejectedCheckoutToken(tokenKey);
    logCheckoutAuthEvent("home-checkout", "required", {
      path: failedPath,
      status: 401,
      reason: outcome.reason,
      quarantined: true,
      hasUserId: Boolean(userId),
      hasSessionToken: Boolean(sessionToken),
    });
    console.warn("SOKO_API_REQUEST_FAILED", {
      path: failedPath,
      status: 401,
      hasUserId: Boolean(headers["x-kristo-user-id"]),
      hasSessionToken: Boolean(headers["x-kristo-session-token"]),
      hasRole: Boolean(headers["x-kristo-role"]),
      hasChurchId: Boolean(headers["x-kristo-church-id"]),
      message: "Unauthorized",
    });
    if (outcome.throwMessage === KRISTO_SESSION_REISSUE_MESSAGE) {
      throw new Error(KRISTO_SESSION_REISSUE_MESSAGE);
    }
    if (!options?.silentRetried) {
      const silent = await trySilentCheckoutSessionRestore();
      if (silent.restored) {
        const retried = await send(path, method, body, extraHeaders, {
          silentRetried: true,
        });
        if (failedPath === "/api/soko/delivery/rates") {
          logCheckoutAuthEvent("home-checkout", "resumed", {
            path: "/api/soko/delivery/rates",
            status: Number(retried?.status || 200),
            once: true,
            tokenChanged: true,
            restoredDraft: true,
            reason: "silent_restore",
          });
        }
        return retried;
      }
    }
    throw new Error(SOKO_SESSION_EXPIRED_MESSAGE);
  }

  return result;
}

export async function renewKristoCheckoutSession(input: {
  identifier: string;
  password: string;
}) {
  const previous = await ensureCheckoutSession();
  const previousUserId = String(previous?.userId || "").trim();
  const previousToken = String(previous?.sessionToken || "").trim();
  const previousKey = blockedToken || `${previousUserId}:${previousToken}`;
  quarantineRejectedCheckoutToken(previousKey);
  const identifier = String(input.identifier || "").trim();
  const password = String(input.password || "");
  if (!identifier || password.length < 8) {
    throw new Error("Enter your Kristo email, phone or Kristo ID and password.");
  }

  const response = await fetch(`${resolveApiBase()}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: identifier,
      password,
    }),
  });
  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok || !data?.ok) {
    throw new Error(
      String(data?.error || "Wrong email, phone or password.")
    );
  }

  const userId = String(data?.userId || "").trim();
  const sessionToken = String(data?.sessionToken || data?.token || "").trim();
  const role = String(data?.role || data?.churchRole || "Member").trim();
  const churchId = String(data?.churchId || "").trim();
  const churchRole = String(data?.churchRole || data?.role || "Member").trim();
  if (!userId || !sessionToken) {
    throw new Error("Kristo login did not return valid session credentials.");
  }

  const nextKey = `${userId}:${sessionToken}`;
  const renewal = evaluateSessionRenewal({
    blockedToken: previousKey,
    nextToken: nextKey,
  });
  if (!renewal.accepted) {
    throw new Error(SOKO_SESSION_NOT_RENEWED_MESSAGE);
  }

  const nextSession = {
    ...(previous || {}),
    userId,
    sessionToken,
    role,
    churchId: churchId || String(previous?.churchId || "").trim(),
    churchRole,
  };
  await saveSession(nextSession as any);
  reconnecting = false;
  silentRestoreAttempted = false;
  logCheckoutAuthEvent("home-checkout", "succeeded", {
    tokenChanged: true,
    restoredDraft: true,
    quarantined: true,
    hasUserId: Boolean(userId),
    hasSessionToken: true,
    reason: "renewed",
  });
  return nextSession;
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
    const message = String((error as Error)?.message || "");
    if (
      message === SOKO_SESSION_EXPIRED_MESSAGE ||
      message === KRISTO_SESSION_REISSUE_MESSAGE
    ) {
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
