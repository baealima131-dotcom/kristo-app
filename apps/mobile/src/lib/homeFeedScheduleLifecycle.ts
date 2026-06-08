export function logHomeFeedScheduleCreated(args: {
  scheduleId: string;
  churchId: string;
  slotCount: number;
  source: string;
}) {
  console.log("KRISTO_HOME_FEED_SCHEDULE_CREATED", {
    scheduleId: String(args.scheduleId || "").trim(),
    churchId: String(args.churchId || "").trim(),
    slotCount: Number(args.slotCount || 0),
    source: String(args.source || "").trim(),
  });
}

export function logHomeFeedScheduleExpired(args: {
  scheduleId: string;
  churchId: string;
  reason: string;
  endedAt?: string | number | null;
}) {
  console.log("KRISTO_HOME_FEED_SCHEDULE_EXPIRED", {
    scheduleId: String(args.scheduleId || "").trim(),
    churchId: String(args.churchId || "").trim(),
    reason: String(args.reason || "").trim(),
    endedAt: args.endedAt ?? null,
  });
}

export function logHomeFeedScheduleRemoved(args: {
  scheduleId: string;
  churchId: string;
  source: string;
}) {
  console.log("KRISTO_HOME_FEED_SCHEDULE_REMOVED", {
    scheduleId: String(args.scheduleId || "").trim(),
    churchId: String(args.churchId || "").trim(),
    source: String(args.source || "").trim(),
  });
}
