import { readMinistryJsonFile as readJsonFile } from "@/app/api/_lib/store/ministryDb";
import { getProfile, getProfileByUserCode } from "@/app/api/auth/_lib/profile";

type MinistryMemberRow = {
  churchId?: string;
  ministryId?: string;
  userId?: string;
  memberId?: string;
  role?: string;
};

type MinistryRow = {
  id: string;
  churchId: string;
  name: string;
  description?: string;
  avatarUri?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  mediaAccess?: boolean;
};

export type MinistryStatsScope = {
  scope: "church-all" | "joined";
  serverRole: string;
  churchId: string;
  userId: string;
  resolvedUserId: string;
  matchUserIds: string[];
  joinedMinistryIds: string[];
  ministriesCount: number;
  ministryMembersCount: number;
};

export type JoinedMinistry = MinistryRow & {
  memberRole: string;
  memberStatus: string;
};

const MINISTRIES_FILE = "ministries.json";
const MINISTRY_MEMBERS_FILE = "ministry-members.json";

const KRISTO_USER_CODE = /^KR7-[A-Z0-9]{6,10}$/i;

export function isChurchWideMinistryScopeRole(role: string): boolean {
  const r = String(role || "").trim();
  return r === "Pastor" || r === "Church_Admin" || r === "System_Admin";
}

