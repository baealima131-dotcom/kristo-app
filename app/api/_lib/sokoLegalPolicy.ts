export const SOKO_POLICY_REVIEW_STATUS = "draft_pending_legal_review" as const;
export const SOKO_POLICY_ENFORCEMENT_OBSERVE = "observe" as const;
export const SOKO_POLICY_ENFORCEMENT_REQUIRE = "require_current" as const;

export type SokoPolicyEnforcementMode =
  | typeof SOKO_POLICY_ENFORCEMENT_OBSERVE
  | typeof SOKO_POLICY_ENFORCEMENT_REQUIRE;

export type SokoPolicyVersions = {
  termsVersion: string;
  privacyVersion: string;
  marketplaceRulesVersion: string;
  safetyVersion: string;
};

export type SokoPolicyDocumentId =
  | "terms"
  | "privacy"
  | "marketplace_rules"
  | "safety";

export type SokoPolicyDocument = {
  id: SokoPolicyDocumentId;
  title: string;
  version: string;
  summary: string;
  body: string;
};

const CURRENT_VERSION = "2026-09-15.1";

export const SOKO_CURRENT_POLICY_VERSIONS: SokoPolicyVersions = {
  termsVersion: CURRENT_VERSION,
  privacyVersion: CURRENT_VERSION,
  marketplaceRulesVersion: CURRENT_VERSION,
  safetyVersion: CURRENT_VERSION,
};

export function sokoPolicyEnforcementMode(): SokoPolicyEnforcementMode {
  const raw = String(process.env.SOKO_POLICY_ENFORCEMENT || "")
    .trim()
    .toLowerCase();
  return raw === SOKO_POLICY_ENFORCEMENT_REQUIRE
    ? SOKO_POLICY_ENFORCEMENT_REQUIRE
    : SOKO_POLICY_ENFORCEMENT_OBSERVE;
}

export function cleanSokoPolicyText(value: unknown, max = 80) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export function policyVersionsEqual(
  left?: SokoPolicyVersions | null,
  right?: SokoPolicyVersions | null
) {
  if (!left || !right) return false;
  return (
    left.termsVersion === right.termsVersion &&
    left.privacyVersion === right.privacyVersion &&
    left.marketplaceRulesVersion === right.marketplaceRulesVersion &&
    left.safetyVersion === right.safetyVersion
  );
}

export function sokoPolicyDocuments(): SokoPolicyDocument[] {
  const versions = SOKO_CURRENT_POLICY_VERSIONS;
  return [
    {
      id: "terms",
      title: "Terms of Use",
      version: versions.termsVersion,
      summary:
        "SOKO is a marketplace that connects buyers with independent sellers. SOKO does not sell listed goods itself and does not guarantee every seller, product, payment, or delivery.",
      body: [
        "SOKO is a marketplace in the Kristo ecosystem. It connects buyers with independent sellers. It is not the seller of the goods on listings created by those sellers.",
        "Buying and selling on SOKO uses your Kristo identity. Listing accuracy, price, payment method, delivery, returns, and disputes are governed by these Terms, the Marketplace Rules, and the independent seller’s own lawful terms where they apply.",
        "SOKO does not guarantee every seller, product, payment, or delivery. A Chat status of Sent means SOKO accepted the message for sending. It does not mean the message was legally delivered or read.",
        "SOKO may hide listings, restrict marketplace features, or act on reports of fraud or prohibited activity as described in the Safety Standards.",
        "These documents are an initial English draft. They are not attorney-reviewed legal advice.",
      ].join("\n\n"),
    },
    {
      id: "privacy",
      title: "Privacy Policy",
      version: versions.privacyVersion,
      summary:
        "SOKO stores the account, listing, order, message, and consent records needed to operate the marketplace. Consent records do not keep IP or device identifiers.",
      body: [
        "SOKO uses your Kristo account to operate buying, selling, Chat, payments, and delivery coordination.",
        "We keep listing, order, message, and policy-consent records that are required to run those features. A consent record includes the policy versions you accepted, the time, app version, platform, and locale. It does not store IP address or advertising device identifiers.",
        "You can review these policies anytime in Settings. Withdrawing consent on a device ends SOKO use on that device. It does not delete your Kristo account, listings, orders, or messages.",
        "These documents are an initial English draft. They are not attorney-reviewed legal advice.",
      ].join("\n\n"),
    },
    {
      id: "marketplace_rules",
      title: "Marketplace Rules",
      version: versions.marketplaceRulesVersion,
      summary:
        "Sellers are responsible for truthful listings. Prohibited goods, fraud, and misleading offers can lead to listing removal or account enforcement.",
      body: [
        "Independent sellers are responsible for the accuracy of titles, photos, price, quantity, condition, and delivery promises.",
        "Do not list prohibited goods, stolen items, or fraudulent offers. Do not impersonate another person or Kristo congregation.",
        "Payment method, delivery, and returns follow the listing, these rules, and any lawful seller terms. SOKO does not promise a result for every transaction.",
        "SOKO may remove listings or limit marketplace access when these rules are broken.",
        "These documents are an initial English draft. They are not attorney-reviewed legal advice.",
      ].join("\n\n"),
    },
    {
      id: "safety",
      title: "Community and Safety Standards",
      version: versions.safetyVersion,
      summary:
        "Report fraud, prohibited goods, and harmful conduct in Safety Center. SOKO can hide listings or restrict marketplace access after a report.",
      body: [
        "Use Safety Center to report fraud, prohibited goods, harassment, or other harmful conduct.",
        "SOKO can hide listings, restrict selling or buying features, or require additional review. That enforcement is about marketplace use. It does not delete your Kristo App account by itself.",
        "Do not use Chat to evade these standards. A Sent chat state is not proof that a person received or read a warning.",
        "These documents are an initial English draft. They are not attorney-reviewed legal advice.",
      ].join("\n\n"),
    },
  ];
}

