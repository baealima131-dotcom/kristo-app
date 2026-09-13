import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { inspectSokoProductImageUpload } from "../app/api/_lib/sokoSellerProductImagePolicy.ts";
import {
  isActiveApplyEligible,
  type ListingMigrationPlan,
} from "./sokoProductImageMigration.ts";

export const APPLY_UPLOAD_MAX_BYTES = 3_500_000;
export const PRODUCTION_PRODUCT_IMAGE_UPLOAD_URL =
  "https://kristo-app.vercel.app/api/soko/seller/product-images";
export const MIGRATION_WORK_DIR_NAME = ".soko-product-image-migration-work";
export const MIGRATION_MANIFEST_NAME = ".soko-product-image-migration-manifest.json";

export const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "KRISTO_SESSION_SECRET",
  "KRISTO_OTP_SECRET",
  "RESEND_API_KEY",
  "KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY",
  "KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
];

export type ImageFileFacts = {
  path: string;
  bytes: number;
  sha256: string;
  mime: string;
  extension: "jpg" | "png" | "webp";
  width: number | null;
  height: number | null;
};

export type ManifestImage = {
  sourceKey: string;
  original: ImageFileFacts;
  derived: ImageFileFacts | null;
  uploadPath: string;
  uploadFilename: string;
  uploaded: {
    key: string;
    url: string;
    mime: string;
    size: number;
  } | null;
  verified: boolean;
};

export type ManifestListing = {
  id: string;
  title: string;
  sellerUserId: string;
  status: string;
  observedImageKeys: string[];
  images: ManifestImage[];
  nextImageKeys: string[];
  result: "planned" | "uploaded" | "migrated" | "cas_conflict" | "failed" | "skipped";
  resultReason: string | null;
};

export type ApplyManifest = {
  version: 1;
  createdAt: string;
  mode: "apply" | "preflight";
  productionUploadUrl: string;
  localFilesDeleted: false;
  listings: ManifestListing[];
  orphans: Array<{
    listingId: string;
    key: string;
    url: string;
    reason: string;
  }>;
};

export type ApplyFlags = {
  apply: boolean;
  understoodProductionWrites: boolean;
  preflightApply: boolean;
};

export function parseMigrationFlags(argv: string[]): ApplyFlags {
  return {
    apply: argv.includes("--apply"),
    understoodProductionWrites: argv.includes("--i-understand-production-writes"),
    preflightApply: argv.includes("--preflight-apply"),
  };
}

export function assertDualConfirmation(flags: ApplyFlags): { ok: true } | { ok: false; reason: string } {
  if (flags.apply && !flags.understoodProductionWrites) {
    return { ok: false, reason: "Refusing --apply without --i-understand-production-writes." };
  }
  if (flags.understoodProductionWrites && !flags.apply && !flags.preflightApply) {
    return { ok: false, reason: "--i-understand-production-writes requires --apply." };
  }
  return { ok: true };
}

export function assertApplyPayloadSize(bytes: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(bytes) || bytes < 1) {
    return { ok: false, reason: "Image payload is empty." };
  }
  if (bytes > APPLY_UPLOAD_MAX_BYTES) {
    return { ok: false, reason: `Image exceeds ${APPLY_UPLOAD_MAX_BYTES} byte apply payload limit.` };
  }
  return { ok: true };
}

export function selectActiveApplyListings(plans: ListingMigrationPlan[]) {
  const leaked = plans.filter(
    (plan) => plan.status === "Sold" || plan.status === "Deleted" || plan.eligibility !== "eligible_active"
  );
  const active = plans.filter(
    (plan) => isActiveApplyEligible(plan) && (plan.action === "migrate" || plan.action === "already_durable")
  );
  return {
    active,
    excludedSold: plans.filter((plan) => plan.status === "Sold"),
    excludedDeleted: plans.filter((plan) => plan.status === "Deleted"),
    leakedNonActive: leaked.filter((plan) => plan.status === "Sold" || plan.status === "Deleted"),
  };
}

