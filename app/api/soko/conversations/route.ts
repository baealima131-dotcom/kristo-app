import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { getSokoProductById } from "@/app/api/_lib/store/sokoProductsDb";
import {
  dbListSokoBuyerSellerConversations,
  dbOpenSokoBuyerSellerConversation,
  evaluateOpenSokoBuyerSellerConversation,
  parseOpenSokoConversationBody,
} from "@/app/api/_lib/store/sokoBuyerSellerChatDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function publicConversation(
  conversation: Awaited<ReturnType<typeof dbOpenSokoBuyerSellerConversation>>,
  viewerUserId: string
) {
  const peerUserId =
    conversation.buyerUserId === viewerUserId
      ? conversation.sellerUserId
      : conversation.buyerUserId;
  return {
    id: conversation.id,
    productId: conversation.productId,
    productTitle: conversation.productTitle,
    buyerUserId: conversation.buyerUserId,
    sellerUserId: conversation.sellerUserId,
    peerUserId,
    title: conversation.productTitle || "SOKO conversation",
    subtitle: conversation.lastMessagePreview,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt,
  };
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const conversations = await dbListSokoBuyerSellerConversations(
      auth.viewer.userId
    );
    return reply({
      ok: true,
      conversations: conversations.map((row) =>
        publicConversation(row, auth.viewer.userId)
      ),
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
      productTitle: String(
        (product as { title?: unknown }).title || ""
      ),
    });

    return reply({
      ok: true,
      conversation: publicConversation(conversation, auth.viewer.userId),
    });
  } catch {
    return reply({ ok: false, error: "Could not open conversation." }, 503);
  }
}
