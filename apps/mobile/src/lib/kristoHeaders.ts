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
  const a = { ...getKristoAuth(), ...(auth || {}) };
  return {
    "x-kristo-user-id": a.userId,
    "x-kristo-role": a.role,
    "x-kristo-church-id": a.churchId,
  } as const;
}
