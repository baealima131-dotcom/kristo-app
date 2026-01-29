/**
 * Membership store (JSON file persistence).
 *
 * RULE: Single-church membership
 * - A user can have ONLY ONE Active membership at a time.
 *
 * This eliminates "demo feel" where memberships disappear after server restart.
 */

import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

export type MembershipStatus = "Requested" | "Active" | "Rejected" | "Banned" | "Left";
export type ChurchRole = "Member" | "Leader" | "Church_Admin" | "Pastor";

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
};

const STORE_FILE = "memberships.json";

/* =========================
   HELPERS
   ========================= */

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "mem") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

async function readAll(): Promise<ChurchMembership[]> {
  const data = await readJsonFile<ChurchMembership[]>(STORE_FILE, []);
  return Array.isArray(data) ? data : [];
}

function sortNewestFirst(list: ChurchMembership[]) {
  return list.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/* =========================
   READERS
   ========================= */

export async function getActiveMembership(userId: string): Promise<ChurchMembership | undefined> {
  const all = await readAll();
  return all.find((m) => m.userId === userId && m.status === "Active");
}

export async function getMembershipsForUser(userId: string): Promise<ChurchMembership[]> {
  const all = await readAll();
  return sortNewestFirst(all.filter((m) => m.userId === userId));
}

export async function getMembershipsForChurch(
  churchId: string,
  status?: MembershipStatus
): Promise<ChurchMembership[]> {
  const all = await readAll();
  return sortNewestFirst(all.filter((m) => m.churchId === churchId && (!status || m.status === status)));
}


export async function getMembershipById(id: string): Promise<ChurchMembership | undefined> {
  const all = await readAll();
  return all.find((m) => m.id === id);
}

export async function isApproverForChurch(userId: string, churchId: string): Promise<boolean> {
  const active = await getMembershipsForChurch(churchId, "Active");
  const mine = active.find((m) => m.userId === userId);
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
  name?: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];

      const active = s.find((m) => m.userId === userId && m.status === "Active");
      if (active) {
        result = { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
        return s;
      }

      const pending = s.find((m) => m.userId === userId && m.status === "Requested");
      if (pending && pending.churchId !== churchId) {
        result = { ok: false, error: `User already has a pending request in churchId=${pending.churchId}` };
        return s;
      }

      if (pending && pending.churchId === churchId) {
        result = { ok: true, membership: pending };
        return s;
      }

      const m: ChurchMembership = {
        id: id(),
        userId,
        churchId,
        status: "Requested",
        churchRole: "Member",
        name: name?.trim() ? name.trim() : undefined,
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
  let result: { ok: true; membership?: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const active = s.find((m) => m.userId === userId && m.status === "Active");
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

  return result;
}

export async function approveMembership(
  membershipId: string,
  decidedBy: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
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

      if (m.status !== "Requested") {
        result = { ok: false, error: `Cannot approve membership in status=${m.status}` };
        return s;
      }

      // single Active enforcement
      const active = s.find((x) => x.userId === m.userId && x.status === "Active");
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

      if (m.status !== "Requested") {
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
  let result: { ok: true; membership: ChurchMembership } | { ok: false; error: string } = {
    ok: false,
    error: "Unknown error",
  };

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];

      const active = s.find((m) => m.userId === userId && m.status === "Active");
      if (active) {
        result = { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
        return s;
      }

      const m: ChurchMembership = {
        id: id(),
        userId,
        churchId,
        status: "Active",
        churchRole: role,
        name: name?.trim() ? name.trim() : undefined,
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

export async function setMemberRole(
  churchId: string,
  userId: string,
  role: ChurchRole
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
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

export async function devPromoteToRoleIfActive(
  userId: string,
  churchId: string,
  role: ChurchRole
): Promise<void> {
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) return;

  await updateJsonFile<ChurchMembership[]>(
    STORE_FILE,
    (current) => {
      const s = Array.isArray(current) ? current : [];
      const m = s.find((x) => x.userId === userId && x.churchId === churchId && x.status === "Active");
      if (!m) return s;

      // only promote upward; don’t downgrade if already higher
      const priority: Record<ChurchRole, number> = { Member: 0, Leader: 1, Church_Admin: 2, Pastor: 3 };
      const cur = m.churchRole || "Member";
      if (priority[cur] >= priority[role]) return s;

      m.churchRole = role;
      m.updatedAt = new Date().toISOString();
      return s;
    },
    []
  );
}
