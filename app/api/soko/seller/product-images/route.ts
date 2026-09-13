import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  localSokoImagesEnabled,
  localSokoImageRoot,
  sokoImageOwner,
  sokoImageUrl,
} from "@/app/api/_lib/sokoProductImages";
import {
  SOKO_PRODUCT_IMAGE_MAX_BYTES,
  SOKO_PRODUCT_IMAGE_MAX_FILES_PER_REQUEST,
  SOKO_PRODUCT_IMAGE_MAX_REQUEST_BYTES,
  assertDurableSokoUploadResult,
  assertStoredSokoProductImageHead,
  buildSokoProductImageObjectKey,
  evaluateSokoSellerImageUploadAccess,
  inspectSokoProductImageUpload,
  selectSokoProductImageWriteTarget,
} from "@/app/api/_lib/sokoSellerProductImagePolicy";
import { guardAuth } from "@/app/api/_lib/rbac";
import { getProfile } from "@/app/api/auth/_lib/profile";
import { dbGetSokoSellerAccess } from "@/app/api/_lib/store/sokoSellerAccessDb";
import { dbGetSokoEnforcementStatus } from "@/app/api/_lib/store/sokoSafetyDb";
import {
  getVideoStorageConfig,
  headStorageObject,
  uploadBufferToStorage,
} from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest) {
  const auth = await guardAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const userId = auth.viewer.userId;
    const profile = await getProfile(userId);
    const kristoId = String(profile?.userCode || "").trim().toUpperCase();
    const access = await dbGetSokoSellerAccess({ userId, kristoId });
    const enforcement = await dbGetSokoEnforcementStatus({
      sellerUserIds: [userId],
    });
    const gate = evaluateSokoSellerImageUploadAccess({
      authenticated: true,
      kristoId,
      sellerApproved: access.approved === true,
      sellerStatus: enforcement.sellerStatus[userId] || "active",
    });
    if (!gate.ok) return reply({ ok: false, error: gate.error }, gate.status);

    const writeTarget = selectSokoProductImageWriteTarget({
      hasObjectStorage: Boolean(getVideoStorageConfig()),
      vercel: Boolean(process.env.VERCEL),
      localDev: localSokoImagesEnabled(),
    });
    if (writeTarget === "unavailable" || (writeTarget === "local" && process.env.VERCEL)) {
      return reply({
        ok: false,
        error: "SOKO image storage is not configured on the server.",
        code: "SOKO_IMAGE_STORAGE_MISSING",
      }, 503);
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
      return reply({ ok: false, error: "Expected multipart/form-data." }, 400);
    }

    if (!req.body) {
      return reply({ ok: false, error: "Image body is required." }, 400);
    }

    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > SOKO_PRODUCT_IMAGE_MAX_REQUEST_BYTES) {
          await reader.cancel();
          return reply({ ok: false, error: "Image upload is too large." }, 413);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }

    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": contentType },
    }).formData();

    const files = form.getAll("file");
    if (
      files.length !== SOKO_PRODUCT_IMAGE_MAX_FILES_PER_REQUEST ||
      !(files[0] instanceof File)
    ) {
      return reply({ ok: false, error: "Send exactly one image in the file field." }, 400);
    }

    const file = files[0];
    if (file.size < 1 || file.size > SOKO_PRODUCT_IMAGE_MAX_BYTES) {
      return reply({ ok: false, error: "Image must be between 1 byte and 8 MB." }, 413);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const inspected = inspectSokoProductImageUpload({
      bytes,
      filename: file.name,
      declaredMime: file.type,
    });
    if (!inspected.ok) {
      return reply({ ok: false, error: inspected.error }, inspected.status);
    }
    const format = inspected.format;

    const owner = sokoImageOwner(userId);
    const key = buildSokoProductImageObjectKey({
      prefix: writeTarget === "local" ? "local" : "uploads",
      ownerHex: owner,
      fileId: randomUUID(),
      extension: format.extension,
    });

    let uploaded: { key: string; publicUrl: string };
    if (writeTarget === "local") {
      const dir = path.join(localSokoImageRoot(), owner);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, key.split("/").pop()!), bytes, { flag: "wx" });
      uploaded = { key, publicUrl: sokoImageUrl(key) };
    } else {
      uploaded = await uploadBufferToStorage({
        key,
        body: bytes,
        contentType: format.mime,
      });
      uploaded = assertDurableSokoUploadResult(uploaded);
      const stored = await headStorageObject(uploaded.key);
      assertStoredSokoProductImageHead({
        key: uploaded.key,
        expectedBytes: bytes.length,
        expectedMime: format.mime,
        contentLength: stored.contentLength,
        contentType: stored.contentType,
      });
    }

    return reply({
      ok: true,
      image: {
        key: uploaded.key,
        url: uploaded.publicUrl,
        mime: format.mime,
        size: bytes.length,
      },
    }, 201);
  } catch {
    return reply({ ok: false, error: "Could not upload the SOKO image." }, 500);
  }
}
