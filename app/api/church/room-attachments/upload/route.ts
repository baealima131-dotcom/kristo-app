import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import { uploadBufferToStorage } from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function safeName(name: string) {
  return String(name || "attachment")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extFrom(file: File) {
  const byName = String(file.name || "").match(/(\.[a-z0-9]+)$/i)?.[1];
  if (byName) return byName.toLowerCase();

  const mime = String(file.type || "").toLowerCase();
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("plain")) return ".txt";
  if (mime.includes("word")) return ".docx";
  if (mime.includes("sheet") || mime.includes("excel")) return ".xlsx";
  return "";
}

function classifyKind(file: File): "image" | "file" {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  return "file";
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guardAuth(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const churchId =
    safeName(
      String(
        (ctxOrRes as any)?.viewer?.churchId ||
          req.headers.get("x-kristo-church-id") ||
          "unknown"
      ).trim()
    ) || "unknown";

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
  }

  const kind = classifyKind(file);
  const maxSize = kind === "image" ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
  if (file.size > maxSize) {
    return NextResponse.json(
      {
        ok: false,
        code: "ROOM_ATTACHMENT_TOO_LARGE",
        error:
          kind === "image"
            ? "Image too large. Please choose a smaller image."
            : "File too large. Please choose a smaller file.",
      },
      { status: 413 }
    );
  }

  const ext = extFrom(file) || (kind === "image" ? ".jpg" : ".bin");
  const base = safeName(String(file.name || "attachment").replace(/\.[^.]+$/, "")) || "attachment";
  const safeFileName = `${base}${ext}`;
  // room-attachments/{churchId}/{timestamp}_{safeName}
  const key = `room-attachments/${churchId}/${Date.now()}_${safeFileName}`;
  const mime = String(file.type || "application/octet-stream");

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { publicUrl } = await uploadBufferToStorage({
      key,
      body: buf,
      contentType: mime,
    });

    return NextResponse.json({
      ok: true,
      data: {
        url: publicUrl,
        filename: String(file.name || safeFileName),
        mime,
        mimeType: mime,
        size: file.size,
        kind,
      },
    });
  } catch (e: any) {
    // Never throw a 500 to the client. Object storage misconfiguration or a
    // transient upload failure returns clean JSON the app can surface gracefully.
    console.error("[room-attachments] upload failed", e?.message || e);
    return NextResponse.json(
      {
        ok: false,
        code: "ROOM_ATTACHMENT_UPLOAD_FAILED",
        error: "Could not upload attachment. Please try again.",
      },
      { status: 502 }
    );
  }
}
