import { getSessionSync } from "@/src/lib/kristoSession";
import { apiGet, apiPatch, apiPost } from "@/src/lib/kristoApi";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type ApprovalRequest = {
  id: string;
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

export type RoleReviewStatus = "pending" | "approved" | "denied";

export type RoleReviewRequest = {
  id: string;
  userId?: string;
  name: string;
  currentRole: string;
  requestedRole: string;
  reason: string;
  requestedAt: string;
  status: RoleReviewStatus;
};

export type AuditLogEntry = {
  id: string;
  churchId: string;
  action: string;
  actorUserId: string;
  actorRole?: string;
  actorName?: string;
  targetId?: string;
  targetType?: string;
  message?: string;
  meta?: Record<string, any>;
  ip?: string;
  userAgent?: string;
  createdAt: string;
};


export type ActiveSessionEntry = {
  id: string;
  userId: string;
  name: string;
  role: string;
  device: string;
  location: string;
  ip?: string;
  startedAt: string;
  lastSeenAt: string;
  risk: "low" | "medium" | "high";
  trustedDevice?: boolean;
  current?: boolean;
};

export type TrustedDeviceEntry = {
  id: string;
  label: string;
  device: string;
  deviceType: "phone" | "tablet" | "desktop" | "browser";
  ownerName: string;
  ownerRole: string;
  location: string;
  ip?: string;
  trusted: boolean;
  current?: boolean;
  risk: "low" | "medium" | "high";
  addedAt: string;
  lastSeenAt: string;
  os?: string;
};

export type TrustPolicy = {
  mode: "balanced" | "strict" | "open";
  allowUnknownLocation: boolean;
  requireManualApproval: boolean;
  autoExpireDays: number;
};

export const DEFAULT_SECURITY_LOGS: AuditLogEntry[] = [];

export const DEFAULT_TRUSTED_DEVICES: TrustedDeviceEntry[] = [
  {
    id: "dev-1",
    label: "Prince iPhone",
    device: "iPhone 15 Pro",
    deviceType: "phone",
    ownerName: "Prince Fariji",
    ownerRole: "Church_Admin",
    location: "Fort Worth, TX",
    ip: "::1",
    trusted: true,
    current: true,
    risk: "low",
    addedAt: "2 days ago",
    lastSeenAt: "Just now",
    os: "iOS 18",
  },
  {
    id: "dev-2",
    label: "MacBook Security",
    device: "MacBook Air",
    deviceType: "desktop",
    ownerName: "Prince Fariji",
    ownerRole: "Church_Admin",
    location: "Dallas, TX",
    ip: "127.0.0.1",
    trusted: true,
    current: false,
    risk: "low",
    addedAt: "5 days ago",
    lastSeenAt: "14 min ago",
    os: "macOS",
  },
  {
    id: "dev-3",
    label: "Unknown Android",
    device: "Android Phone",
    deviceType: "phone",
    ownerName: "Unknown User",
    ownerRole: "Member",
    location: "Unknown location",
    ip: "10.0.0.8",
    trusted: false,
    current: false,
    risk: "high",
    addedAt: "Today",
    lastSeenAt: "6 min ago",
    os: "Android",
  },
];

export const DEFAULT_TRUST_POLICY: TrustPolicy = {
  mode: "balanced",
  allowUnknownLocation: false,
  requireManualApproval: true,
  autoExpireDays: 30,
};


export const DEFAULT_ACTIVE_SESSIONS: ActiveSessionEntry[] = [];

export const DEFAULT_APPROVALS: ApprovalRequest[] = [];

export const DEFAULT_ROLE_REVIEWS: RoleReviewRequest[] = [];


let approvalCache: ApprovalRequest[] = DEFAULT_APPROVALS.map((item) => ({ ...item }));
let roleReviewCache: RoleReviewRequest[] = DEFAULT_ROLE_REVIEWS.map((item) => ({ ...item }));
let activeSessionCache: ActiveSessionEntry[] = DEFAULT_ACTIVE_SESSIONS.map((item) => ({ ...item }));
let trustedDeviceCache: TrustedDeviceEntry[] = DEFAULT_TRUSTED_DEVICES.map((item) => ({ ...item }));
let trustPolicyCache: TrustPolicy = { ...DEFAULT_TRUST_POLICY };
let securityLogCache: AuditLogEntry[] = DEFAULT_SECURITY_LOGS.map((item) => ({ ...item }));
let trustedDeviceScanCount = 0;

function getScanLastSeenLabel(step: number) {
  const mod = step % 5;
  if (mod === 0) return "Just now";
  if (mod === 1) return "1 min ago";
  if (mod === 2) return "2 min ago";
  if (mod === 3) return "4 min ago";
  return "7 min ago";
}

function simulateTrustedDeviceScan(
  items: TrustedDeviceEntry[],
  targetId?: string
): TrustedDeviceEntry[] {
  trustedDeviceScanCount += 1;
  const step = trustedDeviceScanCount;

  return items.map((item, index) => {
    if (targetId && item.id !== targetId) {
      return { ...item };
    }

    const seedSource = `${item.id}|${item.device}|${item.deviceType}|${item.ownerRole}|${index}`;
    const seed = Array.from(seedSource).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const phase = (seed + step) % 6;
    const baseSeen = getScanLastSeenLabel((step + index) % 5);

    if (item.current) {
      return {
        ...item,
        trusted: true,
        risk: phase >= 4 ? "medium" : "low",
        lastSeenAt: "Just now",
        location: item.location,
      };
    }

    if (item.id === "dev-3" || item.trusted === false) {
      return {
        ...item,
        trusted: false,
        risk: phase % 2 === 0 ? "high" : "medium",
        lastSeenAt: phase % 2 === 0 ? "Just now" : baseSeen,
        location:
          item.location === "Unknown location"
            ? "Unknown location"
            : phase % 2 === 0
            ? item.location
            : "Unverified region",
      };
    }

    if (item.deviceType === "browser") {
      return {
        ...item,
        trusted: phase !== 4,
        risk: phase === 4 ? "high" : (phase === 1 || phase === 3) ? "medium" : "low",
        lastSeenAt: phase === 4 ? "Just now" : baseSeen,
        location: phase === 4 ? "New browser region" : item.location,
      };
    }

    if (item.deviceType === "desktop") {
      return {
        ...item,
        trusted: true,
        risk: (phase === 2 || phase === 5) ? "medium" : "low",
        lastSeenAt: baseSeen,
        location: item.location,
      };
    }

    return {
      ...item,
      trusted: phase === 5 ? false : item.trusted,
      risk:
        phase === 5
          ? "high"
          : phase === 2
          ? "medium"
          : "low",
      lastSeenAt: phase === 5 ? "Just now" : baseSeen,
      location:
        phase === 5 && item.location !== "Unknown location"
          ? "Travel mode detected"
          : item.location,
    };
  });
}

function getActorSnapshot() {
  const auth = getSessionSync();
  const churchId = String(
    auth?.churchId
  );

  const actorUserId = String(auth?.userId || "unknown");
  const actorRole = String(auth?.role || "Member");
  const actorName = String((auth as any)?.name || (auth as any)?.displayName || actorUserId);

  return { churchId, actorUserId, actorRole, actorName };
}

async function persistSecurityLog(input: {
  action: string;
  targetId?: string;
  targetType?: string;
  message: string;
  meta?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}) {
  const actor = getActorSnapshot();

  const fallbackEntry: AuditLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    churchId: String(actor.churchId || ""),
    action: input.action,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
    targetId: input.targetId,
    targetType: input.targetType,
    message: input.message,
    meta: input.meta,
    ip: input.ip,
    userAgent: input.userAgent,
    createdAt: new Date().toISOString(),
  };

  try {
    const j = await apiPost<any>(
      "/api/church/audit",
      {
        action: input.action,
        targetId: input.targetId,
        targetType: input.targetType,
        message: input.message,
        meta: input.meta,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      { headers: authHeaders() }
    );

    const normalized = normalizeSecurityLogs(
      Array.isArray(j?.data) ? j.data : j?.data ? [j.data] : []
    );

    if (normalized.length > 0) {
      securityLogCache = mergeLogs(normalized, securityLogCache);
      return normalized[0];
    }
  } catch {}

  securityLogCache = [fallbackEntry, ...securityLogCache].slice(0, 300);
  return fallbackEntry;
}

function mergeLogs(primary: AuditLogEntry[], extras: AuditLogEntry[]) {
  const seen = new Set<string>();
  const merged: AuditLogEntry[] = [];

  for (const item of [...extras, ...primary]) {
    const key = String(item.id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged.sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    return bt - at;
  });
}

function normalizeApprovalStatus(value: unknown): ApprovalStatus {
  return value === "approved" || value === "denied" || value === "pending" ? value : "pending";
}

function normalizeRoleReviewStatus(value: unknown): RoleReviewStatus {
  return value === "approved" || value === "denied" || value === "pending" ? value : "pending";
}

function normalizeApprovals(value: unknown): ApprovalRequest[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_APPROVALS;

  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<ApprovalRequest>;
    return {
      id: String(row.id || `req-${index + 1}`),
      name: String(row.name || "Unknown User"),
      role: String(row.role || "Unknown Role"),
      device: String(row.device || "Unknown Device"),
      location: String(row.location || "Unknown Location"),
      requestedAt: String(row.requestedAt || "Just now"),
      status: normalizeApprovalStatus(row.status),
      trustedDevice: typeof row.trustedDevice === "boolean" ? row.trustedDevice : false,
      knownLocation: typeof row.knownLocation === "boolean" ? row.knownLocation : false,
      failedAttempts: typeof row.failedAttempts === "number" ? row.failedAttempts : 0,
      requestedRoleLevel: typeof row.requestedRoleLevel === "number" ? row.requestedRoleLevel : 1,
    };
  });
}

