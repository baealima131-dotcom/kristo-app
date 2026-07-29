/**
 * Regression: POST /api/church/ministries subscription gate under iOS V1 free.
 *
 * Simulates requireChurchSubscriptionActive decision (kill switch + HMAC) and
 * role gate used by ministries POST — without writing DB or logging secrets.
 *
 * Run: node --experimental-strip-types scripts/verify-ios-v1-ministry-create-gate.ts
 */
import {
  diagnoseIosV1SubscriptionGateBypass,
  mintIosV1FreeProof,
  KRISTO_IOS_V1_FREE_PROOF_HEADER,
} from "../lib/iosV1MonetizationPolicy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  console.log("  ok ", msg);
}

/** Mirrors ministries POST role allow-list (subscription check is separate). */
function roleAllowsCreateMinistry(role: string): boolean {
  const allowed = ["Pastor", "Church_Admin", "Ministry_Leader", "System_Admin"];
  return allowed.some((r) => r.toLowerCase() === String(role || "").trim().toLowerCase());
}

/**
 * Mirrors requireChurchSubscriptionActive when subscriptionActive === false:
 * bypass if diagnose allows; else 403 CHURCH_SUBSCRIPTION_REQUIRED.
 */
function subscriptionGateAllowsCreate(args: {
  headers: Record<string, string>;
  userId: string;
  churchSubscriptionActive: boolean;
}): { ok: boolean; code?: string; reason?: string } {
  if (args.churchSubscriptionActive) return { ok: true };
  const d = diagnoseIosV1SubscriptionGateBypass(args.headers, { userId: args.userId });
  if (d.allowed) return { ok: true, reason: d.reason };
  return { ok: false, code: "CHURCH_SUBSCRIPTION_REQUIRED", reason: d.reason };
}

const prevKill = process.env.KRISTO_IOS_V1_FREE_MONETIZATION;
const prevSecret = process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET;
const prevNodeEnv = process.env.NODE_ENV;

try {
  process.env.NODE_ENV = "production";
  process.env.KRISTO_IOS_V1_FREE_MONETIZATION = "1";
  process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET = "ministry-gate-test-secret";

  console.log("\n• valid signed proof + Pastor + inactive subscription → allow");
  const pastorId = "u-pastor-1";
  const proof = mintIosV1FreeProof(pastorId);
  assert(Boolean(proof), "minted pastor proof");
  assert(roleAllowsCreateMinistry("Pastor"), "Pastor role allowed");
  {
    const gate = subscriptionGateAllowsCreate({
      headers: {
        "x-kristo-client-platform": "ios",
        [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof,
      },
      userId: pastorId,
      churchSubscriptionActive: false,
    });
    assert(gate.ok === true, "create ministry subscription gate allows");
    assert(gate.reason === "gate_allowed", "reason gate_allowed");
  }

  console.log("\n• missing proof + inactive subscription → 403");
  {
    const gate = subscriptionGateAllowsCreate({
      headers: { "x-kristo-client-platform": "ios" },
      userId: pastorId,
      churchSubscriptionActive: false,
    });
    assert(gate.ok === false, "missing proof blocked");
    assert(gate.code === "CHURCH_SUBSCRIPTION_REQUIRED", "code CHURCH_SUBSCRIPTION_REQUIRED");
    assert(gate.reason === "proof_missing", "reason proof_missing");
  }

  console.log("\n• invalid proof + inactive subscription → 403");
  {
    const gate = subscriptionGateAllowsCreate({
      headers: {
        "x-kristo-client-platform": "ios",
        [KRISTO_IOS_V1_FREE_PROOF_HEADER]: "v1.2099-01-01." + "a".repeat(64),
      },
      userId: pastorId,
      churchSubscriptionActive: false,
    });
    assert(gate.ok === false, "invalid/expired proof blocked");
    assert(gate.reason === "proof_expired", "reason proof_expired");
  }

  console.log("\n• valid proof + ordinary Member → role rejection (before/alongside gate)");
  {
    assert(roleAllowsCreateMinistry("Member") === false, "Member role rejected for create");
    // Subscription bypass may still diagnose gate_allowed, but POST guard rejects role.
    const memberProof = mintIosV1FreeProof("u-member-1");
    const d = diagnoseIosV1SubscriptionGateBypass(
      { [KRISTO_IOS_V1_FREE_PROOF_HEADER]: memberProof },
      { userId: "u-member-1" }
    );
    assert(d.allowed === true, "proof does not elevate role — only subscription");
    assert(roleAllowsCreateMinistry("Member") === false, "member still cannot create ministry");
  }

  console.log("\n• Android without subscription (no proof) → 403");
  {
    const gate = subscriptionGateAllowsCreate({
      headers: { "x-kristo-client-platform": "android" },
      userId: pastorId,
      churchSubscriptionActive: false,
    });
    assert(gate.ok === false, "android without proof blocked");
    assert(gate.reason === "proof_missing", "android reason proof_missing");
  }

  console.log("\n• diagnose reasons cover kill_switch / malformed / user_mismatch");
  process.env.KRISTO_IOS_V1_FREE_MONETIZATION = "0";
  assert(
    diagnoseIosV1SubscriptionGateBypass(
      { [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof },
      { userId: pastorId }
    ).reason === "kill_switch_disabled",
    "kill_switch_disabled"
  );
  process.env.KRISTO_IOS_V1_FREE_MONETIZATION = "1";
  assert(
    diagnoseIosV1SubscriptionGateBypass(
      { [KRISTO_IOS_V1_FREE_PROOF_HEADER]: "not-a-proof" },
      { userId: pastorId }
    ).reason === "proof_malformed",
    "proof_malformed"
  );
  assert(
    diagnoseIosV1SubscriptionGateBypass(
      { [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof },
      { userId: "" }
    ).reason === "user_mismatch",
    "user_mismatch"
  );
  assert(
    diagnoseIosV1SubscriptionGateBypass(
      { [KRISTO_IOS_V1_FREE_PROOF_HEADER]: proof },
      { userId: "u-other" }
    ).reason === "invalid_mac",
    "invalid_mac for wrong user"
  );

  console.log("\niOS V1 ministry create gate: all checks passed");
} finally {
  if (prevKill === undefined) delete process.env.KRISTO_IOS_V1_FREE_MONETIZATION;
  else process.env.KRISTO_IOS_V1_FREE_MONETIZATION = prevKill;
  if (prevSecret === undefined) delete process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET;
  else process.env.KRISTO_IOS_V1_FREE_PROOF_SECRET = prevSecret;
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}
