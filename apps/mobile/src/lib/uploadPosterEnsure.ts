import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";

// ANDROID_UPLOAD_POSTER_ENSURE_V1
// Videos were published with the branded placeholder when the picker cover was
// missing, empty or failed to upload. This resolves a real local poster (picker cover,
// else a frame generated from the local video), uploads it with a bounded number of
// attempts and reports the outcome explicitly. It never throws, so the video upload
// and its publish/duplicate guards continue unchanged when the poster cannot be saved.

export const UPLOAD_POSTER_MAX_ATTEMPTS = 3;
const UPLOAD_POSTER_RETRY_DELAY_MS = 1200;

export type UploadPosterEnsureDeps = {
  fileSize: (uri: string) => Promise<number>;
  generateFromVideo: (videoUri: string, timeMs: number) => Promise<string>;
  /** One upload attempt; resolves to the public poster URL. */
  uploadOnce: (posterUri: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, payload: Record<string, unknown>) => void;
};

export type UploadPosterEnsureResult =
  | {
      status: "uploaded";
      posterUrl: string;
      localPosterUri: string;
      source: "picker" | "generated";
      attempts: number;
    }
  | {
      status: "missing";
      reason: "no-local-poster" | "upload-failed";
      localPosterUri: string;
      source: "picker" | "generated" | null;
      attempts: number;
    };

/** A poster URL that can be shown as an image, or null for empty/placeholder values. */
export function realPosterUriOrNull(uri: unknown): string | null {
  const value = String(uri || "").trim();
  if (!value || isBrandedPosterUri(value)) return null;
  return value;
}

function isUsablePublicPosterUrl(uri: string): boolean {
  return /^https?:\/\//i.test(uri) && !isBrandedPosterUri(uri);
}

export function posterCaptureTimesMs(durationMs?: number): number[] {
  const duration = Number(durationMs || 0);
  const preferred = duration > 0 ? Math.min(1000, Math.floor(duration / 2)) : 1000;
  return [...new Set([preferred, 0])];
}

async function safeFileSize(deps: UploadPosterEnsureDeps, uri: string): Promise<number> {
  try {
    const size = Number(await deps.fileSize(uri));
    return Number.isFinite(size) && size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

async function resolveLocalPoster(
  input: { localPosterUri?: string; videoUri: string; durationMs?: number },
  deps: UploadPosterEnsureDeps
): Promise<{ uri: string; source: "picker" | "generated" } | null> {
  const log = deps.log || (() => {});
  const picker = String(input.localPosterUri || "").trim();
  if (picker) {
    if ((await safeFileSize(deps, picker)) > 0) return { uri: picker, source: "picker" };
    log("KRISTO_UPLOAD_POSTER_PICKER_INVALID", { localPosterUri: picker });
  }

  const videoUri = String(input.videoUri || "").trim();
  if (!videoUri) return null;

  for (const timeMs of posterCaptureTimesMs(input.durationMs)) {
    let generated = "";
    try {
      generated = String((await deps.generateFromVideo(videoUri, timeMs)) || "").trim();
    } catch (error) {
      log("KRISTO_UPLOAD_POSTER_GENERATE_ERROR", {
        timeMs,
        message: String((error as any)?.message || error || "unknown"),
      });
    }
    if (generated && (await safeFileSize(deps, generated)) > 0) {
      log("KRISTO_UPLOAD_POSTER_GENERATED", { timeMs, localPosterUri: generated });
      return { uri: generated, source: "generated" };
    }
  }

  return null;
}

export async function ensureUploadPoster(
  input: {
    localPosterUri?: string;
    videoUri: string;
    durationMs?: number;
    maxAttempts?: number;
  },
  deps: UploadPosterEnsureDeps
): Promise<UploadPosterEnsureResult> {
  const log = deps.log || (() => {});
  const sleep = deps.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxAttempts = Math.max(1, Math.floor(Number(input.maxAttempts || UPLOAD_POSTER_MAX_ATTEMPTS)));

  const local = await resolveLocalPoster(input, deps);
  if (!local) {
    log("KRISTO_UPLOAD_POSTER_MISSING", { reason: "no-local-poster", attempts: 0 });
    return { status: "missing", reason: "no-local-poster", localPosterUri: "", source: null, attempts: 0 };
  }

  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      const url = String((await deps.uploadOnce(local.uri)) || "").trim();
      if (isUsablePublicPosterUrl(url)) {
        log("KRISTO_UPLOAD_POSTER_SAVED", { source: local.source, attempts, posterUrl: url });
        return { status: "uploaded", posterUrl: url, localPosterUri: local.uri, source: local.source, attempts };
      }
      log("KRISTO_UPLOAD_POSTER_ATTEMPT_FAILED", { attempts, reason: "unusable-url" });
    } catch (error) {
      log("KRISTO_UPLOAD_POSTER_ATTEMPT_FAILED", {
        attempts,
        message: String((error as any)?.message || error || "unknown"),
      });
    }
    if (attempts < maxAttempts) await sleep(UPLOAD_POSTER_RETRY_DELAY_MS * attempts);
  }

  log("KRISTO_UPLOAD_POSTER_MISSING", { reason: "upload-failed", attempts, source: local.source });
  return {
    status: "missing",
    reason: "upload-failed",
    localPosterUri: local.uri,
    source: local.source,
    attempts,
  };
}