function normalizeRoleReviews(value: unknown): RoleReviewRequest[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_ROLE_REVIEWS;

  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<RoleReviewRequest>;
    return {
      id: String(row.id || `role-${index + 1}`),
      userId: row.userId ? String(row.userId) : undefined,
      name: String(row.name || "Unknown User"),
      currentRole: String(row.currentRole || "Unknown Role"),
      requestedRole: String(row.requestedRole || "Unknown Role"),
      reason: String(row.reason || "No reason provided."),
      requestedAt: String(row.requestedAt || "Just now"),
      status: normalizeRoleReviewStatus(row.status),
    };
  });
}

function normalizeSecurityLogs(value: unknown): AuditLogEntry[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_SECURITY_LOGS;

  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<AuditLogEntry>;
    return {
      id: String(row.id || `log-${index + 1}`),
      churchId: String(row.churchId || ""),
      action: String(row.action || "GENERIC"),
      actorUserId: String(row.actorUserId || "unknown"),
      actorRole: row.actorRole ? String(row.actorRole) : undefined,
      actorName: row.actorName ? String(row.actorName) : undefined,
      targetId: row.targetId ? String(row.targetId) : undefined,
      targetType: row.targetType ? String(row.targetType) : undefined,
      message: row.message ? String(row.message) : undefined,
      meta: row.meta && typeof row.meta == "object" ? row.meta : undefined,
      ip: row.ip ? String(row.ip) : undefined,
      userAgent: row.userAgent ? String(row.userAgent) : undefined,
      createdAt: String(row.createdAt || new Date().toISOString()),
    };
  });
}


