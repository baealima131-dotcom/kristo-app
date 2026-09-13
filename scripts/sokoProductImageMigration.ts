import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  SOKO_PRODUCT_IMAGE_MAX_BYTES,
  declaredSokoProductImageExtension,
  inspectSokoProductImageUpload,
} from "../app/api/_lib/sokoSellerProductImagePolicy.ts";

export const SOKO_IMAGE_KEY_PATTERN =
  /^(local|uploads)\/soko-products\/([a-f0-9]{64})\/([a-f0-9-]{36}\.(jpg|png|webp))$/;

export const PUBLIC_IMAGE_VERIFY_ATTEMPTS = 5;
export const PUBLIC_IMAGE_VERIFY_DELAY_MS = 400;

export type DiskImage = {
  key: string;
  owner: string;
  filename: string;
  absolutePath: string;
  bytes: number;
  sha256: string;
};

export type ListingImagePlan = {
  sourceKey: string;
  durableKey: string;
  absolutePath: string | null;
  bytes: number | null;
  sha256: string | null;
  alreadyDurable: boolean;
};

export type ListingEligibility =
  | "eligible_active"
  | "excluded_sold"
  | "included_sold"
  | "permanently_excluded_deleted"
  | "ineligible_status";

export type ListingMigrationPlan = {
  id: string;
  status: string;
  title: string;
  seller: string;
  eligibility: ListingEligibility;
  observedImageKeys: string[];
  action: "migrate" | "already_durable" | "skip";
  skipReason: string | null;
  images: ListingImagePlan[];
  nextImageKeys: string[];
};

export type StoredObjectInspection = "missing" | "match" | "mismatch";

export type ListingMigrationResult =
  | "planned"
  | "migrated"
  | "already_durable"
  | "skipped"
  | "cas_conflict"
  | "failed";

export function durableKeyForLocalKey(key: string) {
  const parsed = SOKO_IMAGE_KEY_PATTERN.exec(String(key || "").trim());
  if (!parsed) return null;
  return `uploads/soko-products/${parsed[2]}/${parsed[3]}`;
}

export function normalizeImageKeys(imageKeys: unknown): string[] {
  if (!Array.isArray(imageKeys)) return [];
  return imageKeys.map((value) => String(value || "").trim()).filter(Boolean);
}

export function classifyListingEligibility(
  status: string,
  includeSold = false
): ListingEligibility {
  const normalized = String(status || "").trim();
  if (normalized === "Deleted") return "permanently_excluded_deleted";
  if (normalized === "Sold") return includeSold ? "included_sold" : "excluded_sold";
  if (normalized === "Active") return "eligible_active";
  return "ineligible_status";
}

export function isApplyEligible(eligibility: ListingEligibility) {
  return eligibility === "eligible_active" || eligibility === "included_sold";
}

