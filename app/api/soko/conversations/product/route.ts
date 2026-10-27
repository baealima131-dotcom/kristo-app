import {getProfile} from "@/app/api/auth/_lib/profile";
import { readSellerBlocks } from "@/app/api/_lib/store/sokoSellerBlocksDb";
import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  authorizeSokoConversationAccess,
  cleanSokoBuyerSellerText,
  isUnavailableSokoListingStatus,
} from "@/app/api/_lib/sokoBuyerSellerChatPolicy";
import { dbGetSokoBuyerSellerConversation } from "@/app/api/_lib/store/sokoBuyerSellerChatDb";

import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";
import { sanitizeSokoCatalogProduct } from "@/app/api/_lib/sokoPublicCatalog";

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

  const conversationId = cleanSokoBuyerSellerText(
    req.nextUrl.searchParams.get("conversationId"),
    80
  );
  const productId = cleanSokoBuyerSellerText(
    req.nextUrl.searchParams.get("productId"),
    100
  );
  if (!conversationId || !productId) {
    return reply(
      { ok: false, error: "conversationId and productId are required." },
      400
    );
  }

  try {
    const conversation = await dbGetSokoBuyerSellerConversation(conversationId);
    const access = authorizeSokoConversationAccess(
      conversation,
      auth.viewer.userId
    );
    if (!access.ok) {
      return reply({ ok: false, error: access.error }, access.status);
    }

    if (!conversation || conversation.productId !== productId) return reply({ok:false,error:"Product does not belong to this conversation."},403);
    const product = await getSokoProductById(productId);
    if (product && (await readSellerBlocks(auth.viewer.userId)).sellerIds.includes(product.sellerUserId)) return reply({ok:false,error:"This seller is blocked."},404);
    const status = String((product as { status?: unknown } | null)?.status || "");
    if (!product || isUnavailableSokoListingStatus(status)) {
      return reply({ ok: false, error: "Product unavailable." }, 404);
    }

    const sellerProfile=await getProfile(product.sellerUserId).catch(()=>null);
    return reply({
      ok: true,
      product: { ...sanitizeSokoCatalogProduct(
        {
          ...product,
          seller: {
            id: String(product.sellerUserId || ""),
            name: String(sellerProfile?.fullName || (product as { seller?: { name?: unknown } }).seller?.name || ""),
            avatarUrl: String(sellerProfile?.avatarUrl || ""),
          },
        },
        { includeInternalIds: true }
      ), paymentOptions: { ...sanitizeSokoCatalogProduct(product).paymentOptions, mobileNumber: String(product.paymentOptions?.mobileNumber || ""), recipientName: String(product.paymentOptions?.recipientName || ""), cashTag: String(product.paymentOptions?.cashTag || "") } },
    });
  } catch {
    return reply({ ok: false, error: "Could not load product." }, 503);
  }
}
