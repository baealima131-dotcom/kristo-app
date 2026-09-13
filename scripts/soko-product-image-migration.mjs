#!/usr/bin/env node
/**
 * Prince Kabika SOKO product-image migration.
 * Default: dry-run only. --apply requires --i-understand-production-writes.
 * --preflight-apply validates and writes a temp manifest without POST or Neon UPDATE.
 * Apply scope is Active listings only. Sold and Deleted never enter apply.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { issueSessionToken } from "../app/api/auth/_lib/sessionToken.ts";
import {
  buildMigrationManifest,
  listSokoProductImageDiskFiles,
  planSokoProductImageListings,
  summarizeMigrationPlans,
} from "./sokoProductImageMigration.ts";
import {
  APPLY_UPLOAD_MAX_BYTES,
  MIGRATION_MANIFEST_NAME,
  MIGRATION_WORK_DIR_NAME,
  assertDualConfirmation,
  containsSecrets,
  parseMigrationFlags,
  postProductionProductImage,
  redactSecrets,
  runActiveOnlyProductionApply,
  selectActiveApplyListings,
  uniqueSellerUserId,
  verifyReturnedPublicImage,
} from "./sokoProductImageApply.ts";

const root = process.cwd();
const diskRoot = path.join(root, ".soko-product-images");
const flags = parseMigrationFlags(process.argv);
const includeSold = process.argv.includes("--include-sold");

function loadDatabaseUrl() {
  const envPath = path.join(root, ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^DATABASE_URL=(.*)$/);
      if (match && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return String(process.env.DATABASE_URL || "").trim();
}

function safePrint(value) {
  const text = redactSecrets(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  if (containsSecrets(text)) {
    console.error("Refusing to print output that still contains secrets.");
    process.exit(1);
  }
  console.log(text);
}

const flagsOk = assertDualConfirmation(flags);
if (!flagsOk.ok) {
  console.error(flagsOk.reason);
  process.exit(1);
}

const sqlUrl = loadDatabaseUrl();
if (!sqlUrl) {
  console.error("DATABASE_URL missing; cannot plan migration.");
  process.exit(1);
}

const sql = neon(sqlUrl);
const rows = await sql`
  SELECT
    p.id,
    p.status,
    p.seller_user_id,
    p.payload->>'title' AS title,
    p.payload->'seller'->>'name' AS seller_name,
    p.payload->'imageKeys' AS image_keys
  FROM soko_products p
  WHERE p.payload->'seller'->>'name' ILIKE 'Prince Kabika'
  ORDER BY p.created_at DESC
`;

const diskFiles = listSokoProductImageDiskFiles(diskRoot);
const listings = planSokoProductImageListings({
  listings: rows.map((row) => ({
    id: String(row.id || ""),
    status: String(row.status || ""),
    title: String(row.title || ""),
    seller: String(row.seller_name || ""),
    sellerUserId: String(row.seller_user_id || ""),
    imageKeys: row.image_keys,
  })),
  diskFiles,
  includeSold: flags.apply || flags.preflightApply ? false : includeSold,
});
const summary = summarizeMigrationPlans(listings);
const scoped = selectActiveApplyListings(listings);

const report = {
  dryRun: !flags.apply,
  preflightApply: flags.preflightApply,
  uploaded: false,
  neonUpdated: false,
  localFilesDeleted: false,
  includeSold: flags.apply || flags.preflightApply ? false : includeSold,
  defaultApplyScope: "Active",
  applyPayloadMaxBytes: APPLY_UPLOAD_MAX_BYTES,
  labels: {
    eligibleActive: summary.eligibleActiveCount,
    excludedSold: summary.excludedSoldCount,
    permanentlyExcludedDeleted: summary.permanentlyExcludedDeletedCount,
    eligibleActiveImageFiles: summary.eligibleActiveImageFileCount,
  },
  ...summary,
  applyEligibleIds: scoped.active.map((row) => row.id),
  listings: listings.map((row) => ({
    id: row.id,
    status: row.status,
    eligibility: row.eligibility,
    title: row.title,
    action: row.action,
    skipReason: row.skipReason,
    observedImageKeys: row.observedImageKeys,
    nextImageKeys: row.nextImageKeys,
    keyCount: row.images.length,
    images: row.images.map((image) => ({
      sourceKey: image.sourceKey,
      durableKey: image.durableKey,
      onDisk: Boolean(image.absolutePath),
      bytes: image.bytes,
      sha256: image.sha256,
    })),
  })),
  manifest: buildMigrationManifest({
    dryRun: !flags.apply,
    includeSold: false,
    plans: listings,
  }),
  applyCommand:
    "npx tsx scripts/soko-product-image-migration.mjs --apply --i-understand-production-writes",
  preflightCommand: "npx tsx scripts/soko-product-image-migration.mjs --preflight-apply",
};

if (flags.preflightApply) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-preflight-"));
  const result = await runActiveOnlyProductionApply({
    flags: { ...flags, apply: false, understoodProductionWrites: false, preflightApply: true },
    plans: listings,
    workDir: path.join(tempDir, "work"),
    manifestPath: path.join(tempDir, "manifest.json"),
    mutate: false,
  });
  safePrint({
    ...report,
    preflight: {
      manifestPath: result.manifest ? "temp" : null,
      listingCount: result.manifest.listings.length,
      posts: result.posts,
      neonUpdates: result.neonUpdates,
      mode: result.mode,
    },
  });
  process.exit(0);
}

if (flags.apply) {
  const sellerUserId = uniqueSellerUserId(scoped.active);
  const sessionToken = sellerUserId ? issueSessionToken(sellerUserId) : "";
  if (!sellerUserId || !sessionToken) {
    console.error("Approved-seller session could not be issued.");
    process.exit(1);
  }
  const result = await runActiveOnlyProductionApply({
    flags,
    plans: listings,
    workDir: path.join(root, MIGRATION_WORK_DIR_NAME),
    manifestPath: path.join(root, MIGRATION_MANIFEST_NAME),
    mutate: true,
    uploadImage: async (file) =>
      postProductionProductImage({
        ...file,
        userId: sellerUserId,
        sessionToken,
      }),
    verifyImage: async (image) => verifyReturnedPublicImage(image),
    casUpdate: async (input) => {
      const expectedJson = JSON.stringify(input.expectedImageKeys);
      const nextJson = JSON.stringify(input.nextImageKeys);
      const updated = await sql`
        UPDATE soko_products
        SET
          payload = jsonb_set(payload, '{imageKeys}', ${nextJson}::jsonb, true),
          updated_at = NOW()
        WHERE id = ${input.listingId}
          AND seller_user_id = ${input.sellerUserId}
          AND status = 'Active'
          AND payload->'imageKeys' = ${expectedJson}::jsonb
        RETURNING id
      `;
      return { updated: Array.isArray(updated) && updated.length === 1 };
    },
  });
  safePrint({
    ok: result.ok,
    posts: result.posts,
    neonUpdates: result.neonUpdates,
    orphanCount: result.manifest.orphans.length,
    listingResults: result.manifest.listings.map((row) => ({
      id: row.id,
      result: row.result,
      resultReason: row.resultReason,
      imageCount: row.images.length,
      uploadedKeys: row.nextImageKeys,
    })),
  });
  process.exit(result.ok ? 0 : 1);
}

safePrint(report);
