import fs from "node:fs";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  CompleteMultipartUploadCommand,
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
  const chunkSize = VIDEO_MULTIPART_CHUNK_BYTES;
  const totalParts = Math.max(1, Math.ceil(params.fileSize / chunkSize));

  const client = createStorageClient(config);
  const created = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
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

export async function getStorageObjectByteSize(key: string): Promise<number> {
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

  return Math.max(0, Number(head.ContentLength || 0));
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
      ContentType: String(params.contentType || "video/mp4").trim() || "video/mp4",
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
