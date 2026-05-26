import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import { guard } from "@/app/api/_lib/rbac";
import { rateLimit } from "@/app/api/_lib/rateLimit";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB
const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads", "ministries");

function ensureDir() {
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
  if (mime === "image/jpeg") return ".jpg";
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
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded", details: { resetInMs: rl.resetInMs } },
      { status: 429 }
    );
  }
  return null;
}

export async function POST(req: NextRequest) {
  const limited = await applyRateLimit(req);
  if (limited) return limited;

  const ctxOrRes = await guard(req, ["Pastor", "Church_Admin", "Ministry_Leader"]);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
  }

  if (!isAllowedImage(file)) {
    return NextResponse.json({ ok: false, error: "Only image files are allowed" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ ok: false, error: "Image too large (max 8MB)" }, { status: 400 });
  }

  ensureDir();

  const ext = extFrom(file);
  const base = safeName(path.basename(String(file.name || "image"), path.extname(String(file.name || ""))));
  const filename = `ministry_${Date.now()}_${Math.random().toString(16).slice(2)}_${base}${ext}`;
  const absPath = path.join(UPLOAD_DIR, filename);

  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);

  const url = `/uploads/ministries/${filename}`;

  return NextResponse.json({
    ok: true,
    data: {
      url,
      filename,
      size: file.size,
      mime: file.type || "application/octet-stream",
    },
  });
}
