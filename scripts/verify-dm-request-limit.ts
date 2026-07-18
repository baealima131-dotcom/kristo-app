/**
 * Focused DM request / 5-message limit + role-direction verification.
 * Run: node --experimental-strip-types --test scripts/verify-dm-request-limit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  buildDmRequestQuota,
  claimOutboundSlotInStore,
  DM_REQUEST_MESSAGE_LIMIT,
  DM_REQUEST_MESSAGE_LIMIT_REACHED,
  DM_REQUEST_OUTGOING_MESSAGE_LIMIT,
  dmRequestLimitReachedError,
  resolveDmRelationshipStatus,
  type DmRequestThreadRecord,
} from "../app/api/_lib/directMessageRequestLogic.ts";

const root = join(import.meta.dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function assertIncludes(haystack: string, needle: string, label: string) {
  assert.ok(
    haystack.includes(needle),
    `${label}: missing required pattern:\n  ${needle}`
  );
}

function assertNotIncludes(haystack: string, needle: string, label: string) {
  assert.ok(
    !haystack.includes(needle),
    `${label}: forbidden pattern still present:\n  ${needle}`
  );
}

function baseThread(
  overrides: Partial<DmRequestThreadRecord> = {}
): DmRequestThreadRecord {
  return {
    roomId: "dm:user_a::user_b",
    churchId: "church_a",
    participantUserIds: ["user_a", "user_b"],
    requestStatus: "pending",
    requestInitiatorUserId: "user_a",
    requestOutboundCountByUserId: {},
    ...overrides,
  };
}

describe("DM request relationship status", () => {
  it("block overrides same-church and accepted", () => {
    const status = resolveDmRelationshipStatus({
      record: baseThread({
        requestStatus: "accepted",
        blockedByUserId: { user_b: true },
      }),
      viewerUserId: "user_a",
      peerUserId: "user_b",
      shareActiveChurch: true,
    });
    assert.equal(status, "blocked");
  });

  it("shared active church resolves to same_church when not blocked", () => {
    const status = resolveDmRelationshipStatus({
      record: baseThread({ requestStatus: "pending" }),
      viewerUserId: "user_a",
      peerUserId: "user_b",
      shareActiveChurch: true,
    });
    assert.equal(status, "same_church");
  });

  it("sameChurchAtCreation alone does not preserve unlimited after leaving church", () => {
    const status = resolveDmRelationshipStatus({
      record: baseThread({
        requestStatus: undefined,
        requestInitiatorUserId: undefined,
        sameChurchAtCreation: true,
      }),
      viewerUserId: "user_a",
      peerUserId: "user_b",
      shareActiveChurch: false,
    });
    assert.equal(status, "request_pending");
  });

  it("accepted removes pending limit", () => {
    const status = resolveDmRelationshipStatus({
      record: baseThread({ requestStatus: "accepted" }),
      viewerUserId: "user_a",
      peerUserId: "user_b",
      shareActiveChurch: false,
    });
    assert.equal(status, "accepted");
    const quota = buildDmRequestQuota({
      relationshipStatus: status,
      record: baseThread({
        requestStatus: "accepted",
        requestOutboundCountByUserId: { user_a: DM_REQUEST_MESSAGE_LIMIT },
      }),
      senderUserId: "user_a",
    });
    assert.equal(quota.canSend, true);
  });

  it("declined cannot send", () => {
    const quota = buildDmRequestQuota({
      relationshipStatus: "declined",
      record: baseThread({ requestStatus: "declined" }),
      senderUserId: "user_a",
    });
    assert.equal(quota.canSend, false);
    assert.equal(quota.remainingMessages, 0);
  });
});

describe("DM request 5-message counting", () => {
  it("allows messages 1–5 and rejects message 6", () => {
    assert.equal(DM_REQUEST_MESSAGE_LIMIT, 5);
    assert.equal(DM_REQUEST_OUTGOING_MESSAGE_LIMIT, 5);

    let store: Record<string, DmRequestThreadRecord> = {
      "church_a::dm:user_a::user_b": baseThread(),
    };

    for (let i = 1; i <= DM_REQUEST_MESSAGE_LIMIT; i += 1) {
      const out = claimOutboundSlotInStore({
        store,
        roomId: "dm:user_a::user_b",
        senderUserId: "user_a",
      });
      assert.equal(out.result.ok, true, `claim ${i} should succeed`);
      if (out.result.ok) {
        assert.equal(out.result.count, i);
      }
      store = out.next;
    }

    const sixth = claimOutboundSlotInStore({
      store,
      roomId: "dm:user_a::user_b",
      senderUserId: "user_a",
    });
    assert.equal(sixth.result.ok, false);
    if (!sixth.result.ok) {
      assert.equal(sixth.result.code, DM_REQUEST_MESSAGE_LIMIT_REACHED);
      assert.equal(sixth.result.remainingMessages, 0);
      assert.equal(sixth.result.limit, 5);
      assert.equal(sixth.result.error, dmRequestLimitReachedError(5));
    }
  });

  it("receiver outbound does not consume sender quota", () => {
    let store: Record<string, DmRequestThreadRecord> = {
      "church_a::dm:user_a::user_b": baseThread({
        requestOutboundCountByUserId: { user_a: 4 },
      }),
    };

    const receiverClaim = claimOutboundSlotInStore({
      store,
      roomId: "dm:user_a::user_b",
      senderUserId: "user_b",
    });
    assert.equal(receiverClaim.result.ok, true);
    store = receiverClaim.next;

    const senderQuota = buildDmRequestQuota({
      relationshipStatus: "request_pending",
      record: store["church_a::dm:user_a::user_b"],
      senderUserId: "user_a",
    });
    assert.equal(senderQuota.outgoingMessageCount, 4);
    assert.equal(senderQuota.remainingMessages, 1);
  });

  it("deleting views does not reset stored outbound count", () => {
    const record = baseThread({
      requestOutboundCountByUserId: { user_a: DM_REQUEST_MESSAGE_LIMIT },
      clearedAtByUserId: { user_a: Date.now() } as any,
    });
    const quota = buildDmRequestQuota({
      relationshipStatus: "request_pending",
      record,
      senderUserId: "user_a",
    });
    assert.equal(quota.outgoingMessageCount, DM_REQUEST_MESSAGE_LIMIT);
    assert.equal(quota.canSend, false);
  });

  it("concurrent final-slot claims produce exactly one success", () => {
    const store: Record<string, DmRequestThreadRecord> = {
      "church_a::dm:user_a::user_b": baseThread({
        requestOutboundCountByUserId: { user_a: DM_REQUEST_MESSAGE_LIMIT - 1 },
      }),
    };

    const a = claimOutboundSlotInStore({
      store,
      roomId: "dm:user_a::user_b",
      senderUserId: "user_a",
    });
    const b = claimOutboundSlotInStore({
      store: a.next,
      roomId: "dm:user_a::user_b",
      senderUserId: "user_a",
    });

    assert.equal(a.result.ok, true);
    assert.equal(b.result.ok, false);
    if (!b.result.ok) {
      assert.equal(b.result.code, DM_REQUEST_MESSAGE_LIMIT_REACHED);
    }
    if (a.result.ok) {
      assert.equal(a.result.count, DM_REQUEST_MESSAGE_LIMIT);
    }
  });
});

describe("DM request role direction (source)", () => {
  const dmLib = read("app/api/_lib/directMessages.ts");
  const messagesUi = read(
    "apps/mobile/app/(tabs)/more/my-church-room/messages/[id].tsx"
  );
  const relDb = read("app/api/_lib/store/directMessageRelationshipDb.ts");

  it("settings use initiator/receiver flags from requestInitiatorUserId", () => {
    assertIncludes(dmLib, "isRequestReceiver", "settings receiver flag");
    assertIncludes(dmLib, "requestInitiatorUserId", "settings initiator field");
    assertIncludes(
      dmLib,
      "isRequestReceiver && !blockedByMe && !blockedByPeer",
      "canAcceptDecline receiver-only"
    );
    assertIncludes(
      dmLib,
      "repairReversedEmptyPendingInitiator",
      "safe repair on profile open"
    );
    assertIncludes(dmLib, "KRISTO_DM_REQUEST_CREATED", "create diagnostic");
    assertNotIncludes(
      dmLib,
      "normUserId(existingRecord.createdByUserId || \"\") || viewerUserId",
      "no stale createdBy initiator mint"
    );
  });

  it("mobile UI uses canonical initiator/receiver roles", () => {
    assertIncludes(
      messagesUi,
      "KRISTO_DM_REQUEST_ROLE_RESOLUTION",
      "role diagnostic"
    );
    assertIncludes(messagesUi, "dmIsRequestInitiator", "initiator role");
    assertIncludes(messagesUi, "dmIsRequestReceiver", "receiver role");
    assertIncludes(
      messagesUi,
      "DM_REQUEST_MESSAGE_LIMIT",
      "mobile limit constant"
    );
    assertNotIncludes(messagesUi, "7-message", "no hardcoded 7 copy");
    assertNotIncludes(
      messagesUi,
      "outgoingMessageLimit || 7",
      "no fallback 7"
    );
  });

  it("safe repair requires empty pending + count 0", () => {
    assertIncludes(
      relDb,
      "repairReversedEmptyPendingInitiator",
      "repair export"
    );
    assertIncludes(
      relDb,
      "initiator_outbound_count = 0",
      "repair count guard"
    );
    assertIncludes(relDb, "accepted_at IS NULL", "repair accepted guard");
    assertIncludes(relDb, "declined_at IS NULL", "repair declined guard");
  });

  it("declined can restart as a new pending invitation", () => {
    assertIncludes(
      relDb,
      "restartMessageRequestAsPending",
      "restart export"
    );
    assertIncludes(
      relDb,
      "resetDirectMessageRelationshipToNone",
      "unblock resets to none"
    );
    assertIncludes(dmLib, "restart_request", "settings restart action");
    assertIncludes(dmLib, "canRestartRequest", "settings canRestartRequest");
    assertIncludes(dmLib, "KRISTO_DM_REQUEST_RESTARTED", "restart diagnostic");
    assertIncludes(
      dmLib,
      "resetDirectMessageRelationshipToNone",
      "unblock clears relationship"
    );
    assertIncludes(messagesUi, "Request again", "restart CTA");
    assertIncludes(
      messagesUi,
      "restart_request",
      "mobile restart action"
    );
    assertNotIncludes(
      messagesUi,
      "You cannot send more messages until they accept.",
      "old forever-locked declined copy removed"
    );
  });
});

describe("DM request wiring (source)", () => {
  const dmLib = read("app/api/_lib/directMessages.ts");
  const requests = read("app/api/_lib/directMessageRequests.ts");
  const requestLogic = read("app/api/_lib/directMessageRequestLogic.ts");
  const roomMessages = read("app/api/church/room-messages/route.ts");
  const dmRoute = read("app/api/church/direct-messages/route.ts");
  const profile = read("apps/mobile/app/(tabs)/profile/index.tsx");

  it("enforces limit on room-messages POST via assertDirectMessageSendAllowed", () => {
    assertIncludes(
      roomMessages,
      "assertDirectMessageSendAllowed",
      "room-messages gate"
    );
    assertIncludes(
      roomMessages,
      "releaseDirectMessageRequestOutboundSlot",
      "rollback claimed slot on persist failure"
    );
    assertIncludes(
      dmLib,
      "DM_REQUEST_MESSAGE_LIMIT_REACHED",
      "directMessages limit code"
    );
    assertIncludes(
      requestLogic,
      "DM_REQUEST_MESSAGE_LIMIT_REACHED",
      "request logic code"
    );
  });

  it("accept/decline are receiver-only settings actions", () => {
    assertIncludes(dmRoute, '"accept"', "accept action");
    assertIncludes(dmRoute, '"decline"', "decline action");
    assertIncludes(dmLib, 'args.action === "accept"', "accept handler");
    assertIncludes(
      dmRoute,
      "Only the recipient can accept or decline",
      "receiver-only error"
    );
    assertIncludes(dmRoute, "DM_REQUEST_RECEIVER_ONLY", "receiver code");
  });

  it("uses durable active membership intersection for same church", () => {
    assertIncludes(requests, "usersShareActiveChurch", "helper");
    assertIncludes(
      requests,
      'String(row.status || "") === "Active"',
      "active only"
    );
    assertIncludes(dmLib, "usersShareActiveChurch", "used by DM lib");
    assertIncludes(
      requestLogic,
      "DM_REQUEST_MESSAGE_LIMIT = 5",
      "limit constant"
    );
    assertNotIncludes(
      requestLogic,
      "DM_REQUEST_MESSAGE_LIMIT = 7",
      "old limit removed"
    );
  });

  it("profile Message opens DM thread instead of router.back stub", () => {
    assertIncludes(profile, "openDirectMessageThread", "profile open");
    assertIncludes(profile, "PROFILE_EXTERNAL_MESSAGE_OPEN", "log");
    assert.ok(
      !profile.includes("PROFILE_EXTERNAL_MESSAGE_ONLY"),
      "old stub log removed"
    );
  });

  it("DM create is not gated on shared-church membership", () => {
    assertNotIncludes(
      dmLib,
      'throw new Error("Could not create conversation.")',
      "no shared-church create failure"
    );
    assertNotIncludes(
      dmLib,
      "viewer_no_active_membership",
      "no viewer membership create gate"
    );
    assertNotIncludes(
      dmLib,
      "peer_profile_missing",
      "no peer profile membership gate"
    );
    assertIncludes(
      dmLib,
      "resolveCanonicalUserIdentity",
      "canonical target resolve"
    );
    assertIncludes(
      dmRoute,
      "guardAuth",
      "create uses auth-only guard"
    );
    const userProfile = read(
      "app/api/users/[userId]/profile/route.ts"
    );
    assertIncludes(
      userProfile,
      "resolveCanonicalUserIdentity",
      "external profile membership-agnostic"
    );
  });

  it("relationship quota uses database-level conditional UPDATE", () => {
    const relDb = read(
      "app/api/_lib/store/directMessageRelationshipDb.ts"
    );
    assertIncludes(
      relDb,
      "kristo_direct_message_relationships",
      "durable table"
    );
    assertIncludes(
      relDb,
      "AND initiator_outbound_count < ${limit}",
      "atomic slot guard"
    );
    assertIncludes(
      relDb,
      "room_id TEXT PRIMARY KEY",
      "canonical room_id uniqueness"
    );
    assertIncludes(
      relDb,
      "kristo_dm_rel_participants_uidx",
      "participant pair unique index"
    );
    assertIncludes(
      relDb,
      "Direct message relationship database not configured",
      "no /tmp fallback on Vercel"
    );
  });
});
