import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  authorizeSokoConversationAccess,
  conversationIdentityKey,
  evaluateOpenSokoBuyerSellerConversation,
  openConversationIdempotently,
  parseOpenSokoConversationBody,
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
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.id, "conv-1");
  assert.equal(otherProduct.id, "conv-3");
  assert.equal(
    conversationIdentityKey("buyer-1", "seller-1", "soko-1"),
    conversationIdentityKey("buyer-1", "seller-1", "soko-1")
  );
});

test("routes enforce checkout auth, product-row seller, and no Church DM", () => {
  const conversations = read("app/api/soko/conversations/route.ts");
  const messages = read("app/api/soko/conversations/messages/route.ts");
  const productsDb = read("app/api/_lib/store/sokoProductsDb.ts");
  const chatDb = read("app/api/_lib/store/sokoBuyerSellerChatDb.ts");
  const policy = read("app/api/_lib/sokoBuyerSellerChatPolicy.ts");
  assert.match(policy, /productId is required/);
  assert.match(policy, /self_chat/);

  assert.match(conversations, /guardCheckoutAuth/);
  assert.match(messages, /guardCheckoutAuth/);
  assert.match(conversations, /getSokoProductById/);
  assert.match(conversations, /product\?\.sellerUserId/);
  assert.doesNotMatch(conversations, /body\?\.sellerUserId|body\?\.buyerUserId|targetUserId/);
  assert.match(conversations, /parseOpenSokoConversationBody/);
  assert.match(messages, /authorizeSokoConversationAccess/);
  assert.match(chatDb, /UNIQUE \(buyer_user_id, seller_user_id, product_id\)/);
  assert.match(chatDb, /ON CONFLICT \(buyer_user_id, seller_user_id, product_id\)/);
  assert.match(productsDb, /export async function getSokoProductById/);
  assert.match(productsDb, /sellerUserId: String\(row\.seller_user_id/);

  assert.doesNotMatch(conversations, /\/api\/church\/direct-messages/);
  assert.doesNotMatch(messages, /\/api\/church\/room-messages/);
  assert.doesNotMatch(conversations, /sokoWorkChat|soko_work_chat/);
  assert.doesNotMatch(messages, /cash-app/);
  assert.doesNotMatch(conversations, /cash-app/);
});
