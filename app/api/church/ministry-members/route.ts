import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import { updateLiveJsonFile } from "@/app/api/_lib/store/liveDb";
import {
  readMinistryJsonFile,
  updateMinistryJsonFile,
} from "@/app/api/_lib/store/ministryDb";
import { logAudit } from "@/app/api/_lib/audit";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { getMembershipsForChurch } from "@/app/api/_lib/memberships";
import { addNotification } from "@/app/api/_lib/notifications";
import {
  assertLeaderCanAssignRole,
  assertLeaderCanModifyTarget,
  getMinistryMemberRole,
  isPastorAppRole,
  listMinistryLeaderUserIds,
} from "@/app/api/_lib/ministryAuthority";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { getUserById } from "@/app/api/auth/_lib/session";

/* =========================
   TYPES
   ========================= */

type MinistryMemberRole = "Leader" | "Assistant" | "Host" | "Member";

type MinistryMember = {
  id: string;
  churchId: string;
  ministryId: string;
  userId: string;
  role: MinistryMemberRole;
  createdAt: string;
  updatedAt?: string;
};

type Ministry = {
  id: string;
  churchId: string;
  name: string;
  description?: string;
  status: "Active" | "Paused";
  createdAt: string;
  updatedAt?: string;
};

type ApiErr = { ok: false; error: string; details?: unknown };
type ApiOk<T> = { ok: true; data: T };

const STORE_FILE = "ministry-members.json";
const MINISTRIES_FILE = "ministries.json";
const MC_HOSTS_FILE = "mc-hosts.json";

type McHostsRow = {
  assignmentId: string;
  churchId: string;
  hostUserIds: string[];
  updatedAt: string;
  updatedBy?: string;
};

/* =========================
   HELPERS
   ========================= */

function json<T>(data: ApiOk<T> | ApiErr, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "mm") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isRole(x: string): x is MinistryMemberRole {
  return x === "Leader" || x === "Assistant" || x === "Host" || x === "Member";
}

function parseRole(input: unknown, fallback: MinistryMemberRole): MinistryMemberRole | null {
  if (input === undefined || input === null) return fallback;
  const s = String(input).trim();
  return isRole(s) ? s : null;
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "ministry_members", limit: 90, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } },
      { status: 429 }
    );
  }
  return null;
}

function asBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  return req.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function readAllMembers(): Promise<MinistryMember[]> {
  const data = await readMinistryJsonFile<MinistryMember[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

async function readAllMinistries(): Promise<Ministry[]> {
  const data = await readMinistryJsonFile<Ministry[]>(MINISTRIES_FILE, []);
  return Array.isArray(data) ? data : [];
}

async function requireMinistryInChurch(ministryId: string, churchId: string): Promise<Ministry | null> {
  const all = await readAllMinistries();
  const m = all.find((x) => x.id === ministryId && x.churchId === churchId);
  return m || null;
}

async function isMinistryLeader(args: { churchId: string; ministryId: string; userId: string }): Promise<boolean> {
  const { churchId, ministryId, userId } = args;
  const all = await readAllMembers();
  return all.some(
    (mm) =>
      mm.churchId === churchId &&
      mm.ministryId === ministryId &&
      mm.userId === userId &&
      (mm.role === "Leader" || mm.role === "Assistant")
  );
}

async function isActiveChurchMember(churchId: string, userId: string): Promise<boolean> {
  const actives = await getMembershipsForChurch(churchId, "Active");
  return actives.some((m) => m.userId === userId);
}

function resolveMinistryMemberRow(args: {
  all: MinistryMember[];
  churchId: string;
  mmid?: string;
  ministryId?: string;
  userId?: string;
}) {
  const mmid = String(args.mmid || "").trim();
  const ministryId = String(args.ministryId || "").trim();
  const userId = String(args.userId || "").trim();

  if (mmid) {
    const byId = args.all.find((mm) => mm.id === mmid && mm.churchId === args.churchId);
    if (byId) return byId;
  }

  if (ministryId && userId) {
    return (
      args.all.find(
        (mm) =>
          mm.churchId === args.churchId &&
          mm.ministryId === ministryId &&
          mm.userId === userId
      ) || null
    );
  }

  if (userId && mmid && mmid.startsWith("u_")) {
    return (
      args.all.find((mm) => mm.churchId === args.churchId && mm.userId === userId) || null
    );
  }

  return null;
}

async function removeUserFromMcHostsForMinistry(args: {
  churchId: string;
  ministryId: string;
  userId: string;
  updatedBy: string;
}) {
  await updateLiveJsonFile<McHostsRow[]>(
    MC_HOSTS_FILE,
    (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      return list.map((row) => {
        if (row.churchId !== args.churchId || row.assignmentId !== args.ministryId) return row;
        const before = Array.isArray(row.hostUserIds) ? row.hostUserIds.map(String) : [];
        const hostUserIds = before.filter((id) => id !== args.userId);
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


async function enrichMember(mm: MinistryMember) {
  const profile: any = (await getProfile(mm.userId)) || null;
  const user: any = await getUserById(mm.userId);

  return {
    ...mm,
    displayName: String(
      profile?.fullName ||
      profile?.displayName ||
      profile?.name ||
      user?.fullName ||
      user?.displayName ||
      user?.name ||
      user?.email ||
      ""
    ).trim(),
    avatarUrl: String(
      profile?.avatarUrl ||
      profile?.avatarUri ||
      profile?.profileImage ||
      user?.avatarUrl ||
      user?.avatarUri ||
      user?.profileImage ||
      ""
    ).trim(),
  };
}

/* =========================
   GET /api/church/ministry-members?ministryId=...
   ========================= */
export async function GET(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin", "Member"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const url = new URL(req.url);
  const allMode = url.searchParams.get("all") === "1" || url.searchParams.get("all") === "true";
  const ministryId = String(url.searchParams.get("ministryId") || "").trim();

  if (allMode) {
    // Admin-only list (for overview counts & admin tools)
    const adminOrRes = await guard(req, ["Pastor", "Church_Admin", "System_Admin"]);
    if (adminOrRes instanceof NextResponse) return adminOrRes;

    const all = await readAllMembers();
    const data = await Promise.all(all.filter((mm) => mm.churchId === adminOrRes.churchId).map(enrichMember));

    return json<MinistryMember[]>({ ok: true, data });
  }

  if (!ministryId) return json({ ok: false, error: "Missing ministryId" } satisfies ApiErr, { status: 400 });

  const ministry = await requireMinistryInChurch(ministryId, churchId);
  if (!ministry) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  if (viewer.role === "Leader") {
    const ok = await isMinistryLeader({ churchId, ministryId, userId: viewer.userId });
    if (!ok) return json({ ok: false, error: "Forbidden (role)" } satisfies ApiErr, { status: 403 });
  }

  const all = await readAllMembers();

  if (viewer.role === "Member") {
    const ok = all.some(
      (mm) =>
        mm.churchId === churchId &&
        mm.ministryId === ministryId &&
        mm.userId === viewer.userId
    );

    if (!ok) {
      return json({ ok: false, error: "Forbidden (ministry membership)" } satisfies ApiErr, { status: 403 });
    }
  }

  const data = await Promise.all(all.filter((mm) => mm.churchId === churchId && mm.ministryId === ministryId).map(enrichMember));

  return json<MinistryMember[]>({ ok: true, data });
}

export async function POST(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  const ministryId = String(body.ministryId ?? "").trim();
  const userId = String(body.userId ?? "").trim();
  if (!ministryId) return json({ ok: false, error: "ministryId is required" } satisfies ApiErr, { status: 400 });
  if (!userId) return json({ ok: false, error: "userId is required" } satisfies ApiErr, { status: 400 });

  if (!(await isActiveChurchMember(churchId, userId))) {
    return json({ ok: false, error: "User is not an active member of this church" } satisfies ApiErr, { status: 403 });
  }

  const ministry = await requireMinistryInChurch(ministryId, churchId);
  if (!ministry) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  const viewerMinistryRole = await getMinistryMemberRole(churchId, ministryId, viewer.userId);
  if (viewerMinistryRole === "Host") {
    return json({ ok: false, error: "Hosts cannot manage ministry members" } satisfies ApiErr, { status: 403 });
  }

  if (viewer.role === "Leader") {
    const ok = await isMinistryLeader({ churchId, ministryId, userId: viewer.userId });
    if (!ok) return json({ ok: false, error: "Forbidden (role)" } satisfies ApiErr, { status: 403 });
  }

  const roleInput = (body as any).role ?? (body as any).position;
  const role = parseRole(roleInput, "Member");
  if (!role) return json({ ok: false, error: "Invalid role" } satisfies ApiErr, { status: 400 });

  if (!isPastorAppRole(viewer.role)) {
    const leaderErr = assertLeaderCanAssignRole({
      viewerAppRole: viewer.role,
      viewerMinistryRole,
      nextRole: role,
    });
    if (leaderErr) return json({ ok: false, error: leaderErr } satisfies ApiErr, { status: 403 });
  }

  const before = await readAllMembers();

  if (role === "Leader") {
    if (!isPastorAppRole(viewer.role)) {
      return json({ ok: false, error: "Only Pastor can promote to Leader" } satisfies ApiErr, { status: 403 });
    }
    try {
      await updateMinistryJsonFile<MinistryMember[]>(
        STORE_FILE,
        (current) => {
          const list = Array.isArray(current) ? current : [];
          return list.map((mm) => {
            if (mm.churchId === churchId && mm.ministryId === ministryId && mm.role === "Leader") {
              return { ...mm, role: "Member", updatedAt: nowIso() };
            }
            return mm;
          });
        },
        []
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to swap leader";
      return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
    }
  }
  if (role === "Assistant") {
    const hasAssistant = before.some((mm) => mm.churchId === churchId && mm.ministryId === ministryId && mm.role === "Assistant");
    if (hasAssistant) return json({ ok: false, error: "This ministry already has an Assistant (Chini)." } satisfies ApiErr, { status: 409 });
  }

  const created: MinistryMember = {
    id: id(),
    churchId,
    ministryId,
    userId,
    role,
    createdAt: nowIso(),
  };

  let conflict = false;

  try {
    await updateMinistryJsonFile<MinistryMember[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const exists = list.some((mm) => mm.churchId === churchId && mm.ministryId === ministryId && mm.userId === userId);
        if (exists) {
          conflict = true;
          return list;
        }
        list.unshift(created);
        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Write failed";
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  if (conflict) return json({ ok: false, error: "Member already exists in this ministry" } satisfies ApiErr, { status: 409 });
  await logAudit({
    req,
    viewer,
    churchId,
    action: "MINISTRY_MEMBER_ADD",
    targetType: "ministry_member",
    targetId: created.id,
    message: `${viewer.name || viewer.userId} added user ${userId} to ministry ${ministry.name} as ${role}.`,
    meta: { ministryId, ministryName: ministry.name, userId, role },
  } as any);

  await addNotification({
    churchId,
    type: "MinistryMemberAdded",
    title: "Ministry member added",
    message: `User ${userId} was added to ministry ${ministry.name} as ${role}.`,
    targetUserId: userId,
    ministryId,
  });

  return json<MinistryMember>({ ok: true, data: created }, { status: 201 });
}

/* =========================
   PATCH /api/church/ministry-members?id=...
   body: { role }
   ========================= */
export async function PATCH(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const url = new URL(req.url);
  const mmid = String(url.searchParams.get("id") || "").trim();
  if (!mmid) return json({ ok: false, error: "Missing id" } satisfies ApiErr, { status: 400 });

  const body = await asBody(req);
  if (!body) return json({ ok: false, error: "Invalid JSON body" } satisfies ApiErr, { status: 400 });

  const nextRole = parseRole(body.role, "Member");
  if (!nextRole) return json({ ok: false, error: "Invalid role" } satisfies ApiErr, { status: 400 });

  const allBefore = await readAllMembers();
  const existing = allBefore.find((mm) => mm.id === mmid && mm.churchId === churchId);
  if (!existing) return json({ ok: false, error: "Ministry member not found" } satisfies ApiErr, { status: 404 });

  if (!(await isActiveChurchMember(churchId, existing.userId))) {
    return json({ ok: false, error: "User is not an active member of this church" } satisfies ApiErr, { status: 403 });
  }

  const ministry = await requireMinistryInChurch(existing.ministryId, churchId);
  if (!ministry) return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });

  const viewerMinistryRole = await getMinistryMemberRole(churchId, existing.ministryId, viewer.userId);
  if (viewerMinistryRole === "Host") {
    return json({ ok: false, error: "Hosts cannot manage ministry members" } satisfies ApiErr, { status: 403 });
  }

  if (viewer.role === "Leader") {
    const ok = await isMinistryLeader({ churchId, ministryId: existing.ministryId, userId: viewer.userId });
    if (!ok) return json({ ok: false, error: "Forbidden (role)" } satisfies ApiErr, { status: 403 });
  }

  if (!isPastorAppRole(viewer.role)) {
    const modifyErr = assertLeaderCanModifyTarget({
      viewerAppRole: viewer.role,
      viewerMinistryRole,
      targetRole: existing.role,
      targetUserId: existing.userId,
      viewerUserId: viewer.userId,
    });
    if (modifyErr) return json({ ok: false, error: modifyErr } satisfies ApiErr, { status: 403 });

    const assignErr = assertLeaderCanAssignRole({
      viewerAppRole: viewer.role,
      viewerMinistryRole,
      nextRole,
    });
    if (assignErr) return json({ ok: false, error: assignErr } satisfies ApiErr, { status: 403 });
  }

  if (existing.role === "Leader" && nextRole !== "Leader") {
    const leaders = allBefore.filter(
      (mm) => mm.churchId === churchId && mm.ministryId === existing.ministryId && mm.role === "Leader"
    );
    if (leaders.length <= 1) {
      return json({ ok: false, error: "Cannot demote the last Leader (Senior) of this ministry." } satisfies ApiErr, { status: 409 });
    }
  }

  if (nextRole === "Leader") {
    if (!isPastorAppRole(viewer.role)) {
      return json({ ok: false, error: "Only Pastor can promote to Leader" } satisfies ApiErr, { status: 403 });
    }

    const hasOtherLeader = allBefore.some(
      (mm) =>
        mm.churchId === churchId &&
        mm.ministryId === existing.ministryId &&
        mm.role === "Leader" &&
        mm.id !== existing.id
    );

    if (hasOtherLeader) {
      try {
        await updateMinistryJsonFile<MinistryMember[]>(
          STORE_FILE,
          (current) => {
            const list = Array.isArray(current) ? current : [];
            return list.map((mm) => {
              if (
                mm.churchId === churchId &&
                mm.ministryId === existing.ministryId &&
                mm.role === "Leader" &&
                mm.id !== existing.id
              ) {
                return { ...mm, role: "Member", updatedAt: nowIso() };
              }
              return mm;
            });
          },
          []
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to swap leader";
        return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
      }
    }
  }
  if (nextRole === "Assistant") {
    const hasOtherAssistant = allBefore.some(
      (mm) => mm.churchId === churchId && mm.ministryId === existing.ministryId && mm.role === "Assistant" && mm.id !== existing.id
    );
    if (hasOtherAssistant) return json({ ok: false, error: "This ministry already has an Assistant (Chini)." } satisfies ApiErr, { status: 409 });
  }

  let updated: MinistryMember | null = null;

  try {
    await updateMinistryJsonFile<MinistryMember[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        const idx = list.findIndex((mm) => mm.id === mmid && mm.churchId === churchId);
        if (idx < 0) return list;

        const cur = list[idx];
        updated = { ...cur, role: nextRole, updatedAt: nowIso() };
        list[idx] = updated!;
        return list;
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  if (!updated) return json({ ok: false, error: "Ministry member not found" } satisfies ApiErr, { status: 404 });
  await logAudit({
    req,
    viewer,
    churchId,
action: "MINISTRY_MEMBER_ROLE_CHANGE",
    targetType: "ministry_member",
    targetId: (updated as any as MinistryMember).id,
    message: `${viewer.name || viewer.userId} changed role of ${(updated as any as MinistryMember).userId} in ministry ${ministry.name} to ${(updated as any as MinistryMember).role}.`,
    meta: { ministryId: (updated as any as MinistryMember).ministryId, ministryName: ministry.name, userId: (updated as any as MinistryMember).userId, role: (updated as any as MinistryMember).role },
  } as any);

  await addNotification({
    churchId,
    type: "MinistryMemberRoleChanged",
    title: "Ministry role updated",
    message: `User ${(updated as any as MinistryMember).userId} role in ministry ${ministry.name} is now ${(updated as any as MinistryMember).role}.`,
    targetUserId: (updated as any as MinistryMember).userId,
    ministryId: (updated as any as MinistryMember).ministryId,
  });

  return json<MinistryMember>({ ok: true, data: updated });
}

/* =========================
   DELETE /api/church/ministry-members?id=...
   ========================= */
export async function DELETE(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Leader", "System_Admin"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { churchId, viewer } = ctxOrRes;

  const url = new URL(req.url);
  const mmid = String(url.searchParams.get("id") || "").trim();
  const ministryIdParam = String(url.searchParams.get("ministryId") || "").trim();
  const userIdParam = String(url.searchParams.get("userId") || "").trim();

  console.log("[MinistryMembers] remove request", {
    churchId,
    viewerUserId: viewer.userId,
    viewerRole: viewer.role,
    mmid,
    ministryId: ministryIdParam,
    userId: userIdParam,
  });

  if (!mmid && !(ministryIdParam && userIdParam)) {
    console.log("[MinistryMembers] remove failed", { reason: "missing-id-or-ministry-user" });
    return json({ ok: false, error: "Missing id or ministryId+userId" } satisfies ApiErr, { status: 400 });
  }

  const resolvedMinistryIdForDelete = String(
    ministryIdParam ||
      (mmid
        ? (await readAllMembers()).find((mm) => mm.id === mmid && mm.churchId === churchId)?.ministryId
        : "") ||
      ""
  ).trim();

  if (
    resolvedMinistryIdForDelete === "church-media-room" ||
    ministryIdParam === "church-media-room"
  ) {
    console.log("[MinistryMembers] remove failed", {
      reason: "church-live-control-use-suspend",
      ministryId: resolvedMinistryIdForDelete || ministryIdParam,
    });
    return json(
      {
        ok: false,
        error: "Church Live Control members cannot be removed. Use suspend instead.",
      } satisfies ApiErr,
      { status: 409 }
    );
  }

  const allBefore = await readAllMembers();
  const existing = resolveMinistryMemberRow({
    all: allBefore,
    churchId,
    mmid,
    ministryId: ministryIdParam,
    userId: userIdParam,
  });

  if (!existing) {
    console.log("[MinistryMembers] remove failed", { reason: "not-found", mmid, ministryIdParam, userIdParam });
    return json({ ok: false, error: "Ministry member not found" } satisfies ApiErr, { status: 404 });
  }

  const ministry = await requireMinistryInChurch(existing.ministryId, churchId);
  if (!ministry) {
    console.log("[MinistryMembers] remove failed", { reason: "ministry-not-found", ministryId: existing.ministryId });
    return json({ ok: false, error: "Ministry not found" } satisfies ApiErr, { status: 404 });
  }

  const viewerMinistryRole = await getMinistryMemberRole(churchId, existing.ministryId, viewer.userId);

  if (!isPastorAppRole(viewer.role)) {
    if (viewerMinistryRole === "Host") {
      console.log("[MinistryMembers] remove failed", { reason: "host-cannot-manage-members" });
      return json({ ok: false, error: "Hosts cannot manage ministry members" } satisfies ApiErr, { status: 403 });
    }

    if (viewer.role === "Leader") {
      const ok = await isMinistryLeader({ churchId, ministryId: existing.ministryId, userId: viewer.userId });
      if (!ok) {
        console.log("[MinistryMembers] remove failed", { reason: "leader-not-in-ministry" });
        return json({ ok: false, error: "Forbidden (role)" } satisfies ApiErr, { status: 403 });
      }

      const modifyErr = assertLeaderCanModifyTarget({
        viewerAppRole: viewer.role,
        viewerMinistryRole,
        targetRole: existing.role,
        targetUserId: existing.userId,
        viewerUserId: viewer.userId,
      });
      if (modifyErr) {
        console.log("[MinistryMembers] remove failed", { reason: modifyErr });
        return json({ ok: false, error: modifyErr } satisfies ApiErr, { status: 403 });
      }
    }
  }

  if (existing.role === "Leader") {
    const leaders = allBefore.filter(
      (mm) => mm.churchId === churchId && mm.ministryId === existing.ministryId && mm.role === "Leader"
    );
    if (leaders.length <= 1) {
      console.log("[MinistryMembers] remove failed", { reason: "last-leader" });
      return json({ ok: false, error: "Cannot remove the last Leader (Senior) of this ministry." } satisfies ApiErr, { status: 409 });
    }
  }

  try {
    await updateMinistryJsonFile<MinistryMember[]>(
      STORE_FILE,
      (current) => {
        const list = Array.isArray(current) ? current : [];
        return list.filter((mm) => mm.id !== existing.id);
      },
      []
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Delete failed";
    console.log("[MinistryMembers] remove failed", { reason: msg });
    return json({ ok: false, error: msg } satisfies ApiErr, { status: 500 });
  }

  try {
    await removeUserFromMcHostsForMinistry({
      churchId,
      ministryId: existing.ministryId,
      userId: existing.userId,
      updatedBy: viewer.userId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "mc-host cleanup failed";
    console.log("[MinistryMembers] remove mc-host cleanup warning", { userId: existing.userId, error: msg });
  }

  await logAudit({
    req,
    viewer,
    churchId,
    action: "MINISTRY_MEMBER_REMOVE",
    targetType: "ministry_member",
    targetId: existing.id,
    message: `${viewer.name || viewer.userId} removed user ${existing.userId} from ministry ${ministry.name}.`,
    meta: { ministryId: existing.ministryId, ministryName: ministry.name, userId: existing.userId, role: existing.role },
  } as any);

  await addNotification({
    churchId,
    type: "MinistryMemberRemoved",
    title: "Ministry member removed",
    message: `User ${existing.userId} was removed from ministry ${ministry.name}.`,
    targetUserId: existing.userId,
    ministryId: existing.ministryId,
  });

  console.log("[MinistryMembers] remove success", {
    removed: true,
    userId: existing.userId,
    ministryId: existing.ministryId,
    ministryMemberId: existing.id,
  });

  return json({
    ok: true,
    data: {
      removed: true,
      userId: existing.userId,
      ministryId: existing.ministryId,
      ministryMemberId: existing.id,
    },
  });
}
