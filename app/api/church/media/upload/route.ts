import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import { guard } from "@/app/api/_lib/rbac";
import {
  generateVideoPosterFromFile,
  saveClientPosterBuffer,
  VIDEO_POSTERS_DIR,
} from "@/app/api/_lib/media/videoPoster";
import {
  getVideoStorageConfig,
  uploadBufferToStorage,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";
import { isVercelRuntime } from "@/app/api/_lib/store/authDb";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 120 * 1024 * 1024;

const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads", "media");

function ensureLocalDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  if (!fs.existsSync(VIDEO_POSTERS_DIR)) {
    fs.mkdirSync(VIDEO_POSTERS_DIR, { recursive: true });
  }
}

function safeName(name: string) {
  return String(name || "video")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extFrom(file: File) {
  const byName = path.extname(String(file.name || "")).trim();

  if (byName) return byName.toLowerCase();

  const mime = String(file.type || "").toLowerCase();

  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("mov")) return ".mov";

  return mime.includes("image/") ? ".jpg" : ".mp4";
}

function isAllowedMedia(file: File) {
  const mime = String(file.type || "").toLowerCase();

  return mime.includes("video/") || mime.includes("image/");
}

async function saveToLocalFilesystem(params: {
  filename: string;
  buf: Buffer;
  file: File;
  posterFile: FormDataEntryValue | null;
}) {
  ensureLocalDir();

  const absPath = path.join(UPLOAD_DIR, params.filename);
  fs.writeFileSync(absPath, params.buf);

  const url = `/uploads/media/${params.filename}`;
  const isVideo = String(params.file.type || "").toLowerCase().includes("video/");

  let posterUri: string | undefined;
  let thumbnailUri: string | undefined;

  if (params.posterFile instanceof File && params.posterFile.size > 0) {
    const posterBuf = Buffer.from(await params.posterFile.arrayBuffer());
    const savedPoster = saveClientPosterBuffer(posterBuf, params.filename);
    posterUri = savedPoster;
    thumbnailUri = savedPoster;
    console.log("KRISTO_VIDEO_POSTER_CLIENT", { url, posterUri: savedPoster });
  } else if (isVideo) {
    const generatedPoster = await generateVideoPosterFromFile(absPath);
    if (generatedPoster) {
      posterUri = generatedPoster;
      thumbnailUri = generatedPoster;
    } else {
      console.log("KRISTO_VIDEO_POSTER_FFMPEG_UNAVAILABLE", {
        url,
        note: "Install ffmpeg or send client poster file with upload",
      });
    }
  }

  return { url, posterUri, thumbnailUri };
}

async function saveToObjectStorage(params: {
  filename: string;
  buf: Buffer;
  mime: string;
  file: File;
  posterFile: FormDataEntryValue | null;
}) {
  const storageConfig = getVideoStorageConfig();
  if (!storageConfig) {
    throw new Error(videoStorageConfigError());
  }

  const ext = path.extname(params.filename);
  const key = `uploads/media/${params.filename}`;
  const uploaded = await uploadBufferToStorage({
    key,
    body: params.buf,
    contentType: params.mime,
  });

  const url = uploaded.publicUrl;
  const isVideo = String(params.file.type || "").toLowerCase().includes("video/");

  let posterUri: string | undefined;
  let thumbnailUri: string | undefined;

  if (params.posterFile instanceof File && params.posterFile.size > 0) {
    const posterBuf = Buffer.from(await params.posterFile.arrayBuffer());
    const posterKey = `uploads/media/posters/${path.basename(params.filename, ext)}.jpg`;
    const posterUploaded = await uploadBufferToStorage({
      key: posterKey,
      body: posterBuf,
      contentType: "image/jpeg",
    });
    posterUri = posterUploaded.publicUrl;
    thumbnailUri = posterUri;
    console.log("KRISTO_VIDEO_POSTER_CLIENT", { url, posterUri });
  } else if (isVideo) {
    console.log("KRISTO_VIDEO_POSTER_FFMPEG_UNAVAILABLE", {
      url,
      note: "Object storage upload — send client poster or use upload-url flow",
    });
  }

  return { url, posterUri, thumbnailUri };
}

