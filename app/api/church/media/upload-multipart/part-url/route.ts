import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardChurchMediaUpload } from "@/app/api/_lib/media/churchMediaUploadAuth";
import {
  createPresignedMultipartPartUpload,
  getVideoStorageConfig,
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

  const key = String(body?.key || "").trim();
  const uploadId = String(body?.uploadId || "").trim();
  const partNumber = Number(body?.partNumber || 0);
  const contentLength = Number(body?.contentLength || 0);

  if (!key || !uploadId || !Number.isFinite(partNumber) || partNumber < 1) {
    return NextResponse.json({ ok: false, error: "key, uploadId, and partNumber are required." }, { status: 400 });
  }

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return NextResponse.json({ ok: false, error: "contentLength must be a positive number." }, { status: 400 });
  }

  try {
    const signed = await createPresignedMultipartPartUpload({
      key,
      uploadId,
      partNumber,
      contentLength,
    });

    return NextResponse.json({ ok: true, data: signed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_MULTIPART_PART_URL_ERROR", { message, partNumber });
    return NextResponse.json({ ok: false, error: message || "Could not create part upload URL." }, { status: 500 });
  }
}
