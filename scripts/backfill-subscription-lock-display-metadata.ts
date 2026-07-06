/**
 * Backfill missing subscription ownership lock display metadata:
 * lockedChurchName, lockedChurchAvatarUrl, lockedChurchDeletedAt, expiresAt.
 *
 * Local JSON:
 *   npx tsx scripts/backfill-subscription-lock-display-metadata.ts --dryRun
 *
 * Production Postgres:
 *   vercel env pull .env.production.local --environment=production
 *   set -a && source .env.production.local && set +a
 *   npx tsx scripts/backfill-subscription-lock-display-metadata.ts
 *
 * Optional:
 *   --ownerUserId=u_abc123
 *   --dryRun
 */

import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.join(process.cwd(), ".env.production.local") });
loadEnv({ path: path.join(process.cwd(), ".env.local") });
loadEnv({ path: path.join(process.cwd(), ".env") });

import { backfillSubscriptionOwnershipLockDisplayMetadataBatch } from "../app/api/_lib/subscriptionOwnershipLock";
import { resolveSubscriptionOwnershipLockStoreMode } from "../app/api/_lib/store/subscriptionOwnershipLockDb";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, ...rest] = token.slice(2).split("=");
    out[key] = rest.join("=") || "true";
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun === "true";
  const ownerUserId = String(args.ownerUserId || "").trim() || undefined;
  const lockStoreMode = resolveSubscriptionOwnershipLockStoreMode();

  console.log("[backfill-subscription-lock-display-metadata] lock store:", lockStoreMode);
  console.log("[backfill-subscription-lock-display-metadata] dryRun:", dryRun);
  if (ownerUserId) {
    console.log("[backfill-subscription-lock-display-metadata] ownerUserId:", ownerUserId);
  }

  if (lockStoreMode === "missing-db-on-vercel") {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  const result = await backfillSubscriptionOwnershipLockDisplayMetadataBatch({
    ownerUserId,
    dryRun,
  });

  console.log("[backfill-subscription-lock-display-metadata] done", result);
}

main().catch((error) => {
  console.error("[backfill-subscription-lock-display-metadata] failed", error);
  process.exit(1);
});
