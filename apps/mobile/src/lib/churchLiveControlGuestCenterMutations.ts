import { apiPatch, getApiBase } from "@/src/lib/kristoApi";
import {
  CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
  loadChurchLiveControlGuestCenterScheduleRow,
} from "@/src/lib/churchLiveControlSchedule";
import { broadcastChurchLiveControlRoomSync } from "@/src/lib/churchLiveControlRoomSync";
import { materializeMediaSlotTimeFields } from "@/src/lib/mediaScheduleSlotTimes";
import { logClaimOverwriteBlocked } from "@/src/lib/scheduleSlotClaimRequest";
import { applyScheduleDeleteToLocalRoom } from "@/src/lib/scheduleRoomMessageSync";

export type GuestClaimCenterRoomMutationAction =
  | "delete_all"
  | "delete_slot"
  | "adjust_time"
  | "move_up"
  | "move_down"
  | "add"
  | "reject"
  | "remove";

export function isGuestCenterChurchLiveControlRoomSource(source: string): boolean {
  return String(source || "") === "church-live-control-room";
}

export function logGuestClaimCenterRoomMutation(input: {
  action: GuestClaimCenterRoomMutationAction;
  source: "church-live-control-room";
  affectedMessageIds: string[];
  ok: boolean;
  error?: string | null;
  extra?: Record<string, unknown>;
}) {
  console.log("KRISTO_GUEST_CLAIM_CENTER_ROOM_MUTATION", {
    action: input.action,
    source: input.source,
    affectedMessageIds: input.affectedMessageIds,
    ok: input.ok,
    error: input.error || null,
    ...(input.extra || {}),
  });
}

export function resolveChurchLiveControlGuestCenterSlotCardId(slot: any): string {
  return String(slot?.id || slot?.cardId || "").trim();
}

export function resolveChurchLiveControlGuestCenterSlotMessageId(slot: any): string {
  return String(slot?.roomMessageId || "").trim();
}

function assertGuestCenterSlotClaimable(input: {
  slot: any;
  incomingUserId: string;
  slotId?: string;
  source: string;
}): { ok: true } | { ok: false; error: string } {
  const existing = String(input.slot?.claimedByUserId || input.slot?.claimedBy?.userId || "").trim();
  const incoming = String(input.incomingUserId || "").trim();
  if (existing && incoming && existing !== incoming) {
    logClaimOverwriteBlocked({
      slotId: input.slotId || resolveChurchLiveControlGuestCenterSlotCardId(input.slot),
      existingClaimedByUserId: existing,
      incomingUserId: incoming,
      source: input.source,
    });
    return { ok: false, error: "slot_already_claimed" };
  }
  return { ok: true };
}

function clearClaimFieldsForRoomPatch(slot: any) {
  const next = { ...slot };
  delete next.claimed;
  delete next.isClaimed;
  delete next.claimedByUserId;
  delete next.claimedByName;
  delete next.claimedByAvatar;
  delete next.claimedByAvatarUri;
  delete next.claimedByPhotoUrl;
  delete next.claimedAt;
  delete next.approvedAt;
  delete next.claimStatus;
  delete next.claimedBy;
  next.status = "open";
  next.approved = false;
  next.locked = false;
  return next;
}

export function buildChurchLiveControlRoomCardPatchFromSlot(slot: any): Record<string, unknown> {
  const materialized = materializeMediaSlotTimeFields({ ...slot });
  return {
    title: String(materialized?.name || materialized?.title || ""),
    durationMin: Number(materialized?.durationMin || 0),
    durationMinutes: Number(materialized?.durationMinutes || materialized?.durationMin || 0),
    startTime: String(materialized?.startTime || ""),
    endTime: String(materialized?.endTime || ""),
    timeLabel: String(materialized?.timeLabel || ""),
    meetingDate: String(materialized?.meetingDate || ""),
    meetingDay: String(materialized?.meetingDay || materialized?.meetingDate || ""),
    meetingEndDate: String(materialized?.meetingEndDate || ""),
    startMs: Number(materialized?.startMs || 0) || undefined,
    endMs: Number(materialized?.endMs || 0) || undefined,
    startsAt: String(materialized?.startsAt || ""),
    endsAt: String(materialized?.endsAt || ""),
    slotNumber: Number(materialized?.slotNumber || materialized?.order || 0) || undefined,
    order: Number(materialized?.order || materialized?.slotNumber || 0) || undefined,
    claimedByUserId: String(materialized?.claimedByUserId || ""),
    claimedByName: String(materialized?.claimedByName || ""),
    claimedByAvatar: String(materialized?.claimedByAvatar || ""),
    claimedByRole: String(materialized?.claimedByRole || ""),
    claimedAt: String(materialized?.claimedAt || ""),
    status: String(materialized?.status || "open"),
    approved: Boolean(materialized?.approved),
    locked: Boolean(materialized?.locked),
  };
}

