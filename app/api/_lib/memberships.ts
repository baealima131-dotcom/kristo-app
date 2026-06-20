/**
 * Membership store.
 * Production (DATABASE_URL): Postgres via churchDb.
 * Local dev fallback: data/memberships.json
 */

import {
  readCoreJsonFile as readJsonFile,
  updateCoreJsonFile as updateJsonFile,
} from "@/app/api/_lib/store/coreDb";
import { updateMinistryJsonFile } from "@/app/api/_lib/store/ministryDb";
import { hasDurableStore } from "@/app/api/_lib/store/authDb";
import {
  dbAddActiveMember,
  dbApproveMembership,
  dbDeactivateMemberInChurch,
  dbDevPromoteToRoleIfActive,
  dbGetMembershipById,
  dbGetMembershipsForChurch,
  dbGetMembershipsForUser,
  dbGetChurchInvitesForViewer,
  dbLeaveActiveMembership,
  dbRejectMembership,
  dbRequestMembership,
  dbSaveMembership,
  dbSetMemberRole,
  dbCleanupStaleDemoActiveMemberships,
  ensureChurchStoreReady,
  resolveChurchStoreMode,
} from "@/app/api/_lib/store/churchDb";
import { countsAsRealActiveMembership, isBlockedDemoChurchId, STALE_DEMO_MEMBERSHIP_NOTE } from "@/app/api/_lib/demoMemberships";

export type MembershipStatus = "Requested" | "Active" | "Rejected" | "Banned" | "Left";
export type ChurchRole = "Member" | "Leader" | "Ministry_Leader" | "Church_Admin" | "Pastor" | "System_Admin";

export type ChurchMembership = {
  id: string;
  userId: string;
  churchId: string;

  // ✅ membership state
  status: MembershipStatus;

  // ✅ church role (inside church)
  churchRole: ChurchRole;

  // optional display info
  name?: string;

  createdAt: string;
  updatedAt?: string;

  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  requestSource?: "JoinRequest" | "ChurchInvite";
};

const STORE_FILE = "memberships.json";

export function normalizeMembershipChurchId(value: unknown): string {
  const id = String(value || "").trim();
  if (!id) return "";
  if (/^CH7-/i.test(id)) return id.toUpperCase();
  return id;
}

export function isJoinRequestMembershipStatus(status: unknown): boolean {
  const token = String(status || "").trim().toLowerCase();
  return token === "requested" || token === "pending" || token === "request";
}

export function isJoinRequestMembership(row: {
  status?: unknown;
  requestSource?: unknown;
}): boolean {
  if (!isJoinRequestMembershipStatus(row?.status)) return false;
  const source = String(row?.requestSource || "JoinRequest").trim();
  return source !== "ChurchInvite";
}

export function isPendingChurchInviteStatus(status: unknown): boolean {
  const token = String(status || "").trim().toLowerCase();
  return (
    token === "requested" ||
    token === "pending" ||
    token === "request" ||
    token === "invited" ||
    token === "invite"
  );
}

export function isChurchInviteMembership(row: {
  status?: unknown;
  requestSource?: unknown;
}): boolean {
  if (!isPendingChurchInviteStatus(row?.status)) return false;
  return String(row?.requestSource || "").trim() === "ChurchInvite";
}

const TARGET_KRISTO_NOTE_PREFIX = "targetKristoId:";

export function parseTargetKristoIdFromMembership(m: {
  note?: unknown;
  targetKristoId?: unknown;
}): string {
  const direct = String(m?.targetKristoId || "").trim().toUpperCase();
  if (/^KR7-[A-Z0-9]{6,10}$/.test(direct)) return direct;
  const note = String(m?.note || "");
  const match = note.match(/targetKristoId:([A-Z0-9-]+)/i);
  return match?.[1] ? String(match[1]).trim().toUpperCase() : "";
}

export function withTargetKristoIdNote(
  membership: ChurchMembership,
  targetKristoId: string
): ChurchMembership {
  const code = String(targetKristoId || "").trim().toUpperCase();
  if (!code) return membership;
  const note = String(membership.note || "");
  if (note.includes(`${TARGET_KRISTO_NOTE_PREFIX}${code}`)) {
    return { ...membership, targetKristoId: code } as ChurchMembership;
  }
  const nextNote = note
    ? `${note};${TARGET_KRISTO_NOTE_PREFIX}${code}`
    : `${TARGET_KRISTO_NOTE_PREFIX}${code}`;
  return { ...membership, note: nextNote, targetKristoId: code } as ChurchMembership;
}

