/**
 * Server-authoritative live-slot Big Screen transition state.
 * Shared pure helpers for /api/church/live reconcile + progress.
 *
 * Authority chain:
 *   SLOT_TIMER_EXPIRED → NEXT_SLOT_COMPUTED → ACTIVE_SLOT_UPDATED
 *   → SLOT_TRANSITION_START → (media) → BIG_SCREEN_UPDATED → TRANSITION_FINISHED
 *
 * activeSlotId MUST advance when slotEnd <= serverNow. Media handoff must not block the clock.
 */

export type SlotTransitionPhase =
  | "idle"
  | "loading_schedule"
  | "getting_token"
  | "confirming_room"
  | "preparing_mic"
  | "preparing_camera"
  | "publishing_video"
  | "entering_live"
  | "ready"
  | "failed";

export type SlotTransitionEvent =
  | "SLOT_TRANSITION_START"
  | "SLOT_TRANSITION_READY"
  | "SLOT_TRANSITION_CANCELLED"
  | "SLOT_TRANSITION_FAILED"
  | null;

export type SlotScheduleEntry = {
  slotId: string;
  slotNumber: number;
  ownerUserId: string;
  ownerName?: string;
  startMs: number;
  endMs: number;
};

export type SlotTransitionReport = {
  phase: SlotTransitionPhase;
  at: number;
  videoReady?: boolean;
  avatarFallback?: boolean;
  role?: "incoming" | "outgoing" | "remote";
};

export type SlotTransitionRecord = {
  transitionId: string;
  event: SlotTransitionEvent;
  phase: SlotTransitionPhase;
  outgoingSlotId: string;
  outgoingUserId: string;
  incomingSlotId: string;
  incomingUserId: string;
  scheduleVersion: string;
  boundaryTimestamp: number;
  startedAt: number;
  readyAt: number | null;
  failedReason: string | null;
  bigScreenOwnerUserId: string;
  reports: Record<string, SlotTransitionReport>;
};

export type SlotClockState = {
  activeSlotId: string;
  activeOwnerUserId: string;
  activeSlotStartMs: number;
  activeSlotEndMs: number;
  scheduleVersion: string;
  updatedAt: number;
  serverNow: number;
};

export type SlotScheduleSnapshot = {
  scheduleVersion: string;
  slots: SlotScheduleEntry[];
  updatedAt: number;
};

export type SlotPipelineLog = {
  event: string;
  transitionId?: string;
  scheduleVersion?: string;
  oldSlotId?: string;
  newSlotId?: string;
  oldOwnerId?: string;
  newOwnerId?: string;
  serverNow?: number;
  slotStart?: number;
  slotEnd?: number;
  remainingMs?: number;
  abortReason?: string;
  [key: string]: unknown;
};

const PHASE_ORDER: SlotTransitionPhase[] = [
  "idle",
  "loading_schedule",
  "getting_token",
  "confirming_room",
  "preparing_mic",
  "preparing_camera",
  "publishing_video",
  "entering_live",
  "ready",
  "failed",
];

export function slotTransitionPhaseRank(phase: SlotTransitionPhase): number {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx >= 0 ? idx : 0;
}

export function isSlotTransitionTerminal(phase: SlotTransitionPhase): boolean {
  return phase === "ready" || phase === "failed" || phase === "idle";
}

export function isSlotTransitionActive(transition: SlotTransitionRecord | null | undefined): boolean {
  if (!transition?.transitionId) return false;
  return !isSlotTransitionTerminal(transition.phase);
}

export function buildSlotTransitionId(input: {
  outgoingSlotId: string;
  incomingSlotId: string;
  scheduleVersion: string;
  boundaryTimestamp: number;
}): string {
  const out = String(input.outgoingSlotId || "").trim();
  const inn = String(input.incomingSlotId || "").trim();
  const ver = String(input.scheduleVersion || "").trim();
  const ts = Math.floor(Number(input.boundaryTimestamp) || 0);
  return `stx_${out}_${inn}_${ver}_${ts}`.slice(0, 180);
}

export function normalizeSlotScheduleEntries(raw: unknown): SlotScheduleEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: SlotScheduleEntry[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const slot: any = raw[i];
    const ownerUserId = String(
      slot?.ownerUserId || slot?.claimedByUserId || slot?.claimedBy?.userId || ""
    ).trim();
    if (!ownerUserId) continue;
    const startMs = Number(slot?.startMs || 0);
    const endMs = Number(slot?.endMs || 0);
    if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && startMs > 0)) {
      continue;
    }
    const slotNumber = Math.max(
      1,
      Math.floor(Number(slot?.slotNumber ?? slot?.slot ?? i + 1) || i + 1)
    );
    const slotId =
      String(slot?.slotId || slot?.id || "").trim() || `slot_${slotNumber}_${ownerUserId}`;
    out.push({
      slotId,
      slotNumber,
      ownerUserId,
      ownerName:
        String(slot?.ownerName || slot?.claimedByName || slot?.claimedBy?.name || "").trim() ||
        undefined,
      startMs,
      endMs,
    });
  }
  out.sort((a, b) => a.startMs - b.startMs || a.slotNumber - b.slotNumber);
  return out;
}

