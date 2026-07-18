import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import {
  getVideoStorageConfig,
  uploadBufferToStorage,
} from "@/app/api/_lib/media/objectStorage";
import { isServerlessRuntime } from "@/app/api/_lib/profileAvatarUpload";
import {
  assertSafetyEnforcementAllows,
} from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function getHeaders(req: Request) {
  return {
    churchId: String(req.headers.get("x-kristo-church-id") || "").trim(),
    userId: String(req.headers.get("x-kristo-user-id") || "").trim(),
  };
}

function safeFilename(raw: string) {
  const base = String(raw || "attachment")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 180) || "attachment";
}

function inferExt(name: string, mime: string): string {
  const lower = name.toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (/\.[a-z0-9]{1,8}$/i.test(lower)) {
    return lower.split(".").pop() || "bin";
  }
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  if (m.includes("heic") || m.includes("heif")) return "jpg";
  if (m.includes("pdf")) return "pdf";
  return "bin";
}

function isImageMime(mime: string) {
  return String(mime || "").toLowerCase().startsWith("image/");
}

export async function POST(req: Request) {
  try {
    const { churchId, userId } = getHeaders(req);
    if (!churchId || !userId) {
      return NextResponse.json({ ok: false, error: "Missing auth headers" }, { status: 401 });
    }

    const safetyBlocked =
      await assertSafetyEnforcementAllows(
        userId,
        req.method
      );
    if (safetyBlocked) {
      return safetyBlocked;
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { ok: false, error: "Expected multipart/form-data upload" },
        { status: 400 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const size = bytes.byteLength;
    const mime =
      String(file.type || "application/octet-stream").trim() || "application/octet-stream";
    const filename = safeFilename(file.name || (isImageMime(mime) ? "image.jpg" : "attachment"));

    const maxBytes = isImageMime(mime) ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (size > maxBytes) {
      return NextResponse.json(
        {
          ok: false,
          error: isImageMime(mime) ? "Image is too large." : "File is too large.",
          code: "ROOM_ATTACHMENT_TOO_LARGE",
        },
        { status: 413 }
      );
    }

    if (size <= 0) {
      return NextResponse.json({ ok: false, error: "Empty file" }, { status: 400 });
    }

    const ext = inferExt(filename, mime);
    const safeChurch = churchId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storageName = `${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;
    const storageKey = `uploads/room-attachments/${safeChurch}/${safeUser}/${storageName}`;

    let url = "";

    if (getVideoStorageConfig()) {
      const uploaded = await uploadBufferToStorage({
        key: storageKey,
        body: bytes,
        contentType: mime,
      });
      url = uploaded.publicUrl;
    } else if (!isServerlessRuntime()) {
      const dir = path.join(
        process.cwd(),
        "public",
        "uploads",
        "room-attachments",
        safeChurch,
        safeUser
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, storageName), bytes);
      url = `/uploads/room-attachments/${safeChurch}/${safeUser}/${storageName}`;
    } else {
      console.log("KRISTO_ROOM_ATTACHMENT_UPLOAD_STORAGE_MISSING", {
        churchId,
        userId,
        size,
        mime,
      });
      return NextResponse.json(
        { ok: false, error: "Attachment storage is not configured." },
        { status: 503 }
      );
    }

    console.log("KRISTO_ROOM_ATTACHMENT_UPLOAD_OK", {
      churchId,
      userId,
      size,
      mime,
      filename,
      url: url.slice(0, 160),
    });

    return NextResponse.json({
      ok: true,
      data: {
        url,
        filename,
        mime,
        mimeType: mime,
        size,
      },
    });
  } catch (e: any) {
    console.log("KRISTO_ROOM_ATTACHMENT_UPLOAD_ERROR", {
      message: String(e?.message || e),
    });
    return NextResponse.json(
      { ok: false, error: e?.message || "Upload failed" },
      { status: 500 }
    );
  }
}
