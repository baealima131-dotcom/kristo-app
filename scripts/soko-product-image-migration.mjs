#!/usr/bin/env node
/**
 * Prince Kabika SOKO product-image migration.
 * Default: dry-run only. Default apply scope is Active listings.
 * Deleted listings are never uploaded or updated. Sold requires --include-sold.
 * Does not upload, delete, or UPDATE Neon unless
 * --apply --i-understand-production-writes is passed together.
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  buildMigrationManifest,
  listSokoProductImageDiskFiles,
  planSokoProductImageListings,
  summarizeMigrationPlans,
} from "./sokoProductImageMigration.ts";

const root = process.cwd();
const diskRoot = path.join(root, ".soko-product-images");
const apply = process.argv.includes("--apply");
const understood = process.argv.includes("--i-understand-production-writes");
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

const sqlUrl = loadDatabaseUrl();
if (!sqlUrl) {
  console.error("DATABASE_URL missing; cannot plan migration.");
  process.exit(1);
}

if (apply && !understood) {
  console.error("Refusing --apply without --i-understand-production-writes.");
  process.exit(1);
}

const sql = neon(sqlUrl);
const rows = await sql`
  SELECT
    p.id,
    p.status,
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
    imageKeys: row.image_keys,
  })),
  diskFiles,
  includeSold,
});
const summary = summarizeMigrationPlans(listings);
const manifest = buildMigrationManifest({
  dryRun: !apply,
  includeSold,
  plans: listings,
});

const report = {
  dryRun: !apply,
  uploaded: false,
  neonUpdated: false,
  localFilesDeleted: false,
  includeSold,
  defaultApplyScope: "Active",
  labels: {
    eligibleActive: summary.eligibleActiveCount,
    excludedSold: summary.excludedSoldCount,
    permanentlyExcludedDeleted: summary.permanentlyExcludedDeletedCount,
    eligibleActiveImageFiles: summary.eligibleActiveImageFileCount,
  },
  ...summary,
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
  manifest,
  applyCommand:
    "npx tsx scripts/soko-product-image-migration.mjs --apply --i-understand-production-writes",
  includeSoldApplyCommand:
    "npx tsx scripts/soko-product-image-migration.mjs --apply --include-sold --i-understand-production-writes",
};

if (apply) {
  console.error("Apply mode is implemented only after approval; aborting without writes.");
  process.exit(2);
}

console.log(JSON.stringify(report, null, 2));
