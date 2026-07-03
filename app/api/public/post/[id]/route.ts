import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolvePublicSharedPost } from "@/app/api/_lib/publicFeedPostShare";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const params = await ctx.params;
  const post = await resolvePublicSharedPost(params?.id);

  if (!post) {
    return NextResponse.json({ ok: false, error: "Post not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, post });
}
