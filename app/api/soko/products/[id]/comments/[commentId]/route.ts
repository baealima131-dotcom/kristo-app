import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth, guardPlatformOfflineActivation } from "@/app/api/_lib/rbac";
import {
  dbDeleteOwnComment,
  dbHideProductComment,
} from "@/app/api/_lib/store/sokoEngagementDb";
import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id, commentId } = await context.params;
  try {
    const result = await dbDeleteOwnComment(id, commentId, auth.viewer.userId);
    return reply({ ok: true, ...result });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 400);
    return reply(
      { ok: false, error: error instanceof Error ? error.message : "Could not delete comment." },
      status
    );
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; commentId: string }> }
) {
  const admin = await guardPlatformOfflineActivation(req, ["System_Admin"]);
  const auth = admin instanceof NextResponse ? await guardCheckoutAuth(req) : null;
  if (admin instanceof NextResponse && auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  if ((body as { action?: unknown }).action !== "hide") {
    return reply({ ok: false, error: "Unsupported moderation action." }, 400);
  }
  const note = String((body as { note?: unknown }).note || "").trim();
  const { id, commentId } = await context.params;

  if (!(admin instanceof NextResponse)) {
    const result = await dbHideProductComment({
      productId: id,
      commentId,
      actorUserId: admin.viewer.userId,
      actorRole: "System_Admin",
      note,
    });
    return reply({ ok: true, ...result });
  }

  if (!auth || auth instanceof NextResponse) return reply({ ok: false, error: "Unauthorized" }, 401);
  const product = await getSokoProductById(id);
  if (!product) return reply({ ok: false, error: "Product not found." }, 404);
  if (product.sellerUserId !== auth.viewer.userId) {
    return reply({ ok: false, error: "Forbidden." }, 403);
  }
  const result = await dbHideProductComment({
    productId: id,
    commentId,
    actorUserId: auth.viewer.userId,
    actorRole: "seller",
    note,
  });
  return reply({ ok: true, ...result });
}
