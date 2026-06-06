import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import { guard } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";
import { isVercelRuntime } from "@/app/api/_lib/store/authDb";
import {
  getVideoStorageConfig,
  uploadBufferToStorage,
  videoStorageConfigError,
} from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB
const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads", "ministries");

type ApiErr = { ok: false; error: string; details?: unknown };

function json<T extends Record<string, unknown>>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

function ensureLocalDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function safeName(name: string) {
  return String(name || "image")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extFrom(file: File) {
  const byName = path.extname(String(file.name || "")).trim();
  if (byName) return byName.toLowerCase();

  const mime = String(file.type || "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/heic") return ".heic";
  return ".jpg";
}

function isAllowedImage(file: File) {
  const mime = String(file.type || "").toLowerCase();
  return (
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    mime === "image/heic"
  );
}

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  const rl = await rateLimit(req, { name: "ministry-upload", limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } } satisfies ApiErr,
      { status: 429 }
    );
  }
  return null;
}

async function saveToLocalFilesystem(file: File, filename: string) {
  ensureLocalDir();
  const absPath = path.join(UPLOAD_DIR, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);
  return `/uploads/ministries/${filename}`;
}

export async function POST(req: NextRequest) {
  let churchId = "";
  let userId = "";
  let ministryId = "";
  let storageMode: "object-storage" | "local-fs" = "local-fs";

  try {
    const limited = await applyRateLimit(req);
    if (limited) return limited;

    const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Ministry_Leader"]);
    if (ctxOrRes instanceof NextResponse) return ctxOrRes;

    churchId = String(ctxOrRes.churchId || req.headers.get("x-kristo-church-id") || "").trim();
    userId = String(ctxOrRes.viewer?.userId || "").trim();

    const form = await req.formData().catch(() => null);
    if (!form) {
      return json({ ok: false, error: "Invalid form data" } satisfies ApiErr, { status: 400 });
    }

    ministryId = String(form.get("ministryId") || form.get("id") || "").trim();
    const file = form.get("file");

    console.log("KRISTO_MINISTRY_PHOTO_UPLOAD_START", {
      churchId,
      userId,
      ministryId: ministryId || null,
      hasFile: file instanceof File,
      fileFieldType: file == null ? "missing" : typeof file,
      contentType: req.headers.get("content-type"),
      contentLength: req.headers.get("content-length"),
    });

    if (!(file instanceof File)) {
      return json({ ok: false, error: "file is required" } satisfies ApiErr, { status: 400 });
    }

    if (!isAllowedImage(file)) {
      return json({ ok: false, error: "Only image files are allowed" } satisfies ApiErr, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return json({ ok: false, error: "Image too large (max 8MB)" } satisfies ApiErr, { status: 400 });
    }

    const ext = extFrom(file);
    const base = safeName(
      path.basename(String(file.name || "image"), path.extname(String(file.name || "")))
    );
    const filename = `ministry_${Date.now()}_${Math.random().toString(16).slice(2)}_${base}${ext}`;
    const mime = String(file.type || "application/octet-stream");
    const storageConfig = getVideoStorageConfig();
    const useObjectStorage = isVercelRuntime() || Boolean(storageConfig);
    storageMode = useObjectStorage ? "object-storage" : "local-fs";

    let url = "";

    if (useObjectStorage) {
      if (!storageConfig) {
        const message = videoStorageConfigError();
        console.log("KRISTO_MINISTRY_PHOTO_UPLOAD_ERROR", {
          churchId,
          userId,
          ministryId: ministryId || null,
          storageMode,
          error: message,
        });
        return json({ ok: false, error: message } satisfies ApiErr, { status: 503 });
      }

      const key = [
        "ministries",
        safeName(churchId || "unknown"),
        `${Date.now()}_${filename}`,
      ].join("/");
      const buf = Buffer.from(await file.arrayBuffer());
      const uploaded = await uploadBufferToStorage({
        key,
        body: buf,
        contentType: mime,
      });
      url = uploaded.publicUrl;
    } else {
      url = await saveToLocalFilesystem(file, filename);
    }

    console.log("KRISTO_MINISTRY_PHOTO_UPLOAD_DONE", {
      churchId,
      userId,
      ministryId: ministryId || null,
      storageMode,
      urlHost: String(url).split("/").filter(Boolean).slice(0, 3).join("/"),
      size: file.size,
      mime,
    });

    return json({
      ok: true,
      data: {
        url,
        filename,
        size: file.size,
        mime,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error || "ministry_photo_upload_failed");

    console.log("KRISTO_MINISTRY_PHOTO_UPLOAD_ERROR", {
      churchId,
      userId,
      ministryId: ministryId || null,
      storageMode,
      error: message,
    });

    const lower = message.toLowerCase();
    const status =
      lower.includes("not configured") ||
      lower.includes("erofs") ||
      lower.includes("read-only")
        ? 503
        : 500;

    return json({ ok: false, error: message } satisfies ApiErr, { status });
  }
}