export function publicSokoPolicyBundle() {
  const versions = SOKO_CURRENT_POLICY_VERSIONS;
  const documents = sokoPolicyDocuments();
  return {
    ok: true as const,
    locale: "en",
    versions,
    documents,
    welcome: {
      title: "Welcome to SOKO",
      subtitle: "A marketplace for Kristo members.",
      explanation: [
        "SOKO connects buyers and independent sellers. Sellers list goods. Buyers browse, message in Chat, and arrange payment and delivery with the seller under these policies.",
        "Buying and selling use your Kristo identity. SOKO does not guarantee every seller, product, payment, or delivery.",
        "Safety Center is how you report fraud or prohibited goods. Chat Sent means the app accepted a message for sending, not that it was legally delivered or read.",
      ].join(" "),
    },
    metadata: {
      reviewStatus: SOKO_POLICY_REVIEW_STATUS,
      enforcement: sokoPolicyEnforcementMode(),
      localizationReady: true,
      materialChange: {
        requiredVersionKeys: [
          "termsVersion",
          "privacyVersion",
          "marketplaceRulesVersion",
          "safetyVersion",
        ] as const,
        comparison: "exact_version_equality" as const,
      },
    },
  };
}

export function parseSokoConsentClientContext(body: unknown) {
  const source =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as {
          appVersion?: unknown;
          platform?: unknown;
          locale?: unknown;
          termsVersion?: unknown;
          privacyVersion?: unknown;
        })
      : {};
  const platformRaw = cleanSokoPolicyText(source.platform, 16).toLowerCase();
  const platform =
    platformRaw === "ios" ||
    platformRaw === "android" ||
    platformRaw === "web"
      ? platformRaw
      : "unknown";
  return {
    appVersion: cleanSokoPolicyText(source.appVersion, 24) || "0.0.0",
    platform,
    locale: cleanSokoPolicyText(source.locale, 16) || "en",
  };
}

export function evaluateSokoPolicyConsent(input: {
  current: SokoPolicyVersions;
  accepted?: SokoPolicyVersions | null;
  enforcement?: SokoPolicyEnforcementMode;
}) {
  const enforcement = input.enforcement || sokoPolicyEnforcementMode();
  const currentAccepted = policyVersionsEqual(input.accepted, input.current);
  if (enforcement === SOKO_POLICY_ENFORCEMENT_OBSERVE) {
    return {
      ok: true as const,
      currentAccepted,
      enforcement,
      blocking: false,
    };
  }
  if (currentAccepted) {
    return {
      ok: true as const,
      currentAccepted: true,
      enforcement,
      blocking: false,
    };
  }
  return {
    ok: false as const,
    currentAccepted: false,
    enforcement,
    blocking: true,
    error: "Current SOKO policy consent is required.",
    code: "consent_required" as const,
  };
}

export function guardSokoSensitiveActionConsent(input: {
  accepted?: SokoPolicyVersions | null;
  enforcement?: SokoPolicyEnforcementMode;
}) {
  return evaluateSokoPolicyConsent({
    current: SOKO_CURRENT_POLICY_VERSIONS,
    accepted: input.accepted,
    enforcement: input.enforcement,
  });
}