export function resolveActiveScheduleSlot(
  slots: SlotScheduleEntry[],
  nowMs: number
): SlotScheduleEntry | null {
  const now = Number(nowMs) || Date.now();
  const active = slots.filter((s) => now >= s.startMs && now < s.endMs);
  if (!active.length) return null;
  active.sort((a, b) => b.startMs - a.startMs || a.slotNumber - b.slotNumber);
  return active[0] || null;
}

export function resolveIncomingSlotAfter(
  slots: SlotScheduleEntry[],
  outgoing: SlotScheduleEntry | null,
  nowMs: number
): SlotScheduleEntry | null {
  const now = Number(nowMs) || Date.now();
  if (!outgoing) {
    return resolveActiveScheduleSlot(slots, now);
  }
  const next = slots
    .filter(
      (s) =>
        s.slotId !== outgoing.slotId &&
        s.startMs >= outgoing.endMs - 1 &&
        s.ownerUserId
    )
    .sort((a, b) => a.startMs - b.startMs || a.slotNumber - b.slotNumber);
  if (next[0]) return next[0];
  return resolveActiveScheduleSlot(slots, Math.max(now, outgoing.endMs));
}

function emptyTransition(): SlotTransitionRecord {
  return {
    transitionId: "",
    event: null,
    phase: "idle",
    outgoingSlotId: "",
    outgoingUserId: "",
    incomingSlotId: "",
    incomingUserId: "",
    scheduleVersion: "",
    boundaryTimestamp: 0,
    startedAt: 0,
    readyAt: null,
    failedReason: null,
    bigScreenOwnerUserId: "",
    reports: {},
  };
}

export function readSlotTransition(live: any): SlotTransitionRecord {
  const t = live?.slotTransition;
  if (!t || typeof t !== "object") return emptyTransition();
  return {
    transitionId: String(t.transitionId || "").trim(),
    event: (t.event as SlotTransitionEvent) || null,
    phase: (String(t.phase || "idle") as SlotTransitionPhase) || "idle",
    outgoingSlotId: String(t.outgoingSlotId || "").trim(),
    outgoingUserId: String(t.outgoingUserId || "").trim(),
    incomingSlotId: String(t.incomingSlotId || "").trim(),
    incomingUserId: String(t.incomingUserId || "").trim(),
    scheduleVersion: String(t.scheduleVersion || "").trim(),
    boundaryTimestamp: Number(t.boundaryTimestamp || 0) || 0,
    startedAt: Number(t.startedAt || 0) || 0,
    readyAt: t.readyAt == null ? null : Number(t.readyAt) || null,
    failedReason: t.failedReason == null ? null : String(t.failedReason),
    bigScreenOwnerUserId: String(t.bigScreenOwnerUserId || "").trim(),
    reports:
      t.reports && typeof t.reports === "object"
        ? (t.reports as Record<string, SlotTransitionReport>)
        : {},
  };
}

export function readSlotClock(live: any): SlotClockState {
  const c = live?.slotClock;
  return {
    activeSlotId: String(c?.activeSlotId || "").trim(),
    activeOwnerUserId: String(c?.activeOwnerUserId || "").trim(),
    activeSlotStartMs: Number(c?.activeSlotStartMs || 0) || 0,
    activeSlotEndMs: Number(c?.activeSlotEndMs || 0) || 0,
    scheduleVersion: String(c?.scheduleVersion || live?.slotSchedule?.scheduleVersion || "").trim(),
    updatedAt: Number(c?.updatedAt || 0) || 0,
    serverNow: Number(c?.serverNow || 0) || 0,
  };
}

function pipelineLog(event: string, fields: Omit<SlotPipelineLog, "event">): SlotPipelineLog {
  const row: SlotPipelineLog = { event, ...fields };
  console.log(event, row);
  return row;
}

function writeSlotClock(
  live: any,
  input: {
    slot: SlotScheduleEntry;
    scheduleVersion: string;
    nowMs: number;
  }
): SlotClockState {
  const clock: SlotClockState = {
    activeSlotId: input.slot.slotId,
    activeOwnerUserId: input.slot.ownerUserId,
    activeSlotStartMs: input.slot.startMs,
    activeSlotEndMs: input.slot.endMs,
    scheduleVersion: input.scheduleVersion,
    updatedAt: input.nowMs,
    serverNow: input.nowMs,
  };
  live.slotClock = clock;
  return clock;
}

