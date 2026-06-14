import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  fileNameFromUri,
  guessPosterContentType,
  resolveUploadFileSize,
  uploadPosterToStorageWithRetry,
} from "@/src/lib/churchVideoUpload";
import {
  getCachedMediaPoster,
  peekCachedMediaPoster,
  rememberMediaPoster,
  resolveCachedMediaPoster,
} from "@/src/lib/mediaPosterCache";
import { withPreviewTimeout } from "@/src/lib/videoGridThumbnail";
import {
  computeHomeFeedPosterCandidateTimesMs,
  computeHomeFeedPosterCaptureTimeMs,
  selectBestPosterFrameCandidate,
  selectDiverseUploadStudioCovers,
  type PosterFrameCandidate,
  type UploadStudioCoverBatchResult,
} from "@/src/lib/homeFeedPosterFrameQuality";
import { shouldDeferBackgroundMediaJobs } from "@/src/lib/homeFeedWatchPlaybackPriority";

const GENERATE_TIMEOUT_MS = 45000;
const HOME_FEED_GENERATE_TIMEOUT_MS = 70000;
const MIN_CAPTURE_MS = 500;
/** Home Feed default frame grab — 7.5 seconds into the video. */
export const HOME_FEED_POSTER_CAPTURE_MS = 7500;

export {
  computeHomeFeedPosterCandidateTimesMs,
  computeHomeFeedPosterCaptureTimeMs,
} from "@/src/lib/homeFeedPosterFrameQuality";

const inflight = new Map<string, Promise<string>>();

export function resolveVideoDurationMs(item: any): number | undefined {
  const durationMs = Number(item?.durationMs || 0);
  if (Number.isFinite(durationMs) && durationMs > 0) return Math.round(durationMs);

  const durationSec = Number(item?.durationSec || item?.duration || 0);
  if (Number.isFinite(durationSec) && durationSec > 0) return Math.round(durationSec * 1000);

  return undefined;
}

/** Capture at ~10% of duration (30s → 3s, 60s → 6s, 10m → 1m). */
export function computePosterCaptureTimeMs(durationMs?: number): number {
  const totalMs =
    Number(durationMs || 0) > 0 ? Math.round(Number(durationMs)) : 10_000;
  const targetMs = Math.round(totalMs * 0.1);
  const maxMs = Math.max(MIN_CAPTURE_MS, totalMs - 250);
  return Math.min(Math.max(targetMs, MIN_CAPTURE_MS), maxMs);
}

function uniqueSortedCaptureTimes(times: number[]) {
  return [...new Set(times.map((ms) => Math.max(MIN_CAPTURE_MS, Math.round(ms))))].sort(
    (a, b) => a - b
  );
}

/** Evenly spaced capture points for upload-studio cover grids (default 10). */
export function computeUploadStudioCoverTimesMs(
  durationMs?: number,
  count = 10,
  batchOffset = 0
): number[] {
  const totalMs =
    Number(durationMs || 0) > 0 ? Math.round(Number(durationMs)) : 45_000;
  const maxMs = Math.max(MIN_CAPTURE_MS, totalMs - 250);
  const phase = ((batchOffset % 7) + 1) * 0.028;
  const times: number[] = [];

  for (let i = 0; i < count; i += 1) {
    let ratio = (i + 0.5) / count + phase;
    ratio = ratio % 1;
    if (ratio < 0.05) ratio += 0.05;
    if (ratio > 0.95) ratio -= 0.05;
    times.push(Math.min(Math.max(Math.round(totalMs * ratio), MIN_CAPTURE_MS), maxMs));
  }

  return uniqueSortedCaptureTimes(times);
}

/** Extra probe timestamps — merges home-feed anchors with a phased grid for diversity. */
export function computeUploadStudioProbeTimesMs(
  durationMs?: number,
  probeCount = 24,
  batchOffset = 0
): number[] {
  const homeTimes = computeHomeFeedPosterCandidateTimesMs(durationMs);
  const gridTimes = computeUploadStudioCoverTimesMs(durationMs, probeCount, batchOffset);
  return uniqueSortedCaptureTimes([...homeTimes, ...gridTimes]);
}

export type UploadStudioCoverOptionsResult = UploadStudioCoverBatchResult;

export async function generateUploadStudioCoverOptions(params: {
  videoUrl: string;
  durationMs?: number;
  count?: number;
  batchOffset?: number;
}): Promise<UploadStudioCoverOptionsResult> {
  if (shouldDeferBackgroundMediaJobs()) return { covers: [], bestIndex: 0 };

  const videoUrl = String(params.videoUrl || "").trim();
  if (!videoUrl) return { covers: [], bestIndex: 0 };

  const count = Math.max(1, Math.min(12, Number(params.count || 10)));
  const probeCount = Math.max(22, count * 2 + 4);
  const times = computeUploadStudioProbeTimesMs(
    params.durationMs,
    probeCount,
    params.batchOffset ?? 0
  );
  const candidates = await capturePosterFrameCandidates(videoUrl, times);
  if (!candidates.length) return { covers: [], bestIndex: 0 };

  return selectDiverseUploadStudioCovers(candidates, params.durationMs, count);
}

