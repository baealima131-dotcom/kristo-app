import { NextRequest, NextResponse } from "next/server";

import { resolveActorIdentity } from "@/app/api/_lib/notificationActor";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  conversationIdentityKey,
  inboxRoleForViewer,
  listingAvailabilityLabel,
  parseInboxListQuery,
  tradeStatusFromOrderStatus,
} from "@/app/api/_lib/sokoBuyerSellerChatPolicy";
import {
  dbLatestOrderStatusForConversations,
  dbListSokoBuyerSellerConversations,
  dbOpenSokoBuyerSellerConversation,
  evaluateOpenSokoBuyerSellerConversation,
  parseOpenSokoConversationBody,
  type SokoBuyerSellerConversation,
} from "@/app/api/_lib/store/sokoBuyerSellerChatDb";
import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

type Person = {
  userId: string;
  name: string;
  avatarUrl: string;
};

function person(userId: string, identity?: { name: string; avatar: string }): Person {
  const id = String(userId || "").trim();
  return {
    userId: id,
    name: String(identity?.name || "").trim() || "SOKO member",
    avatarUrl: String(identity?.avatar || "").trim(),
  };
}

function publicConversation(
  conversation: SokoBuyerSellerConversation,
  viewerUserId: string,
  extra?: {
    buyer?: Person;
    seller?: Person;
    product?: {
      id: string;
      title: string;
      image: string;
      price: number | string;
      currency: string;
      quantity: string;
      status: string;
      available: boolean;
      availabilityLabel: string;
    };
    tradeStatus?: string;
  }
) {
  const role = inboxRoleForViewer(conversation, viewerUserId);
  const buyer = extra?.buyer || person(conversation.buyerUserId);
  const seller = extra?.seller || person(conversation.sellerUserId);
  const peer = role === "buying" ? seller : buyer;
  const product = extra?.product || {
    id: conversation.productId,
    title: conversation.productTitle,
    image: conversation.productImage,
    price: conversation.productPrice,
    currency: conversation.productCurrency,
    quantity: conversation.productQuantity,
    status: "",
    available: Boolean(conversation.productTitle),
    availabilityLabel: listingAvailabilityLabel({
      found: Boolean(conversation.productTitle),
    }),
  };

  return {
    id: conversation.id,
    conversationId: conversation.id,
    productId: conversation.productId,
    productTitle: product.title || conversation.productTitle,
    buyerUserId: conversation.buyerUserId,
    sellerUserId: conversation.sellerUserId,
    peerUserId: peer.userId,
    role,
    buyer,
    seller,
    peer,
    product,
    tradeStatus: extra?.tradeStatus || "Inquiry",
    unreadCount: conversation.unreadCount,
    title:
      role === "selling"
        ? buyer.name
        : product.title || conversation.productTitle || "SOKO conversation",
    subtitle: conversation.lastMessagePreview,
    lastMessagePreview: conversation.lastMessagePreview,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt,
  };
}

