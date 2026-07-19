/**
 * Short, irreversible (one-way) hashing for store-subscription identities so we
 * can correlate / diff them in logs and diagnostics WITHOUT ever emitting the
 * raw transaction id, purchase token, receipt, or order id.
 *
 * Never log or return the raw identity — use these helpers instead.
 */

import { createHash } from "node:crypto";

/** sha256, first 12 hex chars. Returns null for empty input. */
export function shortIdentityHash(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

/** Convenience projection for structured logs: presence boolean + short hash. */
export function identityLogFields(value: unknown): {
  present: boolean;
  hash: string | null;
} {
  const s = String(value ?? "").trim();
  return { present: Boolean(s), hash: shortIdentityHash(s) };
}
