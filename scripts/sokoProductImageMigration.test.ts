import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildMigrationManifest,
  durableKeyForLocalKey,
  migratePlannedListing,
  planSokoProductImageListings,
  storedObjectMatchesLocal,
  summarizeMigrationPlans,
  verifyPublicHttpsImage,
} from "./sokoProductImageMigration.ts";

const owner = "a".repeat(64);
const fileId = "11111111-1111-1111-1111-111111111111";
const localKey = `local/soko-products/${owner}/${fileId}.jpg`;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function writeJpeg() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-img-"));
  const filePath = path.join(dir, `${fileId}.jpg`);
  fs.writeFileSync(filePath, jpeg);
  return {
    filePath,
    diskFiles: [{
      key: localKey,
      owner,
      filename: `${fileId}.jpg`,
      absolutePath: filePath,
      bytes: jpeg.length,
      sha256: "abc",
    }],
  };
}

test("local keys map to uploads/soko-products keys with the same filename", () => {
  assert.equal(
    durableKeyForLocalKey(localKey),
    `uploads/soko-products/${owner}/${fileId}.jpg`
  );
  assert.equal(durableKeyForLocalKey("not-a-key"), null);
});

test("missing or duplicate keys skip the whole listing", () => {
  const { diskFiles } = writeJpeg();

  const missing = planSokoProductImageListings({
    listings: [{
      id: "one",
      status: "Active",
      title: "Bag",
      seller: "Prince Kabika",
      imageKeys: [localKey, `local/soko-products/${owner}/22222222-2222-2222-2222-222222222222.jpg`],
    }],
    diskFiles,
  });
  assert.equal(missing[0].action, "skip");
  assert.match(String(missing[0].skipReason), /missing local file/);

  const duplicated = planSokoProductImageListings({
    listings: [
      { id: "a", status: "Active", title: "A", seller: "Prince Kabika", imageKeys: [localKey] },
      { id: "b", status: "Active", title: "B", seller: "Prince Kabika", imageKeys: [localKey] },
    ],
    diskFiles,
  });
  assert.equal(duplicated.every((row) => row.action === "skip"), true);
});

test("default scope is Active only; Sold needs --include-sold; Deleted never migrates", () => {
  const { diskFiles } = writeJpeg();
  const soldKey = `local/soko-products/${owner}/22222222-2222-2222-2222-222222222222.jpg`;
  const deletedKey = `local/soko-products/${owner}/33333333-3333-3333-3333-333333333333.jpg`;
  const extra = [
    {
      key: soldKey,
      owner,
      filename: "22222222-2222-2222-2222-222222222222.jpg",
      absolutePath: diskFiles[0].absolutePath,
      bytes: jpeg.length,
      sha256: "sold",
    },
    {
      key: deletedKey,
      owner,
      filename: "33333333-3333-3333-3333-333333333333.jpg",
      absolutePath: diskFiles[0].absolutePath,
      bytes: jpeg.length,
      sha256: "deleted",
    },
  ];

  const plans = planSokoProductImageListings({
    listings: [
      { id: "active", status: "Active", title: "A", seller: "Prince Kabika", imageKeys: [localKey] },
      { id: "sold", status: "Sold", title: "S", seller: "Prince Kabika", imageKeys: [soldKey] },
      { id: "deleted", status: "Deleted", title: "D", seller: "Prince Kabika", imageKeys: [deletedKey] },
    ],
    diskFiles: [...diskFiles, ...extra],
  });
  const summary = summarizeMigrationPlans(plans);
  assert.equal(summary.eligibleActiveCount, 1);
  assert.equal(summary.excludedSoldCount, 2 - 1);
  assert.equal(summary.excludedSoldCount, 1);
  assert.equal(summary.permanentlyExcludedDeletedCount, 1);
  assert.equal(plans.find((row) => row.id === "active")?.action, "migrate");
  assert.equal(plans.find((row) => row.id === "sold")?.eligibility, "excluded_sold");
  assert.match(String(plans.find((row) => row.id === "sold")?.skipReason), /excluded Sold/);
  assert.equal(plans.find((row) => row.id === "deleted")?.eligibility, "permanently_excluded_deleted");
  assert.match(String(plans.find((row) => row.id === "deleted")?.skipReason), /permanently excluded Deleted/);

  const withSold = planSokoProductImageListings({
    listings: [
      { id: "sold", status: "Sold", title: "S", seller: "Prince Kabika", imageKeys: [soldKey] },
      { id: "deleted", status: "Deleted", title: "D", seller: "Prince Kabika", imageKeys: [deletedKey] },
    ],
    diskFiles: extra,
    includeSold: true,
  });
  assert.equal(withSold.find((row) => row.id === "sold")?.action, "migrate");
  assert.equal(withSold.find((row) => row.id === "deleted")?.action, "skip");
});

