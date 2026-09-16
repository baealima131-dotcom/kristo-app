import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { parseShareKind } from "@/app/api/_lib/sokoEngagementPolicy";
import { dbLoadWritableProduct, dbRecordShare } from "@/app/api/_lib/store/sokoEngagementDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
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
  const kind = parseShareKind((body as { kind?: unknown }).kind);
  if (!kind) return reply({ ok: false, error: "Share result is required." }, 400);
  const result = await dbRecordShare(id, auth.viewer.userId, kind);
  if (!result.recorded) {
    return reply({ ok: false, error: "Too many share attempts. Please wait." }, 429);
  }
  return reply({
    ok: true,
    ...result,
    label: result.completedShareCount > 0 ? String(result.completedShareCount) : "Share",
  });
}
