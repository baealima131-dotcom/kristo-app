import {
  feedRemoveOptimisticVideoUpload,
  feedUpdateOptimisticVideoUpload,
  isOptimisticVideoUploadPost,
  feedList,
} from "@/src/lib/homeFeedStore";
import {
  guessPosterContentType,
  guessVideoContentType,
  fileNameFromUri,
  publishChurchVideoFeedPost,
  resolveUploadFileSize,
  uploadPosterToStorageWithRetry,
  uploadVideoToStorageWithRetry,
} from "@/src/lib/churchVideoUpload";
import { compressVideoForUpload } from "@/src/lib/videoCompress";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";

export type MediaVideoUploadStatus = "uploading" | "processing" | "failed" | "done";

export type MediaVideoUploadJob = {
  fileUri: string;
  localPosterUri?: string;
  fileName: string;
  title: string;
  caption: string;
  churchId: string;
  userId: string;
  role: string;
};

export type MediaVideoUploadResult = {
  backendFeedId: string;
  videoUrl: string;
  posterUri: string | null;
  mediaStatus?: string;
};

export type MediaVideoUploadCallbacks = {
  onProgress?: (uploadProgress: number, uploadStatus?: MediaVideoUploadStatus) => void;
  onSuccess?: (result: MediaVideoUploadResult) => void;
  onError?: (message: string) => void;
};

/** @deprecated Legacy optimistic feed job shape — kept for stale local-upload cleanup only. */
export type OptimisticVideoUploadJob = MediaVideoUploadJob & { tempPostId: string };

const inflight = new Map<string, Promise<void>>();

function uploadHeadersForJob(job: MediaVideoUploadJob) {
  return getKristoHeaders({
    userId: job.userId,
    role: (job.role || "Member") as any,
    churchId: job.churchId,
  }) as Record<string, string>;
}

function jobInflightKey(job: MediaVideoUploadJob) {
  return `${job.fileUri}::${job.fileName}::${job.title}`;
}

async function uploadPosterIfAvailable(job: MediaVideoUploadJob, uploadHeaders: Record<string, string>) {
  if (!job.localPosterUri) return "";

  try {
    const posterSize = await resolveUploadFileSize(job.localPosterUri);
    const posterFileName = fileNameFromUri(job.localPosterUri, `poster-${Date.now()}.jpg`);
    const posterContentType = guessPosterContentType(posterFileName);

    if (posterSize <= 0) {
      console.log("KRISTO_UPLOAD_POSTER_SKIPPED", {
        reason: "missing-poster-file-size",
        localPosterUri: job.localPosterUri,
      });
      return "";
    }

    console.log("KRISTO_UPLOAD_POSTER_START", {
      posterFileName,
      posterContentType,
      posterSize,
    });

    const posterSigned = await uploadPosterToStorageWithRetry({
      fileUri: job.localPosterUri,
      fileName: posterFileName,
      contentType: posterContentType,
      fileSize: posterSize,
      headers: uploadHeaders,
    });

    const posterPublicUrl = String(posterSigned.publicUrl || posterSigned.videoUrl || "").trim();

    console.log("KRISTO_UPLOAD_POSTER_SIGNED_URL", {
      publicUrl: posterPublicUrl || null,
    });

    return posterPublicUrl;
  } catch (posterError) {
    console.log("KRISTO_UPLOAD_POSTER_ERROR", {
      message: String((posterError as any)?.message || posterError || "unknown"),
      localPosterUri: job.localPosterUri,
    });
    return "";
  }
}

