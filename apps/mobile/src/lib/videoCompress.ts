import { NativeModules } from "react-native";

export type VideoCompressResult = {
  uri: string;
  originalBytes: number;
  compressedBytes: number;
  skipped: boolean;
  reason?: string;
};

const MIN_COMPRESS_BYTES = 200 * 1024;

function hasVideoCompressorNative() {
  const native = NativeModules as Record<string, unknown>;
  return Boolean(native.Compressor || native.RNCompressor || native.VideoCompressor);
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

export async function compressVideoForUpload(sourceUri: string): Promise<VideoCompressResult> {
  const cleanUri = String(sourceUri || "").trim();
  const originalBytes = await resolveFileSize(cleanUri);

  console.log("KRISTO_VIDEO_COMPRESS_START", {
    originalBytes,
    sourceUri: cleanUri,
  });

  if (!cleanUri) {
    console.log("KRISTO_VIDEO_COMPRESS_SKIPPED", {
      reason: "missing-uri",
      originalBytes: 0,
      compressedBytes: 0,
    });
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
      reason: "too-small-to-remux",
      originalBytes,
      compressedBytes: originalBytes,
    });
    return {
      uri: cleanUri,
      originalBytes,
      compressedBytes: originalBytes,
      skipped: true,
      reason: "too-small-to-remux",
    };
  }

  if (!hasVideoCompressorNative()) {
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

    const compressedUri = await Video.compress(
      cleanUri,
      {
        compressionMethod: "auto",
        maxSize: 1280,
        minimumFileSizeForCompress: 2,
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

    if (originalBytes > 0 && compressedBytes >= originalBytes * 0.95) {
      console.log("KRISTO_VIDEO_COMPRESS_KEEP_REMUXED", {
        reason: "keep-remuxed-for-faststart",
        originalBytes,
        compressedBytes,
        outputUri,
      });
    }

    console.log("KRISTO_VIDEO_COMPRESS_DONE", {
      originalBytes,
      compressedBytes,
      savedBytes: Math.max(0, originalBytes - compressedBytes),
    });

    return {
      uri: outputUri,
      originalBytes,
      compressedBytes,
      skipped: false,
    };
  } catch (error) {
    const message = String((error as any)?.message || error || "unknown");
    console.log("KRISTO_VIDEO_COMPRESS_FAILED", { message, originalBytes });
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
