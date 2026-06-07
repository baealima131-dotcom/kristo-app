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
  parsePublishedFeedResponse,
  publishChurchVideoFeedPost,
  resolveUploadFileSize,
  buildChurchVideoPublishMetadata,
  uploadPosterToStorageWithRetry,
} from "@/src/lib/churchVideoUpload";
import {
  chunkSessionResumeProgress,
  getChunkUploadSession,
  MultipartBackendNotDeployedError,
  MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE,
  removeChunkUploadSession,
  uploadVideoWithChunkSession,
} from "@/src/lib/churchVideoChunkUpload";
import { isBrandedVideoPosterUri } from "@/src/lib/brandedVideoPoster";
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

export type MediaVideoUploadStatus =
  | "uploading"
  | "processing"
  | "failed"
  | "done"
  | "paused"
  | "ready"
  | "posted_refreshing";

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
  durationMs?: number;
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

function invokeUploadSuccess(callbacks: MediaVideoUploadCallbacks, result: MediaVideoUploadResult) {
  try {
    callbacks.onSuccess?.(result);
  } catch (error) {
    console.log("KRISTO_UPLOAD_CLIENT_SUCCESS_CALLBACK_ERROR", {
      jobId: result.jobId,
      backendFeedId: result.backendFeedId,
      message: String((error as any)?.message || error || "unknown"),
    });
  }
}

