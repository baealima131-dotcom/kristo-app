import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { localSokoImagesEnabled, localSokoImageRoot, parseSokoImageKey } from "@/app/api/_lib/sokoProductImages";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, context: { params: Promise<{ owner: string; filename: string }> }) {
  if (!localSokoImagesEnabled()) return new NextResponse(null, { status: 404 });
  const { owner, filename } = await context.params;
  if (!parseSokoImageKey("local/soko-products/" + owner + "/" + filename)) return new NextResponse(null, { status: 404 });
  try {
    const bytes = await fs.readFile(path.join(localSokoImageRoot(), owner, filename));
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": filename.endsWith(".png") ? "image/png" : filename.endsWith(".webp") ? "image/webp" : "image/jpeg",
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