/** Best-effort cleanup of temp thumbnail files from upload-studio cover batches. */
export async function releaseUploadStudioCoverUris(uris: string[]): Promise<void> {
  const unique = [...new Set(uris.map((uri) => String(uri || "").trim()).filter(Boolean))];
  if (!unique.length) return;

  try {
    const FileSystem = await import("expo-file-system/legacy");
    await Promise.all(
      unique.map((uri) => {
        if (!uri.startsWith("file://")) return Promise.resolve();
        return FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      })
    );
  } catch {
    // Non-fatal — OS will reclaim temp files eventually.
  }
}

async function capturePosterFrameCandidates(
  videoUrl: string,
  captureTimesMs: number[]
): Promise<PosterFrameCandidate[]> {
  const VideoThumbnails = await import("expo-video-thumbnails");
  const captured: PosterFrameCandidate[] = [];

  await Promise.all(
    captureTimesMs.map(async (captureTimeMs) => {
      try {
        const result = await VideoThumbnails.getThumbnailAsync(videoUrl, {
          time: captureTimeMs,
          quality: 0.82,
        });
        const uri = String(result?.uri || "").trim();
        if (!uri) return;
        captured.push({
          captureTimeMs,
          uri,
          width: Number(result?.width || 0),
          height: Number(result?.height || 0),
        });
      } catch (attemptError) {
        console.log("KRISTO_MEDIA_VIDEO_POSTER_CAPTURE_RETRY", {
          videoUrl: normalizeVideoKey(videoUrl),
          captureTimeMs,
          error:
            attemptError instanceof Error ? attemptError.message : String(attemptError),
        });
      }
    })
  );

  return captured.sort((a, b) => a.captureTimeMs - b.captureTimeMs);
}

async function generateHomeFeedPosterFrame(params: {
  postId: string;
  videoUrl: string;
  durationMs?: number;
}): Promise<string> {
  const candidateTimes = computeHomeFeedPosterCandidateTimesMs(params.durationMs);
  const candidates = await capturePosterFrameCandidates(params.videoUrl, candidateTimes);
  if (!candidates.length) return "";

  const best = await selectBestPosterFrameCandidate(candidates);
  if (!best) return "";

  const persisted = await rememberMediaPoster({
    postId: params.postId,
    videoUrl: params.videoUrl,
    posterUri: best.candidate.uri,
    source: "generated",
    persistFile: Boolean(params.postId),
    captureTimeMs: best.breakdown.captureTimeMs,
  });

  console.log("KRISTO_MEDIA_VIDEO_POSTER_GENERATED", {
    postId: params.postId || null,
    videoUrl: normalizeVideoKey(params.videoUrl),
    captureTimeMs: best.breakdown.captureTimeMs,
    durationMs: params.durationMs ?? null,
    qualityScore: Number(best.breakdown.total.toFixed(3)),
    posterUri: persisted,
    candidateCount: candidates.length,
  });

  return persisted;
}

function normalizeVideoKey(videoUrl: string) {
  return String(videoUrl || "").trim().split("?")[0];
}

function inflightKey(postId: string, videoUrl: string) {
  return `${String(postId || "").trim()}:${normalizeVideoKey(videoUrl)}`;
}

