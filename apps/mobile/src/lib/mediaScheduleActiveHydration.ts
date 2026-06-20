import { apiGet } from "@/src/lib/kristoApi";
import { feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import {
  prepareMediaScheduleFeedItemForClient,
} from "@/src/lib/mediaScheduleFeedPrepare";
import {
  resolveChurchMediaScheduleFromFeedRows,
  summarizeActiveMediaSchedule,
} from "@/src/lib/mediaScheduleChurchQueries";
import {
  deriveMediaSlotDurationMin,
  materializeMediaSlotTimeFields,
} from "@/src/lib/mediaScheduleSlotTimes";
import {
  normalizeMediaScheduleBackendItem,
  replaceLocalScheduleWithBackend,
} from "@/src/lib/mediaSchedulePendingSync";
import { saveChurchProjectMeetingPlan, saveChurchProjectScheduleSlots } from "@/src/store/churchProjectMcScheduleStore";

export function mapBackendScheduleSlotsToSpeakerSlots(
  feedItem: any,
  assignmentId: string,
  batchId?: string
) {
  const slots = Array.isArray(feedItem?.scheduleSlots) ? feedItem.scheduleSlots : [];
  const batch = batchId || `batch_backend_${String(feedItem?.id || Date.now())}`;
  const createdAt = Date.now();
  const feedId = String(feedItem?.id || feedItem?.sourceScheduleId || "").trim();

  return slots.map((slot: any, index: number) => {
    const prepared = materializeMediaSlotTimeFields(slot);
    const slotNumber = Number(prepared?.slot || prepared?.slotNumber || index + 1);
    return {
      ...prepared,
      id: String(prepared?.id || slot?.id || `slot-${index + 1}`),
      name: String(prepared?.name || prepared?.slotLabel || `Slot ${slotNumber}`),
      title: String(prepared?.title || prepared?.name || prepared?.slotLabel || `Slot ${slotNumber}`),
      minutes: Math.max(1, deriveMediaSlotDurationMin(prepared) || Number(prepared?.durationMin || 5)),
      startTime: String(prepared?.startTime || slot?.startTime || ""),
      endTime: String(prepared?.endTime || slot?.endTime || ""),
      timeLabel: String(prepared?.timeLabel || slot?.timeLabel || ""),
      meetingDate: String(prepared?.meetingDate || slot?.meetingDate || ""),
      meetingDay: String(prepared?.meetingDay || slot?.meetingDay || ""),
      task: String(prepared?.task || slot?.task || ""),
      script: String(prepared?.script || slot?.script || ""),
      slotTopic: String(prepared?.slotTopic || slot?.slotTopic || ""),
      scheduleTopic: String(feedItem?.scheduleTopic || feedItem?.topic || ""),
      parentTopic: String(feedItem?.topic || feedItem?.scheduleTopic || ""),
      role: String(prepared?.role || slot?.role || "Member"),
      roleLabel: String(prepared?.roleLabel || prepared?.role || slot?.roleLabel || "Member"),
      scheduleBatchId: batch,
      scheduleBatchCreatedAt: createdAt,
      backendFeedId: feedId,
      sourceScheduleId: feedId,
      order: slotNumber,
      slot: slotNumber,
      slotNumber,
    };
  });
}

export async function fetchFullMediaScheduleFeedItem(
  feedId: string,
  headers?: Record<string, string>
) {
  const id = String(feedId || "").trim();
  if (!id) return null;

  try {
    const res: any = await apiGet(`/api/church/feed?id=${encodeURIComponent(id)}`, {
      headers,
      cache: "no-store" as RequestCache,
    });
    return res?.data?.item || res?.item || res?.data || null;
  } catch (error) {
    console.log("KRISTO_ACTIVE_SCHEDULE_FETCH_ITEM_ERROR", {
      feedId: id,
      error: String((error as any)?.message || error),
    });
    return null;
  }
}

export async function hydrateActiveMediaScheduleFromBackend(input: {
  activeSchedule: any;
  churchId: string;
  localScheduleId?: string;
  headers?: Record<string, string>;
  assignmentId?: string;
  screen?: string;
  reason?: string;
}) {
  const churchId = String(input.churchId || "").trim();
  const summary = input.activeSchedule || null;
  const feedId = String(summary?.id || "").trim();
  if (!churchId || !feedId) return null;

  let fullItem = summary;
  const summarySlotCount = Array.isArray(summary?.scheduleSlots) ? summary.scheduleSlots.length : 0;
  if (!summarySlotCount) {
    const fetched = await fetchFullMediaScheduleFeedItem(feedId, input.headers);
    if (fetched) fullItem = fetched;
  }

  const normalized = normalizeMediaScheduleBackendItem(
    prepareMediaScheduleFeedItemForClient(fullItem),
    { churchId }
  );

  if (input.localScheduleId) {
    replaceLocalScheduleWithBackend(normalized, input.localScheduleId, { churchId });
  } else {
    feedSyncMediaScheduleFromBackend(normalized);
  }

  const speakerSlots = input.assignmentId
    ? mapBackendScheduleSlotsToSpeakerSlots(normalized, input.assignmentId)
    : [];

  if (input.assignmentId && speakerSlots.length) {
    saveChurchProjectScheduleSlots(input.assignmentId, speakerSlots);
    saveChurchProjectMeetingPlan(input.assignmentId, { sentToSchedule: true });
  }

  console.log("KRISTO_ACTIVE_SCHEDULE_HYDRATED", {
    screen: input.screen || null,
    reason: input.reason || null,
    feedId,
    churchId,
    slotCount: Array.isArray(normalized?.scheduleSlots) ? normalized.scheduleSlots.length : 0,
    speakerSlotCount: speakerSlots.length,
    summary: summarizeActiveMediaSchedule(normalized),
  });

  return normalized;
}

export function resolveBackendActiveScheduleFromFeedRows(
  rows: any[],
  churchId: string,
  nowMs = Date.now()
) {
  return resolveChurchMediaScheduleFromFeedRows(rows, churchId, {
    strictChurch: true,
    nowMs,
  });
}
