import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { hasDurableStore } from "@/app/api/_lib/store/authDb";
import {
  dbGetPlatformRole,
  dbUpsertPlatformRole,
  ensurePlatformRoleStoreReady,
  resolvePlatformRoleStoreMode,
  type PlatformRoleStoreMode,
  type PlatformRole,
  type PlatformRoleRecord,
} from "@/app/api/_lib/store/platformRoleDb";

export type { PlatformRole, PlatformRoleRecord, PlatformRoleStoreMode };

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

export { resolvePlatformRoleStoreMode };

async function readPlatformRoleJsonStore(): Promise<PlatformRoleRecord[]> {
  const rows = await readJsonFile<PlatformRoleRecord[]>(STORE_FILE, []);
  return Array.isArray(rows) ? rows : [];
}

async function getPlatformRoleFromJson(userId: string): Promise<PlatformRole | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const rows = await readPlatformRoleJsonStore();
  const row = rows.find((entry) => String(entry.userId || "").trim() === uid);
  return normalizePlatformRole(row?.platformRole);
}

export async function getPlatformRole(userId: string): Promise<PlatformRole | null> {
  const uid = String(userId || "").trim();
  if (!uid) return null;

  if (hasDurableStore()) {
    await ensurePlatformRoleStoreReady();
    return dbGetPlatformRole(uid);
  }

  return getPlatformRoleFromJson(uid);
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

export async function upsertPlatformRole(
  userId: string,
  platformRole: unknown,
  note?: string
): Promise<PlatformRoleRecord> {
  const uid = String(userId || "").trim();
  const role = normalizePlatformRole(platformRole);
  if (!uid) throw new Error("userId required");
  if (!role) throw new Error("Invalid platformRole");

  if (hasDurableStore()) {
    await ensurePlatformRoleStoreReady();
    return dbUpsertPlatformRole(uid, role, note);
  }

  const updatedAt = new Date().toISOString();
  const nextRows = await updateJsonFile<PlatformRoleRecord[]>(
    STORE_FILE,
    (current) => {
      const rows = Array.isArray(current) ? current : [];
      const idx = rows.findIndex((entry) => String(entry.userId || "").trim() === uid);
      const row: PlatformRoleRecord = {
        userId: uid,
        platformRole: role,
        updatedAt,
        ...(note ? { note: String(note).trim() } : {}),
      };
      if (idx >= 0) {
        const copy = rows.slice();
        copy[idx] = { ...rows[idx], ...row };
        return copy;
      }
      return [row, ...rows];
    },
    []
  );

  const saved = nextRows.find((entry) => String(entry.userId || "").trim() === uid);
  if (!saved) throw new Error("Failed to save platform role");
  return saved;
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
