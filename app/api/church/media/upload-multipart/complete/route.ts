import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  completeMultipartVideoUpload,
  getVideoStorageConfig,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";
import {
  repackVideoFaststartForKey,
  scheduleVideoFaststartRepack,
} from "@/app/api/_lib/media/videoFaststart";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
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

  const key = String(body?.key || "").trim();
  const uploadId = String(body?.uploadId || "").trim();
  const parts = Array.isArray(body?.parts) ? body.parts : [];

  if (!key || !uploadId || !parts.length) {
    return NextResponse.json({ ok: false, error: "key, uploadId, and parts are required." }, { status: 400 });
  }

  const normalizedParts = parts
    .map((part: any) => ({
      partNumber: Number(part?.partNumber || 0),
      etag: String(part?.etag || "").trim(),
    }))
    .filter((part: { partNumber: number; etag: string }) => part.partNumber > 0 && part.etag);

  if (!normalizedParts.length) {
    return NextResponse.json({ ok: false, error: "At least one valid uploaded part is required." }, { status: 400 });
  }

  try {
    const completed = await completeMultipartVideoUpload({
      key,
      uploadId,
      parts: normalizedParts,
    });

    console.log("KRISTO_MULTIPART_UPLOAD_COMPLETE", {
      uploadId,
      key,
      partCount: normalizedParts.length,
      videoUrl: completed.videoUrl,
    });

    const repack = await repackVideoFaststartForKey({
      key,
      videoUrl: completed.videoUrl,
    });

    if (!repack.faststart && repack.skipped && repack.reason === "object-too-large-for-inline-remux") {
      scheduleVideoFaststartRepack({ key, videoUrl: completed.videoUrl });
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...completed,
        faststart: repack.faststart === true,
        faststartPending: !repack.faststart,
        faststartReason: repack.reason || repack.error || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_MULTIPART_UPLOAD_COMPLETE_ERROR", { message, uploadId });
    return NextResponse.json({ ok: false, error: message || "Could not finalize multipart upload." }, { status: 500 });
  }
}