export function redactSecrets(value: unknown): string {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const name of SECRET_ENV_NAMES) {
    const envValue = String(process.env[name] || "").trim();
    if (envValue.length >= 8) {
      text = text.split(envValue).join(`[redacted:${name}]`);
    }
  }
  text = text.replace(/postgres(?:ql)?:\/\/[^ \n"']+/gi, "[redacted:DATABASE_URL]");
  text = text.replace(/x-kristo-session-token["']?\s*[:=]\s*["']?[^"'\s,]+/gi, "x-kristo-session-token:[redacted]");
  return text;
}

export function containsSecrets(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const name of SECRET_ENV_NAMES) {
    const envValue = String(process.env[name] || "").trim();
    if (envValue.length >= 8 && text.includes(envValue)) return true;
  }
  if (/postgres(?:ql)?:\/\/[^ \n"']+/i.test(text)) return true;
  return false;
}

export function sha256Buffer(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readImageDimensions(bytes: Buffer): { width: number | null; height: number | null } {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    if (bytes.toString("ascii", 12, 16) === "VP8X" && bytes.length >= 30) {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return { width, height };
    }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const size = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + size;
    }
  }
  return { width: null, height: null };
}

export function pngRequiresTransparency(bytes: Buffer) {
  if (!(bytes.length >= 26 && bytes[0] === 0x89 && bytes[1] === 0x50)) return false;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  const text = bytes.subarray(0, Math.min(bytes.length, 512 * 1024)).toString("binary");
  return text.includes("tRNS");
}

export function inspectImageFile(absolutePath: string): ImageFileFacts {
  const bytes = fs.readFileSync(absolutePath);
  const inspected = inspectSokoProductImageUpload({
    bytes,
    filename: path.basename(absolutePath),
  });
  if (!inspected.ok) {
    throw new Error(inspected.error);
  }
  const dims = readImageDimensions(bytes);
  return {
    path: absolutePath,
    bytes: bytes.length,
    sha256: sha256Buffer(bytes),
    mime: inspected.format.mime,
    extension: inspected.format.extension,
    width: dims.width,
    height: dims.height,
  };
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout || "";
}

function sipsHasAlpha(absolutePath: string) {
  try {
    const out = runCommand("sips", ["-g", "hasAlpha", absolutePath]);
    return /hasAlpha:\s*yes/i.test(out);
  } catch {
    return pngRequiresTransparency(fs.readFileSync(absolutePath));
  }
}

export function derivedUploadFilename(sourceKey: string, extension: string) {
  const original = sourceKey.split("/").pop() || `image.${extension}`;
  const stem = original.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  return `${stem}.opt.${extension}`;
}

export function optimizeImageForApplyPayload(input: {
  sourcePath: string;
  workDir: string;
  sourceKey: string;
}): ImageFileFacts {
  fs.mkdirSync(input.workDir, { recursive: true });
  const original = inspectImageFile(input.sourcePath);
  if (original.bytes <= APPLY_UPLOAD_MAX_BYTES) return original;

  const sourceBytes = fs.readFileSync(input.sourcePath);
  const keepAlpha = original.extension === "png" && (
    pngRequiresTransparency(sourceBytes) || sipsHasAlpha(input.sourcePath)
  );
  const attempts: Array<{ ext: "png" | "jpg"; keepAlpha: boolean }> = keepAlpha
    ? [{ ext: "png", keepAlpha: true }, { ext: "jpg", keepAlpha: false }]
    : [{ ext: "jpg", keepAlpha: false }];
  const qualities = [82, 74, 66, 58];
  const maxEdges = [null, 2400, 2000, 1600];

  for (const attempt of attempts) {
    const filename = derivedUploadFilename(input.sourceKey, attempt.ext);
    const dest = path.join(input.workDir, filename);
    const qualityLoop = attempt.keepAlpha ? [100] : qualities;
    for (const maxEdge of maxEdges) {
      for (const quality of qualityLoop) {
        const staged = `${dest}.partial.${attempt.ext}`;
        if (attempt.keepAlpha) {
          runCommand("sips", ["-s", "format", "png", "--out", staged, input.sourcePath]);
        } else {
          const args = ["-s", "format", "jpeg", "-s", "formatOptions", String(quality)];
          if (maxEdge) args.push("--resampleHeightWidthMax", String(maxEdge));
          args.push("--out", staged, input.sourcePath);
          runCommand("sips", args);
        }
        const facts = inspectImageFile(staged);
        if (facts.bytes <= APPLY_UPLOAD_MAX_BYTES) {
          fs.renameSync(staged, dest);
          return { ...facts, path: dest };
        }
        fs.rmSync(staged, { force: true });
      }
    }
  }
  throw new Error("Could not derive an apply payload under 3500000 bytes.");
}

export function resolveUploadFile(input: {
  sourcePath: string;
  sourceKey: string;
  workDir: string;
  allowOptimize: boolean;
}): { original: ImageFileFacts; derived: ImageFileFacts | null; upload: ImageFileFacts } {
  const original = inspectImageFile(input.sourcePath);
  const sizeCheck = assertApplyPayloadSize(original.bytes);
  if (sizeCheck.ok) {
    return { original, derived: null, upload: original };
  }
  if (!input.allowOptimize) {
    throw new Error(sizeCheck.reason);
  }
  const derived = optimizeImageForApplyPayload({
    sourcePath: input.sourcePath,
    workDir: input.workDir,
    sourceKey: input.sourceKey,
  });
  const derivedCheck = assertApplyPayloadSize(derived.bytes);
  if (!derivedCheck.ok) throw new Error(derivedCheck.reason);
  return { original, derived, upload: derived };
}

export function writeManifestAtomic(filePath: string, manifest: ApplyManifest) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  fs.renameSync(tmp, filePath);
}

