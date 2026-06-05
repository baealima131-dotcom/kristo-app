import { apiPost } from "@/src/lib/kristoApi";
import type { MediaStatus } from "@/src/lib/mediaStatus";

type HeadersRec = Record<string, string>;

export type SignedMediaUploadSession = {
  uploadUrl: string;
  videoUrl: string;
  publicUrl: string;
  contentType: string;
  faststart?: boolean;
  faststartPending?: boolean;
  faststartReason?: string | null;
  posterUri?: string | null;
};

export const SIGNED_UPLOAD_TIMEOUT_MS = 90_000;
export const PUBLISH_TIMEOUT_MS = 90_000;
export const VIDEO_SIGNED_UPLOAD_MAX_RETRIES = 2;
export const POSTER_SIGNED_UPLOAD_MAX_RETRIES = 1;

function isPublishTimeoutError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return message.includes("timeout") || message.includes("timed out") || message.includes("abort");
}

async function withPublishTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Publish timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// TODO(multipart): Switch large uploads to R2/S3 multipart when backend exposes
// initiate/complete multipart endpoints and part presign URLs.

function uploadErrorMessage(body: any, fallback: string) {
  return String(body?.error || body?.message || fallback).trim() || fallback;
}

export function guessVideoContentType(fileName: string) {
  const lower = String(fileName || "").trim().toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}

