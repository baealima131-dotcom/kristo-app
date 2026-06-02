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
} from "@/src/lib/churchVideoUpload";
import {
  chunkSessionResumeProgress,
  getChunkUploadSession,
  MultipartBackendNotDeployedError,
  MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE,
  uploadVideoWithChunkSession,
} from "@/src/lib/churchVideoChunkUpload";
import { compressVideoForUpload } from "@/src/lib/videoCompress";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  createMediaUploadJob,
  createMediaUploadJobId,
  getMediaUploadJob,
  hydrateMediaUploadJobs,
  patchMediaUploadJob,
  removeMediaUploadJob,
  type PersistedMediaUploadJob,
} from "@/src/lib/mediaUploadJobStore";
import {
  probeKristoNetwork,
  startKristoNetworkMonitor,
  subscribeKristoNetworkStatus,
} from "@/src/lib/networkMonitor";

export type MediaVideoUploadStatus = "uploading" | "processing" | "failed" | "done" | "paused" | "ready";

export type MediaVideoUploadJob = {
  jobId?: string;
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
  jobId: string;
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
let networkMonitorStarted = false;
let networkRetryBound = false;
let uploadJobsHydrated = false;

function ensureNetworkMonitor() {
  if (networkMonitorStarted) return;
  networkMonitorStarted = true;
  startKristoNetworkMonitor();

  if (networkRetryBound) return;
  networkRetryBound = true;

  subscribeKristoNetworkStatus((online) => {
    if (!online) return;
    void resumePausedMediaUploadJobs("network-online");
  });
}

function uploadHeadersForJob(job: MediaVideoUploadJob) {
  return getKristoHeaders({
    userId: job.userId,
    role: (job.role || "Member") as any,
    churchId: job.churchId,
  }) as Record<string, string>;
}

function jobInflightKey(jobId: string) {
  return jobId;
}

function mapPhaseToUploadStatus(phase: PersistedMediaUploadJob["phase"]): MediaVideoUploadStatus {
  if (phase === "paused") return "paused";
  if (phase === "processing") return "processing";
  if (phase === "ready") return "ready";
  if (phase === "failed") return "failed";
  return "uploading";
}

async function markJobPatch(
  jobId: string,
  patch: Partial<PersistedMediaUploadJob>,
  callbacks?: MediaVideoUploadCallbacks
) {
  const updated = await patchMediaUploadJob(jobId, patch);
  if (!updated) return null;

  if (typeof patch.uploadProgress === "number" || patch.phase) {
    callbacks?.onProgress?.(
      updated.uploadProgress,
      mapPhaseToUploadStatus(updated.phase)
    );
  }

  return updated;
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

    const posterSigned = await uploadPosterToStorageWithRetry({
      fileUri: job.localPosterUri,
      fileName: posterFileName,
      contentType: posterContentType,
      fileSize: posterSize,
      headers: uploadHeaders,
    });

    return String(posterSigned.publicUrl || posterSigned.videoUrl || "").trim();
  } catch (posterError) {
    console.log("KRISTO_UPLOAD_POSTER_ERROR", {
      message: String((posterError as any)?.message || posterError || "unknown"),
      localPosterUri: job.localPosterUri,
    });
    return "";
  }
}

function isRetryableUploadError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort") ||
    message.includes("failed to fetch") ||
    message.includes("connection") ||
    message.includes("offline")
  );
}

export const MULTIPART_BACKEND_NOT_DEPLOYED_REASON = "multipart-backend-not-deployed";

const AUTO_MEDIA_UPLOAD_RESUME_REASONS = new Set([
  "app-startup",
  "network-online",
  "media-storage-mount",
]);

export function isMultipartBackendNotDeployedJob(
  job: Pick<PersistedMediaUploadJob, "error" | "pauseReason">
) {
  const pauseReason = String(job.pauseReason || "").trim();
  if (pauseReason === MULTIPART_BACKEND_NOT_DEPLOYED_REASON) return true;

  const message = String(job.error || "").trim();
  return message.includes(MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE);
}

function isRetryableFailedMediaUploadJob(job: PersistedMediaUploadJob) {
  if (job.phase !== "failed") return false;
  if (isMultipartBackendNotDeployedJob(job)) return false;
  return isRetryableUploadError({ message: job.error || "" });
}

function shouldResumeMediaUploadJob(job: PersistedMediaUploadJob) {
  if (isMultipartBackendNotDeployedJob(job)) return false;
  if (job.phase === "paused") return true;
  if (job.phase === "uploading") return !inflight.has(jobInflightKey(job.jobId));
  if (isRetryableFailedMediaUploadJob(job)) return true;
  return false;
}

