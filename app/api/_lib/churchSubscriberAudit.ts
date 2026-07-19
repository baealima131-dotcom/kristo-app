/**
 * TEMPORARY, PII-safe data/source audit for the church-media subscription
 * investigation. Gated to specific church ids only.
 *
 * Emits two diagnostic events from the EXISTING RevenueCat verification / church
 * media request path (no new public endpoint):
 *   - KRISTO_REVENUECAT_SUBSCRIBER_AUDIT  (RevenueCat subscriber record shape)
 *   - KRISTO_SUBSCRIPTION_LOCK_AUDIT      (existing ownership lock shape)
 *
 * HARD RULES (see verify-subscriber-audit-diagnostic.mjs):
 *   - Never emit raw transaction id, purchase token, receipt, API key, or token.
 *   - Any identity is reduced to boolean presence + a short one-way (sha256) hash.
 *   - Pure & side-effect free (except the caller's console.log); never mutates input.
 *   - Missing fields normalize to null/false and never throw.
 * This module does NOT import revenuecat.ts (avoids an import cycle).
 */

import { createHash } from "node:crypto";

export const SUBSCRIBER_AUDIT_EVENT = "KRISTO_REVENUECAT_SUBSCRIBER_AUDIT";
export const SUBSCRIPTION_LOCK_AUDIT_EVENT = "KRISTO_SUBSCRIPTION_LOCK_AUDIT";

/** Churches for which the temporary audit is enabled. Remove once diagnosed. */
const AUDIT_CHURCH_IDS = new Set(["CH7-8ST0D5"]);

export function isSubscriberAuditChurch(churchId: string | null | undefined): boolean {
  const cid = String(churchId || "").trim().toUpperCase();
  if (!cid) return false;
  if (AUDIT_CHURCH_IDS.has(cid)) return true;
  const envCid = String(process.env.KRISTO_SUBSCRIBER_AUDIT_CHURCH_ID || "").trim().toUpperCase();
  return Boolean(envCid && envCid === cid);
}

/** Candidate store-identity field names on a RevenueCat subscription record. */
const IDENTITY_FIELDS = [
  "original_transaction_id",
  "original_store_transaction_id",
  "store_transaction_id",
  "transaction_id",
  "purchase_token",
  "google_purchase_token",
  "order_id",
] as const;

function trimmedOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function hasValue(value: unknown): boolean {
  return Boolean(String(value ?? "").trim());
}

/** Short, irreversible (one-way) hash for correlating an identity without exposing it. */
export function shortIdentityHash(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export type SubscriptionIdentitySummary = {
  identityFieldNamesPresent: string[];
  identityPresence: Record<string, boolean>;
  identityPresent: boolean;
  identityHash: string | null;
};

export function summarizeSubscriptionIdentity(
  record: Record<string, any> | null | undefined
): SubscriptionIdentitySummary {
  const presence: Record<string, boolean> = {};
  const names: string[] = [];
  for (const field of IDENTITY_FIELDS) {
    const present = hasValue(record?.[field]);
    presence[field] = present;
    if (present) names.push(field);
  }

  let chosen: string | null = null;
  for (const field of IDENTITY_FIELDS) {
    if (hasValue(record?.[field])) {
      chosen = String(record?.[field]).trim();
      break;
    }
  }

  return {
    identityFieldNamesPresent: names,
    identityPresence: presence,
    identityPresent: names.length > 0,
    identityHash: shortIdentityHash(chosen),
  };
}

export type SubscriptionRecordAudit = {
  store: string | null;
  periodType: string | null;
  ownershipType: string | null;
  isSandbox: boolean;
  purchaseDate: string | null;
  originalPurchaseDate: string | null;
  expiresDate: string | null;
  unsubscribeDetectedAtPresent: boolean;
  billingIssuesDetectedAtPresent: boolean;
} & SubscriptionIdentitySummary;

/** PII-safe projection of a RevenueCat subscription record. Never returns raw ids. */
export function buildSubscriptionRecordAudit(
  record: Record<string, any> | null | undefined
): SubscriptionRecordAudit | null {
  if (!record || typeof record !== "object") return null;
  return {
    store: trimmedOrNull(record.store),
    periodType: trimmedOrNull(record.period_type),
    ownershipType: trimmedOrNull(record.ownership_type),
    isSandbox: record.is_sandbox === true,
    purchaseDate: trimmedOrNull(record.purchase_date),
    originalPurchaseDate: trimmedOrNull(record.original_purchase_date),
    expiresDate: trimmedOrNull(record.expires_date),
    unsubscribeDetectedAtPresent: hasValue(record.unsubscribe_detected_at),
    billingIssuesDetectedAtPresent: hasValue(record.billing_issues_detected_at),
    ...summarizeSubscriptionIdentity(record),
  };
}

export type SubscriptionLockAudit = {
  churchId: string;
  lockedChurchId: string | null;
  isLockHolder: boolean;
  store: string | null;
  productId: string | null;
  status: string | null;
  expiresAt: number | null;
  lockedAt: number | null;
  updatedAt: number | null;
  identityPresent: boolean;
  identityHash: string | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** PII-safe projection of an ownership lock record. Never returns raw identity. */
export function buildLockAudit(
  lock: Record<string, any> | null | undefined,
  churchId: string
): SubscriptionLockAudit {
  const cid = String(churchId || "").trim();
  if (!lock || typeof lock !== "object") {
    return {
      churchId: cid,
      lockedChurchId: null,
      isLockHolder: false,
      store: null,
      productId: null,
      status: null,
      expiresAt: null,
      lockedAt: null,
      updatedAt: null,
      identityPresent: false,
      identityHash: null,
    };
  }

  const lockedChurchId = trimmedOrNull(lock.lockedChurchId);
  const identity = trimmedOrNull(lock.storeSubscriptionIdentity);
  return {
    churchId: cid,
    lockedChurchId,
    isLockHolder: Boolean(
      lockedChurchId && cid && lockedChurchId.toUpperCase() === cid.toUpperCase()
    ),
    store: trimmedOrNull(lock.store),
    productId: trimmedOrNull(lock.productId),
    status: trimmedOrNull(lock.status),
    expiresAt: numberOrNull(lock.expiresAt),
    lockedAt: numberOrNull(lock.lockedAt),
    updatedAt: numberOrNull(lock.updatedAt),
    identityPresent: Boolean(identity),
    identityHash: shortIdentityHash(identity),
  };
}
