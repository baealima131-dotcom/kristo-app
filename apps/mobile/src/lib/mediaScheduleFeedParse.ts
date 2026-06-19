export type MediaScheduleFeedSync = {
  rows: any[];
  mediaScheduleVersion: number;
  mediaScheduleUpdatedAt: string;
};

export function parseChurchFeedListResponse(res: any): MediaScheduleFeedSync {
  const mediaScheduleVersion = Number(res?.mediaScheduleVersion ?? 0);
  const mediaScheduleUpdatedAt = String(res?.mediaScheduleUpdatedAt ?? "");

  const rows = Array.isArray(res?.data?.items)
    ? res.data.items
    : Array.isArray(res?.items)
      ? res.items
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
          ? res
          : [];

  return { rows, mediaScheduleVersion, mediaScheduleUpdatedAt };
}