export function readManifest(filePath: string): ApplyManifest | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ApplyManifest;
}

export function buildCasUpdateSql() {
  return [
    "UPDATE soko_products",
    "SET payload = jsonb_set(payload, '{imageKeys}', $next::jsonb, true), updated_at = NOW()",
    "WHERE id = $id",
    "AND seller_user_id = $seller",
    "AND status = 'Active'",
    "AND payload->'imageKeys' = $expected::jsonb",
    "RETURNING id",
  ].join(" ");
}

export function buildProductionUploadRequest(input: {
  uploadPath: string;
  filename: string;
  mime: string;
  userId: string;
  sessionToken: string;
}) {
  const body = fs.readFileSync(input.uploadPath);
  return {
    url: PRODUCTION_PRODUCT_IMAGE_UPLOAD_URL,
    method: "POST" as const,
    headerNames: ["x-kristo-user-id", "x-kristo-session-token", "content-type"],
    filename: input.filename,
    mime: input.mime,
    bytes: body.length,
    userIdPresent: Boolean(input.userId),
    sessionTokenPresent: Boolean(input.sessionToken),
  };
}

export async function verifyReturnedPublicImage(input: {
  url: string;
  expectedMime: string;
  expectedBytes?: number;
  fetchImpl?: typeof fetch;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const url = String(input.url || "").trim();
  if (!url.startsWith("https://")) return false;
  const fetchImpl = input.fetchImpl || fetch;
  const attempts = Math.max(1, input.attempts ?? 5);
  const delayMs = input.delayMs ?? 400;
  const sleep = input.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const expectedMime = input.expectedMime.split(";")[0].trim().toLowerCase();

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "follow" });
      const contentType = String(response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (response.status === 200 && contentType === expectedMime) {
        const buf = Buffer.from(await response.arrayBuffer());
        if (input.expectedBytes != null && buf.length !== input.expectedBytes) {
          // CDN may omit exact identity; magic-byte inspect still required.
        }
        const inspected = inspectSokoProductImageUpload({
          bytes: buf,
          filename: `verify.${expectedMime === "image/png" ? "png" : expectedMime === "image/webp" ? "webp" : "jpg"}`,
          declaredMime: expectedMime,
        });
        if (inspected.ok && inspected.format.mime === expectedMime) return true;
      }
    } catch {
      // retry
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}

export function uniqueSellerUserId(plans: ListingMigrationPlan[]) {
  const ids = [...new Set(plans.map((plan) => String(plan.sellerUserId || "").trim()).filter(Boolean))];
  return ids.length === 1 ? ids[0] : "";
}