export async function generateVideoPosterFrame(params: {
  postId?: string;
  videoUrl: string;
  durationMs?: number;
  mode?: "home-feed" | "default";
}): Promise<string> {
  if (shouldDeferBackgroundMediaJobs()) return "";

  const videoUrl = String(params.videoUrl || "").trim();
  const postId = String(params.postId || "").trim();
  if (!videoUrl) return "";

  if (postId || videoUrl) {
    const cached = resolveCachedMediaPoster(postId, videoUrl);
    if (cached) return cached;
  }

  const pendingKey = inflightKey(postId, videoUrl);
  const pending = inflight.get(pendingKey);
  if (pending) return pending;

  const isHomeFeed = params.mode === "home-feed";
  const timeoutMs = isHomeFeed ? HOME_FEED_GENERATE_TIMEOUT_MS : GENERATE_TIMEOUT_MS;

  const promise = withPreviewTimeout(
    (async () => {
      try {
        if (isHomeFeed) {
          return generateHomeFeedPosterFrame({
            postId,
            videoUrl,
            durationMs: params.durationMs,
          });
        }

        const primaryCapture = computePosterCaptureTimeMs(params.durationMs);
        const captureTimes = [primaryCapture, 1000, 500];
        const uniqueCaptureTimes = [
          ...new Set(captureTimes.map((ms) => Math.max(MIN_CAPTURE_MS, ms))),
        ];
        const VideoThumbnails = await import("expo-video-thumbnails");

        for (const captureTimeMs of uniqueCaptureTimes) {
          try {
            const result = await VideoThumbnails.getThumbnailAsync(videoUrl, {
              time: captureTimeMs,
              quality: 0.72,
            });
            const uri = String(result?.uri || "").trim();
            if (!uri) continue;

            const persisted = await rememberMediaPoster({
              postId,
              videoUrl,
              posterUri: uri,
              source: "generated",
              persistFile: Boolean(postId),
              captureTimeMs,
            });
            console.log("KRISTO_MEDIA_VIDEO_POSTER_GENERATED", {
              postId: postId || null,
              videoUrl: normalizeVideoKey(videoUrl),
              captureTimeMs,
              durationMs: params.durationMs ?? null,
              posterUri: persisted,
            });
            return persisted;
          } catch (attemptError) {
            console.log("KRISTO_MEDIA_VIDEO_POSTER_CAPTURE_RETRY", {
              postId: postId || null,
              videoUrl: normalizeVideoKey(videoUrl),
              captureTimeMs,
              error:
                attemptError instanceof Error ? attemptError.message : String(attemptError),
            });
          }
        }

        return "";
      } catch (error) {
        console.log("KRISTO_MEDIA_VIDEO_POSTER_GENERATE_FAILED", {
          postId: postId || null,
          videoUrl: normalizeVideoKey(videoUrl),
          error: error instanceof Error ? error.message : String(error),
        });
        return "";
      } finally {
        inflight.delete(pendingKey);
      }
    })(),
    timeoutMs,
    ""
  );

  inflight.set(pendingKey, promise);
  return promise;
}

export async function persistMediaVideoPosterToFeed(params: {
  postId: string;
  videoUrl: string;
  localPosterUri: string;
}): Promise<string | null> {
  const postId = String(params.postId || "").trim();
  const videoUrl = normalizeVideoKey(params.videoUrl);
  const localPosterUri = String(params.localPosterUri || "").trim();
  if (!postId || !videoUrl || !localPosterUri) return null;

  const cached = peekCachedMediaPoster(postId, videoUrl);
  if (cached && !cached.startsWith("file://")) {
    return cached;
  }

  try {
    const posterSize = await resolveUploadFileSize(localPosterUri);
    if (posterSize <= 0) return null;

    const posterFileName = fileNameFromUri(localPosterUri, `grid-poster-${Date.now()}.jpg`);
    const uploaded = await uploadPosterToStorageWithRetry({
      fileUri: localPosterUri,
      fileName: posterFileName,
      contentType: guessPosterContentType(posterFileName),
      fileSize: posterSize,
      headers: getKristoHeaders(),
    });

    const remotePosterUri = String(uploaded.publicUrl || uploaded.videoUrl || "").trim();
    if (!remotePosterUri) return null;

    const res: any = await apiPost(
      "/api/church/feed",
      {
        action: "persist_video_poster",
        postId,
        videoUrl,
        posterUri: remotePosterUri,
        thumbnailUri: remotePosterUri,
        videoPosterUri: remotePosterUri,
      },
      { headers: getKristoHeaders() }
    );

    if (res?.ok === false) {
      console.log("KRISTO_MEDIA_VIDEO_POSTER_PERSIST_FAILED", {
        postId,
        videoUrl,
        error: String(res?.error || "unknown"),
      });
    }

    await rememberMediaPoster({
      postId,
      videoUrl,
      posterUri: remotePosterUri,
      source: "remote",
      persistFile: false,
    });

    console.log("KRISTO_MEDIA_VIDEO_POSTER_PERSISTED", {
      postId,
      videoUrl,
      remotePosterUri,
    });

    return remotePosterUri;
  } catch (error) {
    console.log("KRISTO_MEDIA_VIDEO_POSTER_PERSIST_ERROR", {
      postId,
      videoUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function ensureMediaVideoPosterFrame(params: {
  postId?: string;
  videoUrl: string;
  durationMs?: number;
  persistToFeed?: boolean;
}): Promise<string> {
  if (shouldDeferBackgroundMediaJobs()) return "";

  const videoUrl = String(params.videoUrl || "").trim();
  const postId = String(params.postId || "").trim();
  if (!videoUrl) return "";

  if (postId) {
    const cached = await getCachedMediaPoster(postId, videoUrl);
    if (cached) return cached;
  }

  const localUri = await generateVideoPosterFrame({
    postId,
    videoUrl,
    durationMs: params.durationMs,
  });
  if (!localUri) return "";

  if (params.persistToFeed !== false && postId) {
    const sourceUri = localUri.startsWith("file://")
      ? localUri
      : (await peekCachedMediaPoster(postId, videoUrl)) || localUri;
    if (sourceUri.startsWith("file://")) {
      const remote = await persistMediaVideoPosterToFeed({
        postId,
        videoUrl,
        localPosterUri: sourceUri,
      });
      if (remote) return remote;
    }
  }

  return localUri;
}
