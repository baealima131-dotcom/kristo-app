import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPublicVideoUrl,
  downloadStorageObjectToPath,
  getVideoStorageConfig,
  posterStorageKeyForVideoKey,
  replaceStorageObjectFromPath,
  storageKeyFromPublicUrl,
  storageObjectExists,
} from "@/app/api/_lib/media/objectStorage";
import { generateVideoPosterFromFile } from "@/app/api/_lib/media/videoPoster";
import { patchFeedItemsPosterByVideoUrl } from "@/app/api/_lib/store/feedDb";

function normalizeVideoUrl(url: string) {
  return String(url || "").trim().split("?")[0];
}

export async function ensureRemoteVideoPosterForUrl(videoUrl: string): Promise<string | null> {
  const normalizedUrl = normalizeVideoUrl(videoUrl);
  const config = getVideoStorageConfig();
  if (!config || !normalizedUrl) return null;

  const videoKey = storageKeyFromPublicUrl(normalizedUrl);
  if (!videoKey) return null;

  const posterKey = posterStorageKeyForVideoKey(videoKey);
  const existingPosterUrl = buildPublicVideoUrl(config, posterKey);

  if (await storageObjectExists(posterKey)) {
    console.log("KRISTO_VIDEO_POSTER_REUSED", {
      videoUrl: normalizedUrl,
      posterUri: existingPosterUrl,
    });
    return existingPosterUrl;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kristo-poster-"));
  const inputPath = path.join(tmpDir, `input${path.extname(videoKey) || ".mp4"}`);
  const posterPath = path.join(tmpDir, "poster.jpg");

  console.log("KRISTO_VIDEO_POSTER_REMOTE_START", {
    videoUrl: normalizedUrl,
    videoKey,
    posterKey,
  });

  try {
    await downloadStorageObjectToPath(videoKey, inputPath);
    const localPoster = await generateVideoPosterFromFile(inputPath, posterPath);
    if (!localPoster || !fs.existsSync(posterPath)) {
      console.log("KRISTO_VIDEO_POSTER_REMOTE_FAILED", {
        videoUrl: normalizedUrl,
        reason: "ffmpeg-poster-missing",
      });
      return null;
    }

    await replaceStorageObjectFromPath({
      key: posterKey,
      srcPath: posterPath,
      contentType: "image/jpeg",
    });

    try {
      await patchFeedItemsPosterByVideoUrl(normalizedUrl, existingPosterUrl);
    } catch (patchError) {
      console.log("KRISTO_VIDEO_POSTER_REMOTE_FAILED", {
        videoUrl: normalizedUrl,
        reason: "feed-poster-patch-failed",
        error: patchError instanceof Error ? patchError.message : String(patchError),
      });
    }

    console.log("KRISTO_VIDEO_POSTER_REMOTE_DONE", {
      videoUrl: normalizedUrl,
      posterUri: existingPosterUrl,
      posterKey,
    });

    return existingPosterUrl;
  } catch (error) {
    console.log("KRISTO_VIDEO_POSTER_REMOTE_FAILED", {
      videoUrl: normalizedUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}
