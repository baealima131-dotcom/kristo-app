import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import { guardAuth } from "@/app/api/_lib/rbac";

export const runtime = "nodejs";

const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

const PUBLIC_DIR = path.join(process.cwd(), "public");
const UPLOAD_DIR = path.join(PUBLIC_DIR, "uploads", "room-attachments");

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function safeName(name: string) {
  return String(name || "attachment")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function extFrom(file: File) {
  const byName = path.extname(String(file.name || "")).trim();
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
      { ok: false, error: kind === "image" ? "Image too large (max 12MB)" : "File too large (max 25MB)" },
      { status: 400 }
    );
  }

  ensureDir();

  const ext = extFrom(file) || (kind === "image" ? ".jpg" : ".bin");
  const base = safeName(path.basename(String(file.name || "attachment"), path.extname(String(file.name || ""))));
  const filename = `room_${Date.now()}_${Math.random().toString(16).slice(2)}_${base}${ext}`;
  const absPath = path.join(UPLOAD_DIR, filename);

  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(absPath, buf);

  const url = `/uploads/room-attachments/${filename}`;
  const mime = String(file.type || "application/octet-stream");

  return NextResponse.json({
    ok: true,
    data: {
      url,
      filename: String(file.name || filename),
      mime,
      mimeType: mime,
      size: file.size,
      kind,
    },
  });
}
