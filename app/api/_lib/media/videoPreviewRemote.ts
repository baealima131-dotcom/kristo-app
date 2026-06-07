import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPublicVideoUrl,
  downloadStorageObjectToPath,
  getVideoStorageConfig,
  previewStorageKeyForVideoKey,
  replaceStorageObjectFromPath,
  storageKeyFromPublicUrl,
  storageObjectExists,
} from "@/app/api/_lib/media/objectStorage";
import { generateVideoPreviewFromFile } from "@/app/api/_lib/media/videoPreview";
import { shouldAttemptServerFfmpeg } from "@/app/api/_lib/media/videoPoster";

function normalizeVideoUrl(url: string) {
  return String(url || "").trim().split("?")[0];
}

export async function findExistingRemotePreviewVideoUrl(
  videoUrl: string
): Promise<string | null> {
  const normalizedUrl = normalizeVideoUrl(videoUrl);
  const config = getVideoStorageConfig();
  if (!config || !normalizedUrl) return null;

  const videoKey = storageKeyFromPublicUrl(normalizedUrl);
  if (!videoKey) return null;

  const previewKey = previewStorageKeyForVideoKey(videoKey);
  if (!(await storageObjectExists(previewKey))) return null;

  return buildPublicVideoUrl(config, previewKey);
}

export async function ensureRemoteVideoPreviewForUrl(
  videoUrl: string
): Promise<string | null> {
  const normalizedUrl = normalizeVideoUrl(videoUrl);
  if (!shouldAttemptServerFfmpeg()) return null;

  const config = getVideoStorageConfig();
  if (!config || !normalizedUrl) return null;

  const videoKey = storageKeyFromPublicUrl(normalizedUrl);
  if (!videoKey) return null;

  const previewKey = previewStorageKeyForVideoKey(videoKey);
  const previewUrl = buildPublicVideoUrl(config, previewKey);

  if (await storageObjectExists(previewKey)) {
    console.log("KRISTO_VIDEO_PREVIEW_REUSED", { videoUrl: normalizedUrl, previewUrl });
    return previewUrl;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-preview-"));
  const inputPath = path.join(tmpDir, `input${path.extname(videoKey) || ".mp4"}`);
  const previewPath = path.join(tmpDir, "preview.mp4");

  console.log("KRISTO_VIDEO_PREVIEW_REMOTE_START", {
    videoUrl: normalizedUrl,
    videoKey,
    previewKey,
  });

  try {
    await downloadStorageObjectToPath(videoKey, inputPath);
    const localPreview = await generateVideoPreviewFromFile(inputPath, previewPath);
    if (!localPreview || !fs.existsSync(previewPath)) {
      console.log("KRISTO_VIDEO_PREVIEW_REMOTE_FAILED", {
        videoUrl: normalizedUrl,
        reason: "ffmpeg-preview-missing",
      });
      return null;
    }

    await replaceStorageObjectFromPath({
      key: previewKey,
      srcPath: previewPath,
      contentType: "video/mp4",
    });

    console.log("KRISTO_VIDEO_PREVIEW_REMOTE_DONE", {
      videoUrl: normalizedUrl,
      previewUrl,
    });

    return previewUrl;
  } catch (error) {
    console.log("KRISTO_VIDEO_PREVIEW_REMOTE_FAILED", {
      videoUrl: normalizedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
