import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  authorizeSokoConversationAccess,
  evaluateShareSokoProduct,
  parseMessagePageQuery,
  parseSendSokoConversationMessageBody,
  productSharePreviewText,
  refreshProductShareCard,
  snapshotFromTrustedProduct,
} from "@/app/api/_lib/sokoBuyerSellerChatPolicy";
import {
  dbCreateSokoBuyerSellerMessage,
  dbGetSokoBuyerSellerConversation,
  dbListSokoBuyerSellerMessages,
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

async function liveProductsById(productIds: string[]) {
  const unique = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (productId) => {
      try {
        return [productId, await getSokoProductById(productId)] as const;
      } catch {
        return [productId, null] as const;
      }
    })
  );
  return new Map(entries);
}

function publicMessage(
  message: Awaited<ReturnType<typeof dbListSokoBuyerSellerMessages>>[number],
  viewerUserId: string,
  live: Awaited<ReturnType<typeof getSokoProductById>> | null | undefined
) {
  const product =
    message.type === "product_share" && message.product
      ? refreshProductShareCard(message.product, live)
      : null;
  return {
    ...message,
    mine: message.senderUserId === viewerUserId,
    product,
  };
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const page = parseMessagePageQuery(req.nextUrl.searchParams);
  if (!page.conversationId) {
    return reply({ ok: false, error: "conversationId is required." }, 400);
  }

  try {
    const conversation = await dbGetSokoBuyerSellerConversation(
      page.conversationId
    );
    const access = authorizeSokoConversationAccess(
      conversation,
      auth.viewer.userId
    );
    if (!access.ok) {
      return reply({ ok: false, error: access.error }, access.status);
    }

    const messages = await dbListSokoBuyerSellerMessages({
      conversationId: page.conversationId,
      limit: page.limit + 1,
      before: page.before,
    });
    const hasMore = messages.length > page.limit;
    const pageRows = hasMore ? messages.slice(1) : messages;
    const live = await liveProductsById(
      pageRows
        .map((message) => message.product?.productId || "")
        .filter(Boolean)
    );

    return reply({
      ok: true,
      conversationId: page.conversationId,
      hasMore,
      nextBefore: pageRows[0]?.createdAt || "",
      messages: pageRows.map((message) =>
        publicMessage(
          message,
          auth.viewer.userId,
          message.product?.productId
            ? live.get(message.product.productId)
            : null
        )
      ),
    });
  } catch {
    return reply({ ok: false, error: "Could not load messages." }, 503);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = parseSendSokoConversationMessageBody(body);
  if (!parsed.ok) {
    return reply({ ok: false, error: parsed.error }, parsed.status);
  }

  try {
    const conversation = await dbGetSokoBuyerSellerConversation(
      parsed.conversationId
    );
    const access = authorizeSokoConversationAccess(
      conversation,
      auth.viewer.userId
    );
    if (!access.ok) {
      return reply({ ok: false, error: access.error }, access.status);
    }

    if (parsed.kind === "product_share") {
      const product = await getSokoProductById(parsed.productId);
      const shared = evaluateShareSokoProduct({
        senderUserId: auth.viewer.userId,
        conversation,
        productFound: Boolean(product),
        productSellerUserId: String(product?.sellerUserId || ""),
        productStatus: String((product as { status?: unknown } | null)?.status || ""),
      });
      if (!shared.ok || !product) {
        return reply(
          { ok: false, error: shared.ok ? "Product not found." : shared.error },
          shared.ok ? 404 : shared.status
        );
      }
      const snapshot = snapshotFromTrustedProduct(product);
      const message = await dbCreateSokoBuyerSellerMessage({
        conversationId: parsed.conversationId,
        senderUserId: auth.viewer.userId,
        type: "product_share",
        text: productSharePreviewText(snapshot.title),
        clientMessageId: parsed.clientMessageId,
        product: snapshot,
      });
      return reply(
        {
          ok: true,
          message: publicMessage(message, auth.viewer.userId, product),
        },
        201
      );
    }

    const message = await dbCreateSokoBuyerSellerMessage({
      conversationId: parsed.conversationId,
      senderUserId: auth.viewer.userId,
      text: parsed.text,
      clientMessageId: parsed.clientMessageId,
    });

    return reply(
      {
        ok: true,
        message: publicMessage(message, auth.viewer.userId, null),
      },
      201
    );
  } catch {
    return reply({ ok: false, error: "Could not send message." }, 503);
  }
}
