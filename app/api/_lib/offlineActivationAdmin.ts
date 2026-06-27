import { getUserById } from "@/app/api/auth/_lib/session";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";
import { getChurchById } from "@/app/api/_lib/churches";
import {
  getMembershipsForUser,
  normalizeMembershipChurchId,
} from "@/app/api/_lib/memberships";
import { getPlatformRole, upsertPlatformRole, type PlatformRole } from "@/app/api/_lib/platformRoles";

export type ActivationUserRef = {
  userId: string;
  kristoId: string;
  churchId: string;
  fullName?: string;
};

const KRISTO_ID_PATTERN = /^KR7-[A-Z0-9]{6,10}$/;

export function normalizeKristoIdInput(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

export function isValidKristoId(value: unknown): boolean {
  return KRISTO_ID_PATTERN.test(normalizeKristoIdInput(value));
}

export async function resolveUserByKristoId(kristoId: string): Promise<{
  userId: string;
  kristoId: string;
  fullName?: string;
}> {
  const normalizedKristoId = normalizeKristoIdInput(kristoId);
  if (!normalizedKristoId) {
    throw new Error("KRISTO ID is required");
  }
  if (!isValidKristoId(normalizedKristoId)) {
    throw new Error("Invalid KRISTO ID format");
  }

  const profile = await getProfileByUserCode(normalizedKristoId);
  const userId = String(profile?.userId || "").trim();
  if (!profile || !userId) {
    throw new Error("KRISTO ID not found");
  }

  const user = await getUserById(userId);
  if (!user) {
    throw new Error("KRISTO ID not found");
  }

  return {
    userId,
    kristoId: String(profile.userCode || normalizedKristoId).trim().toUpperCase(),
    fullName: String(profile.fullName || "").trim() || undefined,
  };
}

export async function addSupervisorByKristoAndChurch(
  kristoId: string,
  churchId: string,
  addedByUserId: string
): Promise<{ user: ActivationUserRef; platformRole: PlatformRole }> {
  const normalizedChurchId = normalizeMembershipChurchId(churchId);
  if (!normalizedChurchId) {
    throw new Error("Church ID is required");
  }

  const resolved = await resolveUserByKristoId(kristoId);

  const church = await getChurchById(normalizedChurchId);
  if (!church) {
    throw new Error("Church ID not found");
  }

  const memberships = await getMembershipsForUser(resolved.userId);
  const activeAtChurch = memberships.find(
    (membership) =>
      membership.status === "Active" &&
      normalizeMembershipChurchId(membership.churchId) === normalizedChurchId
  );
  if (!activeAtChurch) {
    throw new Error("User is not an Active member of this church");
  }

  const existing = await getPlatformRole(resolved.userId);
  if (existing === "System_Admin") {
    throw new Error("User is already System_Admin");
  }
  if (existing === "Supervisor") {
    throw new Error("User is already a Supervisor");
  }
  if (existing === "Agent") {
    throw new Error("User is already an Agent");
  }

  const saved = await upsertPlatformRole(
    resolved.userId,
    "Supervisor",
    `Supervisor for ${normalizedChurchId} • KRISTO ${resolved.kristoId} • added by ${String(addedByUserId || "").trim() || "unknown"}`
  );

  return {
    user: {
      userId: resolved.userId,
      kristoId: resolved.kristoId,
      churchId: normalizedChurchId,
      fullName: resolved.fullName,
    },
    platformRole: saved.platformRole,
  };
}
