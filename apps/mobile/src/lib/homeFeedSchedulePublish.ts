import { apiPost } from "@/src/lib/kristoApi";
import { feedPublishMediaScheduleLocal } from "@/src/lib/homeFeedStore";
import {
  logHomeFeedScheduleCreated,
} from "@/src/lib/homeFeedScheduleLifecycle";
import {
  buildPersistedMediaSlotTimeFields,
  logMediaSlotPayloadTime,
} from "@/src/lib/mediaScheduleSlotTimes";
import {
  ACTIVE_MEDIA_SCHEDULE_ERROR,
  findActiveMediaScheduleForChurchFromSources,
} from "@/src/lib/mediaScheduleLock";
import {
  clearLocalSchedulePendingBackend,
  markLocalSchedulePendingBackend,
  removeLocalScheduleAfterBackendFail,
  replaceLocalScheduleWithBackend,
  scheduleBackendFailAlertMessage,
} from "@/src/lib/mediaSchedulePendingSync";
import { Alert } from "react-native";

export type PublishScheduleBatchToHomeFeedArgs = {
  churchId: string;
  scheduleSlots: any[];
  scheduleTopic: string;
  scheduleType: string;
  scheduleDay: string;
  scheduleTarget: string;
  source: string;
  headers: Record<string, string>;
  ministryId?: string;
  roomId?: string;
  scheduleAuthority?: Record<string, any>;
  actorLabel?: string;
  mediaName?: string;
  churchName?: string;
  churchLabel?: string;
  avatarUri?: string;
  screen?: string;
  skipActiveCheck?: boolean;
  navigateHomeOnSuccess?: boolean;
  onSuccess?: (backendFeedId: string) => void;
  title?: string;
  visibility?: string;
  audience?: string;
  isGlobalMediaSlot?: boolean;
};

function normalizeScheduleSlotsForFeed(slots: any[], logSource: string) {
  return (Array.isArray(slots) ? slots : []).map((slot, index) => {
    const persisted = logMediaSlotPayloadTime(slot, index, logSource);
    return {
      ...slot,
      ...buildPersistedMediaSlotTimeFields({ ...slot, ...persisted }),
      slotLabel: String(slot?.slotLabel || `Slot ${index + 1}`),
      timeLabel:
        String(slot?.timeLabel || "").trim() ||
        `${persisted.startTime || slot?.startTime || ""} - ${persisted.endTime || slot?.endTime || ""}`.trim(),
    };
  });
}

