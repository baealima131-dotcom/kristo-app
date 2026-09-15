import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  authorizeSokoConversationAccess,
  conversationIdentityKey,
  countUnreadMessages,
  evaluateOpenSokoBuyerSellerConversation,
  evaluateShareSokoProduct,
  filterShareableProducts,
  listingAvailabilityLabel,
  openConversationIdempotently,
  parseOpenSokoConversationBody,
  parseSendSokoConversationMessageBody,
  partitionBuyerSellerInbox,
  productSharePreviewText,
  refreshProductShareCard,
  SOKO_BUYER_SELLER_MESSAGE_MAX,
  validateSokoBuyerSellerMessageText,
} from "../app/api/_lib/sokoBuyerSellerChatPolicy.ts";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("open body is productId only and ignores client participant ids", () => {
  const parsed = parseOpenSokoConversationBody({
    productId: "soko-live-1",
    sellerUserId: "fake-seller",
    buyerUserId: "fake-buyer",
    targetUserId: "spoofed",
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.productId, "soko-live-1");

  assert.equal(parseOpenSokoConversationBody({}).ok, false);
  assert.equal(parseOpenSokoConversationBody({ productId: "   " }).ok, false);
});

test("rejects missing product, empty seller, and self-chat", () => {
  assert.equal(
    evaluateOpenSokoBuyerSellerConversation({
      buyerUserId: "buyer-1",
      sellerUserId: "seller-1",
      productFound: false,
    }).code,
    "product_missing"
  );
  assert.equal(
    evaluateOpenSokoBuyerSellerConversation({
      buyerUserId: "buyer-1",
      sellerUserId: "",
      productFound: true,
    }).code,
    "seller_missing"
  );
  assert.equal(
    evaluateOpenSokoBuyerSellerConversation({
      buyerUserId: "same-user",
      sellerUserId: "same-user",
      productFound: true,
    }).code,
    "self_chat"
  );
  assert.equal(
    evaluateOpenSokoBuyerSellerConversation({
      buyerUserId: "buyer-1",
      sellerUserId: "seller-1",
      productFound: true,
    }).ok,
    true
  );
});

test("unauthorized and non-participant access is denied", () => {
  const conversation = {
    buyerUserId: "buyer-1",
    sellerUserId: "seller-1",
  };
  assert.equal(authorizeSokoConversationAccess(conversation, "").status, 401);
  assert.equal(
    authorizeSokoConversationAccess(conversation, "stranger").status,
    403
  );
  assert.equal(authorizeSokoConversationAccess(null, "buyer-1").status, 404);
  assert.equal(authorizeSokoConversationAccess(conversation, "buyer-1").ok, true);
  assert.equal(
    authorizeSokoConversationAccess(conversation, "seller-1").ok,
    true
  );
});

test("empty and oversized messages are rejected", () => {
  assert.equal(validateSokoBuyerSellerMessageText("").ok, false);
  assert.equal(validateSokoBuyerSellerMessageText("   ").ok, false);
  assert.equal(
    validateSokoBuyerSellerMessageText("a".repeat(SOKO_BUYER_SELLER_MESSAGE_MAX + 1))
      .ok,
    false
  );
  const ok = validateSokoBuyerSellerMessageText("  Habari  ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.text, "Habari");
});

test("duplicate open is unique per buyer, seller, and product", () => {
  const store = new Map<string, string>();
  const first = openConversationIdempotently(
    store,
    {
      buyerUserId: "buyer-1",
      sellerUserId: "seller-1",
      productId: "soko-1",
    },
    () => "conv-1"
  );
  const duplicate = openConversationIdempotently(
    store,
    {
      buyerUserId: "buyer-1",
      sellerUserId: "seller-1",
      productId: "soko-1",
    },
    () => "conv-2"
  );
  const otherProduct = openConversationIdempotently(
    store,
    {
      buyerUserId: "buyer-1",
      sellerUserId: "seller-1",
      productId: "soko-2",
    },
    () => "conv-3"
  );
  const otherBuyer = openConversationIdempotently(
    store,
    {
      buyerUserId: "buyer-2",
      sellerUserId: "seller-1",
      productId: "soko-1",
    },
    () => "conv-4"
  );
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.id, "conv-1");
  assert.equal(otherProduct.id, "conv-3");
  assert.equal(otherBuyer.created, true);
  assert.equal(otherBuyer.id, "conv-4");
  assert.equal(
    conversationIdentityKey("buyer-1", "seller-1", "soko-1"),
    conversationIdentityKey("buyer-1", "seller-1", "soko-1")
  );
});

test("inbox splits buying vs selling and keeps unread on the other party only", () => {
  const split = partitionBuyerSellerInbox(
    [
      { buyerUserId: "buyer-1", sellerUserId: "seller-1" },
      { buyerUserId: "buyer-2", sellerUserId: "seller-1" },
      { buyerUserId: "buyer-1", sellerUserId: "seller-2" },
    ],
    "seller-1"
  );
  assert.equal(split.selling.length, 2);
  assert.equal(split.buying.length, 0);
  assert.equal(
    countUnreadMessages({
      viewerUserId: "seller-1",
      lastReadAt: "2026-02-01T00:00:00.000Z",
      messages: [
        { senderUserId: "buyer-1", createdAt: "2026-01-01T00:00:00.000Z" },
        { senderUserId: "buyer-1", createdAt: "2026-03-01T00:00:00.000Z" },
        { senderUserId: "seller-1", createdAt: "2026-04-01T00:00:00.000Z" },
      ],
    }),
    1
  );
  assert.equal(
    listingAvailabilityLabel({ found: false, status: "Deleted" }),
    "Listing unavailable"
  );
  assert.equal(
    evaluateOpenSokoBuyerSellerConversation({
      buyerUserId: "buyer-1",
      sellerUserId: "seller-1",
      productFound: true,
      productStatus: "Deleted",
    }).code,
    "listing_unavailable"
  );
});


test("product share is seller-owned, structured, and does not switch conversations", () => {
  const own = evaluateShareSokoProduct({
    senderUserId: "seller-1",
    conversation: { buyerUserId: "buyer-1", sellerUserId: "seller-1" },
    productFound: true,
    productSellerUserId: "seller-1",
    productStatus: "Active",
  });
  assert.equal(own.ok, true);
  assert.equal(
    evaluateShareSokoProduct({
      senderUserId: "buyer-1",
      conversation: { buyerUserId: "buyer-1", sellerUserId: "seller-1" },
      productFound: true,
      productSellerUserId: "seller-1",
      productStatus: "Active",
    }).code,
    "buyer_cannot_share"
  );
  assert.equal(
    evaluateShareSokoProduct({
      senderUserId: "seller-1",
      conversation: { buyerUserId: "buyer-1", sellerUserId: "seller-1" },
      productFound: true,
      productSellerUserId: "other-seller",
      productStatus: "Active",
    }).code,
    "not_owner"
  );
  assert.equal(
    evaluateShareSokoProduct({
      senderUserId: "seller-1",
      conversation: { buyerUserId: "buyer-1", sellerUserId: "seller-1" },
      productFound: true,
      productSellerUserId: "seller-1",
      productStatus: "Deleted",
    }).code,
    "product_unavailable"
  );

  const parsedShare = parseSendSokoConversationMessageBody({
    conversationId: "conv-1",
    type: "product_share",
    productId: "soko-2",
    title: "spoofed title",
    image: "https://evil.example/x.png",
    price: "9",
    sellerUserId: "other-seller",
    clientMessageId: "cmsg_retry_01",
  });
  assert.equal(parsedShare.ok, true);
  if (parsedShare.ok && parsedShare.kind === "product_share") {
    assert.equal(parsedShare.productId, "soko-2");
    assert.equal(parsedShare.clientMessageId, "cmsg_retry_01");
    assert.equal("title" in parsedShare, false);
  }
  const parsedText = parseSendSokoConversationMessageBody({
    conversationId: "conv-1",
    text: "Habari",
    productId: "ignored",
    type: "text",
  });
  assert.equal(parsedText.ok, true);
  if (parsedText.ok) assert.equal(parsedText.kind, "text");

  assert.equal(productSharePreviewText("Watch for man"), "Sent a product: Watch for man");
  const liveGone = refreshProductShareCard(
    {
      productId: "soko-2",
      title: "Watch for man",
      image: "https://cdn.example/watch.jpg",
      price: "150",
      currency: "TZS",
      status: "Active",
      quantity: "1",
    },
    null
  );
  assert.equal(liveGone.availabilityLabel, "Product unavailable");
  assert.equal(liveGone.viewable, false);
  assert.equal(liveGone.title, "Watch for man");
  const sold = refreshProductShareCard(
    {
      productId: "soko-2",
      title: "Watch for man",
      price: "150",
      currency: "TZS",
      status: "Active",
      quantity: "1",
    },
    {
      id: "soko-2",
      title: "Watch for man",
      status: "Sold",
      soldOut: true,
      price: 150,
      currency: "TZS",
    }
  );
  assert.equal(sold.availabilityLabel, "Sold out");
  assert.equal(sold.viewable, true);

  const filtered = filterShareableProducts(
    [
      { title: "Watch for man", status: "Active", soldOut: false, stockAvailable: 1 },
      { title: "Bag", status: "Sold", soldOut: true, stockAvailable: 0 },
    ],
    { query: "watch", filter: "available" }
  );
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, "Watch for man");
});

