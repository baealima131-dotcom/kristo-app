import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { getDatabaseUrl } from "@/app/api/_lib/store/authDb";
import { getZporaIdentity, deleteZporaIdentity } from "@/app/api/_lib/store/zporaIdentityDb";
import { deleteUserById, deleteChallengesForUser } from "@/app/api/auth/_lib/session";
import { getMembershipsForUser } from "@/app/api/_lib/memberships";
import { markSokoAccountDeleted } from "@/app/api/_lib/store/sokoAccountStateDb";
import { sokoImageOwner } from "@/app/api/_lib/sokoProductImages";
import { deleteSokoProductImagesByOwner } from "@/app/api/_lib/media/objectStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function preservesKristoIdentity(userId: string) {
  const origin = await getZporaIdentity(userId);
  if (!origin || origin.shared_with_kristo) return true;
  // Never remove a church member's shared identity, even if an older client
  // did not report that it was used in Kristo.
  const memberships = await getMembershipsForUser(userId);
  return memberships.length > 0;
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;
  try {
    return reply({ ok: true, kristoAccountPreserved: await preservesKristoIdentity(auth.viewer.userId) });
  } catch {
    return reply({ ok: false, error: "Could not load deletion details. Please try again." }, 503);
  }
}
export async function DELETE(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.viewer.userId;
  const url = getDatabaseUrl();
  if (!url) return reply({ ok: false, error: "Account deletion is temporarily unavailable." }, 503);
  const sql = neon(url);
  const exists = async (table: string) => {
    const rows = await sql`SELECT to_regclass(${`public.${table}`}) AS name`;
    return Boolean(rows[0]?.name);
  };

  try {
    const kristoAccountPreserved = await preservesKristoIdentity(userId);
    // Remove public material first. Keep consent until the work succeeds so a
    // partial failure can be retried without claiming deletion completed.
    if (await exists("soko_product_comments")) {
      if (await exists("soko_products")) {
        await sql`DELETE FROM soko_product_comments WHERE user_id = ${userId}
          OR product_id IN (SELECT id FROM soko_products WHERE seller_user_id = ${userId})`;
      } else {
        await sql`DELETE FROM soko_product_comments WHERE user_id = ${userId}`;
      }
    }
    if (await exists("soko_product_likes")) await sql`DELETE FROM soko_product_likes WHERE user_id = ${userId}`;
    if (await exists("soko_product_saves")) await sql`DELETE FROM soko_product_saves WHERE user_id = ${userId}`;
    if (await exists("soko_product_share_events")) await sql`DELETE FROM soko_product_share_events WHERE user_id = ${userId}`;
    if (await exists("soko_buyer_seller_messages")) {
      const columns = await sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'soko_buyer_seller_messages' AND column_name = 'share_product_id'`;
      if (columns.length) {
        if (await exists("soko_products")) {
          await sql`UPDATE soko_buyer_seller_messages SET message_type = 'text',
            share_product_id = '', share_product_title = '', share_product_image = '', share_product_price = '',
            share_product_currency = '', share_product_status = '', share_product_quantity = '', text = '[deleted]'
            WHERE sender_user_id = ${userId} OR share_product_id IN (SELECT id FROM soko_products WHERE seller_user_id = ${userId})`;
        } else {
          await sql`UPDATE soko_buyer_seller_messages SET message_type = 'text',
            share_product_id = '', share_product_title = '', share_product_image = '', share_product_price = '',
            share_product_currency = '', share_product_status = '', share_product_quantity = '', text = '[deleted]'
            WHERE sender_user_id = ${userId}`;
        }
      }
      await sql`UPDATE soko_buyer_seller_messages
        SET text = '[deleted]', sender_user_id = 'deleted-' || id
        WHERE sender_user_id = ${userId}`;
    }
    if (await exists("soko_buyer_seller_reads")) await sql`DELETE FROM soko_buyer_seller_reads WHERE user_id = ${userId}`;
    if (await exists("soko_buyer_seller_conversations")) {
      await sql`UPDATE soko_buyer_seller_conversations
        SET buyer_user_id = 'deleted-' || id WHERE buyer_user_id = ${userId}`;
      await sql`UPDATE soko_buyer_seller_conversations
        SET seller_user_id = 'deleted-' || id, product_title = 'Deleted listing', product_image = ''
        WHERE seller_user_id = ${userId}`;
    }
    if (await exists("soko_products")) await sql`DELETE FROM soko_products WHERE seller_user_id = ${userId}`;
    if (await exists("soko_supply_imports")) await sql`DELETE FROM soko_supply_imports WHERE seller_user_id = ${userId}`;
    if (await exists("soko_seller_system_messages")) await sql`DELETE FROM soko_seller_system_messages WHERE recipient_user_id = ${userId}`;
    if (await exists("soko_seller_command_codes")) await sql`DELETE FROM soko_seller_command_codes WHERE user_id = ${userId}`;
    if (await exists("soko_seller_accounts")) await sql`DELETE FROM soko_seller_accounts WHERE user_id = ${userId}`;
    if (await exists("soko_seller_applications")) await sql`DELETE FROM soko_seller_applications WHERE user_id = ${userId}`;
    await deleteSokoProductImagesByOwner(sokoImageOwner(userId));
    if (await exists("soko_legal_consent")) await sql`DELETE FROM soko_legal_consent WHERE user_id = ${userId}`;
    await markSokoAccountDeleted(userId);
    if (!kristoAccountPreserved) {
      deleteChallengesForUser(userId);
      await deleteUserById(userId);
      await deleteZporaIdentity(userId);
    }
    return reply({ ok: true, kristoAccountPreserved, retainedTransactionRecords: true });
  } catch (error) {
    console.error("ZPORA_ACCOUNT_DELETE_FAILED", { userId, error: String(error) });
    return reply({ ok: false, error: "Zpora account deletion did not finish. Please try again." }, 500);
  }
}
