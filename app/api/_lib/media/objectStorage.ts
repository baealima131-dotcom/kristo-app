import fs from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_VIDEO_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
export const VIDEO_UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;
export const VIDEO_MULTIPART_CHUNK_BYTES = 5 * 1024 * 1024;
export const VIDEO_MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;
export const VIDEO_OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const VIDEO_OBJECT_CONTENT_TYPE = "video/mp4";
export const POSTER_OBJECT_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** Files under this size upload as a single multipart part on the client. */
export const VIDEO_SINGLE_PART_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;

export type VideoStorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  publicBaseUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function readEnv(name: string) {
  return String(process.env[name] || "").trim();
}

export function getVideoStorageConfig(): VideoStorageConfig | null {
  const bucket = readEnv("KRISTO_VIDEO_STORAGE_BUCKET");
  const accessKeyId =
    readEnv("KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID") || readEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey =
    readEnv("KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY") || readEnv("AWS_SECRET_ACCESS_KEY");
  const publicBaseUrl =
    readEnv("KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL") ||
    readEnv("KRISTO_VIDEO_STORAGE_PUBLIC_URL");
  const endpoint = readEnv("KRISTO_VIDEO_STORAGE_ENDPOINT") || undefined;
  const region = readEnv("KRISTO_VIDEO_STORAGE_REGION") || (endpoint ? "auto" : "us-east-1");

  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    return null;
  }

  return {
    bucket,
    region,
    endpoint,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
    accessKeyId,
    secretAccessKey,
  };
}

export function videoStorageConfigError(): string {
  const missing: string[] = [];
  if (!readEnv("KRISTO_VIDEO_STORAGE_BUCKET")) missing.push("KRISTO_VIDEO_STORAGE_BUCKET");
  if (
    !readEnv("KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID") &&
    !readEnv("AWS_ACCESS_KEY_ID")
  ) {
    missing.push("KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID)");
  }
  if (
    !readEnv("KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY") &&
    !readEnv("AWS_SECRET_ACCESS_KEY")
  ) {
    missing.push("KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY)");
  }
  if (
    !readEnv("KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL") &&
    !readEnv("KRISTO_VIDEO_STORAGE_PUBLIC_URL")
  ) {
    missing.push("KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL");
  }

  if (!missing.length) {
    return "Video storage is not configured.";
  }

  return `Video storage is not configured. Missing: ${missing.join(", ")}. Set Cloudflare R2 or S3 credentials on the server.`;
}

function createStorageClient(config: VideoStorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: Boolean(config.endpoint),
  });
}

