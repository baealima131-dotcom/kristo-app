/**
 * Integration-style durability test for DM request relationship + quota.
 *
 * Uses the durable relationship store:
 * - Neon/Postgres when DATABASE_URL is set
 * - local data/ JSON when DATABASE_URL is absent (dev only)
 * - Vercel without DATABASE_URL hard-fails (no /tmp fallback)
 *
 * Run (tsx resolves @/ path aliases):
 *   npx --yes tsx --test scripts/verify-dm-request-persistence.ts
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { DM_REQUEST_MESSAGE_LIMIT } from "@/app/api/_lib/directMessageRequestLogic";

loadEnv({ path: join(process.cwd(), ".env.local") });
loadEnv({ path: join(process.cwd(), ".env") });

// Local verify uses data/ JSON when no DATABASE_URL. Clear inherited Vercel
// markers so ensureReady does not hard-fail outside Neon.
if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  delete process.env.VERCEL;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
}

const ROOM_ID = "dm:audit_user_a::audit_user_b";
const SENDER = "audit_user_a";
const RECEIVER = "audit_user_b";
const CHURCH = "audit_church_storage";

async function loadDb() {
  return import("@/app/api/_lib/store/directMessageRelationshipDb");
}

describe("DM request durable persistence", () => {
  let db: Awaited<ReturnType<typeof loadDb>>;

  before(async () => {
    db = await loadDb();
    await db.deleteDirectMessageRelationshipForTests(ROOM_ID);
  });

  after(async () => {
    await db.deleteDirectMessageRelationshipForTests(ROOM_ID);
  });

  it("persists request + quota across module reload (cold-start simulation)", async () => {
    assert.equal(DM_REQUEST_MESSAGE_LIMIT, 5);

    const backend = db.getDirectMessageRelationshipPersistenceBackend();
    assert.ok(
      backend === "neon-postgres" || backend === "local-json-data-dir",
      `unexpected backend: ${backend}`
    );

    const created = await db.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "pending",
      requestInitiatorUserId: SENDER,
      sameChurchAtCreation: false,
    });
    assert.equal(created.requestStatus, "pending");
    assert.equal(created.requestInitiatorUserId, SENDER);
    assert.equal(created.initiatorOutboundCount, 0);

    for (let i = 1; i <= DM_REQUEST_MESSAGE_LIMIT - 1; i += 1) {
      const claim = await db.claimInitiatorOutboundSlotAtomic({
        roomId: ROOM_ID,
        senderUserId: SENDER,
        limit: DM_REQUEST_MESSAGE_LIMIT,
      });
      assert.equal(claim.ok, true, `claim ${i}`);
      if (claim.ok) assert.equal(claim.count, i);
    }

    // Simulate new process / cold start: re-import module with cache bust.
    const bust = `${pathToFileURL(
      join(process.cwd(), "app/api/_lib/store/directMessageRelationshipDb.ts")
    ).href}?t=${Date.now()}`;
    const reloaded = await import(bust);

    const afterReload = await reloaded.getDirectMessageRelationshipByRoomId(
      ROOM_ID
    );
    assert.ok(afterReload, "relationship must survive reload");
    assert.equal(
      afterReload.initiatorOutboundCount,
      DM_REQUEST_MESSAGE_LIMIT - 1
    );
    assert.equal(afterReload.requestStatus, "pending");

    const fifth = await reloaded.claimInitiatorOutboundSlotAtomic({
      roomId: ROOM_ID,
      senderUserId: SENDER,
      limit: DM_REQUEST_MESSAGE_LIMIT,
    });
    assert.equal(fifth.ok, true);
    if (fifth.ok) assert.equal(fifth.count, DM_REQUEST_MESSAGE_LIMIT);

    const sixth = await reloaded.claimInitiatorOutboundSlotAtomic({
      roomId: ROOM_ID,
      senderUserId: SENDER,
      limit: DM_REQUEST_MESSAGE_LIMIT,
    });
    assert.equal(sixth.ok, false);
    if (!sixth.ok) {
      assert.equal(sixth.code, "DM_REQUEST_MESSAGE_LIMIT_REACHED");
      assert.equal(sixth.limit, 5);
      assert.equal(sixth.remainingMessages, 0);
    }

    const accepted = await reloaded.updateDirectMessageRelationshipStatus({
      roomId: ROOM_ID,
      actorUserId: RECEIVER,
      action: "accept",
    });
    assert.equal(accepted.ok, true);

    const bust2 = `${pathToFileURL(
      join(process.cwd(), "app/api/_lib/store/directMessageRelationshipDb.ts")
    ).href}?t=${Date.now() + 1}`;
    const reloaded2 = await import(bust2);
    const afterAccept = await reloaded2.getDirectMessageRelationshipByRoomId(
      ROOM_ID
    );
    assert.ok(afterAccept);
    assert.equal(afterAccept.requestStatus, "accepted");
    assert.equal(afterAccept.initiatorOutboundCount, DM_REQUEST_MESSAGE_LIMIT);

    await reloaded2.deleteDirectMessageRelationshipForTests(ROOM_ID);
    await reloaded2.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "pending",
      requestInitiatorUserId: SENDER,
      sameChurchAtCreation: false,
    });
    const selfAccept = await reloaded2.updateDirectMessageRelationshipStatus({
      roomId: ROOM_ID,
      actorUserId: SENDER,
      action: "accept",
    });
    assert.equal(selfAccept.ok, false);
    if (!selfAccept.ok) {
      assert.equal(selfAccept.code, "DM_REQUEST_RECEIVER_ONLY");
    }

    const dup = await reloaded2.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: "other_church_attempt",
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "pending",
      requestInitiatorUserId: SENDER,
      sameChurchAtCreation: false,
    });
    assert.equal(dup.storageChurchId, CHURCH);

    // Safe repair: reversed empty pending → profile opener becomes initiator.
    await reloaded2.deleteDirectMessageRelationshipForTests(ROOM_ID);
    await reloaded2.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "pending",
      requestInitiatorUserId: RECEIVER, // reversed
      sameChurchAtCreation: false,
    });
    const repaired = await reloaded2.repairReversedEmptyPendingInitiator({
      roomId: ROOM_ID,
      authenticatedOpenerUserId: SENDER,
    });
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.record?.requestInitiatorUserId, SENDER);

    // Do not repair after outbound messages exist.
    await reloaded2.claimInitiatorOutboundSlotAtomic({
      roomId: ROOM_ID,
      senderUserId: SENDER,
      limit: DM_REQUEST_MESSAGE_LIMIT,
    });
    const noRepair = await reloaded2.repairReversedEmptyPendingInitiator({
      roomId: ROOM_ID,
      authenticatedOpenerUserId: RECEIVER,
    });
    assert.equal(noRepair.repaired, false);
    assert.equal(noRepair.record?.requestInitiatorUserId, SENDER);

    // Decline is not forever: either party can restart a fresh invite.
    await reloaded2.deleteDirectMessageRelationshipForTests(ROOM_ID);
    await reloaded2.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "pending",
      requestInitiatorUserId: SENDER,
      sameChurchAtCreation: false,
    });
    for (let i = 0; i < 2; i += 1) {
      await reloaded2.claimInitiatorOutboundSlotAtomic({
        roomId: ROOM_ID,
        senderUserId: SENDER,
        limit: DM_REQUEST_MESSAGE_LIMIT,
      });
    }
    const declined = await reloaded2.updateDirectMessageRelationshipStatus({
      roomId: ROOM_ID,
      actorUserId: RECEIVER,
      action: "decline",
    });
    assert.equal(declined.ok, true);

    const restartBySender = await reloaded2.restartMessageRequestAsPending({
      roomId: ROOM_ID,
      initiatorUserId: SENDER,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
    });
    assert.equal(restartBySender.ok, true);
    if (restartBySender.ok) {
      assert.equal(restartBySender.record.requestStatus, "pending");
      assert.equal(restartBySender.record.requestInitiatorUserId, SENDER);
      assert.equal(restartBySender.record.initiatorOutboundCount, 0);
      assert.equal(restartBySender.record.declinedAt, null);
    }

    const declinedAgain = await reloaded2.updateDirectMessageRelationshipStatus({
      roomId: ROOM_ID,
      actorUserId: RECEIVER,
      action: "decline",
    });
    assert.equal(declinedAgain.ok, true);

    // Decliner can become the new initiator.
    const restartByReceiver = await reloaded2.restartMessageRequestAsPending({
      roomId: ROOM_ID,
      initiatorUserId: RECEIVER,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
    });
    assert.equal(restartByReceiver.ok, true);
    if (restartByReceiver.ok) {
      assert.equal(restartByReceiver.record.requestInitiatorUserId, RECEIVER);
      assert.equal(restartByReceiver.record.initiatorOutboundCount, 0);
    }

    // Unblock resets to none (not accepted).
    const reset = await reloaded2.resetDirectMessageRelationshipToNone(ROOM_ID);
    assert.ok(reset);
    assert.equal(reset.requestStatus, "none");
    assert.equal(reset.requestInitiatorUserId, "");
    assert.equal(reset.initiatorOutboundCount, 0);

    const afterNone = await reloaded2.restartMessageRequestAsPending({
      roomId: ROOM_ID,
      initiatorUserId: RECEIVER,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
    });
    assert.equal(afterNone.ok, true);
    if (afterNone.ok) {
      assert.equal(afterNone.record.requestInitiatorUserId, RECEIVER);
    }

    // Accepted cannot be restarted into a new pending invite.
    await reloaded2.updateDirectMessageRelationshipStatus({
      roomId: ROOM_ID,
      actorUserId: SENDER,
      action: "accept",
    });
    const noRestartAccepted = await reloaded2.restartMessageRequestAsPending({
      roomId: ROOM_ID,
      initiatorUserId: RECEIVER,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
    });
    assert.equal(noRestartAccepted.ok, false);

    console.log("KRISTO_DM_REQUEST_PERSISTENCE_BACKEND", {
      backend: reloaded2.getDirectMessageRelationshipPersistenceBackend(),
      roomId: ROOM_ID,
    });
  });
});
