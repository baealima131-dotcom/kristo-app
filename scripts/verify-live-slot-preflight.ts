/**
 * Next-slot Big Screen preflight rules.
 * Run: node --experimental-strip-types --test scripts/verify-live-slot-preflight.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  liveSlotPreflightKey,
  liveSlotPublisherIdentity,
  resolveNextClaimedSlotForPreflight,
} from "../apps/mobile/src/lib/liveSlotPreflightCore.ts";

const root = join(import.meta.dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("resolveNextClaimedSlotForPreflight", () => {
  const now = 1_000_000;

  it("returns only the soonest upcoming claimed slot", () => {
    const next = resolveNextClaimedSlotForPreflight(
      [
        {
          id: "s1",
          slot: 1,
          claimedByUserId: "u1",
          claimedByName: "A",
          startMs: now - 60_000,
          endMs: now + 60_000,
        },
        {
          id: "s2",
          slot: 2,
          claimedByUserId: "u2",
          claimedByName: "B",
          startMs: now + 60_000,
          endMs: now + 120_000,
          claimedByAvatarUri: "https://cdn.example/b.png",
        },
        {
          id: "s3",
          slot: 3,
          claimedByUserId: "u3",
          claimedByName: "C",
          startMs: now + 120_000,
          endMs: now + 180_000,
        },
      ],
      now
    );
    assert.ok(next);
    assert.equal(next!.id, "s2");
    assert.equal(next!.ownerUserId, "u2");
    assert.equal(next!.avatarUri, "https://cdn.example/b.png");
  });

  it("skips unclaimed upcoming slots", () => {
    const next = resolveNextClaimedSlotForPreflight(
      [
        {
          id: "open",
          slot: 2,
          startMs: now + 10_000,
          endMs: now + 70_000,
        },
        {
          id: "claimed",
          slot: 3,
          claimedByUserId: "u9",
          claimedByName: "Z",
          startMs: now + 70_000,
          endMs: now + 130_000,
        },
      ],
      now
    );
    assert.ok(next);
    assert.equal(next!.id, "claimed");
  });

  it("returns null when no upcoming claimed slots", () => {
    const next = resolveNextClaimedSlotForPreflight(
      [
        {
          id: "past",
          slot: 1,
          claimedByUserId: "u1",
          startMs: now - 120_000,
          endMs: now - 60_000,
        },
      ],
      now
    );
    assert.equal(next, null);
  });

  it("builds stable publisher identity", () => {
    assert.equal(
      liveSlotPublisherIdentity("u_996c-abc!", 2),
      "u_996cabc-slot-2"
    );
  });

  it("changes key when next owner is replaced", () => {
    const a = liveSlotPreflightKey({
      liveBridgeId: "live_1",
      slotId: "s2",
      ownerUserId: "u_old",
      slotNumber: 2,
      startMs: 100,
    });
    const b = liveSlotPreflightKey({
      liveBridgeId: "live_1",
      slotId: "s2",
      ownerUserId: "u_new",
      slotNumber: 2,
      startMs: 100,
    });
    assert.notEqual(a, b);
  });
});

describe("live-room wiring (source)", () => {
  it("wires rolling preflight and promotion logs", () => {
    const mod = read("apps/mobile/src/lib/liveSlotPreflight.ts");
    const core = read("apps/mobile/src/lib/liveSlotPreflightCore.ts");
    const room = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/live-room.tsx"
    );
    assert.ok(mod.includes("KRISTO_SLOT_PREFLIGHT_START"));
    assert.ok(mod.includes("KRISTO_SLOT_PREFLIGHT_READY"));
    assert.ok(mod.includes("KRISTO_SLOT_PREFLIGHT_CANCELLED"));
    assert.ok(mod.includes("KRISTO_SLOT_PREFLIGHT_FAILED"));
    assert.ok(mod.includes("KRISTO_SLOT_PROMOTED_TO_BIG_SCREEN"));
    assert.ok(mod.includes("localUserIsActiveSpeaker"));
    assert.ok(core.includes("resolveNextClaimedSlotForPreflight"));
    assert.ok(room.includes("syncLiveSlotPreflight"));
    assert.ok(room.includes("noteLiveSlotPromotedToBigScreen"));
    assert.ok(room.includes("resolveNextClaimedSlotForPreflight"));
  });

  it("wires automatic slot soft re-entry at boundaries", () => {
    const soft = read("apps/mobile/src/lib/liveSlotSoftReentry.ts");
    const client = read("apps/mobile/src/lib/liveSlotTransitionClient.ts");
    const room = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/live-room.tsx"
    );
    assert.ok(soft.includes("KRISTO_SLOT_SOFT_REENTRY_START"));
    assert.ok(soft.includes("KRISTO_SLOT_SOFT_REENTRY_UNPUBLISH_DONE"));
    assert.ok(soft.includes("KRISTO_SLOT_SOFT_REENTRY_ROOM_RECONNECTED"));
    assert.ok(soft.includes("KRISTO_SLOT_SOFT_REENTRY_INCOMING_PUBLISHED"));
    assert.ok(soft.includes("KRISTO_SLOT_SOFT_REENTRY_COMPLETED"));
    assert.ok(soft.includes("performAutomaticSlotSoftReentry"));
    assert.ok(client.includes("tickSlotTransitionWatcher"));
    assert.ok(client.includes("performAutomaticSlotSoftReentry"));
    assert.ok(room.includes("tickSlotTransitionWatcher"));
    assert.ok(room.includes("retryAutomaticSlotSoftReentry"));
    assert.ok(room.includes("KRISTO_LIVE_SLOT_AUTO_ADVANCE"));
    assert.ok(room.includes("fromBoundaryHandoff: true"));
  });
});
