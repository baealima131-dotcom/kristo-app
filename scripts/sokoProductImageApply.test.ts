import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPLY_UPLOAD_MAX_BYTES,
  assertApplyPayloadSize,
  assertDualConfirmation,
  buildBeforeStateManifest,
  buildCasUpdateSql,
  containsSecrets,
  parseMigrationFlags,
  redactSecrets,
  resolveUploadFile,
  runActiveOnlyProductionApply,
  selectActiveApplyListings,
} from "./sokoProductImageApply.ts";
import { planSokoProductImageListings } from "./sokoProductImageMigration.ts";

const owner = "b".repeat(64);
const fileA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const fileB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

function listing(id: string, status: string, keys: string[], filePath: string) {
  return planSokoProductImageListings({
    listings: [{
      id,
      status,
      title: id,
      seller: "Prince Kabika",
      sellerUserId: "seller-1",
      imageKeys: keys,
    }],
    diskFiles: keys.map((key) => ({
      key,
      owner,
      filename: key.split("/").pop() || "",
      absolutePath: filePath,
      bytes: fs.statSync(filePath).size,
      sha256: "x",
    })),
  })[0];
}

function jpegFile(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-apply-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, jpeg);
  return filePath;
}

test("dual confirmation flags are required for apply", () => {
  assert.equal(parseMigrationFlags(["--apply"]).apply, true);
  assert.equal(assertDualConfirmation({
    apply: true,
    understoodProductionWrites: false,
    preflightApply: false,
  }).ok, false);
  assert.equal(assertDualConfirmation({
    apply: true,
    understoodProductionWrites: true,
    preflightApply: false,
  }).ok, true);
  assert.equal(assertDualConfirmation({
    apply: false,
    understoodProductionWrites: false,
    preflightApply: true,
  }).ok, true);
});

test("Active-only apply excludes Sold and Deleted", () => {
  const filePath = jpegFile(`${fileA}.jpg`);
  const key = `local/soko-products/${owner}/${fileA}.jpg`;
  const plans = [
    listing("active", "Active", [key], filePath),
    listing("sold", "Sold", [key], filePath),
    listing("deleted", "Deleted", [key], filePath),
  ];
  const scoped = selectActiveApplyListings(plans);
  assert.equal(scoped.active.length, 1);
  assert.equal(scoped.active[0].id, "active");
  assert.equal(scoped.excludedSold.length, 1);
  assert.equal(scoped.excludedDeleted.length, 1);
});

