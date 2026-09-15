import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { parseMessagePageQuery } from "@/app/api/_lib/sokoBuyerSellerChatPolicy";
import {
  authorizeSokoConversationAccess,
  dbCreateSokoBuyerSellerMessage,
  dbGetSokoBuyerSellerConversation,
  dbListSokoBuyerSellerMessages,
  validateSokoBuyerSellerMessageText,
} from "@/app/api/_lib/store/sokoBuyerSellerChatDb";

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

    return reply({
      ok: true,
      conversationId: page.conversationId,
      hasMore,
      nextBefore: pageRows[0]?.createdAt || "",
      messages: pageRows.map((message) => ({
        ...message,
        mine: message.senderUserId === auth.viewer.userId,
      })),
    });
  } catch {
    return reply({ ok: false, error: "Could not load messages." }, 503);
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const conversationId = String(
    body && typeof body === "object"
      ? (body as { conversationId?: unknown }).conversationId
      : ""
  ).trim();
  const validated = validateSokoBuyerSellerMessageText(
    body && typeof body === "object"
      ? (body as { text?: unknown }).text
      : ""
  );

  if (!conversationId) {
    return reply({ ok: false, error: "conversationId is required." }, 400);
  }
  if (!validated.ok) {
    return reply({ ok: false, error: validated.error }, validated.status);
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

    const message = await dbCreateSokoBuyerSellerMessage({
      conversationId,
      senderUserId: auth.viewer.userId,
      text: validated.text,
    });

    return reply(
      {
        ok: true,
        message: {
          ...message,
          mine: true,
        },
      },
      201
    );
  } catch {
    return reply({ ok: false, error: "Could not send message." }, 503);
  }
}
