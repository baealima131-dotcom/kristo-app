import { baseFeedId, collectScheduleAliasIds } from "@/src/lib/scheduleSlotUtils";

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

export function isScheduleFeedIdDeleted(feedId: unknown): boolean {
  const id = String(feedId || "").trim();
  if (!id) return false;
  const canon = baseFeedId(id);
  return deletedScheduleAliasSet.has(id) || (canon ? deletedScheduleAliasSet.has(canon) : false);
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
