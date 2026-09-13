export const SOKO_BUYER_SELLER_MESSAGE_MAX = 4000;

export function cleanSokoBuyerSellerText(value: unknown, max = 180) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

export function parseOpenSokoConversationBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid request.",
    };
  }
  const productId = cleanSokoBuyerSellerText(
    (body as { productId?: unknown }).productId,
    100
  );
  if (!productId) {
    return {
      ok: false as const,
      status: 400,
      error: "productId is required.",
    };
  }
  return { ok: true as const, productId };
}

export function evaluateOpenSokoBuyerSellerConversation(input: {
  buyerUserId: string;
  sellerUserId: string;
  productFound: boolean;
}) {
  if (!input.productFound) {
    return {
      ok: false as const,
      status: 404,
      error: "Product not found.",
      code: "product_missing" as const,
    };
  }
  if (!input.sellerUserId) {
    return {
      ok: false as const,
      status: 400,
      error: "This listing has no seller.",
      code: "seller_missing" as const,
    };
  }
  if (input.buyerUserId === input.sellerUserId) {
    return {
      ok: false as const,
      status: 400,
      error: "You cannot message yourself.",
      code: "self_chat" as const,
    };
  }
  return { ok: true as const };
}

export function conversationIdentityKey(
  buyerUserId: string,
  sellerUserId: string,
  productId: string
) {
  return `${buyerUserId}\u0000${sellerUserId}\u0000${productId}`;
}

export function openConversationIdempotently(
  store: Map<string, string>,
  input: { buyerUserId: string; sellerUserId: string; productId: string },
  createId: () => string
) {
  const key = conversationIdentityKey(
    input.buyerUserId,
    input.sellerUserId,
    input.productId
  );
  const existing = store.get(key);
  if (existing) {
    return { id: existing, created: false };
  }
  const id = createId();
  store.set(key, id);
  return { id, created: true };
}

export function authorizeSokoConversationAccess(
  conversation:
    | { buyerUserId: string; sellerUserId: string }
    | null
    | undefined,
  viewerUserId: string
) {
  if (!viewerUserId) {
    return {
      ok: false as const,
      status: 401,
      error: "Unauthorized",
    };
  }
  if (!conversation) {
    return {
      ok: false as const,
      status: 404,
      error: "Conversation not found.",
    };
  }
  if (
    conversation.buyerUserId !== viewerUserId &&
    conversation.sellerUserId !== viewerUserId
  ) {
    return {
      ok: false as const,
      status: 403,
      error: "Not a participant.",
    };
  }
  return { ok: true as const };
}

export function validateSokoBuyerSellerMessageText(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return {
      ok: false as const,
      status: 400,
      error: "Message is required.",
    };
  }
  if (text.length > SOKO_BUYER_SELLER_MESSAGE_MAX) {
    return {
      ok: false as const,
      status: 400,
      error: "Message is too long.",
    };
  }
  return { ok: true as const, text };
}
