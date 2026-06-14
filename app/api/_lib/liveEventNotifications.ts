import {
  getStoredMediaHosts,
  resolveActualChurchPastorUserId,
} from "@/app/api/_lib/churchMediaAccess";
import { createNotification } from "@/app/api/_lib/notifications";

function liveScheduledPastorId(postId: string, pastorUserId: string) {
  return `ntf_live_sched_pastor_${postId}_${pastorUserId}`;
}

function liveScheduledHostId(postId: string, hostUserId: string) {
  return `ntf_live_sched_host_${postId}_${hostUserId}`;
}

function liveSlotAssignedId(postId: string, slotId: string, userId: string) {
  return `ntf_live_slot_assigned_${postId}_${slotId}_${userId}`;
}

function liveSlotCancelledId(postId: string, slotId: string, userId: string) {
  return `ntf_live_slot_cancelled_${postId}_${slotId}_${userId}`;
}

function slotClaimedUserId(slot: unknown): string {
  return String(
    (slot as any)?.claimedByUserId ||
      (slot as any)?.claimedBy?.userId ||
      (slot as any)?.hostUserId ||
      (slot as any)?.assignedUserId ||
      ""
  ).trim();
}

function slotId(slot: unknown): string {
  return String((slot as any)?.id || "").trim();
}

function slotLabel(slot: unknown): string {
  const name = String((slot as any)?.name || (slot as any)?.slotLabel || "Live slot").trim();
  const time = String((slot as any)?.timeLabel || (slot as any)?.startTime || "").trim();
  return time ? `${name} (${time})` : name;
}

function scheduleTitle(item: unknown, fallback = "Live event"): string {
  const title = String((item as any)?.title || (item as any)?.text || "").trim();
  return title || fallback;
}

function parseHostIdsFromFeedItem(item: unknown): string[] {
  const raw = (item as any)?.mediaHostIds ?? (item as any)?.hostIds;
  if (Array.isArray(raw)) {
    return raw.map((id) => String(id || "").trim()).filter(Boolean);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id || "").trim()).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return text
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isFutureLiveScheduleItem(item: unknown): boolean {
  const slots = Array.isArray((item as any)?.scheduleSlots) ? (item as any).scheduleSlots : [];
  if (!slots.length) return true;

  const now = Date.now();
  return slots.some((slot: any) => {
    const startMs = Number(slot?.startMs || 0);
    if (Number.isFinite(startMs) && startMs > now) return true;
    const startsAt = Date.parse(String(slot?.startsAt || ""));
    if (Number.isFinite(startsAt) && startsAt > now) return true;
    return false;
  });
}

async function resolveLiveEventHostUserIds(
  churchId: string,
  item: unknown
): Promise<string[]> {
  const cid = String(churchId || "").trim();
  const ids = new Set<string>();

  for (const hostId of parseHostIdsFromFeedItem(item)) ids.add(hostId);

  if (cid) {
    const storedHosts = await getStoredMediaHosts(cid);
    for (const host of storedHosts) {
      const userId = String(host.userId || "").trim();
      if (userId) ids.add(userId);
    }
  }

  const slots = Array.isArray((item as any)?.scheduleSlots) ? (item as any).scheduleSlots : [];
  for (const slot of slots) {
    const userId = slotClaimedUserId(slot);
    if (userId) ids.add(userId);
  }

  return [...ids];
}

