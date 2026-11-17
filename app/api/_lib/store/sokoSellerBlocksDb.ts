import { neon } from "@neondatabase/serverless";
import { getDatabaseUrl } from "./authDb";
let ready: Promise<void> | null = null;
function sql() { const url = getDatabaseUrl(); if (!url) throw new Error("Database unavailable"); return neon(url); }
async function ensure() {
  if (!ready) ready = sql()`CREATE TABLE IF NOT EXISTS soko_seller_blocks (
    user_id TEXT NOT NULL, seller_id TEXT NOT NULL, product_id TEXT NOT NULL,
    report_pending BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, seller_id)
  )`.then(() => undefined).catch(e => { ready = null; throw e; });
  await ready;
}
export async function readSellerBlocks(userId: string) {
  await ensure();
  const rows = await sql()`SELECT seller_id, product_id, report_pending FROM soko_seller_blocks WHERE user_id=${userId}`;
  const products = await sql()`SELECT p.id FROM soko_products p JOIN soko_seller_blocks b ON b.seller_id=p.seller_user_id WHERE b.user_id=${userId}`;
  return { sellerIds: rows.map(r => String(r.seller_id)), productIds: products.map(r => String(r.id)), pending: rows.filter(r => r.report_pending).map(r => String(r.product_id)) };
}
export async function saveSellerBlock(userId: string, sellerId: string, productId: string) {
  await ensure();
  await sql()`INSERT INTO soko_seller_blocks (user_id,seller_id,product_id) VALUES (${userId},${sellerId},${productId}) ON CONFLICT (user_id,seller_id) DO NOTHING`;
}
export async function markBlockReported(userId: string, productId: string) {
  await ensure();
  await sql()`UPDATE soko_seller_blocks SET report_pending=FALSE WHERE user_id=${userId} AND product_id=${productId}`;
}

export async function removeSellerBlock(userId: string, sellerId: string) {
  await ensure();
  await sql()`DELETE FROM soko_seller_blocks WHERE user_id=${userId} AND seller_id=${sellerId}`;
}
