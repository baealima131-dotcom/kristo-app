import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/app/api/_lib/auth";
import { dbEngagementForProducts } from "@/app/api/_lib/store/sokoEngagementDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  let viewerUserId = "";
  try {
    const viewer = await getViewer(req);
    viewerUserId = String(viewer.userId || "").trim();
  } catch {
    viewerUserId = "";
  }
  const map = await dbEngagementForProducts([id], viewerUserId);
  return NextResponse.json(
    { ok: true, engagement: map.get(id) || null },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