async function deleteRoomAssignmentCards(
  headers: Record<string, string>,
  body: { cardIds?: string[]; clearAllAssignmentCards?: boolean }
): Promise<{ ok: boolean; deleted: number; error: string | null }> {
  try {
    const res = await fetch(`${getApiBase()}/api/church/room-messages`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        roomId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
        ...body,
      }),
    });
    const parsed: any = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        deleted: 0,
        error: String(parsed?.error || `Request failed (${res.status})`),
      };
    }
    return {
      ok: parsed?.ok !== false,
      deleted: Number(parsed?.deleted || 0),
      error: parsed?.ok === false ? String(parsed?.error || "delete-failed") : null,
    };
  } catch (e: any) {
    return { ok: false, deleted: 0, error: String(e?.message || e) };
  }
}

async function patchRoomAssignmentCard(
  headers: Record<string, string>,
  opts: { messageId?: string; cardId: string; patch: Record<string, unknown> }
): Promise<{ ok: boolean; error: string | null }> {
  const res: any = await apiPatch(
    "/api/church/room-messages",
    {
      roomId: CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID,
      messageId: opts.messageId || undefined,
      cardId: opts.cardId,
      patch: opts.patch,
    },
    { headers: headers as any }
  );
  const ok = res?.ok !== false && !res?.error;
  return { ok, error: ok ? null : String(res?.error || "patch-failed") };
}

function invalidateChurchLiveControlRoomCaches(input: {
  churchId: string;
  userId?: string;
  cardIds?: string[];
  clearAllAssignmentCards?: boolean;
  reason: string;
  action: GuestClaimCenterRoomMutationAction;
  messageIds?: string[];
  purgeLocalCards?: boolean;
}) {
  const churchId = String(input.churchId || "").trim();
  const userId = String(input.userId || "").trim();

  if (input.purgeLocalCards) {
    applyScheduleDeleteToLocalRoom({
      reason: input.reason,
      churchId,
      userId,
      roomIds: [CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID],
      threadIds: [CHURCH_LIVE_CONTROL_SCHEDULE_ROOM_ID],
      cardIds: input.cardIds,
      clearAllAssignmentCards: input.clearAllAssignmentCards,
    });
  }

  broadcastChurchLiveControlRoomSync({
    action:
      input.action === "delete_all"
        ? "delete_all"
        : input.action === "remove" || input.action === "delete_slot"
          ? "delete"
          : input.action === "reject"
            ? "release"
            : input.action === "add"
              ? "claim"
              : "patch",
    churchId,
    userId,
    reason: input.reason,
    cardId: input.cardIds?.[0],
    messageId: input.messageIds?.[0],
  });
}

export async function reloadChurchLiveControlGuestCenterScheduleAfterMutation(input: {
  headers: Record<string, string>;
  churchId: string;
  churchName?: string;
  mediaName?: string;
  nowMs?: number;
}): Promise<any | null> {
  return loadChurchLiveControlGuestCenterScheduleRow(input.headers, {
    churchId: input.churchId,
    churchName: input.churchName,
    mediaName: input.mediaName,
    nowMs: input.nowMs,
  });
}

