/**
 * Message Privacy & Settings verification.
 * Run: node --experimental-strip-types --test scripts/verify-message-privacy-settings.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  defaultMessagePrivacySettings,
  evaluateRecipientCallPrivacy,
  evaluateRecipientMessagePrivacy,
  mergeMessagePrivacySettings,
  normalizeMessagePrivacySettings,
  redactPresenceForPrivacy,
  shouldExposeReadReceipt,
  validateMessagePrivacySettingsPatch,
} from "../app/api/_lib/messagePrivacySettings.ts";

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

describe("message privacy settings model", () => {
  it("defaults preserve open messaging and pastoral call behavior", () => {
    const d = defaultMessagePrivacySettings(1);
    assert.equal(d.version, 1);
    assert.equal(d.whoCanMessage, "everyone");
    assert.equal(d.allowMessagesFromOtherChurches, true);
    assert.equal(d.allowMessageRequests, true);
    assert.equal(d.allowVoiceCalls, true);
    assert.equal(d.whoCanCall, "everyone");
    assert.equal(d.showReadReceipts, true);
    assert.equal(d.privateCallNotifications, true);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(d, "requireDeviceAuthForMessages"),
      "Message Lock fields must be removed from defaults"
    );
  });

  it("normalize fills missing fields without inventing follow/verified enums", () => {
    const n = normalizeMessagePrivacySettings({
      whoCanMessage: "church_members",
    } as any);
    assert.equal(n.whoCanMessage, "church_members");
    assert.equal(n.allowVoiceCalls, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(n, "peopleIFollow" as any),
      false
    );
  });

  it("rejects invalid patch values and unknown keys", () => {
    const badEnum = validateMessagePrivacySettingsPatch({
      whoCanMessage: "people_i_follow",
    });
    assert.equal(badEnum.ok, false);

    const badType = validateMessagePrivacySettingsPatch({
      allowVoiceCalls: "yes",
    });
    assert.equal(badType.ok, false);

    const unknown = validateMessagePrivacySettingsPatch({
      secretSetting: true,
    });
    assert.equal(unknown.ok, false);

    const proto = validateMessagePrivacySettingsPatch(
      JSON.parse('{"__proto__":{"whoCanMessage":"nobody"},"allowVoiceCalls":true}')
    );
    assert.equal(proto.ok, false);

    const ctor = validateMessagePrivacySettingsPatch({
      constructor: { name: "Evil" },
      allowVoiceCalls: true,
    });
    assert.equal(ctor.ok, false);

    const ok = validateMessagePrivacySettingsPatch({
      whoCanMessage: "nobody",
      allowMessageRequests: false,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.patch.whoCanMessage, "nobody");
      assert.equal(ok.patch.allowMessageRequests, false);
    }
  });

  it("merge updates updatedAt and preserves version", () => {
    const base = defaultMessagePrivacySettings(10);
    const next = mergeMessagePrivacySettings(
      base,
      { whoCanMessage: "existing_conversations" },
      99
    );
    assert.equal(next.whoCanMessage, "existing_conversations");
    assert.equal(next.updatedAt, 99);
    assert.equal(next.version, 1);
  });
});

describe("recipient message privacy enforcement", () => {
  const base = defaultMessagePrivacySettings();

  it("nobody blocks inbound even for existing conversations", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "nobody" },
      shareActiveChurch: true,
      hasExistingConversation: true,
      isEstablishedConversation: true,
      isCrossChurchRequest: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DM_PRIVACY_NOBODY");
  });

  it("church_members blocks cross-church", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "church_members" },
      shareActiveChurch: false,
      hasExistingConversation: false,
      isEstablishedConversation: false,
      isCrossChurchRequest: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DM_PRIVACY_CHURCH_MEMBERS");
  });

  it("existing_conversations blocks cold opens", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "existing_conversations" },
      shareActiveChurch: false,
      hasExistingConversation: false,
      isEstablishedConversation: false,
      isCrossChurchRequest: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DM_PRIVACY_EXISTING_ONLY");
  });

  it("existing_conversations allows existing thread", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "existing_conversations" },
      shareActiveChurch: false,
      hasExistingConversation: true,
      isEstablishedConversation: false,
      isCrossChurchRequest: true,
    });
    assert.equal(result.ok, true);
  });

  it("existing accepted conversation works under existing_conversations", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "existing_conversations" },
      shareActiveChurch: false,
      hasExistingConversation: true,
      isEstablishedConversation: true,
      isCrossChurchRequest: false,
    });
    assert.equal(result.ok, true);
  });

  it("new request blocked under existing_conversations", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "existing_conversations" },
      shareActiveChurch: false,
      hasExistingConversation: false,
      isEstablishedConversation: false,
      isCrossChurchRequest: true,
    });
    assert.equal(result.ok, false);
  });

  it("church_members allows same-church sender", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: { ...base, whoCanMessage: "church_members" },
      shareActiveChurch: true,
      hasExistingConversation: false,
      isEstablishedConversation: true,
      isCrossChurchRequest: false,
    });
    assert.equal(result.ok, true);
  });

  it("other churches disabled blocks non-established cross-church", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: {
        ...base,
        whoCanMessage: "everyone",
        allowMessagesFromOtherChurches: false,
      },
      shareActiveChurch: false,
      hasExistingConversation: false,
      isEstablishedConversation: false,
      isCrossChurchRequest: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DM_PRIVACY_OTHER_CHURCHES");
  });

  it("message requests disabled blocks new cross-church requests", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: {
        ...base,
        whoCanMessage: "everyone",
        allowMessageRequests: false,
      },
      shareActiveChurch: false,
      hasExistingConversation: true,
      isEstablishedConversation: false,
      isCrossChurchRequest: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "DM_PRIVACY_REQUESTS_DISABLED");
  });

  it("accepted/established cross-church still allowed when requests disabled", () => {
    const result = evaluateRecipientMessagePrivacy({
      settings: {
        ...base,
        whoCanMessage: "everyone",
        allowMessageRequests: false,
      },
      shareActiveChurch: false,
      hasExistingConversation: true,
      isEstablishedConversation: true,
      isCrossChurchRequest: false,
    });
    assert.equal(result.ok, true);
  });
});

describe("recipient call privacy (pastoral model layer)", () => {
  const base = defaultMessagePrivacySettings();

  it("voice disabled blocks voice", () => {
    const result = evaluateRecipientCallPrivacy({
      settings: { ...base, allowVoiceCalls: false },
      shareActiveChurch: true,
      hasExistingConversation: true,
      callKind: "voice",
      isUnknownCaller: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CALL_PRIVACY_VOICE_DISABLED");
  });

  it("whoCanCall nobody blocks", () => {
    const result = evaluateRecipientCallPrivacy({
      settings: { ...base, whoCanCall: "nobody" },
      shareActiveChurch: true,
      hasExistingConversation: true,
      callKind: "voice",
      isUnknownCaller: false,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CALL_PRIVACY_NOBODY");
  });

  it("auto-reject unknown callers marks autoReject", () => {
    const result = evaluateRecipientCallPrivacy({
      settings: { ...base, autoRejectUnknownCallers: true },
      shareActiveChurch: true,
      hasExistingConversation: false,
      callKind: "voice",
      isUnknownCaller: true,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "CALL_PRIVACY_UNKNOWN_REJECTED");
      assert.equal(result.autoReject, true);
    }
  });
});

describe("read receipts and presence privacy", () => {
  it("receipts require both sides enabled", () => {
    assert.equal(
      shouldExposeReadReceipt({
        viewerShowsReceipts: true,
        peerShowsReceipts: false,
      }),
      false
    );
    assert.equal(
      shouldExposeReadReceipt({
        viewerShowsReceipts: true,
        peerShowsReceipts: true,
      }),
      true
    );
  });

  it("presence redaction hides online and last active when disabled", () => {
    const settings = {
      ...defaultMessagePrivacySettings(),
      showOnlineStatus: false,
      showLastActive: false,
    };
    const redacted = redactPresenceForPrivacy({
      settings,
      online: true,
      lastSeenAt: 123,
      text: "online now",
    });
    assert.equal(redacted.online, false);
    assert.equal(redacted.lastSeenAt, null);
    assert.equal(redacted.presenceHidden, true);
  });
});

describe("wiring and regression guards", () => {
  it("auth route exists and uses guardAuth", () => {
    const route = read("app/api/auth/message-privacy-settings/route.ts");
    assertIncludes(route, "guardAuth", "message-privacy-settings route");
    assertIncludes(route, "validateMessagePrivacySettingsPatch", "patch validation");
    assertIncludes(route, "getMessagePrivacySettings", "GET load");
    assertIncludes(route, "patchMessagePrivacySettings", "PATCH save");
  });

  it("DM open/send paths enforce recipient privacy", () => {
    const dm = read("app/api/_lib/directMessages.ts");
    assertIncludes(dm, "assertRecipientAllowsDirectMessage", "DM privacy helper");
    assertIncludes(dm, "DirectMessagePrivacyError", "privacy error type");
    const logic = read("app/api/_lib/messagePrivacySettings.ts");
    assertIncludes(logic, "DM_PRIVACY_NOBODY", "privacy deny codes");
  });

  it("private-call keeps pastoral_call_only and adds privacy gate", () => {
    const route = read("app/api/church/private-call/route.ts");
    assertIncludes(route, "pastoral_call_only", "pastoral restriction retained");
    assertIncludes(route, "assertRecipientAllowsPrivateCall", "call privacy");
    assertIncludes(route, "auto-reject-unknown-caller", "auto reject");
  });

  it("mobile gear no longer shows placeholder alert", () => {
    const index = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/index.tsx"
    );
    assert.ok(
      !index.includes("Message settings are not available yet."),
      "placeholder alert must be removed"
    );
    assertIncludes(
      index,
      "messages/settings",
      "gear navigates to settings"
    );
    assert.ok(
      !index.includes("MessagesSecurityGate"),
      "Message Lock gate must be removed"
    );
    assertIncludes(
      index,
      "clearLegacyMessageLockPrefs",
      "legacy lock prefs cleared on open"
    );
  });

  it("settings UI omits follow and verified options", () => {
    const types = read(
      "apps/mobile/src/lib/messagePrivacySettingsTypes.ts"
    );
    assert.ok(!types.includes("people_i_follow"));
    assert.ok(!types.includes("verified"));
    assertIncludes(types, "church_members", "church members option");
    assertIncludes(types, "existing_conversations", "existing only option");
    assertIncludes(types, '"nobody"', "nobody option");
  });

  it("conversation mute tile restored", () => {
    const thread = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/[id].tsx"
    );
    assertIncludes(thread, 'onThreadMenuAction("mute")', "mute tile action");
  });

  it("ensure cold-create cannot forge existing conversation past privacy", () => {
    const dm = read("app/api/_lib/directMessages.ts");
    assertIncludes(
      dm,
      "KRISTO_DM_ENSURE_CREATE_PRIVACY_DENIED",
      "ensure create privacy deny"
    );
    assertIncludes(
      dm,
      "hasExistingConversation: false",
      "ensure create treats cold create as non-existing"
    );
  });

  it("settings route is auth-scoped to session user only", () => {
    const route = read("app/api/auth/message-privacy-settings/route.ts");
    assertIncludes(route, "guardAuth", "auth required");
    assertIncludes(route, "auth.viewer.userId", "user scoped");
    assert.ok(
      !route.includes("body.userId") && !route.includes("searchParams.get(\"userId\")"),
      "must not accept client-supplied target userId"
    );
  });

  it("Message Lock UI and helpers are fully removed", () => {
    const settingsUi = read(
      "apps/mobile/src/components/messageSettings/MessageSettingsScreen.tsx"
    );
    assert.ok(!settingsUi.includes("Face ID"));
    assert.ok(!settingsUi.includes("requireDeviceAuthForMessages"));
    assert.ok(!settingsUi.includes("messageLockTimeout"));
    assert.ok(!settingsUi.includes("Message Security"));
    const types = read(
      "apps/mobile/src/lib/messagePrivacySettingsTypes.ts"
    );
    assert.ok(!types.includes("requireDeviceAuthForMessages"));
    assert.ok(!types.includes("MessageLockTimeout"));
    const model = read("app/api/_lib/messagePrivacySettings.ts");
    assert.ok(!model.includes("requireDeviceAuthForMessages"));
    assert.ok(!model.includes("messageLockTimeout"));
    assert.ok(!model.includes("hideContentInAppSwitcher"));
  });

  it("legacy Message Lock PATCH keys are rejected as unknown", () => {
    const rejected = validateMessagePrivacySettingsPatch({
      requireDeviceAuthForMessages: true,
    });
    assert.equal(rejected.ok, false);
  });

  it("block remains highest priority ahead of privacy in send gate", () => {
    const dm = read("app/api/_lib/directMessages.ts");
    const sendGateStart = dm.indexOf(
      "export async function assertDirectMessageSendAllowed"
    );
    assert.ok(sendGateStart > 0, "send gate function exists");
    const sendGate = dm.slice(sendGateStart, sendGateStart + 3500);
    const blockIdx = sendGate.indexOf("blockedByMe || blockedByPeer");
    const privacyIdx = sendGate.indexOf("assertRecipientAllowsDirectMessage");
    assert.ok(
      blockIdx > 0 && privacyIdx > blockIdx,
      "block checked before privacy inside send gate"
    );
  });

  it("private-call cannot unlock member-to-member calling", () => {
    const route = read("app/api/church/private-call/route.ts");
    assertIncludes(route, "pastoral_call_only", "member-to-member still blocked");
    const postStart = route.indexOf("export async function POST");
    assert.ok(postStart > 0, "POST handler exists");
    const postBody = route.slice(postStart);
    const pastoralIdx = postBody.indexOf('error: "pastoral_call_only"');
    const privacyIdx = postBody.indexOf("assertRecipientAllowsPrivateCall");
    assert.ok(
      pastoralIdx > 0 && privacyIdx > pastoralIdx,
      "call privacy runs after pastoral restriction in POST"
    );
  });
});