function storedJobToUploadJob(stored: PersistedMediaUploadJob): MediaVideoUploadJob {
  return {
    jobId: stored.jobId,
    fileUri: stored.fileUri,
    localPosterUri: stored.localPosterUri,
    fileName: stored.fileName,
    title: stored.title,
    caption: stored.caption,
    churchId: stored.churchId,
    userId: stored.userId,
    role: stored.role,
  };
}

async function uploadVideoWithResume(job: MediaVideoUploadJob, jobId: string, callbacks?: MediaVideoUploadCallbacks) {
  const uploadHeaders = uploadHeadersForJob(job);
  const stored = await getMediaUploadJob(jobId);
  const chunkSessionId = stored?.chunkSessionId || jobId;

  const compressed = await compressVideoForUpload(job.fileUri);
  const uploadUri = compressed.uri;
  const uploadFileName = fileNameFromUri(uploadUri, job.fileName);
  const fileSize = await resolveUploadFileSize(uploadUri);
  const contentType = guessVideoContentType(uploadFileName);

  if (!uploadUri || !fileSize) {
    throw new Error("Could not read the selected video file.");
  }

  const existingChunkSession = await getChunkUploadSession(chunkSessionId);
  if (existingChunkSession) {
    const resumePct = chunkSessionResumeProgress(existingChunkSession);
    await markJobPatch(
      jobId,
      {
        resumableMode: "chunk",
        chunkSessionId,
        uploadedChunkIndexes: existingChunkSession.completedParts.map((part) => part.partNumber),
        totalChunks: existingChunkSession.totalParts,
        uploadProgress: Math.max(stored?.uploadProgress || 0, resumePct),
        phase: "uploading",
        error: "",
      },
      callbacks
    );
  }

  const signed = await uploadVideoWithChunkSession({
    sessionId: chunkSessionId,
    fileUri: uploadUri,
    fileName: uploadFileName,
    contentType,
    fileSize,
    headers: uploadHeaders,
    existingSession: existingChunkSession,
    onProgress: (pct) => {
      void markJobPatch(jobId, { uploadProgress: pct, phase: "uploading" }, callbacks);
    },
  });

  await markJobPatch(
    jobId,
    {
      resumableMode: "chunk",
      chunkSessionId,
      uploadProgress: 100,
      phase: "uploading",
    },
    callbacks
  );

  return signed;
}

