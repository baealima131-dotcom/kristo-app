import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

import { guard } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import {
  getVideoStorageConfig,
  uploadBufferToStorage,
} from "@/app/api/_lib/media/objectStorage";
import { isServerlessRuntime } from "@/app/api/_lib/profileAvatarUpload";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ApiErr = { ok: false; error: string; code?: string; details?: unknown };

function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function safeFilename(raw: string) {
  const base = String(raw || "ministry-avatar")
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return base.slice(0, 180) || "ministry-avatar";
}

function inferExt(name: string, mime: string): string {
  const lower = name.toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (/\.[a-z0-9]{1,8}$/i.test(lower)) {
    return lower.split(".").pop() || "jpg";
  }
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("heic") || m.includes("heif")) return "jpg";
  return "jpg";
}

function isImageMime(mime: string) {
  return String(mime || "").toLowerCase().startsWith("image/");
}

function ministryAvatarResponseFields(url: string) {
  const normalized = String(url || "").trim();
  return {
    url: normalized,
    avatar: normalized,
    avatarUri: normalized,
    avatarUrl: normalized,
    ministryAvatarUrl: normalized,
  };
}

export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(req, { name: "ministries-upload", limit: 30, windowMs: 60_000 });
    if (!rl.allowed) {
      return json(
        { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } } satisfies ApiErr,
        { status: 429 }
      );
    }

    const ctxOrRes = await guard(req, [
      "Pastor",
      "Church_Admin",
      "Ministry_Leader",
      "System_Admin",
    ]);
    if (ctxOrRes instanceof NextResponse) return ctxOrRes;

    const { churchId, viewer } = ctxOrRes;

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return json(
        { ok: false, error: "Expected multipart/form-data upload" } satisfies ApiErr,
        { status: 400 }
      );
    }

    const form = (await req.formData()) as unknown as {
      get(name: string): FormDataEntryValue | null;
    };
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "file is required" } satisfies ApiErr, { status: 400 });
    }

    const ministryId = String(form.get("ministryId") || "").trim();
    const bytes = Buffer.from(await file.arrayBuffer());
    const size = bytes.byteLength;
    const mime =
      String(file.type || "application/octet-stream").trim() || "application/octet-stream";
    const filename = safeFilename(file.name || "ministry-avatar.jpg");

    if (!isImageMime(mime)) {
      return json(
        { ok: false, error: "Only image uploads are supported for ministry avatars." } satisfies ApiErr,
        { status: 400 }
      );
    }

    if (size > MAX_IMAGE_BYTES) {
      return json(
        {
          ok: false,
          error: "Image is too large.",
          code: "MINISTRY_AVATAR_TOO_LARGE",
        } satisfies ApiErr,
        { status: 413 }
      );
    }

    if (size <= 0) {
      return json({ ok: false, error: "Empty file" } satisfies ApiErr, { status: 400 });
    }

    const ext = inferExt(filename, mime);
    const safeChurch = churchId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeMinistry = (ministryId || "general").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeUser = String(viewer.userId || "user").replace(/[^a-zA-Z0-9_-]/g, "_");
    const storageName = `${Date.now()}_${safeUser}_${Math.random().toString(16).slice(2)}.${ext}`;
    const storageKey = `uploads/ministry-avatars/${safeChurch}/${safeMinistry}/${storageName}`;

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
        "ministry-avatars",
        safeChurch,
        safeMinistry
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, storageName), bytes);
      url = `/uploads/ministry-avatars/${safeChurch}/${safeMinistry}/${storageName}`;
    } else {
      console.log("KRISTO_MINISTRY_AVATAR_UPLOAD_STORAGE_MISSING", {
        churchId,
        ministryId,
        userId: viewer.userId,
        size,
        mime,
      });
      return json(
        { ok: false, error: "Ministry avatar storage is not configured." } satisfies ApiErr,
        { status: 503 }
      );
    }

    console.log("KRISTO_MINISTRY_AVATAR_UPLOAD_OK", {
      churchId,
      ministryId,
      userId: viewer.userId,
      size,
      mime,
      filename,
      url: url.slice(0, 160),
    });

    return json({
      ok: true,
      data: {
        ...ministryAvatarResponseFields(url),
        filename,
        mime,
        mimeType: mime,
        size,
        ministryId: ministryId || null,
      },
    });
  } catch (e: unknown) {
    console.log("KRISTO_MINISTRY_AVATAR_UPLOAD_ERROR", {
      message: String((e as any)?.message || e),
    });
    return json(
      { ok: false, error: (e as any)?.message || "Upload failed" } satisfies ApiErr,
      { status: 500 }
    );
  }
}