test("oversized files are refused before optimization", () => {
  assert.equal(assertApplyPayloadSize(APPLY_UPLOAD_MAX_BYTES).ok, true);
  assert.equal(assertApplyPayloadSize(APPLY_UPLOAD_MAX_BYTES + 1).ok, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-oversize-"));
  const filePath = path.join(dir, `${fileA}.jpg`);
  const huge = Buffer.alloc(APPLY_UPLOAD_MAX_BYTES + 12, 0);
  huge[0] = 0xff;
  huge[1] = 0xd8;
  huge[2] = 0xff;
  fs.writeFileSync(filePath, huge);
  assert.throws(() => resolveUploadFile({
    sourcePath: filePath,
    sourceKey: `local/soko-products/${owner}/${fileA}.jpg`,
    workDir: path.join(dir, "work"),
    allowOptimize: false,
  }), /3500000 byte apply payload limit/);
});

test("optimized payload is below 3.5 MB", () => {
  const real = path.join(
    process.cwd(),
    ".soko-product-images",
    "485938dd0268b49bdc8fe3f2ae7bbef80e927d657bc0e122592e707e9c87f08f",
    "c4ac3ddc-70f2-4397-b0e5-ccbe0033303e.png"
  );
  assert.equal(fs.existsSync(real), true);
  const originalBytes = fs.statSync(real).size;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-opt-"));
  const resolved = resolveUploadFile({
    sourcePath: real,
    sourceKey: "local/soko-products/485938dd0268b49bdc8fe3f2ae7bbef80e927d657bc0e122592e707e9c87f08f/c4ac3ddc-70f2-4397-b0e5-ccbe0033303e.png",
    workDir: dir,
    allowOptimize: true,
  });
  assert.ok(resolved.derived);
  assert.ok(resolved.upload.bytes <= APPLY_UPLOAD_MAX_BYTES);
  assert.equal(fs.statSync(real).size, originalBytes);
  assert.match(resolved.upload.path, /\.(jpg|jpeg|webp|png)$/i);
});

test("manifest is written before the first upload", async () => {
  const filePath = jpegFile(`${fileA}.jpg`);
  const key = `local/soko-products/${owner}/${fileA}.jpg`;
  const plan = listing("active", "Active", [key], filePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-manifest-"));
  const manifestPath = path.join(dir, "manifest.json");
  let sawManifestBeforeUpload = false;
  await runActiveOnlyProductionApply({
    flags: { apply: true, understoodProductionWrites: true, preflightApply: false },
    plans: [plan],
    workDir: path.join(dir, "work"),
    manifestPath,
    mutate: true,
    uploadImage: async () => {
      sawManifestBeforeUpload = fs.existsSync(manifestPath);
      const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(current.listings[0].images[0].uploaded, null);
      return {
        key: `uploads/soko-products/${owner}/${fileA}.jpg`,
        url: "https://cdn.example/photo.jpg",
        mime: "image/jpeg",
        size: jpeg.length,
      };
    },
    verifyImage: async () => true,
    casUpdate: async () => ({ updated: true }),
  });
  assert.equal(sawManifestBeforeUpload, true);
});

test("resume reuses uploaded objects and does not duplicate POSTs", async () => {
  const filePath = jpegFile(`${fileA}.jpg`);
  const key = `local/soko-products/${owner}/${fileA}.jpg`;
  const plan = listing("active", "Active", [key], filePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-resume-"));
  const manifestPath = path.join(dir, "manifest.json");
  let posts = 0;
  const deps = {
    flags: { apply: true, understoodProductionWrites: true, preflightApply: false },
    plans: [plan],
    workDir: path.join(dir, "work"),
    manifestPath,
    mutate: true as const,
    uploadImage: async () => {
      posts += 1;
      return {
        key: `uploads/soko-products/${owner}/${fileA}.jpg`,
        url: "https://cdn.example/photo.jpg",
        mime: "image/jpeg",
        size: jpeg.length,
      };
    },
    verifyImage: async () => true,
    casUpdate: async () => ({ updated: true }),
  };
  await runActiveOnlyProductionApply(deps);
  assert.equal(posts, 1);
  const casCalls = { count: 0 };
  await runActiveOnlyProductionApply({
    ...deps,
    casUpdate: async () => {
      casCalls.count += 1;
      return { updated: true };
    },
  });
  assert.equal(posts, 1);
  assert.equal(casCalls.count, 0);
});

test("multi-image listings update Neon only after every image succeeds", async () => {
  const pathA = jpegFile(`${fileA}.jpg`);
  const pathB = jpegFile(`${fileB}.jpg`);
  const keyA = `local/soko-products/${owner}/${fileA}.jpg`;
  const keyB = `local/soko-products/${owner}/${fileB}.jpg`;
  const plan = planSokoProductImageListings({
    listings: [{
      id: "multi",
      status: "Active",
      title: "multi",
      seller: "Prince Kabika",
      sellerUserId: "seller-1",
      imageKeys: [keyA, keyB],
    }],
    diskFiles: [
      { key: keyA, owner, filename: `${fileA}.jpg`, absolutePath: pathA, bytes: jpeg.length, sha256: "a" },
      { key: keyB, owner, filename: `${fileB}.jpg`, absolutePath: pathB, bytes: jpeg.length, sha256: "b" },
    ],
  })[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-multi-"));
  let casCalls = 0;
  const failed = await runActiveOnlyProductionApply({
    flags: { apply: true, understoodProductionWrites: true, preflightApply: false },
    plans: [plan],
    workDir: path.join(dir, "work"),
    manifestPath: path.join(dir, "manifest.json"),
    mutate: true,
    uploadImage: async ({ filename }) => ({
      key: `uploads/soko-products/${owner}/${filename.replace(".opt.", ".")}`,
      url: `https://cdn.example/${filename}`,
      mime: "image/jpeg",
      size: jpeg.length,
    }),
    verifyImage: async ({ url }) => !url.includes(fileB),
    casUpdate: async () => {
      casCalls += 1;
      return { updated: true };
    },
  });
  assert.equal(failed.neonUpdates, 0);
  assert.equal(casCalls, 0);
  assert.equal(failed.manifest.listings[0].result, "failed");
});

test("CAS success and failure preserve order and report orphans", async () => {
  const filePath = jpegFile(`${fileA}.jpg`);
  const key = `local/soko-products/${owner}/${fileA}.jpg`;
  const plan = listing("active", "Active", [key], filePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-cas-"));
  const ok = await runActiveOnlyProductionApply({
    flags: { apply: true, understoodProductionWrites: true, preflightApply: false },
    plans: [plan],
    workDir: path.join(dir, "ok"),
    manifestPath: path.join(dir, "ok.json"),
    mutate: true,
    uploadImage: async () => ({
      key: `uploads/soko-products/${owner}/${fileA}.jpg`,
      url: "https://cdn.example/photo.jpg",
      mime: "image/jpeg",
      size: jpeg.length,
    }),
    verifyImage: async () => true,
    casUpdate: async ({ nextImageKeys, expectedImageKeys }) => {
      assert.deepEqual(expectedImageKeys, [key]);
      assert.deepEqual(nextImageKeys, [`uploads/soko-products/${owner}/${fileA}.jpg`]);
      return { updated: true };
    },
  });
  assert.equal(ok.neonUpdates, 1);
  assert.match(buildCasUpdateSql(), /status = 'Active'/);
  assert.match(buildCasUpdateSql(), /seller_user_id = \$seller/);

  const conflict = await runActiveOnlyProductionApply({
    flags: { apply: true, understoodProductionWrites: true, preflightApply: false },
    plans: [plan],
    workDir: path.join(dir, "fail"),
    manifestPath: path.join(dir, "fail.json"),
    mutate: true,
    uploadImage: async () => ({
      key: `uploads/soko-products/${owner}/${fileA}.jpg`,
      url: "https://cdn.example/photo.jpg",
      mime: "image/jpeg",
      size: jpeg.length,
    }),
    verifyImage: async () => true,
    casUpdate: async () => ({ updated: false }),
  });
  assert.equal(conflict.neonUpdates, 0);
  assert.equal(conflict.manifest.listings[0].result, "cas_conflict");
  assert.equal(conflict.manifest.orphans.length, 1);
  assert.equal(conflict.manifest.orphans[0].reason, "cas_conflict");
});

test("secret redaction strips credentials from printable output", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://user:super-secret-pass@example.com/db";
  try {
    const raw = `url=${process.env.DATABASE_URL} token=x-kristo-session-token:abc`;
    const redacted = redactSecrets(raw);
    assert.equal(redacted.includes("super-secret-pass"), false);
    assert.equal(containsSecrets(redacted), false);
    assert.match(redacted, /redacted:DATABASE_URL|redacted:DATABASE/);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("preflight builds CAS plan and does not POST or update Neon", async () => {
  const filePath = jpegFile(`${fileA}.jpg`);
  const key = `local/soko-products/${owner}/${fileA}.jpg`;
  const plan = listing("active", "Active", [key], filePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soko-pre-"));
  let posts = 0;
  const result = await runActiveOnlyProductionApply({
    flags: { apply: false, understoodProductionWrites: false, preflightApply: true },
    plans: [plan],
    workDir: path.join(dir, "work"),
    manifestPath: path.join(dir, "manifest.json"),
    mutate: false,
    uploadImage: async () => {
      posts += 1;
      throw new Error("should not upload");
    },
    casUpdate: async () => {
      throw new Error("should not update neon");
    },
  });
  assert.equal(posts, 0);
  assert.equal(result.neonUpdates, 0);
  assert.equal(result.mode, "preflight");
  assert.equal(result.manifest.listings[0].images[0].uploaded, null);
  const before = buildBeforeStateManifest({
    plans: [plan],
    workDir: path.join(dir, "work2"),
    mode: "preflight",
    allowOptimize: true,
  });
  assert.equal(before.listings[0].status, "Active");
});