function normalizeActiveSessions(value: unknown): ActiveSessionEntry[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_ACTIVE_SESSIONS;

  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<ActiveSessionEntry>;
    const risk =
      row.risk === "high" || row.risk === "medium" || row.risk === "low"
        ? row.risk
        : "low";

    return {
      id: String(row.id || `sess-${index + 1}`),
      userId: String(row.userId || `u-${index + 1}`),
      name: String(row.name || "Unknown User"),
      role: String(row.role || "Member"),
      device: String(row.device || "Unknown Device"),
      location: String(row.location || "Unknown Location"),
      ip: row.ip ? String(row.ip) : undefined,
      startedAt: String(row.startedAt || "Just now"),
      lastSeenAt: String(row.lastSeenAt || "Just now"),
      risk,
      trustedDevice: typeof row.trustedDevice === "boolean" ? row.trustedDevice : false,
      current: typeof row.current === "boolean" ? row.current : false,
    };
  });
}

function normalizeTrustedDevices(value: unknown): TrustedDeviceEntry[] {
  if (!Array.isArray(value) || value.length === 0) return DEFAULT_TRUSTED_DEVICES;

  return value.map((item, index) => {
    const row = (item ?? {}) as Partial<TrustedDeviceEntry>;
    const deviceType =
      row.deviceType === "phone" || row.deviceType === "tablet" || row.deviceType === "desktop" || row.deviceType === "browser"
        ? row.deviceType
        : "phone";
    const risk =
      row.risk === "high" || row.risk === "medium" || row.risk === "low"
        ? row.risk
        : "low";

    return {
      id: String(row.id || `dev-${index + 1}`),
      label: String(row.label || row.device || `Device ${index + 1}`),
      device: String(row.device || "Unknown Device"),
      deviceType,
      ownerName: String(row.ownerName || "Unknown User"),
      ownerRole: String(row.ownerRole || "Member"),
      location: String(row.location || "Unknown Location"),
      ip: row.ip ? String(row.ip) : undefined,
      trusted: typeof row.trusted === "boolean" ? row.trusted : false,
      current: typeof row.current === "boolean" ? row.current : false,
      risk,
      addedAt: String(row.addedAt || "Just now"),
      lastSeenAt: String(row.lastSeenAt || "Just now"),
      os: row.os ? String(row.os) : undefined,
    };
  });
}

