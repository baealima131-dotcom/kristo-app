import {
  extractLeadingActorUserId,
  isRawUserId,
  resolveActorIdentity,
  roleFallbackLabel,
  sanitizeActorInText,
  type ActorIdentity,
} from "@/app/api/_lib/notificationActor";

export type NotificationType =
  | "MinistryMemberAdded"
  | "MinistryMemberRemoved"
  | "MinistryLeaderAssigned"
  | "MinistryLeaderRemoved"
  | "MinistryMemberRoleChanged"
  | "MembershipRejected"
  | "ChurchProfileUpdated"
  | "Generic";

export type AppNotification = {
  id: string;
  churchId: string;

  type: NotificationType;
  title: string;
  message?: string;

  actorName?: string;
  actorUserId?: string;
  actorAvatarUri?: string;
  actorRole?: string;

  ministryId?: string;
  ministryMemberId?: string;
  targetUserId?: string;

  isRead: boolean;
  createdAt: string;
  readAt?: string;
};

export type ClientNotification = {
  id: string;
  churchId: string;
  type: NotificationType;
  title: string;
  body: string;
  message: string;
  actorName: string;
  actorUserId?: string;
  actorAvatarUri?: string;
  actorRole?: string;
  read: boolean;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
  ministryId?: string;
  ministryMemberId?: string;
  targetUserId?: string;
};

declare global {
  var __KRISTO_NOTIFS__: AppNotification[] | undefined;
}

function store(): AppNotification[] {
  if (!globalThis.__KRISTO_NOTIFS__) globalThis.__KRISTO_NOTIFS__ = [];
  return globalThis.__KRISTO_NOTIFS__;
}

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = "ntf") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

export function createNotification(input: Omit<AppNotification, "id" | "createdAt" | "isRead">): AppNotification {
  const n: AppNotification = {
    id: id(),
    createdAt: nowIso(),
    isRead: false,
    ...input,
  };
  store().push(n);
  return n;
}

export async function toClientNotification(n: AppNotification): Promise<ClientNotification> {
  let actorUserId = String(n.actorUserId || "").trim();
  let actorName = String(n.actorName || "").trim();
  let actorAvatarUri = String(n.actorAvatarUri || "").trim();
  let actorRole = String(n.actorRole || "").trim();
  const rawMessage = String(n.message || "");

  if (!actorUserId) {
    actorUserId = extractLeadingActorUserId(rawMessage);
  }

  if ((!actorName || isRawUserId(actorName)) && actorUserId) {
    const identity = await resolveActorIdentity(actorUserId);
    if (!actorName || isRawUserId(actorName)) {
      actorName = identity.name;
    }
    if (!actorAvatarUri) {
      actorAvatarUri = identity.avatar;
    }
  }

  if (!actorName || isRawUserId(actorName)) {
    const fallbackRole =
      actorRole ||
      (n.type === "ChurchProfileUpdated" ? "Church_Admin" : "");
    actorName = roleFallbackLabel(fallbackRole);
  }

  const body = sanitizeActorInText(rawMessage, actorUserId, actorName);

  return {
    id: n.id,
    churchId: n.churchId,
    type: n.type,
    title: String(n.title || "Notification"),
    body,
    message: body,
    actorName,
    actorUserId: actorUserId || undefined,
    actorAvatarUri: actorAvatarUri || undefined,
    actorRole: actorRole || undefined,
    read: !!n.isRead,
    isRead: !!n.isRead,
    createdAt: n.createdAt,
    readAt: n.readAt,
    ministryId: n.ministryId,
    ministryMemberId: n.ministryMemberId,
    targetUserId: n.targetUserId,
  };
}

export async function toClientNotifications(items: AppNotification[]): Promise<ClientNotification[]> {
  return Promise.all(items.map((n) => toClientNotification(n)));
}

export function listNotifications(args: {
  churchId: string;
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
  includeAllTargets?: boolean;
}) {
  const { churchId, userId, unreadOnly, limit = 50, includeAllTargets = false } = args;

  return store()
    .filter((n) => n.churchId === churchId)
    .filter((n) => includeAllTargets ? true : (!n.targetUserId || n.targetUserId === userId))
    .filter((n) => (unreadOnly ? !n.isRead : true))
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, Math.max(1, limit));
}

export function setRead(id: string, isRead: boolean): AppNotification | null {
  const n = store().find((x) => x.id === id);
  if (!n) return null;
  n.isRead = !!isRead;
  n.readAt = n.isRead ? nowIso() : undefined;
  return n;
}

export function removeNotification(id: string): AppNotification | null {
  const items = store();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return null;
  const removed = items[idx];
  items.splice(idx, 1);
  return removed;
}

// Back-compat alias (some routes still import addNotification)
export const addNotification = createNotification;

export function markAllRead(args: { churchId: string; userId: string; includeAllTargets?: boolean }) {
  const { churchId, userId, includeAllTargets = false } = args;

  const items = store()
    .filter((n) => n.churchId === churchId)
    .filter((n) => includeAllTargets ? true : (!n.targetUserId || n.targetUserId === userId));

  let updated = 0;
  for (const n of items) {
    if (!n.isRead) {
      n.isRead = true;
      n.readAt = nowIso();
      updated += 1;
    }
  }
  return { updated };
}

export type { ActorIdentity };