async function runMediaVideoUpload(job: MediaVideoUploadJob, callbacks: MediaVideoUploadCallbacks) {
  const uploadHeaders = uploadHeadersForJob(job);

  const reportProgress = (uploadProgress: number, uploadStatus: MediaVideoUploadStatus = "uploading") => {
    const cappedProgress =
      uploadStatus === "processing" || uploadStatus === "done"
        ? 100
        : Math.max(0, Math.min(99, Math.round(uploadProgress)));

    callbacks.onProgress?.(cappedProgress, uploadStatus);
    console.log("KRISTO_MEDIA_VIDEO_UPLOAD_PROGRESS", {
      uploadProgress: cappedProgress,
      uploadStatus,
      title: job.title,
    });
  };

  try {
    console.log("KRISTO_MEDIA_STATUS_UPLOADING", {
      title: job.title,
      fileName: job.fileName,
    });
    reportProgress(0, "uploading");

    const compressed = await compressVideoForUpload(job.fileUri);
    const uploadUri = compressed.uri;
    const uploadFileName = fileNameFromUri(uploadUri, job.fileName);
    const fileSize = await resolveUploadFileSize(uploadUri);
    const contentType = guessVideoContentType(uploadFileName);

    if (!uploadUri || !fileSize) {
      throw new Error("Could not read the selected video file.");
    }

    // TODO(multipart): For large compressed files, prefer chunked multipart upload once supported.

    const posterPublicUrl = await uploadPosterIfAvailable(job, uploadHeaders);

    const signed = await uploadVideoToStorageWithRetry({
      fileUri: uploadUri,
      fileName: uploadFileName,
      contentType,
      fileSize,
      headers: uploadHeaders,
      onProgress: (pct) => reportProgress(pct, "uploading"),
    });

    reportProgress(100, "processing");

    console.log("KRISTO_MEDIA_STATUS_PROCESSING", {
      title: job.title,
      videoUrl: signed.videoUrl,
    });

    const feedRes = await publishChurchVideoFeedPost({
      title: job.title,
      caption: job.caption,
      videoUrl: signed.videoUrl,
      posterUri: posterPublicUrl || undefined,
      videoPosterUri: posterPublicUrl || undefined,
      thumbnailUri: posterPublicUrl || undefined,
      headers: uploadHeaders,
    });

    const backendItem = feedRes?.item || feedRes?.data || feedRes;
    const backendFeedId = String(backendItem?.id || "").trim();
    const mediaStatus = String(backendItem?.mediaStatus || "processing").trim();

    if (!backendFeedId) {
      throw new Error("Video uploaded but feed post id was missing.");
    }

    console.log("KRISTO_MEDIA_STATUS_PROCESSING", {
      backendFeedId,
      mediaStatus,
      videoUrl: signed.videoUrl,
    });

    if (mediaStatus === "ready") {
      console.log("KRISTO_MEDIA_STATUS_READY", {
        backendFeedId,
        videoUrl: signed.videoUrl,
      });
    }

    const result: MediaVideoUploadResult = {
      backendFeedId,
      videoUrl: signed.videoUrl,
      posterUri: posterPublicUrl || null,
      mediaStatus,
    };

    reportProgress(100, "done");

    console.log("KRISTO_OPTIMISTIC_VIDEO_UPLOAD_DONE", {
      backendFeedId,
      videoUrl: signed.videoUrl,
      posterUri: posterPublicUrl || null,
      compressed: !compressed.skipped,
      originalBytes: compressed.originalBytes,
      compressedBytes: compressed.compressedBytes,
    });

    callbacks.onSuccess?.(result);
  } catch (error) {
    const message = String((error as any)?.message || error || "Upload failed");
    console.log("KRISTO_OPTIMISTIC_VIDEO_UPLOAD_FAILED", { message, title: job.title });
    callbacks.onError?.(message);
  }
}

export function startMediaVideoUpload(job: MediaVideoUploadJob, callbacks: MediaVideoUploadCallbacks = {}) {
  const key = jobInflightKey(job);
  if (inflight.has(key)) return;

  const task = runMediaVideoUpload(job, callbacks).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
}

/** @deprecated Do not add local-upload feed rows. Kept as alias for legacy imports. */
export function startOptimisticVideoUpload(job: OptimisticVideoUploadJob) {
  startMediaVideoUpload(job, {
    onProgress: (uploadProgress, uploadStatus) => {
      if (!job.tempPostId) return;
      feedUpdateOptimisticVideoUpload(job.tempPostId, {
        uploadProgress,
        ...(uploadStatus ? { uploadStatus } : {}),
      });
    },
    onSuccess: ({ backendFeedId, videoUrl, posterUri }) => {
      if (job.tempPostId) {
        feedRemoveOptimisticVideoUpload(job.tempPostId);
      }
      if (posterUri && videoUrl) {
        (globalThis as any).__KRISTO_FEED_VIDEO_POSTER_SEED__ = { videoUrl, posterUri };
      }
      // Media-first: do not focus Home Feed until mediaStatus is ready server-side.
      if (backendFeedId) {
        (globalThis as any).__KRISTO_MEDIA_STORAGE_REFRESH__ = backendFeedId;
      }
    },
    onError: (message) => {
      if (!job.tempPostId) return;
      feedUpdateOptimisticVideoUpload(job.tempPostId, {
        uploadStatus: "failed",
        uploadError: message,
      });
    },
  });
}

function legacyJobFromFeedItem(tempPostId: string): OptimisticVideoUploadJob | null {
  const item = (feedList() as any[]).find((row) => String(row?.id || "") === tempPostId);
  if (!item || !isOptimisticVideoUploadPost(item)) return null;

  const uploadJob = item?.uploadJob || {};
  const fileUri = String(uploadJob?.fileUri || item?.localVideoUri || "").trim();
  const session = getSessionSync() as any;

  if (!fileUri) return null;

  return {
    tempPostId,
    fileUri,
    localPosterUri: String(uploadJob?.localPosterUri || item?.localPosterUri || "").trim() || undefined,
    fileName: String(uploadJob?.fileName || fileNameFromUri(fileUri, `video-${Date.now()}.mp4`)),
    title: String(uploadJob?.title || item?.title || "").trim(),
    caption: String(uploadJob?.caption || item?.body || item?.text || "").trim(),
    churchId: String(item?.churchId || session?.churchId || "").trim(),
    userId: String(session?.userId || "").trim(),
    role: String(session?.role || "Member"),
  };
}

/** Retry stale local-upload rows left from older app versions. */
export function retryOptimisticVideoUpload(tempPostId: string) {
  const job = legacyJobFromFeedItem(tempPostId);
  if (!job) return;

  feedUpdateOptimisticVideoUpload(tempPostId, {
    uploadStatus: "uploading",
    uploadProgress: 0,
    uploadError: "",
  });

  startOptimisticVideoUpload(job);
}

/** Remove stale local-upload rows left from older app versions. */
export function cancelOptimisticVideoUpload(tempPostId: string) {
  feedRemoveOptimisticVideoUpload(tempPostId);
}
