import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/app/api/_lib/auth";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  dbCreateProductComment,
  dbListProductComments,
  dbLoadWritableProduct,
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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await getViewer(req);
  } catch {
    // Public comment reads stay available to guests after the auth check.
  }
  const { id } = await context.params;
  const product = await getSokoProductById(id);
  if (!product || String(product.status || "") === "Deleted") {
    return reply({ ok: false, error: "Product not found." }, 404);
  }
  const cursor = req.nextUrl.searchParams.get("cursor") || "";
  const page = await dbListProductComments(id, cursor);
  return reply({ ok: true, ...page });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const product = await dbLoadWritableProduct(id);
  if (product.error === "missing") return reply({ ok: false, error: "Product not found." }, 404);
  if (product.error === "inactive") return reply({ ok: false, error: "This listing is unavailable." }, 409);
  const body = await req.json().catch(() => ({}));
  try {
    const created = await dbCreateProductComment(
      id,
      auth.viewer.userId,
      (body as { body?: unknown }).body
    );
    return reply({ ok: true, ...created });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 400);
    return reply(
      { ok: false, error: error instanceof Error ? error.message : "Could not post comment." },
      status
    );
  }
}