async function identitiesFor(userIds: string[]) {
  const unique = [...new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (userId) => [userId, await resolveActorIdentity(userId)] as const)
  );
  return new Map(entries);
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const query = parseInboxListQuery(req.nextUrl.searchParams);

  try {
    const conversations = await dbListSokoBuyerSellerConversations(
      auth.viewer.userId,
      { limit: query.limit }
    );
    const visible = query.role
      ? conversations.filter(
          (row) => inboxRoleForViewer(row, auth.viewer.userId) === query.role
        )
      : conversations;

    const productIds = [
      ...new Set(visible.map((row) => row.productId).filter(Boolean)),
    ];
    const products = new Map(
      (
        await Promise.all(
          productIds.map(async (productId) => {
            try {
              const product = await getSokoProductById(productId);
              return [productId, product] as const;
            } catch {
              return [productId, null] as const;
            }
          })
        )
      )
    );

    const people = await identitiesFor(
      visible.flatMap((row) => [row.buyerUserId, row.sellerUserId])
    );
    const orders = await dbLatestOrderStatusForConversations(visible);

    return reply({
      ok: true,
      conversations: visible.map((row) => {
        const live = products.get(row.productId);
        const found = Boolean(live);
        const status = String((live as { status?: unknown } | null)?.status || "");
        const soldOut = Boolean((live as { soldOut?: unknown } | null)?.soldOut);
        const availabilityLabel = listingAvailabilityLabel({
          found,
          status,
          soldOut,
        });
        const image = String(
          (live as { image?: unknown } | null)?.image || row.productImage || ""
        ).trim();
        const title = String(
          (live as { title?: unknown } | null)?.title || row.productTitle || ""
        ).trim();
        const price =
          live && "price" in live
            ? (live as { price?: unknown }).price
            : row.productPrice;
        const currency = String(
          (live as { currency?: unknown } | null)?.currency ||
            row.productCurrency ||
            ""
        ).trim();
        const quantity = String(
          (live as { quantity?: unknown } | null)?.quantity ||
            (live as { stockAvailable?: unknown } | null)?.stockAvailable ||
            row.productQuantity ||
            ""
        );

        return publicConversation(row, auth.viewer.userId, {
          buyer: person(row.buyerUserId, people.get(row.buyerUserId)),
          seller: person(row.sellerUserId, people.get(row.sellerUserId)),
          product: {
            id: row.productId,
            title,
            image,
            price: price as number | string,
            currency,
            quantity,
            status,
            available: availabilityLabel !== "Listing unavailable",
            availabilityLabel,
          },
          tradeStatus: tradeStatusFromOrderStatus(
            orders.get(
              conversationIdentityKey(
                row.buyerUserId,
                row.sellerUserId,
                row.productId
              )
            )
          ),
        });
      }),
    });
  } catch {
    return reply({ ok: false, error: "Could not load conversations." }, 503);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = parseOpenSokoConversationBody(body);
  if (!parsed.ok) {
    return reply({ ok: false, error: parsed.error }, parsed.status);
  }

  try {
    const product = await getSokoProductById(parsed.productId);
    const sellerUserId = String(product?.sellerUserId || "").trim();
    const opened = evaluateOpenSokoBuyerSellerConversation({
      buyerUserId: auth.viewer.userId,
      sellerUserId,
      productFound: Boolean(product),
      productStatus: String((product as { status?: unknown } | null)?.status || ""),
    });
    if (!opened.ok || !product) {
      return reply(
        { ok: false, error: opened.ok ? "Product not found." : opened.error },
        opened.ok ? 404 : opened.status
      );
    }

    const conversation = await dbOpenSokoBuyerSellerConversation({
      buyerUserId: auth.viewer.userId,
      sellerUserId,
      productId: parsed.productId,
      productTitle: String((product as { title?: unknown }).title || ""),
      productImage: String((product as { image?: unknown }).image || ""),
      productPrice: String((product as { price?: unknown }).price ?? ""),
      productCurrency: String((product as { currency?: unknown }).currency || ""),
      productQuantity: String(
        (product as { quantity?: unknown }).quantity ??
          (product as { stockAvailable?: unknown }).stockAvailable ??
          ""
      ),
    });

    const people = await identitiesFor([
      conversation.buyerUserId,
      conversation.sellerUserId,
    ]);
    const availabilityLabel = listingAvailabilityLabel({
      found: true,
      status: String((product as { status?: unknown }).status || ""),
      soldOut: Boolean((product as { soldOut?: unknown }).soldOut),
    });

    return reply({
      ok: true,
      conversation: publicConversation(conversation, auth.viewer.userId, {
        buyer: person(conversation.buyerUserId, people.get(conversation.buyerUserId)),
        seller: person(
          conversation.sellerUserId,
          people.get(conversation.sellerUserId)
        ),
        product: {
          id: conversation.productId,
          title: String((product as { title?: unknown }).title || conversation.productTitle),
          image: String((product as { image?: unknown }).image || ""),
          price: (product as { price?: unknown }).price as number | string,
          currency: String((product as { currency?: unknown }).currency || ""),
          quantity: String(
            (product as { quantity?: unknown }).quantity ??
              (product as { stockAvailable?: unknown }).stockAvailable ??
              ""
          ),
          status: String((product as { status?: unknown }).status || ""),
          available: availabilityLabel !== "Listing unavailable",
          availabilityLabel,
        },
        tradeStatus: "Inquiry",
      }),
    });
  } catch {
    return reply({ ok: false, error: "Could not open conversation." }, 503);
  }
}
