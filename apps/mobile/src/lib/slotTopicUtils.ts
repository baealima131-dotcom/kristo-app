const DEFAULT_SEED_TOPICS = new Set([
  "weekly alignment",
  "branch updates",
  "guest welcome",
  "prayer & direction",
]);

const MEETING_TYPE_ONLY_RE =
  /^(leaders?|workers?|members?|pastors?|guests?|media|youth|women|men)\s+meeting$/i;

function normTopic(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function logScheduleTopicTrace(stage: string, payload: Record<string, unknown>) {
  console.log("KRISTO_SCHEDULE_TOPIC_TRACE", { stage, ...payload });
}

const GENERIC_FEED_AND_SCHEDULE_LABELS = new Set([
  "post",
  "announcement",
  "video",
  "feed",
  "live",
  "schedule",
  "media-live-slots",
  "media schedule",
  "media-schedule",
  "meeting",
  "media live cards",
]);

function isGenericFeedOrScheduleLabel(value: string): boolean {
  const v = normTopic(value);
  if (!v) return true;
  if (GENERIC_FEED_AND_SCHEDULE_LABELS.has(v)) return true;
  if (v.includes("media-live")) return true;
  return false;
}

function extractScheduleTopicFromItemText(item: any): string {
  for (const raw of [item?.text, item?.body]) {
    const firstLine = String(raw || "")
      .split(/\n+/)[0]
      ?.trim();
    if (!firstLine || isPlaceholderSlotTopic(firstLine)) continue;
    if (/claimable slots|audience:|swipe inside|media live cards/i.test(firstLine)) continue;
    if (/^\d+\s+claimable/i.test(firstLine)) continue;
    return firstLine;
  }
  return "";
}

/** Media program template labels — not user topics or Home Feed titles. */
const MEDIA_PROGRAM_LABELS = new Set([
  "prayer live",
  "marriage help",
  "testimony",
  "counseling",
  "bible q&a",
  "help need",
  "hope word",
]);

export function isMediaProgramLabel(value: string): boolean {
  return MEDIA_PROGRAM_LABELS.has(normTopic(value));
}

/** Schedule-level typed topic only — never slot/program labels. */
export function resolveScheduleLevelTopic(item: any, _slot?: any): string {
  const fromItem = String(
    item?.topic ||
      item?.scheduleTopic ||
      item?.meetingTopic ||
      item?.meetingPlanTopic ||
      ""
  ).trim();

  if (fromItem && !isPlaceholderSlotTopic(fromItem) && !isMediaProgramLabel(fromItem)) {
    return fromItem;
  }

  const fromText = extractScheduleTopicFromItemText(item);
  if (fromText && !isMediaProgramLabel(fromText)) return fromText;

  return "";
}

/** Live Card Type label only — never feed row type (`post`, `video`, etc.). */
function extractLiveCardTypeFromTask(task: string): string {
  const raw = String(task || "").trim();
  if (!raw) return "";

  const bullet = raw.match(/(?:•|·|\||\u2022|\u00b7|–|—|-)\s*(.+)$/);
  if (bullet?.[1]) {
    const fromTask = bullet[1].trim();
    if (!isGenericFeedOrScheduleLabel(fromTask)) return fromTask;
  }

  const parts = raw
    .split(/\s*(?:•|·|\||\u2022|\u00b7|–|—|-)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (!isGenericFeedOrScheduleLabel(last)) return last;
  }

  return "";
}

export function extractLiveCardTypeFromItemAndSlot(item: any, slot: any): string {
  for (const candidate of [
    item?.meetingType,
    item?.liveCardType,
    item?.selectedCardType,
    item?.cardTypeLabel,
    item?.meetingTitleChoice,
    slot?.meetingType,
    slot?.liveCardType,
    slot?.selectedCardType,
    slot?.cardTypeLabel,
    slot?.meetingTitleChoice,
  ]) {
    const value = String(candidate || "").trim();
    if (value && !isGenericFeedOrScheduleLabel(value)) return value;
  }

  const fromTask = extractLiveCardTypeFromTask(String(slot?.task || item?.task || "").trim());
  if (fromTask) return fromTask;

  return "";
}

export function isPlaceholderSlotTopic(value: string) {
  const v = String(value || "").trim();
  if (!v) return true;
  return /^(no topic|ready to execute|no topic set)$/i.test(v);
}

export function extractMeetingTypeFromSlot(card: any): string {
  for (const candidate of [
    card?.meetingType,
    card?.liveCardType,
    card?.selectedCardType,
    card?.cardTypeLabel,
    card?.meetingTitleChoice,
    card?.scheduleType,
    card?.subtitle,
  ]) {
    const value = String(candidate || "").trim();
    if (value && !isGenericFeedOrScheduleLabel(value)) return value;
  }

  return extractLiveCardTypeFromTask(String(card?.task || "").trim());
}

export function isRealUserTopic(
  value: string,
  parentTopic: string,
  meetingType: string,
  title: string
): boolean {
  const v = String(value || "").trim();
  if (!v || isPlaceholderSlotTopic(v)) return false;

  const vN = normTopic(v);
  const parentN = normTopic(parentTopic);
  const meetingN = normTopic(meetingType);
  const titleN = normTopic(title);

  if (DEFAULT_SEED_TOPICS.has(vN)) return false;

  if (meetingN && vN === meetingN) return false;
  if (MEETING_TYPE_ONLY_RE.test(v)) return false;

  if (titleN && vN === titleN) return false;

  if (meetingN && titleN) {
    if (vN === `${titleN} • ${meetingN}` || vN === `${titleN} - ${meetingN}`) {
      return false;
    }

    if (v.includes("•") && vN.endsWith(meetingN)) {
      const left = normTopic(v.split("•")[0] || "");
      if (!left || left === titleN) return false;
    }
  }

  if (/^select\s+/i.test(v) || /^not included$/i.test(v)) return false;
  if (/^pray live for people$/i.test(v)) return false;

  if (parentN && vN === parentN && DEFAULT_SEED_TOPICS.has(parentN)) return false;

  return true;
}

export function resolveRealSlotTopic(card: any): {
  resolvedTopic: string;
  source: string;
  parentTopic: string;
  meetingType: string;
  rawSlotKeys: string[];
} {
  const slot = card?.slot && typeof card.slot === "object" ? card.slot : card;
  const title = String(card?.title || slot?.name || "").trim();
  const meetingType = extractMeetingTypeFromSlot(card);
  const parentTopic = String(
    card?.parentTopic ||
    card?.scheduleTopic ||
    card?.meetingTopic ||
    card?.meetingPlanTopic ||
    ""
  ).trim();

  const rawSlotKeys = Object.keys(slot || {}).filter((key) =>
    /topic|script|assignment|slot/i.test(key)
  );

  // Per-slot explicit topics, then schedule-level typed topic from create flow.
  const explicitCandidates: Array<{ source: string; value: string }> = [
    { source: "card.parentTopic", value: String(card?.parentTopic || "").trim() },
    { source: "card.slotTopic", value: String(card?.slotTopic || "").trim() },
    { source: "slot.slotTopic", value: String(slot?.slotTopic || "").trim() },
    { source: "card.assignmentTopic", value: String(card?.assignmentTopic || "").trim() },
    { source: "slot.assignmentTopic", value: String(slot?.assignmentTopic || "").trim() },
    { source: "card.topic", value: String(card?.topic || "").trim() },
    { source: "slot.topic", value: String(slot?.topic || "").trim() },
    { source: "card.script", value: String(card?.script || "").trim() },
    { source: "slot.script", value: String(slot?.script || "").trim() },
    { source: "slot.scheduleTopic", value: String(slot?.scheduleTopic || "").trim() },
    { source: "slot.parentTopic", value: String(slot?.parentTopic || "").trim() },
    { source: "slot.meetingTopic", value: String(slot?.meetingTopic || "").trim() },
    { source: "card.scheduleTopic", value: String(card?.scheduleTopic || "").trim() },
    { source: "card.meetingTopic", value: String(card?.meetingTopic || "").trim() },
    { source: "card.meetingPlanTopic", value: String(card?.meetingPlanTopic || "").trim() },
  ];

  for (const { source, value } of explicitCandidates) {
    if (isRealUserTopic(value, parentTopic, meetingType, title)) {
      console.log("KRISTO_SLOT_TOPIC_RESOLVE", {
        resolvedTopic: value,
        source,
        parentTopic,
        meetingType,
        title,
      });
      return {
        resolvedTopic: value,
        source,
        parentTopic,
        meetingType,
        rawSlotKeys,
      };
    }
  }

  console.log("KRISTO_SLOT_TOPIC_RESOLVE", {
    resolvedTopic: "",
    source: "none",
    parentTopic,
    meetingType,
    title,
  });

  return {
    resolvedTopic: "",
    source: "none",
    parentTopic,
    meetingType,
    rawSlotKeys,
  };
}

export function resolveMeetingTopicForSlots(
  parentTopic: string,
  meetingType: string,
  title = ""
): string {
  const topic = String(parentTopic || "").trim();
  if (!topic || !isRealUserTopic(topic, "", meetingType, title)) return "";
  return topic;
}

export function resolveScheduleSlotScriptForSave(
  slot: any,
  parentTopic: string,
  opts?: { slotNumber?: string | number; title?: string; log?: boolean }
): { script: string; source: string; slotTopic: string; assignmentTopic: string } {
  const title = String(opts?.title || slot?.name || slot?.title || "Schedule slot").trim();
  const meetingType = extractMeetingTypeFromSlot(slot);
  const resolved = resolveRealSlotTopic({
    ...slot,
    parentTopic,
  });

  if (resolved.resolvedTopic) {
    if (opts?.log !== false) {
      console.log("KRISTO_SLOT_TOPIC_SAVE_REAL", {
        slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
        title,
        slotTopic: resolved.resolvedTopic,
        assignmentTopic: resolved.resolvedTopic,
        script: resolved.resolvedTopic,
        source: resolved.source,
        parentTopic,
      });
    }
    return {
      script: resolved.resolvedTopic,
      source: resolved.source,
      slotTopic: resolved.resolvedTopic,
      assignmentTopic: resolved.resolvedTopic,
    };
  }

  const meetingTopic = resolveMeetingTopicForSlots(parentTopic, meetingType, title);
  if (meetingTopic) {
    if (opts?.log !== false) {
      console.log("KRISTO_SLOT_TOPIC_SAVE_REAL", {
        slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
        title,
        slotTopic: meetingTopic,
        assignmentTopic: meetingTopic,
        script: meetingTopic,
        source: "meeting.topic",
        parentTopic,
      });
    }
    return {
      script: meetingTopic,
      source: "meeting.topic",
      slotTopic: meetingTopic,
      assignmentTopic: meetingTopic,
    };
  }

  if (opts?.log !== false) {
    console.log("KRISTO_SCHEDULE_SLOT_SCRIPT_SAVE", {
      slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
      title,
      script: "",
      slotTopic: "",
      assignmentTopic: "",
      source: "none",
      parentTopic,
      meetingType,
    });
  }

  return { script: "", source: "none", slotTopic: "", assignmentTopic: "" };
}

function isLiveCardTypeLabel(value: string) {
  return !isGenericFeedOrScheduleLabel(value);
}

/** Home Feed schedule card: schedule topic → title, live card type → subtitle. */
export function resolveHomeFeedScheduleSlotLabels(
  item: any,
  slot: any
): { title: string; subtitle: string; topicSource: string } {
  const slotName = String(slot?.name || slot?.slotLabel || slot?.title || "").trim();
  const scheduleLevelTopic = resolveScheduleLevelTopic(item, slot);
  const liveCardType = extractLiveCardTypeFromItemAndSlot(item, slot);

  const title =
    scheduleLevelTopic && !isPlaceholderSlotTopic(scheduleLevelTopic)
      ? scheduleLevelTopic
      : "Live Slot";
  const topicSource = scheduleLevelTopic ? "schedule.level.topic" : "fallback.empty";

  const subtitle =
    liveCardType &&
    isLiveCardTypeLabel(liveCardType) &&
    normTopic(liveCardType) !== normTopic(title)
      ? liveCardType
      : "";

  logScheduleTopicTrace("home_feed_card_resolved", {
    rawItemId: String(item?.id || item?.parentScheduleId || item?.sourceScheduleId || ""),
    slotId: String(slot?.id || ""),
    itemTopic: String(item?.topic || ""),
    itemScheduleTopic: String(item?.scheduleTopic || ""),
    itemMeetingTopic: String(item?.meetingTopic || ""),
    slotName,
    itemType: String(item?.type || ""),
    meetingType: String(item?.meetingType || ""),
    liveCardType,
    itemLiveCardType: String(item?.liveCardType || ""),
    scheduleLevelTopic,
    resolvedTitle: title,
    resolvedSubtitle: subtitle,
    topicSource,
  });

  return { title, subtitle, topicSource };
}
