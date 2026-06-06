/** Pause background profile refresh while Media Schedule tool flow is active. */
export function enterMediaScheduleFlow(source: string) {
  const g = globalThis as any;
  g.__KRISTO_MEDIA_SCHEDULE_FLOW_COUNT__ = Number(g.__KRISTO_MEDIA_SCHEDULE_FLOW_COUNT__ || 0) + 1;
  g.__KRISTO_MEDIA_SCHEDULE_FLOW_ACTIVE__ = true;
  if (__DEV__) {
    console.log("KRISTO_MEDIA_SCHEDULE_FLOW_ENTER", {
      source,
      count: g.__KRISTO_MEDIA_SCHEDULE_FLOW_COUNT__,
    });
  }
}

export function exitMediaScheduleFlow(source: string) {
  const g = globalThis as any;
  const next = Math.max(0, Number(g.__KRISTO_MEDIA_SCHEDULE_FLOW_COUNT__ || 0) - 1);
  g.__KRISTO_MEDIA_SCHEDULE_FLOW_COUNT__ = next;
  g.__KRISTO_MEDIA_SCHEDULE_FLOW_ACTIVE__ = next > 0;
  if (__DEV__) {
    console.log("KRISTO_MEDIA_SCHEDULE_FLOW_EXIT", { source, count: next });
  }
}

export function isMediaScheduleFlowActive() {
  return Number((globalThis as any).__KRISTO_MEDIA_SCHEDULE_FLOW_COUNT__ || 0) > 0;
}

export function shouldPauseBackgroundProfileRefresh() {
  const g = globalThis as any;
  return (
    isMediaScheduleFlowActive() ||
    Boolean(g.__KRISTO_LIVE_ACTIVE__) ||
    Number(g.__KRISTO_LIVE_ACTIVE_COUNT__ || 0) > 0
  );
}
