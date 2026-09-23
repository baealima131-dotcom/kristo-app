import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { neon } from "@neondatabase/serverless";

const root = process.cwd();

function present(value) {
  return String(value || "").trim().length > 0;
}

function loadEnvFiles() {
  const files = [
    ".env",
    ".env.local",
    ".env.vercel.prod",
    ".env.production.local",
  ];
  for (const file of files) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) {
      loadEnv({ path: full, override: true, quiet: true });
    }
  }
}

function redactReady(flags) {
  const keys = Object.keys(flags).sort();
  const out = {};
  for (const key of keys) {
    out[key] = Boolean(flags[key]);
  }
  return out;
}

async function sellerFlags(sql) {
  const sellerFilter = String(
    process.env.KRISTO_SOKO_SELLER_1_USER_ID || ""
  ).trim();

  const rows = sellerFilter
    ? await sql`
        SELECT
          status,
          verified_at IS NOT NULL AS verified,
          external_merchant_id <> '' AS has_merchant,
          cash_tag <> '' AS has_cash_tag,
          seller_user_id
        FROM soko_seller_payment_accounts
        WHERE provider = 'cash_app'
          AND seller_user_id = ${sellerFilter}
        LIMIT 1
      `
    : await sql`
        SELECT
          status,
          verified_at IS NOT NULL AS verified,
          external_merchant_id <> '' AS has_merchant,
          cash_tag <> '' AS has_cash_tag,
          seller_user_id
        FROM soko_seller_payment_accounts
        WHERE provider = 'cash_app'
        ORDER BY
          CASE WHEN status = 'active' THEN 0 ELSE 1 END,
          verified_at DESC NULLS LAST
        LIMIT 1
      `;

  const row = rows[0];
  if (!row) {
    return {
      sellerAccountActive: false,
      sellerVerifiedAtPresent: false,
      sellerHasExternalMerchantId: false,
      sellerHasCashTag: false,
      productCashTagMatchesApprovedSeller: false,
    };
  }

  let productMatch = false;
  if (row.has_cash_tag && row.seller_user_id) {
    const products = await sql`
      SELECT payload->'paymentOptions'->>'cashTag' AS cash_tag
      FROM soko_products
      WHERE seller_user_id = ${row.seller_user_id}
        AND status = 'Active'
      LIMIT 20
    `;
    productMatch = products.some((product) => {
      const listing = String(product.cash_tag || "")
        .replace(/^\$/, "")
        .trim()
        .toLowerCase();
      return listing.length > 0;
    });
    if (productMatch) {
      const approved = await sql`
        SELECT lower(cash_tag) AS cash_tag
        FROM soko_seller_payment_accounts
        WHERE seller_user_id = ${row.seller_user_id}
          AND provider = 'cash_app'
        LIMIT 1
      `;
      const approvedTag = String(approved[0]?.cash_tag || "")
        .replace(/^\$/, "")
        .trim()
        .toLowerCase();
      productMatch = products.every((product) => {
        const listing = String(product.cash_tag || "")
          .replace(/^\$/, "")
          .trim()
          .toLowerCase();
        return !listing || listing === approvedTag;
      });
    }
  }

  return {
    sellerAccountActive: row.status === "active",
    sellerVerifiedAtPresent: Boolean(row.verified),
    sellerHasExternalMerchantId: Boolean(row.has_merchant),
    sellerHasCashTag: Boolean(row.has_cash_tag),
    productCashTagMatchesApprovedSeller: productMatch,
  };
}

async function main() {
  loadEnvFiles();

  const webhookRoutePresent = fs.existsSync(
    path.join(root, "app/api/soko/webhooks/cash-app/route.ts")
  );

  const partnerSandbox =
    String(process.env.CASH_APP_PARTNER_SANDBOX || "")
      .trim()
      .toLowerCase() === "true";

  const hasWebhookSecret = present(process.env.CASH_APP_WEBHOOK_API_SECRET);
  const hasPartnerClientCredentials = present(
    process.env.CASH_APP_PARTNER_CLIENT_ID
  );
  const hasLiveApiCredentials =
    present(process.env.CASH_APP_PARTNER_API_KEY) &&
    present(process.env.CASH_APP_PARTNER_API_SECRET) &&
    present(process.env.CASH_APP_PARTNER_REGION) &&
    !partnerSandbox;

  let seller = {
    sellerAccountActive: false,
    sellerVerifiedAtPresent: false,
    sellerHasExternalMerchantId: false,
    sellerHasCashTag: false,
    productCashTagMatchesApprovedSeller: false,
  };

  const databaseUrl = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  ).trim();

  if (databaseUrl) {
    try {
      seller = await sellerFlags(neon(databaseUrl));
    } catch {
      seller = {
        sellerAccountActive: false,
        sellerVerifiedAtPresent: false,
        sellerHasExternalMerchantId: false,
        sellerHasCashTag: false,
        productCashTagMatchesApprovedSeller: false,
      };
    }
  }

  const partnerCheckoutReady =
    hasPartnerClientCredentials &&
    seller.sellerAccountActive &&
    seller.sellerVerifiedAtPresent &&
    seller.sellerHasExternalMerchantId &&
    (partnerSandbox || hasLiveApiCredentials);

  const automaticConfirmationReady =
    webhookRoutePresent &&
    hasWebhookSecret &&
    partnerCheckoutReady;

  const report = redactReady({
    hasWebhookSecret,
    partnerSandbox,
    hasPartnerClientCredentials,
    hasLiveApiCredentials,
    webhookRoutePresent,
    ...seller,
    partnerCheckoutReady,
    automaticConfirmationReady,
  });

  console.log(JSON.stringify(report, null, 2));
}

await main();
