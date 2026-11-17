import { readSellerBlocks } from "@/app/api/_lib/store/sokoSellerBlocksDb";
import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { dbListSavedProducts } from "@/app/api/_lib/store/sokoEngagementDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;
  const products = await dbListSavedProducts(auth.viewer.userId);
  const blocked = new Set((await readSellerBlocks(auth.viewer.userId)).productIds);
  return NextResponse.json(
    { ok: true, products: products.filter(product => !blocked.has(String(product.id))) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
