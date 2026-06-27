export type PlatformRole = "System_Admin" | "Supervisor" | "Agent";

export function normalizePlatformRole(role: unknown): PlatformRole | null {
  const normalized = String(role || "").trim();
  if (normalized === "System_Admin") return "System_Admin";
  if (normalized === "Supervisor") return "Supervisor";
  if (normalized === "Agent") return "Agent";
  return null;
}

export function isPlatformRoleToken(role: unknown): boolean {
  return normalizePlatformRole(role) !== null;
}

/** Strip misplaced platform tokens from a church membership role. */
export function resolveChurchRoleOnly(churchRole: unknown): string {
  if (isPlatformRoleToken(churchRole)) return "Member";
  const role = String(churchRole || "").trim();
  return role || "Member";
}

export function resolveSessionPlatformRole(
  session: { platformRole?: unknown; offlineActivationRole?: unknown } | null | undefined
): PlatformRole | null {
  return (
    normalizePlatformRole(session?.platformRole) ||
    normalizePlatformRole(session?.offlineActivationRole) ||
    null
  );
}

export function resolvePlatformRoleFromAuthPayload(payload: {
  platformRole?: unknown;
  offlineActivationRole?: unknown;
} | null | undefined): PlatformRole | null {
  return (
    normalizePlatformRole(payload?.platformRole) ||
    normalizePlatformRole(payload?.offlineActivationRole) ||
    null
  );
}