export function upsertSlotScheduleSnapshot(
  live: any,
  input: { scheduleVersion: string; slots: unknown; nowMs: number }
): boolean {
  const scheduleVersion = String(input.scheduleVersion || "").trim();
  const slots = normalizeSlotScheduleEntries(input.slots);
  const prevVer = String(live?.slotSchedule?.scheduleVersion || "").trim();
  const prevSlots = normalizeSlotScheduleEntries(live?.slotSchedule?.slots);
  const same =
    prevVer === scheduleVersion && JSON.stringify(prevSlots) === JSON.stringify(slots);
  if (same) return false;
  live.slotSchedule = {
    scheduleVersion,
    slots,
    updatedAt: Number(input.nowMs) || Date.now(),
  } satisfies SlotScheduleSnapshot;
  return true;
}

function startTransitionOnLive(
  live: any,
  input: {
    outgoing: SlotScheduleEntry;
    incoming: SlotScheduleEntry;
    scheduleVersion: string;
    boundaryTimestamp: number;
    nowMs: number;
  }
): SlotTransitionRecord {
  const transitionId = buildSlotTransitionId({
    outgoingSlotId: input.outgoing.slotId,
    incomingSlotId: input.incoming.slotId,
    scheduleVersion: input.scheduleVersion,
    boundaryTimestamp: input.boundaryTimestamp,
  });
  const record: SlotTransitionRecord = {
    transitionId,
    event: "SLOT_TRANSITION_START",
    phase: "loading_schedule",
    outgoingSlotId: input.outgoing.slotId,
    outgoingUserId: input.outgoing.ownerUserId,
    incomingSlotId: input.incoming.slotId,
    incomingUserId: input.incoming.ownerUserId,
    scheduleVersion: input.scheduleVersion,
    boundaryTimestamp: input.boundaryTimestamp,
    startedAt: input.nowMs,
    readyAt: null,
    failedReason: null,
    // Authority owner already advanced on slotClock; Big Screen owner set on READY/fallback.
    bigScreenOwnerUserId: String(live?.bigScreenOwnerUserId || "").trim(),
    reports: {},
  };
  live.slotTransition = record;
  return record;
}

export function cancelActiveSlotTransition(
  live: any,
  reason: string,
  nowMs: number
): SlotTransitionRecord | null {
  const current = readSlotTransition(live);
  if (!isSlotTransitionActive(current)) return null;
  const cancelled: SlotTransitionRecord = {
    ...current,
    event: "SLOT_TRANSITION_CANCELLED",
    phase: "failed",
    failedReason: reason,
    readyAt: nowMs,
  };
  live.slotTransition = cancelled;
  pipelineLog("SLOT_TRANSITION_ABORT", {
    transitionId: cancelled.transitionId,
    scheduleVersion: cancelled.scheduleVersion,
    oldSlotId: cancelled.outgoingSlotId,
    newSlotId: cancelled.incomingSlotId,
    oldOwnerId: cancelled.outgoingUserId,
    newOwnerId: cancelled.incomingUserId,
    serverNow: nowMs,
    abortReason: reason,
  });
  return cancelled;
}