function safeFileStem(name: string) {
  return String(name || "video")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extFromFileName(fileName: string, contentType: string) {
  const byName = String(fileName || "").match(/(\.[a-z0-9]+)$/i)?.[1];
  if (byName) return byName.toLowerCase();

  const mime = String(contentType || "").toLowerCase();
  if (mime.includes("quicktime") || mime.includes("mov")) return ".mov";
  if (mime.includes("webm")) return ".webm";
  return ".mp4";
}

function extFromImageFileName(fileName: string, contentType: string) {
  const byName = String(fileName || "").match(/(\.[a-z0-9]+)$/i)?.[1];
  if (byName) return byName.toLowerCase();

  const mime = String(contentType || "").toLowerCase();
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  return ".jpg";
}

export const MAX_POSTER_UPLOAD_BYTES = 12 * 1024 * 1024;

export function buildPublicVideoUrl(config: VideoStorageConfig, key: string) {
  const encodedKey = key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${config.publicBaseUrl}/${encodedKey}`;
}

const PUBLIC_VIDEO_KEY_PREFIXES = [
  "church-videos/",
  "church-video-posters/",
  "church-video-previews/",
] as const;

function decodePublicVideoKeyPath(rawKey: string): string {
  try {
    return rawKey
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return rawKey;
  }
}

function isPublicVideoStorageKey(key: string) {
  return PUBLIC_VIDEO_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Extract object key from current public base or legacy `*.r2.dev` playback URLs. */
export function extractPublicVideoStorageKey(publicUrl: string): string | null {
  const normalized = String(publicUrl || "").trim().split("?")[0];
  if (!normalized) return null;

  const config = getVideoStorageConfig();
  if (config) {
    const base = config.publicBaseUrl.replace(/\/+$/, "");
    if (normalized.startsWith(base)) {
      const rawKey = normalized.slice(base.length).replace(/^\/+/, "");
      return rawKey ? decodePublicVideoKeyPath(rawKey) : null;
    }
  }

  try {
    const parsed = new URL(normalized);
    if (!parsed.hostname.endsWith(".r2.dev")) return null;
    const rawKey = parsed.pathname.replace(/^\/+/, "");
    if (!rawKey || !isPublicVideoStorageKey(rawKey)) return null;
    return decodePublicVideoKeyPath(rawKey);
  } catch {
    return null;
  }
}

/** Rewrite legacy R2 public-dev URLs to the configured custom delivery domain (same object key). */
export function canonicalPublicVideoUrl(publicUrl: string): string {
  const raw = String(publicUrl || "").trim();
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;

  const config = getVideoStorageConfig();
  if (!config) return raw;

  const key = extractPublicVideoStorageKey(raw);
  if (!key) return raw;

  const canonical = buildPublicVideoUrl(config, key);
  const queryIndex = raw.indexOf("?");
  return queryIndex >= 0 ? `${canonical}${raw.slice(queryIndex)}` : canonical;
}

export function storageKeyFromPublicUrl(publicUrl: string): string | null {
  return extractPublicVideoStorageKey(publicUrl);
}

export function posterStorageKeyForVideoKey(videoKey: string): string {
  const segments = String(videoKey || "").trim().split("/").filter(Boolean);
  const churchSegment = segments[1] || "unknown";
  const baseName = segments[segments.length - 1] || "video.mp4";
  const stem = baseName.replace(/\.[^.]+$/, "");
  return `church-video-posters/${churchSegment}/${stem}.jpg`;
}

export function previewStorageKeyForVideoKey(videoKey: string): string {
  const segments = String(videoKey || "").trim().split("/").filter(Boolean);
  const churchSegment = segments[1] || "unknown";
  const baseName = segments[segments.length - 1] || "video.mp4";
  const stem = baseName.replace(/\.[^.]+$/, "");
  return `church-video-previews/${churchSegment}/${stem}.mp4`;
}

export async function storageObjectExists(key: string): Promise<boolean> {
  try {
    const size = await getStorageObjectByteSize(key);
    return size > 0;
  } catch {
    return false;
  }
}

export async function createPresignedVideoUpload(params: {
  churchId: string;
  userId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}) {
  return createPresignedMediaUpload({ ...params, kind: "video" });
}

export async function createPresignedPosterUpload(params: {
  churchId: string;
  userId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}) {
  return createPresignedMediaUpload({ ...params, kind: "poster" });
}

export async function createPresignedMediaUpload(params: {
  churchId: string;
  userId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  kind: "video" | "poster";
}) {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const isPoster = params.kind === "poster";
  const contentType = String(
    params.contentType || (isPoster ? "image/jpeg" : "video/mp4")
  ).trim() || (isPoster ? "image/jpeg" : "video/mp4");
  const ext = isPoster
    ? extFromImageFileName(params.fileName, contentType)
    : extFromFileName(params.fileName, contentType);
  const stem = safeFileStem(
    params.fileName.replace(/\.[^.]+$/, "") || (isPoster ? "poster" : "sermon")
  );
  const key = [
    isPoster ? "church-video-posters" : "church-videos",
    safeFileStem(params.churchId || "unknown"),
    `${Date.now()}_${Math.random().toString(16).slice(2)}_${stem}${ext}`,
  ].join("/");

  const client = createStorageClient(config);
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: params.fileSize,
    ...(isPoster
      ? { CacheControl: POSTER_OBJECT_CACHE_CONTROL }
      : { CacheControl: VIDEO_OBJECT_CACHE_CONTROL }),
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS,
  });

  const publicUrl = buildPublicVideoUrl(config, key);

  return {
    uploadUrl,
    videoUrl: publicUrl,
    publicUrl,
    key,
    contentType,
    expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS,
    maxBytes: isPoster ? MAX_POSTER_UPLOAD_BYTES : MAX_VIDEO_UPLOAD_BYTES,
  };
}

function buildVideoObjectKey(params: {
  churchId: string;
  fileName: string;
  contentType: string;
  kind: "video" | "poster";
}) {
  const isPoster = params.kind === "poster";
  const contentType = String(
    params.contentType || (isPoster ? "image/jpeg" : "video/mp4")
  ).trim() || (isPoster ? "image/jpeg" : "video/mp4");
  const ext = isPoster
    ? extFromImageFileName(params.fileName, contentType)
    : extFromFileName(params.fileName, contentType);
  const stem = safeFileStem(
    params.fileName.replace(/\.[^.]+$/, "") || (isPoster ? "poster" : "sermon")
  );

  return [
    isPoster ? "church-video-posters" : "church-videos",
    safeFileStem(params.churchId || "unknown"),
    `${Date.now()}_${Math.random().toString(16).slice(2)}_${stem}${ext}`,
  ].join("/");
}

export async function createMultipartVideoUpload(params: {
  churchId: string;
  userId: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}) {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const contentType = String(params.contentType || "video/mp4").trim() || "video/mp4";
  const key = buildVideoObjectKey({
    churchId: params.churchId,
    fileName: params.fileName,
    contentType,
    kind: "video",
  });
  const chunkSize =
    params.fileSize > 0 && params.fileSize < VIDEO_SINGLE_PART_UPLOAD_MAX_BYTES
      ? params.fileSize
      : VIDEO_MULTIPART_CHUNK_BYTES;
  const totalParts = Math.max(1, Math.ceil(params.fileSize / chunkSize));

  const client = createStorageClient(config);
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType || VIDEO_OBJECT_CONTENT_TYPE,
      CacheControl: VIDEO_OBJECT_CACHE_CONTROL,
    })
  );

  const uploadId = String(created.UploadId || "").trim();
  if (!uploadId) {
    throw new Error("Could not start multipart upload.");
  }

  const publicUrl = buildPublicVideoUrl(config, key);

  return {
    uploadId,
    key,
    publicUrl,
    videoUrl: publicUrl,
    contentType,
    chunkSize,
    totalParts,
    expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS,
  };
}

export async function createPresignedMultipartPartUpload(params: {
  key: string;
  uploadId: string;
  partNumber: number;
  contentLength: number;
}) {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const partNumber = Math.max(1, Math.floor(Number(params.partNumber || 1)));
  const client = createStorageClient(config);
  const command = new UploadPartCommand({
    Bucket: config.bucket,
    Key: params.key,
    UploadId: params.uploadId,
    PartNumber: partNumber,
    ContentLength: Math.max(1, Math.floor(Number(params.contentLength || 0))),
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS,
  });

  return {
    uploadUrl,
    partNumber,
    expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS,
  };
}

export async function completeMultipartVideoUpload(params: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const client = createStorageClient(config);
  const completed = await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: config.bucket,
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: params.parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
      },
    })
  );

  const publicUrl = buildPublicVideoUrl(config, params.key);

  return {
    key: params.key,
    publicUrl,
    videoUrl: publicUrl,
    location: completed.Location || publicUrl,
  };
}

/**
 * Server-side upload of an in-memory buffer to object storage (R2/S3).
 * Used for small attachments (e.g. room chat images/files) where we already
 * have the bytes on the server and want a durable public URL without writing
 * to the local (read-only on Vercel) filesystem.
 */
export async function uploadBufferToStorage(params: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string; publicUrl: string }> {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const contentType =
    String(params.contentType || "application/octet-stream").trim() ||
    "application/octet-stream";

  const client = createStorageClient(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: contentType,
      ContentLength: params.body.byteLength,
      CacheControl:
        contentType.startsWith("image/")
          ? POSTER_OBJECT_CACHE_CONTROL
          : VIDEO_OBJECT_CACHE_CONTROL,
    })
  );

  return { key: params.key, publicUrl: buildPublicVideoUrl(config, params.key) };
}

export type StorageObjectHead = {
  contentLength: number;
  contentType: string | null;
  cacheControl: string | null;
  acceptRanges: string | null;
};

export async function headStorageObject(key: string): Promise<StorageObjectHead> {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const client = createStorageClient(config);
  const head = await client.send(
    new HeadObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );

  return {
    contentLength: Math.max(0, Number(head.ContentLength || 0)),
    contentType: head.ContentType || null,
    cacheControl: head.CacheControl || null,
    acceptRanges: head.AcceptRanges || null,
  };
}

export async function getStorageObjectByteSize(key: string): Promise<number> {
  const head = await headStorageObject(key);
  return head.contentLength;
}

export async function patchStorageObjectDeliveryMetadata(params: {
  key: string;
  contentType?: string;
  cacheControl?: string;
}): Promise<void> {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const key = String(params.key || "").trim();
  if (!key) return;

  const client = createStorageClient(config);
  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      Key: key,
      CopySource: `${config.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
      MetadataDirective: "REPLACE",
      ContentType: params.contentType || VIDEO_OBJECT_CONTENT_TYPE,
      CacheControl: params.cacheControl || VIDEO_OBJECT_CACHE_CONTROL,
    })
  );
}

