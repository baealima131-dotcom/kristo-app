const DEFAULT_SEED_TOPICS = new Set([
  "weekly alignment",
  "branch updates",
  "guest welcome",
  "prayer & direction",
  "upendo wa mungu",
]);

const MEETING_TYPE_ONLY_RE =
  /^(leaders?|workers?|members?|pastors?|guests?|media|youth|women|men)\s+meeting$/i;

function normTopic(value: string) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isPlaceholderSlotTopic(value: string) {
  const v = String(value || "").trim();
  if (!v) return true;
  return /^(no topic|ready to execute|no topic set)$/i.test(v);
}

export function extractMeetingTypeFromSlot(card: any): string {
  const task = String(card?.task || "").trim();
  const bullet = task.match(/•\s*(.+)$/);
  if (bullet?.[1]) return bullet[1].trim();

  return String(
    card?.scheduleType ||
    card?.meetingType ||
    card?.subtitle ||
    ""
  ).trim();
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
    /topic|script|task|description|title|role|assignment|meeting/i.test(key)
  );

  const explicitCandidates: Array<{ source: string; value: string }> = [
    { source: "slot.topic", value: String(slot?.topic || "").trim() },
    { source: "card.topic", value: String(card?.topic || "").trim() },
    { source: "slot.assignmentTopic", value: String(slot?.assignmentTopic || "").trim() },
    { source: "card.assignmentTopic", value: String(card?.assignmentTopic || "").trim() },
    { source: "slot.slotTopic", value: String(slot?.slotTopic || "").trim() },
    { source: "card.slotTopic", value: String(card?.slotTopic || "").trim() },
    { source: "slot.description", value: String(slot?.description || "").trim() },
    { source: "card.description", value: String(card?.description || "").trim() },
  ];

  for (const { source, value } of explicitCandidates) {
    if (isRealUserTopic(value, parentTopic, meetingType, title)) {
      return {
        resolvedTopic: value,
        source,
        parentTopic,
        meetingType,
        rawSlotKeys,
      };
    }
  }

  const meetingLevelCandidates: Array<{ source: string; value: string }> = [
    { source: "card.meetingTopic", value: String(card?.meetingTopic || "").trim() },
    { source: "card.scheduleTopic", value: String(card?.scheduleTopic || "").trim() },
    { source: "card.parentTopic", value: parentTopic },
    { source: "card.script", value: String(card?.script || "").trim() },
  ];

  for (const { source, value } of meetingLevelCandidates) {
    if (isRealUserTopic(value, parentTopic, meetingType, title)) {
      return {
        resolvedTopic: value,
        source,
        parentTopic,
        meetingType,
        rawSlotKeys,
      };
    }
  }

  return {
    resolvedTopic: "",
    source: "none",
    parentTopic,
    meetingType,
    rawSlotKeys,
  };
}

export function resolveScheduleSlotScriptForSave(
  slot: any,
  parentTopic: string,
  opts?: { slotNumber?: string | number; title?: string; log?: boolean }
): { script: string; source: string } {
  const resolved = resolveRealSlotTopic({
    ...slot,
    scheduleTopic: parentTopic,
    meetingTopic: parentTopic,
    parentTopic,
  });

  const title = String(opts?.title || slot?.name || slot?.title || "Schedule slot").trim();

  if (resolved.resolvedTopic) {
    if (opts?.log !== false) {
      console.log("KRISTO_SCHEDULE_SLOT_SCRIPT_SAVE", {
        slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
        title,
        script: resolved.resolvedTopic,
        source: resolved.source,
        parentTopic,
      });
    }
    return { script: resolved.resolvedTopic, source: resolved.source };
  }

  if (opts?.log !== false) {
    console.log("KRISTO_SCHEDULE_SLOT_SCRIPT_SAVE", {
      slotNumber: opts?.slotNumber ?? slot?.slotNumber ?? slot?.slotLabel ?? "",
      title,
      script: "",
      source: "none",
      parentTopic,
    });
  }

  return { script: "", source: "none" };
}
