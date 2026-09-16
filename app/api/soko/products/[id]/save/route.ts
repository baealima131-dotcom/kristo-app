import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { dbGuardLikeSaveRate, dbLoadWritableProduct, dbSetProductSave } from "@/app/api/_lib/store/sokoEngagementDb";

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
  const saved = (body as { saved?: unknown }).saved === true;
  const allowed = await dbGuardLikeSaveRate(auth.viewer.userId, "save");
  if (!allowed) return reply({ ok: false, error: "Too many save attempts. Please wait." }, 429);
  const result = await dbSetProductSave(id, auth.viewer.userId, saved);
  return reply({ ok: true, ...result });
}
