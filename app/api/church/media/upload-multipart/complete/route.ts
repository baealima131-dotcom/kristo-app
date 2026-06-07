import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guard } from "@/app/api/_lib/rbac";
import {
  completeMultipartVideoUpload,
  getVideoStorageConfig,
  patchStorageObjectDeliveryMetadata,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";
import { brandedVideoPosterFields } from "@/app/api/_lib/media/brandedVideoPoster";
import {
  ensureVideoPosterForUrl,
  shouldAttemptServerFfmpeg,
} from "@/app/api/_lib/media/videoPoster";
import {
  repackVideoFaststartForKey,
  resolveFaststartResponseFields,
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
  const postId = String(body?.postId || body?.feedId || "").trim() || null;
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

    try {
      await patchStorageObjectDeliveryMetadata({ key });
      console.log("KRISTO_VIDEO_OBJECT_METADATA_PATCHED", {
        key,
        videoUrl: completed.videoUrl,
      });
    } catch (metadataError) {
      console.log("KRISTO_VIDEO_OBJECT_METADATA_PATCH_FAILED", {
        key,
        videoUrl: completed.videoUrl,
        error:
          metadataError instanceof Error ? metadataError.message : String(metadataError),
      });
    }

    const repack = await repackVideoFaststartForKey({
      key,
      videoUrl: completed.videoUrl,
      postId,
    });

    if (!repack.faststart && repack.skipped && repack.reason === "object-too-large-for-inline-remux") {
      scheduleVideoFaststartRepack({ key, videoUrl: completed.videoUrl, postId });
    }

    const faststartFields = resolveFaststartResponseFields(repack);
    let posterUri: string | null = null;
    let brandedPoster = false;

    if (shouldAttemptServerFfmpeg()) {
      try {
        posterUri = await ensureVideoPosterForUrl(completed.videoUrl);
      } catch (posterError) {
        console.log("KRISTO_VIDEO_POSTER_REMOTE_FAILED", {
          videoUrl: completed.videoUrl,
          stage: "multipart-complete",
          error: posterError instanceof Error ? posterError.message : String(posterError),
        });
      }
    } else {
      console.log("KRISTO_VIDEO_POSTER_SKIPPED", {
        videoUrl: completed.videoUrl,
        reason: "server-ffmpeg-disabled",
        postId,
      });
    }

    if (!posterUri) {
      const branded = brandedVideoPosterFields();
      posterUri = branded.posterUri;
      brandedPoster = true;
    }

    if (repack.faststart) {
      console.log("KRISTO_VIDEO_FASTSTART_REPACK_DONE", {
        videoUrl: completed.videoUrl,
        key,
        posterUri: posterUri || null,
      });
    } else {
      console.log("KRISTO_VIDEO_FASTSTART_REPACK_FAILED", {
        videoUrl: completed.videoUrl,
        key,
        faststartPending: faststartFields.faststartPending,
        faststartReason: faststartFields.faststartReason,
        posterUri: posterUri || null,
      });
    }

    return NextResponse.json({
      ok: true,
      data: {
        ...completed,
        ...faststartFields,
        posterUri,
        ...(brandedPoster ? { brandedPoster: true } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("KRISTO_MULTIPART_UPLOAD_COMPLETE_ERROR", { message, uploadId });
    return NextResponse.json({ ok: false, error: message || "Could not finalize multipart upload." }, { status: 500 });
  }
}