function authHeaders() {
  const auth = getSessionSync();
  const churchId = String(
    auth?.churchId
  );

  const userId = String(auth?.userId || "");
  const role = String(auth?.role || "Member");

  return {
    accept: "application/json",
    "content-type": "application/json",
    "x-kristo-user-id": userId,
    "x-kristo-role": role,
    "x-kristo-church-id": churchId,
  };
}

export async function getApprovalRequests(): Promise<ApprovalRequest[]> {
  try {
    const j = await apiGet<any>("/api/church/security/approvals", {
      headers: authHeaders(),
    });
    const normalized = normalizeApprovals(j?.data);
    approvalCache = normalized.map((item) => ({ ...item }));
    return approvalCache;
  } catch {
    return approvalCache.map((item) => ({ ...item }));
  }
}

export async function updateApprovalStatus(
  id: string,
  status: ApprovalStatus
): Promise<ApprovalRequest[]> {
  const current = await getApprovalRequests();
  const target = current.find((item) => item.id === id);

  try {
    const j = await apiPatch<any>(
      "/api/church/security/approvals",
      { id, status },
      { headers: authHeaders() }
    );
    approvalCache = normalizeApprovals(j?.data).map((item) => ({ ...item }));
  } catch {
    approvalCache = current.map((item) => (item.id === id ? { ...item, status } : item));
  }

  if (target) {
    await persistSecurityLog({
      action: status === "approved" ? "SECURITY_APPROVAL_APPROVED" : "SECURITY_APPROVAL_DENIED",
      targetId: target.id,
      targetType: "security_approval",
      message: `${status === "approved" ? "Approved" : "Denied"} access request ${target.id} for ${target.name}.`,
      meta: {
        requestId: target.id,
        name: target.name,
        role: target.role,
        device: target.device,
        location: target.location,
        status,
      },
    });
  }

  return approvalCache.map((item) => ({ ...item }));
}

export async function getRoleReviewRequests(): Promise<RoleReviewRequest[]> {
  try {
    const j = await apiGet<any>("/api/church/security/role-reviews", {
      headers: authHeaders(),
    });
    const normalized = normalizeRoleReviews(j?.data);
    roleReviewCache = normalized.map((item) => ({ ...item }));
    return roleReviewCache;
  } catch {
    return roleReviewCache.map((item) => ({ ...item }));
  }
}

