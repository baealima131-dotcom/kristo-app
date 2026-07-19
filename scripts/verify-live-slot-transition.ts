/**
 * Server-authoritative slot transition + activeSlotId clock.
 * Run: node --experimental-strip-types --test scripts/verify-live-slot-transition.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  beginSlotTransitionFromClient,
  buildSlotTransitionId,
  isSlotTransitionActive,
  readSlotClock,
  readSlotTransition,
  reconcileLiveSlotTransition,
  applySlotTransitionProgress,
  upsertSlotScheduleSnapshot,
} from "../lib/liveSlotTransition.ts";

const root = join(import.meta.dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function baseSlots(now: number) {
  return [
    {
      slotId: "s1",
      slotNumber: 1,
      ownerUserId: "u1",
      startMs: now - 60_000,
      endMs: now,
    },
    {
      slotId: "s2",
      slotNumber: 2,
      ownerUserId: "u2",
      startMs: now,
      endMs: now + 60_000,
    },
    {
      slotId: "s3",
      slotNumber: 3,
      ownerUserId: "u3",
      startMs: now + 60_000,
      endMs: now + 120_000,
    },
  ];
}

describe("reconcileLiveSlotTransition authority clock", () => {
  it("advances activeSlotId when slotEnd <= serverNow (does not wait for media READY)", () => {
    const now = 1_000_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v1",
      slots: baseSlots(now),
      nowMs: now - 30_000,
    });
    live.slotClock = {
      activeSlotId: "s1",
      activeOwnerUserId: "u1",
      activeSlotStartMs: now - 60_000,
      activeSlotEndMs: now,
      scheduleVersion: "v1",
      updatedAt: now - 30_000,
      serverNow: now - 30_000,
    };

    const result = reconcileLiveSlotTransition(live, now + 1);
    assert.equal(result.activeSlotUpdated, true);
    assert.ok(result.started);
    const clock = readSlotClock(live);
    assert.equal(clock.activeSlotId, "s2");
    assert.equal(clock.activeOwnerUserId, "u2");
    assert.ok(clock.activeSlotEndMs > now);
    const t = readSlotTransition(live);
    assert.equal(t.event, "SLOT_TRANSITION_START");
    assert.equal(t.incomingSlotId, "s2");
    assert.ok(isSlotTransitionActive(t));
  });

  it("logs pipeline events for timer expiry → active update → transition start", () => {
    const now = 1_100_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v1",
      slots: baseSlots(now),
      nowMs: now,
    });
    live.slotClock = {
      activeSlotId: "s1",
      activeOwnerUserId: "u1",
      activeSlotStartMs: now - 60_000,
      activeSlotEndMs: now,
      scheduleVersion: "v1",
      updatedAt: now,
      serverNow: now,
    };
    const result = reconcileLiveSlotTransition(live, now + 1);
    const events = result.logs.map((l) => l.event);
    assert.ok(events.includes("SLOT_TIMER_EXPIRED"));
    assert.ok(events.includes("NEXT_SLOT_COMPUTED"));
    assert.ok(events.includes("ACTIVE_SLOT_UPDATED"));
    assert.ok(events.includes("SLOT_TRANSITION_START"));
  });

  it("is idempotent for the same transitionId / active slot", () => {
    const now = 2_000_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v1",
      slots: baseSlots(now),
      nowMs: now,
    });
    live.slotClock = {
      activeSlotId: "s1",
      activeOwnerUserId: "u1",
      activeSlotStartMs: now - 60_000,
      activeSlotEndMs: now,
      scheduleVersion: "v1",
      updatedAt: now,
      serverNow: now,
    };
    const first = reconcileLiveSlotTransition(live, now + 1);
    assert.ok(first.started);
    assert.equal(readSlotClock(live).activeSlotId, "s2");
    const id = readSlotTransition(live).transitionId;
    const second = reconcileLiveSlotTransition(live, now + 2);
    assert.equal(second.started, null);
    assert.equal(readSlotTransition(live).transitionId, id);
    assert.equal(readSlotClock(live).activeSlotId, "s2");
  });

  it("cancels an active transition when scheduleVersion changes", () => {
    const now = 3_000_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v1",
      slots: baseSlots(now),
      nowMs: now,
    });
    live.slotClock = {
      activeSlotId: "s1",
      activeOwnerUserId: "u1",
      activeSlotStartMs: now - 60_000,
      activeSlotEndMs: now,
      scheduleVersion: "v1",
      updatedAt: now,
      serverNow: now,
    };
    reconcileLiveSlotTransition(live, now + 1);
    assert.ok(isSlotTransitionActive(readSlotTransition(live)));

    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v2",
      slots: baseSlots(now).map((s) =>
        s.slotId === "s2" ? { ...s, ownerUserId: "u9" } : s
      ),
      nowMs: now + 2,
    });
    const result = reconcileLiveSlotTransition(live, now + 3);
    assert.ok(result.cancelled || result.started);
    const clock = readSlotClock(live);
    assert.equal(clock.activeSlotId, "s2");
    assert.equal(clock.activeOwnerUserId, "u9");
  });

  it("completes media transition and sets BIG_SCREEN owner without restoring expired publisher", () => {
    const now = 4_000_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v1",
      slots: baseSlots(now),
      nowMs: now,
    });
    live.slotClock = {
      activeSlotId: "s1",
      activeOwnerUserId: "u1",
      activeSlotStartMs: now - 60_000,
      activeSlotEndMs: now,
      scheduleVersion: "v1",
      updatedAt: now,
      serverNow: now,
    };
    reconcileLiveSlotTransition(live, now + 1);
    assert.equal(readSlotClock(live).activeSlotId, "s2");
    const tid = readSlotTransition(live).transitionId;
    const progress = applySlotTransitionProgress(
      live,
      "u2",
      {
        transitionId: tid,
        phase: "entering_live",
        videoReady: true,
        role: "incoming",
      },
      now + 5
    );
    assert.ok(progress.completed);
    const t = readSlotTransition(live);
    assert.equal(t.event, "SLOT_TRANSITION_READY");
    assert.equal(t.bigScreenOwnerUserId, "u2");
    assert.notEqual(t.bigScreenOwnerUserId, "u1");
    assert.equal(live.bigScreenOwnerUserId, "u2");
  });

  it("aborts with next_slot_not_found when no incoming slot exists", () => {
    const now = 5_000_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    upsertSlotScheduleSnapshot(live, {
      scheduleVersion: "v1",
      slots: [
        {
          slotId: "only",
          slotNumber: 1,
          ownerUserId: "u1",
          startMs: now - 60_000,
          endMs: now,
        },
      ],
      nowMs: now,
    });
    live.slotClock = {
      activeSlotId: "only",
      activeOwnerUserId: "u1",
      activeSlotStartMs: now - 60_000,
      activeSlotEndMs: now,
      scheduleVersion: "v1",
      updatedAt: now,
      serverNow: now,
    };
    const result = reconcileLiveSlotTransition(live, now + 1);
    assert.equal(result.abortReason, "next_slot_not_found");
    assert.equal(result.started, null);
    assert.equal(readSlotClock(live).activeSlotId, "only");
  });
});

describe("beginSlotTransitionFromClient", () => {
  it("creates START and advances activeSlotId from a client boundary proposal", () => {
    const now = 6_000_000;
    const live: any = { liveId: "live1", churchId: "c1" };
    const begin = beginSlotTransitionFromClient(
      live,
      {
        scheduleVersion: "v1",
        slots: baseSlots(now),
        outgoingSlotId: "s1",
        outgoingUserId: "u1",
        incomingSlotId: "s2",
        incomingUserId: "u2",
        boundaryTimestamp: now,
      },
      now + 1
    );
    assert.equal(begin.ok, true);
    assert.equal(readSlotClock(live).activeSlotId, "s2");
    assert.equal(readSlotClock(live).activeOwnerUserId, "u2");
  });
});

describe("buildSlotTransitionId", () => {
  it("is stable for the same boundary inputs", () => {
    const a = buildSlotTransitionId({
      outgoingSlotId: "s1",
      incomingSlotId: "s2",
      scheduleVersion: "v1",
      boundaryTimestamp: 1000,
    });
    const b = buildSlotTransitionId({
      outgoingSlotId: "s1",
      incomingSlotId: "s2",
      scheduleVersion: "v1",
      boundaryTimestamp: 1000,
    });
    assert.equal(a, b);
  });
});

describe("wiring", () => {
  it("live API and mobile client reference the authority pipeline", () => {
    const api = read("app/api/church/live/route.ts");
    const core = read("lib/liveSlotTransition.ts");
    const client = read("apps/mobile/src/lib/liveSlotTransitionClient.ts");
    const soft = read("apps/mobile/src/lib/liveSlotSoftReentry.ts");
    const room = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/live-room.tsx"
    );
    assert.match(core, /SLOT_TIMER_EXPIRED/);
    assert.match(core, /NEXT_SLOT_COMPUTED/);
    assert.match(core, /ACTIVE_SLOT_UPDATED/);
    assert.match(core, /TRANSITION_FINISHED/);
    assert.match(api, /slot-transition-begin/);
    assert.match(api, /KRISTO_ACTIVE_SLOT_UPDATED/);
    assert.match(client, /performAutomaticSlotSoftReentry/);
    assert.match(client, /applyServerSlotClock/);
    assert.match(client, /tickSlotTransitionWatcher/);
    assert.match(soft, /KRISTO_SLOT_SOFT_REENTRY_START/);
    assert.match(soft, /KRISTO_SLOT_SOFT_REENTRY_UNPUBLISH_DONE/);
    assert.match(soft, /KRISTO_SLOT_SOFT_REENTRY_INCOMING_PUBLISHED/);
    assert.match(soft, /KRISTO_SLOT_SOFT_REENTRY_COMPLETED/);
    assert.match(room, /serverActiveOwnerId/);
    assert.match(room, /slotClock\?\.activeSlotId/);
    assert.match(room, /tickSlotTransitionWatcher/);
    assert.match(room, /retryAutomaticSlotSoftReentry/);
    assert.match(room, /KRISTO_LIVE_SLOT_AUTO_ADVANCE/);
  });
});
