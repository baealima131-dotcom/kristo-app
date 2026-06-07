import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import { guardAuth } from "@/app/api/_lib/rbac";
import {
  getVideoStorageConfig,
  uploadBufferToStorage,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";
import { isVercelRuntime } from "@/app/api/_lib/store/authDb";

export const runtime = "nodejs";

const MAX_VIDEO_SIZE = 120 * 1024 * 1024;
/** Church Room feed images — keep under Vercel ~4.5MB request-body limit. */
const MAX_IMAGE_SIZE = 12 * 1024 * 1024;

const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads", "media");
const VIDEO_POSTERS_DIR = path.join(PUBLIC_DIR, "uploads", "media", "posters");

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

function safeChurchSegment(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "unknown";
  return (
    value
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "unknown"
  );
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

function isImageFile(file: File) {
  return String(file.type || "").toLowerCase().includes("image/");
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
  const {
    generateVideoPosterFromFile,
    saveClientPosterBuffer,
  } = await import("@/app/api/_lib/media/videoPoster");

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

async function saveImageToObjectStorage(params: {
  churchId: string;
  filename: string;
  buf: Buffer;
  mime: string;
}) {
  const storageConfig = getVideoStorageConfig();
  if (!storageConfig) {
    throw new Error(videoStorageConfigError());
  }

  const key = `church-feed-images/${params.churchId}/${Date.now()}_${params.filename}`;
  const uploaded = await uploadBufferToStorage({
    key,
    body: params.buf,
    contentType: params.mime,
  });

  return uploaded.publicUrl;
}

function uploadFatalJson(
  error: unknown,
  context?: {
    userId?: string;
    churchId?: string;
    isImage?: boolean;
    storageMode?: string;
    reason?: string;
  }
) {
  const message = String(
    (error as any)?.message || error || "upload_failed"
  );

  console.error("KRISTO_CHURCH_MEDIA_UPLOAD_FATAL", {
    userId: context?.userId || "",
    churchId: context?.churchId || "",
    isImage: Boolean(context?.isImage),
    storageMode: context?.storageMode || "unknown",
    reason: context?.reason || "unhandled",
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });

  const lower = message.toLowerCase();
  const status =
    lower.includes("not configured") ||
    lower.includes("missing:") ||
    lower.includes("erofs") ||
    lower.includes("read-only") ||
    lower.includes("enoent")
      ? 503
      : 502;

  return NextResponse.json(
    {
      ok: false,
      error: context?.isImage
        ? "Could not upload image. Please try again."
        : message,
      detail: message,
      reason: context?.reason || "unhandled",
      stack:
        process.env.NODE_ENV !== "production"
          ? String((error as any)?.stack || "")
          : undefined,
    },
    { status }
  );
}

async function handleChurchMediaUpload(req: NextRequest) {
  let churchId = "";
  let userId = "";
  let storageMode: "object-storage" | "local-fs" = "local-fs";
  let isImage = false;

  try {
    // Church Room feed images use this route (not the signed upload-url video flow).
    // Auth-only matches /api/church/room-attachments/upload and avoids membership
    // store failures surfacing as opaque 500s during image upload on Vercel.
    const ctxOrRes = await guardAuth(req);

    if (ctxOrRes instanceof NextResponse) {
      return ctxOrRes;
    }

    userId = String(ctxOrRes.viewer?.userId || "").trim();
    churchId = safeChurchSegment(
      String(
        (ctxOrRes.viewer as any)?.churchId ||
          req.headers.get("x-kristo-church-id") ||
          ""
      ).trim()
    );

    let form: FormData;

    try {
      form = await req.formData();
    } catch (err) {
      console.error("KRISTO_CHURCH_MEDIA_UPLOAD_ERROR", {
        userId,
        churchId,
        reason: "invalid-form-data",
        message: err instanceof Error ? err.message : String(err),
        contentType: req.headers.get("content-type"),
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

    isImage = isImageFile(file);
    const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          ok: false,
          error: isImage ? "Image too large (max 12MB)" : "File too large",
        },
        { status: 413 }
      );
    }

    const mimeType = String(file.type || "application/octet-stream");
    const fileSize = file.size;

    const storageConfig = getVideoStorageConfig();
    const useObjectStorage = isVercelRuntime() || Boolean(storageConfig);
    storageMode = useObjectStorage ? "object-storage" : "local-fs";

    console.log("KRISTO_CHURCH_MEDIA_UPLOAD_START", {
      userId,
      churchId,
      isImage,
      storageMode,
      vercel: isVercelRuntime(),
      hasStorageConfig: Boolean(storageConfig),
      size: fileSize,
      mime: mimeType,
      contentType: req.headers.get("content-type"),
    });

    if (useObjectStorage && !storageConfig) {
      const message = videoStorageConfigError();
      console.error("KRISTO_CHURCH_MEDIA_UPLOAD_ERROR", {
        userId,
        churchId,
        reason: "object-storage-not-configured",
        error: message,
      });
      return NextResponse.json(
        { ok: false, error: message, detail: message },
        { status: 503 }
      );
    }

    const ext = extFrom(file);
    const base = safeName(
      path.basename(
        String(file.name || "media"),
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
      if (isImage) {
        url = await saveImageToObjectStorage({
          churchId,
          filename,
          buf,
          mime: mimeType,
        });
      } else {
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
      }
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

    console.log("KRISTO_CHURCH_MEDIA_UPLOAD_DONE", {
      userId,
      churchId,
      isImage,
      storageMode,
      urlHost: String(url).split("/").filter(Boolean).slice(0, 3).join("/"),
      size: fileSize,
      mime: mimeType,
    });

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
    return uploadFatalJson(error, {
      userId,
      churchId,
      isImage,
      storageMode,
      reason: "handler",
    });
  }
}

/** Top-level safety net so Vercel never returns an empty 500 body. */
export async function POST(req: NextRequest) {
  try {
    return await handleChurchMediaUpload(req);
  } catch (error: unknown) {
    return uploadFatalJson(error, { reason: "top-level" });
  }
}