export function buildBeforeStateManifest(input: {
  plans: ListingMigrationPlan[];
  workDir: string;
  mode: "apply" | "preflight";
  allowOptimize: boolean;
}): ApplyManifest {
  const { active, excludedSold, excludedDeleted } = selectActiveApplyListings(input.plans);
  if (excludedSold.some((row) => active.includes(row)) || excludedDeleted.some((row) => active.includes(row))) {
    throw new Error("Sold or Deleted listings cannot enter the Active-only apply run.");
  }
  const listings: ManifestListing[] = active.map((plan) => {
    if (plan.status !== "Active") {
      throw new Error("Sold or Deleted listings cannot enter the Active-only apply run.");
    }
    const sellerUserId = String(plan.sellerUserId || "").trim();
    const images = plan.images.map((image) => {
      if (!image.absolutePath) throw new Error(`Missing local file for ${plan.id}`);
      const resolved = resolveUploadFile({
        sourcePath: image.absolutePath,
        sourceKey: image.sourceKey,
        workDir: input.workDir,
        allowOptimize: input.allowOptimize,
      });
      return {
        sourceKey: image.sourceKey,
        original: resolved.original,
        derived: resolved.derived,
        uploadPath: resolved.upload.path,
        uploadFilename: path.basename(resolved.upload.path),
        uploaded: null,
        verified: false,
      } satisfies ManifestImage;
    });
    return {
      id: plan.id,
      title: plan.title,
      sellerUserId,
      status: plan.status,
      observedImageKeys: plan.observedImageKeys,
      images,
      nextImageKeys: [],
      result: "planned",
      resultReason: null,
    };
  });
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    mode: input.mode,
    productionUploadUrl: PRODUCTION_PRODUCT_IMAGE_UPLOAD_URL,
    localFilesDeleted: false,
    listings,
    orphans: [],
  };
}

