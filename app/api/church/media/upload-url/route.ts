import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  createPresignedPosterUpload,
  createPresignedVideoUpload,
  getVideoStorageConfig,
  MAX_POSTER_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";

function isVideoContentType(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("video/");
}

function isImageContentType(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("image/");
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) {
    return ctxOrRes;
  }

  if (!getVideoStorageConfig()) {
    return NextResponse.json(
      {
        ok: false,
        error: videoStorageConfigError(),
        reason: "video_storage_not_configured",
      },
      { status: 503 }
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const uploadKind = String(body?.uploadKind || body?.kind || "video").toLowerCase();
  const isPosterUpload = uploadKind === "poster";

  const fileName = String(
    body?.fileName || (isPosterUpload ? "poster.jpg" : "video.mp4")
  ).trim() || (isPosterUpload ? "poster.jpg" : "video.mp4");
  const contentType = String(
    body?.contentType || (isPosterUpload ? "image/jpeg" : "video/mp4")
  ).trim() || (isPosterUpload ? "image/jpeg" : "video/mp4");
  const fileSize = Number(body?.fileSize || 0);

  if (isPosterUpload) {
    if (!isImageContentType(contentType)) {
      return NextResponse.json(
        { ok: false, error: "Poster uploads require an image/* content type." },
        { status: 400 }
      );
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json(
        { ok: false, error: "fileSize must be a positive number." },
        { status: 400 }
      );
    }

    if (fileSize > MAX_POSTER_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Poster is too large. Maximum size is ${Math.floor(MAX_POSTER_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 400 }
      );
    }

    try {
      const signed = await createPresignedPosterUpload({
        churchId: String(ctxOrRes.churchId || "").trim(),
        userId: String(ctxOrRes.viewer?.userId || "").trim(),
        fileName,
        contentType,
        fileSize,
      });

      return NextResponse.json({
        ok: true,
        data: signed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log("KRISTO_POSTER_UPLOAD_URL_ERROR", { message });

      return NextResponse.json(
        {
          ok: false,
          error: message || "Could not create signed poster upload URL.",
        },
        { status: 500 }
      );
    }
  }

  if (!isVideoContentType(contentType)) {
    return NextResponse.json(
      { ok: false, error: "Only video uploads are supported on this endpoint." },
      { status: 400 }
    );
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json(
      { ok: false, error: "fileSize must be a positive number." },
      { status: 400 }
    );
  }

  if (fileSize > MAX_VIDEO_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error: `Video is too large. Maximum size is ${Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024 * 1024))} GB.`,
      },
      { status: 400 }
    );
  }

  try {
    const signed = await createPresignedVideoUpload({
      churchId: String(ctxOrRes.churchId || "").trim(),
      userId: String(ctxOrRes.viewer?.userId || "").trim(),
      fileName,
      contentType,
      fileSize,
    });

    return NextResponse.json({
      ok: true,
      data: signed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_VIDEO_UPLOAD_URL_ERROR", { message });

    return NextResponse.json(
      {
        ok: false,
        error: message || "Could not create signed upload URL.",
      },
      { status: 500 }
    );
  }
}
