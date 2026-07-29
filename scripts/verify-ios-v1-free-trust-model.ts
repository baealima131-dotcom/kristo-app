/**
 * Verify iOS V1 FREE trust model: platform header alone must NOT bypass;
 * kill switch + HMAC proof bound to userId must.
 *
 * Run: node --experimental-strip-types scripts/verify-ios-v1-free-trust-model.ts
 */
import {
  isIosV1FreeMonetizationEnabled,
  isIosV1SubscriptionGateBypassed,
  mintIosV1FreeProof,
  verifyIosV1FreeProof,
  KRISTO_IOS_V1_FREE_PROOF_HEADER,
} from "../lib/iosV1MonetizationPolicy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ok ", msg);
}

const prevKill = process.env.KRISTO_IOS_V1_FREE_MONETIZATION;
const prevSecret = process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET;
const prevNodeEnv = process.env.NODE_ENV;

try {
  console.log("\n• production fail-closed without kill switch");
  process.env.NODE_ENV = "production";
  process.env.KRISTO_IOS_V1_FREE_MONETIZATION = "0";
  process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET = "test-secret-abc";
  assert(isIosV1FreeMonetizationEnabled() === false, "kill switch off");
  assert(
    isIosV1SubscriptionGateBypassed(
      { "x-kristo-client-platform": "ios" },
      { userId: "u1" }
    ) === false,
    "platform header alone rejected when kill switch off"
  );

  console.log("\n• spoofed platform header alone rejected even with kill switch");
  process.env.KRISTO_IOS_V1_FREE_MONETIZATION = "1";
  assert(
    isIosV1SubscriptionGateBypassed(
      { "x-kristo-client-platform": "ios" },
      { userId: "u1" }
    ) === false,
    "ios platform header without proof rejected"
  );
  assert(
    isIosV1SubscriptionGateBypassed(
      { "x-kristo-client-platform": "android" },
      { userId: "u1" }
    ) === false,
    "android platform header rejected"
  );

  console.log("\n• valid HMAC proof allows; wrong user / wrong secret rejected");
  const proof = mintIosV1FreeProof("u-pastor-1");
  assert(Boolean(proof), "minted proof");
  assert(verifyIosV1FreeProof(proof, "u-pastor-1") === true, "proof verifies for user");
  assert(verifyIosV1FreeProof(proof, "u-other") === false, "proof rejects other user");
  assert(
    isIosV1SubscriptionGateBypassed(
      {
        "x-kristo-client-platform": "android", // spoofed platform still irrelevant
        [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof,
      },
      { userId: "u-pastor-1" }
    ) === true,
    "valid proof allows regardless of platform header"
  );
  assert(
    isIosV1SubscriptionGateBypassed(
      {
        "x-kristo-client-platform": "ios",
        [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof,
      },
      { userId: "u-android-attacker" }
    ) === false,
    "proof for different userId rejected"
  );
  assert(
    isIosV1SubscriptionGateBypassed(
      {
        "x-kristo-client-platform": "ios",
        [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof,
      },
      { userId: "" }
    ) === false,
    "missing userId rejects"
  );

  console.log("\n• Android cannot unlock without IPA-extracted secret");
  process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET = "ios-only-secret";
  const iosProof = mintIosV1FreeProof("u1");
  process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET = "different-or-missing";
  assert(verifyIosV1FreeProof(iosProof, "u1") === false, "wrong server secret rejects ios proof");

  console.log("\n• malformed / expired / future proofs rejected");
  assert(verifyIosV1FreeProof("", "u1") === false, "empty proof rejected");
  assert(verifyIosV1FreeProof("not-a-proof", "u1") === false, "malformed proof rejected");
  assert(verifyIosV1FreeProof("v0.2099-01-01." + "a".repeat(64), "u1") === false, "wrong version rejected");
  assert(verifyIosV1FreeProof("v1.2099-01-01." + "a".repeat(64), "u1") === false, "future day rejected");
  assert(verifyIosV1FreeProof("v1.2000-01-01." + "a".repeat(64), "u1") === false, "expired day rejected");

  console.log("\niOS V1 free trust model: all checks passed");
} finally {
  if (prevKill === undefined) delete process.env.KRISTO_IOS_V1_FREE_MONETIZATION;
  else process.env.KRISTO_IOS_V1_FREE_MONETIZATION = prevKill;
  if (prevSecret === undefined) delete process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET;
  else process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET = prevSecret;
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}