export async function updateRoleReviewStatus(
  id: string,
  status: RoleReviewStatus,
  userId?: string
): Promise<RoleReviewRequest[]> {
  const current = await getRoleReviewRequests();
  const target = current.find((item) => item.id === id);

  try {
    const j = await apiPatch<any>(
      "/api/church/security/role-reviews",
      { id, status, userId },
      { headers: authHeaders() }
    );
    roleReviewCache = normalizeRoleReviews(j?.data).map((item) => ({ ...item }));
  } catch {
    roleReviewCache = current.map((item) => (item.id === id ? { ...item, status } : item));
  }

  if (target) {
    await persistSecurityLog({
      action: status === "approved" ? "SECURITY_ROLE_APPROVED" : "SECURITY_ROLE_DENIED",
      targetId: target.id,
      targetType: "security_role_review",
      message: `${status === "approved" ? "Approved" : "Denied"} role review ${target.id} for ${target.name}.`,
      meta: {
        roleReviewId: target.id,
        userId: target.userId,
        name: target.name,
        currentRole: target.currentRole,
        requestedRole: target.requestedRole,
        status,
      },
    });
  }

  return roleReviewCache.map((item) => ({ ...item }));
}

export async function getSecurityLogs(params?: {
  limit?: number;
  q?: string;
  action?: string;
}): Promise<AuditLogEntry[]> {
  try {
    const qs = new URLSearchParams();
    qs.set("limit", String(params?.limit ?? 50));
    if (params?.q) qs.set("q", String(params.q));
    if (params?.action) qs.set("action", String(params.action));

    const j = await apiGet<any>(`/api/church/audit?${qs.toString()}`, {
      headers: authHeaders(),
    });

    const normalized = normalizeSecurityLogs(j?.data);
    securityLogCache = mergeLogs(normalized, securityLogCache);

    let rows = [...securityLogCache];

    if (params?.action) {
      const actionNeedle = String(params.action).toLowerCase();
      rows = rows.filter((item) => String(item.action || "").toLowerCase().includes(actionNeedle));
    }

    if (params?.q) {
      const q = String(params.q).toLowerCase();
      rows = rows.filter((item) =>
        String(item.message || "").toLowerCase().includes(q) ||
        String(item.targetType || "").toLowerCase().includes(q) ||
        String(item.targetId || "").toLowerCase().includes(q) ||
        String(item.actorName || "").toLowerCase().includes(q) ||
        String(item.actorRole || "").toLowerCase().includes(q)
      );
    }

    return rows.slice(0, params?.limit ?? 50);
  } catch {
    let rows = [...securityLogCache];

    if (params?.action) {
      const actionNeedle = String(params.action).toLowerCase();
      rows = rows.filter((item) => String(item.action || "").toLowerCase().includes(actionNeedle));
    }

    if (params?.q) {
      const q = String(params.q).toLowerCase();
      rows = rows.filter((item) =>
        String(item.message || "").toLowerCase().includes(q) ||
        String(item.targetType || "").toLowerCase().includes(q) ||
        String(item.targetId || "").toLowerCase().includes(q) ||
        String(item.actorName || "").toLowerCase().includes(q) ||
        String(item.actorRole || "").toLowerCase().includes(q)
      );
    }

    return rows.slice(0, params?.limit ?? 50);
  }
}


export async function getActiveSessions(): Promise<ActiveSessionEntry[]> {
  try {
    const j = await apiGet<any>("/api/church/security/sessions", {
      headers: authHeaders(),
    });
    const normalized = normalizeActiveSessions(j?.data);
    activeSessionCache = normalized.map((item) => ({ ...item }));
    return activeSessionCache;
  } catch {
    return activeSessionCache.map((item) => ({ ...item }));
  }
}