export function listSokoProductImageDiskFiles(diskRoot: string): DiskImage[] {
  if (!fs.existsSync(diskRoot)) return [];
  const files: DiskImage[] = [];
  for (const owner of fs.readdirSync(diskRoot)) {
    const dir = path.join(diskRoot, owner);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      const absolutePath = path.join(dir, name);
      if (!fs.statSync(absolutePath).isFile()) continue;
      const bytes = fs.readFileSync(absolutePath);
      files.push({
        key: `local/soko-products/${owner}/${name}`,
        owner,
        filename: name,
        absolutePath,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return files;
}

export function inspectLocalSokoImageFile(absolutePath: string) {
  const bytes = fs.readFileSync(absolutePath);
  return inspectSokoProductImageUpload({
    bytes,
    filename: path.basename(absolutePath),
  });
}

export function storedObjectMatchesLocal(input: {
  localBytes: number;
  localMime: string;
  contentLength?: number | null;
  contentType?: string | null;
}) {
  const remoteBytes = Number(input.contentLength);
  const remoteType = String(input.contentType || "").split(";")[0].trim().toLowerCase();
  return (
    Number.isFinite(remoteBytes) &&
    remoteBytes === input.localBytes &&
    remoteType === input.localMime
  );
}

function statusSkipReason(eligibility: ListingEligibility): string | null {
  if (eligibility === "permanently_excluded_deleted") {
    return "permanently excluded Deleted";
  }
  if (eligibility === "excluded_sold") {
    return "excluded Sold; pass --include-sold";
  }
  if (eligibility === "ineligible_status") {
    return "unsupported listing status";
  }
  return null;
}

export function planSokoProductImageListings(input: {
  listings: Array<{
    id: string;
    status: string;
    title: string;
    seller: string;
    imageKeys: unknown;
  }>;
  diskFiles: DiskImage[];
  includeSold?: boolean;
}): ListingMigrationPlan[] {
  const includeSold = Boolean(input.includeSold);
  const diskByKey = new Map(input.diskFiles.map((file) => [file.key, file]));
  const classified = input.listings.map((listing) => ({
    listing,
    eligibility: classifyListingEligibility(listing.status, includeSold),
    keys: normalizeImageKeys(listing.imageKeys),
  }));

  const keyOwners = new Map<string, string[]>();
  for (const row of classified) {
    if (!isApplyEligible(row.eligibility)) continue;
    for (const key of row.keys) {
      const owners = keyOwners.get(key) || [];
      owners.push(row.listing.id);
      keyOwners.set(key, owners);
    }
  }

  return classified.map(({ listing, eligibility, keys }) => {
    const images: ListingImagePlan[] = [];
    const skipReasons: string[] = [];
    const seenInListing = new Set<string>();
    const statusReason = statusSkipReason(eligibility);
    if (statusReason) skipReasons.push(statusReason);

    if (isApplyEligible(eligibility) && keys.length < 1) {
      skipReasons.push("no image keys");
    }

    for (const key of keys) {
      if (isApplyEligible(eligibility)) {
        if (seenInListing.has(key)) skipReasons.push("duplicate key inside listing");
        seenInListing.add(key);
        const owners = keyOwners.get(key) || [];
        if (owners.length > 1) skipReasons.push("key used by multiple listings");
      }

      const parsed = SOKO_IMAGE_KEY_PATTERN.exec(key);
      if (!parsed) {
        if (isApplyEligible(eligibility)) skipReasons.push("invalid image key");
        images.push({
          sourceKey: key,
          durableKey: "",
          absolutePath: null,
          bytes: null,
          sha256: null,
          alreadyDurable: false,
        });
        continue;
      }

      if (parsed[1] === "uploads") {
        images.push({
          sourceKey: key,
          durableKey: key,
          absolutePath: null,
          bytes: null,
          sha256: null,
          alreadyDurable: true,
        });
        continue;
      }

      const file = diskByKey.get(key);
      if (!file) {
        if (isApplyEligible(eligibility)) skipReasons.push("missing local file");
        images.push({
          sourceKey: key,
          durableKey: durableKeyForLocalKey(key) || "",
          absolutePath: null,
          bytes: null,
          sha256: null,
          alreadyDurable: false,
        });
        continue;
      }

      if (isApplyEligible(eligibility)) {
        const inspected = inspectLocalSokoImageFile(file.absolutePath);
        if (!inspected.ok) skipReasons.push(inspected.error);
        if (file.bytes < 1 || file.bytes > SOKO_PRODUCT_IMAGE_MAX_BYTES) {
          skipReasons.push("file size out of range");
        }
        const ext = declaredSokoProductImageExtension(file.filename);
        if (inspected.ok && ext && ext !== inspected.format.extension) {
          skipReasons.push("extension does not match contents");
        }
      }

      images.push({
        sourceKey: key,
        durableKey: durableKeyForLocalKey(key) || "",
        absolutePath: file.absolutePath,
        bytes: file.bytes,
        sha256: file.sha256,
        alreadyDurable: false,
      });
    }

    if (isApplyEligible(eligibility)) {
      const mixed = images.some((image) => image.alreadyDurable) &&
        images.some((image) => !image.alreadyDurable);
      if (mixed) skipReasons.push("mixed local and uploads keys");
    }

    const uniqueReasons = [...new Set(skipReasons)];
    const allDurable = images.length > 0 && images.every((image) => image.alreadyDurable);
    const action = uniqueReasons.length
      ? "skip"
      : allDurable
        ? "already_durable"
        : "migrate";

    return {
      id: listing.id,
      status: listing.status,
      title: listing.title,
      seller: listing.seller,
      eligibility,
      observedImageKeys: keys,
      action,
      skipReason: uniqueReasons.length ? uniqueReasons.join("; ") : null,
      images,
      nextImageKeys: action === "skip" ? keys : images.map((image) => image.durableKey),
    };
  });
}

export function summarizeMigrationPlans(plans: ListingMigrationPlan[]) {
  const eligibleActive = plans.filter((row) => row.eligibility === "eligible_active");
  const excludedSold = plans.filter((row) => row.eligibility === "excluded_sold");
  const includedSold = plans.filter((row) => row.eligibility === "included_sold");
  const permanentlyExcludedDeleted = plans.filter(
    (row) => row.eligibility === "permanently_excluded_deleted"
  );
  const eligibleActiveFiles = new Set(
    eligibleActive.flatMap((row) =>
      row.images
        .map((image) => image.sourceKey)
        .filter((key) => key.startsWith("local/soko-products/"))
    )
  );
  return {
    listingCount: plans.length,
    eligibleActiveCount: eligibleActive.length,
    excludedSoldCount: excludedSold.length,
    includedSoldCount: includedSold.length,
    permanentlyExcludedDeletedCount: permanentlyExcludedDeleted.length,
    eligibleActiveImageFileCount: eligibleActiveFiles.size,
    migrateCount: plans.filter((row) => row.action === "migrate").length,
    skipCount: plans.filter((row) => row.action === "skip").length,
    alreadyDurableCount: plans.filter((row) => row.action === "already_durable").length,
  };
}

export function buildMigrationManifest(input: {
  dryRun: boolean;
  includeSold: boolean;
  plans: ListingMigrationPlan[];
  results?: Array<{
    listingId: string;
    result: ListingMigrationResult;
    reason?: string;
  }>;
}) {
  const resultsById = new Map((input.results || []).map((row) => [row.listingId, row]));
  const summary = summarizeMigrationPlans(input.plans);
  return {
    generatedAt: new Date().toISOString(),
    dryRun: input.dryRun,
    includeSold: input.includeSold,
    localFilesDeleted: false,
    ...summary,
    listings: input.plans.map((plan) => {
      const resultRow = resultsById.get(plan.id);
      return {
        id: plan.id,
        status: plan.status,
        eligibility: plan.eligibility,
        title: plan.title,
        observedImageKeys: plan.observedImageKeys,
        nextImageKeys: plan.nextImageKeys,
        action: plan.action,
        skipReason: plan.skipReason,
        result: resultRow?.result || "planned",
        resultReason: resultRow?.reason || plan.skipReason,
        images: plan.images.map((image) => ({
          sourceKey: image.sourceKey,
          durableKey: image.durableKey,
          sha256: image.sha256,
          bytes: image.bytes,
        })),
      };
    }),
  };
}

export async function verifyPublicHttpsImage(input: {
  url: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const url = String(input.url || "").trim();
  if (!url.startsWith("https://")) return false;
  const fetchImpl = input.fetchImpl || fetch;
  const attempts = Math.max(1, input.attempts ?? PUBLIC_IMAGE_VERIFY_ATTEMPTS);
  const delayMs = input.delayMs ?? PUBLIC_IMAGE_VERIFY_DELAY_MS;
  const sleep = input.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "follow" });
      const contentType = String(response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (response.status === 200 && contentType.startsWith("image/")) {
        return true;
      }
    } catch {
      // Retry for object-storage/CDN propagation.
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return false;
}

export async function migratePlannedListing(
  plan: ListingMigrationPlan,
  deps: {
    uploadFile: (input: {
      absolutePath: string;
      durableKey: string;
      mime: string;
    }) => Promise<{ key: string }>;
    publicImageOk: (durableKey: string) => Promise<boolean>;
    updateImageKeys: (input: {
      listingId: string;
      expectedImageKeys: string[];
      nextImageKeys: string[];
    }) => Promise<{ updated: boolean }>;
    inspectStored?: (input: {
      durableKey: string;
      localBytes: number;
      localMime: string;
    }) => Promise<StoredObjectInspection>;
    allowSold?: boolean;
  }
): Promise<{ ok: true; result: ListingMigrationResult } | { ok: false; reason: string; result: ListingMigrationResult }> {
  if (plan.eligibility === "permanently_excluded_deleted") {
    return { ok: false, reason: "permanently excluded Deleted", result: "skipped" };
  }
  if (plan.eligibility === "excluded_sold" || (plan.status === "Sold" && !deps.allowSold)) {
    return { ok: false, reason: "excluded Sold; pass --include-sold", result: "skipped" };
  }
  if (plan.action === "skip") {
    return { ok: false, reason: plan.skipReason || "skipped", result: "skipped" };
  }
  if (plan.action === "already_durable") {
    return { ok: true, result: "already_durable" };
  }

  for (const image of plan.images) {
    if (!image.durableKey.startsWith("uploads/soko-products/")) {
      return { ok: false, reason: "invalid durable key", result: "failed" };
    }
    if (image.alreadyDurable) continue;
    if (!image.absolutePath) return { ok: false, reason: "missing local file", result: "failed" };
    const inspected = inspectLocalSokoImageFile(image.absolutePath);
    if (!inspected.ok) return { ok: false, reason: inspected.error, result: "failed" };
    const stored = deps.inspectStored
      ? await deps.inspectStored({
          durableKey: image.durableKey,
          localBytes: image.bytes ?? 0,
          localMime: inspected.format.mime,
        })
      : "missing";
    if (stored === "mismatch") {
      return {
        ok: false,
        reason: `existing object mismatch; refusing overwrite (${image.durableKey})`,
        result: "failed",
      };
    }
    if (stored === "match") continue;
    const uploaded = await deps.uploadFile({
      absolutePath: image.absolutePath,
      durableKey: image.durableKey,
      mime: inspected.format.mime,
    });
    if (uploaded.key !== image.durableKey) {
      return { ok: false, reason: "upload key mismatch", result: "failed" };
    }
  }

  const verified: boolean[] = [];
  for (const image of plan.images) {
    verified.push(await deps.publicImageOk(image.durableKey));
  }
  if (verified.some((ok) => !ok) || verified.length !== plan.images.length) {
    return { ok: false, reason: "public URL verification failed", result: "failed" };
  }

  const swapped = await deps.updateImageKeys({
    listingId: plan.id,
    expectedImageKeys: plan.observedImageKeys,
    nextImageKeys: plan.nextImageKeys,
  });
  if (!swapped.updated) {
    return {
      ok: false,
      reason: "image keys changed since dry-run; skipped compare-and-swap",
      result: "cas_conflict",
    };
  }
  return { ok: true, result: "migrated" };
}