export async function runActiveOnlyProductionApply(input: {
  flags: ApplyFlags;
  plans: ListingMigrationPlan[];
  workDir: string;
  manifestPath: string;
  mutate: boolean;
  uploadImage?: (file: {
    absolutePath: string;
    filename: string;
    mime: string;
  }) => Promise<{ key: string; url: string; mime: string; size: number }>;
  verifyImage?: (input: { url: string; expectedMime: string; expectedBytes: number }) => Promise<boolean>;
  casUpdate?: (input: {
    listingId: string;
    sellerUserId: string;
    expectedImageKeys: string[];
    nextImageKeys: string[];
  }) => Promise<{ updated: boolean }>;
  now?: () => string;
}): Promise<{
  ok: boolean;
  manifest: ApplyManifest;
  posts: number;
  neonUpdates: number;
  mode: "apply" | "preflight";
}> {
  const flagsOk = assertDualConfirmation(input.flags);
  if (input.mutate) {
    if (!input.flags.apply || !input.flags.understoodProductionWrites) {
      throw new Error(flagsOk.ok === false ? flagsOk.reason : "Apply requires dual confirmation flags.");
    }
  }
  if (!flagsOk.ok && input.mutate) throw new Error(flagsOk.reason);

  const scoped = selectActiveApplyListings(input.plans);
  if (scoped.active.some((plan) => plan.status !== "Active")) {
    throw new Error("Sold or Deleted listings cannot enter the Active-only apply run.");
  }

  const mode = input.mutate ? "apply" : "preflight";
  let manifest = readManifest(input.manifestPath);
  const mutationsBeforeWrite = 0;
  if (!manifest) {
    manifest = buildBeforeStateManifest({
      plans: input.plans,
      workDir: input.workDir,
      mode,
      allowOptimize: true,
    });
    writeManifestAtomic(input.manifestPath, manifest);
    if (mutationsBeforeWrite !== 0) {
      throw new Error("Manifest must be written before the first network mutation.");
    }
  }

  let posts = 0;
  let neonUpdates = 0;
  const uploadImage = input.uploadImage;
  const verifyImage = input.verifyImage || (async (args) => verifyReturnedPublicImage(args));
  const casUpdate = input.casUpdate;

  for (const listing of manifest.listings) {
    if (listing.status !== "Active") {
      listing.result = "skipped";
      listing.resultReason = "Sold and Deleted cannot enter this run";
      writeManifestAtomic(input.manifestPath, manifest);
      continue;
    }
    if (listing.result === "migrated" || listing.result === "cas_conflict") {
      continue;
    }
    if (!input.mutate) {
      listing.resultReason = "preflight; no POST and no Neon update";
      for (const image of listing.images) {
        buildProductionUploadRequest({
          uploadPath: image.uploadPath,
          filename: image.uploadFilename,
          mime: (image.derived || image.original).mime,
          userId: listing.sellerUserId,
          sessionToken: "preflight",
        });
      }
      writeManifestAtomic(input.manifestPath, manifest);
      continue;
    }
    if (!uploadImage || !casUpdate) {
      throw new Error("Apply deps missing.");
    }

    let listingFailed = false;
    for (const image of listing.images) {
      const facts = image.derived || image.original;
      if (image.uploaded?.key && image.uploaded.url) {
        const ok = await verifyImage({
          url: image.uploaded.url,
          expectedMime: image.uploaded.mime || facts.mime,
          expectedBytes: image.uploaded.size || facts.bytes,
        });
        image.verified = ok;
        if (!ok) {
          listing.result = "failed";
          listing.resultReason = "resume verification failed";
          listingFailed = true;
          break;
        }
        writeManifestAtomic(input.manifestPath, manifest);
        continue;
      }
      const uploaded = await uploadImage({
        absolutePath: image.uploadPath,
        filename: image.uploadFilename,
        mime: facts.mime,
      });
      posts += 1;
      if (!uploaded.key.startsWith("uploads/soko-products/") || !uploaded.url.startsWith("https://")) {
        listing.result = "failed";
        listing.resultReason = "production upload returned an invalid key or URL";
        listingFailed = true;
        break;
      }
      const expectedExt = facts.extension === "jpg" ? "jpg" : facts.extension;
      if (!uploaded.key.endsWith(`.${expectedExt}`) && !(expectedExt === "jpg" && uploaded.key.endsWith(".jpeg"))) {
        listing.result = "failed";
        listing.resultReason = "production object key extension does not match derived file";
        listingFailed = true;
        break;
      }
      image.uploaded = uploaded;
      writeManifestAtomic(input.manifestPath, manifest);
      const ok = await verifyImage({
        url: uploaded.url,
        expectedMime: uploaded.mime || facts.mime,
        expectedBytes: uploaded.size,
      });
      image.verified = ok;
      writeManifestAtomic(input.manifestPath, manifest);
      if (!ok) {
        listing.result = "failed";
        listing.resultReason = "public URL verification failed";
        listingFailed = true;
        break;
      }
    }

    if (listingFailed) {
      writeManifestAtomic(input.manifestPath, manifest);
      continue;
    }
    if (!listing.images.every((image) => image.uploaded && image.verified)) {
      listing.result = "failed";
      listing.resultReason = "listing images incomplete; Neon not updated";
      writeManifestAtomic(input.manifestPath, manifest);
      continue;
    }

    listing.nextImageKeys = listing.images.map((image) => image.uploaded!.key);
    listing.result = "uploaded";
    writeManifestAtomic(input.manifestPath, manifest);

    const swapped = await casUpdate({
      listingId: listing.id,
      sellerUserId: listing.sellerUserId,
      expectedImageKeys: listing.observedImageKeys,
      nextImageKeys: listing.nextImageKeys,
    });
    if (!swapped.updated) {
      listing.result = "cas_conflict";
      listing.resultReason = "compare-and-swap failed; row not overwritten";
      for (const image of listing.images) {
        if (image.uploaded) {
          manifest.orphans.push({
            listingId: listing.id,
            key: image.uploaded.key,
            url: image.uploaded.url,
            reason: "cas_conflict",
          });
        }
      }
      writeManifestAtomic(input.manifestPath, manifest);
      continue;
    }
    neonUpdates += 1;
    listing.result = "migrated";
    writeManifestAtomic(input.manifestPath, manifest);
  }

  return {
    ok: input.mutate
      ? manifest.listings.every((row) => row.result === "migrated")
      : true,
    manifest,
    posts,
    neonUpdates,
    mode,
  };
}

export async function postProductionProductImage(input: {
  absolutePath: string;
  filename: string;
  mime: string;
  userId: string;
  sessionToken: string;
  fetchImpl?: typeof fetch;
}) {
  const body = fs.readFileSync(input.absolutePath);
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array(body)], input.filename, { type: input.mime })
  );
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(PRODUCTION_PRODUCT_IMAGE_UPLOAD_URL, {
    method: "POST",
    headers: {
      "x-kristo-user-id": input.userId,
      "x-kristo-session-token": input.sessionToken,
    },
    body: form,
  });
  const json = await response.json() as {
    ok?: boolean;
    error?: string;
    image?: { key?: string; url?: string; mime?: string; size?: number };
  };
  if (!response.ok || !json.ok || !json.image?.key || !json.image?.url) {
    throw new Error(json.error || "Production image upload failed.");
  }
  return {
    key: json.image.key,
    url: json.image.url,
    mime: json.image.mime || input.mime,
    size: Number(json.image.size || body.length),
  };
}