export async function killActiveSession(sessionId: string): Promise<ActiveSessionEntry[]> {
  const current = await getActiveSessions();
  const target = current.find((item) => item.id === sessionId);

  try {
    const j = await apiPatch<any>(
      "/api/church/security/sessions",
      { id: sessionId, action: "kill" },
      { headers: authHeaders() }
    );
    activeSessionCache = normalizeActiveSessions(j?.data).map((item) => ({ ...item }));
  } catch {
    activeSessionCache = current.filter((item) => item.id !== sessionId);
  }

  if (target) {
    await persistSecurityLog({
      action: "SECURITY_SESSION_KILLED",
      targetId: target.id,
      targetType: "security_session",
      message: `Killed active session ${target.id} for ${target.name}.`,
      meta: {
        sessionId: target.id,
        userId: target.userId,
        name: target.name,
        role: target.role,
        device: target.device,
        location: target.location,
        ip: target.ip,
      },
      ip: target.ip,
    });
  }

  return activeSessionCache.map((item) => ({ ...item }));
}

export async function forceReloginSession(sessionId: string): Promise<ActiveSessionEntry[]> {
  const current = await getActiveSessions();
  const target = current.find((item) => item.id === sessionId);

  try {
    const j = await apiPatch<any>(
      "/api/church/security/sessions",
      { id: sessionId, action: "force_relogin" },
      { headers: authHeaders() }
    );
    activeSessionCache = normalizeActiveSessions(j?.data).map((item) => ({ ...item }));
  } catch {
    activeSessionCache = current.map((item) =>
      item.id === sessionId ? { ...item, risk: "medium" } : item
    );
  }

  if (target) {
    await persistSecurityLog({
      action: "SECURITY_SESSION_FORCE_RELOGIN",
      targetId: target.id,
      targetType: "security_session",
      message: `Forced re-login for session ${target.id} owned by ${target.name}.`,
      meta: {
        sessionId: target.id,
        userId: target.userId,
        name: target.name,
        role: target.role,
        device: target.device,
        location: target.location,
        ip: target.ip,
      },
      ip: target.ip,
    });
  }

  return activeSessionCache.map((item) => ({ ...item }));
}

export function countApprovalStats(items: ApprovalRequest[]) {
  return {
    pendingCount: items.filter((item) => item.status === "pending").length,
    approvedCount: items.filter((item) => item.status === "approved").length,
    deniedCount: items.filter((item) => item.status === "denied").length,
  };
}

export function countRoleReviewStats(items: RoleReviewRequest[]) {
  return {
    pendingCount: items.filter((item) => item.status === "pending").length,
    approvedCount: items.filter((item) => item.status === "approved").length,
    deniedCount: items.filter((item) => item.status === "denied").length,
  };
}


export function countSessionStats(items: ActiveSessionEntry[]) {
  return {
    totalCount: items.length,
    highRiskCount: items.filter((item) => item.risk === "high").length,
    currentCount: items.filter((item) => item.current).length,
  };
}

export async function logSecurityCommandSequenceSaved(input: {
  commands: string[];
  commandCount: number;
  primaryCommand?: string;
}): Promise<AuditLogEntry[]> {
  const cleanCommands = Array.isArray(input.commands)
    ? input.commands.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  await persistSecurityLog({
    action: "SECURITY_COMMAND_SEQUENCE_SAVED",
    targetType: "security_command_sequence",
    targetId: "kingdom-security-sequence",
    message: `Saved security command sequence with ${cleanCommands.length} active command${cleanCommands.length === 1 ? "" : "s"}.`,
    meta: {
      commands: cleanCommands,
      commandCount: Number(input.commandCount || cleanCommands.length || 1),
      primaryCommand: String(input.primaryCommand || cleanCommands[0] || ""),
    },
  });

  return getSecurityLogs({ limit: 50 });
}

