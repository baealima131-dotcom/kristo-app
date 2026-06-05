import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const moduleRequire = createRequire(path.join(process.cwd(), "package.json"));

const PUBLIC_DIR = path.join(process.cwd(), "public");
export const VIDEO_POSTERS_DIR = path.join(PUBLIC_DIR, "uploads", "media", "posters");

let cachedFfmpegPath: string | null | undefined;

export function resolveFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;

  try {
    const installer = moduleRequire("@ffmpeg-installer/ffmpeg") as { path?: string };
    const bundled = String(installer?.path || "").trim();
    if (bundled && fs.existsSync(bundled)) {
      cachedFfmpegPath = bundled;
      return cachedFfmpegPath;
    }
  } catch {
    // Optional dependency — fall back to system ffmpeg.
  }

  cachedFfmpegPath = "ffmpeg";
  return cachedFfmpegPath;
}

function ensurePostersDir() {
  if (!fs.existsSync(VIDEO_POSTERS_DIR)) {
    fs.mkdirSync(VIDEO_POSTERS_DIR, { recursive: true });
  }
}

export function publicUploadAbsPath(url: unknown): string | null {
  const value = String(url || "").trim();
  if (!value.startsWith("/uploads/")) return null;
  const clean = value.split("?")[0].replace(/^\/+/, "");
  return path.join(PUBLIC_DIR, clean.replace(/^public\//, ""));
}

function publicUrlFromAbs(absPath: string): string {
  const rel = path.relative(PUBLIC_DIR, absPath).split(path.sep).join("/");
  return `/${rel}`;
}

export function posterPublicUrlForVideoUrl(videoUrl: string): string {
  const clean = String(videoUrl || "").split("?")[0].replace(/^\/+/, "");
  const base = path.basename(clean, path.extname(clean));
  return `/uploads/media/posters/${base}.jpg`;
}

export async function ffmpegAvailable(): Promise<boolean> {
  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) return false;

  try {
    await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function generateVideoPosterFromFile(
  videoAbsPath: string,
  posterAbsPath?: string
): Promise<string | null> {
  if (!fs.existsSync(videoAbsPath)) return null;

  ensurePostersDir();

  const posterPath =
    posterAbsPath ||
    path.join(
      VIDEO_POSTERS_DIR,
      `${path.basename(videoAbsPath, path.extname(videoAbsPath))}.jpg`
    );

  if (fs.existsSync(posterPath)) {
    return publicUrlFromAbs(posterPath);
  }

  if (!(await ffmpegAvailable())) {
    console.log("KRISTO_VIDEO_POSTER_FFMPEG_UNAVAILABLE", {
      videoAbsPath,
      ffmpegPath: resolveFfmpegPath(),
    });
    return null;
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    console.log("KRISTO_VIDEO_POSTER_FFMPEG_UNAVAILABLE", { videoAbsPath });
    return null;
  }

  try {
    await execFileAsync(
      ffmpegPath,
      ["-y", "-ss", "0.5", "-i", videoAbsPath, "-frames:v", "1", "-q:v", "2", posterPath],
      { timeout: 30000 }
    );

    if (fs.existsSync(posterPath)) {
      const posterUri = publicUrlFromAbs(posterPath);
      console.log("KRISTO_VIDEO_POSTER_CREATED", { videoAbsPath, posterUri });
      return posterUri;
    }
  } catch (error) {
    console.log("KRISTO_VIDEO_POSTER_ERROR", {
      videoAbsPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

export async function ensureVideoPosterForUrl(videoUrl: string): Promise<string | null> {
  const absPath = publicUploadAbsPath(videoUrl);
  if (!absPath) return null;
  return generateVideoPosterFromFile(absPath);
}

export function saveClientPosterBuffer(buf: Buffer, videoFilename: string): string {
  ensurePostersDir();
  const base = path.basename(videoFilename, path.extname(videoFilename));
  const posterFilename = `${base}.jpg`;
  const absPath = path.join(VIDEO_POSTERS_DIR, posterFilename);
  fs.writeFileSync(absPath, buf);
  return `/uploads/media/posters/${posterFilename}`;
}