export async function publishScheduleBatchToHomeFeed(
  args: PublishScheduleBatchToHomeFeedArgs
): Promise<{ ok: boolean; backendFeedId?: string; localScheduleId?: string; error?: string }> {
  const churchId = String(args.churchId || "").trim();
  const scheduleSlotsPayload = normalizeScheduleSlotsForFeed(
    args.scheduleSlots,
    `${args.screen || "publishScheduleBatchToHomeFeed"}.api`
  );

  if (!churchId || !scheduleSlotsPayload.length) {
    return { ok: false, error: "missing-church-or-slots" };
  }

  if (!args.skipActiveCheck) {
    const activeSchedule = await findActiveMediaScheduleForChurchFromSources(churchId, {
      headers: args.headers,
    });
    if (activeSchedule) {
      return { ok: false, error: ACTIVE_MEDIA_SCHEDULE_ERROR };
    }
  }

  const localScheduleId = `media-schedule-${Date.now()}`;
  const scheduleTopic = String(args.scheduleTopic || "").trim();
  const scheduleType = String(args.scheduleType || "Meeting").trim();
  const scheduleDay = String(args.scheduleDay || "").trim();
  const scheduleTarget = String(args.scheduleTarget || "Members").trim();
  const feedSource = String(args.source || "media-schedule").trim();
  const visibility = String(args.visibility || "church").trim();
  const audience = String(args.audience || "church").trim();
  const isGlobalMediaSlot = args.isGlobalMediaSlot === true;
  const cardTitle = String(
    args.title ||
      (scheduleType === "Meeting" ? "Live Schedule" : `${scheduleType} Live Cards`)
  ).trim();
  const caption =
    `${scheduleTopic}\n\n` +
    `${scheduleSlotsPayload.length} claimable slots • ${scheduleDay}\n` +
    `Audience: ${scheduleTarget}\n` +
    `Swipe inside this post to claim a slot.`;

  const localSchedulePayload = {
    id: localScheduleId,
    churchId,
    kind: "post",
    title: cardTitle,
    topic: scheduleTopic,
    scheduleTopic,
    meetingTopic: scheduleTopic,
    meetingType: scheduleType,
    liveCardType: scheduleType,
    selectedCardType: scheduleType,
    cardTypeLabel: scheduleType,
    text: caption,
    body: caption,
    createdAt: new Date().toISOString(),
    source: "media-schedule",
    scheduleType: "media-live-slots",
    pendingBackendSync: true,
    ministryId: String(args.ministryId || args.roomId || "").trim() || undefined,
    roomId: String(args.roomId || "").trim() || undefined,
    actorLabel: args.actorLabel || args.mediaName || "Schedule",
    mediaName: args.mediaName || args.actorLabel || "Schedule",
    churchLabel: args.churchLabel || args.churchName || "Church",
    churchName: args.churchName || args.churchLabel || "Church",
    ...(args.scheduleAuthority || {}),
    actorAvatarUri: args.avatarUri || "",
    churchAvatarUri: args.avatarUri || "",
    avatarUri: args.avatarUri || "",
    scheduleSlots: scheduleSlotsPayload,
    visibility,
    audience,
    isGlobalMediaSlot,
  };

  feedPublishMediaScheduleLocal(localSchedulePayload);
  markLocalSchedulePendingBackend(localScheduleId, churchId);

  let createRes: any = null;
  try {
    createRes = await apiPost(
      "/api/church/feed",
      {
        type: "post",
        title: cardTitle,
        text: caption,
        topic: scheduleTopic,
        scheduleTopic,
        meetingTopic: scheduleTopic,
        meetingType: scheduleType,
        liveCardType: scheduleType,
        selectedCardType: scheduleType,
        cardTypeLabel: scheduleType,
        source: "media-schedule",
        scheduleType: "media-live-slots",
        ministryId: localSchedulePayload.ministryId,
        roomId: localSchedulePayload.roomId,
        ...(args.scheduleAuthority || {}),
        actorLabel: localSchedulePayload.actorLabel,
        mediaName: localSchedulePayload.mediaName,
        churchLabel: localSchedulePayload.churchLabel,
        churchName: localSchedulePayload.churchName,
        visibility,
        audience,
        isGlobalMediaSlot,
        actorAvatarUri: args.avatarUri || "",
        churchAvatarUri: args.avatarUri || "",
        avatarUri: args.avatarUri || "",
        scheduleSlots: scheduleSlotsPayload,
      },
      { headers: args.headers as any }
    );
  } catch (e: any) {
    createRes = {
      ok: false,
      error: String(e?.message || e?.error || e),
      status: Number(e?.status || 0) || null,
    };
  }

  const backendFeedId = String(
    createRes?.data?.id || createRes?.item?.id || createRes?.id || ""
  ).trim();

  if (!createRes?.ok) {
    const failStatus = Number(createRes?.status || 0) || null;
    const failError = String(createRes?.error || createRes?.message || "").trim();
    removeLocalScheduleAfterBackendFail({
      localScheduleId,
      churchId,
      status: failStatus,
      error: failError,
      screen: args.screen || "publishScheduleBatchToHomeFeed",
      gate: "publishScheduleBatchToHomeFeed.api",
    });
    if (failStatus === 409) {
      Alert.alert("Schedule already active", ACTIVE_MEDIA_SCHEDULE_ERROR);
    } else if (failError) {
      Alert.alert("Schedule not saved", scheduleBackendFailAlertMessage(failStatus || 0, failError));
    }
    return { ok: false, localScheduleId, error: failError || "feed-create-failed" };
  }

  const backendItem = createRes?.item || createRes?.data || createRes;
  replaceLocalScheduleWithBackend(backendItem, localScheduleId, {
    churchId,
    scheduleSlots: scheduleSlotsPayload,
  });
  clearLocalSchedulePendingBackend(localScheduleId);

  logHomeFeedScheduleCreated({
    scheduleId: backendFeedId || localScheduleId,
    churchId,
    slotCount: scheduleSlotsPayload.length,
    source: feedSource,
  });

  args.onSuccess?.(backendFeedId || localScheduleId);
  return { ok: true, backendFeedId: backendFeedId || localScheduleId, localScheduleId };
}
