import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type PlatformRole = "System_Admin" | "Supervisor" | "Agent";

export type PlatformRoleRecord = {
  userId: string;
  platformRole: PlatformRole;
  updatedAt?: string;
  note?: string;
};

const STORE_FILE = "platform_roles.json";

const PLATFORM_ROLE_TOKENS = new Set<PlatformRole>(["System_Admin", "Supervisor", "Agent"]);

export function normalizePlatformRole(role: unknown): PlatformRole | null {
  const normalized = String(role || "").trim();
  if (PLATFORM_ROLE_TOKENS.has(normalized as PlatformRole)) {
    return normalized as PlatformRole;
  }
  return null;
}

export function isPlatformRoleToken(role: unknown): boolean {
  return normalizePlatformRole(role) !== null;
}

/** Church membership role only — platform roles must not grant church permissions. */
export function resolveChurchRoleForGuard(churchRole: unknown): string {
  const raw = String(churchRole || "").trim();
  if (isPlatformRoleToken(raw)) return "Member";
  if (raw === "Pastor") return "Pastor";
  if (raw === "Church_Admin") return "Church_Admin";
  if (raw === "Ministry_Leader") return "Ministry_Leader";
  if (raw === "Leader") return "Leader";
  if (raw === "Member") return "Member";
  return raw || "Member";
}

async function readPlatformRoleStore(): Promise<PlatformRoleRecord[]> {
  const rows = await readJsonFile<PlatformRoleRecord[]>(STORE_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

export async function getPlatformRole(userId: string): Promise<PlatformRole | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const rows = await readPlatformRoleStore();
  const row = rows.find((entry) => String(entry.userId || "").trim() === uid);
  return normalizePlatformRole(row?.platformRole);
}

/**
 * Platform role from dedicated store, with legacy fallback when churchRole
 * still carries a platform token from before the split.
 */
export async function resolvePlatformRoleForUser(
  userId: string,
  legacyChurchRole?: unknown
): Promise<PlatformRole | null> {
  const fromStore = await getPlatformRole(userId);
  if (fromStore) return fromStore;
  return normalizePlatformRole(legacyChurchRole);
}

export function isSystemAdminPlatformRole(role: unknown): boolean {
  return normalizePlatformRole(role) === "System_Admin";
}

export function canAccessOfflineActivationAdmin(platformRole: unknown): boolean {
  return isSystemAdminPlatformRole(platformRole);
}

export function canAccessOfflineActivationSupervisor(platformRole: unknown): boolean {
  return normalizePlatformRole(platformRole) === "Supervisor";
}

export function canAccessOfflineActivationAgent(platformRole: unknown): boolean {
  return normalizePlatformRole(platformRole) === "Agent";
}