export async function POST(req: NextRequest) {
  let storageMode: "object-storage" | "local-fs" = "local-fs";
  let fileName = "";
  let mimeType = "";
  let fileSize = 0;

  try {
    const ctxOrRes = await guard(req);

    if (ctxOrRes instanceof NextResponse) {
      return ctxOrRes;
    }

    console.log("KRISTO_UPLOAD_SERVER_DEBUG", {
      contentType: req.headers.get("content-type"),
      contentLength: req.headers.get("content-length"),
    });

    let form: FormData;

    try {
      form = await req.formData();
    } catch (err) {
      console.log("KRISTO_CHURCH_MEDIA_UPLOAD_ERROR", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Invalid form data",
          detail: err instanceof Error ? err.message : String(err),
          contentType: req.headers.get("content-type"),
        },
        { status: 400 }
      );
    }

    const file = form.get("file");
    const posterFile = form.get("poster");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "file is required" },
        { status: 400 }
      );
    }

    if (!isAllowedMedia(file)) {
      return NextResponse.json(
        { ok: false, error: "Only image/video files allowed" },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "File too large" },
        { status: 400 }
      );
    }

    fileName = String(file.name || "upload");
    mimeType = String(file.type || "application/octet-stream");
    fileSize = file.size;

    console.log("KRISTO_CHURCH_MEDIA_UPLOAD_START", {
      fileName,
      mimeType,
      size: fileSize,
    });

    const storageConfig = getVideoStorageConfig();
    const useObjectStorage = isVercelRuntime() || Boolean(storageConfig);
    storageMode = useObjectStorage ? "object-storage" : "local-fs";

    console.log("KRISTO_CHURCH_MEDIA_UPLOAD_STORAGE_TARGET", {
      runtime: isVercelRuntime() ? "vercel" : "local",
      useObjectStorage,
    });

    const ext = extFrom(file);
    const base = safeName(
      path.basename(
        String(file.name || "video"),
        path.extname(String(file.name || ""))
      )
    );
    const filename =
      `media_${Date.now()}_${Math.random().toString(16).slice(2)}_${base}${ext}`;

    const buf = Buffer.from(await file.arrayBuffer());

    let url = "";
    let posterUri: string | undefined;
    let thumbnailUri: string | undefined;

    if (useObjectStorage) {
      const saved = await saveToObjectStorage({
        filename,
        buf,
        mime: mimeType,
        file,
        posterFile,
      });
      url = saved.url;
      posterUri = saved.posterUri;
      thumbnailUri = saved.thumbnailUri;
    } else {
      const saved = await saveToLocalFilesystem({
        filename,
        buf,
        file,
        posterFile,
      });
      url = saved.url;
      posterUri = saved.posterUri;
      thumbnailUri = saved.thumbnailUri;
    }

    return NextResponse.json({
      ok: true,
      data: {
        url,
        mediaUri: url,
        imageUrl: url,
        filename,
        size: fileSize,
        mime: mimeType,
        ...(posterUri ? { posterUri, thumbnailUri, videoPosterUri: posterUri } : {}),
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "upload_failed");
    const stack = error instanceof Error ? error.stack : undefined;

    console.log("KRISTO_CHURCH_MEDIA_UPLOAD_ERROR", {
      message,
      stack,
      storageMode,
      fileName: fileName || null,
      mimeType: mimeType || null,
      size: fileSize || null,
    });

    const lower = message.toLowerCase();
    const status =
      lower.includes("not configured") ||
      lower.includes("erofs") ||
      lower.includes("read-only")
        ? 503
        : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
        ...(process.env.NODE_ENV !== "production" ? { detail: message } : {}),
      },
      { status }
    );
  }
}
