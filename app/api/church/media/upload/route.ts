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

export const runtime = "nodejs";

const MAX_FILE_SIZE = 120 * 1024 * 1024;

const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads", "media");

function ensureDir() {
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

export async function POST(req: NextRequest) {
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
    console.log("KRISTO_UPLOAD_SERVER_DEBUG", {
      contentType: req.headers.get("content-type"),
      contentLength: req.headers.get("content-length"),
      parseError: err instanceof Error ? err.message : String(err),
    });

    return NextResponse.json(
      {
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

  ensureDir();

  const ext = extFrom(file);

  const base = safeName(
    path.basename(
      String(file.name || "video"),
      path.extname(String(file.name || ""))
    )
  );

  const filename =
    `media_${Date.now()}_${Math.random().toString(16).slice(2)}_${base}${ext}`;

  const absPath = path.join(UPLOAD_DIR, filename);

  const buf = Buffer.from(await file.arrayBuffer());

  fs.writeFileSync(absPath, buf);

  const url = `/uploads/media/${filename}`;
  const isVideo = String(file.type || "").toLowerCase().includes("video/");

  let posterUri: string | undefined;
  let thumbnailUri: string | undefined;

  if (posterFile instanceof File && posterFile.size > 0) {
    const posterBuf = Buffer.from(await posterFile.arrayBuffer());
    const savedPoster = saveClientPosterBuffer(posterBuf, filename);
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

  return NextResponse.json({
    ok: true,
    data: {
      url,
      filename,
      size: file.size,
      mime: file.type || "application/octet-stream",
      ...(posterUri ? { posterUri, thumbnailUri, videoPosterUri: posterUri } : {}),
    },
  });
}
