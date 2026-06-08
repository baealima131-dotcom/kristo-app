/** Web-only session persistence (localStorage + signed token headers). Mobile uses SecureStore. */

export const WEB_SESSION_STORAGE_KEY = "kristo_web_session";
export const WEB_SESSION_MIN_TTL_MS = 12 * 60 * 60 * 1000;

type StoredWebSession = {
  userId: string;
  sessionToken: string;
  expiresAt: number;
  savedAt: number;
};

function canUseStorage() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function inspectWebSessionStorage() {
  if (!canUseStorage()) {
    return { available: false as const };
  }

  const raw = localStorage.getItem(WEB_SESSION_STORAGE_KEY);
  if (!raw) {
    return { available: true, found: false as const };
  }

  try {
    const parsed = JSON.parse(raw) as StoredWebSession;
    const userId = String(parsed?.userId || "").trim();
    const sessionToken = String(parsed?.sessionToken || "").trim();
    const expiresAt = Number(parsed?.expiresAt || 0);
    const now = Date.now();

    return {
      available: true,
      found: true as const,
      userId: userId || null,
      hasSessionToken: Boolean(sessionToken),
      sessionTokenLen: sessionToken.length,
      expiresAt: expiresAt || null,
      expiresAtIsFuture: expiresAt > now,
      remainingMs: expiresAt > now ? expiresAt - now : 0,
    };
  } catch {
    return { available: true, found: false as const, reason: "parse-error" as const };
  }
}

export function saveWebSession(userId: string, sessionToken: string) {
  if (!canUseStorage()) {
    console.log("KRISTO_WEB_SESSION_SAVE", { ok: false, reason: "no-localStorage" });
    return false;
  }

  const uid = String(userId || "").trim();
  const token = String(sessionToken || "").trim();
  if (!uid || !token) {
    console.log("KRISTO_WEB_SESSION_SAVE", {
      ok: false,
      reason: "missing-fields",
      hasUserId: Boolean(uid),
      hasSessionToken: Boolean(token),
    });
    return false;
  }

  const now = Date.now();
  const payload: StoredWebSession = {
    userId: uid,
    sessionToken: token,
    expiresAt: now + WEB_SESSION_MIN_TTL_MS,
    savedAt: now,
  };

  localStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(payload));
  console.log("KRISTO_WEB_SESSION_SAVE", {
    ok: true,
    userId: uid,
    expiresAt: payload.expiresAt,
    expiresAtIsFuture: payload.expiresAt > now,
    sessionTokenLen: token.length,
    ttlHours: WEB_SESSION_MIN_TTL_MS / (60 * 60 * 1000),
  });
  return true;
}

export function saveWebSessionFromLoginResponse(data: { userId?: unknown; sessionToken?: unknown }) {
  return saveWebSession(String(data?.userId || ""), String(data?.sessionToken || ""));
}

export function clearWebSession() {
  if (!canUseStorage()) return;
  localStorage.removeItem(WEB_SESSION_STORAGE_KEY);
}

export function loadWebSession(): StoredWebSession | null {
  if (!canUseStorage()) return null;

  const raw = localStorage.getItem(WEB_SESSION_STORAGE_KEY);
  if (!raw) {
    console.log("KRISTO_WEB_SESSION_LOAD", { found: false, reason: "empty" });
    return null;
  }

  let parsed: StoredWebSession | null = null;
  try {
    parsed = JSON.parse(raw) as StoredWebSession;
  } catch {
    clearWebSession();
    console.log("KRISTO_WEB_SESSION_LOAD", { found: false, reason: "parse-error" });
    return null;
  }

  const userId = String(parsed?.userId || "").trim();
  const sessionToken = String(parsed?.sessionToken || "").trim();
  const expiresAt = Number(parsed?.expiresAt || 0);

  if (!userId || !sessionToken || !expiresAt) {
    clearWebSession();
    console.log("KRISTO_WEB_SESSION_LOAD", {
      found: false,
      reason: "incomplete",
      hasUserId: Boolean(userId),
      hasSessionToken: Boolean(sessionToken),
      hasExpiresAt: Boolean(expiresAt),
    });
    return null;
  }

  const now = Date.now();
  if (now >= expiresAt) {
    console.log("KRISTO_WEB_SESSION_EXPIRED", {
      userId,
      expiresAt,
      expiredMsAgo: now - expiresAt,
    });
    clearWebSession();
    return null;
  }

  console.log("KRISTO_WEB_SESSION_LOAD", {
    found: true,
    userId,
    expiresAt,
    expiresAtIsFuture: true,
    remainingMs: expiresAt - now,
    sessionTokenLen: sessionToken.length,
  });

  return { userId, sessionToken, expiresAt, savedAt: Number(parsed?.savedAt || now) };
}

export function webAuthHeaders(): Record<string, string> {
  const session = loadWebSession();
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
  const headers = new Headers(init?.headers);
  const auth = webAuthHeaders();

  for (const [key, value] of Object.entries(auth)) {
    if (!headers.has(key)) headers.set(key, value);
  }

  console.log("KRISTO_WEB_AUTH_FETCH_HEADERS", {
    url: resolveRequestUrl(input),
    hasUserId: Boolean(auth["x-kristo-user-id"]),
    hasSessionToken: Boolean(auth["x-kristo-session-token"]),
    userId: auth["x-kristo-user-id"] || null,
    sessionTokenLen: auth["x-kristo-session-token"]?.length || 0,
  });

  return fetch(input, {
    ...init,
    headers,
    credentials: init?.credentials ?? "include",
  });
}