test("Sold sharing a key with Active does not block Active when Sold is excluded", () => {
  const { diskFiles } = writeJpeg();
  const plans = planSokoProductImageListings({
    listings: [
      { id: "active", status: "Active", title: "A", seller: "Prince Kabika", imageKeys: [localKey] },
      { id: "sold", status: "Sold", title: "S", seller: "Prince Kabika", imageKeys: [localKey] },
    ],
    diskFiles,
  });
  assert.equal(plans.find((row) => row.id === "active")?.action, "migrate");
  assert.equal(plans.find((row) => row.id === "sold")?.action, "skip");
});

test("ready listings keep order and do not invent URLs", () => {
  const { diskFiles } = writeJpeg();
  const plans = planSokoProductImageListings({
    listings: [{
      id: "ready",
      status: "Active",
      title: "Shoes",
      seller: "Prince Kabika",
      imageKeys: [localKey],
    }],
    diskFiles,
  });
  assert.equal(plans[0].action, "migrate");
  assert.deepEqual(plans[0].observedImageKeys, [localKey]);
  assert.deepEqual(plans[0].nextImageKeys, [
    `uploads/soko-products/${owner}/${fileId}.jpg`,
  ]);
  assert.equal(plans[0].nextImageKeys.some((key) => key.startsWith("local/")), false);
});

