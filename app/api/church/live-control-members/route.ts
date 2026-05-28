import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { getMembershipsForChurch, type ChurchRole } from "@/app/api/_lib/memberships";
import { isPastorAppRole } from "@/app/api/_lib/ministryAuthority";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

const STORE_FILE = "church-live-control-members.json";
const MC_HOSTS_FILE = "mc-hosts.json";
export const CHURCH_LIVE_CONTROL_ROOM_ID = "church-media-room";

type LiveControlMemberRow = {
  id: string;
  churchId: string;
  roomId: string;
  userId: string;
  status: "Suspended";
  suspendedAt: string;
  suspendedBy: string;
  updatedAt: string;
};

type McHostsRow = {
  assignmentId: string;
  churchId: string;
  hostUserIds: string[];
  updatedAt: string;
  updatedBy?: string;
};

type ApiErr = { ok: false; error: string; details?: unknown };

function json(data: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "lcm") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "live_control_members", limit: 90, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } },
      { status: 429 }
    );
  }
  return null;
}

async function readSuspensions(): Promise<LiveControlMemberRow[]> {
  const data = await readJsonFile<LiveControlMemberRow[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

async function readMcHosts(): Promise<McHostsRow[]> {
  const data = await readJsonFile<McHostsRow[]>(MC_HOSTS_FILE, []);
  return Array.isArray(data) ? data : [];
}

function isLeaderChurchRole(role: ChurchRole) {
  return role === "Leader" || role === "Ministry_Leader" || role === "Church_Admin";
}

function isProtectedChurchRole(role: ChurchRole) {
  return role === "Pastor" || role === "Church_Admin" || role === "Leader" || role === "Ministry_Leader";
}

async function isMcHostForRoom(churchId: string, roomId: string, userId: string) {
  const all = await readMcHosts();
  const row = all.find((x) => x.churchId === churchId && x.assignmentId === roomId);
  const ids = Array.isArray(row?.hostUserIds) ? row!.hostUserIds.map(String) : [];
  return ids.includes(userId);
}

async function removeUserFromMcHosts(args: {
  churchId: string;
  roomId: string;
  userId: string;
  updatedBy: string;
}) {
  await updateJsonFile<McHostsRow[]>(
    MC_HOSTS_FILE,
    (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      return list.map((row) => {
        if (row.churchId !== args.churchId || row.assignmentId !== args.roomId) return row;
        const before = Array.isArray(row.hostUserIds) ? row.hostUserIds.map(String) : [];
        const hostUserIds = before.filter((x) => x !== args.userId);
        if (hostUserIds.length === before.length) return row;
        return {
          ...row,
          hostUserIds,
          updatedAt: nowIso(),
          updatedBy: args.updatedBy,
        };
      });
    },
    []
  );
}

function assertCanManageLiveControlTarget(args: {
  viewerAppRole: string;
  viewerUserId: string;
  viewerIsMcHostOnly: boolean;
  targetChurchRole: ChurchRole;
  targetUserId: string;
}) {
  if (isPastorAppRole(args.viewerAppRole)) return null;

  if (args.viewerIsMcHostOnly) {
    return "Hosts cannot manage Church Live Control members";
  }

  const viewerIsLeader =
    args.viewerAppRole === "Leader" || args.viewerAppRole === "Church_Admin";

  if (!viewerIsLeader) {
    return "Forbidden (role)";
  }

  if (isProtectedChurchRole(args.targetChurchRole)) {
    return "Leaders cannot suspend another Leader or Pastor";
  }

  if (args.targetUserId === args.viewerUserId) {
    return "You cannot suspend yourself";
  }

  return null;
}

async function enrichLiveControlMember(args: {
  churchId: string;
  roomId: string;
  userId: string;
  churchRole: ChurchRole;
  name?: string;
  joinedAt?: string;
  suspended: boolean;
  suspendedAt?: string;
}) {
  const profile: any = (await getProfile(args.userId)) || null;
  const user: any = await getUserById(args.userId);
  const avatarUrl = String(
    profile?.avatarUrl ||
      profile?.avatarUri ||
      profile?.profileImage ||
      user?.avatarUrl ||
      user?.avatarUri ||
      user?.profileImage ||
      ""
  ).trim();
  const displayName = String(
    profile?.fullName ||
      profile?.displayName ||
      profile?.name ||
      user?.fullName ||
      user?.displayName ||
      user?.name ||
      args.name ||
      args.userId ||
      "Member"
  ).trim();

  const roleRaw = args.churchRole;
  const role =
    roleRaw === "Pastor"
      ? "Pastor"
      : isLeaderChurchRole(roleRaw)
        ? "Leader"
        : "Member";

  return {
    id: args.userId,
    userId: args.userId,
    churchId: args.churchId,
    roomId: args.roomId,
    ministryId: args.roomId,
    role,
    roleLabel: roleRaw,
    status: args.suspended ? "Suspended" : "Active",
    liveControlStatus: args.suspended ? "Suspended" : "Active",
    displayName,
    fullName: displayName,
    name: displayName,
    avatarUrl,
    avatarUri: avatarUrl,
    profileImage: avatarUrl,
    joinedAt: args.joinedAt || "",
    suspendedAt: args.suspendedAt || "",
  };
}

export async function GET(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const url = new URL(req.url);
  const roomId = String(url.searchParams.get("roomId") || CHURCH_LIVE_CONTROL_ROOM_ID).trim();

  if (roomId !== CHURCH_LIVE_CONTROL_ROOM_ID) {
    return json({ ok: false, error: "Unsupported roomId" } satisfies ApiErr, { status: 400 });
  }

  const memberships = await getMembershipsForChurch(churchId, "Active");
  const suspensions = await readSuspensions();
  const suspendedByUserId = new Map<string, LiveControlMemberRow>();

  for (const row of suspensions) {
    if (row.churchId === churchId && row.roomId === roomId && row.status === "Suspended") {
      suspendedByUserId.set(String(row.userId || ""), row);
    }
  }

  const data = await Promise.all(
    memberships.map((m) => {
      const userId = String(m.userId || "").trim();
      const suspendedRow = suspendedByUserId.get(userId);
      return enrichLiveControlMember({
        churchId,
        roomId,
        userId,
        churchRole: (m.churchRole ?? "Member") as ChurchRole,
        name: m.name,
        joinedAt: m.decidedAt || m.createdAt,
        suspended: !!suspendedRow,
        suspendedAt: suspendedRow?.suspendedAt,
      });
    })
  );

  const viewerUserId = String(viewer.userId || "").trim();
  const selfRow = data.find((row) => String(row.userId || "") === viewerUserId);
  const selfLiveControlStatus = String(
    selfRow?.liveControlStatus || selfRow?.status || "Active"
  );

  return json({
    ok: true,
    data,
    self: {
      userId: viewerUserId,
      liveControlStatus: selfLiveControlStatus,
      status: selfLiveControlStatus,
      roomId,
    },
  });
}

type PatchAction = "suspend" | "unsuspend";

export async function PATCH(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;
  const body = await req.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  const action = String(body.action || "").trim().toLowerCase() as PatchAction;
  const userId = String(body.userId || body.memberId || "").trim();
  const roomId = String(body.roomId || CHURCH_LIVE_CONTROL_ROOM_ID).trim();

  console.log("[LiveControlMembers] suspend request", {
    action,
    churchId,
    roomId,
    userId,
    viewerUserId: viewer.userId,
    viewerRole: viewer.role,
  });

  if (roomId !== CHURCH_LIVE_CONTROL_ROOM_ID) {
    console.log("[LiveControlMembers] suspend failed", { reason: "unsupported-room", roomId });
    return json({ ok: false, error: "Unsupported roomId" } satisfies ApiErr, { status: 400 });
  }

  if (action !== "suspend" && action !== "unsuspend") {
    console.log("[LiveControlMembers] suspend failed", { reason: "invalid-action", action });
    return json({ ok: false, error: "Invalid action. Use: suspend | unsuspend" } satisfies ApiErr, { status: 400 });
  }

  if (!userId) {
    console.log("[LiveControlMembers] suspend failed", { reason: "missing-userId" });
    return json({ ok: false, error: "Missing userId" } satisfies ApiErr, { status: 400 });
  }

  const memberships = await getMembershipsForChurch(churchId, "Active");
  const targetMembership = memberships.find((m) => String(m.userId || "") === userId);
  if (!targetMembership) {
    console.log("[LiveControlMembers] suspend failed", { reason: "not-active-church-member", userId });
    return json({ ok: false, error: "Active church member not found" } satisfies ApiErr, { status: 404 });
  }

  const targetChurchRole = (targetMembership.churchRole ?? "Member") as ChurchRole;
  const viewerIsLeaderRole = viewer.role === "Leader" || viewer.role === "Church_Admin";
  const viewerIsMcHostOnly =
    !isPastorAppRole(viewer.role) &&
    !viewerIsLeaderRole &&
    (await isMcHostForRoom(churchId, roomId, viewer.userId));

  if (action === "suspend") {
    const modifyErr = assertCanManageLiveControlTarget({
      viewerAppRole: viewer.role,
      viewerUserId: viewer.userId,
      viewerIsMcHostOnly,
      targetChurchRole,
      targetUserId: userId,
    });
    if (modifyErr) {
      console.log("[LiveControlMembers] suspend failed", { reason: modifyErr, userId });
      return json({ ok: false, error: modifyErr } satisfies ApiErr, { status: 403 });
    }

    const allBefore = await readSuspensions();
    const existing = allBefore.find(
      (row) =>
        row.churchId === churchId &&
        row.roomId === roomId &&
        row.userId === userId &&
        row.status === "Suspended"
    );

    if (existing) {
      console.log("[LiveControlMembers] suspend success", {
        suspended: true,
        userId,
        roomId,
        alreadySuspended: true,
      });
      return json({ ok: true, suspended: true, userId, roomId });
    }

    const record: LiveControlMemberRow = {
      id: id(),
      churchId,
      roomId,
      userId,
      status: "Suspended",
      suspendedAt: nowIso(),
      suspendedBy: viewer.userId,
      updatedAt: nowIso(),
    };

    await updateJsonFile<LiveControlMemberRow[]>(
      STORE_FILE,
      (rows) => {
        const list = Array.isArray(rows) ? rows : [];
        return [...list.filter((row) => !(row.churchId === churchId && row.roomId === roomId && row.userId === userId)), record];
      },
      []
    );

    try {
      await removeUserFromMcHosts({
        churchId,
        roomId,
        userId,
        updatedBy: viewer.userId,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "mc-host cleanup failed";
      console.log("[LiveControlMembers] suspend mc-host cleanup warning", { userId, error: msg });
    }

    console.log("[LiveControlMembers] suspend success", { suspended: true, userId, roomId });
    return json({ ok: true, suspended: true, userId, roomId });
  }

  // unsuspend
  const modifyErr = assertCanManageLiveControlTarget({
    viewerAppRole: viewer.role,
    viewerUserId: viewer.userId,
    viewerIsMcHostOnly,
    targetChurchRole,
    targetUserId: userId,
  });
  if (modifyErr) {
    console.log("[LiveControlMembers] suspend failed", { reason: modifyErr, userId, action });
    return json({ ok: false, error: modifyErr } satisfies ApiErr, { status: 403 });
  }

  const allBefore = await readSuspensions();
  const hadSuspension = allBefore.some(
    (row) => row.churchId === churchId && row.roomId === roomId && row.userId === userId
  );

  await updateJsonFile<LiveControlMemberRow[]>(
    STORE_FILE,
    (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      return list.filter((row) => !(row.churchId === churchId && row.roomId === roomId && row.userId === userId));
    },
    []
  );

  console.log("[LiveControlMembers] suspend success", {
    unsuspended: true,
    userId,
    roomId,
    hadSuspension,
  });
  return json({ ok: true, unsuspended: true, userId, roomId });
}
