/**
 * Kristo Message Lock PIN verification.
 * Run: npx --yes tsx --test scripts/verify-message-lock.ts
 */
import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cooldownMsForFailedAttempts,
  hashMessageLockPin,
  isWeakPin,
  publicStatusFromRecord,
  validateChangeBody,
  validateDisableBody,
  validateSetupBody,
  validateTimeoutPatchBody,
  validateVerifyBody,
  verifyMessageLockPin,
  MESSAGE_LOCK_BCRYPT_COST,
} from "../app/api/_lib/messageLock.ts";
import {
  canUseMessageLockLocalFallback,
  clearMessageLockCredential,
  getMessageLockRecord,
  isProductionLikeMessageLockRuntime,
  upsertMessageLockCredential,
} from "../app/api/_lib/store/messageLockDb.ts";

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

describe("PIN validation", () => {
  it("accepts setup for 4, 6, and 8 digits", () => {
    for (const len of [4, 6, 8] as const) {
      const pin = len === 4 ? "2580" : len === 6 ? "258014" : "25801479";
      const v = validateSetupBody({
        pin,
        confirmPin: pin,
        pinLength: len,
        timeoutSeconds: 60,
      });
      assert.equal(v.ok, true);
      if (v.ok) {
        assert.equal(v.pinLength, len);
        assert.equal(v.pin, pin);
      }
    }
  });

  it("rejects invalid lengths and non-digits", () => {
    assert.equal(
      validateSetupBody({ pin: "123", confirmPin: "123", pinLength: 3 }).ok,
      false
    );
    assert.equal(
      validateSetupBody({ pin: "12ab", confirmPin: "12ab", pinLength: 4 }).ok,
      false
    );
    assert.equal(validateVerifyBody({ pin: "12a4" }).ok, false);
    assert.equal(validateVerifyBody({ pin: "12345" }).ok, false);
  });

  it("rejects mismatched confirmation", () => {
    const v = validateSetupBody({
      pin: "2580",
      confirmPin: "2581",
      pinLength: 4,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "mismatch");
  });

  it("rejects weak PINs", () => {
    assert.equal(isWeakPin("0000"), true);
    assert.equal(isWeakPin("111111"), true);
    assert.equal(isWeakPin("1234"), true);
    assert.equal(isWeakPin("4321"), true);
    assert.equal(isWeakPin("123456"), true);
    assert.equal(isWeakPin("2580"), false);
    const v = validateSetupBody({
      pin: "1234",
      confirmPin: "1234",
      pinLength: 4,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.code, "weak_pin");
  });

  it("rejects unknown keys and malformed bodies", () => {
    assert.equal(validateVerifyBody(null).ok, false);
    assert.equal(validateVerifyBody("x").ok, false);
    assert.equal(validateVerifyBody({ pin: "2580", userId: "u1" }).ok, false);
    assert.equal(
      validateChangeBody({
        currentPin: "2580",
        pin: "2581",
        confirmPin: "2581",
        pinLength: 4,
        targetUserId: "other",
      }).ok,
      false
    );
    // Prototype-pollution keys / polluted prototypes
    assert.equal(
      validateVerifyBody({ pin: "2580", __proto__: { admin: true } }).ok,
      false
    );
    const ownProto = JSON.parse(
      '{"pin":"2580","confirmPin":"2580","pinLength":4,"__proto__":{"x":1}}'
    );
    assert.equal(validateSetupBody(ownProto).ok, false);
    const withConstructor = {
      pin: "2580",
      confirmPin: "2580",
      pinLength: 4 as const,
      constructor: { name: "x" },
    };
    assert.equal(validateSetupBody(withConstructor).ok, false);
  });

  it("requires current PIN for change, disable, and timeout patch", () => {
    assert.equal(
      validateChangeBody({
        pin: "2580",
        confirmPin: "2580",
        pinLength: 4,
      }).ok,
      false
    );
    assert.equal(validateDisableBody({}).ok, false);
    assert.equal(
      validateTimeoutPatchBody({ timeoutSeconds: 60 }).ok,
      false
    );
    const ok = validateTimeoutPatchBody({
      currentPin: "2580",
      timeoutSeconds: 300,
    });
    assert.equal(ok.ok, true);
  });
});

describe("hashing and cooldown", () => {
  it("hashes with bcrypt cost 12 and verifies; never equals raw PIN", () => {
    assert.equal(MESSAGE_LOCK_BCRYPT_COST, 12);
    const pin = "2580";
    const hash = hashMessageLockPin(pin);
    assert.ok(hash && hash !== pin);
    assert.ok(!hash.includes(pin));
    assert.equal(verifyMessageLockPin(pin, hash), true);
    assert.equal(verifyMessageLockPin("2581", hash), false);
  });

  it("escalates cooldown after repeated failures", () => {
    assert.equal(cooldownMsForFailedAttempts(4), 0);
    assert.equal(cooldownMsForFailedAttempts(5), 30_000);
    assert.equal(cooldownMsForFailedAttempts(6), 120_000);
    assert.equal(cooldownMsForFailedAttempts(8), 300_000);
    assert.equal(cooldownMsForFailedAttempts(10), 900_000);
  });

  it("public status never includes hash or pin", () => {
    const status = publicStatusFromRecord({
      userId: "u1",
      pinVersion: 1,
      pinLength: 4,
      pinHash: "$2a$12$fakehash",
      enabled: true,
      timeoutSeconds: 60,
      failedAttempts: 2,
      cooldownUntil: null,
      credentialUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const json = JSON.stringify(status);
    assert.ok(!json.includes("fakehash"));
    assert.ok(!json.includes("pinHash"));
    assert.equal(status.hasPin, true);
    assert.equal(status.enabled, true);
  });
});

describe("persistence fail-closed and local fallback", () => {
  const prev = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    DATABASE_URL: process.env.DATABASE_URL,
    ALLOW: process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL,
  };

  after(() => {
    process.env.NODE_ENV = prev.NODE_ENV;
    if (prev.VERCEL === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prev.VERCEL;
    if (prev.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev.DATABASE_URL;
    if (prev.ALLOW === undefined) delete process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL;
    else process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL = prev.ALLOW;
  });

  it("production-like runtime cannot use local fallback", () => {
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL;
    delete process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL;
    assert.equal(isProductionLikeMessageLockRuntime(), true);
    assert.equal(canUseMessageLockLocalFallback(), false);
  });

  it("vercel runtime cannot use local fallback even if ALLOW=1", () => {
    process.env.NODE_ENV = "development";
    process.env.VERCEL = "1";
    process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL = "1";
    assert.equal(canUseMessageLockLocalFallback(), false);
  });

  it("production without DATABASE_URL fails closed on read/write", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.VERCEL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    delete process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL;
    assert.equal(canUseMessageLockLocalFallback(), false);
    await assert.rejects(
      () => getMessageLockRecord("anyone"),
      (err: any) =>
        err?.name === "MessageLockStoreUnavailableError" ||
        /unavailable/i.test(String(err?.message || err))
    );
  });

  it("dev/test local fallback can store and isolate users", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    process.env.KRISTO_MESSAGE_LOCK_ALLOW_LOCAL = "1";
    assert.equal(canUseMessageLockLocalFallback(), true);

    const pinA = "2580";
    const pinB = "3690";
    const hashA = hashMessageLockPin(pinA);
    const hashB = hashMessageLockPin(pinB);

    await upsertMessageLockCredential({
      userId: "lock-user-a",
      pinHash: hashA,
      pinLength: 4,
      timeoutSeconds: 60,
      enabled: true,
    });
    await upsertMessageLockCredential({
      userId: "lock-user-b",
      pinHash: hashB,
      pinLength: 4,
      timeoutSeconds: 0,
      enabled: true,
    });

    const a = await getMessageLockRecord("lock-user-a");
    const b = await getMessageLockRecord("lock-user-b");
    assert.ok(a && b);
    assert.equal(verifyMessageLockPin(pinA, a!.pinHash), true);
    assert.equal(verifyMessageLockPin(pinA, b!.pinHash), false);
    assert.equal(verifyMessageLockPin(pinB, b!.pinHash), true);

    await clearMessageLockCredential("lock-user-a");
    await clearMessageLockCredential("lock-user-b");
    assert.equal(await getMessageLockRecord("lock-user-a"), null);
  });
});

describe("wiring and gate coverage", () => {
  it("routes exist with guardAuth and no body userId", () => {
    const helper = read("app/api/auth/message-lock/_lib.ts");
    assertIncludes(helper, "guardAuth", "message-lock auth helper");
    for (const rel of [
      "app/api/auth/message-lock/route.ts",
      "app/api/auth/message-lock/setup/route.ts",
      "app/api/auth/message-lock/verify/route.ts",
      "app/api/auth/message-lock/change/route.ts",
      "app/api/auth/message-lock/disable/route.ts",
    ]) {
      const src = read(rel);
      assertIncludes(src, "requireMessageLockUser", rel);
      assert.ok(
        !src.includes("body.userId") && !src.includes("body?.userId"),
        `${rel} must not accept target userId`
      );
      assert.ok(
        !src.includes("console.log(validated.pin"),
        `${rel} must not log PIN`
      );
    }
  });

  it("full subtree layouts wrap MessagesLockGate", () => {
    const church = read(
      "apps/mobile/app/(tabs)/more/my-church-room/messages/_layout.tsx"
    );
    const profile = read(
      "apps/mobile/app/(tabs)/profile/messages/_layout.tsx"
    );
    assertIncludes(church, "MessagesLockGate", "church messages layout");
    assertIncludes(profile, "MessagesLockGate", "profile messages layout");
  });

  it("settings UI is Kristo PIN not Face ID / device auth", () => {
    const settings = read(
      "apps/mobile/src/components/messageSettings/MessageSettingsScreen.tsx"
    );
    assertIncludes(settings, "MessageLockSettingsSection", "lock section");
    assert.ok(!settings.includes("Face ID"));
    assert.ok(!settings.includes("expo-local-authentication"));
    assert.ok(!settings.includes("Touch ID"));
    const section = read(
      "apps/mobile/src/components/messageSettings/MessageLockSettingsSection.tsx"
    );
    assertIncludes(section, "Kristo Message Lock", "section title");
    assertIncludes(
      section,
      "secure Kristo account re-verification",
      "recovery limitation copy"
    );
  });

  it("logout and account switch clear unlock state", () => {
    const session = read("apps/mobile/src/lib/kristoSession.ts");
    assertIncludes(session, "clearMessageLockLocalState", "session clears lock");
    assertIncludes(session, "user_switch", "account switch path remains");
  });

  it("no SecureStore or local-authentication for message lock", () => {
    const gate = read(
      "apps/mobile/src/components/messageSettings/MessagesLockGate.tsx"
    );
    assert.ok(!gate.includes("expo-secure-store"));
    assert.ok(!gate.includes("LocalAuthentication"));
    assert.ok(!gate.includes("expo-local-authentication"));
  });
});
