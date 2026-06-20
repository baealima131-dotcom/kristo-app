import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { resolveChurchPastorUserId } from "@/app/api/_lib/churchPastor";
import type { Role } from "@/app/api/_lib/rbac";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

const PROTECTED_CHURCH_ROLES = new Set(["Pastor", "Church_Admin", "System_Admin"]);

export function isProtectedChurchRole(churchRole: string): boolean {
  return PROTECTED_CHURCH_ROLES.has(String(churchRole || "").trim());
}

export function isMinistryLeaderViewerRole(viewerRole: Role): boolean {
  return viewerRole === "Leader" || viewerRole === "Ministry_Leader";
}

export function isPastorLevelViewerRole(viewerRole: Role): boolean {
  return viewerRole === "Pastor" || viewerRole === "Church_Admin" || viewerRole === "System_Admin";
}

export async function getTargetChurchRole(churchId: string, userId: string): Promise<string> {
  const actives = await getMembershipsForChurch(churchId, "Active");
  const row = actives.find((m) => m.userId === userId);
  return String(row?.churchRole || "").trim();
}

export type MinistryMemberRemoveGuardResult = {
  allowed: boolean;
  error?: string;
  isTargetPastor: boolean;
  targetChurchRole: string;
};

export async function evaluateMinistryMemberRemoveGuard(args: {
  churchId: string;
  ministryId: string;
  viewerUserId: string;
  viewerRole: Role;
  targetUserId: string;
}): Promise<MinistryMemberRemoveGuardResult> {
  const pastorResolution = await resolveChurchPastorUserId(args.churchId);
  const actualPastorUserId = String(pastorResolution.actualChurchPastorUserId || "").trim();
  const targetChurchRole = await getTargetChurchRole(args.churchId, args.targetUserId);
  const isTargetPastor = Boolean(actualPastorUserId && actualPastorUserId === args.targetUserId);

  let allowed = true;
  let error: string | undefined;

  if (isTargetPastor) {
    allowed = false;
    error = "Pastor cannot be removed from a ministry.";
  } else if (
    isMinistryLeaderViewerRole(args.viewerRole) &&
    !isPastorLevelViewerRole(args.viewerRole) &&
    isProtectedChurchRole(targetChurchRole)
  ) {
    allowed = false;
    error = "Pastor cannot be removed from a ministry.";
  }

  console.log("KRISTO_MINISTRY_MEMBER_REMOVE_GUARD", {
    viewerUserId: args.viewerUserId,
    targetUserId: args.targetUserId,
    ministryId: args.ministryId,
    viewerRole: args.viewerRole,
    targetChurchRole,
    isTargetPastor,
    allowed,
  });

  return { allowed, error, isTargetPastor, targetChurchRole };
}

export async function evaluateMinistryMemberRoleChangeGuard(args: {
  churchId: string;
  ministryId: string;
  viewerUserId: string;
  viewerRole: Role;
  targetUserId: string;
  nextRole: string;
}): Promise<MinistryMemberRemoveGuardResult> {
  const removeGuard = await evaluateMinistryMemberRemoveGuard(args);

  if (!removeGuard.isTargetPastor) {
    if (
      isMinistryLeaderViewerRole(args.viewerRole) &&
      !isPastorLevelViewerRole(args.viewerRole) &&
      isProtectedChurchRole(removeGuard.targetChurchRole)
    ) {
      console.log("KRISTO_MINISTRY_MEMBER_REMOVE_GUARD", {
        viewerUserId: args.viewerUserId,
        targetUserId: args.targetUserId,
        ministryId: args.ministryId,
        viewerRole: args.viewerRole,
        targetChurchRole: removeGuard.targetChurchRole,
        isTargetPastor: false,
        allowed: false,
      });
      return {
        allowed: false,
        error: "Pastor cannot be removed from a ministry.",
        isTargetPastor: false,
        targetChurchRole: removeGuard.targetChurchRole,
      };
    }
    return { ...removeGuard, allowed: true };
  }

  if (args.nextRole !== "Leader") {
    console.log("KRISTO_MINISTRY_MEMBER_REMOVE_GUARD", {
      viewerUserId: args.viewerUserId,
      targetUserId: args.targetUserId,
      ministryId: args.ministryId,
      viewerRole: args.viewerRole,
      targetChurchRole: removeGuard.targetChurchRole,
      isTargetPastor: true,
      allowed: false,
    });
    return {
      allowed: false,
      error: "Pastor cannot be removed from a ministry.",
      isTargetPastor: true,
      targetChurchRole: removeGuard.targetChurchRole,
    };
  }

  return { ...removeGuard, allowed: true };
}

type MinistryMemberRow = {
  id: string;
  churchId: string;
  ministryId: string;
  userId: string;
  role: string;
  createdAt: string;
  updatedAt?: string;
};

async function resolveDisplayName(userId: string): Promise<string> {
  const profile: any = (await getProfile(userId)) || null;
  const user: any = await getUserById(userId);
  return String(
    profile?.fullName ||
      profile?.displayName ||
      profile?.name ||
      user?.fullName ||
      user?.displayName ||
      user?.name ||
      user?.email ||
      "Pastor"
  ).trim();
}

export async function applyPastorAuthorityToMinistryMembers<T extends MinistryMemberRow>(
  churchId: string,
  ministryId: string,
  members: T[],
  enrich: (row: MinistryMemberRow) => Promise<T>
): Promise<T[]> {
  const { actualChurchPastorUserId } = await resolveChurchPastorUserId(churchId);
  const pastorUserId = String(actualChurchPastorUserId || "").trim();
  if (!pastorUserId) {
    return members;
  }

  const enriched = await Promise.all(members.map(enrich));
  const pastorIdx = enriched.findIndex((row) => String(row.userId || "").trim() === pastorUserId);

  if (pastorIdx >= 0) {
    const pastorRow = {
      ...enriched[pastorIdx],
      role: "Leader",
      isChurchPastor: true,
      isProtected: true,
      displayName:
        String((enriched[pastorIdx] as any).displayName || "").trim() ||
        (await resolveDisplayName(pastorUserId)),
    } as T;
    const rest = enriched.filter((_, index) => index !== pastorIdx);
    return [pastorRow, ...rest];
  }

  const displayName = await resolveDisplayName(pastorUserId);
  const synthetic = (await enrich({
    id: `pastor_authority_${pastorUserId}`,
    churchId,
    ministryId,
    userId: pastorUserId,
    role: "Leader",
    createdAt: new Date().toISOString(),
  })) as T;

  return [
    {
      ...synthetic,
      role: "Leader",
      displayName,
      isChurchPastor: true,
      isProtected: true,
      isSynthetic: true,
    } as T,
    ...enriched,
  ];
}
