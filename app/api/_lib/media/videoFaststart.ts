import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { patchFeedItemsFaststartByVideoUrl } from "@/app/api/_lib/store/feedDb";
import {
  downloadStorageObjectToPath,
  getStorageObjectByteSize,
  patchStorageObjectDeliveryMetadata,
  replaceStorageObjectFromPath,
  VIDEO_OBJECT_CONTENT_TYPE,
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
  inputBytes?: number;
  outputBytes?: number;
  ms?: number;
};

function logFaststartResult(params: {
  postId?: string | null;
  attempted: boolean;
  success: boolean;
  reason: string;
  inputBytes: number;
  outputBytes: number;
  ms: number;
}) {
  console.log("KRISTO_VIDEO_FASTSTART_RESULT", {
    postId: params.postId || null,
    attempted: params.attempted,
    success: params.success,
    reason: params.reason,
    inputBytes: params.inputBytes,
    outputBytes: params.outputBytes,
    ms: params.ms,
  });
}

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
  postId?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<VideoFaststartRepackResult> {
  const startedMs = Date.now();
  const key = String(params.key || "").trim();
  const videoUrl = normalizeVideoUrl(params.videoUrl);
  const postId = String(params.postId || "").trim() || null;
  const timeoutMs = Math.max(15_000, Number(params.timeoutMs || 120_000));
  const maxBytes = Math.max(1, Number(params.maxBytes || SYNC_FASTSTART_MAX_BYTES));
  let inputBytes = 0;
  let outputBytes = 0;

  const finish = (
    result: VideoFaststartRepackResult,
    attempted: boolean,
    success: boolean,
    reason: string
  ): VideoFaststartRepackResult => {
    const ms = Date.now() - startedMs;
    logFaststartResult({
      postId,
      attempted,
      success,
      reason,
      inputBytes,
      outputBytes,
      ms,
    });
    return { ...result, inputBytes, outputBytes, ms };
  };

  if (!key || !videoUrl) {
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        skipped: true,
        reason: "missing-key-or-url",
      },
      false,
      false,
      "missing-key-or-url"
    );
  }

  if (!isFaststartCandidateKey(key)) {
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        skipped: true,
        reason: "unsupported-extension",
      },
      false,
      false,
      "unsupported-extension"
    );
  }

  if (!shouldAttemptServerFfmpeg()) {
    console.log("KRISTO_VIDEO_FASTSTART_SKIPPED", {
      videoUrl,
      key,
      reason: "server-ffmpeg-disabled",
      postId,
    });
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        skipped: true,
        reason: "server-ffmpeg-disabled",
        error: "server-ffmpeg-disabled",
      },
      false,
      false,
      "server-ffmpeg-disabled"
    );
  }

  console.log("KRISTO_VIDEO_FASTSTART_REQUIRED", {
    videoUrl,
    faststart: false,
    key,
    postId,
  });

  if (!(await ffmpegAvailable())) {
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        skipped: true,
        reason: "ffmpeg-unavailable",
        error: "ffmpeg-unavailable",
      },
      true,
      false,
      "ffmpeg-unavailable"
    );
  }

  try {
    inputBytes = await getStorageObjectByteSize(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        error: message,
        reason: "head-object-failed",
      },
      true,
      false,
      "head-object-failed"
    );
  }

  if (inputBytes > maxBytes) {
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        skipped: true,
        reason: "object-too-large-for-inline-remux",
      },
      true,
      false,
      "object-too-large-for-inline-remux"
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-faststart-"));
  const inputPath = path.join(tmpDir, `input${path.extname(key) || ".mp4"}`);
  const outputPath = path.join(tmpDir, `output${path.extname(key) || ".mp4"}`);

  console.log("KRISTO_VIDEO_FASTSTART_REPACK_START", {
    videoUrl,
    key,
    objectBytes: inputBytes,
    postId,
  });

  try {
    await downloadStorageObjectToPath(key, inputPath);
    await remuxFileFaststart(inputPath, outputPath, timeoutMs);
    outputBytes = fs.statSync(outputPath).size;

    await replaceStorageObjectFromPath({
      key,
      srcPath: outputPath,
      contentType: VIDEO_OBJECT_CONTENT_TYPE,
    });
    await patchStorageObjectDeliveryMetadata({ key });

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
      objectBytes: inputBytes,
      outputBytes,
      postId,
    });

    return finish(
      {
        ok: true,
        faststart: true,
        videoUrl,
        key,
      },
      true,
      true,
      "faststart-applied"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl,
      key,
      error: message,
      postId,
    });
    return finish(
      {
        ok: false,
        faststart: false,
        videoUrl,
        key,
        error: message,
        reason: "ffmpeg-repack-failed",
      },
      true,
      false,
      "ffmpeg-repack-failed"
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

export function resolveFaststartResponseFields(repack: VideoFaststartRepackResult) {
  const rawReason = String(repack.reason || repack.error || "").trim().toLowerCase();
  let faststartReason: string | null = null;

  if (repack.faststart !== true) {
    if (
      rawReason === "server-ffmpeg-disabled" ||
      rawReason === "serverless-ffmpeg-skipped"
    ) {
      faststartReason = "server-ffmpeg-disabled";
    } else if (rawReason.includes("ffmpeg unavailable") || rawReason === "ffmpeg-unavailable") {
      faststartReason = "ffmpeg-unavailable";
    } else {
      faststartReason = String(repack.reason || repack.error || "").trim() || null;
    }
  }

  return {
    faststart: repack.faststart === true,
    faststartPending: repack.faststart !== true,
    faststartReason,
  };
}

export function scheduleVideoFaststartRepack(params: {
  key: string;
  videoUrl: string;
  postId?: string | null;
  preferAsync?: boolean;
}) {
  if (!shouldAttemptServerFfmpeg()) {
    console.log("KRISTO_VIDEO_FASTSTART_SKIPPED", {
      videoUrl: normalizeVideoUrl(params.videoUrl),
      key: params.key,
      reason: "server-ffmpeg-disabled",
      async: true,
      postId: params.postId || null,
    });
    return;
  }

  void repackVideoFaststartForKey({
    key: params.key,
    videoUrl: params.videoUrl,
    postId: params.postId || null,
  }).catch((error) => {
    console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
      videoUrl: normalizeVideoUrl(params.videoUrl),
      key: params.key,
      reason: "async-repack-crashed",
      error: error instanceof Error ? error.message : String(error),
      postId: params.postId || null,
    });
  });
}