export async function logSecurityCommandLockStateChanged(input: {
  commandId: string;
  label: string;
  value?: string;
  locked: boolean;
  orderIndex?: number;
}): Promise<AuditLogEntry[]> {
  await persistSecurityLog({
    action: input.locked ? "SECURITY_COMMAND_LOCKED" : "SECURITY_COMMAND_UNLOCKED",
    targetType: "security_command",
    targetId: String(input.commandId || ""),
    message: `${input.locked ? "Locked" : "Unlocked"} ${String(input.label || "command")}.`,
    meta: {
      commandId: String(input.commandId || ""),
      label: String(input.label || ""),
      value: String(input.value || ""),
      locked: Boolean(input.locked),
      orderIndex: typeof input.orderIndex === "number" ? input.orderIndex : undefined,
    },
  });

  return getSecurityLogs({ limit: 50 });
}


export async function getTrustedDevices(): Promise<TrustedDeviceEntry[]> {
  try {
    const j = await apiGet<any>("/api/church/security/devices", {
      headers: authHeaders(),
    });
    const normalized = normalizeTrustedDevices(j?.data);
    trustedDeviceCache = normalized.map((item) => ({ ...item }));
    return trustedDeviceCache;
  } catch {
    return trustedDeviceCache.map((item) => ({ ...item }));
  }
}

export async function revokeTrustedDevice(deviceId: string): Promise<TrustedDeviceEntry[]> {
  const current = await getTrustedDevices();
  const target = current.find((item) => item.id === deviceId);
  if (!target) return current;

  try {
    const j = await apiPatch<any>(
      "/api/church/security/devices",
      { id: deviceId, action: "revoke" },
      { headers: authHeaders() }
    );
    trustedDeviceCache = normalizeTrustedDevices(j?.data).map((item) => ({ ...item }));
  } catch {
    trustedDeviceCache = current.map((item) =>
      item.id === deviceId ? { ...item, trusted: false, risk: "high" } : item
    );
  }

  await persistSecurityLog({
    action: "SECURITY_DEVICE_REVOKED",
    targetId: target.id,
    targetType: "trusted_device",
    message: `Revoked trusted device ${target.label}.`,
    meta: {
      deviceId: target.id,
      label: target.label,
      device: target.device,
      ownerName: target.ownerName,
      ownerRole: target.ownerRole,
      trusted: false,
    },
    ip: target.ip,
  });

  return trustedDeviceCache.map((item) => ({ ...item }));
}

export async function addTrustedDevice(input?: Partial<TrustedDeviceEntry>): Promise<TrustedDeviceEntry[]> {
  const payload: TrustedDeviceEntry = {
    id: String(input?.id || `dev-${Date.now()}`),
    label: String(input?.label || "New Trusted Device"),
    device: String(input?.device || "Secure Endpoint"),
    deviceType:
      input?.deviceType === "phone" || input?.deviceType === "tablet" || input?.deviceType === "desktop" || input?.deviceType === "browser"
        ? input.deviceType
        : "phone",
    ownerName: String(input?.ownerName || "Prince Fariji"),
    ownerRole: String(input?.ownerRole || "Church_Admin"),
    location: String(input?.location || "Fort Worth, TX"),
    ip: input?.ip ? String(input.ip) : undefined,
    trusted: typeof input?.trusted === "boolean" ? input.trusted : true,
    current: typeof input?.current === "boolean" ? input.current : false,
    risk:
      input?.risk === "high" || input?.risk == "medium" || input?.risk === "low"
        ? input.risk
        : "low",
    addedAt: String(input?.addedAt || "Just now"),
    lastSeenAt: String(input?.lastSeenAt || "Just now"),
    os: input?.os ? String(input.os) : undefined,
  };

  try {
    const j = await apiPost<any>(
      "/api/church/security/devices",
      payload,
      { headers: authHeaders() }
    );
    trustedDeviceCache = normalizeTrustedDevices(j?.data).map((item) => ({ ...item }));
  } catch {
    trustedDeviceCache = [payload, ...trustedDeviceCache].slice(0, 100);
  }

  await persistSecurityLog({
    action: "SECURITY_DEVICE_ADDED",
    targetId: payload.id,
    targetType: "trusted_device",
    message: `Added trusted device ${payload.label}.`,
    meta: {
      deviceId: payload.id,
      label: payload.label,
      device: payload.device,
      ownerName: payload.ownerName,
      ownerRole: payload.ownerRole,
      trusted: payload.trusted,
    },
    ip: payload.ip,
  });

  return trustedDeviceCache.map((item) => ({ ...item }));
}

