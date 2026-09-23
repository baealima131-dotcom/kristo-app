#!/usr/bin/env node
/**
 * Dry-run only: map Prince Kabika local/ image keys to .soko-product-images.
 * Does not upload, delete, or UPDATE Neon.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const root = process.cwd();
const diskRoot = path.join(root, ".soko-product-images");
const keyPattern =
  /^(local|uploads)\/soko-products\/([a-f0-9]{64})\/([a-f0-9-]{36}\.(jpg|png|webp))$/;

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

function listDiskFiles() {
  if (!fs.existsSync(diskRoot)) return [];
  const files = [];
  for (const owner of fs.readdirSync(diskRoot)) {
    const dir = path.join(diskRoot, owner);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!fs.statSync(full).isFile()) continue;
      const bytes = fs.readFileSync(full);
      files.push({
        owner,
        filename: name,
        relative: path.join(owner, name),
        bytes: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        key: `local/soko-products/${owner}/${name}`,
      });
    }
  }
  return files;
}

const sqlUrl = loadDatabaseUrl();
if (!sqlUrl) {
  console.error("DATABASE_URL missing; cannot dry-run.");
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

const disk = listDiskFiles();
const diskByKey = new Map(disk.map((file) => [file.key, file]));
const referenced = new Set();
const listings = [];
const missing = [];
const duplicateKeys = [];
const seenKeys = new Map();

for (const row of rows) {
  const keys = Array.isArray(row.image_keys) ? row.image_keys.map(String) : [];
  const images = [];
  for (const key of keys) {
    const parsed = keyPattern.exec(key);
    const file = diskByKey.get(key);
    if (seenKeys.has(key)) {
      duplicateKeys.push({ key, listings: [...seenKeys.get(key), row.id] });
      seenKeys.get(key).push(row.id);
    } else {
      seenKeys.set(key, [row.id]);
    }
    referenced.add(key);
    const item = {
      keyPrefix: parsed ? `${parsed[1]}/soko-products/` : "invalid",
      filename: parsed ? parsed[3] : null,
      onDisk: Boolean(file),
      bytes: file?.bytes ?? null,
      sha256: file ? file.sha256.slice(0, 12) : null,
    };
    images.push(item);
    if (!file) {
      missing.push({ listingId: row.id, title: row.title, keySuffix: parsed ? parsed[3] : key.slice(-24) });
    }
  }
  listings.push({
    id: row.id,
    status: row.status,
    title: row.title,
    seller: row.seller_name,
    keyCount: keys.length,
    images,
  });
}

const hashCounts = new Map();
for (const file of disk) {
  hashCounts.set(file.sha256, (hashCounts.get(file.sha256) || 0) + 1);
}
const duplicateFiles = disk
  .filter((file) => hashCounts.get(file.sha256) > 1)
  .map((file) => ({ filename: file.filename, sha256: file.sha256.slice(0, 12), bytes: file.bytes }));

const unused = disk
  .filter((file) => !referenced.has(file.key))
  .map((file) => ({ filename: file.filename, bytes: file.bytes, sha256: file.sha256.slice(0, 12) }));

const report = {
  dryRun: true,
  uploaded: false,
  neonUpdated: false,
  listingCount: listings.length,
  diskFileCount: disk.length,
  missingCount: missing.length,
  duplicateKeyCount: duplicateKeys.length,
  duplicateFileCount: duplicateFiles.length,
  unusedFileCount: unused.length,
  listings,
  missing,
  duplicateKeys,
  duplicateFiles,
  unused,
};

console.log(JSON.stringify(report, null, 2));
