import { getSessionSync } from "./kristoSessionSync";

export type KristoRole =
  | "Church_Admin"
  | "Pastor"
  | "Ministry_Leader"
  | "Leader"
  | "Member";

export type KristoAuth = {
  userId: string;
  role: KristoRole;
  churchId: string; // empty => not joined
};

export function getKristoAuth(): KristoAuth {
  const s = getSessionSync();
  if (s) {
    return {
      userId: s.userId,
      role: s.role as KristoRole,
      churchId: s.churchId || "",
    };
  }

  return { userId: "", role: "Member", churchId: "" };
}

export function getKristoHeaders(auth?: Partial<KristoAuth> & { sessionToken?: string }) {
  const s = getSessionSync();
  const a = { ...getKristoAuth(), ...(auth || {}) };
  const displayName = String(s?.displayName || s?.name || "").trim();
  // Signed token proving server-verified identity. Prefer an explicit override
  // (used right after login before the session is persisted), else the stored
  // session token. Production rejects the user-id header without this token.
  const sessionToken = String(auth?.sessionToken || s?.sessionToken || "").trim();
  return {
    "x-kristo-user-id": a.userId,
    "x-kristo-role": a.role,
    "x-kristo-church-id": a.churchId,
    ...(sessionToken ? { "x-kristo-session-token": sessionToken } : {}),
    ...(displayName ? { "x-kristo-user-name": displayName, "x-kristo-display-name": displayName } : {}),
  } as const;
}

export type KristoSessionTokenMeta = {
  hasSessionToken: boolean;
  sessionTokenLen: number;
  source: "caller" | "session" | "none";
};

export function describeKristoSessionToken(
  auth?: Partial<KristoAuth> & { sessionToken?: string }
): KristoSessionTokenMeta {
  const callerToken = String(auth?.sessionToken || "").trim();
  if (callerToken) {
    return {
      hasSessionToken: true,
      sessionTokenLen: callerToken.length,
      source: "caller",
    };
  }

  const sessionToken = String(getSessionSync()?.sessionToken || "").trim();
  if (sessionToken) {
    return {
      hasSessionToken: true,
      sessionTokenLen: sessionToken.length,
      source: "session",
    };
  }

  return {
    hasSessionToken: false,
    sessionTokenLen: 0,
    source: "none",
  };
}

export function logKristoAuthHeadersDiag(
  path: string,
  headers: Record<string, string>,
  source = "kristo",
  tokenMeta?: KristoSessionTokenMeta
) {
  console.log("KRISTO_AUTH_HEADERS_DIAG", {
    path: String(path || "").split("?")[0],
    source,
    hasUserId: Boolean(headers["x-kristo-user-id"]),
    hasChurchId: Boolean(headers["x-kristo-church-id"]),
    hasRole: Boolean(headers["x-kristo-role"]),
    hasSessionToken: Boolean(headers["x-kristo-session-token"]),
    ...(tokenMeta ? { tokenMeta } : {}),
  });
}

/** Authenticated fetch/api headers with signed session token. */
export function buildKristoRequestHeaders(
  path: string,
  auth?: Partial<KristoAuth> & { sessionToken?: string },
  extra?: Record<string, string>,
  source = "buildKristoRequestHeaders"
) {
  const headers = {
    ...getKristoHeaders(auth),
    ...(extra || {}),
  } as Record<string, string>;
  logKristoAuthHeadersDiag(path, headers, source);
  return headers;
}
