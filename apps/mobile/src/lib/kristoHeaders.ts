import { getSessionSync } from "./kristoSession";

export type KristoRole =
  | "System_Admin"
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
