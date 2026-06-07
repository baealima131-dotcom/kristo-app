import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ffmpegAvailable,
  publicUploadAbsPath,
  resolveFfmpegPath,
  shouldAttemptServerFfmpeg,
} from "@/app/api/_lib/media/videoPoster";

const execFileAsync = promisify(execFile);

const PUBLIC_DIR = path.join(process.cwd(), "public");
export const VIDEO_PREVIEWS_DIR = path.join(PUBLIC_DIR, "uploads", "media", "previews");

function ensurePreviewsDir() {
  if (!fs.existsSync(VIDEO_PREVIEWS_DIR)) {
    fs.mkdirSync(VIDEO_PREVIEWS_DIR, { recursive: true });
  }
}

function publicUrlFromAbs(absPath: string): string {
  const rel = path.relative(PUBLIC_DIR, absPath).split(path.sep).join("/");
  return `/${rel}`;
}

export function previewPublicUrlForVideoUrl(videoUrl: string): string {
  const clean = String(videoUrl || "").split("?")[0].replace(/^\/+/, "");
  const base = path.basename(clean, path.extname(clean));
  return `/uploads/media/previews/${base}.mp4`;
}

export function previewAbsPathForVideoUrl(videoUrl: string): string | null {
  const publicUrl = previewPublicUrlForVideoUrl(videoUrl);
  return publicUploadAbsPath(publicUrl);
}

export async function generateVideoPreviewFromFile(
  videoAbsPath: string,
  previewAbsPath?: string
): Promise<string | null> {
  if (!fs.existsSync(videoAbsPath)) return null;

  ensurePreviewsDir();

  const outputPath =
    previewAbsPath ||
    path.join(
      VIDEO_PREVIEWS_DIR,
      `${path.basename(videoAbsPath, path.extname(videoAbsPath))}.mp4`
    );

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    return publicUrlFromAbs(outputPath);
  }

  if (!(await ffmpegAvailable())) {
    console.log("KRISTO_VIDEO_PREVIEW_FFMPEG_UNAVAILABLE", { videoAbsPath });
    return null;
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return null;

  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-i",
        videoAbsPath,
        "-vf",
        "scale=-2:360",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-maxrate",
        "500k",
        "-bufsize",
        "1M",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeout: 120000 }
    );

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      const previewUri = publicUrlFromAbs(outputPath);
      console.log("KRISTO_VIDEO_PREVIEW_CREATED", { videoAbsPath, previewUri });
      return previewUri;
    }
  } catch (error) {
    console.log("KRISTO_VIDEO_PREVIEW_ERROR", {
      videoAbsPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

export async function findExistingPreviewVideoUrl(videoUrl: string): Promise<string | null> {
  const normalized = String(videoUrl || "").trim().split("?")[0];
  if (!normalized) return null;

  const absPath = previewAbsPathForVideoUrl(normalized);
  if (absPath && fs.existsSync(absPath) && fs.statSync(absPath).size > 0) {
    return previewPublicUrlForVideoUrl(normalized);
  }

  const { findExistingRemotePreviewVideoUrl } = await import(
    "@/app/api/_lib/media/videoPreviewRemote"
  );
  return findExistingRemotePreviewVideoUrl(normalized);
}

export async function ensureVideoPreviewForUrl(videoUrl: string): Promise<string | null> {
  const normalized = String(videoUrl || "").trim().split("?")[0];
  if (!normalized || !shouldAttemptServerFfmpeg()) return null;

  const existing = await findExistingPreviewVideoUrl(normalized);
  if (existing) return existing;

  const absPath = publicUploadAbsPath(normalized);
  if (absPath) {
    const previewAbs = previewAbsPathForVideoUrl(normalized);
    const localPreview = await generateVideoPreviewFromFile(absPath, previewAbs || undefined);
    if (localPreview) return localPreview;
  }

  const { ensureRemoteVideoPreviewForUrl } = await import(
    "@/app/api/_lib/media/videoPreviewRemote"
  );
  return ensureRemoteVideoPreviewForUrl(normalized);
}