function normId(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function rowUserId(row: MinistryMemberRow): string {
  return String(row?.userId || row?.memberId || "").trim();
}

function rowMatchIds(row: MinistryMemberRow): string[] {
  return [row?.userId, row?.memberId].map(normId).filter(Boolean);
}

export type MinistryViewerIdentity = {
  rawUserId: string;
  resolvedUserId: string;
  userCode?: string;
  matchUserIds: string[];
};

export async function resolveMinistryViewerUserId(userId: string): Promise<MinistryViewerIdentity> {
  const rawUserId = String(userId || "").trim();
  const matchUserIds = new Set<string>();

  if (rawUserId) matchUserIds.add(normId(rawUserId));

  let resolvedUserId = rawUserId;
  let userCode: string | undefined;

  if (KRISTO_USER_CODE.test(rawUserId)) {
    const profile = await getProfileByUserCode(rawUserId);
    if (profile?.userId) {
      resolvedUserId = String(profile.userId).trim();
      userCode = String(profile.userCode || rawUserId).trim().toUpperCase();
      matchUserIds.add(normId(resolvedUserId));
      matchUserIds.add(normId(rawUserId));
      if (profile.userCode) matchUserIds.add(normId(profile.userCode));
      if (profile.coreId) matchUserIds.add(normId(profile.coreId));
      if (profile.coreIdBirth) matchUserIds.add(normId(profile.coreIdBirth));
    }
  } else if (rawUserId) {
    const profile = await getProfile(rawUserId);
    if (profile?.userId) {
      resolvedUserId = String(profile.userId).trim();
      matchUserIds.add(normId(resolvedUserId));
      if (profile.userCode) {
        userCode = String(profile.userCode).trim().toUpperCase();
        matchUserIds.add(normId(profile.userCode));
      }
      if (profile.coreId) matchUserIds.add(normId(profile.coreId));
      if (profile.coreIdBirth) matchUserIds.add(normId(profile.coreIdBirth));
    }
  }

  return {
    rawUserId,
    resolvedUserId,
    userCode,
    matchUserIds: [...matchUserIds],
  };
}

function rowMatchesViewer(row: MinistryMemberRow, matchUserIds: Set<string>): boolean {
  return rowMatchIds(row).some((id) => matchUserIds.has(id));
}

export function logMinistryScope(
  tag: "KRISTO_OVERVIEW_MINISTRY_SCOPE" | "KRISTO_MY_MINISTRIES_SCOPE",
  payload: Record<string, unknown>
) {
  console.log(tag, payload);
}

export async function readMinistryMemberRows(): Promise<MinistryMemberRow[]> {
  const data = await readJsonFile<MinistryMemberRow[]>(MINISTRY_MEMBERS_FILE, []);
  return Array.isArray(data) ? data : [];
}

export async function readChurchMinistries(churchId: string): Promise<MinistryRow[]> {
  const cid = String(churchId || "").trim();
  if (!cid) return [];

  const all = await readJsonFile<MinistryRow[]>(MINISTRIES_FILE, []);
  return (Array.isArray(all) ? all : []).filter((m) => String(m?.churchId || "") === cid);
}

export async function getUserMinistryMembershipRows(
  churchId: string,
  userId: string
): Promise<MinistryMemberRow[]> {
  const cid = String(churchId || "").trim();
  if (!cid || !String(userId || "").trim()) return [];

  const identity = await resolveMinistryViewerUserId(userId);
  const matchUserIds = new Set(identity.matchUserIds);
  if (!matchUserIds.size) return [];

  const all = await readMinistryMemberRows();
  return all.filter(
    (row) => String(row?.churchId || "") === cid && rowMatchesViewer(row, matchUserIds)
  );
}

export async function getUserJoinedMinistryIds(
  churchId: string,
  userId: string
): Promise<string[]> {
  const rows = await getUserMinistryMembershipRows(churchId, userId);
  const churchMinistries = await readChurchMinistries(churchId);
  const validIds = new Set(churchMinistries.map((m) => String(m.id || "")).filter(Boolean));

  return [
    ...new Set(
      rows
        .map((row) => String(row?.ministryId || "").trim())
        .filter((id) => id && validIds.has(id))
    ),
  ];
}

export async function getUserJoinedMinistries(
  churchId: string,
  userId: string
): Promise<JoinedMinistry[]> {
  const joinedIds = await getUserJoinedMinistryIds(churchId, userId);
  if (!joinedIds.length) return [];

  const churchMinistries = await readChurchMinistries(churchId);
  const rows = await getUserMinistryMembershipRows(churchId, userId);
  const membershipByMinistryId = new Map(
    rows.map((row) => [String(row?.ministryId || ""), row] as const)
  );

  return churchMinistries
    .filter((m) => joinedIds.includes(String(m.id || "")))
    .map((m) => {
      const mine = membershipByMinistryId.get(String(m.id || ""));
      return {
        ...m,
        memberRole: String(mine?.role || "Member"),
        memberStatus: "Active",
      };
    });
}

export async function countUserJoinedMinistries(churchId: string, userId: string): Promise<number> {
  const joined = await getUserJoinedMinistries(churchId, userId);
  return joined.length;
}

async function countMembersInJoinedMinistries(
  churchId: string,
  joinedMinistryIds: string[]
): Promise<number> {
  if (!joinedMinistryIds.length) return 0;

  const joinedSet = new Set(joinedMinistryIds);
  const memberRows = (await readMinistryMemberRows()).filter(
    (row) =>
      String(row?.churchId || "") === churchId &&
      joinedSet.has(String(row?.ministryId || ""))
  );

  return new Set(memberRows.map((row) => rowUserId(row).toLowerCase()).filter(Boolean)).size;
}

export async function resolveMinistryStatsScope(args: {
  churchId: string;
  userId: string;
  serverRole: string;
}): Promise<MinistryStatsScope> {
  const churchId = String(args.churchId || "").trim();
  const userId = String(args.userId || "").trim();
  const serverRole = String(args.serverRole || "Member").trim();
  const identity = await resolveMinistryViewerUserId(userId);
  const memberRows = (await readMinistryMemberRows()).filter(
    (row) => String(row?.churchId || "") === churchId
  );

  if (isChurchWideMinistryScopeRole(serverRole)) {
    const churchMinistries = await readChurchMinistries(churchId);
    const joinedMinistryIds = await getUserJoinedMinistryIds(churchId, userId);
    const ministryMembersCount = new Set(
      memberRows.map((row) => rowUserId(row).toLowerCase()).filter(Boolean)
    ).size;

    return {
      scope: "church-all",
      serverRole,
      churchId,
      userId: identity.rawUserId,
      resolvedUserId: identity.resolvedUserId,
      matchUserIds: identity.matchUserIds,
      joinedMinistryIds,
      ministriesCount: churchMinistries.length,
      ministryMembersCount,
    };
  }

  const joined = await getUserJoinedMinistries(churchId, userId);
  const joinedMinistryIds = joined.map((m) => String(m.id || "")).filter(Boolean);
  const ministriesCount = joined.length;
  const ministryMembersCount = await countMembersInJoinedMinistries(churchId, joinedMinistryIds);

  return {
    scope: "joined",
    serverRole,
    churchId,
    userId: identity.rawUserId,
    resolvedUserId: identity.resolvedUserId,
    matchUserIds: identity.matchUserIds,
    joinedMinistryIds,
    ministriesCount,
    ministryMembersCount,
  };
}