export async function downloadStorageObjectToPath(key: string, destPath: string): Promise<void> {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const client = createStorageClient(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );

  const body = response.Body;
  if (!body) {
    throw new Error("Storage object body was empty.");
  }

  await pipeline(body as Readable, createWriteStream(destPath));
}

export async function replaceStorageObjectFromPath(params: {
  key: string;
  srcPath: string;
  contentType?: string;
}) {
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const body = fs.createReadStream(params.srcPath);
  const client = createStorageClient(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: params.key,
      Body: body,
      ContentType: String(params.contentType || VIDEO_OBJECT_CONTENT_TYPE).trim() || VIDEO_OBJECT_CONTENT_TYPE,
      CacheControl: VIDEO_OBJECT_CACHE_CONTROL,
    })
  );
}

function logVideoStorageStartupConfig() {
  const config = getVideoStorageConfig();
  if (config) {
    console.log("KRISTO_VIDEO_STORAGE_CONFIG_OK", {
      bucket: config.bucket,
      region: config.region,
      endpointConfigured: Boolean(config.endpoint),
      publicBaseUrl: config.publicBaseUrl,
      publicBaseUrlUsesR2Dev: /\.r2\.dev(?:\/|$)/i.test(config.publicBaseUrl),
      maxUploadGb: Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024 * 1024)),
      uploadUrlTtlSeconds: VIDEO_UPLOAD_URL_TTL_SECONDS,
    });
    return;
  }

  console.log("KRISTO_VIDEO_STORAGE_CONFIG_MISSING", {
    error: videoStorageConfigError(),
  });
}

logVideoStorageStartupConfig();
