/**
 * TEMPORARY DIAGNOSTIC (safe, read-only) for the church media subscription decision.
 *
 * Pure helpers used to build the single `KRISTO_CHURCH_MEDIA_SUBSCRIPTION_DECISION`
 * log line emitted at the end of `GET /api/church/media`, and a branch classifier
 * that names the exact gate that blocked (or allowed) activation.
 *
 * This module MUST stay pure (no DB / no network) so it can be unit-verified by
 * scripts/verify-church-media-subscription-decision.mjs without a live backend.
 * It never logs full transaction ids, receipts, API keys, tokens, or raw RC payloads —
 * store identity is reduced to a boolean (`storeSubscriptionIdentityPresent`).
 */

import {
  isRevenueCatSubscriberAliasedFromChurch,
  type ChurchPremiumVerification,
} from "@/app/api/_lib/revenuecat";

/** Sync-level diagnostics captured inside syncChurchSubscriptionFromRevenueCat. */
export type ChurchSubscriptionSyncDiagnostics = {
  revenueCatActive: boolean;
  revenueCatReason: string;
  detectedEntitlement: string | null;
  /** The RevenueCat app_user_id the server queried with (the churchId). Not sensitive. */
  revenueCatAppUserId: string | null;
  revenueCatSubscriberAliased: boolean;
  store: "app_store" | "play_store" | null;
  storeSubscriptionIdentityPresent: boolean;
  /** null when the ownership lock check was never reached (verification failed first). */
  ownershipLockAllowed: boolean | null;
  ownershipLockReason: string | null;
};

export type ChurchSubscriptionDecisionBlocker =
  | "active"
  | "missing-profile"
  | "not-actual-pastor"
  | "missing-store-identity"
  | "revenuecat-alias-mismatch"
  | "ownership-conflict"
  | "no-entitlement"
  | "unknown";

/**
 * The complete, PII-safe snapshot logged at the end of the subscription decision.
 */
export type ChurchSubscriptionDecisionSnapshot = {
  churchId: string;
  requesterUserId: string;
  hasProfile: boolean;
  isActualPastor: boolean;
  canManageMediaHosts: boolean;
  subscriptionActiveBeforeSync: boolean;
  syncEligible: boolean;
  syncRan: boolean;
  syncSynced: boolean | null;
  syncReason: string | null;
  revenueCatActive: boolean | null;
  revenueCatReason: string | null;
  detectedEntitlement: string | null;
  revenueCatAppUserId: string | null;
  revenueCatSubscriberAliased: boolean | null;
  store: "app_store" | "play_store" | null;
  storeSubscriptionIdentityPresent: boolean | null;
  ownershipLockAllowed: boolean | null;
  ownershipLockReason: string | null;
  subscriptionActiveAfterSync: boolean;
  canUseMediaToolsAfterSync: boolean;
};

export const CHURCH_MEDIA_SUBSCRIPTION_DECISION_EVENT =
  "KRISTO_CHURCH_MEDIA_SUBSCRIPTION_DECISION";

/**
 * Build sync-level diagnostics from a RevenueCat verification and (optional)
 * ownership-lock result. `verification === null` means RevenueCat was never
 * queried (e.g. requester was not the pastor / sync did not run).
 */
export function buildSyncDiagnostics(args: {
  churchId: string;
  verification: ChurchPremiumVerification | null;
  ownershipLockAllowed: boolean | null;
  ownershipLockReason: string | null;
}): ChurchSubscriptionSyncDiagnostics {
  const v = args.verification;
  const churchId = String(args.churchId || "").trim();
  return {
    revenueCatActive: v?.active ?? false,
    revenueCatReason: v?.reason ?? "not-evaluated",
    detectedEntitlement: v?.detectedEntitlement ?? null,
    revenueCatAppUserId: churchId || null,
    revenueCatSubscriberAliased: v
      ? isRevenueCatSubscriberAliasedFromChurch({
          churchId,
          revenueCatOriginalAppUserId: v.revenueCatOriginalAppUserId,
        })
      : false,
    store: v?.store ?? null,
    storeSubscriptionIdentityPresent: Boolean(
      String(v?.storeSubscriptionIdentity || "").trim()
    ),
    ownershipLockAllowed: args.ownershipLockAllowed,
    ownershipLockReason: args.ownershipLockReason ?? null,
  };
}

const STORE_IDENTITY_BLOCK_REASONS = new Set(["unverified-store-identity"]);
const ALIAS_BLOCK_REASONS = new Set(["conflict-pending-verification"]);
const OWNERSHIP_CONFLICT_REASONS = new Set([
  "subscription-ownership-lock",
  "store-subscription-ownership-conflict",
]);
const NO_ENTITLEMENT_REASONS = new Set(["no-entitlement", "expired"]);

/**
 * Classify the exact gate that determined the outcome, from the PII-safe snapshot.
 * Ordered from "already active/allowed" down through the specific blockers so the
 * first matching condition names the responsible branch.
 */
export function classifyChurchSubscriptionDecisionBlocker(
  snapshot: ChurchSubscriptionDecisionSnapshot
): ChurchSubscriptionDecisionBlocker {
  if (snapshot.subscriptionActiveAfterSync) return "active";

  // Gate reached before any RevenueCat call.
  if (!snapshot.canManageMediaHosts || !snapshot.isActualPastor) {
    return "not-actual-pastor";
  }
  if (!snapshot.hasProfile) return "missing-profile";

  const reason = String(snapshot.syncReason || "").trim();

  if (ALIAS_BLOCK_REASONS.has(reason)) return "revenuecat-alias-mismatch";
  if (STORE_IDENTITY_BLOCK_REASONS.has(reason)) return "missing-store-identity";
  if (OWNERSHIP_CONFLICT_REASONS.has(reason)) return "ownership-conflict";
  if (NO_ENTITLEMENT_REASONS.has(reason)) return "no-entitlement";

  // Fallbacks driven by the raw fields when the reason string is less specific.
  if (snapshot.revenueCatActive === false) return "no-entitlement";
  if (
    snapshot.revenueCatActive === true &&
    snapshot.storeSubscriptionIdentityPresent === false
  ) {
    return snapshot.revenueCatSubscriberAliased === true
      ? "revenuecat-alias-mismatch"
      : "missing-store-identity";
  }
  if (snapshot.ownershipLockAllowed === false) return "ownership-conflict";

  return "unknown";
}