export function completeSlotTransitionReady(
  live: any,
  nowMs: number,
  opts?: { avatarFallback?: boolean; failedReason?: string | null }
): SlotTransitionRecord {
  const current = readSlotTransition(live);
  const incomingUserId = current.incomingUserId;
  const incomingSlotId = current.incomingSlotId;
  const slots = normalizeSlotScheduleEntries(live?.slotSchedule?.slots);
  const incomingSlot = slots.find((s) => s.slotId === incomingSlotId) || null;

  // Ensure clock is on the incoming slot (authority must not lag media completion).
  if (incomingSlot) {
    const prev = readSlotClock(live);
    if (prev.activeSlotId !== incomingSlot.slotId) {
      writeSlotClock(live, {
        slot: incomingSlot,
        scheduleVersion: current.scheduleVersion,
        nowMs,
      });
      pipelineLog("ACTIVE_SLOT_UPDATED", {
        transitionId: current.transitionId,
        scheduleVersion: current.scheduleVersion,
        oldSlotId: prev.activeSlotId,
        newSlotId: incomingSlot.slotId,
        oldOwnerId: prev.activeOwnerUserId,
        newOwnerId: incomingSlot.ownerUserId,
        serverNow: nowMs,
        slotStart: incomingSlot.startMs,
        slotEnd: incomingSlot.endMs,
        remainingMs: Math.max(0, incomingSlot.endMs - nowMs),
        source: "transition_complete",
      });
    } else {
      live.slotClock = {
        ...prev,
        serverNow: nowMs,
        updatedAt: nowMs,
      };
    }
  }

  live.bigScreenOwnerUserId = incomingUserId;
  const record: SlotTransitionRecord = {
    ...current,
    event: opts?.failedReason ? "SLOT_TRANSITION_FAILED" : "SLOT_TRANSITION_READY",
    phase: opts?.failedReason ? "failed" : "ready",
    failedReason: opts?.failedReason || (opts?.avatarFallback ? "avatar_fallback" : null),
    readyAt: nowMs,
    bigScreenOwnerUserId: incomingUserId,
  };
  live.slotTransition = record;

  pipelineLog("BIG_SCREEN_UPDATED", {
    transitionId: record.transitionId,
    scheduleVersion: record.scheduleVersion,
    oldSlotId: record.outgoingSlotId,
    newSlotId: record.incomingSlotId,
    oldOwnerId: record.outgoingUserId,
    newOwnerId: incomingUserId,
    serverNow: nowMs,
    slotStart: incomingSlot?.startMs,
    slotEnd: incomingSlot?.endMs,
    remainingMs: incomingSlot ? Math.max(0, incomingSlot.endMs - nowMs) : undefined,
    avatarFallback: opts?.avatarFallback === true,
  });
  pipelineLog("TRANSITION_FINISHED", {
    transitionId: record.transitionId,
    scheduleVersion: record.scheduleVersion,
    oldSlotId: record.outgoingSlotId,
    newSlotId: record.incomingSlotId,
    oldOwnerId: record.outgoingUserId,
    newOwnerId: incomingUserId,
    serverNow: nowMs,
    abortReason: opts?.failedReason || undefined,
    avatarFallback: opts?.avatarFallback === true,
  });

  return record;
}

/**
 * Advance / create transition from stored schedule + server clock.
 * CRITICAL: when clock slot endMs <= serverNow, activeSlotId advances immediately.
 */
