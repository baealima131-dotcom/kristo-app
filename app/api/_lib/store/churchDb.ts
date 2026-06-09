import { neon, neonConfig } from "@neondatabase/serverless";
import { getDatabaseUrl, hasDurableStore, isVercelRuntime } from "@/app/api/_lib/store/authDb";
import {
  countsAsRealActiveMembership,
  isBlockedDemoChurchId,
  STALE_DEMO_MEMBERSHIP_NOTE,
} from "@/app/api/_lib/demoMemberships";

neonConfig.fetchConnectionCache = true;

export type MembershipStatus = "Requested" | "Active" | "Rejected" | "Banned" | "Left";
export type ChurchRole = "Member" | "Leader" | "Ministry_Leader" | "Church_Admin" | "Pastor" | "System_Admin";

export type ChurchMembership = {
  id: string;
  userId: string;
  churchId: string;
  status: MembershipStatus;
  churchRole: ChurchRole;
  name?: string;
  createdAt: string;
  updatedAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  requestSource?: "JoinRequest" | "ChurchInvite";
};

export type ChurchProfile = {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  country?: string;
  province?: string;
  city?: string;
  phoneCountryCode?: string;
  normalizedCountry?: string;
  normalizedProvince?: string;
  normalizedCity?: string;
  primaryLanguage?: string;
  pastorName?: string;
  avatarUri?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type ChurchStoreMode = "postgres" | "local-json" | "missing-db-on-vercel";

type MembershipRow = {
  id: string;
  user_id: string;
  church_id: string;
  status: string;
  church_role: string;
  name: string | null;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
  request_source: string | null;
  created_at: string;
  updated_at: string | null;
};

type ChurchRow = {
  id: string;
  name: string;
  data: ChurchProfile;
  created_at: string;
  updated_at: string | null;
};

let sqlClient: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function getSql() {
  if (!sqlClient) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

function nowIso() {
  return new Date().toISOString();
}

function memId(prefix = "mem") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function normUserId(x: unknown) {
  const s = String(x || "").trim();
  return s.startsWith("U_") || s.startsWith("u_") ? s.toLowerCase() : s.toLowerCase();
}

function rowToMembership(row: MembershipRow): ChurchMembership {
  return {
    id: row.id,
    userId: row.user_id,
    churchId: row.church_id,
    status: row.status as MembershipStatus,
    churchRole: row.church_role as ChurchRole,
    name: row.name || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
    decidedBy: row.decided_by || undefined,
    decidedAt: row.decided_at || undefined,
    note: row.note || undefined,
    requestSource: (row.request_source as ChurchMembership["requestSource"]) || undefined,
  };
}

function rowToChurch(row: ChurchRow): ChurchProfile {
  const data = row.data && typeof row.data === "object" ? row.data : ({} as ChurchProfile);
  return {
    ...data,
    id: row.id,
    name: row.name || data.name || row.id,
    createdAt: data.createdAt || row.created_at,
    updatedAt: data.updatedAt || row.updated_at || undefined,
  };
}

export function resolveChurchStoreMode(): ChurchStoreMode {
  if (isVercelRuntime() && !hasDurableStore()) return "missing-db-on-vercel";
  return hasDurableStore() ? "postgres" : "local-json";
}

export async function ensureChurchStoreReady() {
  if (isVercelRuntime() && !hasDurableStore()) {
    throw new Error("Church database not configured");
  }
  if (hasDurableStore()) {
    await ensureChurchSchema();
  }
}

export async function ensureChurchSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_churches (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_churches_name_idx
        ON kristo_churches (LOWER(name))
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS kristo_memberships (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          church_id TEXT NOT NULL,
          status TEXT NOT NULL,
          church_role TEXT NOT NULL DEFAULT 'Member',
          name TEXT,
          decided_by TEXT,
          decided_at TIMESTAMPTZ,
          note TEXT,
          request_source TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_memberships_user_idx
        ON kristo_memberships (LOWER(user_id))
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS kristo_memberships_church_idx
        ON kristo_memberships (church_id)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS kristo_memberships_one_active_per_user
        ON kristo_memberships (LOWER(user_id))
        WHERE status = 'Active'
      `;
    })();
  }
  await schemaReady;
}

export async function dbCountChurches(): Promise<number> {
  await ensureChurchSchema();
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*)::int AS count FROM kristo_churches`;
  return Number((rows as any[])?.[0]?.count || 0);
}

export async function dbCountMemberships(): Promise<number> {
  await ensureChurchSchema();
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*)::int AS count FROM kristo_memberships`;
  return Number((rows as any[])?.[0]?.count || 0);
}

export async function dbGetChurchById(churchId: string): Promise<ChurchProfile | null> {
  await ensureChurchSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM kristo_churches WHERE id = ${churchId} LIMIT 1`;
  const row = (rows as ChurchRow[])[0];
  return row ? rowToChurch(row) : null;
}

export async function dbListChurches(): Promise<ChurchProfile[]> {
  await ensureChurchSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM kristo_churches ORDER BY updated_at DESC`;
  return (rows as ChurchRow[]).map(rowToChurch);
}

export async function dbUpsertChurch(profile: ChurchProfile): Promise<ChurchProfile> {
  await ensureChurchSchema();
  const sql = getSql();
  const id = String(profile.id || "").trim();
  const name = String(profile.name || id).trim();
  const payload: ChurchProfile = {
    ...profile,
    id,
    name,
    updatedAt: nowIso(),
    createdAt: profile.createdAt || nowIso(),
  };

  await sql`
    INSERT INTO kristo_churches (id, name, data, created_at, updated_at)
    VALUES (${id}, ${name}, ${payload as any}, NOW(), NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      name = EXCLUDED.name,
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
  return payload;
}

export async function dbGetActiveMembership(userId: string): Promise<ChurchMembership | null> {
  await ensureChurchSchema();
  const sql = getSql();
  const key = normUserId(userId);
  const rows = await sql`
    SELECT * FROM kristo_memberships
    WHERE LOWER(user_id) = ${key} AND status = 'Active'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = (rows as MembershipRow[])[0];
  return row ? rowToMembership(row) : null;
}

export async function dbGetRealActiveMembership(userId: string): Promise<ChurchMembership | null> {
  const all = await dbGetMembershipsForUser(userId);
  const real = all.find((m) => m.status === "Active" && countsAsRealActiveMembership(m.churchId));
  return real || null;
}

export async function dbCleanupStaleDemoActiveMemberships(userId: string): Promise<ChurchMembership[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];

  const cleaned: ChurchMembership[] = [];
  const all = await dbGetMembershipsForUser(uid);
  for (const m of all) {
    if (m.status !== "Active" || !isBlockedDemoChurchId(m.churchId)) continue;
    m.status = "Left";
    m.updatedAt = nowIso();
    m.note = STALE_DEMO_MEMBERSHIP_NOTE;
    await dbUpdateMembership(m);
    cleaned.push(m);
  }
  return cleaned;
}

export async function dbGetMembershipsForUser(userId: string): Promise<ChurchMembership[]> {
  await ensureChurchSchema();
  const sql = getSql();
  const key = normUserId(userId);
  const rows = await sql`
    SELECT * FROM kristo_memberships
    WHERE LOWER(user_id) = ${key}
    ORDER BY created_at DESC
  `;
  return (rows as MembershipRow[]).map(rowToMembership);
}

export async function dbGetMembershipsForChurch(
  churchId: string,
  status?: MembershipStatus
): Promise<ChurchMembership[]> {
  await ensureChurchSchema();
  const sql = getSql();
  const rows = status
    ? await sql`
        SELECT * FROM kristo_memberships
        WHERE church_id = ${churchId} AND status = ${status}
        ORDER BY created_at DESC
      `
    : await sql`
        SELECT * FROM kristo_memberships
        WHERE church_id = ${churchId}
        ORDER BY created_at DESC
      `;
  return (rows as MembershipRow[]).map(rowToMembership);
}

export async function dbGetMembershipById(id: string): Promise<ChurchMembership | null> {
  await ensureChurchSchema();
  const sql = getSql();
  const rows = await sql`SELECT * FROM kristo_memberships WHERE id = ${id} LIMIT 1`;
  const row = (rows as MembershipRow[])[0];
  return row ? rowToMembership(row) : null;
}

async function dbInsertMembership(m: ChurchMembership): Promise<ChurchMembership> {
  await ensureChurchSchema();
  const sql = getSql();
  await sql`
    INSERT INTO kristo_memberships (
      id, user_id, church_id, status, church_role, name,
      decided_by, decided_at, note, request_source, created_at, updated_at
    ) VALUES (
      ${m.id},
      ${m.userId},
      ${m.churchId},
      ${m.status},
      ${m.churchRole},
      ${m.name || null},
      ${m.decidedBy || null},
      ${m.decidedAt || null},
      ${m.note || null},
      ${m.requestSource || null},
      ${m.createdAt},
      NOW()
    )
  `;
  return m;
}

async function dbUpdateMembership(m: ChurchMembership): Promise<ChurchMembership> {
  await ensureChurchSchema();
  const sql = getSql();
  const updatedAt = m.updatedAt || nowIso();
  await sql`
    UPDATE kristo_memberships
    SET
      status = ${m.status},
      church_role = ${m.churchRole},
      name = ${m.name || null},
      decided_by = ${m.decidedBy || null},
      decided_at = ${m.decidedAt || null},
      note = ${m.note || null},
      request_source = ${m.requestSource || null},
      updated_at = ${updatedAt}
    WHERE id = ${m.id}
  `;
  return { ...m, updatedAt };
}

export async function dbRequestMembership(
  userId: string,
  churchId: string,
  name?: string,
  requestSource: "JoinRequest" | "ChurchInvite" = "JoinRequest"
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  await dbCleanupStaleDemoActiveMemberships(userId);
  const active = await dbGetRealActiveMembership(userId);
  if (active) {
    return { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
  }

  const existing = await dbGetMembershipsForUser(userId);
  const pending = existing.find((m) => m.status === "Requested");
  if (pending && pending.churchId !== churchId) {
    return { ok: false, error: `User already has a pending request in churchId=${pending.churchId}` };
  }
  if (pending && pending.churchId === churchId) {
    pending.requestSource = pending.requestSource || requestSource;
    await dbUpdateMembership(pending);
    return { ok: true, membership: pending };
  }

  const m: ChurchMembership = {
    id: memId(),
    userId,
    churchId,
    status: "Requested",
    churchRole: "Member",
    name: name?.trim() ? name.trim() : undefined,
    requestSource,
    createdAt: nowIso(),
  };
  await dbInsertMembership(m);
  return { ok: true, membership: m };
}

export async function dbAddActiveMember(
  churchId: string,
  userId: string,
  name?: string,
  role: ChurchRole = "Member"
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  await dbCleanupStaleDemoActiveMemberships(userId);
  const active = await dbGetRealActiveMembership(userId);
  if (active) {
    return { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
  }

  const existing = await dbGetMembershipsForUser(userId);
  const pendingSameChurch = existing.find(
    (m) => normUserId(m.userId) === normUserId(userId) && m.churchId === churchId && m.status === "Requested"
  );

  if (pendingSameChurch) {
    pendingSameChurch.status = "Active";
    pendingSameChurch.churchRole = role;
    pendingSameChurch.name = name?.trim() ? name.trim() : pendingSameChurch.name;
    pendingSameChurch.updatedAt = nowIso();
    pendingSameChurch.decidedBy = "system";
    pendingSameChurch.decidedAt = nowIso();
    await dbUpdateMembership(pendingSameChurch);
    return { ok: true, membership: pendingSameChurch };
  }

  const m: ChurchMembership = {
    id: memId(),
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

  try {
    await dbInsertMembership(m);
    return { ok: true, membership: m };
  } catch (error: any) {
    const msg = String(error?.message || error || "");
    if (msg.includes("kristo_memberships_one_active_per_user")) {
      const again = await dbGetRealActiveMembership(userId);
      if (again) {
        return { ok: false, error: `User already has an Active membership in churchId=${again.churchId}` };
      }
    }
    throw error;
  }
}

export async function dbLeaveActiveMembership(
  userId: string
): Promise<{ ok: true; membership?: ChurchMembership } | { ok: false; error: string }> {
  const active = await dbGetActiveMembership(userId);
  if (!active) return { ok: false, error: "No Active membership to leave" };

  active.status = "Left";
  active.updatedAt = nowIso();
  await dbUpdateMembership(active);
  return { ok: true, membership: active };
}

export async function dbApproveMembership(
  membershipId: string,
  decidedBy: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  const m = await dbGetMembershipById(membershipId);
  if (!m) return { ok: false, error: "Membership not found" };
  if (m.status !== "Requested") return { ok: false, error: `Cannot approve membership in status=${m.status}` };

  await dbCleanupStaleDemoActiveMemberships(m.userId);
  const active = await dbGetRealActiveMembership(m.userId);
  if (active) {
    return { ok: false, error: `User already has an Active membership in churchId=${active.churchId}` };
  }

  m.status = "Active";
  m.updatedAt = nowIso();
  m.decidedBy = decidedBy;
  m.decidedAt = nowIso();
  if (!m.churchRole) m.churchRole = "Member";
  await dbUpdateMembership(m);
  return { ok: true, membership: m };
}

export async function dbRejectMembership(
  membershipId: string,
  decidedBy: string,
  note?: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  const m = await dbGetMembershipById(membershipId);
  if (!m) return { ok: false, error: "Membership not found" };
  if (m.status !== "Requested") return { ok: false, error: `Cannot reject membership in status=${m.status}` };

  m.status = "Rejected";
  m.updatedAt = nowIso();
  m.decidedBy = decidedBy;
  m.decidedAt = nowIso();
  m.note = note;
  await dbUpdateMembership(m);
  return { ok: true, membership: m };
}

export async function dbDeactivateMemberInChurch(
  churchId: string,
  userId: string
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  const rows = await dbGetMembershipsForChurch(churchId, "Active");
  const m = rows.find((x) => normUserId(x.userId) === normUserId(userId));
  if (!m) return { ok: false, error: "Active membership not found for this user in this church" };
  if (m.churchRole === "Pastor") return { ok: false, error: "Pastor cannot be removed" };

  m.status = "Left";
  m.updatedAt = nowIso();
  m.note = "Removed by church admin";
  await dbUpdateMembership(m);
  return { ok: true, membership: m };
}

export async function dbSetMemberRole(
  churchId: string,
  userId: string,
  role: ChurchRole
): Promise<{ ok: true; membership: ChurchMembership } | { ok: false; error: string }> {
  const rows = await dbGetMembershipsForChurch(churchId, "Active");
  const m = rows.find((x) => normUserId(x.userId) === normUserId(userId));
  if (!m) return { ok: false, error: "Active membership not found for this user in this church" };

  m.churchRole = role;
  m.updatedAt = nowIso();
  await dbUpdateMembership(m);
  return { ok: true, membership: m };
}

export async function dbDevPromoteToRoleIfActive(
  userId: string,
  churchId: string,
  role: ChurchRole
): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const rows = await dbGetMembershipsForChurch(churchId, "Active");
  const m = rows.find((x) => normUserId(x.userId) === normUserId(userId));
  if (!m) return;

  const priority: Record<ChurchRole, number> = {
    Member: 0,
    Leader: 1,
    Ministry_Leader: 2,
    Church_Admin: 3,
    Pastor: 4,
    System_Admin: 5,
  };
  const cur = m.churchRole || "Member";
  if (priority[cur] >= priority[role]) return;

  m.churchRole = role;
  m.updatedAt = nowIso();
  await dbUpdateMembership(m);
}

export async function getChurchStoreDiagnostics(opts?: { userId?: string; churchId?: string }) {
  const storeMode = resolveChurchStoreMode();
  const vercel = isVercelRuntime();
  const hasDatabaseUrl = hasDurableStore();
  const userId = String(opts?.userId || "").trim();
  const churchId = String(opts?.churchId || "").trim();

  let churchesTableReachable = false;
  let membershipsTableReachable = false;
  let churchCount: number | null = null;
  let membershipCount: number | null = null;
  let storeError: string | null = null;
  let activeMembership: ChurchMembership | null = null;
  let church: ChurchProfile | null = null;

  if (hasDatabaseUrl) {
    try {
      churchCount = await dbCountChurches();
      membershipCount = await dbCountMemberships();
      churchesTableReachable = true;
      membershipsTableReachable = true;

      if (userId) {
        activeMembership = await dbGetActiveMembership(userId);
      }
      if (churchId) {
        church = await dbGetChurchById(churchId);
      }
    } catch (error: any) {
      storeError = String(error?.message || error || "postgres_unreachable");
    }
  } else if (vercel) {
    storeError = "Church database not configured";
  }

  return {
    ok: vercel ? hasDatabaseUrl && churchesTableReachable && membershipsTableReachable : true,
    storeMode,
    hasDatabaseUrl,
    churchesTableReachable,
    membershipsTableReachable,
    churchCount,
    membershipCount,
    storeError,
    userId: userId || null,
    churchId: churchId || null,
    membershipFound: Boolean(activeMembership),
    activeMembership: activeMembership
      ? {
          id: activeMembership.id,
          userId: activeMembership.userId,
          churchId: activeMembership.churchId,
          status: activeMembership.status,
          churchRole: activeMembership.churchRole,
        }
      : null,
    churchFound: Boolean(church),
    church: church ? { id: church.id, name: church.name } : null,
    vercel,
    vercelEnv: process.env.VERCEL_ENV || null,
    churchDbModule: "churchDb.v1",
  };
}

export function isChurchDatabaseError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("church database not configured") ||
    message.includes("database_url not configured")
  );
}
