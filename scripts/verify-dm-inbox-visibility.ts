/**
 * Cross-church DM inbox / room-read visibility.
 *
 * Proves receiver listing is participant-based and message reads use
 * storageChurchId — not the receiver's session church header.
 *
 * Run: npx --yes tsx --test scripts/verify-dm-inbox-visibility.ts
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: join(process.cwd(), ".env.local") });
loadEnv({ path: join(process.cwd(), ".env") });

// Force local JSON stores so this verify never mutates production Neon.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.VERCEL;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

const SENDER = "inbox_vis_user_a";
const RECEIVER = "inbox_vis_user_b";
const STORAGE_CHURCH = "inbox_vis_church_a";
const RECEIVER_CHURCH = "inbox_vis_church_b";
const ROOM_ID = "dm:inbox_vis_user_a::inbox_vis_user_b";
const MESSAGE_ID = "rm_inbox_vis_1";
const MESSAGE_TEXT = "CrossChurchHello";

describe("cross-church DM inbox visibility", () => {
  let listDirectMessageInbox: typeof import("@/app/api/_lib/directMessages").listDirectMessageInbox;
  let resolveDirectMessageStorageChurchId: typeof import("@/app/api/_lib/directMessages").resolveDirectMessageStorageChurchId;
  let isParticipantInDirectRoom: typeof import("@/app/api/_lib/directMessages").isParticipantInDirectRoom;
  let relDb: typeof import("@/app/api/_lib/store/directMessageRelationshipDb");
  let threadDb: typeof import("@/app/api/_lib/store/directMessageThreadDb");
  let roomDb: typeof import("@/app/api/_lib/store/roomMessageDb");

  before(async () => {
    relDb = await import("@/app/api/_lib/store/directMessageRelationshipDb");
    threadDb = await import("@/app/api/_lib/store/directMessageThreadDb");
    roomDb = await import("@/app/api/_lib/store/roomMessageDb");
    const dm = await import("@/app/api/_lib/directMessages");
    listDirectMessageInbox = dm.listDirectMessageInbox;
    resolveDirectMessageStorageChurchId = dm.resolveDirectMessageStorageChurchId;
    isParticipantInDirectRoom = dm.isParticipantInDirectRoom;

    await relDb.deleteDirectMessageRelationshipForTests(ROOM_ID);

    await relDb.upsertDirectMessageRelationship({
      roomId: ROOM_ID,
      storageChurchId: STORAGE_CHURCH,
      participantUserIds: [SENDER, RECEIVER],
      requestStatus: "pending",
      requestInitiatorUserId: SENDER,
      sameChurchAtCreation: false,
    });

    const threadKey = `${STORAGE_CHURCH}::${ROOM_ID}`;
    await threadDb.updateDirectMessageThreadStore<Record<string, any>>(
      (current) => {
        const next = current && typeof current === "object" ? { ...current } : {};
        // Drop any prior test keys for this room under either church.
        for (const key of Object.keys(next)) {
          if (key.endsWith(`::${ROOM_ID}`) || next[key]?.roomId === ROOM_ID) {
            delete next[key];
          }
        }
        next[threadKey] = {
          roomId: ROOM_ID,
          churchId: STORAGE_CHURCH,
          participantUserIds: [SENDER, RECEIVER],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          readAtByUserId: {},
          createdByUserId: SENDER,
          requestStatus: "pending",
          requestInitiatorUserId: SENDER,
          requestOutboundCountByUserId: { [SENDER]: 1 },
        };
        return next;
      },
      {}
    );

    const storeKey = `${STORAGE_CHURCH}::${ROOM_ID}`;
    const wrongKey = `${RECEIVER_CHURCH}::${ROOM_ID}`;
    await roomDb.writeRoomMessagesJsonFile(
      "room-messages.json",
      await (async () => {
        const existing = await roomDb.readRoomMessagesJsonFile<
          Record<string, any[]>
        >("room-messages.json", {});
        const next = { ...existing };
        delete next[wrongKey];
        next[storeKey] = [
          {
            id: MESSAGE_ID,
            roomId: ROOM_ID,
            churchId: STORAGE_CHURCH,
            senderUserId: SENDER,
            text: MESSAGE_TEXT,
            createdAt: Date.now(),
            attachments: [],
            deletedFor: [],
          },
        ];
        return next;
      })()
    );
  });

  after(async () => {
    await relDb.deleteDirectMessageRelationshipForTests(ROOM_ID);
    await threadDb.updateDirectMessageThreadStore<Record<string, any>>(
      (current) => {
        const next = current && typeof current === "object" ? { ...current } : {};
        for (const key of Object.keys(next)) {
          if (key.endsWith(`::${ROOM_ID}`) || next[key]?.roomId === ROOM_ID) {
            delete next[key];
          }
        }
        return next;
      },
      {}
    );
    const existing = await roomDb.readRoomMessagesJsonFile<
      Record<string, any[]>
    >("room-messages.json", {});
    const next = { ...existing };
    delete next[`${STORAGE_CHURCH}::${ROOM_ID}`];
    delete next[`${RECEIVER_CHURCH}::${ROOM_ID}`];
    await roomDb.writeRoomMessagesJsonFile("room-messages.json", next);
  });

  it("receiver inbox includes pending room despite different header church", async () => {
    assert.equal(isParticipantInDirectRoom(ROOM_ID, RECEIVER), true);
    assert.equal(isParticipantInDirectRoom(ROOM_ID, "stranger_user"), false);

    const resolved = await resolveDirectMessageStorageChurchId({
      roomId: ROOM_ID,
      fallbackChurchId: RECEIVER_CHURCH,
    });
    assert.equal(resolved, STORAGE_CHURCH);

    const inbox = await listDirectMessageInbox({
      churchId: RECEIVER_CHURCH,
      viewerUserId: RECEIVER,
    });

    const row = inbox.find((item) => item.roomId === ROOM_ID);
    assert.ok(row, "receiver inbox must include the cross-church room");
    assert.equal(row.relationshipStatus, "request_pending");
    assert.equal(row.requestInitiatorUserId, SENDER);
    assert.equal(row.isRequestReceiver, true);
    assert.equal(row.isRequestInitiator, false);
    assert.equal(row.peerUserId, SENDER);
    assert.equal(row.subtitle, "Message request");
    assert.equal(row.lastMessagePreview, MESSAGE_TEXT);
    assert.equal(row.churchId, STORAGE_CHURCH);
    assert.ok(Number(row.unreadCount || 0) >= 1);

    const strangerInbox = await listDirectMessageInbox({
      churchId: RECEIVER_CHURCH,
      viewerUserId: "stranger_user",
    });
    assert.equal(
      strangerInbox.some((item) => item.roomId === ROOM_ID),
      false,
      "non-participant must not list the room"
    );
  });

  it("sender inbox still lists the same room", async () => {
    const inbox = await listDirectMessageInbox({
      churchId: STORAGE_CHURCH,
      viewerUserId: SENDER,
    });
    const row = inbox.find((item) => item.roomId === ROOM_ID);
    assert.ok(row, "sender inbox must include the room");
    assert.equal(row.isRequestInitiator, true);
    assert.equal(row.isRequestReceiver, false);
    assert.equal(row.lastMessagePreview, MESSAGE_TEXT);
    assert.equal(row.lastMessageText, MESSAGE_TEXT);
  });

  it("pending request without preview still appears for receiver", async () => {
    // Clear messages under storage key — pending must still list.
    const existing = await roomDb.readRoomMessagesJsonFile<
      Record<string, any[]>
    >("room-messages.json", {});
    const next = { ...existing };
    delete next[`${STORAGE_CHURCH}::${ROOM_ID}`];
    await roomDb.writeRoomMessagesJsonFile("room-messages.json", next);

    const inbox = await listDirectMessageInbox({
      churchId: RECEIVER_CHURCH,
      viewerUserId: RECEIVER,
    });
    const row = inbox.find((item) => item.roomId === ROOM_ID);
    assert.ok(row, "pending without preview must appear");
    assert.equal(row.relationshipStatus, "request_pending");
    assert.equal(row.isRequestReceiver, true);
    assert.equal(row.subtitle, "Message request");
    assert.equal(row.lastMessageText, "Message request");
  });

  it("soft-deleted pending thread still appears for receiver", async () => {
    const threadKey = `${STORAGE_CHURCH}::${ROOM_ID}`;
    await threadDb.updateDirectMessageThreadStore<Record<string, any>>(
      (current) => {
        const store = current && typeof current === "object" ? { ...current } : {};
        const prior = store[threadKey] || {
          roomId: ROOM_ID,
          churchId: STORAGE_CHURCH,
          participantUserIds: [SENDER, RECEIVER],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          readAtByUserId: {},
          requestStatus: "pending",
          requestInitiatorUserId: SENDER,
        };
        store[threadKey] = {
          ...prior,
          deletedAtByUserId: {
            ...(prior.deletedAtByUserId || {}),
            [RECEIVER]: Date.now(),
          },
        };
        return store;
      },
      {}
    );

    const inbox = await listDirectMessageInbox({
      churchId: RECEIVER_CHURCH,
      viewerUserId: RECEIVER,
    });
    const row = inbox.find((item) => item.roomId === ROOM_ID);
    assert.ok(
      row,
      "soft-deleted pending request must still appear in receiver inbox"
    );
    assert.equal(row.isRequestReceiver, true);
  });
});
