export const SOKO_PRODUCT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const SOKO_PRODUCT_IMAGE_MAX_REQUEST_BYTES =
  SOKO_PRODUCT_IMAGE_MAX_BYTES + 256 * 1024;
export const SOKO_PRODUCT_IMAGE_MAX_FILES_PER_REQUEST = 1;

export type SokoProductImageFormat = {
  extension: "jpg" | "png" | "webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
};

export type SokoProductImageWriteTarget = "uploads" | "local" | "unavailable";

const JPEG_MIME = "image/jpeg";
const PNG_MIME = "image/png";
const WEBP_MIME = "image/webp";

export function declaredSokoProductImageExtension(
  filename: string
): SokoProductImageFormat["extension"] | null {
  const name = String(filename || "").trim().toLowerCase();
  if (name.endsWith(".jpeg") || name.endsWith(".jpg")) return "jpg";
  if (name.endsWith(".png")) return "png";
  if (name.endsWith(".webp")) return "webp";
  return null;
}

export function detectSokoProductImageFormat(
  bytes: Buffer | Uint8Array
): SokoProductImageFormat | null {
  const view = bytes instanceof Buffer ? bytes : Buffer.from(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) {
    return { extension: "jpg", mime: JPEG_MIME };
  }
  if (
    view.length >= 8 &&
    view.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { extension: "png", mime: PNG_MIME };
  }
  if (
    view.length >= 12 &&
    view.toString("ascii", 0, 4) === "RIFF" &&
    view.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { extension: "webp", mime: WEBP_MIME };
  }
  return null;
}

export function inspectSokoProductImageUpload(input: {
  bytes: Buffer | Uint8Array;
  filename?: string;
  declaredMime?: string;
}):
  | { ok: true; format: SokoProductImageFormat }
  | { ok: false; status: number; error: string } {
  const view = input.bytes instanceof Buffer ? input.bytes : Buffer.from(input.bytes);
  if (view.length < 1 || view.length > SOKO_PRODUCT_IMAGE_MAX_BYTES) {
    return { ok: false, status: 413, error: "Image must be between 1 byte and 8 MB." };
  }
  const format = detectSokoProductImageFormat(view);
  if (!format) {
    return {
      ok: false,
      status: 415,
      error: "Use a JPEG, PNG or WebP image. Convert HEIC images before uploading.",
    };
  }
  const filename = String(input.filename || "").trim();
  if (filename) {
    const declaredExt = declaredSokoProductImageExtension(filename);
    if (!declaredExt) {
      return {
        ok: false,
        status: 415,
        error: "Use a JPEG, PNG or WebP image. Convert HEIC images before uploading.",
      };
    }
    if (declaredExt !== format.extension) {
      return { ok: false, status: 415, error: "Image file extension does not match the file contents." };
    }
  }
  const declaredMime = String(input.declaredMime || "").trim().toLowerCase();
  if (
    declaredMime &&
    declaredMime !== "application/octet-stream" &&
    declaredMime !== format.mime
  ) {
    return { ok: false, status: 415, error: "Image MIME type does not match the file contents." };
  }
  return { ok: true, format };
}

export function evaluateSokoSellerImageUploadAccess(input: {
  authenticated: boolean;
  kristoId: string;
  sellerApproved: boolean;
  sellerStatus: string;
}): { ok: true } | { ok: false; status: number; error: string } {
  if (!input.authenticated) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!String(input.kristoId || "").trim()) {
    return { ok: false, status: 409, error: "Complete your Kristo profile first." };
  }
  if (!input.sellerApproved) {
    return {
      ok: false,
      status: 403,
      error: "Active SOKO seller access is required.",
    };
  }
  if (String(input.sellerStatus || "active") !== "active") {
    return {
      ok: false,
      status: 403,
      error: "Your SOKO seller access is restricted.",
    };
  }
  return { ok: true };
}

export function selectSokoProductImageWriteTarget(input: {
  hasObjectStorage: boolean;
  vercel: boolean;
  localDev: boolean;
}): SokoProductImageWriteTarget {
  if (input.hasObjectStorage) return "uploads";
  if (input.vercel) return "unavailable";
  if (input.localDev) return "local";
  return "unavailable";
}

export function buildSokoProductImageObjectKey(input: {
  prefix: "uploads" | "local";
  ownerHex: string;
  fileId: string;
  extension: SokoProductImageFormat["extension"];
}) {
  const owner = String(input.ownerHex || "").trim().toLowerCase();
  const fileId = String(input.fileId || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error("Invalid image owner.");
  if (!/^[a-f0-9-]{36}$/.test(fileId)) throw new Error("Invalid image file id.");
  return `${input.prefix}/soko-products/${owner}/${fileId}.${input.extension}`;
}

export function assertDurableSokoUploadResult(input: {
  key: string;
  publicUrl: string;
}) {
  const key = String(input.key || "").trim();
  const publicUrl = String(input.publicUrl || "").trim();
  if (!key.startsWith("uploads/soko-products/")) {
    throw new Error("Upload did not persist a durable object key.");
  }
  if (!/^https:\/\//i.test(publicUrl)) {
    throw new Error("Upload did not return a public HTTPS URL.");
  }
  return { key, publicUrl };
}

export function assertStoredSokoProductImageHead(input: {
  key: string;
  expectedBytes: number;
  expectedMime: string;
  contentLength: number;
  contentType: string | null;
}) {
  const key = String(input.key || "").trim();
  if (!key.startsWith("uploads/soko-products/")) {
    throw new Error("Upload did not persist a durable object key.");
  }
  if (Number(input.contentLength) !== Number(input.expectedBytes)) {
    throw new Error("Stored image size did not match the upload.");
  }
  const contentType = String(input.contentType || "").split(";")[0].trim().toLowerCase();
  if (contentType !== String(input.expectedMime || "").trim().toLowerCase()) {
    throw new Error("Stored image type did not match the upload.");
  }
}