export function reconcileLiveSlotTransition(
  live: any,
  nowMs: number
): {
  changed: boolean;
  started: SlotTransitionRecord | null;
  cancelled: SlotTransitionRecord | null;
  completed: SlotTransitionRecord | null;
  activeSlotUpdated: boolean;
  abortReason: string | null;
  logs: SlotPipelineLog[];
} {
  const now = Number(nowMs) || Date.now();
  const schedule = live?.slotSchedule as SlotScheduleSnapshot | undefined;
  const slots = normalizeSlotScheduleEntries(schedule?.slots);
  const scheduleVersion = String(schedule?.scheduleVersion || "").trim();
  const logs: SlotPipelineLog[] = [];
  let changed = false;
  let started: SlotTransitionRecord | null = null;
  let cancelled: SlotTransitionRecord | null = null;
  let completed: SlotTransitionRecord | null = null;
  let activeSlotUpdated = false;
  let abortReason: string | null = null;

  const push = (event: string, fields: Omit<SlotPipelineLog, "event"> = {}) => {
    logs.push(pipelineLog(event, fields));
  };

  if (!slots.length || !scheduleVersion) {
    abortReason = !slots.length ? "no_schedule_slots" : "no_schedule_version";
    push("SLOT_PIPELINE_ABORT", {
      serverNow: now,
      abortReason,
      scheduleVersion: scheduleVersion || "",
    });
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  let current = readSlotTransition(live);
  let clock = readSlotClock(live);

  // Keep serverNow fresh on every reconcile so clients can diagnose drift.
  if (clock.activeSlotId) {
    live.slotClock = { ...clock, serverNow: now };
    clock = readSlotClock(live);
  }

  // Stale transition vs new schedule → cancel and allow restart.
  if (
    isSlotTransitionActive(current) &&
    current.scheduleVersion &&
    current.scheduleVersion !== scheduleVersion
  ) {
    cancelled = cancelActiveSlotTransition(live, "schedule_version_changed", now);
    changed = true;
    current = readSlotTransition(live);
  }

  // Finish in-flight media transition when incoming is ready / timed out.
  if (isSlotTransitionActive(current)) {
    const incomingReport = current.reports?.[current.incomingUserId];
    const incomingReady =
      incomingReport &&
      (incomingReport.videoReady === true ||
        incomingReport.avatarFallback === true ||
        slotTransitionPhaseRank(incomingReport.phase) >=
          slotTransitionPhaseRank("entering_live"));
    const timedOut = now - (current.startedAt || now) > 18_000;
    if (incomingReady || timedOut) {
      completed = completeSlotTransitionReady(live, now, {
        avatarFallback: !incomingReport?.videoReady || timedOut,
        failedReason: null,
      });
      changed = true;
      activeSlotUpdated = true;
      current = completed;
      // Continue — clock may still need to catch a newer boundary.
    }
  }

  // Clear terminal transition UI state after short sync window.
  current = readSlotTransition(live);
  if (
    (current.phase === "ready" || current.phase === "failed") &&
    current.readyAt &&
    now - current.readyAt > 4_000
  ) {
    live.slotTransition = {
      ...emptyTransition(),
      transitionId: current.transitionId,
      scheduleVersion: current.scheduleVersion,
      incomingSlotId: current.incomingSlotId,
      incomingUserId: current.incomingUserId,
      outgoingSlotId: current.outgoingSlotId,
      outgoingUserId: current.outgoingUserId,
      boundaryTimestamp: current.boundaryTimestamp,
      bigScreenOwnerUserId:
        current.bigScreenOwnerUserId || readSlotClock(live).activeOwnerUserId,
      phase: "idle",
      event: null,
      readyAt: current.readyAt,
    };
    changed = true;
    current = readSlotTransition(live);
  }

  clock = readSlotClock(live);
  const clockSlot =
    slots.find((s) => s.slotId === clock.activeSlotId) ||
    (clock.activeSlotId
      ? ({
          slotId: clock.activeSlotId,
          slotNumber: 0,
          ownerUserId: clock.activeOwnerUserId,
          startMs: clock.activeSlotStartMs || 0,
          endMs: clock.activeSlotEndMs || 0,
        } satisfies SlotScheduleEntry)
      : null);

  // Seed clock on first observation — no transition UI.
  if (!clock.activeSlotId) {
    const active = resolveActiveScheduleSlot(slots, now);
    if (!active) {
      abortReason = "no_active_slot_to_seed";
      push("SLOT_PIPELINE_ABORT", {
        serverNow: now,
        scheduleVersion,
        abortReason,
      });
      return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
    }
    writeSlotClock(live, { slot: active, scheduleVersion, nowMs: now });
    live.bigScreenOwnerUserId = active.ownerUserId;
    activeSlotUpdated = true;
    changed = true;
    push("ACTIVE_SLOT_UPDATED", {
      scheduleVersion,
      oldSlotId: "",
      newSlotId: active.slotId,
      oldOwnerId: "",
      newOwnerId: active.ownerUserId,
      serverNow: now,
      slotStart: active.startMs,
      slotEnd: active.endMs,
      remainingMs: Math.max(0, active.endMs - now),
      source: "seed",
    });
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  const remainingMs = clockSlot ? clockSlot.endMs - now : 0;
  const timerExpired =
    Boolean(clockSlot) &&
    Number(clockSlot!.endMs || 0) > 0 &&
    clockSlot!.endMs <= now;

  // Also catch missed ticks: schedule says a different claimed slot is active now.
  const scheduleActive = resolveActiveScheduleSlot(slots, now);
  const missedTick =
    !timerExpired &&
    Boolean(scheduleActive) &&
    Boolean(clock.activeSlotId) &&
    scheduleActive!.slotId !== clock.activeSlotId &&
    Number(scheduleActive!.startMs || 0) <= now;

  if (!timerExpired && !missedTick) {
    // Still inside current slot window — refresh metadata if schedule version changed.
    if (clock.scheduleVersion !== scheduleVersion) {
      const refreshed =
        slots.find((s) => s.slotId === clock.activeSlotId) || scheduleActive;
      if (refreshed) {
        const prevOwner = clock.activeOwnerUserId;
        writeSlotClock(live, { slot: refreshed, scheduleVersion, nowMs: now });
        changed = true;
        if (prevOwner !== refreshed.ownerUserId || clock.activeSlotId !== refreshed.slotId) {
          activeSlotUpdated = true;
          push("ACTIVE_SLOT_UPDATED", {
            scheduleVersion,
            oldSlotId: clock.activeSlotId,
            newSlotId: refreshed.slotId,
            oldOwnerId: prevOwner,
            newOwnerId: refreshed.ownerUserId,
            serverNow: now,
            slotStart: refreshed.startMs,
            slotEnd: refreshed.endMs,
            remainingMs: Math.max(0, refreshed.endMs - now),
            source: "schedule_version_refresh",
          });
        }
      } else {
        live.slotClock = { ...clock, scheduleVersion, serverNow: now };
        changed = true;
      }
    }
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  const outgoing =
    clockSlot ||
    ({
      slotId: clock.activeSlotId,
      slotNumber: 0,
      ownerUserId: clock.activeOwnerUserId,
      startMs: clock.activeSlotStartMs || 0,
      endMs: clock.activeSlotEndMs || now,
    } satisfies SlotScheduleEntry);

  push("SLOT_TIMER_EXPIRED", {
    scheduleVersion,
    oldSlotId: outgoing.slotId,
    oldOwnerId: outgoing.ownerUserId,
    newSlotId: "",
    newOwnerId: "",
    serverNow: now,
    slotStart: outgoing.startMs,
    slotEnd: outgoing.endMs,
    remainingMs: Math.min(0, remainingMs),
    reason: timerExpired ? "slot_end_lte_server_now" : "missed_tick_schedule_active_changed",
  });

  const incoming =
    (missedTick && scheduleActive) ||
    resolveIncomingSlotAfter(slots, outgoing, now) ||
    scheduleActive;

  if (!incoming) {
    abortReason = "next_slot_not_found";
    push("NEXT_SLOT_COMPUTED", {
      scheduleVersion,
      oldSlotId: outgoing.slotId,
      oldOwnerId: outgoing.ownerUserId,
      newSlotId: "",
      newOwnerId: "",
      serverNow: now,
      slotStart: outgoing.startMs,
      slotEnd: outgoing.endMs,
      remainingMs: 0,
      abortReason,
    });
    push("SLOT_PIPELINE_ABORT", {
      scheduleVersion,
      oldSlotId: outgoing.slotId,
      oldOwnerId: outgoing.ownerUserId,
      serverNow: now,
      abortReason,
    });
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  push("NEXT_SLOT_COMPUTED", {
    scheduleVersion,
    oldSlotId: outgoing.slotId,
    newSlotId: incoming.slotId,
    oldOwnerId: outgoing.ownerUserId,
    newOwnerId: incoming.ownerUserId,
    serverNow: now,
    slotStart: incoming.startMs,
    slotEnd: incoming.endMs,
    remainingMs: Math.max(0, incoming.endMs - now),
  });

  // Idempotent: already on this active slot.
  if (clock.activeSlotId === incoming.slotId && clock.activeOwnerUserId === incoming.ownerUserId) {
    push("ACTIVE_SLOT_UPDATED", {
      scheduleVersion,
      oldSlotId: outgoing.slotId,
      newSlotId: incoming.slotId,
      oldOwnerId: outgoing.ownerUserId,
      newOwnerId: incoming.ownerUserId,
      serverNow: now,
      slotStart: incoming.startMs,
      slotEnd: incoming.endMs,
      remainingMs: Math.max(0, incoming.endMs - now),
      source: "already_active",
      noop: true,
    });
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  // AUTHORITY: advance activeSlotId immediately — do not wait for media READY.
  writeSlotClock(live, { slot: incoming, scheduleVersion, nowMs: now });
  activeSlotUpdated = true;
  changed = true;
  push("ACTIVE_SLOT_UPDATED", {
    scheduleVersion,
    oldSlotId: outgoing.slotId,
    newSlotId: incoming.slotId,
    oldOwnerId: outgoing.ownerUserId,
    newOwnerId: incoming.ownerUserId,
    serverNow: now,
    slotStart: incoming.startMs,
    slotEnd: incoming.endMs,
    remainingMs: Math.max(0, incoming.endMs - now),
    source: "slot_timer_expired",
  });

  // If a transition to this incoming is already running, do not restart it.
  current = readSlotTransition(live);
  if (isSlotTransitionActive(current) && current.incomingSlotId === incoming.slotId) {
    push("SLOT_TRANSITION_START", {
      transitionId: current.transitionId,
      scheduleVersion,
      oldSlotId: outgoing.slotId,
      newSlotId: incoming.slotId,
      oldOwnerId: outgoing.ownerUserId,
      newOwnerId: incoming.ownerUserId,
      serverNow: now,
      slotStart: incoming.startMs,
      slotEnd: incoming.endMs,
      remainingMs: Math.max(0, incoming.endMs - now),
      source: "already_in_flight",
      noop: true,
    });
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  // Cancel a stale in-flight transition targeting a different slot.
  if (isSlotTransitionActive(current) && current.incomingSlotId !== incoming.slotId) {
    cancelled = cancelActiveSlotTransition(live, "superseded_by_new_active_slot", now);
    changed = true;
  }

  const boundaryTimestamp = Math.max(outgoing.endMs || 0, incoming.startMs || now, now);
  const transitionId = buildSlotTransitionId({
    outgoingSlotId: outgoing.slotId,
    incomingSlotId: incoming.slotId,
    scheduleVersion,
    boundaryTimestamp,
  });

  if (current.transitionId === transitionId && current.phase === "ready") {
    live.bigScreenOwnerUserId = incoming.ownerUserId;
    push("BIG_SCREEN_UPDATED", {
      transitionId,
      scheduleVersion,
      oldSlotId: outgoing.slotId,
      newSlotId: incoming.slotId,
      oldOwnerId: outgoing.ownerUserId,
      newOwnerId: incoming.ownerUserId,
      serverNow: now,
      source: "already_completed_transition",
    });
    return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
  }

  started = startTransitionOnLive(live, {
    outgoing,
    incoming,
    scheduleVersion,
    boundaryTimestamp,
    nowMs: now,
  });
  changed = true;
  push("SLOT_TRANSITION_START", {
    transitionId: started.transitionId,
    scheduleVersion,
    oldSlotId: outgoing.slotId,
    newSlotId: incoming.slotId,
    oldOwnerId: outgoing.ownerUserId,
    newOwnerId: incoming.ownerUserId,
    serverNow: now,
    slotStart: incoming.startMs,
    slotEnd: incoming.endMs,
    remainingMs: Math.max(0, incoming.endMs - now),
  });

  return { changed, started, cancelled, completed, activeSlotUpdated, abortReason, logs };
}

/** Explicit begin from a client that detected the boundary (still validated server-side). */
export function beginSlotTransitionFromClient(
  live: any,
  body: {
    scheduleVersion?: string;
    slots?: unknown;
    outgoingSlotId?: string;
    outgoingUserId?: string;
    incomingSlotId?: string;
    incomingUserId?: string;
    boundaryTimestamp?: number;
  },
  nowMs: number
): { ok: boolean; transition: SlotTransitionRecord; created: boolean; reason?: string } {
  const now = Number(nowMs) || Date.now();
  if (body.scheduleVersion || body.slots) {
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: String(body.scheduleVersion || live?.slotSchedule?.scheduleVersion || ""),
      slots: body.slots ?? live?.slotSchedule?.slots ?? [],
      nowMs: now,
    });
  }

  const beforeClock = readSlotClock(live);
  const beforeTransition = readSlotTransition(live);
  const result = reconcileLiveSlotTransition(live, now);
  const after = readSlotTransition(live);
  const afterClock = readSlotClock(live);

  if (result.activeSlotUpdated || result.started) {
    return {
      ok: true,
      transition: after,
      created: Boolean(result.started),
      reason: result.activeSlotUpdated ? "active_slot_updated" : "transition_started",
    };
  }

  if (isSlotTransitionActive(after) || afterClock.activeSlotId !== beforeClock.activeSlotId) {
    return { ok: true, transition: after, created: false, reason: "already_active" };
  }

  // Force path: client proposes boundary; only accept if outgoing ended.
  const slots = normalizeSlotScheduleEntries(live?.slotSchedule?.slots);
  const scheduleVersion = String(
    live?.slotSchedule?.scheduleVersion || body.scheduleVersion || ""
  ).trim();
  const incomingId = String(body.incomingSlotId || "").trim();
  const outgoingId = String(body.outgoingSlotId || "").trim();
  const incoming =
    slots.find((s) => s.slotId === incomingId) || resolveActiveScheduleSlot(slots, now);
  const outgoing =
    slots.find((s) => s.slotId === outgoingId) ||
    (outgoingId
      ? {
          slotId: outgoingId,
          slotNumber: 0,
          ownerUserId: String(body.outgoingUserId || "").trim(),
          startMs: 0,
          endMs: Number(body.boundaryTimestamp || now) || now,
        }
      : null);

  if (!incoming || !outgoing || !scheduleVersion) {
    pipelineLog("SLOT_PIPELINE_ABORT", {
      serverNow: now,
      abortReason: "missing_boundary_slots",
      oldSlotId: outgoingId,
      newSlotId: incomingId,
    });
    return { ok: false, transition: after, created: false, reason: "missing_boundary_slots" };
  }

  if (now + 250 < outgoing.endMs && outgoing.endMs > 0) {
    pipelineLog("SLOT_PIPELINE_ABORT", {
      transitionId: beforeTransition.transitionId,
      scheduleVersion,
      oldSlotId: outgoing.slotId,
      newSlotId: incoming.slotId,
      oldOwnerId: outgoing.ownerUserId,
      newOwnerId: incoming.ownerUserId,
      serverNow: now,
      slotEnd: outgoing.endMs,
      remainingMs: outgoing.endMs - now,
      abortReason: "outgoing_not_expired",
    });
    return { ok: false, transition: after, created: false, reason: "outgoing_not_expired" };
  }

  // Advance clock + start transition via reconcile after forcing clock onto outgoing.
  live.slotClock = {
    activeSlotId: outgoing.slotId,
    activeOwnerUserId: outgoing.ownerUserId,
    activeSlotStartMs: outgoing.startMs,
    activeSlotEndMs: outgoing.endMs,
    scheduleVersion,
    updatedAt: now,
    serverNow: now,
  } satisfies SlotClockState;

  const forced = reconcileLiveSlotTransition(live, Math.max(now, outgoing.endMs));
  return {
    ok: Boolean(forced.activeSlotUpdated || forced.started),
    transition: readSlotTransition(live),
    created: Boolean(forced.started),
    reason: forced.abortReason || undefined,
  };
}

export function applySlotTransitionProgress(
  live: any,
  userId: string,
  body: {
    transitionId?: string;
    phase?: SlotTransitionPhase;
    videoReady?: boolean;
    avatarFallback?: boolean;
    role?: "incoming" | "outgoing" | "remote";
  },
  nowMs: number
): {
  ok: boolean;
  transition: SlotTransitionRecord;
  completed?: SlotTransitionRecord | null;
  reason?: string;
} {
  const now = Number(nowMs) || Date.now();
  const current = readSlotTransition(live);
  const tid = String(body.transitionId || "").trim();
  if (!current.transitionId) {
    return { ok: false, transition: current, reason: "no_active_transition" };
  }
  if (tid && tid !== current.transitionId) {
    return { ok: false, transition: current, reason: "stale_transition_id" };
  }
  if (!isSlotTransitionActive(current)) {
    return { ok: true, transition: current, reason: "already_terminal" };
  }

  const uid = String(userId || "").trim();
  if (!uid) return { ok: false, transition: current, reason: "missing_user" };

  const phase = (body.phase || current.phase) as SlotTransitionPhase;
  const reports = { ...(current.reports || {}) };
  reports[uid] = {
    phase,
    at: now,
    videoReady: body.videoReady === true,
    avatarFallback: body.avatarFallback === true,
    role:
      body.role ||
      (uid === current.incomingUserId
        ? "incoming"
        : uid === current.outgoingUserId
          ? "outgoing"
          : "remote"),
  };

  let nextPhase = current.phase;
  const incomingReport = reports[current.incomingUserId];
  const earlyPhase =
    slotTransitionPhaseRank(phase) <= slotTransitionPhaseRank("confirming_room");
  if (incomingReport) {
    nextPhase = incomingReport.phase;
  } else if (
    earlyPhase &&
    slotTransitionPhaseRank(phase) > slotTransitionPhaseRank(nextPhase)
  ) {
    nextPhase = phase;
  }

  const updated: SlotTransitionRecord = {
    ...current,
    phase: nextPhase,
    reports,
    event: "SLOT_TRANSITION_START",
  };
  live.slotTransition = updated;

  const incomingReady =
    incomingReport &&
    (incomingReport.videoReady === true ||
      incomingReport.avatarFallback === true ||
      slotTransitionPhaseRank(incomingReport.phase) >= slotTransitionPhaseRank("entering_live"));

  if (incomingReady) {
    const completed = completeSlotTransitionReady(live, now, {
      avatarFallback: incomingReport?.videoReady !== true,
    });
    return { ok: true, transition: completed, completed };
  }

  return { ok: true, transition: updated };
}

export function slotTransitionLitePayload(transition: SlotTransitionRecord | null | undefined) {
  if (!transition?.transitionId) return null;
  return {
    transitionId: transition.transitionId,
    event: transition.event,
    phase: transition.phase,
    outgoingSlotId: transition.outgoingSlotId,
    outgoingUserId: transition.outgoingUserId,
    incomingSlotId: transition.incomingSlotId,
    incomingUserId: transition.incomingUserId,
    scheduleVersion: transition.scheduleVersion,
    boundaryTimestamp: transition.boundaryTimestamp,
    startedAt: transition.startedAt,
    readyAt: transition.readyAt,
    failedReason: transition.failedReason,
    bigScreenOwnerUserId: transition.bigScreenOwnerUserId,
  };
}

export function slotClockLitePayload(live: any) {
  const clock = readSlotClock(live);
  if (!clock.activeSlotId) return null;
  return {
    activeSlotId: clock.activeSlotId,
    activeOwnerUserId: clock.activeOwnerUserId,
    activeSlotStartMs: clock.activeSlotStartMs,
    activeSlotEndMs: clock.activeSlotEndMs,
    scheduleVersion: clock.scheduleVersion,
    updatedAt: clock.updatedAt,
    serverNow: clock.serverNow,
  };
}
