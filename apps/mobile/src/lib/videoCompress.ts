import { NativeModules, Platform, TurboModuleRegistry } from "react-native";
import { probeMp4FaststartFromLocalUri } from "@/src/lib/mp4FaststartProbeLocal";

export type VideoCompressResult = {
  uri: string;
  originalBytes: number;
  compressedBytes: number;
  skipped: boolean;
  reason?: string;
  width?: number | null;
  height?: number | null;
  durationSec?: number | null;
  mimeType?: string;
  feedExportApplied?: boolean;
  faststart: boolean;
  faststartPending: boolean;
  faststartReason: string | null;
  moovPositionHint?: string;
};

/** Skip remux/compress only for negligible clips. */
const MIN_COMPRESS_BYTES = 50 * 1024;

/** V1 feed export: 720p long edge, ~1 Mbps H.264 + AAC in MP4 container. */
const TARGET_MAX_SIZE = 720;
const TARGET_BITRATE = 1_000_000;
const TARGET_KEYFRAME_INTERVAL_SEC = 2;
const MIN_FILE_SIZE_MB_FOR_COMPRESS = 0.15;
const FEED_EXPORT_MIME = "video/mp4";
/** Require at least 10% smaller output before replacing the original upload. */
const MIN_COMPRESS_SAVINGS_RATIO = 0.1;

function meetsCompressSavingsThreshold(originalBytes: number, compressedBytes: number) {
  if (originalBytes <= 0) return compressedBytes > 0;
  const maxAllowedBytes = Math.floor(originalBytes * (1 - MIN_COMPRESS_SAVINGS_RATIO));
  return compressedBytes > 0 && compressedBytes <= maxAllowedBytes;
}

export type VideoCompressOptions = {
  durationMs?: number;
  onCompressProgress?: (percent: number) => void;
};

function reportCompressProgress(
  onCompressProgress: VideoCompressOptions["onCompressProgress"],
  pct: number,
  lastLogged?: { value: number }
) {
  const rounded = Math.max(0, Math.min(100, Math.round(pct)));
  if (rounded <= 0) return;

  onCompressProgress?.(rounded);
  const shouldLog =
    rounded === 100 ||
    lastLogged === undefined ||
    Math.abs(rounded - lastLogged.value) >= 5;
  if (shouldLog) {
    console.log("KRISTO_VIDEO_COMPRESS_PROGRESS", { progress: rounded });
    if (lastLogged) lastLogged.value = rounded;
  }
}

function isCompressorNativeLinked(): boolean {
  if (Boolean((NativeModules as Record<string, unknown>).Compressor)) {
    return true;
  }
  if (!Boolean((globalThis as any).__turboModuleProxy)) {
    return false;
  }
  try {
    return Boolean(TurboModuleRegistry.get("Compressor"));
  } catch {
    return false;
  }
}

