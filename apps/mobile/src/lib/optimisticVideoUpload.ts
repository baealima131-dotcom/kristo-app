import {
  feedList,
  feedRemoveOptimisticVideoUpload,
  feedUpdateOptimisticVideoUpload,
  isOptimisticVideoUploadPost,
} from "@/src/lib/homeFeedStore";
import {
  guessPosterContentType,
  guessVideoContentType,
  fileNameFromUri,
  publishChurchVideoFeedPost,
  requestPosterUploadUrl,
  requestVideoUploadUrl,
  uploadFileToSignedUrl,
  uploadVideoFileToSignedUrl,
} from "@/src/lib/churchVideoUpload";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";

export type OptimisticVideoUploadStatus = "uploading" | "processing" | "failed" | "done";

export type OptimisticVideoUploadJob = {
  tempPostId: string;
  fileUri: string;
  localPosterUri?: string;
  fileName: string;
  title: string;
  caption: string;
  churchId: string;
  userId: string;
  role: string;
};

const inflight = new Map<string, Promise<void>>();

function uploadHeadersForJob(job: OptimisticVideoUploadJob) {
  return getKristoHeaders({
    userId: job.userId,
    role: (job.role || "Member") as any,
    churchId: job.churchId,
  }) as Record<string, string>;
}

function jobFromFeedItem(tempPostId: string): OptimisticVideoUploadJob | null {
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

function patchProgress(tempPostId: string, uploadProgress: number, uploadStatus?: OptimisticVideoUploadStatus) {
  feedUpdateOptimisticVideoUpload(tempPostId, {
    uploadProgress: Math.max(0, Math.min(100, Math.round(uploadProgress))),
    ...(uploadStatus ? { uploadStatus } : {}),
  });

  console.log("KRISTO_OPTIMISTIC_VIDEO_UPLOAD_PROGRESS", {
    tempPostId,
    uploadProgress: Math.round(uploadProgress),
    uploadStatus: uploadStatus || "uploading",
  });
}

async function runOptimisticVideoUpload(job: OptimisticVideoUploadJob) {
  const uploadHeaders = uploadHeadersForJob(job);

  try {
    patchProgress(job.tempPostId, 0, "uploading");

    const FileSystem = await import("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(job.fileUri, { size: true } as any);
    const fileSize = Number((info as any)?.size || 0);
    const contentType = guessVideoContentType(job.fileName);

    if (!fileSize || !(info as any)?.exists) {
      throw new Error("Could not read the selected video file.");
    }

    let posterPublicUrl = "";

    if (job.localPosterUri) {
      try {
        const posterInfo = await FileSystem.getInfoAsync(job.localPosterUri, { size: true } as any);
        const posterSize = Number((posterInfo as any)?.size || 0);
        const posterFileName = fileNameFromUri(job.localPosterUri, `poster-${Date.now()}.jpg`);
        const posterContentType = guessPosterContentType(posterFileName);

        if (posterSize > 0 && (posterInfo as any)?.exists) {
          const posterSigned = await requestPosterUploadUrl({
            fileName: posterFileName,
            contentType: posterContentType,
            fileSize: posterSize,
            headers: uploadHeaders,
          });

          await uploadFileToSignedUrl({
            fileUri: job.localPosterUri,
            uploadUrl: posterSigned.uploadUrl,
            contentType: posterContentType,
          });

          posterPublicUrl = String(posterSigned.publicUrl || posterSigned.videoUrl || "").trim();
        }
      } catch (posterError) {
        console.log("KRISTO_UPLOAD_POSTER_ERROR", posterError);
      }
    }

    const signed = await requestVideoUploadUrl({
      fileName: job.fileName,
      contentType,
      fileSize,
      headers: uploadHeaders,
    });

    await uploadVideoFileToSignedUrl({
      fileUri: job.fileUri,
      uploadUrl: signed.uploadUrl,
      contentType: signed.contentType,
      onProgress: (pct) => patchProgress(job.tempPostId, pct, "uploading"),
    });

    patchProgress(job.tempPostId, 100, "processing");

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

    if (posterPublicUrl && signed.videoUrl) {
      (globalThis as any).__KRISTO_FEED_VIDEO_POSTER_SEED__ = {
        videoUrl: signed.videoUrl,
        posterUri: posterPublicUrl,
      };
    }

    feedRemoveOptimisticVideoUpload(job.tempPostId);

    if (backendFeedId) {
      (globalThis as any).__KRISTO_HOME_FEED_PENDING_FOCUS__ = backendFeedId;
    }

    try {
      (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__?.("optimistic-video-done");
    } catch {}

    console.log("KRISTO_OPTIMISTIC_VIDEO_UPLOAD_DONE", {
      tempPostId: job.tempPostId,
      backendFeedId,
      videoUrl: signed.videoUrl,
      posterUri: posterPublicUrl || null,
    });

    console.log("KRISTO_OPTIMISTIC_VIDEO_POST_REPLACED", {
      tempPostId: job.tempPostId,
      backendFeedId,
    });
  } catch (error) {
    const message = String((error as any)?.message || error || "Upload failed");

    feedUpdateOptimisticVideoUpload(job.tempPostId, {
      uploadStatus: "failed",
      uploadError: message,
    });

    console.log("KRISTO_OPTIMISTIC_VIDEO_UPLOAD_FAILED", {
      tempPostId: job.tempPostId,
      message,
    });
  }
}

export function startOptimisticVideoUpload(job: OptimisticVideoUploadJob) {
  if (inflight.has(job.tempPostId)) return;

  const task = runOptimisticVideoUpload(job).finally(() => {
    inflight.delete(job.tempPostId);
  });

  inflight.set(job.tempPostId, task);
}

export function retryOptimisticVideoUpload(tempPostId: string) {
  const job = jobFromFeedItem(tempPostId);
  if (!job) return;

  feedUpdateOptimisticVideoUpload(tempPostId, {
    uploadStatus: "uploading",
    uploadProgress: 0,
    uploadError: "",
  });

  startOptimisticVideoUpload(job);
}

export function cancelOptimisticVideoUpload(tempPostId: string) {
  inflight.delete(tempPostId);
  feedRemoveOptimisticVideoUpload(tempPostId);
}