export function membershipBelongsToViewer(
  membership: ChurchMembership,
  viewerUserId: string,
  viewerKristoId?: string
): boolean {
  if (normUserId(membership.userId) === normUserId(viewerUserId)) return true;
  const targetKristoId = parseTargetKristoIdFromMembership(membership);
  const viewerCode = String(viewerKristoId || "").trim().toUpperCase();
  return Boolean(viewerCode && targetKristoId && targetKristoId === viewerCode);
}

export async function saveMembership(membership: ChurchMembership): Promise<ChurchMembership> {
  const next = { ...membership, updatedAt: nowIso() };
  if (usePostgres()) {
    await ensureStore();
    return dbSaveMembership(next);
  }

  let saved = next;
  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const idx = s.findIndex((row) => row.id === next.id);
      if (idx < 0) return s;
      s[idx] = next;
      saved = next;
      return s;
    },
    []
  );
  return saved;
}

export async function getChurchInvitesForViewer(
  viewerUserId: string,
  viewerKristoId?: string
): Promise<ChurchMembership[]> {
  const viewerCode = String(viewerKristoId || "").trim().toUpperCase();

  if (usePostgres()) {
    await ensureStore();
    const rows = await dbGetChurchInvitesForViewer(viewerUserId, viewerCode);
    return sortNewestFirst(
      rows.filter((m) => membershipBelongsToViewer(m, viewerUserId, viewerCode))
    );
  }

  const rows = await readAll();
  return sortNewestFirst(
    rows.filter((m) => {
      if (!isChurchInviteMembership(m)) return false;
      return membershipBelongsToViewer(m, viewerUserId, viewerCode);
    })
  );
}

export function resolveMembershipStoreMode() {
  return resolveChurchStoreMode();
}

function usePostgres() {
  return hasDurableStore();
}

async function ensureStore() {
  if (usePostgres()) await ensureChurchStoreReady();
}

/* =========================
   HELPERS
   ========================= */

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "mem") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function normalizeMembershipRows(rows: ChurchMembership[]) {
  const seenActive = new Set<string>();

  return rows.map((m: any) => {
    const userId = String(m?.userId || "").trim();
    const churchId = String(m?.churchId || "").trim();

    const next = {
      ...m,
      userId: userId.startsWith("U_") ? userId.toLowerCase() : userId,
      churchId,
      status: m?.status || "Requested",
      churchRole: m?.churchRole || "Member",
    };

    const activeKey = `${String(next.userId).toLowerCase()}::active`;
    if (next.status === "Active") {
      if (seenActive.has(activeKey)) {
        next.status = "Left";
        next.updatedAt = new Date().toISOString();
        next.note = "auto-clean duplicate active membership";
      } else {
        seenActive.add(activeKey);
      }
    }

    return next;
  });
}

async function readAll(): Promise<ChurchMembership[]> {
  const data = await readJsonFile<ChurchMembership[]>(STORE_FILE, []);
  return normalizeMembershipRows(Array.isArray(data) ? data : []);
}

function normUserId(x: any) {
  return String(x || "").trim().toLowerCase();
}

function sortNewestFirst(list: ChurchMembership[]) {
  return list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function findRealActiveMembershipInRows(rows: ChurchMembership[], userId: string): ChurchMembership | undefined {
  return rows.find(
    (m) =>
      normUserId(m.userId) === normUserId(userId) &&
      m.status === "Active" &&
      countsAsRealActiveMembership(m.churchId)
  );
}

/** Auto-leave stale demo Active memberships so they never block real church flows. */
export async function cleanupStaleDemoActiveMemberships(userId: string): Promise<ChurchMembership[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];

  if (usePostgres()) {
    await ensureStore();
    return dbCleanupStaleDemoActiveMemberships(uid);
  }

  const cleaned: ChurchMembership[] = [];
  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      for (const m of s) {
        if (
          normUserId(m.userId) !== normUserId(uid) ||
          m.status !== "Active" ||
          !isBlockedDemoChurchId(m.churchId)
        ) {
          continue;
        }
        m.status = "Left";
        m.updatedAt = nowIso();
        m.note = STALE_DEMO_MEMBERSHIP_NOTE;
        cleaned.push({ ...m });
      }
      return s;
    },
    []
  );
  return cleaned;
}

