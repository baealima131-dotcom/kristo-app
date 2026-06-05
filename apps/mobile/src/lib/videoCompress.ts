import { NativeModules, Platform, TurboModuleRegistry } from "react-native";

export type VideoCompressResult = {
  uri: string;
  originalBytes: number;
  compressedBytes: number;
  skipped: boolean;
  reason?: string;
};

/** Skip remux/compress for tiny clips (already negligible upload size). */
const MIN_COMPRESS_BYTES = 200 * 1024;

/** V1 iOS target: 720p long edge, ~800 kbps video (+ AAC audio). */
const TARGET_MAX_SIZE = 720;
const TARGET_BITRATE = 800_000;
const MIN_FILE_SIZE_MB_FOR_COMPRESS = 0.15;

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

function compressionRatio(originalBytes: number, compressedBytes: number) {
  if (originalBytes <= 0 || compressedBytes <= 0) return null;
  return Number((compressedBytes / originalBytes).toFixed(3));
}

export async function compressVideoForUpload(sourceUri: string): Promise<VideoCompressResult> {
  const cleanUri = String(sourceUri || "").trim();
  const originalBytes = await resolveFileSize(cleanUri);

  console.log("KRISTO_VIDEO_COMPRESS_START", {
    originalBytes,
    sourceUri: cleanUri,
    platform: Platform.OS,
  });

  if (!cleanUri) {
    return {
      uri: cleanUri,
      originalBytes: 0,
      compressedBytes: 0,
      skipped: true,
      reason: "missing-uri",
    };
  }

  if (originalBytes > 0 && originalBytes < MIN_COMPRESS_BYTES) {
    console.log("KRISTO_VIDEO_COMPRESS_SKIPPED", {
      reason: "too-small",
      originalBytes,
      compressedBytes: originalBytes,
    });
    return {
      uri: cleanUri,
      originalBytes,
      compressedBytes: originalBytes,
      skipped: true,
      reason: "too-small",
    };
  }

  if (!isCompressorNativeLinked()) {
    console.log("KRISTO_VIDEO_COMPRESS_FAILED", {
      reason: "native-not-linked",
      originalBytes,
      message: "react-native-compressor native module missing — rebuild iOS dev client after pod install",
    });
    console.log("KRISTO_VIDEO_COMPRESS_SKIPPED", {
      reason: "native-not-linked",
      originalBytes,
      compressedBytes: originalBytes,
    });
    return {
      uri: cleanUri,
      originalBytes,
      compressedBytes: originalBytes,
      skipped: true,
      reason: "native-not-linked",
    };
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
      output: "mp4",
    });

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
        if (__DEV__ && pct > 0 && pct % 25 === 0) {
          console.log("KRISTO_VIDEO_COMPRESS_PROGRESS", { progress: pct });
        }
      }
    );

    const outputUri = String(compressedUri || "").trim() || cleanUri;
    const compressedBytes = await resolveFileSize(outputUri);

    if (!outputUri || compressedBytes <= 0) {
      throw new Error("Compression returned empty output.");
    }

    const ratio = compressionRatio(originalBytes, compressedBytes);

    console.log("KRISTO_VIDEO_COMPRESS_DONE", {
      originalBytes,
      compressedBytes,
      ratio,
      savedBytes: Math.max(0, originalBytes - compressedBytes),
      outputUri,
    });

    return {
      uri: outputUri,
      originalBytes,
      compressedBytes,
      skipped: false,
    };
  } catch (error) {
    const message = String((error as any)?.message || error || "unknown");
    console.log("KRISTO_VIDEO_COMPRESS_FAILED", {
      message,
      originalBytes,
      platform: Platform.OS,
    });
    console.log("KRISTO_VIDEO_COMPRESS_SKIPPED", {
      reason: "compress-failed",
      originalBytes,
      compressedBytes: originalBytes,
    });
    return {
      uri: cleanUri,
      originalBytes,
      compressedBytes: originalBytes,
      skipped: true,
      reason: "compress-failed",
    };
  }
}