async function completePublishedUploadJob(
  jobId: string,
  job: MediaVideoUploadJob,
  params: {
    backendFeedId: string;
    videoUrl: string;
    posterUri?: string | null;
    mediaStatus: string;
  },
  callbacks: MediaVideoUploadCallbacks
) {
  await markJobPatch(
    jobId,
    {
      phase: "processing",
      uploadProgress: 100,
      backendFeedId: params.backendFeedId,
      videoUrl: params.videoUrl,
      posterUri: params.posterUri || undefined,
      mediaStatus: params.mediaStatus,
      error: "",
    },
    callbacks
  );

  (globalThis as any).__KRISTO_MEDIA_STORAGE_REFRESH__ = params.backendFeedId;

  const result: MediaVideoUploadResult = {
    jobId,
    backendFeedId: params.backendFeedId,
    videoUrl: params.videoUrl,
    posterUri: params.posterUri || null,
    mediaStatus: params.mediaStatus,
  };

  invokeUploadSuccess(callbacks, result);
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

  const startedAt = Date.now();
  console.log("KRISTO_UPLOAD_POSTER_START", {
    jobId: job.jobId,
    localPosterUri: job.localPosterUri,
  });

  try {
    const posterSize = await resolveUploadFileSize(job.localPosterUri);
    const posterFileName = fileNameFromUri(job.localPosterUri, `poster-${Date.now()}.jpg`);
    const posterContentType = guessPosterContentType(posterFileName);

    if (posterSize <= 0) {
      console.log("KRISTO_UPLOAD_POSTER_DONE", {
        jobId: job.jobId,
        durationMs: Date.now() - startedAt,
        ok: false,
        reason: "missing-poster-file-size",
      });
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

    const publicUrl = String(posterSigned.publicUrl || posterSigned.videoUrl || "").trim();
    console.log("KRISTO_UPLOAD_POSTER_DONE", {
      jobId: job.jobId,
      durationMs: Date.now() - startedAt,
      ok: Boolean(publicUrl),
      posterBytes: posterSize,
      publicUrl,
    });
    return publicUrl;
  } catch (posterError) {
    console.log("KRISTO_UPLOAD_POSTER_DONE", {
      jobId: job.jobId,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: String((posterError as any)?.message || posterError || "unknown"),
    });
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

function hasUploadedVideoUrl(stored: PersistedMediaUploadJob | null | undefined, fallback = "") {
  return Boolean(String(stored?.videoUrl || fallback || "").trim());
}

async function tryPublishUploadedVideo(
  job: MediaVideoUploadJob,
  params: {
    videoUrl: string;
    posterPublicUrl: string;
    publishMetadata: Awaited<ReturnType<typeof uploadVideoWithResume>>["publishMetadata"];
    uploadHeaders: Record<string, string>;
    faststartPending?: boolean;
    faststartReason?: string | null;
  }
) {
  const poster = String(params.posterPublicUrl || "").trim();
  const feedRes = await publishChurchVideoFeedPost({
    title: job.title,
    caption: job.caption,
    videoUrl: params.videoUrl,
    posterUri: poster || undefined,
    videoPosterUri: poster || undefined,
    thumbnailUri: poster || undefined,
    headers: params.uploadHeaders,
    durationMs: params.publishMetadata.durationMs,
    sizeBytes: params.publishMetadata.sizeBytes,
    bitrateEstimate: params.publishMetadata.bitrateEstimate,
    faststart: params.publishMetadata.faststart,
    faststartPending: params.faststartPending === true,
    faststartReason: params.faststartReason || null,
  });
  return parsePublishedFeedResponse(feedRes);
}

async function recoverFalseUploadFailure(
  jobId: string,
  job: MediaVideoUploadJob,
  params: {
    reason: string;
    stored: PersistedMediaUploadJob | null;
    videoUrl: string;
    posterUri?: string | null;
    callbacks: MediaVideoUploadCallbacks;
  }
) {
  const videoUrl = String(params.videoUrl || "").trim();
  if (!videoUrl) return false;

  const backendFeedId = String(params.stored?.backendFeedId || "").trim();

  console.log("KRISTO_UPLOAD_FALSE_FAILED_PREVENTED", {
    jobId,
    reason: params.reason,
    videoUrl,
    backendFeedId: backendFeedId || null,
  });

  await markJobPatch(
    jobId,
    {
      phase: "processing",
      uploadProgress: 100,
      videoUrl,
      posterUri: params.posterUri || params.stored?.posterUri || undefined,
      mediaStatus: backendFeedId ? String(params.stored?.mediaStatus || "ready") : "processing",
      error: "",
    },
    params.callbacks
  );

  invokeUploadSuccess(params.callbacks, {
    jobId,
    backendFeedId,
    videoUrl,
    posterUri: params.posterUri || params.stored?.posterUri || null,
    mediaStatus: backendFeedId ? String(params.stored?.mediaStatus || "ready") : "processing",
  });

  return true;
}

export const MULTIPART_BACKEND_NOT_DEPLOYED_REASON = "multipart-backend-not-deployed";

export { MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE } from "@/src/lib/churchVideoChunkUpload";

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
  if (String(job.backendFeedId || "").trim()) return false;
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
    durationMs: stored.durationMs,
  };
}

async function uploadVideoWithResume(job: MediaVideoUploadJob, jobId: string, callbacks?: MediaVideoUploadCallbacks) {
  const uploadHeaders = uploadHeadersForJob(job);
  const stored = await getMediaUploadJob(jobId);
  const chunkSessionId = stored?.chunkSessionId || jobId;

  const compressed = await compressVideoForUpload(job.fileUri, {
    durationMs: job.durationMs,
  });
  const uploadUri = compressed.uri;
  if (compressed.feedExportApplied) {
    console.log("KRISTO_VIDEO_UPLOAD_USING_COMPRESSED", {
      jobId,
      originalBytes: compressed.originalBytes,
      compressedBytes: compressed.compressedBytes,
      uploadUri,
      mimeType: compressed.mimeType || "video/mp4",
      width: compressed.width ?? null,
      height: compressed.height ?? null,
    });
  } else if (compressed.skipped) {
    console.log("KRISTO_VIDEO_UPLOAD_USING_ORIGINAL", {
      jobId,
      originalBytes: compressed.originalBytes,
      reason: compressed.reason,
      uploadUri,
    });
  }
  const uploadFileName = fileNameFromUri(uploadUri, job.fileName);
  const fileSize =
    compressed.compressedBytes > 0
      ? compressed.compressedBytes
      : await resolveUploadFileSize(uploadUri);
  const contentType =
    compressed.feedExportApplied || compressed.mimeType === "video/mp4"
      ? "video/mp4"
      : guessVideoContentType(uploadFileName);

  if (!uploadUri || !fileSize) {
    throw new Error("Could not read the selected video file.");
  }

  let existingChunkSession = await getChunkUploadSession(chunkSessionId);
  if (
    existingChunkSession &&
    String(existingChunkSession.fileUri || "").trim() !== String(uploadUri || "").trim()
  ) {
    await removeChunkUploadSession(chunkSessionId);
    existingChunkSession = null;
    console.log("KRISTO_CHUNK_UPLOAD_SESSION_RESET", {
      sessionId: chunkSessionId,
      reason: "remuxed-video-uri-changed",
    });
  }

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

  const publishMetadata = buildChurchVideoPublishMetadata({
    durationMs: job.durationMs,
    sizeBytes: fileSize,
    faststart: signed.faststart === true,
  });

  console.log("KRISTO_VIDEO_METADATA_CAPTURED", {
    jobId,
    title: job.title,
    durationMs: publishMetadata.durationMs ?? null,
    sizeBytes: publishMetadata.sizeBytes,
    bitrateEstimate: publishMetadata.bitrateEstimate ?? null,
    faststart: publishMetadata.faststart,
    serverFaststart: signed.faststart === true,
    faststartPending: signed.faststartPending === true,
    pickerDurationMs: job.durationMs ?? null,
    compressedSkipped: compressed.skipped,
    compressedReason: compressed.reason || null,
    originalSizeBytes: compressed.originalBytes,
    compressedSizeBytes: compressed.compressedBytes,
  });

  if (!publishMetadata.faststart) {
    console.log("KRISTO_VIDEO_FASTSTART_REQUIRED", {
      videoUrl: String(signed.videoUrl || "").trim(),
      faststart: false,
      faststartPending: signed.faststartPending === true,
    });
  }

  return { signed, publishMetadata };
}

async function runMediaVideoUpload(
  job: MediaVideoUploadJob,
  jobId: string,
  callbacks: MediaVideoUploadCallbacks = {},
  opts?: { resume?: boolean }
) {
  const uploadHeaders = uploadHeadersForJob(job);
  let publishConfirmedFeedId = "";
  let uploadedVideoUrl = "";
  let posterPublicUrl = "";
  let publishPosterUri = "";
  let publishMetadata: Awaited<ReturnType<typeof uploadVideoWithResume>>["publishMetadata"] | null =
    null;

  try {
    const storedBeforeRun = await getMediaUploadJob(jobId);
    const existingBackendFeedId = String(storedBeforeRun?.backendFeedId || "").trim();
    if (existingBackendFeedId) {
      console.log("KRISTO_UPLOAD_PUBLISH_ALREADY_CONFIRMED", {
        jobId,
        backendFeedId: existingBackendFeedId,
      });
      await completePublishedUploadJob(
        jobId,
        job,
        {
          backendFeedId: existingBackendFeedId,
          videoUrl: String(storedBeforeRun?.videoUrl || "").trim(),
          posterUri: storedBeforeRun?.posterUri || null,
          mediaStatus: String(storedBeforeRun?.mediaStatus || "processing").trim() || "processing",
        },
        callbacks
      );
      return;
    }

    console.log("KRISTO_MEDIA_STATUS_UPLOADING", {
      jobId,
      title: job.title,
      fileName: job.fileName,
      resume: Boolean(opts?.resume),
    });

    const uploadProgress = opts?.resume
      ? Math.max(0, Math.min(99, Number(storedBeforeRun?.uploadProgress || 0)))
      : 0;

    await markJobPatch(jobId, { phase: "uploading", uploadProgress, error: "" }, callbacks);

    posterPublicUrl = await uploadPosterIfAvailable(job, uploadHeaders);
    const uploadResult = await uploadVideoWithResume(job, jobId, callbacks);
    const signed = uploadResult.signed;
    publishMetadata = uploadResult.publishMetadata;
    uploadedVideoUrl = String(signed.videoUrl || "").trim();
    const serverPosterUri = String(signed.posterUri || "").trim();
    publishPosterUri = posterPublicUrl || serverPosterUri;
    const usingBrandedPoster =
      signed.brandedPoster === true || isBrandedVideoPosterUri(publishPosterUri);

    if (publishMetadata.faststart) {
      console.log("KRISTO_VIDEO_FASTSTART_DONE", {
        jobId,
        videoUrl: uploadedVideoUrl,
        posterUri: publishPosterUri || null,
      });
    } else {
      console.log("KRISTO_VIDEO_FASTSTART_FAILED", {
        jobId,
        videoUrl: uploadedVideoUrl,
        faststartPending: signed.faststartPending === true,
        faststartReason: signed.faststartReason || null,
        posterUri: usingBrandedPoster ? null : publishPosterUri || null,
        brandedPoster: usingBrandedPoster,
      });
    }

    await markJobPatch(
      jobId,
      {
        uploadProgress: 100,
        phase: "processing",
        videoUrl: uploadedVideoUrl,
        posterUri: usingBrandedPoster ? undefined : publishPosterUri || undefined,
        mediaStatus: "processing",
        error: "",
      },
      callbacks
    );

    console.log("KRISTO_MEDIA_STATUS_PROCESSING", {
      jobId,
      title: job.title,
      videoUrl: uploadedVideoUrl,
      serverPosterUri: serverPosterUri || null,
      brandedPoster: usingBrandedPoster,
      faststart: publishMetadata.faststart,
      faststartPending: signed.faststartPending === true,
      faststartReason: signed.faststartReason || null,
    });

    const publishedFromRetry = await tryPublishUploadedVideo(job, {
      videoUrl: uploadedVideoUrl,
      posterPublicUrl: usingBrandedPoster ? "" : publishPosterUri,
      publishMetadata,
      uploadHeaders,
      faststartPending: signed.faststartPending,
      faststartReason: signed.faststartReason,
    });

    if (!publishedFromRetry) {
      throw new Error("Video uploaded but feed post id was missing.");
    }

    const published = publishedFromRetry;
    publishConfirmedFeedId = published.backendFeedId;

    console.log("KRISTO_MEDIA_STATUS_PROCESSING", {
      jobId,
      backendFeedId: published.backendFeedId,
      mediaStatus: published.mediaStatus,
      videoUrl: signed.videoUrl,
    });

    await completePublishedUploadJob(
      jobId,
      job,
      {
        backendFeedId: published.backendFeedId,
        videoUrl: uploadedVideoUrl,
        posterUri: publishPosterUri || posterPublicUrl || null,
        mediaStatus: published.mediaStatus,
      },
      callbacks
    );
  } catch (error) {
    const message = String((error as any)?.message || error || "Upload failed");
    const stored = await getMediaUploadJob(jobId);
    const recoveredFeedId = String(
      publishConfirmedFeedId || stored?.backendFeedId || ""
    ).trim();
    const recoveredVideoUrl = String(stored?.videoUrl || uploadedVideoUrl || "").trim();

    if (recoveredFeedId) {
      console.log("KRISTO_UPLOAD_STATUS_RECOVERED_AFTER_PUBLISH", {
        jobId,
        backendFeedId: recoveredFeedId,
        message,
      });
      await completePublishedUploadJob(
        jobId,
        job,
        {
          backendFeedId: recoveredFeedId,
          videoUrl: recoveredVideoUrl,
          posterUri: publishPosterUri || stored?.posterUri || posterPublicUrl || null,
          mediaStatus: String(stored?.mediaStatus || "ready").trim() || "ready",
        },
        callbacks
      );
      return;
    }

    if (recoveredVideoUrl) {
      try {
        const republishMetadata =
          publishMetadata ||
          buildChurchVideoPublishMetadata({
            durationMs: job.durationMs,
            sizeBytes: 0,
            faststart: false,
          });
        const republished = await tryPublishUploadedVideo(job, {
          videoUrl: recoveredVideoUrl,
          posterPublicUrl: publishPosterUri || posterPublicUrl || String(stored?.posterUri || ""),
          publishMetadata: republishMetadata,
          uploadHeaders,
          faststartPending: republishMetadata.faststart !== true,
          faststartReason: republishMetadata.faststart ? null : "republish-recovery",
        });
        if (republished) {
          await completePublishedUploadJob(
            jobId,
            job,
            {
              backendFeedId: republished.backendFeedId,
              videoUrl: recoveredVideoUrl,
              posterUri: publishPosterUri || posterPublicUrl || stored?.posterUri || null,
              mediaStatus: republished.mediaStatus,
            },
            callbacks
          );
          return;
        }
      } catch (republishError) {
        console.log("KRISTO_UPLOAD_PUBLISH_RECOVERY_FAILED", {
          jobId,
          message: String((republishError as any)?.message || republishError || "unknown"),
        });
      }
    }

    if (hasUploadedVideoUrl(stored, uploadedVideoUrl)) {
      const recovered = await recoverFalseUploadFailure(jobId, job, {
        reason: message,
        stored,
        videoUrl: recoveredVideoUrl,
        posterUri: publishPosterUri || posterPublicUrl || stored?.posterUri || null,
        callbacks,
      });
      if (recovered) return;
    }

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
      if (hasUploadedVideoUrl(stored, uploadedVideoUrl)) {
        const recovered = await recoverFalseUploadFailure(jobId, job, {
          reason: message,
          stored,
          videoUrl: recoveredVideoUrl,
          posterUri: publishPosterUri || posterPublicUrl || stored?.posterUri || null,
          callbacks,
        });
        if (recovered) return;
      }

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
    console.log("KRISTO_UPLOAD_STATUS_MARK_FAILED", { jobId, message, title: job.title });
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

  void (async () => {
    await createMediaUploadJob({
      jobId,
      title: job.title,
      caption: job.caption,
      fileUri: job.fileUri,
      localPosterUri: job.localPosterUri,
      fileName: job.fileName,
      churchId: job.churchId,
      userId: job.userId,
      role: job.role,
      durationMs: job.durationMs,
      resumableMode: "chunk",
      chunkSessionId: jobId,
    });
    launchMediaVideoUpload({ ...job, jobId }, jobId, callbacks);
  })();

  return jobId;
}

export function startMediaVideoUpload(job: MediaVideoUploadJob, callbacks: MediaVideoUploadCallbacks = {}) {
  return enqueueMediaVideoUpload(job, callbacks);
}

export async function retryMediaUploadJob(jobId: string, opts?: { manual?: boolean }) {
  const stored = await getMediaUploadJob(jobId);
  if (!stored) return false;
  const publishedFeedId = String(stored.backendFeedId || "").trim();
  if (publishedFeedId) {
    await patchMediaUploadJob(jobId, {
      phase: "processing",
      uploadProgress: 100,
      error: "",
    });
    console.log("KRISTO_UPLOAD_PUBLISH_ALREADY_CONFIRMED", {
      jobId,
      backendFeedId: publishedFeedId,
      reason: "retry-skipped-reupload",
    });
    return true;
  }
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

  for (const job of jobs) {
    const backendFeedId = String(job.backendFeedId || "").trim();
    if (!backendFeedId || job.phase === "ready") continue;
    if (job.phase === "failed" || job.phase === "paused" || job.phase === "uploading") {
      await patchMediaUploadJob(job.jobId, {
        phase: "processing",
        uploadProgress: 100,
        error: "",
      });
      console.log("KRISTO_UPLOAD_PUBLISH_ALREADY_CONFIRMED", {
        jobId: job.jobId,
        backendFeedId,
        reason: "startup-reconcile-published-job",
      });
    }
  }

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
    void removeMediaUploadJob(jobId).then((removed) => {
      if (removed) {
        console.log("KRISTO_OPTIMISTIC_UPLOAD_CLEARED", { jobId, reason: "media-upload-ready" });
      }
    });
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
        console.log("KRISTO_OPTIMISTIC_UPLOAD_CLEARED", {
          jobId: job.jobId,
          tempPostId: job.tempPostId,
          backendFeedId,
          reason: "optimistic-feed-row-removed",
        });
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
