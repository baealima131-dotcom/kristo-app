import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_VIDEO_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;
export const VIDEO_UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;

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
  const config = getVideoStorageConfig();
  if (!config) {
    throw new Error(videoStorageConfigError());
  }

  const contentType = String(params.contentType || "video/mp4").trim() || "video/mp4";
  const ext = extFromFileName(params.fileName, contentType);
  const stem = safeFileStem(params.fileName.replace(/\.[^.]+$/, "") || "sermon");
  const key = [
    "church-videos",
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

  return {
    uploadUrl,
    videoUrl: buildPublicVideoUrl(config, key),
    key,
    contentType,
    expiresIn: VIDEO_UPLOAD_URL_TTL_SECONDS,
    maxBytes: MAX_VIDEO_UPLOAD_BYTES,
  };
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
