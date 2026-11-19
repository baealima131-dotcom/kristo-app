import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Profile pictures saved to local disk (server without object storage: profileAvatarUpload.ts
 * writes public/uploads/profile-avatars/<user>-<time>.<ext>). A production server (`next start`)
 * only serves public/ files that existed at build time, so pictures saved later answered 404 and
 * the avatar went blank after reopening the app. This serves those files.
 *
 * Only this folder, only file names the uploader creates (no "/" or ".."), images only.
 * With object storage (Vercel production) avatars are https URLs and never reach this route.
 */
const FILE_NAME = /^[A-Za-z0-9_-]{1,120}-\d{10,16}\.(jpg|jpeg|png|webp)$/i;
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const AVATAR_DIR = path.join(process.cwd(), "public", "uploads", "profile-avatars");

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const name = String(file || "");
  const match = name.match(FILE_NAME);
  if (!match) return notFound();

  const filePath = path.join(AVATAR_DIR, name);
  if (path.dirname(filePath) !== AVATAR_DIR) return notFound();

  try {
    const body = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "content-type": CONTENT_TYPES[match[1].toLowerCase()] || "application/octet-stream",
        // File names carry the save time, so a new picture always has a new URL.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