export async function notifyLiveEventScheduled(args: {
  churchId: string;
  postId: string;
  feedItem: unknown;
  editorUserId?: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  if (!churchId || !postId) return 0;
  if (!isFutureLiveScheduleItem(args.feedItem)) return 0;

  const pastorUserId = await resolveActualChurchPastorUserId(churchId);
  const hostUserIds = await resolveLiveEventHostUserIds(churchId, args.feedItem);
  const editorUserId = String(args.editorUserId || "").trim();
  const label = scheduleTitle(args.feedItem);
  const firstSlot = Array.isArray((args.feedItem as any)?.scheduleSlots)
    ? (args.feedItem as any).scheduleSlots[0]
    : null;
  const when = firstSlot ? slotLabel(firstSlot) : label;
  const body = `A live event was scheduled: ${when}.`;

  let sent = 0;

  if (pastorUserId) {
    await createNotification({
      id: liveScheduledPastorId(postId, pastorUserId),
      churchId,
      type: "LiveEventScheduled",
      title: "Live event scheduled",
      message: body,
      targetUserId: pastorUserId,
    });
    sent += 1;
  }

  for (const hostUserId of hostUserIds) {
    if (!hostUserId || hostUserId === pastorUserId) continue;
    if (editorUserId && hostUserId === editorUserId && hostUserId !== pastorUserId) continue;

    await createNotification({
      id: liveScheduledHostId(postId, hostUserId),
      churchId,
      type: "LiveEventScheduled",
      title: "Live event scheduled",
      message: body,
      targetUserId: hostUserId,
    });
    sent += 1;
  }

  return sent;
}

export async function notifyLiveSlotAssigned(args: {
  churchId: string;
  postId: string;
  slotId: string;
  assignedUserId: string;
  slot?: unknown;
  feedItem?: unknown;
  assignerUserId?: string;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  const slotIdValue = String(args.slotId || "").trim();
  const assignedUserId = String(args.assignedUserId || "").trim();
  const assignerUserId = String(args.assignerUserId || "").trim();

  if (!churchId || !postId || !slotIdValue || !assignedUserId) return false;
  if (assignerUserId && assignerUserId === assignedUserId) return false;

  const label = slotLabel(args.slot);
  const eventTitle = scheduleTitle(args.feedItem);

  await createNotification({
    id: liveSlotAssignedId(postId, slotIdValue, assignedUserId),
    churchId,
    type: "LiveSlotAssigned",
    title: "You were assigned a live slot",
    message: `You were assigned to ${label} for ${eventTitle}.`,
    targetUserId: assignedUserId,
    actorUserId: assignerUserId || undefined,
  });

  return true;
}

export async function notifyLiveSlotCancelled(args: {
  churchId: string;
  postId: string;
  slotId: string;
  previousUserId: string;
  slot?: unknown;
  feedItem?: unknown;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const postId = String(args.postId || "").trim();
  const slotIdValue = String(args.slotId || "").trim();
  const previousUserId = String(args.previousUserId || "").trim();

  if (!churchId || !postId || !slotIdValue || !previousUserId) return false;

  const label = slotLabel(args.slot);
  const eventTitle = scheduleTitle(args.feedItem);

  await createNotification({
    id: liveSlotCancelledId(postId, slotIdValue, previousUserId),
    churchId,
    type: "LiveSlotCancelled",
    title: "Your live slot was cancelled",
    message: `Your assignment for ${label} in ${eventTitle} was cancelled.`,
    targetUserId: previousUserId,
  });

  return true;
}

export type LiveSlotAssignmentDiff = {
  assigned: Array<{ slotId: string; userId: string; slot: any }>;
  cancelled: Array<{ slotId: string; userId: string; slot: any }>;
};

export function diffLiveSlotAssignments(
  previousSlots: unknown[],
  nextSlots: unknown[]
): LiveSlotAssignmentDiff {
  const prevById = new Map<string, any>();
  for (const slot of previousSlots) {
    const id = slotId(slot);
    if (id) prevById.set(id, slot);
  }

  const assigned: LiveSlotAssignmentDiff["assigned"] = [];
  const cancelled: LiveSlotAssignmentDiff["cancelled"] = [];

  const seenIds = new Set<string>();

  for (const slot of nextSlots) {
    const id = slotId(slot);
    if (!id) continue;
    seenIds.add(id);

    const prev = prevById.get(id);
    const prevUser = prev ? slotClaimedUserId(prev) : "";
    const nextUser = slotClaimedUserId(slot);

    if (!prevUser && nextUser) {
      assigned.push({ slotId: id, userId: nextUser, slot });
    } else if (prevUser && !nextUser) {
      cancelled.push({ slotId: id, userId: prevUser, slot: prev || slot });
    } else if (prevUser && nextUser && prevUser !== nextUser) {
      cancelled.push({ slotId: id, userId: prevUser, slot: prev || slot });
      assigned.push({ slotId: id, userId: nextUser, slot });
    }
  }

  for (const [id, prev] of prevById.entries()) {
    if (seenIds.has(id)) continue;
    const prevUser = slotClaimedUserId(prev);
    if (prevUser) cancelled.push({ slotId: id, userId: prevUser, slot: prev });
  }

  return { assigned, cancelled };
}

export async function notifyLiveSlotAssignmentDiff(args: {
  churchId: string;
  postId: string;
  feedItem: unknown;
  previousSlots: unknown[];
  nextSlots: unknown[];
  assignerUserId?: string;
}): Promise<{ assigned: number; cancelled: number }> {
  const diff = diffLiveSlotAssignments(args.previousSlots, args.nextSlots);
  let assigned = 0;
  let cancelled = 0;

  for (const row of diff.cancelled) {
    const ok = await notifyLiveSlotCancelled({
      churchId: args.churchId,
      postId: args.postId,
      slotId: row.slotId,
      previousUserId: row.userId,
      slot: row.slot,
      feedItem: args.feedItem,
    });
    if (ok) cancelled += 1;
  }

  for (const row of diff.assigned) {
    const ok = await notifyLiveSlotAssigned({
      churchId: args.churchId,
      postId: args.postId,
      slotId: row.slotId,
      assignedUserId: row.userId,
      slot: row.slot,
      feedItem: args.feedItem,
      assignerUserId: args.assignerUserId,
    });
    if (ok) assigned += 1;
  }

  return { assigned, cancelled };
}