export function logInviteMembershipCheck(input: {
  userId: string;
  churchId: string;
  membershipChurchId?: string;
  membershipStatus?: string;
  ignoredAsDemo?: boolean;
}) {
  console.log("[KRISTO INVITE CHECK]", {
    userId: String(input.userId || ""),
    churchId: String(input.churchId || ""),
    membershipChurchId: String(input.membershipChurchId || ""),
    membershipStatus: String(input.membershipStatus || "none"),
    ignoredAsDemo: Boolean(input.ignoredAsDemo),
  });
}

/* =========================
   READERS
   ========================= */

export async function getActiveMembership(userId: string): Promise<ChurchMembership | undefined> {
  const uid = String(userId || "").trim();
  if (!uid) return undefined;

  await cleanupStaleDemoActiveMemberships(uid);

  let candidates: ChurchMembership[] = [];
  if (usePostgres()) {
    await ensureStore();
    const all = await dbGetMembershipsForUser(uid);
    candidates = all.filter((m) => m.status === "Active");
  } else {
    const all = await readAll();
    candidates = all.filter((m) => normUserId(m.userId) === normUserId(uid) && m.status === "Active");
  }

  const real = candidates.find((m) => countsAsRealActiveMembership(m.churchId));
  return real || undefined;
}

export async function getMembershipsForUser(userId: string): Promise<ChurchMembership[]> {
  if (usePostgres()) {
    await ensureStore();
    return dbGetMembershipsForUser(userId);
  }
  const all = await readAll();
  return sortNewestFirst(all.filter((m) => normUserId(m.userId) === normUserId(userId)));
}

export async function getMembershipsForChurch(
  churchId: string,
  status?: MembershipStatus
): Promise<ChurchMembership[]> {
  const cid = normalizeMembershipChurchId(churchId);
  if (!cid) return [];

  if (usePostgres()) {
    await ensureStore();
    const rows = await dbGetMembershipsForChurch(cid);
    return sortNewestFirst(
      rows.filter((m) => {
        if (!status) return true;
        if (status === "Requested") return isJoinRequestMembership(m);
        return String(m.status || "") === status;
      })
    );
  }
  const all = await readAll();
  return sortNewestFirst(
    all.filter((m) => {
      if (normalizeMembershipChurchId(m.churchId) !== cid) return false;
      if (!status) return true;
      if (status === "Requested") return isJoinRequestMembership(m);
      return m.status === status;
    })
  );
}


export async function getMembershipById(id: string): Promise<ChurchMembership | undefined> {
  if (usePostgres()) {
    await ensureStore();
    const row = await dbGetMembershipById(id);
    return row || undefined;
  }
  const all = await readAll();
  return all.find((m) => m.id === id);
}

export async function isApproverForChurch(userId: string, churchId: string): Promise<boolean> {
  const cid = normalizeMembershipChurchId(churchId);
  if (!cid) return false;
  const active = await getMembershipsForChurch(cid, "Active");
  const mine = active.find((m) => normUserId(m.userId) === normUserId(userId));
  if (!mine) return false;
  return mine.churchRole === "Pastor" || mine.churchRole === "Church_Admin";
}


/* =========================
   WRITES
   ========================= */

/**
 * Request to join a church.
 * - Block if user already has Active membership in ANY church.
 * - Block if user already has Requested membership to a different church.
 */
