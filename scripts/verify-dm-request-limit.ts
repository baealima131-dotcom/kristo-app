/**
 * Focused DM request / 7-message limit verification.
 * Run: node --experimental-strip-types --test scripts/verify-dm-request-limit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  buildDmRequestQuota,
  claimOutboundSlotInStore,
  DM_REQUEST_MESSAGE_LIMIT_REACHED,
  DM_REQUEST_OUTGOING_MESSAGE_LIMIT,
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
        requestOutboundCountByUserId: { user_a: 7 },
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

describe("DM request 7-message counting", () => {
  it("allows messages 1–7 and rejects message 8", () => {
    let store: Record<string, DmRequestThreadRecord> = {
      "church_a::dm:user_a::user_b": baseThread(),
    };

    for (let i = 1; i <= DM_REQUEST_OUTGOING_MESSAGE_LIMIT; i += 1) {
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

    const eighth = claimOutboundSlotInStore({
      store,
      roomId: "dm:user_a::user_b",
      senderUserId: "user_a",
    });
    assert.equal(eighth.result.ok, false);
    if (!eighth.result.ok) {
      assert.equal(eighth.result.code, DM_REQUEST_MESSAGE_LIMIT_REACHED);
      assert.equal(eighth.result.remainingMessages, 0);
    }
  });

  it("receiver outbound does not consume sender quota", () => {
    let store: Record<string, DmRequestThreadRecord> = {
      "church_a::dm:user_a::user_b": baseThread({
        requestOutboundCountByUserId: { user_a: 6 },
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
    assert.equal(senderQuota.outgoingMessageCount, 6);
    assert.equal(senderQuota.remainingMessages, 1);
  });

  it("deleting views does not reset stored outbound count", () => {
    const record = baseThread({
      requestOutboundCountByUserId: { user_a: 7 },
      clearedAtByUserId: { user_a: Date.now() } as any,
    });
    const quota = buildDmRequestQuota({
      relationshipStatus: "request_pending",
      record,
      senderUserId: "user_a",
    });
    assert.equal(quota.outgoingMessageCount, 7);
    assert.equal(quota.canSend, false);
  });

  it("concurrent final-slot claims produce exactly one success", () => {
    const store: Record<string, DmRequestThreadRecord> = {
      "church_a::dm:user_a::user_b": baseThread({
        requestOutboundCountByUserId: { user_a: 6 },
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
      assert.equal(a.result.count, 7);
    }
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
      "DM_REQUEST_OUTGOING_MESSAGE_LIMIT = 7",
      "limit constant"
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
    assertIncludes(
      dmLib,
      "Block is checked before any quota claim",
      "block before claim"
    );
    assertIncludes(
      dmLib,
      "updateDirectMessageRelationshipStatus",
      "durable accept/decline"
    );
  });

  it("safety enforcement remains before relationship gate", () => {
    const safetyIdx = roomMessages.indexOf("assertSafetyEnforcementAllows");
    const dmGateIdx = roomMessages.indexOf("assertDirectMessageSendAllowed");
    assert.ok(safetyIdx >= 0 && dmGateIdx >= 0, "both gates present");
    assert.ok(
      safetyIdx < dmGateIdx,
      "safety must run before DM request limit"
    );
  });
});
