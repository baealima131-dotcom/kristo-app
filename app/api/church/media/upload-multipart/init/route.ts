import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardChurchMediaUpload } from "@/app/api/_lib/media/churchMediaUploadAuth";
import {
  createMultipartVideoUpload,
  getVideoStorageConfig,
  MAX_VIDEO_UPLOAD_BYTES,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardChurchMediaUpload(req);
  if (ctxOrRes instanceof NextResponse) {
    return ctxOrRes;
  }

  if (!getVideoStorageConfig()) {
    return NextResponse.json(
      { ok: false, error: videoStorageConfigError(), reason: "video_storage_not_configured" },
      { status: 503 }
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const fileName = String(body?.fileName || "video.mp4").trim() || "video.mp4";
  const contentType = String(body?.contentType || "video/mp4").trim() || "video/mp4";
  const fileSize = Number(body?.fileSize || 0);

  if (!contentType.toLowerCase().startsWith("video/")) {
    return NextResponse.json({ ok: false, error: "Multipart init requires a video content type." }, { status: 400 });
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return NextResponse.json({ ok: false, error: "fileSize must be a positive number." }, { status: 400 });
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
    const session = await createMultipartVideoUpload({
      churchId: String(ctxOrRes.churchId || "").trim(),
      userId: String(ctxOrRes.viewer?.userId || "").trim(),
      fileName,
      contentType,
      fileSize,
    });

    console.log("KRISTO_MULTIPART_UPLOAD_INIT", {
      uploadId: session.uploadId,
      totalParts: session.totalParts,
      chunkSize: session.chunkSize,
      fileSize,
    });

    return NextResponse.json({ ok: true, data: session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_MULTIPART_UPLOAD_INIT_ERROR", { message });
    return NextResponse.json({ ok: false, error: message || "Could not start multipart upload." }, { status: 500 });
  }
}