export async function requestMembership(
  userId: string,
  churchId: string,
  name?: string,
  requestSource: "JoinRequest" | "ChurchInvite" = "JoinRequest"
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  await cleanupStaleDemoActiveMemberships(userId);

  const targetChurchId = normalizeMembershipChurchId(churchId);
  if (!targetChurchId) return { ok: false, error: "churchId missing" };

  if (usePostgres()) {
    await ensureStore();
    return dbRequestMembership(userId, targetChurchId, name, requestSource);
  }
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];

      const active = findRealActiveMembershipInRows(s, userId);
      if (active) {
        result = { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
        return s;
      }

      const pending = s.find((m) => normUserId(m.userId) === normUserId(userId) && isJoinRequestMembershipStatus(m.status));
      if (pending && normalizeMembershipChurchId(pending.churchId) !== targetChurchId) {
        result = { ok: false, error: `User already has a pending request in churchId=${pending.churchId}` };
        return s;
      }

      if (pending && normalizeMembershipChurchId(pending.churchId) === targetChurchId) {
        pending.requestSource = pending.requestSource || requestSource;
        result = { ok: true, membership: pending };
        return s;
      }

      const m: ChurchMembership = {
        id: id(),
        userId,
        churchId: targetChurchId,
        status: "Requested",
        churchRole: "Member",
        name: name?.trim() ? name.trim() : undefined,
        requestSource,
        createdAt: nowIso(),
      };

      s.push(m);
      result = { ok: true, membership: m };
      return s;
    },
    []
  );

  return result;
}

export async function leaveActiveMembership(
  userId: string
): Promise<{ ok: true; membership?: ChurchMembership } | { ok: false; error: string }> {
  if (usePostgres()) {
    await ensureStore();
    return dbLeaveActiveMembership(userId);
  }
  let result: { ok: true; membership?: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const active = s.find((m) => normUserId(m.userId) === normUserId(userId) && m.status === "Active");
      if (!active) {
        result = { ok: false, error: "No Active membership to leave" };
        return s;
      }

      active.status = "Left";
      active.updatedAt = nowIso();
      result = { ok: true, membership: active };
      return s;
    },
    []
  );

  if (!result.ok) return result;

  const activeMembership = (result as { ok: true; membership?: ChurchMembership }).membership;
  if (activeMembership?.churchId) {
    const leftChurchId = String(activeMembership.churchId || "");
    await updateMinistryJsonFile<any[]>(
      "ministry-members.json",
      (current) => {
        const list = Array.isArray(current) ? current : [];
        return list.filter((mm: any) => {
          return !(
            String(mm?.userId || "").toLowerCase() === String(userId || "").toLowerCase() &&
            String(mm?.churchId || "") === leftChurchId
          );
        });
      },
      []
    );
  }

  return result;
}

export async function approveMembership(
  membershipId: string,
  decidedBy: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  if (usePostgres()) {
    await ensureStore();
    return dbApproveMembership(membershipId, decidedBy);
  }

  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const m = s.find((x) => x.id === membershipId);
      if (!m) {
        result = { ok: false, error: "Membership not found" };
        return s;
      }

      if (!isJoinRequestMembershipStatus(m.status)) {
        result = { ok: false, error: `Cannot approve membership in status=${m.status}` };
        return s;
      }

      for (const row of s) {
        if (
          normUserId(row.userId) !== normUserId(m.userId) ||
          row.status !== "Active" ||
          !isBlockedDemoChurchId(row.churchId)
        ) {
          continue;
        }
        row.status = "Left";
        row.updatedAt = nowIso();
        row.note = STALE_DEMO_MEMBERSHIP_NOTE;
      }

      // single Active enforcement (real churches only)
      const active = findRealActiveMembershipInRows(s, m.userId);
      if (active) {
        result = { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
        return s;
      }

      m.status = "Active";
      m.updatedAt = nowIso();
      m.decidedBy = decidedBy;
      m.decidedAt = nowIso();
      if (!m.churchRole) m.churchRole = "Member";

      result = { ok: true, membership: m };
      return s;
    },
    []
  );

  return result;
}

export async function rejectMembership(
  membershipId: string,
  decidedBy: string,
  note?: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  if (usePostgres()) {
    await ensureStore();
    return dbRejectMembership(membershipId, decidedBy, note);
  }
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const m = s.find((x) => x.id === membershipId);
      if (!m) {
        result = { ok: false, error: "Membership not found" };
        return s;
      }

      if (!isJoinRequestMembershipStatus(m.status)) {
        result = { ok: false, error: `Cannot reject membership in status=${m.status}` };
        return s;
      }

      m.status = "Rejected";
      m.updatedAt = nowIso();
      m.decidedBy = decidedBy;
      m.decidedAt = nowIso();
      m.note = note;

      result = { ok: true, membership: m };
      return s;
    },
    []
  );

  return result;
}

