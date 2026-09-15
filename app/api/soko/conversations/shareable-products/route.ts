import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  filterShareableProducts,
  parseShareableProductsQuery,
  productShareAvailabilityLabel,
} from "@/app/api/_lib/sokoBuyerSellerChatPolicy";
import { listShareableSokoProductsForOwner } from "@/app/api/_lib/store/sokoProductsDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const query = parseShareableProductsQuery(req.nextUrl.searchParams);

  try {
    const owned = await listShareableSokoProductsForOwner(auth.viewer.userId);
    const products = filterShareableProducts(owned, query).map((product) => {
      const availabilityLabel = productShareAvailabilityLabel({
        found: true,
        status: product.status,
        soldOut: product.soldOut,
      });
      return {
        id: product.id,
        title: product.title,
        image: product.image,
        price: product.price,
        currency: product.currency,
        quantity: product.quantity,
        status: product.status,
        soldOut: product.soldOut,
        availabilityLabel,
        available: availabilityLabel === "Available",
      };
    });

    return reply({ ok: true, products });
  } catch {
    return reply({ ok: false, error: "Could not load products." }, 503);
  }
}
