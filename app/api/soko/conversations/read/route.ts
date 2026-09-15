import { NextRequest, NextResponse } from "next/server";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { cleanSokoBuyerSellerText } from "@/app/api/_lib/sokoBuyerSellerChatPolicy";
import {
  authorizeSokoConversationAccess,
  dbGetSokoBuyerSellerConversation,
  dbMarkSokoBuyerSellerRead,
} from "@/app/api/_lib/store/sokoBuyerSellerChatDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const conversationId = cleanSokoBuyerSellerText(
    body && typeof body === "object"
      ? (body as { conversationId?: unknown }).conversationId
      : "",
    80
  );
  if (!conversationId) {
    return reply({ ok: false, error: "conversationId is required." }, 400);
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

    await dbMarkSokoBuyerSellerRead({
      conversationId,
      userId: auth.viewer.userId,
    });
    return reply({ ok: true, conversationId });
  } catch {
    return reply({ ok: false, error: "Could not mark conversation read." }, 503);
  }
}