export async function cancelPendingJoinRequest(
  userId: string,
  opts?: { membershipId?: string; churchId?: string }
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  let target: ChurchMembership | undefined;

  if (opts?.membershipId) {
    const row = await getMembershipById(opts.membershipId);
    if (!row || normUserId(row.userId) !== normUserId(userId)) {
      return { ok: false, error: "Join request not found" };
    }
    if (!isJoinRequestMembership(row)) {
      return { ok: false, error: "No pending join request to cancel" };
    }
    target = row;
  } else {
    const rows = await getMembershipsForUser(userId);
    const pending = rows.find((m) => isJoinRequestMembership(m));
    if (!pending) return { ok: false, error: "No pending join request to cancel" };
    const targetChurchId = normalizeMembershipChurchId(opts?.churchId);
    if (targetChurchId && normalizeMembershipChurchId(pending.churchId) !== targetChurchId) {
      return { ok: false, error: "No pending join request for this church" };
    }
    target = pending;
  }

  return rejectMembership(target.id, userId, "Cancelled by requester");
}

/**
 * Direct add (Admin/Pastor):
 * - creates Active membership immediately
 * NOTE: You may choose to remove this later for stricter governance.
 */
export async function addActiveMember(
  churchId: string,
  userId: string,
  name?: string,
  role: ChurchRole = "Member"
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  await cleanupStaleDemoActiveMemberships(userId);

  if (usePostgres()) {
    await ensureStore();
    const result = await dbAddActiveMember(churchId, userId, name, role);
    if (process.env.KRISTO_DEBUG_AUTH === "1" || process.env.NODE_ENV !== "production") {
      console.log("[memberships] addActiveMember postgres", {
        churchId,
        userId,
        role,
        ok: result.ok,
        error: result.ok ? undefined : result.error,
        membershipId: result.ok ? result.membership.id : null,
      });
    }
    return result;
  }
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];

      const active = findRealActiveMembershipInRows(s, userId);
      if (active) {
        result = { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
        return s;
      }

      const pendingSameChurch = s.find((m) => normUserId(m.userId) === normUserId(userId) && m.churchId === churchId && m.status === "Requested");
      if (pendingSameChurch) {
        pendingSameChurch.status = "Active";
        pendingSameChurch.churchRole = role;
        pendingSameChurch.name = name?.trim() ? name.trim() : pendingSameChurch.name;
        pendingSameChurch.updatedAt = nowIso();
        pendingSameChurch.decidedBy = "system";
        pendingSameChurch.decidedAt = nowIso();
        result = { ok: true, membership: pendingSameChurch };
        return s;
      }

      const m: ChurchMembership = {
        id: id(),
        userId,
        churchId,
        status: "Active",
        churchRole: role,
        name: name?.trim() ? name.trim() : undefined,
        requestSource: "JoinRequest",
        createdAt: nowIso(),
        decidedBy: "system",
        decidedAt: nowIso(),
      };

      s.push(m);
      result = { ok: true, membership: m };
      return s;
    },
    []
  );

  return result;
}


export async function deactivateMemberInChurch(
  churchId: string,
  userId: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  if (usePostgres()) {
    await ensureStore();
    return dbDeactivateMemberInChurch(churchId, userId);
  }
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const m = s.find(
        (x) =>
          normUserId(x.userId) === normUserId(userId) &&
          x.churchId === churchId &&
          x.status === "Active"
      );

      if (!m) {
        result = { ok: false, error: "Active membership not found for this user in this church" };
        return s;
      }

      if (m.churchRole === "Pastor") {
        result = { ok: false, error: "Pastor cannot be removed" };
        return s;
      }

      m.status = "Left";
      m.updatedAt = nowIso();
      m.note = "Removed by church admin";

      result = { ok: true, membership: m };
      return s;
    },
    []
  );

  return result;
}

export async function setMemberRole(
  churchId: string,
  userId: string,
  role: ChurchRole
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  if (usePostgres()) {
    await ensureStore();
    return dbSetMemberRole(churchId, userId, role);
  }
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const m = s.find((x) => x.userId === userId && x.churchId === churchId && x.status === "Active");
      if (!m) {
        result = { ok: false, error: "Active membership not found for this user in this church" };
        return s;
      }

      m.churchRole = role;
      m.updatedAt = nowIso();
      result = { ok: true, membership: m };
      return s;
    },
    []
  );

  return result;
}

