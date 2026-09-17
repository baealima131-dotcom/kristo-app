import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  evaluateSokoPolicyConsent,
  guardSokoSensitiveActionConsent,
  parseSokoConsentClientContext,
  policyVersionsEqual,
  publicSokoPolicyBundle,
  SOKO_CURRENT_POLICY_VERSIONS,
  SOKO_POLICY_ENFORCEMENT_OBSERVE,
  SOKO_POLICY_ENFORCEMENT_REQUIRE,
  SOKO_POLICY_REVIEW_STATUS,
} from "../app/api/_lib/sokoLegalPolicy.ts";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("public policy bundle is versioned, localization-ready, and not attorney-reviewed", () => {
  const bundle = publicSokoPolicyBundle();
  assert.equal(bundle.ok, true);
  assert.equal(bundle.locale, "en");
  assert.equal(bundle.metadata.reviewStatus, SOKO_POLICY_REVIEW_STATUS);
  assert.equal(bundle.metadata.reviewStatus, "draft_pending_legal_review");
  assert.equal(bundle.metadata.enforcement, SOKO_POLICY_ENFORCEMENT_OBSERVE);
  assert.equal(bundle.metadata.localizationReady, true);
  assert.deepEqual(bundle.metadata.materialChange, {
    requiredVersionKeys: [
      "termsVersion",
      "privacyVersion",
      "marketplaceRulesVersion",
      "safetyVersion",
    ],
    comparison: "exact_version_equality",
  });
  assert.equal(bundle.welcome.title, "Welcome to SOKO");
  assert.match(bundle.welcome.explanation, /independent sellers/i);
  assert.match(bundle.welcome.explanation, /does not guarantee/i);
  assert.match(bundle.welcome.explanation, /Sent means/i);
  assert.doesNotMatch(JSON.stringify(bundle.welcome), /draft_pending_legal_review/);
  assert.doesNotMatch(JSON.stringify(bundle.documents), /draft_pending_legal_review/);
  assert.equal(bundle.documents.length, 4);
  assert.deepEqual(
    bundle.documents.map((doc) => doc.id),
    ["terms", "privacy", "marketplace_rules", "safety"]
  );
  assert.equal(bundle.versions.termsVersion, SOKO_CURRENT_POLICY_VERSIONS.termsVersion);
  assert.match(bundle.documents[0].body, /does not guarantee every seller/i);
  assert.match(bundle.documents[0].body, /does not mean the message was legally delivered or read/i);
  assert.match(bundle.documents[1].body, /does not store IP address/i);
  assert.match(bundle.documents[2].body, /prohibited goods/i);
  assert.match(bundle.documents[3].body, /Safety Center/i);
});

test("public SOKO web policy pages use the canonical policy source", () => {
  const hub = read("app/soko/legal/page.tsx");
  const shared = read("app/soko/_components/SokoLegalPage.tsx");
  const policy = read("app/soko/_components/policy.ts");
  const css = read("app/soko/_components/SokoLegalPage.module.css");
  const routes = [
    "app/soko/terms/page.tsx",
    "app/soko/privacy/page.tsx",
    "app/soko/marketplace-rules/page.tsx",
    "app/soko/safety/page.tsx",
    "app/soko/buyer-protection/page.tsx",
    "app/soko/support/page.tsx",
    "app/soko/delete-account/page.tsx",
  ];

  assert.match(hub, /sokoPolicyDocuments/);
  assert.match(policy, /sokoPolicyDocuments/);
  assert.match(policy, /SokoPolicyDocumentId/);
  assert.match(shared, /public pages can be read without signing in/i);
  assert.match(shared, /className=\{styles\.buttonLabel\}>Contact support/);
  assert.match(css, /\.buttonLabel \{[^}]*-webkit-text-fill-color: #102118/);
  assert.match(read("app/soko/buyer-protection/page.tsx"), /styles\.buttonLabel}>Get help/);
  assert.match(read("app/soko/support/page.tsx"), /styles\.buttonLabel}>Buyer Protection/);
  assert.match(read("app/soko/delete-account/page.tsx"), /styles\.buttonLabel}>Contact support/);
  for (const route of routes) assert.equal(fs.existsSync(path.join(root, route)), true, route);
  assert.match(read("app/soko/terms/page.tsx"), /getSokoPolicy\("terms"\)/);
  assert.match(read("app/soko/privacy/page.tsx"), /getSokoPolicy\("privacy"\)/);
  assert.match(read("app/soko/marketplace-rules/page.tsx"), /getSokoPolicy\("marketplace_rules"\)/);
  assert.match(read("app/soko/safety/page.tsx"), /getSokoPolicy\("safety"\)/);
  assert.match(read("app/soko/buyer-protection/page.tsx"), /SOKO_PROTECTION_DEFAULT_ELIGIBILITY/);
  assert.doesNotMatch(hub, /guardCheckoutAuth|guardAuth|x-kristo-session/i);
});

