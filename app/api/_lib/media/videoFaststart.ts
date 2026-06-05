import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { patchFeedItemsFaststartByVideoUrl } from "@/app/api/_lib/store/feedDb";
import {
  downloadStorageObjectToPath,
  getStorageObjectByteSize,
  replaceStorageObjectFromPath,
} from "@/app/api/_lib/media/objectStorage";
import {
  ffmpegAvailable,
  resolveFfmpegPath,
  shouldAttemptServerFfmpeg,
} from "@/app/api/_lib/media/videoPoster";

const execFileAsync = promisify(execFile);

/** Skip inline remux above this size on serverless (use async strategy later). */
export const SYNC_FASTSTART_MAX_BYTES = 250 * 1024 * 1024;

function isFaststartCandidateKey(key: string) {
  const lower = String(key || "").trim().toLowerCase();
  return lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".mov");
}

function normalizeVideoUrl(url: string) {
  return String(url || "").trim().split("?")[0];
}

export type VideoFaststartRepackResult = {
  ok: boolean;
  faststart: boolean;
  videoUrl: string;
  key: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

async function remuxFileFaststart(inputPath: string, outputPath: string, timeoutMs: number) {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    throw new Error("ffmpeg unavailable");
  }

  await execFileAsync(
    ffmpegPath,
    ["-y", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", outputPath],
    { timeout: timeoutMs }
  );

  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
    throw new Error("ffmpeg faststart output missing");
  }
}

export async function repackVideoFaststartForKey(params: {
  key: string;
  videoUrl: string;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<VideoFaststartRepackResult> {
  const key = String(params.key || "").trim();
  const videoUrl = normalizeVideoUrl(params.videoUrl);
  const timeoutMs = Math.max(15_000, Number(params.timeoutMs || 120_000));
  const maxBytes = Math.max(1, Number(params.maxBytes || SYNC_FASTSTART_MAX_BYTES));

  if (!key || !videoUrl) {
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      skipped: true,
      reason: "missing-key-or-url",
    };
  }

  if (!isFaststartCandidateKey(key)) {
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl,
      key,
      reason: "unsupported-extension",
    });
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      skipped: true,
      reason: "unsupported-extension",
    };
  }

  if (!shouldAttemptServerFfmpeg()) {
    console.log("KRISTO_VIDEO_FASTSTART_SKIPPED", {
      videoUrl,
      key,
      reason: "serverless-ffmpeg-skipped",
    });
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      skipped: true,
      reason: "serverless-ffmpeg-skipped",
      error: "serverless-ffmpeg-skipped",
    };
  }

  console.log("KRISTO_VIDEO_FASTSTART_REQUIRED", {
    videoUrl,
    faststart: false,
    key,
  });

  if (!(await ffmpegAvailable())) {
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl,
      key,
      reason: "ffmpeg-unavailable",
    });
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      skipped: true,
      reason: "ffmpeg-unavailable",
      error: "ffmpeg-unavailable",
    };
  }

  let objectBytes = 0;
  try {
    objectBytes = await getStorageObjectByteSize(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl,
      key,
      reason: "head-object-failed",
      error: message,
    });
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      error: message,
    };
  }

  if (objectBytes > maxBytes) {
    const reason = "object-too-large-for-inline-remux";
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl,
      key,
      reason,
      objectBytes,
      maxBytes,
    });
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      skipped: true,
      reason,
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-faststart-"));
  const inputPath = path.join(tmpDir, `input${path.extname(key) || ".mp4"}`);
  const outputPath = path.join(tmpDir, `output${path.extname(key) || ".mp4"}`);

  console.log("KRISTO_VIDEO_FASTSTART_REPACK_START", {
    videoUrl,
    key,
    objectBytes,
  });

  try {
    await downloadStorageObjectToPath(key, inputPath);
    await remuxFileFaststart(inputPath, outputPath, timeoutMs);
    await replaceStorageObjectFromPath({
      key,
      srcPath: outputPath,
      contentType: "video/mp4",
    });

    try {
      await patchFeedItemsFaststartByVideoUrl(videoUrl);
    } catch (patchError) {
      console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
        videoUrl,
        key,
        reason: "feed-metadata-patch-failed",
        error: patchError instanceof Error ? patchError.message : String(patchError),
      });
    }

    console.log("KRISTO_VIDEO_FASTSTART_REPACK_DONE", {
      videoUrl,
      key,
      objectBytes,
      outputBytes: fs.statSync(outputPath).size,
    });

    return {
      ok: true,
      faststart: true,
      videoUrl,
      key,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl,
      key,
      error: message,
    });
    return {
      ok: false,
      faststart: false,
      videoUrl,
      key,
      error: message,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

export function resolveFaststartResponseFields(repack: VideoFaststartRepackResult) {
  const rawReason = String(repack.reason || repack.error || "").trim().toLowerCase();
  const faststartReason =
    repack.faststart === true
      ? null
      : rawReason.includes("ffmpeg unavailable") || rawReason === "ffmpeg-unavailable"
        ? "ffmpeg-unavailable"
        : String(repack.reason || repack.error || "").trim() || null;

  return {
    faststart: repack.faststart === true,
    faststartPending: repack.faststart !== true,
    faststartReason,
  };
}

export function scheduleVideoFaststartRepack(params: {
  key: string;
  videoUrl: string;
  preferAsync?: boolean;
}) {
  if (!shouldAttemptServerFfmpeg()) {
    console.log("KRISTO_VIDEO_FASTSTART_SKIPPED", {
      videoUrl: normalizeVideoUrl(params.videoUrl),
      key: params.key,
      reason: "serverless-ffmpeg-skipped",
      async: true,
    });
    return;
  }

  void repackVideoFaststartForKey({
    key: params.key,
    videoUrl: params.videoUrl,
  }).catch((error) => {
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl: normalizeVideoUrl(params.videoUrl),
      key: params.key,
      reason: "async-repack-crashed",
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
