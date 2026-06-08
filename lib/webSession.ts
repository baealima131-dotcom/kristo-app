/** Web-only session persistence (localStorage + signed token headers). Mobile uses SecureStore. */

export const WEB_SESSION_STORAGE_KEY = "kristo_web_session";
export const WEB_SESSION_USER_ID_KEY = "kristo_web_user_id";
export const WEB_SESSION_TOKEN_KEY = "kristo_web_session_token";
export const WEB_SESSION_EXPIRES_KEY = "kristo_web_session_expires_at";
export const WEB_SESSION_MIN_TTL_MS = 12 * 60 * 60 * 1000;

type StoredWebSession = {
  userId: string;
  sessionToken: string;
  expiresAt: number;
  savedAt: number;
};

type LoginSessionPayload = {
  userId?: unknown;
  sessionToken?: unknown;
  user?: { id?: unknown };
  session?: { userId?: unknown };
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function extractLoginUserId(data: LoginSessionPayload): string {
  return String(data?.userId || data?.user?.id || data?.session?.userId || "").trim();
}

function extractLoginSessionToken(data: LoginSessionPayload): string {
  return String(data?.sessionToken || "").trim();
}

/** Silent read — no console logs (safe for every fetch). */
export function peekWebSession(): StoredWebSession | null {
  if (!canUseStorage()) return null;

  const userId = String(localStorage.getItem(WEB_SESSION_USER_ID_KEY) || "").trim();
  const sessionToken = String(localStorage.getItem(WEB_SESSION_TOKEN_KEY) || "").trim();
  const expiresAt = Number(localStorage.getItem(WEB_SESSION_EXPIRES_KEY) || 0);

  if (userId && sessionToken && expiresAt > Date.now()) {
    return { userId, sessionToken, expiresAt, savedAt: expiresAt - WEB_SESSION_MIN_TTL_MS };
  }

  const raw = localStorage.getItem(WEB_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredWebSession;
    const uid = String(parsed?.userId || "").trim();
    const token = String(parsed?.sessionToken || "").trim();
    const exp = Number(parsed?.expiresAt || 0);
    if (!uid || !token || exp <= Date.now()) return null;
    return { userId: uid, sessionToken: token, expiresAt: exp, savedAt: Number(parsed?.savedAt || 0) };
  } catch {
    return null;
  }
}

export function inspectWebSessionStorage() {
  if (!canUseStorage()) {
    return { available: false as const };
  }

  const userId = localStorage.getItem(WEB_SESSION_USER_ID_KEY);
  const sessionToken = localStorage.getItem(WEB_SESSION_TOKEN_KEY);
  const expiresAtRaw = localStorage.getItem(WEB_SESSION_EXPIRES_KEY);
  const expiresAt = Number(expiresAtRaw || 0);
  const now = Date.now();

  return {
    available: true,
    found: Boolean(userId && sessionToken && expiresAt),
    userId: userId || null,
    hasSessionToken: Boolean(sessionToken),
    sessionTokenLen: sessionToken?.length || 0,
    expiresAt: expiresAt || null,
    expiresAtIsFuture: expiresAt > now,
    remainingMs: expiresAt > now ? expiresAt - now : 0,
    hasJsonBlob: Boolean(localStorage.getItem(WEB_SESSION_STORAGE_KEY)),
  };
}

export function saveWebSession(userId: string, sessionToken: string) {
  if (!canUseStorage()) {
    console.log("KRISTO_WEB_SESSION_SAVE_FAILED", { reason: "no-localStorage" });
    return false;
  }

  const uid = String(userId || "").trim();
  const token = String(sessionToken || "").trim();
  if (!uid || !token) {
    console.log("KRISTO_WEB_SESSION_SAVE_FAILED", {
      reason: "missing-fields",
      hasUserId: Boolean(uid),
      hasSessionToken: Boolean(token),
    });
    return false;
  }

  const now = Date.now();
  const expiresAt = now + WEB_SESSION_MIN_TTL_MS;
  const payload: StoredWebSession = {
    userId: uid,
    sessionToken: token,
    expiresAt,
    savedAt: now,
  };

  localStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem(WEB_SESSION_USER_ID_KEY, uid);
  localStorage.setItem(WEB_SESSION_TOKEN_KEY, token);
  localStorage.setItem(WEB_SESSION_EXPIRES_KEY, String(expiresAt));

  const verified = peekWebSession();
  if (!verified || verified.userId !== uid || verified.sessionToken !== token) {
    console.log("KRISTO_WEB_SESSION_SAVE_FAILED", {
      reason: "verify-readback-failed",
      hasUserId: Boolean(localStorage.getItem(WEB_SESSION_USER_ID_KEY)),
      hasSessionToken: Boolean(localStorage.getItem(WEB_SESSION_TOKEN_KEY)),
      expiresAt: localStorage.getItem(WEB_SESSION_EXPIRES_KEY),
    });
    return false;
  }

  console.log("KRISTO_WEB_SESSION_SAVE", {
    ok: true,
    userId: uid,
    expiresAt,
    expiresAtIsFuture: expiresAt > now,
    sessionTokenLen: token.length,
    ttlHours: WEB_SESSION_MIN_TTL_MS / (60 * 60 * 1000),
  });
  return true;
}

export function persistWebSessionFromLogin(data: LoginSessionPayload) {
  const userId = extractLoginUserId(data);
  const sessionToken = extractLoginSessionToken(data);

  console.log("KRISTO_WEB_SIGNIN_RESPONSE", {
    hasUserId: Boolean(userId),
    hasSessionToken: Boolean(sessionToken),
    tokenLen: sessionToken.length,
    userId,
  });

  if (!userId || !sessionToken) {
    console.log("KRISTO_WEB_SESSION_SAVE_FAILED", {
      reason: "login-response-incomplete",
      hasUserId: Boolean(userId),
      hasSessionToken: Boolean(sessionToken),
      tokenLen: sessionToken.length,
    });
    return false;
  }

  return saveWebSession(userId, sessionToken);
}

export function clearWebSession() {
  if (!canUseStorage()) return;
  localStorage.removeItem(WEB_SESSION_STORAGE_KEY);
  localStorage.removeItem(WEB_SESSION_USER_ID_KEY);
  localStorage.removeItem(WEB_SESSION_TOKEN_KEY);
  localStorage.removeItem(WEB_SESSION_EXPIRES_KEY);
}

export function loadWebSession(): StoredWebSession | null {
  const session = peekWebSession();
  if (!session) {
    console.log("KRISTO_WEB_SESSION_LOAD", { found: false, reason: "empty-or-expired" });
    return null;
  }

  console.log("KRISTO_WEB_SESSION_LOAD", {
    found: true,
    userId: session.userId,
    expiresAt: session.expiresAt,
    expiresAtIsFuture: true,
    remainingMs: session.expiresAt - Date.now(),
    sessionTokenLen: session.sessionToken.length,
  });

  return session;
}

export function webAuthHeaders(): Record<string, string> {
  const session = peekWebSession();
  if (!session) return {};

  return {
    "x-kristo-user-id": session.userId,
    "x-kristo-session-token": session.sessionToken,
  };
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export async function webAuthFetch(input: RequestInfo | URL, init?: RequestInit) {
  const auth = webAuthHeaders();
  const hasUserId = Boolean(auth["x-kristo-user-id"]);
  const hasSessionToken = Boolean(auth["x-kristo-session-token"]);
  const tokenLen = auth["x-kristo-session-token"]?.length || 0;

  console.log("KRISTO_WEB_AUTH_FETCH_HEADERS", {
    url: resolveRequestUrl(input),
    hasUserId,
    hasSessionToken,
    tokenLen,
  });

  if (!hasUserId || !hasSessionToken) {
    console.log("KRISTO_WEB_SESSION_SAVE_FAILED", {
      reason: "localStorage-empty-before-fetch",
      url: resolveRequestUrl(input),
      storage: inspectWebSessionStorage(),
    });
  }

  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(auth)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
}

export function hasValidWebSession(): boolean {
  return Boolean(peekWebSession());
}
