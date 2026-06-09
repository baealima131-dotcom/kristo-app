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

const GENERATE_TIMEOUT_MS = 45000;
const MIN_CAPTURE_MS = 500;

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
}): Promise<string> {
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

  const captureTimes = [
    computePosterCaptureTimeMs(params.durationMs),
    1000,
    500,
  ];
  const uniqueCaptureTimes = [...new Set(captureTimes.map((ms) => Math.max(MIN_CAPTURE_MS, ms)))];

  const promise = withPreviewTimeout(
    (async () => {
      try {
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
    GENERATE_TIMEOUT_MS,
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