async function runMediaVideoUpload(
  job: MediaVideoUploadJob,
  jobId: string,
  callbacks: MediaVideoUploadCallbacks = {},
  opts?: { resume?: boolean }
) {
  const uploadHeaders = uploadHeadersForJob(job);

  try {
    console.log("KRISTO_MEDIA_STATUS_UPLOADING", {
      jobId,
      title: job.title,
      fileName: job.fileName,
      resume: Boolean(opts?.resume),
    });

    const storedBeforeRun = await getMediaUploadJob(jobId);
    const uploadProgress = opts?.resume
      ? Math.max(0, Math.min(99, Number(storedBeforeRun?.uploadProgress || 0)))
      : 0;

    await markJobPatch(jobId, { phase: "uploading", uploadProgress, error: "" }, callbacks);

    const posterPublicUrl = await uploadPosterIfAvailable(job, uploadHeaders);
    const signed = await uploadVideoWithResume(job, jobId, callbacks);

    await markJobPatch(jobId, { uploadProgress: 100, phase: "processing" }, callbacks);

    console.log("KRISTO_MEDIA_STATUS_PROCESSING", {
      jobId,
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

    await markJobPatch(
      jobId,
      {
        phase: "processing",
        uploadProgress: 100,
        backendFeedId,
        videoUrl: signed.videoUrl,
        posterUri: posterPublicUrl || undefined,
        mediaStatus,
      },
      callbacks
    );

    console.log("KRISTO_MEDIA_STATUS_PROCESSING", {
      jobId,
      backendFeedId,
      mediaStatus,
      videoUrl: signed.videoUrl,
    });

    (globalThis as any).__KRISTO_MEDIA_STORAGE_REFRESH__ = backendFeedId;

    const result: MediaVideoUploadResult = {
      jobId,
      backendFeedId,
      videoUrl: signed.videoUrl,
      posterUri: posterPublicUrl || null,
      mediaStatus,
    };

    callbacks.onSuccess?.(result);
  } catch (error) {
    const message = String((error as any)?.message || error || "Upload failed");
    const stored = await getMediaUploadJob(jobId);
    const pausedAtProgress = Math.max(0, Math.min(99, Number(stored?.uploadProgress || 0)));
    const multipartBackendMissing =
      error instanceof MultipartBackendNotDeployedError ||
      message === MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE;

    if (multipartBackendMissing) {
      await markJobPatch(
        jobId,
        {
          phase: "paused",
          pausedAtProgress,
          uploadProgress: pausedAtProgress,
          resumableMode: "chunk",
          error: MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE,
          pauseReason: MULTIPART_BACKEND_NOT_DEPLOYED_REASON,
        },
        callbacks
      );
      console.log("KRISTO_MEDIA_UPLOAD_PAUSED", {
        jobId,
        pausedAtProgress,
        message: MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE,
        reason: "multipart-backend-not-deployed",
      });
      callbacks.onError?.(MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE);
      return;
    }

    if (isRetryableUploadError(error)) {
      await markJobPatch(
        jobId,
        {
          phase: "paused",
          pausedAtProgress,
          uploadProgress: pausedAtProgress,
          error: message,
        },
        callbacks
      );
      console.log("KRISTO_MEDIA_UPLOAD_PAUSED", { jobId, pausedAtProgress, message });
      callbacks.onError?.(message);
      return;
    }

    await markJobPatch(
      jobId,
      {
        phase: "failed",
        error: message,
        uploadProgress: pausedAtProgress,
      },
      callbacks
    );
    console.log("KRISTO_OPTIMISTIC_VIDEO_UPLOAD_FAILED", { jobId, message, title: job.title });
    callbacks.onError?.(message);
  }
}

function launchMediaVideoUpload(
  job: MediaVideoUploadJob,
  jobId: string,
  callbacks: MediaVideoUploadCallbacks = {},
  opts?: { resume?: boolean }
) {
  const key = jobInflightKey(jobId);
  if (inflight.has(key)) {
    console.log("KRISTO_MEDIA_UPLOAD_RESUME_ALREADY_INFLIGHT", { jobId, resume: Boolean(opts?.resume) });
    return jobId;
  }

  ensureNetworkMonitor();

  const task = runMediaVideoUpload(job, jobId, callbacks, opts).finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, task);
  return jobId;
}

export function enqueueMediaVideoUpload(job: MediaVideoUploadJob, callbacks: MediaVideoUploadCallbacks = {}) {
  const jobId = String(job.jobId || createMediaUploadJobId()).trim();

  void createMediaUploadJob({
    jobId,
    title: job.title,
    caption: job.caption,
    fileUri: job.fileUri,
    localPosterUri: job.localPosterUri,
    fileName: job.fileName,
    churchId: job.churchId,
    userId: job.userId,
    role: job.role,
    resumableMode: "chunk",
    chunkSessionId: jobId,
  });

  launchMediaVideoUpload({ ...job, jobId }, jobId, callbacks);
  return jobId;
}

export function startMediaVideoUpload(job: MediaVideoUploadJob, callbacks: MediaVideoUploadCallbacks = {}) {
  return enqueueMediaVideoUpload(job, callbacks);
}

export async function retryMediaUploadJob(jobId: string, opts?: { manual?: boolean }) {
  const stored = await getMediaUploadJob(jobId);
  if (!stored) return false;
  if (stored.phase === "processing" || stored.phase === "ready") return false;
  if (stored.phase === "uploading" && inflight.has(jobInflightKey(jobId))) return false;

  if (isMultipartBackendNotDeployedJob(stored) && !opts?.manual) {
    console.log("KRISTO_MEDIA_UPLOAD_AUTO_RESUME_SKIP", {
      jobId,
      cause: MULTIPART_BACKEND_NOT_DEPLOYED_REASON,
    });
    return false;
  }

  const online = await probeKristoNetwork();
  if (!online) {
    await patchMediaUploadJob(jobId, {
      phase: "paused",
      error: "No network connection. Retry when you are back online.",
    });
    return false;
  }

  if (stored.phase === "uploading") {
    if (isMultipartBackendNotDeployedJob(stored) && !opts?.manual) {
      console.log("KRISTO_MEDIA_UPLOAD_AUTO_RESUME_SKIP", {
        jobId,
        cause: MULTIPART_BACKEND_NOT_DEPLOYED_REASON,
      });
      return false;
    }

    if (opts?.manual) {
      await patchMediaUploadJob(jobId, { error: "", pauseReason: "" });
    }

    launchMediaVideoUpload(storedJobToUploadJob(stored), jobId, {}, { resume: true });
    return true;
  }

  const clearBlockedState = opts?.manual
    ? { error: "", pauseReason: "" }
    : { error: "" };

  if (stored.resumableMode === "v1-restart") {
    await patchMediaUploadJob(jobId, {
      phase: "uploading",
      uploadProgress: 0,
      pausedAtProgress: stored.pausedAtProgress,
      ...clearBlockedState,
    });
  } else {
    const chunkSession = stored.chunkSessionId
      ? await getChunkUploadSession(stored.chunkSessionId)
      : null;
    const resumePct = chunkSessionResumeProgress(chunkSession);
    await patchMediaUploadJob(jobId, {
      phase: "uploading",
      uploadProgress: resumePct,
      pausedAtProgress: stored.pausedAtProgress,
      ...clearBlockedState,
    });
  }

  launchMediaVideoUpload(storedJobToUploadJob(stored), jobId, {}, { resume: true });

  return true;
}

export async function startMediaUploadResumeSystem(reason = "app-startup") {
  if (!uploadJobsHydrated) {
    uploadJobsHydrated = true;
    await hydrateMediaUploadJobs();
  }

  ensureNetworkMonitor();
  await resumePausedMediaUploadJobs(reason);
}

export async function resumePausedMediaUploadJobs(reason = "manual") {
  const session = getSessionSync() as any;
  const churchId = String(session?.churchId || "").trim();
  if (!churchId) {
    if (reason === "app-startup") {
      console.log("KRISTO_MEDIA_UPLOAD_STARTUP_SKIP", { reason, cause: "missing-churchId" });
    }
    return;
  }

  const online = await probeKristoNetwork();
  if (!online) {
    if (reason === "app-startup") {
      console.log("KRISTO_MEDIA_UPLOAD_STARTUP_SKIP", { reason, cause: "offline" });
    }
    return;
  }

  const { listMediaUploadJobs } = await import("@/src/lib/mediaUploadJobStore");
  const jobs = await listMediaUploadJobs(churchId);
  const blockedMultipartJobs = jobs.filter(isMultipartBackendNotDeployedJob);
  if (blockedMultipartJobs.length && AUTO_MEDIA_UPLOAD_RESUME_REASONS.has(reason)) {
    console.log("KRISTO_MEDIA_UPLOAD_AUTO_RESUME_SKIP", {
      reason,
      cause: MULTIPART_BACKEND_NOT_DEPLOYED_REASON,
      count: blockedMultipartJobs.length,
      jobIds: blockedMultipartJobs.map((job) => job.jobId),
    });
  }

  const resumable = jobs.filter(shouldResumeMediaUploadJob);

  if (!resumable.length) {
    if (reason === "app-startup") {
      console.log("KRISTO_MEDIA_UPLOAD_STARTUP_SKIP", {
        reason,
        cause: "no-resumable-jobs",
        totalJobs: jobs.length,
      });
    }
    return;
  }

  const startupLog = reason === "app-startup" ? "KRISTO_MEDIA_UPLOAD_STARTUP_RESUME" : "KRISTO_MEDIA_UPLOAD_AUTO_RETRY";
  console.log(startupLog, {
    reason,
    count: resumable.length,
    jobIds: resumable.map((job) => job.jobId),
    phases: resumable.map((job) => job.phase),
  });

  for (const job of resumable) {
    if (inflight.has(jobInflightKey(job.jobId))) {
      console.log("KRISTO_MEDIA_UPLOAD_RESUME_ALREADY_INFLIGHT", { jobId: job.jobId, reason });
      continue;
    }
    void retryMediaUploadJob(job.jobId, { manual: reason === "manual" });
  }
}

export async function markMediaUploadJobReady(jobId: string, mediaStatus = "ready") {
  await patchMediaUploadJob(jobId, {
    phase: "ready",
    mediaStatus,
    uploadProgress: 100,
  });

  console.log("KRISTO_MEDIA_STATUS_READY", { jobId, mediaStatus });

  try {
    (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__?.("media-upload-ready");
  } catch {}

  setTimeout(() => {
    void removeMediaUploadJob(jobId);
  }, 4000);
}

/** @deprecated Do not add local-upload feed rows. Kept as alias for legacy imports. */
export function startOptimisticVideoUpload(job: OptimisticVideoUploadJob) {
  enqueueMediaVideoUpload(job, {
    onProgress: (uploadProgress, uploadStatus) => {
      if (!job.tempPostId) return;
      feedUpdateOptimisticVideoUpload(job.tempPostId, {
        uploadProgress,
        ...(uploadStatus ? { uploadStatus: uploadStatus as any } : {}),
      });
    },
    onSuccess: ({ backendFeedId, videoUrl, posterUri }) => {
      if (job.tempPostId) {
        feedRemoveOptimisticVideoUpload(job.tempPostId);
      }
      if (posterUri && videoUrl) {
        (globalThis as any).__KRISTO_FEED_VIDEO_POSTER_SEED__ = { videoUrl, posterUri };
      }
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

export async function cancelMediaUploadJob(jobId: string) {
  inflight.delete(jobInflightKey(jobId));
  await removeMediaUploadJob(jobId);
}
