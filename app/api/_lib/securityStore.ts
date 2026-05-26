import { readJsonFile, writeJsonFile } from "@/app/api/_lib/store/fs";

export type ApprovalStatus = "pending" | "approved" | "denied";
export type RoleReviewStatus = "pending" | "approved" | "denied";

export type ApprovalRequest = {
  id: string;
  churchId: string;
  name: string;
  role: string;
  device: string;
  location: string;
  requestedAt: string;
  status: ApprovalStatus;
  trustedDevice?: boolean;
  knownLocation?: boolean;
  failedAttempts?: number;
  requestedRoleLevel?: number;
};

export type RoleReviewRequest = {
  id: string;
  churchId: string;
  userId?: string;
  name: string;
  currentRole: string;
  requestedRole: string;
  reason: string;
  requestedAt: string;
  status: RoleReviewStatus;
};

const APPROVALS_FILE = "security_approvals.json";
const ROLE_REVIEWS_FILE = "security_role_reviews.json";

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "sec") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const DEFAULT_APPROVALS: ApprovalRequest[] = [
  {
    id: "req-1",
    churchId: "c-demo-1",
    name: "Daniel M",
    role: "Church Member",
    device: "iPhone 15 Pro",
    location: "Dallas, TX",
    requestedAt: "2 min ago",
    status: "pending",
    trustedDevice: false,
    knownLocation: true,
    failedAttempts: 2,
    requestedRoleLevel: 2,
  },
  {
    id: "req-2",
    churchId: "c-demo-1",
    name: "Sarah A",
    role: "Ministry Leader",
    device: "iPad Air",
    location: "Fort Worth, TX",
    requestedAt: "11 min ago",
    status: "pending",
    trustedDevice: true,
    knownLocation: false,
    failedAttempts: 0,
    requestedRoleLevel: 4,
  },
  {
    id: "req-3",
    churchId: "c-demo-1",
    name: "Neema K",
    role: "Pastor Assistant",
    device: "Samsung S24",
    location: "Arlington, TX",
    requestedAt: "24 min ago",
    status: "pending",
    trustedDevice: false,
    knownLocation: false,
    failedAttempts: 1,
    requestedRoleLevel: 5,
  },
];

const DEFAULT_ROLE_REVIEWS: RoleReviewRequest[] = [
  {
    id: "role-1",
    churchId: "c-demo-1",
    userId: "u-demo-1",
    name: "Daniel M",
    currentRole: "Church Member",
    requestedRole: "Ministry Leader",
    reason: "Needs to manage outreach team this week.",
    requestedAt: "5 min ago",
    status: "pending",
  },
  {
    id: "role-2",
    churchId: "c-demo-1",
    userId: "u-demo-2",
    name: "Sarah A",
    currentRole: "Ministry Leader",
    requestedRole: "Church Admin",
    reason: "Temporary admin support for events and schedules.",
    requestedAt: "18 min ago",
    status: "pending",
  },
  {
    id: "role-3",
    churchId: "c-demo-1",
    userId: "u-demo-3",
    name: "Neema K",
    currentRole: "Pastor Assistant",
    requestedRole: "Pastor",
    reason: "Requested broader approval access for leadership tasks.",
    requestedAt: "34 min ago",
    status: "pending",
  },
];

function normalizeApprovalStatus(value: unknown): ApprovalStatus {
  return value === "approved" || value === "denied" || value === "pending" ? value : "pending";
}

function normalizeRoleReviewStatus(value: unknown): RoleReviewStatus {
  return value === "approved" || value === "denied" || value === "pending" ? value : "pending";
}

function normalizeApprovals(value: unknown): ApprovalRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<ApprovalRequest>;
    return {
      id: String(row.id || `req-${index + 1}`),
      churchId: String(row.churchId || "c-demo-1"),
      name: String(row.name || "Unknown User"),
      role: String(row.role || "Unknown Role"),
      device: String(row.device || "Unknown Device"),
      location: String(row.location || "Unknown Location"),
      requestedAt: String(row.requestedAt || nowIso()),
      status: normalizeApprovalStatus(row.status),
      trustedDevice: typeof row.trustedDevice === "boolean" ? row.trustedDevice : false,
      knownLocation: typeof row.knownLocation === "boolean" ? row.knownLocation : false,
      failedAttempts: typeof row.failedAttempts === "number" ? row.failedAttempts : 0,
      requestedRoleLevel: typeof row.requestedRoleLevel === "number" ? row.requestedRoleLevel : 1,
    };
  });
}

