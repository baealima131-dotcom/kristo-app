import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

export function feedRenderKey(item: any) {
  const recycleKey = String(item?.homeFeedRecycleKey || "").trim();
  if (recycleKey) return recycleKey;
  const id = String(item?.id || item?.feedOriginId || "").trim();
  if (item?.homeFeedSlotExpanded || /:slot:\d+/i.test(id)) return id;
  return baseFeedId(id);
}
