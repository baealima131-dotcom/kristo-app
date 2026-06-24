import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { getChurchMediaByChurchId, upsertChurchMedia, type ChurchMediaProfile } from "@/app/api/_lib/store/mediaDb";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getChurchById } from "@/app/api/_lib/churches";
import { isChurchSubscriptionActiveFromRecord } from "@/lib/churchSubscription";

export const MAX_CHURCH_MEDIA_HOSTS = 3;

function normalizeChurchRoleToken(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isPastorChurchRole(value: unknown): boolean {
  const normalized = normalizeChurchRoleToken(value);
  return normalized === "pastor" || normalized.includes("pastor");
}

export type MediaHostRecord = {
  userId: string;
  name: string;
  role?: string;
  avatarUri?: string;
  avatarUrl?: string;
  kristoId?: string;
};

export function parseMediaHostUserIds(hosts: unknown): string[] {
  return (Array.isArray(hosts) ? hosts : [])
    .map((host: any) => String(host?.userId || host?.id || "").trim())
    .filter(Boolean);
}

function normalizeMemberUserId(value: unknown): string {
  return String(value || "").trim();
}

export async function resolveActualChurchPastorUserId(churchId: string): Promise<string> {
  const cid = String(churchId || "").trim();
  if (!cid) return "";

  const members = await getMembershipsForChurch(cid, "Active");
  const pastor = members.find((row) => isPastorChurchRole(row.churchRole));
  return normalizeMemberUserId(pastor?.userId);
}

async function resolveRequesterMembership(churchId: string, userId: string) {
  const members = await getMembershipsForChurch(churchId, "Active");
  const uid = normalizeMemberUserId(userId).toLowerCase();
  return (
    members.find((row) => normalizeMemberUserId(row.userId).toLowerCase() === uid) || null
  );
}

export async function getStoredMediaHosts(churchId: string): Promise<MediaHostRecord[]> {
  const media = await getChurchMediaByChurchId(churchId);
  const raw = Array.isArray(media?.hosts) ? media!.hosts : [];
  return raw
    .map((host: any) => ({
      userId: String(host?.userId || host?.id || "").trim(),
      name: String(host?.name || host?.displayName || "Church member").trim(),
      role: String(host?.role || host?.roleLabel || "Member").trim(),
      avatarUri: String(host?.avatarUri || host?.avatarUrl || "").trim(),
      avatarUrl: String(host?.avatarUrl || host?.avatarUri || "").trim(),
      kristoId: String(host?.kristoId || host?.userCode || "").trim(),
    }))
    .filter((host) => host.userId)
    .slice(0, MAX_CHURCH_MEDIA_HOSTS);
}

export async function evaluateChurchMediaAccess(args: {
  churchId: string;
  userId: string;
}) {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const actualPastorUserId = await resolveActualChurchPastorUserId(churchId);
  const requesterMembership = userId
    ? await resolveRequesterMembership(churchId, userId)
    : null;
  const requesterIsPastorMember = isPastorChurchRole(requesterMembership?.churchRole);
  const resolvedPastorUserId =
    actualPastorUserId || (requesterIsPastorMember ? userId : "");
  const hosts = await getStoredMediaHosts(churchId);
  const mediaHostUserIds = hosts.map((host) => host.userId);

  const isActualChurchPastor =
    !!userId &&
    (userId === actualPastorUserId ||
      requesterIsPastorMember ||
      (!!resolvedPastorUserId && userId === resolvedPastorUserId));
  const isMediaHost = !!userId && mediaHostUserIds.includes(userId);
  const media = await getChurchMediaByChurchId(churchId);
  const subscriptionActive = isChurchSubscriptionActiveFromRecord(media);
  const canOpenMediaScreen = isActualChurchPastor || isMediaHost;
  const canUseMediaTools = subscriptionActive && canOpenMediaScreen;

  return {
    actualPastorUserId: resolvedPastorUserId || actualPastorUserId,
    hosts,
    mediaHostUserIds,
    isActualChurchPastor,
    isMediaHost,
    subscriptionActive,
    canOpenMediaScreen,
    canUseMediaTools,
    canAccessChurchMedia: canOpenMediaScreen,
    canManageMediaHosts: isActualChurchPastor,
  };
}

export async function assertActiveChurchMember(churchId: string, userId: string) {
  const cid = String(churchId || "").trim();
  const uid = String(userId || "").trim();
  if (!cid || !uid) throw new Error("churchId and userId are required");

  const members = await getMembershipsForChurch(cid, "Active");
  const row = members.find((member) => String(member.userId || "") === uid);
  if (!row) throw new Error("Only active church members can be media hosts");
  return row;
}

export async function buildMediaHostRecord(
  churchId: string,
  userId: string,
  fallback?: Partial<MediaHostRecord>
): Promise<MediaHostRecord> {
  const membership = await assertActiveChurchMember(churchId, userId);
  if (String(membership.churchRole || "") === "Pastor") {
    throw new Error("Pastor already has media access");
  }

  const profile: any = (await getProfile(userId)) || {};
  const name = String(
    fallback?.name ||
      profile.fullName ||
      profile.displayName ||
      membership.name ||
      "Church member"
  ).trim();
  const avatar = String(
    fallback?.avatarUri ||
      fallback?.avatarUrl ||
      profile.avatarUri ||
      profile.avatarUrl ||
      profile.profileImage ||
      ""
  ).trim();

  return {
    userId,
    name,
    role: String(fallback?.role || membership.churchRole || "Member"),
    avatarUri: avatar,
    avatarUrl: avatar,
    kristoId: String(
      fallback?.kristoId || profile.userCode || ""
    ).trim(),
  };
}

export class ChurchMediaAutoCreateForbiddenError extends Error {
  constructor() {
    super("Only the church Pastor can create Church Media");
    this.name = "ChurchMediaAutoCreateForbiddenError";
  }
}

export async function ensureChurchMediaProfileForPastor(args: {
  churchId: string;
  actualPastorUserId: string;
  requesterUserId: string;
}): Promise<ChurchMediaProfile> {
  const churchId = String(args.churchId || "").trim();
  const requesterUserId = String(args.requesterUserId || "").trim();

  const existing = await getChurchMediaByChurchId(churchId);
  if (existing?.mediaName) return existing;

  let pastorUserId = String(args.actualPastorUserId || "").trim();
  if (!pastorUserId) {
    const membership = await resolveRequesterMembership(churchId, requesterUserId);
    if (isPastorChurchRole(membership?.churchRole)) {
      pastorUserId = requesterUserId;
    }
  }

  if (!pastorUserId || requesterUserId !== pastorUserId) {
    throw new ChurchMediaAutoCreateForbiddenError();
  }

  console.log("KRISTO_MEDIA_AUTO_CREATE_START", {
    churchId,
    actualPastorUserId: pastorUserId,
    requesterUserId,
  });

  try {
    const church = await getChurchById(churchId);
    const churchName = String(church?.name || "Church").trim() || "Church";
    const mediaName = `${churchName} Media`;

    const created = await upsertChurchMedia({
      churchId,
      ownerUserId: pastorUserId,
      patch: {
        mediaName,
        category: "Church Media",
        visibility: "church",
        churchId,
        createdBy: pastorUserId,
      } as Partial<ChurchMediaProfile> & { mediaName: string },
    });

    console.log("KRISTO_MEDIA_AUTO_CREATE_SUCCESS", {
      churchId,
      actualPastorUserId: pastorUserId,
      mediaId: created.id,
      mediaName: created.mediaName,
    });

    return created;
  } catch (error: any) {
    console.error("KRISTO_MEDIA_AUTO_CREATE_FAILED", {
      churchId,
      actualPastorUserId: pastorUserId,
      requesterUserId,
      error: String(error?.message || error || "unknown"),
    });
    throw new Error("Create Church Media profile first");
  }
}
