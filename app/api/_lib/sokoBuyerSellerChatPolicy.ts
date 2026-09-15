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

export type SokoInboxRole = "buying" | "selling";
export type SokoTradeStatus =
  | "Inquiry"
  | "Payment pending"
  | "Paid"
  | "Shipped"
  | "Completed";

export function isUnavailableSokoListingStatus(status?: string | null) {
  const value = String(status || "").trim();
  return value === "Deleted" || value === "Draft";
}

export function listingAvailabilityLabel(input: {
  status?: string | null;
  soldOut?: boolean;
  found?: boolean;
}) {
  if (input.found === false || isUnavailableSokoListingStatus(input.status)) {
    return "Listing unavailable";
  }
  if (input.status === "Sold" || input.soldOut) {
    return "Sold";
  }
  return "Available";
}

export function tradeStatusFromOrderStatus(status?: string | null): SokoTradeStatus {
  const value = String(status || "").trim();
  if (!value || value === "cancelled") return "Inquiry";
  if (
    value === "awaiting_delivery_quote" ||
    value === "delivery_quote_ready" ||
    value === "awaiting_payment" ||
    value === "payment_submitted" ||
    value === "payment_rejected"
  ) {
    return "Payment pending";
  }
  if (value === "payment_approved" || value === "preparing_shipment") {
    return "Paid";
  }
  if (value === "shipped") return "Shipped";
  if (value === "delivered") return "Completed";
  return "Inquiry";
}

export function inboxRoleForViewer(
  conversation: { buyerUserId: string; sellerUserId: string },
  viewerUserId: string
): SokoInboxRole | null {
  if (conversation.buyerUserId === viewerUserId) return "buying";
  if (conversation.sellerUserId === viewerUserId) return "selling";
  return null;
}

export function partitionBuyerSellerInbox<
  T extends { buyerUserId: string; sellerUserId: string },
>(rows: T[], viewerUserId: string) {
  const buying: T[] = [];
  const selling: T[] = [];
  for (const row of rows) {
    const role = inboxRoleForViewer(row, viewerUserId);
    if (role === "buying") buying.push(row);
    else if (role === "selling") selling.push(row);
  }
  return { buying, selling };
}

export function countUnreadMessages(input: {
  viewerUserId: string;
  lastReadAt?: string | null;
  messages: Array<{ senderUserId: string; createdAt: string }>;
}) {
  const readAt = Date.parse(String(input.lastReadAt || "")) || 0;
  return input.messages.filter((message) => {
    if (message.senderUserId === input.viewerUserId) return false;
    const created = Date.parse(message.createdAt) || 0;
    return created > readAt;
  }).length;
}

export function mergeMessagesById<
  T extends { id: string; createdAt?: string },
>(existing: T[], incoming: T[]) {
  const next = new Map<string, T>();
  for (const row of existing) {
    if (row?.id) next.set(row.id, row);
  }
  for (const row of incoming) {
    if (row?.id) next.set(row.id, row);
  }
  return [...next.values()].sort((left, right) => {
    const a = Date.parse(String(left.createdAt || "")) || 0;
    const b = Date.parse(String(right.createdAt || "")) || 0;
    return a - b;
  });
}

export function parseInboxListQuery(search: {
  get(name: string): string | null;
}) {
  const roleRaw = String(search.get("role") || "").trim().toLowerCase();
  const role =
    roleRaw === "buying" || roleRaw === "selling"
      ? (roleRaw as SokoInboxRole)
      : "";
  const limit = Math.max(
    1,
    Math.min(100, Number(search.get("limit") || 40) || 40)
  );
  const cursor = cleanSokoBuyerSellerText(search.get("cursor"), 80);
  return { role, limit, cursor };
}

export function parseMessagePageQuery(search: {
  get(name: string): string | null;
}) {
  const conversationId = cleanSokoBuyerSellerText(
    search.get("conversationId"),
    80
  );
  const limit = Math.max(
    1,
    Math.min(80, Number(search.get("limit") || 40) || 40)
  );
  const before = cleanSokoBuyerSellerText(search.get("before"), 40);
  return { conversationId, limit, before };
}

export function evaluateOpenSokoBuyerSellerConversation(input: {
  buyerUserId: string;
  sellerUserId: string;
  productFound: boolean;
  productStatus?: string | null;
}) {
  if (!input.productFound) {
    return {
      ok: false as const,
      status: 404,
      error: "Product not found.",
      code: "product_missing" as const,
    };
  }
  if (isUnavailableSokoListingStatus(input.productStatus)) {
    return {
      ok: false as const,
      status: 409,
      error: "Listing unavailable.",
      code: "listing_unavailable" as const,
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