test("apply updates Neon only after every image verifies", async () => {
  const { diskFiles } = writeJpeg();
  const [plan] = planSokoProductImageListings({
    listings: [{
      id: "ready",
      status: "Active",
      title: "Shoes",
      seller: "Prince Kabika",
      imageKeys: [localKey],
    }],
    diskFiles,
  });
  const updated: string[] = [];
  const failed = await migratePlannedListing(plan, {
    uploadFile: async ({ durableKey }) => ({ key: durableKey }),
    publicImageOk: async () => false,
    updateImageKeys: async ({ listingId }) => {
      updated.push(listingId);
      return { updated: true };
    },
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(updated, []);

  const ok = await migratePlannedListing(plan, {
    uploadFile: async ({ durableKey }) => ({ key: durableKey }),
    publicImageOk: async () => true,
    updateImageKeys: async ({ listingId, expectedImageKeys, nextImageKeys }) => {
      updated.push(listingId);
      assert.deepEqual(expectedImageKeys, [localKey]);
      assert.equal(nextImageKeys[0].startsWith("uploads/soko-products/"), true);
      return { updated: true };
    },
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(updated, ["ready"]);
});

test("compare-and-swap skips when Neon imageKeys changed since dry-run", async () => {
  const { diskFiles } = writeJpeg();
  const [plan] = planSokoProductImageListings({
    listings: [{
      id: "ready",
      status: "Active",
      title: "Shoes",
      seller: "Prince Kabika",
      imageKeys: [localKey],
    }],
    diskFiles,
  });
  const result = await migratePlannedListing(plan, {
    uploadFile: async ({ durableKey }) => ({ key: durableKey }),
    publicImageOk: async () => true,
    updateImageKeys: async () => ({ updated: false }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.result, "cas_conflict");
});

test("HeadObject match is idempotent; mismatch is never overwritten", async () => {
  const { diskFiles } = writeJpeg();
  const [plan] = planSokoProductImageListings({
    listings: [{
      id: "ready",
      status: "Active",
      title: "Shoes",
      seller: "Prince Kabika",
      imageKeys: [localKey],
    }],
    diskFiles,
  });
  const uploaded: string[] = [];
  const matched = await migratePlannedListing(plan, {
    uploadFile: async ({ durableKey }) => {
      uploaded.push(durableKey);
      return { key: durableKey };
    },
    publicImageOk: async () => true,
    inspectStored: async () => "match",
    updateImageKeys: async () => ({ updated: true }),
  });
  assert.equal(matched.ok, true);
  assert.deepEqual(uploaded, []);

  const mismatched = await migratePlannedListing(plan, {
    uploadFile: async ({ durableKey }) => {
      uploaded.push(durableKey);
      return { key: durableKey };
    },
    publicImageOk: async () => true,
    inspectStored: async () => "mismatch",
    updateImageKeys: async () => ({ updated: true }),
  });
  assert.equal(mismatched.ok, false);
  assert.match(mismatched.reason, /refusing overwrite/);
  assert.deepEqual(uploaded, []);
  assert.equal(storedObjectMatchesLocal({
    localBytes: 12,
    localMime: "image/jpeg",
    contentLength: 99,
    contentType: "image/jpeg",
  }), false);
});

test("Deleted listings cannot be applied even if the plan action were migrate", async () => {
  const { diskFiles } = writeJpeg();
  const [plan] = planSokoProductImageListings({
    listings: [{
      id: "gone",
      status: "Deleted",
      title: "Gone",
      seller: "Prince Kabika",
      imageKeys: [localKey],
    }],
    diskFiles,
  });
  const result = await migratePlannedListing({ ...plan, action: "migrate" }, {
    uploadFile: async ({ durableKey }) => ({ key: durableKey }),
    publicImageOk: async () => true,
    updateImageKeys: async () => ({ updated: true }),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /permanently excluded Deleted/);
});

test("public HTTPS image verification retries then requires 200 and image/*", async () => {
  let calls = 0;
  const ok = await verifyPublicHttpsImage({
    url: "https://cdn.example/photo.jpg",
    attempts: 3,
    delayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        return new Response("no", { status: 404, headers: { "content-type": "text/plain" } });
      }
      return new Response("ok", { status: 200, headers: { "content-type": "image/jpeg" } });
    },
  });
  assert.equal(ok, true);
  assert.equal(calls, 3);
  assert.equal(
    await verifyPublicHttpsImage({ url: "http://insecure.example/photo.jpg" }),
    false
  );
});

test("manifest is recoverable and omits credentials", () => {
  const { diskFiles } = writeJpeg();
  const plans = planSokoProductImageListings({
    listings: [
      { id: "active", status: "Active", title: "A", seller: "Prince Kabika", imageKeys: [localKey] },
      { id: "sold", status: "Sold", title: "S", seller: "Prince Kabika", imageKeys: [localKey] },
      { id: "deleted", status: "Deleted", title: "D", seller: "Prince Kabika", imageKeys: [localKey] },
    ],
    diskFiles,
  });
  const manifest = buildMigrationManifest({ dryRun: true, includeSold: false, plans });
  const serialized = JSON.stringify(manifest);
  assert.equal(manifest.eligibleActiveCount, 1);
  assert.equal(manifest.excludedSoldCount, 1);
  assert.equal(manifest.permanentlyExcludedDeletedCount, 1);
  assert.equal(manifest.listings[0].observedImageKeys[0], localKey);
  assert.equal(manifest.listings[0].nextImageKeys[0].startsWith("uploads/soko-products/"), true);
  assert.equal(serialized.includes("DATABASE_URL"), false);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("password"), false);
});