async function resolveFileSize(uri: string): Promise<number> {
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

async function probeVideoDimensions(
  uri: string
): Promise<{ width: number | null; height: number | null }> {
  try {
    const VideoThumbnails = await import("expo-video-thumbnails");
    const thumb = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 0,
      quality: 0.2,
    });
    return {
      width: Number(thumb?.width || 0) > 0 ? Number(thumb.width) : null,
      height: Number(thumb?.height || 0) > 0 ? Number(thumb.height) : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

function logUploadCompressResult(params: {
  originalBytes: number;
  compressedBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  mimeType: string;
  skipped: boolean;
  reason?: string;
  faststart: boolean;
}) {
  console.log("KRISTO_VIDEO_UPLOAD_COMPRESS_RESULT", {
    originalBytes: params.originalBytes,
    compressedBytes: params.compressedBytes,
    width: params.width,
    height: params.height,
    duration: params.durationSec,
    mimeType: params.mimeType,
    skipped: params.skipped,
    reason: params.reason || null,
    faststart: params.faststart,
  });
}

type FaststartVerifyPhase =
  | "post-compress"
  | "compress-skipped"
  | "compress-rejected"
  | "compress-failed"
  | "missing-uri";

async function verifyLocalFaststart(
  uri: string,
  phase: FaststartVerifyPhase
): Promise<Pick<VideoCompressResult, "faststart" | "faststartPending" | "faststartReason" | "moovPositionHint">> {
  console.log("KRISTO_VIDEO_FASTSTART_VERIFY_START", {
    uri: String(uri || "").trim(),
    phase,
  });

  const probe = await probeMp4FaststartFromLocalUri(uri);

  if (probe.hasFastStart) {
    console.log("KRISTO_VIDEO_FASTSTART_VERIFY_RESULT", {
      hasFastStart: true,
      moovPositionHint: probe.moovPositionHint,
      fileBytes: probe.fileBytes,
      phase,
    });
    return {
      faststart: true,
      faststartPending: false,
      faststartReason: null,
      moovPositionHint: probe.moovPositionHint,
    };
  }

  const faststartReason =
    probe.moovPositionHint === "unknown" || probe.moovPositionHint === "not-mp4"
      ? "mobile-faststart-unknown"
      : "mobile-faststart-verify-failed";

  console.log("KRISTO_VIDEO_FASTSTART_VERIFY_FAILED", {
    hasFastStart: false,
    moovPositionHint: probe.moovPositionHint,
    fileBytes: probe.fileBytes,
    phase,
    faststartReason,
  });

  return {
    faststart: false,
    faststartPending: true,
    faststartReason,
    moovPositionHint: probe.moovPositionHint,
  };
}

async function withVerifiedFaststart<T extends Omit<VideoCompressResult, "faststart" | "faststartPending" | "faststartReason" | "moovPositionHint">>(
  result: T,
  phase: FaststartVerifyPhase
): Promise<VideoCompressResult> {
  const verified = await verifyLocalFaststart(result.uri, phase);
  return { ...result, ...verified };
}

export async function compressVideoForUpload(
  sourceUri: string,
  opts?: VideoCompressOptions
): Promise<VideoCompressResult> {
  const cleanUri = String(sourceUri || "").trim();
  const originalBytes = await resolveFileSize(cleanUri);
  const durationSec =
    Number(opts?.durationMs || 0) > 0
      ? Math.round((Number(opts?.durationMs) / 1000) * 100) / 100
      : null;

  console.log("KRISTO_VIDEO_COMPRESS_START", {
    originalBytes,
    sourceUri: cleanUri,
    platform: Platform.OS,
    targetMaxSize: TARGET_MAX_SIZE,
    targetBitrate: TARGET_BITRATE,
    targetKeyframeIntervalSec: TARGET_KEYFRAME_INTERVAL_SEC,
    outputMime: FEED_EXPORT_MIME,
  });

  if (!cleanUri) {
    const base = {
      uri: cleanUri,
      originalBytes: 0,
      compressedBytes: 0,
      skipped: true,
      reason: "missing-uri",
      durationSec,
      mimeType: FEED_EXPORT_MIME,
    };
    logUploadCompressResult({
      originalBytes: 0,
      compressedBytes: 0,
      width: null,
      height: null,
      durationSec,
      mimeType: FEED_EXPORT_MIME,
      skipped: true,
      reason: "missing-uri",
      faststart: false,
    });
    return withVerifiedFaststart(base, "missing-uri");
  }

  if (originalBytes > 0 && originalBytes < MIN_COMPRESS_BYTES) {
    opts?.onCompressProgress?.(100);
    const dims = await probeVideoDimensions(cleanUri);
    logUploadCompressResult({
      originalBytes,
      compressedBytes: originalBytes,
      width: dims.width,
      height: dims.height,
      durationSec,
      mimeType: FEED_EXPORT_MIME,
      skipped: true,
      reason: "too-small",
      faststart: false,
    });
    return withVerifiedFaststart(
      {
        uri: cleanUri,
        originalBytes,
        compressedBytes: originalBytes,
        skipped: true,
        reason: "too-small",
        width: dims.width,
        height: dims.height,
        durationSec,
        mimeType: FEED_EXPORT_MIME,
      },
      "compress-skipped"
    );
  }

  if (!isCompressorNativeLinked()) {
    opts?.onCompressProgress?.(100);
    const dims = await probeVideoDimensions(cleanUri);
    logUploadCompressResult({
      originalBytes,
      compressedBytes: originalBytes,
      width: dims.width,
      height: dims.height,
      durationSec,
      mimeType: FEED_EXPORT_MIME,
      skipped: true,
      reason: "native-not-linked",
      faststart: false,
    });
    return withVerifiedFaststart(
      {
        uri: cleanUri,
        originalBytes,
        compressedBytes: originalBytes,
        skipped: true,
        reason: "native-not-linked",
        width: dims.width,
        height: dims.height,
        durationSec,
        mimeType: FEED_EXPORT_MIME,
      },
      "compress-skipped"
    );
  }

  try {
    const { Video } = await import("react-native-compressor");
    if (typeof Video?.compress !== "function") {
      throw new Error("Video.compress unavailable");
    }

    console.log("KRISTO_VIDEO_COMPRESS_READY", {
      originalBytes,
      maxSize: TARGET_MAX_SIZE,
      bitrate: TARGET_BITRATE,
      compressionMethod: "manual",
      stripAudio: false,
      output: FEED_EXPORT_MIME,
      codec: "h264+aac",
      keyframeIntervalSecTarget: TARGET_KEYFRAME_INTERVAL_SEC,
    });

    const compressLogState = { value: -1 };

    const compressedUri = await Video.compress(
      cleanUri,
      {
        compressionMethod: "manual",
        maxSize: TARGET_MAX_SIZE,
        bitrate: TARGET_BITRATE,
        minimumFileSizeForCompress: MIN_FILE_SIZE_MB_FOR_COMPRESS,
        stripAudio: false,
      },
      (progress) => {
        const pct = Math.round(Number(progress || 0) * 100);
        reportCompressProgress(opts?.onCompressProgress, pct, compressLogState);
      }
    );

    reportCompressProgress(opts?.onCompressProgress, 100, compressLogState);

    const outputUri = String(compressedUri || "").trim() || cleanUri;
    const compressedBytes = await resolveFileSize(outputUri);

    if (!outputUri || compressedBytes <= 0) {
      throw new Error("Compression returned empty output.");
    }

    const dims = await probeVideoDimensions(outputUri);

    if (!meetsCompressSavingsThreshold(originalBytes, compressedBytes)) {
      const originalDims = await probeVideoDimensions(cleanUri);
      const savingsRatio =
        originalBytes > 0 ? (originalBytes - compressedBytes) / originalBytes : 0;

      console.log("KRISTO_VIDEO_COMPRESS_REJECTED", {
        originalBytes,
        compressedBytes,
        savingsRatio: Math.round(savingsRatio * 1000) / 1000,
        requiredMinSavingsRatio: MIN_COMPRESS_SAVINGS_RATIO,
        reason:
          compressedBytes >= originalBytes
            ? "compressed-larger-than-original"
            : "insufficient-savings",
        uploadUri: cleanUri,
      });

      logUploadCompressResult({
        originalBytes,
        compressedBytes: originalBytes,
        width: originalDims.width,
        height: originalDims.height,
        durationSec,
        mimeType: FEED_EXPORT_MIME,
        skipped: true,
        reason: "insufficient-savings",
        faststart: false,
      });

      return withVerifiedFaststart(
        {
          uri: cleanUri,
          originalBytes,
          compressedBytes: originalBytes,
          skipped: true,
          reason: "insufficient-savings",
          width: originalDims.width,
          height: originalDims.height,
          durationSec,
          mimeType: FEED_EXPORT_MIME,
        },
        "compress-rejected"
      );
    }

    logUploadCompressResult({
      originalBytes,
      compressedBytes,
      width: dims.width,
      height: dims.height,
      durationSec,
      mimeType: FEED_EXPORT_MIME,
      skipped: false,
      faststart: false,
    });

    console.log("KRISTO_VIDEO_COMPRESS_DONE", {
      originalBytes,
      compressedBytes,
      outputUri,
      feedFriendly: true,
      maxSize: TARGET_MAX_SIZE,
      bitrate: TARGET_BITRATE,
      keyframeIntervalSecTarget: TARGET_KEYFRAME_INTERVAL_SEC,
    });

    return withVerifiedFaststart(
      {
        uri: outputUri,
        originalBytes,
        compressedBytes,
        skipped: false,
        feedExportApplied: true,
        width: dims.width,
        height: dims.height,
        durationSec,
        mimeType: FEED_EXPORT_MIME,
      },
      "post-compress"
    );
  } catch (error) {
    const message = String((error as any)?.message || error || "unknown");
    const dims = await probeVideoDimensions(cleanUri);
    console.log("KRISTO_VIDEO_COMPRESS_FAILED", {
      message,
      originalBytes,
      platform: Platform.OS,
    });
    logUploadCompressResult({
      originalBytes,
      compressedBytes: originalBytes,
      width: dims.width,
      height: dims.height,
      durationSec,
      mimeType: FEED_EXPORT_MIME,
      skipped: true,
      reason: "compress-failed",
      faststart: false,
    });
    return withVerifiedFaststart(
      {
        uri: cleanUri,
        originalBytes,
        compressedBytes: originalBytes,
        skipped: true,
        reason: "compress-failed",
        width: dims.width,
        height: dims.height,
        durationSec,
        mimeType: FEED_EXPORT_MIME,
      },
      "compress-failed"
    );
  }
}