export async function mutateChurchLiveControlGuestCenterRoomSchedule(input: {
  action: GuestClaimCenterRoomMutationAction;
  headers: Record<string, string>;
  churchId: string;
  userId?: string;
  slotsToDelete?: any[];
  slotsToPatch?: any[];
  clearAll?: boolean;
  reloadOpts?: {
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  };
}): Promise<{
  ok: boolean;
  error: string | null;
  affectedMessageIds: string[];
  schedule: any | null;
}> {
  const action = input.action;
  const affectedMessageIds: string[] = [];

  if (action === "delete_all" || input.clearAll) {
    const del = await deleteRoomAssignmentCards(input.headers, {
      clearAllAssignmentCards: true,
    });

    logGuestClaimCenterRoomMutation({
      action: "delete_all",
      source: "church-live-control-room",
      affectedMessageIds,
      ok: del.ok,
      error: del.error,
      extra: { deleted: del.deleted },
    });

    if (!del.ok) {
      return { ok: false, error: del.error, affectedMessageIds, schedule: null };
    }

    invalidateChurchLiveControlRoomCaches({
      churchId: input.churchId,
      userId: input.userId,
      clearAllAssignmentCards: true,
      reason: "guest-claim-center-delete-all",
      action: "delete_all",
      purgeLocalCards: true,
    });

    const schedule = await reloadChurchLiveControlGuestCenterScheduleAfterMutation({
      headers: input.headers,
      churchId: input.churchId,
      ...input.reloadOpts,
    });

    return { ok: true, error: null, affectedMessageIds, schedule };
  }

  if (action === "delete_slot" || action === "remove") {
    const slots = Array.isArray(input.slotsToDelete) ? input.slotsToDelete : [];
    const cardIds = slots.map(resolveChurchLiveControlGuestCenterSlotCardId).filter(Boolean);
    for (const slot of slots) {
      const messageId = resolveChurchLiveControlGuestCenterSlotMessageId(slot);
      if (messageId) affectedMessageIds.push(messageId);
    }

    const del = await deleteRoomAssignmentCards(input.headers, { cardIds });

    logGuestClaimCenterRoomMutation({
      action: action === "remove" ? "remove" : "delete_slot",
      source: "church-live-control-room",
      affectedMessageIds,
      ok: del.ok,
      error: del.error,
      extra: { deleted: del.deleted, cardIds },
    });

    if (!del.ok) {
      return { ok: false, error: del.error, affectedMessageIds, schedule: null };
    }

    invalidateChurchLiveControlRoomCaches({
      churchId: input.churchId,
      userId: input.userId,
      cardIds,
      reason: `guest-claim-center-${action}`,
      action,
      messageIds: affectedMessageIds,
      purgeLocalCards: true,
    });

    const schedule = await reloadChurchLiveControlGuestCenterScheduleAfterMutation({
      headers: input.headers,
      churchId: input.churchId,
      ...input.reloadOpts,
    });

    return { ok: true, error: null, affectedMessageIds, schedule };
  }

  const slotsToPatch = Array.isArray(input.slotsToPatch) ? input.slotsToPatch : [];
  for (const slot of slotsToPatch) {
    const cardId = resolveChurchLiveControlGuestCenterSlotCardId(slot);
    const messageId = resolveChurchLiveControlGuestCenterSlotMessageId(slot);
    if (messageId) affectedMessageIds.push(messageId);
    if (!cardId) {
      const error = "missing-card-id";
      logGuestClaimCenterRoomMutation({
        action,
        source: "church-live-control-room",
        affectedMessageIds,
        ok: false,
        error,
      });
      return { ok: false, error, affectedMessageIds, schedule: null };
    }

    const patchSource = action === "reject" ? clearClaimFieldsForRoomPatch(slot) : slot;
    if (action !== "reject") {
      const incomingUserId = String(patchSource?.claimedByUserId || "").trim();
      if (incomingUserId) {
        const claimable = assertGuestCenterSlotClaimable({
          slot,
          incomingUserId,
          slotId: cardId,
          source: `churchLiveControlGuestCenterMutations.${action}`,
        });
        if (!claimable.ok) {
          logGuestClaimCenterRoomMutation({
            action,
            source: "church-live-control-room",
            affectedMessageIds,
            ok: false,
            error: claimable.error,
            extra: { cardId, messageId: messageId || null },
          });
          return { ok: false, error: claimable.error, affectedMessageIds, schedule: null };
        }
      }
    }
    const patch = buildChurchLiveControlRoomCardPatchFromSlot(patchSource);
    const patchRes = await patchRoomAssignmentCard(input.headers, {
      messageId: messageId || undefined,
      cardId,
      patch,
    });

    if (!patchRes.ok) {
      logGuestClaimCenterRoomMutation({
        action,
        source: "church-live-control-room",
        affectedMessageIds,
        ok: false,
        error: patchRes.error,
        extra: { cardId, messageId: messageId || null },
      });
      return { ok: false, error: patchRes.error, affectedMessageIds, schedule: null };
    }
  }

  logGuestClaimCenterRoomMutation({
    action,
    source: "church-live-control-room",
    affectedMessageIds,
    ok: true,
    error: null,
    extra: { patchedCount: slotsToPatch.length },
  });

  invalidateChurchLiveControlRoomCaches({
    churchId: input.churchId,
    userId: input.userId,
    reason: `guest-claim-center-${action}`,
    action,
    messageIds: affectedMessageIds,
    cardIds: slotsToPatch.map(resolveChurchLiveControlGuestCenterSlotCardId).filter(Boolean),
    purgeLocalCards: false,
  });

  const schedule = await reloadChurchLiveControlGuestCenterScheduleAfterMutation({
    headers: input.headers,
    churchId: input.churchId,
    ...input.reloadOpts,
  });

  return { ok: true, error: null, affectedMessageIds, schedule };
}

export async function assignChurchLiveControlRoomScheduleSlot(input: {
  slot: any;
  headers: Record<string, string>;
  churchId: string;
  userId?: string;
  assignee: {
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
  };
  reloadOpts?: {
    churchName?: string;
    mediaName?: string;
    nowMs?: number;
  };
}) {
  const assigneeId = String(input.assignee.userId || "").trim();
  const claimable = assertGuestCenterSlotClaimable({
    slot: input.slot,
    incomingUserId: assigneeId,
    source: "assignChurchLiveControlRoomScheduleSlot",
  });
  if (!claimable.ok) {
    return {
      ok: false,
      error: claimable.error,
      affectedMessageIds: [],
      schedule: null,
    };
  }

  const slot = {
    ...input.slot,
    claimedByUserId: assigneeId,
    claimedByName: String(input.assignee.name || "").trim(),
    claimedByAvatar: String(input.assignee.avatarUri || "").trim(),
    claimedByRole: String(input.assignee.role || "").trim(),
    claimedAt: new Date().toISOString(),
    status: "claimed",
  };

  return mutateChurchLiveControlGuestCenterRoomSchedule({
    action: "add",
    headers: input.headers,
    churchId: input.churchId,
    userId: input.userId,
    slotsToPatch: [slot],
    reloadOpts: input.reloadOpts,
  });
}
