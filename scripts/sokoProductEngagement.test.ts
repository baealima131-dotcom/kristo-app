import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  RATE_LIMITS,
  REPORT_TRANSITIONS,
  actionTargetStatus,
  applyUniqueToggle,
  canTransitionReport,
  canonicalProductReportReason,
  claimOpenProductReport,
  cleanCommentBody,
  consumeRateLimit,
  isOpenReportStatus,
  parseShareKind,
  productReportCopy,
  productReportReasonCode,
  publicShareLabel,
} from "../app/api/_lib/sokoEngagementPolicy.ts";

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("like and save toggles are unique and idempotent", () => {
  let rows: Array<{ productId: string; userId: string }> = [];
  const first = applyUniqueToggle(rows, "p1", "u1", true);
  const second = applyUniqueToggle(first.rows, "p1", "u1", true);
  rows = second.rows;
  assert.equal(second.count, 1);
  const other = applyUniqueToggle(rows, "p1", "u2", true);
  assert.equal(other.count, 2);
  const off = applyUniqueToggle(other.rows, "p1", "u1", false);
  assert.equal(off.count, 1);
  assert.equal(off.active, false);
});

test("comment body rejects empty and oversized text", () => {
  assert.equal(cleanCommentBody("   "), null);
  assert.equal(cleanCommentBody("ok"), "ok");
  assert.equal(cleanCommentBody("a".repeat(501)), null);
});

test("share kinds stay honest", () => {
  assert.equal(parseShareKind("share_completed"), "share_completed");
  assert.equal(parseShareKind("shared"), null);
  assert.equal(publicShareLabel(0), "Share");
  assert.equal(publicShareLabel(2), "2");
});

test("legacy report reasons map and open duplicates are reason-scoped", () => {
  assert.equal(canonicalProductReportReason("Scam or fraud"), "Fraud or payment concern");
  assert.equal(canonicalProductReportReason("Seller name spoof"), null);
  assert.equal(isOpenReportStatus("open"), true);
  assert.equal(isOpenReportStatus("dismissed"), false);
});

test("product report copy does not open Buyer Protection", () => {
  assert.match(productReportCopy(), /does not cancel an order/);
});

test("routes reject spoofed identity and keep product reports out of Buyer Protection", () => {
  const report = read("app/api/soko/reports/route.ts");
  const like = read("app/api/soko/products/[id]/like/route.ts");
  const comments = read("app/api/soko/products/[id]/comments/route.ts");
  const hide = read("app/api/soko/products/[id]/comments/[commentId]/route.ts");
  const store = read("app/api/_lib/store/sokoEngagementDb.ts");
  const admin = read("app/api/soko/admin/product-reports/route.ts");
  const action = read("app/api/soko/admin/product-reports/[reportId]/action/route.ts");
  assert.match(report, /guardCheckoutAuth/);
  assert.match(report, /getSokoProductById/);
  assert.doesNotMatch(report, /body\?\.sellerUserId/);
  assert.doesNotMatch(report, /body\?\.productTitle/);
  assert.match(report, /soko_marketplace/);
  assert.doesNotMatch(report, /sokoProtection|buyer protection case/i);
  assert.match(like, /guardCheckoutAuth/);
  assert.match(comments, /auth\.viewer\.userId/);
  assert.doesNotMatch(comments, /body\?\.userId|authorUserId/);
  assert.match(store, /You can only delete your own comment/);
  assert.match(hide, /dbDeleteOwnComment/);
  assert.match(admin, /guardPlatformOfflineActivation\(req, \["System_Admin"\]\)/);
  assert.match(action, /guardPlatformOfflineActivation/);
  assert.match(action, /opensBuyerProtection: false/);
  assert.match(action, /note.length < 8/);
  assert.doesNotMatch(action, /request_review/);
  assert.match(action, /opensBuyerProtection: false/);
  assert.doesNotMatch(action, /sokoProtection|issueRefund|fulfillmentOrder/i);
});

test("unauthenticated comment hide returns before any product lookup", () => {
  const hide = read("app/api/soko/products/[id]/comments/[commentId]/route.ts");
  const post = hide.slice(hide.indexOf("export async function POST"));
  const authAt = post.indexOf("guardPlatformOfflineActivation");
  const checkoutAt = post.indexOf("guardCheckoutAuth");
  const productAt = post.indexOf("getSokoProductById(");
  assert.ok(authAt >= 0 && checkoutAt > authAt && productAt > checkoutAt);
  assert.match(hide, /if \(admin instanceof NextResponse && auth instanceof NextResponse\) return auth/);
  assert.doesNotMatch(hide, /moderatedAt|moderation_reason/);
});