function normalizeRoleReviews(value: unknown): RoleReviewRequest[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<RoleReviewRequest>;
    return {
      id: String(row.id || `role-${index + 1}`),
      churchId: String(row.churchId || "c-demo-1"),
      userId: row.userId ? String(row.userId) : undefined,
      name: String(row.name || "Unknown User"),
      currentRole: String(row.currentRole || "Unknown Role"),
      requestedRole: String(row.requestedRole || "Unknown Role"),
      reason: String(row.reason || "No reason provided."),
      requestedAt: String(row.requestedAt || nowIso()),
      status: normalizeRoleReviewStatus(row.status),
    };
  });
}

async function ensureSeededApprovals() {
  const all = await readJsonFile<ApprovalRequest[]>(APPROVALS_FILE, []);
  if (Array.isArray(all) && all.length > 0) return normalizeApprovals(all);
  await writeJsonFile(APPROVALS_FILE, DEFAULT_APPROVALS);
  return DEFAULT_APPROVALS;
}

async function ensureSeededRoleReviews() {
  const all = await readJsonFile<RoleReviewRequest[]>(ROLE_REVIEWS_FILE, []);
  if (Array.isArray(all) && all.length > 0) return normalizeRoleReviews(all);
  await writeJsonFile(ROLE_REVIEWS_FILE, DEFAULT_ROLE_REVIEWS);
  return DEFAULT_ROLE_REVIEWS;
}

export async function getApprovalRequests(churchId: string): Promise<ApprovalRequest[]> {
  const all = await ensureSeededApprovals();
  return all.filter((x) => x.churchId === churchId);
}

export async function saveApprovalRequests(items: ApprovalRequest[]): Promise<void> {
  const current = await readJsonFile<ApprovalRequest[]>(APPROVALS_FILE, []);
  const normalizedCurrent = normalizeApprovals(current);
  const incoming = normalizeApprovals(items);

  const touchedChurchIds = new Set(incoming.map((x) => x.churchId));
  const untouched = normalizedCurrent.filter((x) => !touchedChurchIds.has(x.churchId));

  await writeJsonFile(APPROVALS_FILE, [...incoming, ...untouched]);
}

export async function updateApprovalStatus(
  churchId: string,
  id: string,
  status: ApprovalStatus
): Promise<ApprovalRequest[]> {
  const currentAll = await ensureSeededApprovals();
  const nextAll = currentAll.map((item) =>
    item.id === id && item.churchId === churchId ? { ...item, status } : item
  );
  await writeJsonFile(APPROVALS_FILE, nextAll);
  return nextAll.filter((x) => x.churchId === churchId);
}

export async function getRoleReviewRequests(churchId: string): Promise<RoleReviewRequest[]> {
  const all = await ensureSeededRoleReviews();
  return all.filter((x) => x.churchId === churchId);
}

export async function saveRoleReviewRequests(items: RoleReviewRequest[]): Promise<void> {
  const current = await readJsonFile<RoleReviewRequest[]>(ROLE_REVIEWS_FILE, []);
  const normalizedCurrent = normalizeRoleReviews(current);
  const incoming = normalizeRoleReviews(items);

  const touchedChurchIds = new Set(incoming.map((x) => x.churchId));
  const untouched = normalizedCurrent.filter((x) => !touchedChurchIds.has(x.churchId));

  await writeJsonFile(ROLE_REVIEWS_FILE, [...incoming, ...untouched]);
}

export async function updateRoleReviewStatus(
  churchId: string,
  id: string,
  status: RoleReviewStatus
): Promise<RoleReviewRequest[]> {
  const currentAll = await ensureSeededRoleReviews();
  const nextAll = currentAll.map((item) =>
    item.id === id && item.churchId === churchId ? { ...item, status } : item
  );
  await writeJsonFile(ROLE_REVIEWS_FILE, nextAll);
  return nextAll.filter((x) => x.churchId === churchId);
}

export async function createApprovalRequest(
  input: Omit<ApprovalRequest, "id">
): Promise<ApprovalRequest> {
  const current = await ensureSeededApprovals();
  const created: ApprovalRequest = { ...input, id: id("req") };
  const next = [created, ...current];
  await writeJsonFile(APPROVALS_FILE, next);
  return created;
}

export async function createRoleReviewRequest(
  input: Omit<RoleReviewRequest, "id">
): Promise<RoleReviewRequest> {
  const current = await ensureSeededRoleReviews();
  const created: RoleReviewRequest = { ...input, id: id("role") };
  const next = [created, ...current];
  await writeJsonFile(ROLE_REVIEWS_FILE, next);
  return created;
}