export async function runTrustedDeviceScan(targetId?: string): Promise<TrustedDeviceEntry[]> {
  const current = await getTrustedDevices();

  try {
    const j = await apiPost<any>(
      "/api/church/security/devices/scan",
      targetId ? { id: targetId } : {},
      { headers: authHeaders() }
    );

    const normalized = normalizeTrustedDevices(j?.data).map((item) => ({ ...item }));

    if (normalized.length > 0) {
      if (targetId) {
        const targetMap = new Map(normalized.map((item) => [item.id, { ...item }]));
        trustedDeviceCache = current.map((item) =>
          item.id === targetId && targetMap.has(item.id)
            ? { ...(targetMap.get(item.id) as TrustedDeviceEntry) }
            : { ...item }
        );
      } else {
        trustedDeviceCache = normalized;
      }
    } else {
      trustedDeviceCache = simulateTrustedDeviceScan(current, targetId);
    }
  } catch {
    trustedDeviceCache = simulateTrustedDeviceScan(current, targetId);
  }

  const scope = targetId
    ? trustedDeviceCache.filter((item) => item.id === targetId)
    : trustedDeviceCache;

  await persistSecurityLog({
    action: "SECURITY_DEVICE_SCAN_RAN",
    targetId: targetId || "trusted-devices",
    targetType: "trusted_device_scan",
    message: targetId
      ? `Ran trusted device scan for 1 device.`
      : `Ran trusted device scan for ${trustedDeviceCache.length} device${trustedDeviceCache.length === 1 ? "" : "s"}.`,
    meta: {
      scanMode: targetId ? "single" : "all",
      totalDevices: scope.length,
      trustedCount: scope.filter((item) => item.trusted).length,
      untrustedCount: scope.filter((item) => !item.trusted).length,
      riskyCount: scope.filter((item) => item.risk === "high" || item.trusted === false).length,
      scanCount: trustedDeviceScanCount,
      targetId: targetId || undefined,
    },
  });

  return trustedDeviceCache.map((item) => ({ ...item }));
}

export async function getTrustPolicy(): Promise<TrustPolicy> {
  return { ...trustPolicyCache };
}

export async function updateTrustPolicy(input: Partial<TrustPolicy>): Promise<TrustPolicy> {
  const next: TrustPolicy = {
    mode:
      input.mode === "strict" || input.mode === "balanced" || input.mode === "open"
        ? input.mode
        : trustPolicyCache.mode,
    allowUnknownLocation:
      typeof input.allowUnknownLocation === "boolean"
        ? input.allowUnknownLocation
        : trustPolicyCache.allowUnknownLocation,
    requireManualApproval:
      typeof input.requireManualApproval === "boolean"
        ? input.requireManualApproval
        : trustPolicyCache.requireManualApproval,
    autoExpireDays:
      typeof input.autoExpireDays === "number"
        ? input.autoExpireDays
        : trustPolicyCache.autoExpireDays,
  };

  try {
    await apiPatch<any>(
      "/api/church/security/device-policy",
      next,
      { headers: authHeaders() }
    );
  } catch {
    
  }

  trustPolicyCache = { ...next };

  await persistSecurityLog({
    action: "SECURITY_TRUST_POLICY_UPDATED",
    targetId: "trust-policy",
    targetType: "trust_policy",
    message: `Updated trust policy to ${trustPolicyCache.mode} mode.`,
    meta: { ...trustPolicyCache },
  });

  return { ...trustPolicyCache };
}

export function countTrustedDeviceStats(items: TrustedDeviceEntry[]) {
  return {
    totalCount: items.length,
    trustedCount: items.filter((item) => item.trusted).length,
    riskyCount: items.filter((item) => item.risk === "high" || item.trusted === false).length,
    currentCount: items.filter((item) => item.current).length,
  };
}