test("concurrent open reports claim one snapshot before creating a safety report", () => {
  const open = new Map<string, string>();
  const key = "user-1\0product-1\0misleading_description";
  const first = claimOpenProductReport(open, key, "report-1");
  const second = claimOpenProductReport(open, key, "report-2");
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.reportId, "report-1");
  assert.equal(open.size, 1);
  const reports = read("app/api/soko/reports/route.ts");
  const store = read("app/api/_lib/store/sokoEngagementDb.ts");
  assert.match(store, /soko_product_report_open_uidx/);
  assert.match(store, /WHERE open = TRUE/);
  assert.ok(reports.indexOf("await dbClaimOpenProductReport") < reports.indexOf("await dbCreateSafetyReport"));
  assert.match(reports, /id: reportId/);
  assert.match(reports, /productReportReasonCode/);
  assert.equal(productReportReasonCode("Misleading description"), "misleading_description");
  assert.equal(productReportReasonCode("not a reason"), null);
});

test("like, save, and report rate limits deny without a successful consume", () => {
  let buckets: Array<{ key: string; windowStart: number; hits: number }> = [];
  for (let i = 0; i < RATE_LIMITS.likeBurst.limit; i += 1) {
    const result = consumeRateLimit(buckets, "like:burst:user", 1_000, RATE_LIMITS.likeBurst.limit, RATE_LIMITS.likeBurst.windowMs);
    buckets = result.buckets;
    assert.equal(result.allowed, true);
  }
  const denied = consumeRateLimit(buckets, "like:burst:user", 1_000, RATE_LIMITS.likeBurst.limit, RATE_LIMITS.likeBurst.windowMs);
  assert.equal(denied.allowed, false);
  const reports = read("app/api/soko/reports/route.ts");
  const like = read("app/api/soko/products/[id]/like/route.ts");
  const save = read("app/api/soko/products/[id]/save/route.ts");
  assert.match(like, /429/);
  assert.match(save, /429/);
  assert.match(reports, /reportUserHour/);
  assert.match(reports, /reportProductHour/);
  assert.ok(reports.indexOf("await dbReadOpenProductReportSlot") < reports.indexOf("await dbConsumeEngagementRateLimit"));
  assert.doesNotMatch(reports, /dbCloseProductReportSnapshot/);
  assert.equal(RATE_LIMITS.reportUserHour.limit, 3);
  assert.equal(RATE_LIMITS.commentMinute.limit, 6);
  assert.equal(RATE_LIMITS.shareMinute.limit, 8);
});

test("moderation records actor identity and note without public exposure", () => {
  const store = read("app/api/_lib/store/sokoEngagementDb.ts");
  assert.match(store, /moderated_at/);
  assert.match(store, /moderated_by_user_id/);
  assert.match(store, /moderated_by_role/);
  assert.match(store, /moderation_reason/);
  assert.match(store, /soko_product_comment_moderation_events/);
  const list = store.slice(store.indexOf("export async function dbListProductComments"));
  assert.doesNotMatch(list.slice(0, list.indexOf("export async function dbDeleteOwnComment")), /moderation_reason|moderated_by_user_id/);
});

test("report transitions reject invalid jumps and terminal actions", () => {
  assert.deepEqual(REPORT_TRANSITIONS.open, ["assigned", "escalated", "dismissed", "resolved"]);
  assert.equal(canTransitionReport("open", "assigned"), true);
  assert.equal(canTransitionReport("assigned", "open"), false);
  assert.equal(canTransitionReport("resolved", "dismissed"), false);
  assert.equal(canTransitionReport("dismissed", "assigned"), false);
  assert.equal(actionTargetStatus("restrict_listing"), "resolved");
  assert.equal(actionTargetStatus("request_review"), null);
  const action = read("app/api/soko/admin/product-reports/[reportId]/action/route.ts");
  assert.match(action, /canTransitionReport/);
  assert.match(action, /dbHasSafetyRole\(supervisorUserId, "Safety_Supervisor"\)/);
  assert.match(action, /remove_product/);
  assert.match(action, /already restricted/);
  assert.match(action, /INSERT INTO kristo_safety_report_events/);
});

test("trusted product snapshot fields are typed without missing-field casts", () => {
  const products = read("app/api/_lib/store/sokoProductsDb.ts");
  const reports = read("app/api/soko/reports/route.ts");
  assert.match(products, /export type SokoTrustedProduct/);
  for (const field of ["id: string", "title: string", "price: number", "currency: string", "image: string", "sellerUserId: string", "status: string"]) {
    assert.match(products, new RegExp(field.replace(" ", "\\s*")));
  }
  assert.match(reports, /product\.sellerUserId/);
  assert.doesNotMatch(reports, /as \{ sellerUserId\?: string \}/);
});

test("reporting does not touch orders, payments, refunds, fulfillment, or Buyer Protection", () => {
  const files = [
    "app/api/soko/reports/route.ts",
    "app/api/soko/admin/product-reports/[reportId]/action/route.ts",
    "app/api/_lib/store/sokoEngagementDb.ts",
  ];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /sokoProtection|soko_orders|issueRefund|fulfillmentOrder/i);
    assert.doesNotMatch(source, /createBuyerProtection|openBuyerProtection/i);
  }
  const queue = read("apps/mobile/src/components/SokoProductReportQueue.tsx");
  assert.match(queue, /onError/);
  assert.match(queue, /Restrict listing removes this product/);
  assert.match(queue, /note\.trim\(\)\.length < 8/);
  assert.doesNotMatch(queue, /Buyer Protection case/);
});
