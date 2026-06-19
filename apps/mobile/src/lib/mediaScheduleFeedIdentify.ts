type AnyFeedItem = Record<string, any>;

export function isMediaScheduleFeedItem(item: AnyFeedItem | null | undefined): boolean {
  if (!item || typeof item !== "object") return false;

  const source = String(item.source || "").toLowerCase();
  const scheduleType = String(item.scheduleType || "").toLowerCase();

  return source.includes("media-schedule") || scheduleType === "media-live-slots";
}

export function isMediaScheduleFeedItemClosed(item: AnyFeedItem): boolean {
  if (item?.deletedAt) return true;
  if (item?.pendingBackendFailed === true) return true;

  const status = String(item?.status || "").toLowerCase();
  const scheduleStatus = String(item?.scheduleStatus || "").toLowerCase();
  const deleted = item?.deleted === true || status === "deleted" || scheduleStatus === "deleted";
  const cancelled = status === "cancelled" || status === "canceled";
  const completed =
    status === "completed" ||
    status === "closed" ||
    status === "ended" ||
    status === "complete" ||
    status === "cleared" ||
    scheduleStatus === "ended" ||
    scheduleStatus === "closed" ||
    scheduleStatus === "cleared";

  return deleted || cancelled || completed;
}
