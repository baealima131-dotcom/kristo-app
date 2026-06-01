import { apiPost } from "@/src/lib/kristoApi";

type HeadersRec = Record<string, string>;

export type SignedMediaUploadSession = {
  uploadUrl: string;
  videoUrl: string;
  publicUrl: string;
  contentType: string;
};

export const SIGNED_UPLOAD_TIMEOUT_MS = 90_000;
export const VIDEO_SIGNED_UPLOAD_MAX_RETRIES = 2;
export const POSTER_SIGNED_UPLOAD_MAX_RETRIES = 1;

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

export async function publishChurchVideoFeedPost(params: {
  title: string;
  caption: string;
  videoUrl: string;
  posterUri?: string;
  videoPosterUri?: string;
  thumbnailUri?: string;
  headers: HeadersRec;
}) {
  const poster = String(params.posterUri || params.videoPosterUri || params.thumbnailUri || "").trim();

  const res: any = await apiPost(
    "/api/church/feed",
    {
      type: "video",
      mediaType: "video",
      source: "media-upload",
      postOrigin: "media",
      storageType: "media",
      isMediaPost: true,
      title: params.title,
      text: params.caption,
      videoUrl: params.videoUrl,
      ...(poster
        ? {
            posterUri: poster,
            videoPosterUri: poster,
            thumbnailUri: poster,
          }
        : {}),
    },
    { headers: params.headers }
  );

  if (!res?.ok) {
    throw new Error(uploadErrorMessage(res, "Could not publish video to feed."));
  }

  return res;
}
