import * as ImageManipulator from "expo-image-manipulator";

const MIN_CAPTURE_MS = 500;
const SHORT_VIDEO_THRESHOLD_MS = 12_000;
const LONG_VIDEO_CAPTURE_MS = [2000, 7500, 12000] as const;
const SHORT_VIDEO_RATIOS = [0.2, 0.5, 0.8] as const;
const ANALYSIS_WIDTH = 180;

export type PosterFrameCandidate = {
  captureTimeMs: number;
  uri: string;
  width: number;
  height: number;
};

export type PosterFrameQualityBreakdown = {
  captureTimeMs: number;
  brightness: number;
  sharpness: number;
  motionBlurPenalty: number;
  total: number;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function uniqueSortedTimes(times: number[]) {
  return [...new Set(times.map((ms) => Math.max(MIN_CAPTURE_MS, Math.round(ms))))].sort(
    (a, b) => a - b
  );
}

/** Home Feed candidate timestamps — 2s/7.5s/12s or 20%/50%/80% for short clips. */
export function computeHomeFeedPosterCandidateTimesMs(durationMs?: number): number[] {
  const totalMs =
    Number(durationMs || 0) > 0 ? Math.round(Number(durationMs)) : 12_000;
  const maxMs = Math.max(MIN_CAPTURE_MS, totalMs - 250);

  if (totalMs < SHORT_VIDEO_THRESHOLD_MS) {
    return uniqueSortedTimes(
      SHORT_VIDEO_RATIOS.map((ratio) =>
        Math.min(Math.round(totalMs * ratio), maxMs)
      )
    );
  }

  return uniqueSortedTimes(
    LONG_VIDEO_CAPTURE_MS.map((ms) => Math.min(ms, maxMs))
  );
}

/** Primary capture time for diagnostics (middle candidate). */
export function computeHomeFeedPosterCaptureTimeMs(durationMs?: number): number {
  const candidates = computeHomeFeedPosterCandidateTimesMs(durationMs);
  if (!candidates.length) return 7500;
  return candidates[Math.floor(candidates.length / 2)] ?? candidates[0];
}

async function fileByteSize(uri: string): Promise<number> {
  try {
    const FileSystem = await import("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(uri, { size: true } as any);
    return Number((info as { size?: number })?.size || 0);
  } catch {
    return 0;
  }
}

async function normalizedJpegSize(uri: string, width: number, quality: number): Promise<number> {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width } }],
      { compress: quality, format: ImageManipulator.SaveFormat.JPEG }
    );
    return fileByteSize(result.uri);
  } catch {
    return 0;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob ? globalThis.atob(base64) : "";
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Approximate luminance from JPEG entropy bytes — avoids full decode. */
async function estimateBrightnessScore(uri: string): Promise<number> {
  try {
    const tiny = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 32 } }],
      { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG }
    );
    const FileSystem = await import("expo-file-system/legacy");
    const base64 = await FileSystem.readAsStringAsync(tiny.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToBytes(base64);
    if (bytes.length < 64) return 0.5;

    const start = Math.min(Math.floor(bytes.length * 0.08), 512);
    const end = Math.max(start + 1, Math.floor(bytes.length * 0.92));
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += 4) {
      sum += bytes[i];
      count += 1;
    }
    const avg = count ? sum / count : 128;
    const normalized = avg / 255;

    if (normalized < 0.14) return clamp(normalized / 0.14) * 0.25;
    if (normalized > 0.9) return clamp((1 - normalized) / 0.1) * 0.25;
    return clamp(1 - Math.abs(normalized - 0.48) * 1.35);
  } catch {
    return 0.45;
  }
}

/** High-frequency energy proxy — sharp frames compress larger at high quality. */
async function estimateSharpnessScore(uri: string): Promise<number> {
  const [lowBytes, highBytes] = await Promise.all([
    normalizedJpegSize(uri, ANALYSIS_WIDTH, 0.22),
    normalizedJpegSize(uri, ANALYSIS_WIDTH, 0.94),
  ]);
  if (lowBytes <= 0 || highBytes <= 0) return 0;
  const ratio = highBytes / Math.max(lowBytes, 1);
  return clamp((ratio - 1.05) / 3.2);
}

export async function scorePosterFrameCandidate(
  candidate: PosterFrameCandidate
): Promise<PosterFrameQualityBreakdown> {
  const [brightness, sharpness] = await Promise.all([
    estimateBrightnessScore(candidate.uri),
    estimateSharpnessScore(candidate.uri),
  ]);
  const motionBlurPenalty = 1 - sharpness;
  const total = brightness * 0.38 + sharpness * 0.62;

  return {
    captureTimeMs: candidate.captureTimeMs,
    brightness,
    sharpness,
    motionBlurPenalty,
    total: clamp(total),
  };
}

export async function selectBestPosterFrameCandidate(
  candidates: PosterFrameCandidate[]
): Promise<{ candidate: PosterFrameCandidate; breakdown: PosterFrameQualityBreakdown } | null> {
  if (!candidates.length) return null;

  const scored = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      breakdown: await scorePosterFrameCandidate(candidate),
    }))
  );

  scored.sort((a, b) => b.breakdown.total - a.breakdown.total);
  const best = scored[0];
  if (!best) return null;

  console.log("KRISTO_HOME_FEED_POSTER_QUALITY", {
    winnerCaptureTimeMs: best.breakdown.captureTimeMs,
    winnerScore: Number(best.breakdown.total.toFixed(3)),
    candidates: scored.map(({ candidate, breakdown }) => ({
      captureTimeMs: candidate.captureTimeMs,
      brightness: Number(breakdown.brightness.toFixed(3)),
      sharpness: Number(breakdown.sharpness.toFixed(3)),
      motionBlurPenalty: Number(breakdown.motionBlurPenalty.toFixed(3)),
      total: Number(breakdown.total.toFixed(3)),
    })),
  });

  return best;
}