test("POST consent ignores client-supplied policy versions", () => {
  const parsed = parseSokoConsentClientContext({
    appVersion: "0.2.0",
    platform: "ios",
    locale: "en-US",
    termsVersion: "client-forged",
    privacyVersion: "also-forged",
    marketplaceRulesVersion: "nope",
    safetyVersion: "nope",
    ip: "1.2.3.4",
    deviceId: "idfa-secret",
  });
  assert.equal(parsed.appVersion, "0.2.0");
  assert.equal(parsed.platform, "ios");
  assert.equal(parsed.locale, "en-US");
  assert.equal("termsVersion" in parsed, false);
  assert.equal("privacyVersion" in parsed, false);
  assert.equal("ip" in parsed, false);
  assert.equal("deviceId" in parsed, false);
});

test("observe mode never blocks missing consent; require_current can", () => {
  const missing = evaluateSokoPolicyConsent({
    current: SOKO_CURRENT_POLICY_VERSIONS,
    accepted: null,
    enforcement: SOKO_POLICY_ENFORCEMENT_OBSERVE,
  });
  assert.equal(missing.ok, true);
  assert.equal(missing.currentAccepted, false);
  assert.equal(missing.blocking, false);

  const required = evaluateSokoPolicyConsent({
    current: SOKO_CURRENT_POLICY_VERSIONS,
    accepted: null,
    enforcement: SOKO_POLICY_ENFORCEMENT_REQUIRE,
  });
  assert.equal(required.ok, false);
  assert.equal(required.blocking, true);
  if (required.ok === false) {
    assert.equal(required.code, "consent_required");
  }

  const current = evaluateSokoPolicyConsent({
    current: SOKO_CURRENT_POLICY_VERSIONS,
    accepted: SOKO_CURRENT_POLICY_VERSIONS,
    enforcement: SOKO_POLICY_ENFORCEMENT_REQUIRE,
  });
  assert.equal(current.ok, true);
  assert.equal(current.blocking, false);
  const helper = evaluateSokoPolicyConsent;
  assert.equal(typeof helper, "function");
});

test("sensitive-action helper stays observe-only until a later rollout", () => {
  const observed = guardSokoSensitiveActionConsent({ accepted: null });
  assert.equal(observed.blocking, false);
  assert.equal(observed.enforcement, SOKO_POLICY_ENFORCEMENT_OBSERVE);
});

test("material version changes are detected by exact version equality", () => {
  assert.equal(
    policyVersionsEqual(SOKO_CURRENT_POLICY_VERSIONS, SOKO_CURRENT_POLICY_VERSIONS),
    true
  );
  assert.equal(
    policyVersionsEqual(SOKO_CURRENT_POLICY_VERSIONS, {
      ...SOKO_CURRENT_POLICY_VERSIONS,
      privacyVersion: "2026-09-16.1",
    }),
    false
  );
});

test("policy APIs are public for documents and authenticated for consent, with staged rollout", () => {
  const policies = read("app/api/soko/policies/route.ts");
  const consent = read("app/api/soko/policies/consent/route.ts");
  const db = read("app/api/_lib/store/sokoLegalConsentDb.ts");
  const orders = read("app/api/soko/orders/route.ts");
  const conversations = read("app/api/soko/conversations/route.ts");
  const checkout = read("app/api/soko/payments/stripe/payment-intent/route.ts");
  const products = read("app/api/soko/products/route.ts");

  assert.match(policies, /publicSokoPolicyBundle/);
  assert.match(policies, /Cache-Control": "public, max-age=30, stale-while-revalidate=120"/);
  assert.doesNotMatch(policies, /guardCheckoutAuth|guardAuth/);
  assert.doesNotMatch(policies, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(consent, /guardCheckoutAuth/);
  assert.match(consent, /parseSokoConsentClientContext/);
  assert.match(consent, /SOKO_CURRENT_POLICY_VERSIONS/);
  assert.match(consent, /dbAcceptSokoLegalConsent/);
  assert.match(db, /ON CONFLICT/);
  assert.match(db, /DO NOTHING/);
  assert.match(db, /soko_legal_consent/);
  assert.doesNotMatch(db, /ip_address|device_id|idfa|advertising/i);
  assert.doesNotMatch(orders, /sokoLegalPolicy|sokoLegalConsentDb/);
  assert.doesNotMatch(conversations, /sokoLegalPolicy|sokoLegalConsentDb/);
  assert.doesNotMatch(checkout, /sokoLegalPolicy|sokoLegalConsentDb/);
  assert.doesNotMatch(products, /sokoLegalPolicy|sokoLegalConsentDb/);
});