test("routes enforce checkout auth, product-row seller, and no Church DM", () => {
  const conversations = read("app/api/soko/conversations/route.ts");
  const messages = read("app/api/soko/conversations/messages/route.ts");
  const productsDb = read("app/api/_lib/store/sokoProductsDb.ts");
  const chatDb = read("app/api/_lib/store/sokoBuyerSellerChatDb.ts");
  const policy = read("app/api/_lib/sokoBuyerSellerChatPolicy.ts");
  const shareable = read("app/api/soko/conversations/shareable-products/route.ts");
  const sharedProduct = read("app/api/soko/conversations/product/route.ts");
  assert.match(policy, /productId is required/);
  assert.match(policy, /self_chat/);
  assert.match(policy, /product_share/);
  assert.match(policy, /buyer_cannot_share/);

  assert.match(conversations, /guardCheckoutAuth/);
  assert.match(messages, /guardCheckoutAuth/);
  assert.match(shareable, /guardCheckoutAuth/);
  assert.match(sharedProduct, /guardCheckoutAuth/);
  assert.match(conversations, /getSokoProductById/);
  assert.match(conversations, /product\?\.sellerUserId/);
  assert.doesNotMatch(conversations, /body\?\.sellerUserId|body\?\.buyerUserId|targetUserId/);
  assert.match(conversations, /parseOpenSokoConversationBody/);
  assert.match(messages, /parseSendSokoConversationMessageBody/);
  assert.match(messages, /evaluateShareSokoProduct/);
  assert.match(messages, /authorizeSokoConversationAccess/);
  assert.match(chatDb, /UNIQUE \(buyer_user_id, seller_user_id, product_id\)/);
  assert.match(chatDb, /ON CONFLICT \(buyer_user_id, seller_user_id, product_id\)/);
  assert.match(chatDb, /soko_buyer_seller_reads/);
  assert.match(chatDb, /soko_buyer_seller_messages_idempotency_idx/);
  assert.match(chatDb, /message_type/);
  assert.match(messages, /hasMore/);
  assert.match(read("app/api/soko/conversations/read/route.ts"), /dbMarkSokoBuyerSellerRead/);
  assert.match(conversations, /inboxRoleForViewer/);
  assert.match(productsDb, /export async function getSokoProductById/);
  assert.match(productsDb, /listShareableSokoProductsForOwner/);
  assert.match(productsDb, /sellerUserId: String\(row\.seller_user_id/);
  assert.match(shareable, /listShareableSokoProductsForOwner\(auth\.viewer\.userId\)/);
  assert.doesNotMatch(shareable, /searchParams\.get\("sellerId"\)/);
  assert.match(sharedProduct, /Product unavailable/);

  assert.doesNotMatch(conversations, /\/api\/church\/direct-messages/);
  assert.doesNotMatch(messages, /\/api\/church\/room-messages/);
  assert.doesNotMatch(conversations, /sokoWorkChat|soko_work_chat/);
  assert.doesNotMatch(messages, /cash-app/);
  assert.doesNotMatch(conversations, /cash-app/);
});

test("Kristo mobile Contact Seller and Cash App V1 use product conversations only", () => {
  const home = read("apps/mobile/src/components/homeFeed/SokoHomeProducts.tsx");
  const chat = read("apps/mobile/src/components/homeFeed/SokoBuyerSellerChat.tsx");
  const api = read("apps/mobile/src/lib/sokoCheckoutApi.ts");
  const contactStart = home.indexOf("const openSokoProductConversation");
  const contactEnd = home.indexOf("const viewSellerProfile");
  const contact = home.slice(contactStart, contactEnd);
  const cashAppChip = home.slice(
    home.indexOf("paymentMethods.map(method=>{"),
    home.indexOf("styles.commerceActions")
  );

  assert.ok(contactStart >= 0 && contactEnd > contactStart);
  assert.match(contact, /setSokoChatOpen\(true\)/);
  assert.doesNotMatch(contact, /openDirectMessageThread/);
  assert.doesNotMatch(contact, /targetUserId|sellerUserId/);
  assert.doesNotMatch(contact, /\/api\/church\/direct-messages/);
  assert.doesNotMatch(contact, /\/api\/soko\/payments\/cash-app/);
  assert.doesNotMatch(contact, /payment-proof/);

  assert.match(cashAppChip, /openSokoProductConversation/);
  assert.doesNotMatch(cashAppChip, /openSecureCheckout\("cash_app"\)/);
  assert.doesNotMatch(cashAppChip, /\/api\/soko\/payments\/cash-app/);

  assert.match(home, /Contact seller to pay with Cash App/);
  assert.match(home, /buyWithCard\?openSecureCheckout\("stripe_card"\):openSokoProductConversation\(\)/);
  assert.doesNotMatch(home, /openDirectMessageThread/);
  assert.doesNotMatch(home, /\/api\/soko\/payments\/cash-app/);
  assert.doesNotMatch(home, /\/api\/church\/direct-messages/);
  assert.doesNotMatch(home, /\/api\/church\/room-messages/);

  assert.match(chat, /sokoOpenBuyerSellerConversation/);
  assert.match(chat, /sokoListBuyerSellerMessages/);
  assert.match(chat, /sokoSendBuyerSellerMessage/);
  assert.doesNotMatch(chat, /openDirectMessageThread/);
  assert.doesNotMatch(chat, /sellerUserId|targetUserId/);
  assert.doesNotMatch(chat, /cash-app/);
  assert.doesNotMatch(chat, /direct-messages|room-messages/);

  assert.match(api, /JSON\.stringify\(\{ productId: listingId \}\)/);
  assert.match(api, /JSON\.stringify\(\{ conversationId: id, text: trimmed \}\)/);
  assert.doesNotMatch(api, /sellerUserId|targetUserId/);
  assert.match(api, /loadSession/);
  assert.match(api, /logKristoAuthHeadersDiag/);
  assert.match(api, /blockedToken/);
});
