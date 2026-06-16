import { DeviceEventEmitter } from "react-native";
import { baseFeedId, collectScheduleAliasIds } from "@/src/lib/scheduleSlotUtils";

export const KRISTO_SCHEDULE_FEED_DELETED = "kristo:schedule-feed-deleted";

export type ScheduleFeedDeletedPayload = {
  feedId: string;
  churchId?: string;
  aliases: string[];
  reason?: string;
  updatedAt?: number;
};

const deletedScheduleAliasSet = new Set<string>();

function rememberDeletedId(value: string) {
  const id = String(value || "").trim();
  if (!id) return;
  deletedScheduleAliasSet.add(id);
  const canon = baseFeedId(id);
  if (canon) deletedScheduleAliasSet.add(canon);
}

export function markScheduleFeedIdsDeleted(ids: string[]) {
  for (const id of ids) rememberDeletedId(id);
}

export function markScheduleFeedDeleted(feedId: string, rows: any[] = []) {
  const seed = String(feedId || "").trim();
  if (!seed) return;
  rememberDeletedId(seed);
  for (const alias of collectScheduleAliasIds(seed, rows)) {
    rememberDeletedId(alias);
  }
}

export function resolveScheduleFeedIdFromAnyId(value: unknown): string {
  const id = String(value || "").trim();
  if (!id) return "";
  const slotIdx = id.indexOf(":slot:");
  const seed = slotIdx >= 0 ? id.slice(0, slotIdx) : id;
  return baseFeedId(seed) || seed;
}

export function isScheduleFeedIdDeleted(feedId: unknown): boolean {
  const id = String(feedId || "").trim();
  if (!id) return false;
  const canon = resolveScheduleFeedIdFromAnyId(id);
  return (
    deletedScheduleAliasSet.has(id) ||
    (canon ? deletedScheduleAliasSet.has(canon) : false)
  );
}

export function emitScheduleFeedDeleted(payload: ScheduleFeedDeletedPayload) {
  const event: ScheduleFeedDeletedPayload = {
    ...payload,
    aliases: Array.isArray(payload.aliases) ? payload.aliases : [],
    updatedAt: payload.updatedAt ?? Date.now(),
  };
  DeviceEventEmitter.emit(KRISTO_SCHEDULE_FEED_DELETED, event);
}

export function onScheduleFeedDeleted(listener: (payload: ScheduleFeedDeletedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_SCHEDULE_FEED_DELETED, listener);
  return () => sub.remove();
}

export function scheduleFeedRowIsDeleted(row: any): boolean {
  if (!row || typeof row !== "object") return false;
  const candidates = [
    row?.id,
    row?.sourceScheduleId,
    row?.liveScheduleFeedId,
    row?.scheduleFeedId,
    row?.parentScheduleId,
    row?.liveId,
    row?.feedId,
  ];
  return candidates.some((value) => isScheduleFeedIdDeleted(value));
}

export function filterOutDeletedScheduleRows<T>(rows: T[]): T[] {
  return (Array.isArray(rows) ? rows : []).filter((row) => !scheduleFeedRowIsDeleted(row));
}

export function getDeletedScheduleFeedIds(): string[] {
  return Array.from(deletedScheduleAliasSet);
}
