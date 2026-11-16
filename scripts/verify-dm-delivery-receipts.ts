/**
 * DM delivery / read receipts (WhatsApp-style ticks).
 *
 * Proves: delivery is recorded only when the recipient's app fetches the peer's messages
 * (inbox or chat), never moves backwards, never rewrites when nothing changed, never touches
 * message rows; read is reported only when both users allow read receipts, while delivery is
 * always reported; threads stored before the field existed still work.
 *
 * Run: npx --yes tsx --test scripts/verify-dm-delivery-receipts.ts
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env.local") });
loadEnv({ path: join(process.cwd(), ".env") });

// Force local JSON stores so this verify never touches any database.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

const SENDER = "dm_receipts_user_a";
const RECEIVER = "dm_receipts_user_b";
const CHURCH = "dm_receipts_church";
const ROOM_ID = "dm:dm_receipts_user_a::dm_receipts_user_b";
const THREAD_KEY = `${CHURCH}::${ROOM_ID}`;
const T1 = 1_790_000_000_000;
const T2 = T1 + 60_000;
const T3 = T2 + 60_000;

describe("DM delivery and read receipts", () => {
  let dm: typeof import("@/app/api/_lib/directMessages");
  let relDb: typeof import("@/app/api/_lib/store/directMessageRelationshipDb");
  let threadDb: typeof import("@/app/api/_lib/store/directMessageThreadDb");
  let roomDb: typeof import("@/app/api/_lib/store/roomMessageDb");
  let privacyDb: typeof import("@/app/api/_lib/store/messagePrivacySettingsDb");

  const message = (id: string, senderUserId: string, createdAt: number) => ({
    id,
    roomId: ROOM_ID,
    churchId: CHURCH,
    senderUserId,
    text: `receipt test ${id}`,
    createdAt,
    attachments: [],
    deletedFor: [],
  });

  async function writeMessages(rows: any[]) {
    const existing = await roomDb.readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
    await roomDb.writeRoomMessagesJsonFile("room-messages.json", { ...existing, [THREAD_KEY]: rows });
  }

  async function readMessages() {
    const store = await roomDb.readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
    return store[THREAD_KEY] || [];
  }

  async function threadRecord() {
    const store = await threadDb.readDirectMessageThreadStore<Record<string, any>>({});
    return store[THREAD_KEY];
  }

  async function senderView() {
    return dm.getDirectMessageConversationSettings({ churchId: CHURCH, roomId: ROOM_ID, userId: SENDER });
  }

  async function dropTestThread() {
    await threadDb.updateDirectMessageThreadStore<Record<string, any>>((current) => {
      const next = current && typeof current === "object" ? { ...current } : {};
      for (const key of Object.keys(next)) {
        if (key.endsWith(`::${ROOM_ID}`) || next[key]?.roomId === ROOM_ID) delete next[key];
      }
      return next;
    }, {});
  }

  before(async () => {
    relDb = await import("@/app/api/_lib/store/directMessageRelationshipDb");
    threadDb = await import("@/app/api/_lib/store/directMessageThreadDb");
    roomDb = await import("@/app/api/_lib/store/roomMessageDb");
    privacyDb = await import("@/app/api/_lib/store/messagePrivacySettingsDb");
    dm = await import("@/app/api/_lib/directMessages");

    await relDb.deleteDirectMessageRelationshipForTests(ROOM_ID);
    await relDb.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: CHURCH,
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "accepted",
      requestInitiatorUserId: SENDER,
      sameChurchAtCreation: false,
    });
    await dropTestThread();
    // A thread exactly as stored before delivery tracking existed (no deliveredAtByUserId).
    await threadDb.updateDirectMessageThreadStore<Record<string, any>>(
      (current) => ({
        ...(current && typeof current === "object" ? current : {}),
        [THREAD_KEY]: {
          roomId: ROOM_ID,
          churchId: CHURCH,
          participantUserIds: [SENDER, RECEIVER],
          createdAt: T1 - 1000,
          updatedAt: T1 - 1000,
          readAtByUserId: {},
          createdByUserId: SENDER,
          requestStatus: "accepted",
          requestInitiatorUserId: SENDER,
          acceptedAt: T1 - 500,
        },
      }),
      {}
    );
    await writeMessages([message("m1", SENDER, T1), message("m2", SENDER, T2)]);
    for (const userId of [SENDER, RECEIVER]) {
      await privacyDb.patchMessagePrivacySettings({ userId, patch: { showReadReceipts: true } as any });
    }
  });

  after(async () => {
    await relDb.deleteDirectMessageRelationshipForTests(ROOM_ID);
    await dropTestThread();
    const existing = await roomDb.readRoomMessagesJsonFile<Record<string, any[]>>("room-messages.json", {});
    const next = { ...existing };
    delete next[THREAD_KEY];
    await roomDb.writeRoomMessagesJsonFile("room-messages.json", next);
  });

  it("legacy thread without the field: nothing is delivered or read yet", async () => {
    const view = await senderView();
    assert.equal(view.peerDeliveredAt, 0);
    assert.equal(view.peerReadAt, 0);
    assert.equal(view.showReadReceipts, true);
  });

  it("sender's own inbox does not mark their messages delivered", async () => {
    await dm.listDirectMessageInbox({ churchId: CHURCH, viewerUserId: SENDER });
    assert.equal((await threadRecord())?.deliveredAtByUserId, undefined);
    assert.equal((await senderView()).peerDeliveredAt, 0);
  });

  it("recipient's inbox fetch marks delivery up to the newest message it showed", async () => {
    await dm.listDirectMessageInbox({ churchId: CHURCH, viewerUserId: RECEIVER });
    assert.deepEqual((await threadRecord())?.deliveredAtByUserId, { [RECEIVER]: T2 });
    const view = await senderView();
    assert.equal(view.peerDeliveredAt, T2, "both messages (T1, T2) are delivered");
    assert.equal(view.peerReadAt, 0, "delivered is not read");
  });

  it("repeat fetches with nothing new do not write", async () => {
    const before = JSON.stringify(await threadDb.readDirectMessageThreadStore({}));
    const changed = await dm.markDirectMessagesDelivered([
      { churchId: CHURCH, roomId: ROOM_ID, userId: RECEIVER, upToCreatedAt: T2 },
    ]);
    assert.equal(changed, 0);
    assert.equal(JSON.stringify(await threadDb.readDirectMessageThreadStore({})), before);
    // (The inbox itself may refresh updatedAt from the relationship — existing behavior.)
    await dm.listDirectMessageInbox({ churchId: CHURCH, viewerUserId: RECEIVER });
    assert.deepEqual((await threadRecord())?.deliveredAtByUserId, { [RECEIVER]: T2 });
  });

  it("delivery never moves backwards and rejects non-participants", async () => {
    assert.equal(
      await dm.markDirectMessagesDelivered([
        { churchId: CHURCH, roomId: ROOM_ID, userId: RECEIVER, upToCreatedAt: T1 },
        { churchId: CHURCH, roomId: ROOM_ID, userId: "dm_receipts_stranger", upToCreatedAt: T3 },
        { churchId: CHURCH, roomId: "church-media-room", userId: RECEIVER, upToCreatedAt: T3 },
      ]),
      0
    );
    assert.deepEqual((await threadRecord())?.deliveredAtByUserId, { [RECEIVER]: T2 });
  });

  it("a new message is 'sent' (not delivered) until the recipient fetches it", async () => {
    await writeMessages([message("m1", SENDER, T1), message("m2", SENDER, T2), message("m3", SENDER, T3)]);
    assert.ok((await senderView()).peerDeliveredAt < T3, "m3 is only sent");
    // The chat GET reports the newest peer message it returned.
    assert.equal(
      await dm.markDirectMessagesDelivered([
        { churchId: CHURCH, roomId: ROOM_ID, userId: RECEIVER, upToCreatedAt: T3 },
      ]),
      1
    );
    assert.equal((await senderView()).peerDeliveredAt, T3);
  });

  it("delivery tracking never changes message rows or other thread fields", async () => {
    const rows = await readMessages();
    assert.deepEqual(
      rows.map((m: any) => m.id),
      ["m1", "m2", "m3"]
    );
    const record = await threadRecord();
    assert.equal(record.requestStatus, "accepted");
    assert.deepEqual(record.participantUserIds, [SENDER, RECEIVER]);
    assert.deepEqual(record.readAtByUserId, {});
  });

  it("a stale thread copy written later never erases a newer read receipt", async () => {
    // What the inbox does on every poll: it reads the record, awaits other I/O, then writes its
    // copy back. Meanwhile the peer reads the chat. The newer read must survive the stale copy.
    const staleCopy = JSON.parse(JSON.stringify(await threadRecord()));
    const before = Date.now();
    await dm.markDirectMessageThreadRead({ churchId: CHURCH, roomId: ROOM_ID, userId: RECEIVER });
    const readAt = Number((await threadRecord())?.readAtByUserId?.[RECEIVER] || 0);
    assert.ok(readAt >= before);

    await dm.upsertDirectMessageThreadRecordForTests(THREAD_KEY, staleCopy);
    const after = await threadRecord();
    assert.equal(after.readAtByUserId?.[RECEIVER], readAt, "stale copy must not erase the read");
    assert.ok(Number(after.deliveredAtByUserId?.[RECEIVER] || 0) >= T3, "nor the delivery");

    // A real newer write still lands (the merge keeps the later time, not the first one).
    const newer = { ...after, readAtByUserId: { ...after.readAtByUserId, [RECEIVER]: readAt + 5000 } };
    await dm.upsertDirectMessageThreadRecordForTests(THREAD_KEY, newer);
    assert.equal((await threadRecord()).readAtByUserId?.[RECEIVER], readAt + 5000);
  });

  it("inbox rows carry receipts only for the viewer's own latest message", async () => {
    const senderRow = (await dm.listDirectMessageInbox({ churchId: CHURCH, viewerUserId: SENDER })).find(
      (row) => row.roomId === ROOM_ID
    );
    assert.ok(senderRow);
    assert.equal(senderRow.lastMessageFromViewer, true, "sender wrote the latest message");
    assert.equal(senderRow.lastMessageAt, T3);
    assert.ok(Number(senderRow.peerDeliveredAt) >= T3, "delivered to the receiver");
    assert.equal(senderRow.showReadReceipts, true);
    assert.ok(Number(senderRow.peerReadAt) >= T3, "read (both allow receipts)");
    assert.equal(senderRow.peerRingCategory, "unknown", "no verified membership in this test");

    const receiverRow = (await dm.listDirectMessageInbox({ churchId: CHURCH, viewerUserId: RECEIVER })).find(
      (row) => row.roomId === ROOM_ID
    );
    assert.ok(receiverRow);
    assert.equal(receiverRow.lastMessageFromViewer, false, "no outgoing ticks for the peer's message");
  });

  it("avatar ring categories come only from verified memberships", async () => {
    const { personRingCategoryFor } = await import("@/app/api/_lib/personRelations");
    assert.equal(personRingCategoryFor("c1", { churchId: "c1", churchRole: "Pastor" }), "myChurchPastor");
    assert.equal(personRingCategoryFor("c1", { churchId: "c1", churchRole: "Member" }), "myChurchMember");
    assert.equal(personRingCategoryFor("c1", { churchId: "c2", churchRole: "Pastor" }), "otherChurchPastor");
    assert.equal(personRingCategoryFor("c1", { churchId: "c2", churchRole: "Leader" }), "otherChurchMember");
    assert.equal(personRingCategoryFor("", { churchId: "c2", churchRole: "Member" }), "otherChurchMember");
    assert.equal(personRingCategoryFor("c1", undefined), "unknown", "no active membership");
    assert.equal(personRingCategoryFor("c1", { churchId: "c1", churchRole: "" }), "unknown", "no role");
  });

  it("read is shown only when both users allow read receipts; delivery always", async () => {
    await dm.markDirectMessageThreadRead({ churchId: CHURCH, roomId: ROOM_ID, userId: RECEIVER });
    let view = await senderView();
    assert.ok(view.peerReadAt >= T3, "both allow receipts: read visible");

    await privacyDb.patchMessagePrivacySettings({ userId: RECEIVER, patch: { showReadReceipts: false } as any });
    view = await senderView();
    assert.equal(view.showReadReceipts, false);
    assert.equal(view.peerReadAt, 0, "recipient turned receipts off: read hidden");
    assert.ok(view.peerDeliveredAt >= T3, "delivery still visible");

    await privacyDb.patchMessagePrivacySettings({ userId: RECEIVER, patch: { showReadReceipts: true } as any });
    await privacyDb.patchMessagePrivacySettings({ userId: SENDER, patch: { showReadReceipts: false } as any });
    view = await senderView();
    assert.equal(view.peerReadAt, 0, "sender turned receipts off: read hidden too");
    assert.ok(view.peerDeliveredAt >= T3);
    await privacyDb.patchMessagePrivacySettings({ userId: SENDER, patch: { showReadReceipts: true } as any });
  });
});
