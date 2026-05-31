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

export function getKristoHeaders(auth?: Partial<KristoAuth>) {
  const s = getSessionSync();
  const a = { ...getKristoAuth(), ...(auth || {}) };
  const displayName = String(s?.displayName || s?.name || "").trim();
  return {
    "x-kristo-user-id": a.userId,
    "x-kristo-role": a.role,
    "x-kristo-church-id": a.churchId,
    ...(displayName ? { "x-kristo-user-name": displayName, "x-kristo-display-name": displayName } : {}),
  } as const;
}