export function guessPosterContentType(fileName: string) {
  const lower = String(fileName || "").trim().toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export function fileNameFromUri(uri: string, fallback = "video.mp4") {
  const clean = String(uri || "").trim().split("?")[0];
  const base = clean.split("/").pop();
  if (base && base.includes(".")) return base;
  return fallback;
}

export async function resolveUploadFileSize(uri: string): Promise<number> {
  const FileSystem = await import("expo-file-system/legacy");
  const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
  const directSize = Number((info as any)?.size || 0);
  if (directSize > 0) return directSize;
  if (!(info as any)?.exists) return 0;

  try {
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return Math.max(1, Math.floor(String(base64 || "").length * 0.75));
  } catch {
    return 0;
  }
}

async function requestSignedMediaUpload(params: {
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
  kind: "video" | "poster";
}): Promise<SignedMediaUploadSession> {
  const payload = {
    fileName: params.fileName,
    contentType: params.contentType,
    fileSize: params.fileSize,
    kind: params.kind,
    uploadKind: params.kind,
  };

  if (__DEV__) {
    console.log("KRISTO_SIGNED_MEDIA_UPLOAD_REQUEST", payload);
  }

  const res: any = await apiPost(
    "/api/church/media/upload-url",
    payload,
    { headers: params.headers }
  );

  if (!res?.ok) {
    throw new Error(
      uploadErrorMessage(
        res,
        params.kind === "poster"
          ? "Could not start poster upload."
          : "Could not start video upload."
      )
    );
  }

  const data = res?.data || res;
  const uploadUrl = String(data?.uploadUrl || "").trim();
  const publicUrl = String(data?.publicUrl || data?.videoUrl || "").trim();
  const contentType = String(data?.contentType || params.contentType).trim();

  if (!uploadUrl || !publicUrl) {
    throw new Error("Signed upload URL response was incomplete.");
  }

  return { uploadUrl, videoUrl: publicUrl, publicUrl, contentType };
}

export async function requestVideoUploadUrl(params: {
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
}): Promise<SignedMediaUploadSession> {
  return requestSignedMediaUpload({ ...params, kind: "video" });
}

export async function requestPosterUploadUrl(params: {
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
}): Promise<SignedMediaUploadSession> {
  return requestSignedMediaUpload({ ...params, kind: "poster" });
}

function withUploadTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      console.log("KRISTO_SIGNED_UPLOAD_TIMEOUT", {
        label,
        timeoutMs,
      });
      reject(new Error(`Upload timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function uploadFileToSignedUrlOnce(params: {
  fileUri: string;
  uploadUrl: string;
  contentType: string;
  timeoutMs: number;
  label: string;
  onProgress?: (percent: number) => void;
}) {
  const FileSystem = await import("expo-file-system/legacy");

  let uploadTask: any = null;

  const progressCallback = params.onProgress
    ? (event: { totalBytesSent?: number; totalBytesExpectedToSend?: number }) => {
        const sent = Number(event?.totalBytesSent || 0);
        const expected = Number(event?.totalBytesExpectedToSend || 0);
        if (!expected) return;
        const pct = Math.min(99, Math.round((sent / expected) * 100));
        params.onProgress?.(pct);
      }
    : undefined;

  const uploadPromise = (async () => {
    uploadTask = FileSystem.createUploadTask(
      params.uploadUrl,
      params.fileUri,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          "Content-Type": params.contentType,
        },
      },
      progressCallback
    );

    const result = await uploadTask.uploadAsync();
    const status = Number(result?.status || 0);

    if (status < 200 || status >= 300) {
      throw new Error(`Storage upload failed (${status || "unknown"}).`);
    }
  })();

  try {
    await withUploadTimeout(uploadPromise, params.timeoutMs, params.label);
  } catch (error) {
    try {
      await uploadTask?.cancelAsync?.();
    } catch {}
    throw error;
  }
}

export async function uploadFileToSignedUrlWithRetry(params: {
  fileUri: string;
  contentType: string;
  label: "video" | "poster";
  maxRetries: number;
  timeoutMs?: number;
  onProgress?: (percent: number) => void;
  resolveUploadSession: () => Promise<SignedMediaUploadSession>;
}): Promise<SignedMediaUploadSession> {
  const timeoutMs = params.timeoutMs ?? SIGNED_UPLOAD_TIMEOUT_MS;
  let lastError: Error | null = null;
  let signedSession: SignedMediaUploadSession | null = null;

  for (let attempt = 0; attempt <= params.maxRetries; attempt += 1) {
    if (attempt > 0) {
      console.log("KRISTO_SIGNED_UPLOAD_RETRY", {
        label: params.label,
        attempt,
        maxRetries: params.maxRetries,
      });
    }

    try {
      signedSession = await params.resolveUploadSession();
      await uploadFileToSignedUrlOnce({
        fileUri: params.fileUri,
        uploadUrl: signedSession.uploadUrl,
        contentType: signedSession.contentType || params.contentType,
        timeoutMs,
        label: params.label,
        onProgress: params.onProgress,
      });

      console.log("KRISTO_SIGNED_UPLOAD_RESULT", {
        label: params.label,
        ok: true,
        attempt,
      });

      return signedSession;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log("KRISTO_SIGNED_UPLOAD_ERROR", {
        label: params.label,
        attempt,
        message: lastError.message,
      });
    }
  }

  console.log("KRISTO_SIGNED_UPLOAD_RESULT", {
    label: params.label,
    ok: false,
    attempts: params.maxRetries + 1,
  });

  throw lastError || new Error(`${params.label} upload failed.`);
}

export async function uploadVideoToStorageWithRetry(params: {
  fileUri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
  maxRetries?: number;
  onProgress?: (percent: number) => void;
}): Promise<SignedMediaUploadSession> {
  return uploadFileToSignedUrlWithRetry({
    fileUri: params.fileUri,
    contentType: params.contentType,
    label: "video",
    maxRetries: params.maxRetries ?? VIDEO_SIGNED_UPLOAD_MAX_RETRIES,
    onProgress: params.onProgress,
    resolveUploadSession: () =>
      requestVideoUploadUrl({
        fileName: params.fileName,
        contentType: params.contentType,
        fileSize: params.fileSize,
        headers: params.headers,
      }),
  });
}

export async function uploadPosterToStorageWithRetry(params: {
  fileUri: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  headers: HeadersRec;
  maxRetries?: number;
}): Promise<SignedMediaUploadSession> {
  return uploadFileToSignedUrlWithRetry({
    fileUri: params.fileUri,
    contentType: params.contentType,
    label: "poster",
    maxRetries: params.maxRetries ?? POSTER_SIGNED_UPLOAD_MAX_RETRIES,
    resolveUploadSession: () =>
      requestPosterUploadUrl({
        fileName: params.fileName,
        contentType: params.contentType,
        fileSize: params.fileSize,
        headers: params.headers,
      }),
  });
}

/** @deprecated Use uploadVideoToStorageWithRetry or uploadFileToSignedUrlWithRetry. */
export async function uploadFileToSignedUrl(params: {
  fileUri: string;
  uploadUrl: string;
  contentType: string;
  onProgress?: (percent: number) => void;
}) {
  await uploadFileToSignedUrlOnce({
    fileUri: params.fileUri,
    uploadUrl: params.uploadUrl,
    contentType: params.contentType,
    timeoutMs: SIGNED_UPLOAD_TIMEOUT_MS,
    label: "legacy",
    onProgress: params.onProgress,
  });
}

/** @deprecated Use uploadVideoToStorageWithRetry. */
export async function uploadVideoFileToSignedUrl(params: {
  fileUri: string;
  uploadUrl: string;
  contentType: string;
  onProgress?: (percent: number) => void;
}) {
  return uploadFileToSignedUrl(params);
}

export type ChurchVideoPublishMetadata = {
  durationMs?: number;
  sizeBytes: number;
  bitrateEstimate?: number;
  faststart: boolean;
};

export function computeVideoBitrateEstimate(sizeBytes: number, durationMs: number): number | undefined {
  const bytes = Number(sizeBytes);
  const ms = Number(durationMs);
  if (!Number.isFinite(bytes) || bytes <= 0) return undefined;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.round((bytes * 8) / (ms / 1000));
}

export function buildChurchVideoPublishMetadata(params: {
  durationMs?: number;
  sizeBytes: number;
  faststart: boolean;
}): ChurchVideoPublishMetadata {
  const sizeBytes = Math.max(0, Math.round(Number(params.sizeBytes || 0)));
  const durationMsRaw = Number(params.durationMs || 0);
  const durationMs =
    Number.isFinite(durationMsRaw) && durationMsRaw > 0 ? Math.round(durationMsRaw) : undefined;
  const bitrateEstimate =
    durationMs && sizeBytes > 0
      ? computeVideoBitrateEstimate(sizeBytes, durationMs)
      : undefined;

  return {
    ...(durationMs ? { durationMs } : {}),
    sizeBytes,
    ...(bitrateEstimate ? { bitrateEstimate } : {}),
    faststart: params.faststart === true,
  };
}

export type PublishedFeedPost = {
  item: Record<string, unknown>;
  backendFeedId: string;
  mediaStatus: string;
};

/** Parse POST /api/church/feed publish payloads even when `ok` is missing in a 201 body. */
export function parsePublishedFeedResponse(res: any): PublishedFeedPost | null {
  const nestedItem = res?.item;
  const data = res?.data;
  const dataItem =
    data && typeof data === "object" && !Array.isArray(data) && String(data?.id || "").trim()
      ? data
      : data && typeof data === "object" && !Array.isArray(data) && data?.item
        ? data.item
        : null;
  const item =
    nestedItem && typeof nestedItem === "object" && !Array.isArray(nestedItem)
      ? nestedItem
      : dataItem;

  const backendFeedId = String(item?.id || res?.postId || res?.id || "").trim();
  if (!backendFeedId) return null;

  return {
    item: (item && typeof item === "object" ? item : { id: backendFeedId }) as Record<string, unknown>,
    backendFeedId,
    mediaStatus: String(item?.mediaStatus || "ready").trim() || "ready",
  };
}

export async function publishChurchVideoFeedPost(params: {
  title: string;
  caption: string;
  videoUrl: string;
  posterUri?: string;
  videoPosterUri?: string;
  thumbnailUri?: string;
  headers: HeadersRec;
  durationMs?: number;
  sizeBytes?: number;
  bitrateEstimate?: number;
  faststart?: boolean;
  faststartPending?: boolean;
  faststartReason?: string | null;
}) {
  const poster = String(params.posterUri || params.videoPosterUri || params.thumbnailUri || "").trim();
  const metadata = buildChurchVideoPublishMetadata({
    durationMs: params.durationMs,
    sizeBytes: Number(params.sizeBytes || 0),
    faststart: params.faststart === true,
  });
  const publishBitrateEstimate =
    Number(params.bitrateEstimate || 0) > 0
      ? Math.round(Number(params.bitrateEstimate))
      : metadata.bitrateEstimate;

  const publishBody = {
    type: "video",
    mediaType: "video",
    source: "media-upload",
    postOrigin: "media",
    storageType: "media",
    isMediaPost: true,
    mediaStatus: "ready" satisfies MediaStatus,
    title: params.title,
    text: params.caption,
    videoUrl: params.videoUrl,
    ...(metadata.durationMs ? { durationMs: metadata.durationMs } : {}),
    ...(metadata.sizeBytes > 0 ? { sizeBytes: metadata.sizeBytes } : {}),
    ...(publishBitrateEstimate ? { bitrateEstimate: publishBitrateEstimate } : {}),
    faststart: metadata.faststart,
    faststartPending: params.faststartPending === true,
    ...(params.faststartReason
      ? { faststartReason: String(params.faststartReason).trim() }
      : {}),
    ...(poster
      ? {
          posterUri: poster,
          videoPosterUri: poster,
          thumbnailUri: poster,
        }
      : {}),
  };

  console.log("KRISTO_VIDEO_METADATA_PUBLISHED", {
    title: params.title,
    videoUrl: params.videoUrl,
    durationMs: metadata.durationMs ?? null,
    sizeBytes: metadata.sizeBytes || null,
    bitrateEstimate: publishBitrateEstimate ?? null,
    faststart: metadata.faststart,
    faststartPending: params.faststartPending === true,
    faststartReason: params.faststartReason || null,
    durationSec: metadata.durationMs ? metadata.durationMs / 1000 : null,
    fileSizeBytes: metadata.sizeBytes > 0 ? metadata.sizeBytes : null,
  });

  console.log("KRISTO_VIDEO_PUBLISH_PAYLOAD", {
    ...publishBody,
    faststart: metadata.faststart,
    faststartPending: params.faststartPending === true,
    faststartReason: params.faststartReason || null,
  });

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res: any = await withPublishTimeout(
        apiPost("/api/church/feed", publishBody, { headers: params.headers }),
        PUBLISH_TIMEOUT_MS
      );
      const published = parsePublishedFeedResponse(res);

      if (published) {
        console.log("KRISTO_UPLOAD_PUBLISH_SUCCESS", {
          backendFeedId: published.backendFeedId,
          mediaStatus: published.mediaStatus,
          httpStatus: Number(res?.status || 0) || null,
          responseOk: res?.ok !== false,
          attempt,
        });
        return {
          ...res,
          ok: true,
          item: published.item,
          data: published.item,
        };
      }

      if (!res?.ok) {
        throw new Error(uploadErrorMessage(res, "Could not publish video to feed."));
      }

      throw new Error("Video uploaded but feed post id was missing.");
    } catch (error) {
      lastError = error;
      if (attempt < 2 && isPublishTimeoutError(error)) {
        console.log("KRISTO_UPLOAD_PUBLISH_TIMEOUT_RETRY", { attempt });
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Could not publish video to feed.");
}
