import { evaluateLiveMediaAuthority } from "@/lib/liveMediaAuthority";
import {
  normalizeSlotScheduleEntries,
  readSlotClock,
  resolveActiveScheduleSlot,
} from "@/lib/liveSlotTransition";
import { getStoredMediaHosts } from "@/app/api/_lib/churchMediaAccess";
import { canCreateOrEditScheduleSlots, isPastorAppRole } from "@/app/api/_lib/ministryAuthority";
import { readRoomMessagesJsonFile } from "@/app/api/_lib/store/roomMessageDb";
import { getFeedItemById } from "@/app/api/_lib/store/feedDb";
import { isSuspendedForChurchLive } from "@/app/api/_lib/churchLiveControlSuspension";

/**
 * Server-side authority for church live sessions, shared by /api/church/live and the LiveKit
 * token route. All inputs are verified (session token + active membership) by the callers.
 */

/** Church roles that manage Church Live Control schedules (as live-control-members PATCH). */
export const LIVE_SCHEDULE_MANAGER_ROLES = new Set(["Pastor", "Church_Admin", "Leader", "System_Admin"]);

/**
 * Live moderator: the church's pastor-level role (from the verified membership) or the live's
 * recorded owner, schedule creator or media host. There is no header-based co-host role any more;
 * MC hosts (mc-hosts.json) are not moderators.
 */
export function canModerateLive(
  auth: { userId: string; role: string },
  live: {
    pastorUserId?: string;
    actualChurchPastorUserId?: string;
    scheduleCreatedByUserId?: string;
    mediaHostIds?: string | string[];
  }
) {
  if (isPastorAppRole(auth.role)) return true;

  const authority = evaluateLiveMediaAuthority({
    currentUserId: auth.userId,
    actualChurchPastorUserId: live.actualChurchPastorUserId,
    scheduleCreatedByUserId: live.scheduleCreatedByUserId,
    mediaHostIds: live.mediaHostIds,
  });

  return authority.isMediaOwnerHost;
}

export function ministryRoomIdFromLiveId(liveId: string) {
  const lid = String(liveId || "").trim();
  return lid.startsWith("ministry_") ? lid.slice("ministry_".length).trim() : "";
}

/**
 * May write the server slot schedule and open/revive sessions: schedule-manager roles, live
 * moderators, church media hosts, and for a ministry live the ministry Leader/Assistant/Host.
 * Church Live Control suspension overrides all of these (including media host) for church lives.
 */
export async function canDriveLiveSchedule(
  a: { userId: string; role: string; churchId: string },
  live: any,
  liveId: string
) {
  if (await isSuspendedForChurchLive(a.churchId, a.userId, liveId)) return false;
  if (LIVE_SCHEDULE_MANAGER_ROLES.has(a.role) || canModerateLive(a, live || {})) return true;
  const hosts = await getStoredMediaHosts(a.churchId).catch(() => []);
  if (hosts.some((host) => host.userId === a.userId)) return true;
  const ministryRoomId = ministryRoomIdFromLiveId(liveId);
  if (!ministryRoomId) return false;
  return canCreateOrEditScheduleSlots({
    churchId: a.churchId,
    viewerUserId: a.userId,
    viewerAppRole: a.role,
    ministryId: ministryRoomId,
  });
}

/**
 * Server record of a schedule in this church: its slot cards (room messages), a church feed
 * schedule with this id, or the ministry room of a ministry live.
 */
export async function readChurchSchedule(churchId: string, liveId: string) {
  const lid = String(liveId || "").trim();
  const rooms = await readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {}).catch(
    () => ({} as Record<string, any[]>)
  );
  const ministryRoomId = ministryRoomIdFromLiveId(lid);
  const cards: any[] = [];
  let roomExists = false;
  for (const [key, rows] of Object.entries(rooms || {})) {
    if (!key.startsWith(`${churchId}::`) || !Array.isArray(rows)) continue;
    const roomId = key.slice(churchId.length + 2);
    if (ministryRoomId && roomId === ministryRoomId) roomExists = true;
    for (const m of rows) {
      if (String(m?.kind || "") !== "assignment_card") continue;
      const card = m?.card || {};
      const sameSchedule =
        String(card.sourceScheduleId || "") === lid || String(card.sourceFeedId || "") === lid;
      if (sameSchedule || (ministryRoomId && roomId === ministryRoomId)) cards.push(card);
    }
  }
  let known = cards.length > 0 || roomExists;
  if (!known && lid) {
    const feedItem: any = await getFeedItemById(lid).catch(() => null);
    known = String(feedItem?.churchId || "") === churchId;
  }
  return { known, cards };
}

/** Owner of the slot that is active now according to the server's own schedule/clock. */
export function isServerActiveSlotOwner(live: any, userId: string, nowMs: number) {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  if (String(readSlotClock(live)?.activeOwnerUserId || "").trim() === uid) return true;
  const active = resolveActiveScheduleSlot(normalizeSlotScheduleEntries(live?.slotSchedule?.slots), nowMs);
  return String(active?.ownerUserId || "").trim() === uid;
}