/* =========================
   DEV HELPERS
   ========================= */

export function mapHeaderRoleToChurchRole(role: unknown): ChurchRole {
  const r = String(role || "").toLowerCase();
  if (r.includes("pastor")) return "Pastor";
  if (r.includes("admin")) return "Church_Admin";
  if (r.includes("ministry") && r.includes("leader")) return "Ministry_Leader";
  if (r.includes("leader")) return "Leader";
  return "Member";
}

export async function ensureActiveMembershipForSession(input: {
  userId: string;
  churchId?: string;
  role?: string;
  name?: string;
}): Promise<ChurchMembership | undefined> {
  const userId = String(input.userId || "").trim();
  const churchId = String(input.churchId || "").trim();
  if (!userId) return undefined;

  let active = await getActiveMembership(userId);
  if (active?.churchId === churchId) {
    console.log("KRISTO_MEMBERSHIP_RESOLVED", {
      userId,
      headerChurchId: churchId,
      activeChurchId: active.churchId,
      churchRole: active.churchRole,
      synced: false,
      source: "existing-active",
    });
    return active;
  }

  const allowHeaderSync =
    process.env.NODE_ENV !== "production" ||
    String(process.env.KRISTO_HEADER_MEMBERSHIP_SYNC || "").trim() === "1";

  if (!allowHeaderSync || !churchId || isBlockedDemoChurchId(churchId)) return active;

  if (active?.churchId && active.churchId !== churchId) {
    console.log("KRISTO_MEMBERSHIP_RESOLVED", {
      userId,
      headerChurchId: churchId,
      activeChurchId: active.churchId,
      synced: false,
      reason: "active-membership-other-church",
    });
    return active;
  }

  const history = await getMembershipsForUser(userId);
  const removedFromHeaderChurch = history.find(
    (m) =>
      m.churchId === churchId &&
      (m.status === "Left" || m.status === "Banned")
  );
  if (removedFromHeaderChurch) {
    console.log("KRISTO_MEMBERSHIP_RESOLVED", {
      userId,
      headerChurchId: churchId,
      synced: false,
      reason: "removed-membership-block-resync",
      membershipStatus: removedFromHeaderChurch.status,
    });
    return undefined;
  }

  const reqRes = await requestMembership(userId, churchId, input.name, "ChurchInvite");
  if (!reqRes.ok) {
    console.log("KRISTO_MEMBERSHIP_RESOLVED", {
      userId,
      headerChurchId: churchId,
      synced: false,
      reason: "request-failed",
      error: reqRes.error,
    });
    return active;
  }

  const approved = await approveMembership(reqRes.membership.id, userId);
  if (!approved.ok) {
    console.log("KRISTO_MEMBERSHIP_RESOLVED", {
      userId,
      headerChurchId: churchId,
      synced: false,
      reason: "approve-failed",
      error: approved.error,
    });
    return active;
  }

  const preferredRole = mapHeaderRoleToChurchRole(input.role);
  if (preferredRole !== "Member") {
    await devPromoteToRoleIfActive(userId, churchId, preferredRole);
  }

  active = await getActiveMembership(userId);
  console.log("KRISTO_MEMBERSHIP_RESOLVED", {
    userId,
    headerChurchId: churchId,
    activeChurchId: active?.churchId || "",
    churchRole: active?.churchRole || "",
    synced: true,
    source: "header-session-sync",
  });
  return active;
}

export async function devPromoteToRoleIfActive(
  userId: string,
  churchId: string,
  role: ChurchRole
): Promise<void> {
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) return;

  if (usePostgres()) {
    await ensureStore();
    await dbDevPromoteToRoleIfActive(userId, churchId, role);
    return;
  }

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const m = s.find((x) => x.userId === userId && x.churchId === churchId && x.status === "Active");
      if (!m) return s;

      // only promote upward; don’t downgrade if already higher
      const priority: Record<ChurchRole, number> = { Member: 0, Leader: 1, Ministry_Leader: 2, Church_Admin: 3, Pastor: 4, System_Admin: 5 };
      const cur = m.churchRole || "Member";
      if (priority[cur] >= priority[role]) return s;

      m.churchRole = role;
      m.updatedAt = new Date().toISOString();
      return s;
    },
    []
  );
}
