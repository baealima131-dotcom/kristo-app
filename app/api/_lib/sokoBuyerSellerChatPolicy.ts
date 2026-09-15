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

export const SOKO_TEXT_MESSAGE_TYPE = "text";
export const SOKO_PRODUCT_SHARE_MESSAGE_TYPE = "product_share";

export type SokoShareableProductFilter = "available" | "sold_out" | "all";

export function productSharePreviewText(title: unknown) {
  const name = cleanSokoBuyerSellerText(title, 120) || "Listing";
  return `Sent a product: ${name}`.slice(0, SOKO_BUYER_SELLER_MESSAGE_MAX);
}

export function parseClientMessageId(value: unknown) {
  const id = cleanSokoBuyerSellerText(value, 80);
  if (!id) return "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid clientMessageId.",
    };
  }
  return id;
}

export function parseSendSokoConversationMessageBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false as const,
      status: 400,
      error: "Invalid request.",
    };
  }
  const source = body as {
    conversationId?: unknown;
    text?: unknown;
    type?: unknown;
    productId?: unknown;
    clientMessageId?: unknown;
    title?: unknown;
    image?: unknown;
    price?: unknown;
    sellerUserId?: unknown;
  };
  const conversationId = cleanSokoBuyerSellerText(source.conversationId, 80);
  if (!conversationId) {
    return {
      ok: false as const,
      status: 400,
      error: "conversationId is required.",
    };
  }
  const clientMessageId = parseClientMessageId(source.clientMessageId);
  if (typeof clientMessageId === "object") return clientMessageId;

  const typeRaw = cleanSokoBuyerSellerText(source.type, 32).toLowerCase();
  if (typeRaw === SOKO_PRODUCT_SHARE_MESSAGE_TYPE) {
    const productId = cleanSokoBuyerSellerText(source.productId, 100);
    if (!productId) {
      return {
        ok: false as const,
        status: 400,
        error: "productId is required.",
      };
    }
    return {
      ok: true as const,
      kind: "product_share" as const,
      conversationId,
      productId,
      clientMessageId,
    };
  }

  const validated = validateSokoBuyerSellerMessageText(source.text);
  if (!validated.ok) return validated;
  return {
    ok: true as const,
    kind: "text" as const,
    conversationId,
    text: validated.text,
    clientMessageId,
  };
}

export function evaluateShareSokoProduct(input: {
  senderUserId: string;
  conversation:
    | { buyerUserId: string; sellerUserId: string }
    | null
    | undefined;
  productFound: boolean;
  productSellerUserId?: string | null;
  productStatus?: string | null;
}) {
  const access = authorizeSokoConversationAccess(
    input.conversation,
    input.senderUserId
  );
  if (!access.ok) {
    return { ...access, code: "access" as const };
  }
  if (input.conversation!.sellerUserId !== input.senderUserId) {
    return {
      ok: false as const,
      status: 403,
      error: "Only the seller can send a product.",
      code: "buyer_cannot_share" as const,
    };
  }
  if (!input.productFound) {
    return {
      ok: false as const,
      status: 404,
      error: "Product not found.",
      code: "product_missing" as const,
    };
  }
  if (
    String(input.productSellerUserId || "").trim() !== input.senderUserId
  ) {
    return {
      ok: false as const,
      status: 403,
      error: "You can only send your own products.",
      code: "not_owner" as const,
    };
  }
  if (isUnavailableSokoListingStatus(input.productStatus)) {
    return {
      ok: false as const,
      status: 409,
      error: "Product unavailable.",
      code: "product_unavailable" as const,
    };
  }
  return { ok: true as const };
}

export function productShareAvailabilityLabel(input: {
  found?: boolean;
  status?: string | null;
  soldOut?: boolean;
}) {
  if (input.found === false || isUnavailableSokoListingStatus(input.status)) {
    return "Product unavailable";
  }
  if (input.status === "Sold" || input.soldOut) return "Sold out";
  return "Available";
}

export function snapshotFromTrustedProduct(product: {
  id?: unknown;
  title?: unknown;
  image?: unknown;
  price?: unknown;
  currency?: unknown;
  status?: unknown;
  quantity?: unknown;
  stockAvailable?: unknown;
  soldOut?: unknown;
}) {
  const quantity = cleanSokoBuyerSellerText(
    product.quantity ?? product.stockAvailable,
    40
  );
  return {
    productId: cleanSokoBuyerSellerText(product.id, 100),
    title: cleanSokoBuyerSellerText(product.title, 120),
    image: cleanSokoBuyerSellerText(product.image, 500),
    price: cleanSokoBuyerSellerText(product.price, 40),
    currency: cleanSokoBuyerSellerText(product.currency, 8),
    status: cleanSokoBuyerSellerText(product.status, 32),
    quantity,
    soldOut: Boolean(product.soldOut),
  };
}

export function refreshProductShareCard(
  snapshot: {
    productId?: unknown;
    title?: unknown;
    image?: unknown;
    price?: unknown;
    currency?: unknown;
    status?: unknown;
    quantity?: unknown;
  },
  live?: {
    id?: unknown;
    title?: unknown;
    image?: unknown;
    price?: unknown;
    currency?: unknown;
    status?: unknown;
    quantity?: unknown;
    stockAvailable?: unknown;
    soldOut?: unknown;
  } | null
) {
  const stored = snapshotFromTrustedProduct(snapshot);
  const found =
    live != null &&
    !isUnavailableSokoListingStatus(
      String((live as { status?: unknown }).status || "")
    );
  const current = found ? snapshotFromTrustedProduct({ ...live, id: live.id || stored.productId }) : stored;
  const availabilityLabel = productShareAvailabilityLabel({
    found,
    status: found ? current.status : live == null ? "Deleted" : current.status,
    soldOut: Boolean(live?.soldOut) || current.status === "Sold",
  });
  return {
    productId: stored.productId,
    title: current.title || stored.title,
    image: current.image || stored.image,
    price: current.price || stored.price,
    currency: current.currency || stored.currency,
    status: current.status || stored.status,
    quantity: current.quantity || stored.quantity,
    availabilityLabel,
    available: availabilityLabel === "Available",
    viewable: availabilityLabel !== "Product unavailable",
  };
}

export function parseShareableProductsQuery(search: {
  get(name: string): string | null;
}) {
  const query = cleanSokoBuyerSellerText(search.get("q") || search.get("query"), 80);
  const filterRaw = cleanSokoBuyerSellerText(search.get("filter"), 20).toLowerCase();
  const filter: SokoShareableProductFilter =
    filterRaw === "available" || filterRaw === "sold_out"
      ? filterRaw
      : "all";
  return { query, filter };
}

export function isShareableSoldOut(product: {
  status?: string | null;
  soldOut?: boolean;
  stockAvailable?: unknown;
}) {
  const stock = Number(product.stockAvailable);
  return (
    product.status === "Sold" ||
    product.soldOut === true ||
    (Number.isFinite(stock) && stock <= 0)
  );
}

export function filterShareableProducts<
  T extends {
    title?: string;
    status?: string | null;
    soldOut?: boolean;
    stockAvailable?: unknown;
  },
>(
  products: T[],
  input: { query?: string; filter?: SokoShareableProductFilter }
) {
  const needle = String(input.query || "").trim().toLowerCase();
  const filter = input.filter || "all";
  return products.filter((product) => {
    if (needle && !String(product.title || "").toLowerCase().includes(needle)) {
      return false;
    }
    const soldOut = isShareableSoldOut(product);
    if (filter === "available") return !soldOut;
    if (filter === "sold_out") return soldOut;
    return true;
  });
}
