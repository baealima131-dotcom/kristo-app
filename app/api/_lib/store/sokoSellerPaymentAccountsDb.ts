import { neon } from "@neondatabase/serverless";

import { getDatabaseUrl } from "./authDb";
import { ensureSokoSellerAccessSchema } from "./sokoSellerAccessDb";

export type SokoPaymentProvider =
  | "cash_app"
  | "square";

export type SokoSellerPaymentConnectionStatus =
  | "pending"
  | "active"
  | "disconnected"
  | "revoked";

type PaymentConnectionRow = {
  seller_user_id: string;
  provider: string;
  external_merchant_id: string;
  status: string;
  connected_at: string | Date | null;
  verified_at: string | Date | null;
  updated_at: string | Date;
};

let ready: Promise<void> | null = null;

function sqlClient() {
  const url = getDatabaseUrl();

  if (!url) {
    throw new Error("Database unavailable.");
  }

  return neon(url);
}

function clean(value: unknown, max: number) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function validProvider(
  value: unknown
): value is SokoPaymentProvider {
  return (
    value === "cash_app" ||
    value === "square"
  );
}

function dateText(
  value: string | Date | null
) {
  if (!value) return undefined;

  const parsed = new Date(value);

  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : undefined;
}

async function schema() {
  if (!ready) {
    ready = (async () => {
      await ensureSokoSellerAccessSchema();

      const sql = sqlClient();

      await sql`
        CREATE TABLE IF NOT EXISTS
          soko_seller_payment_accounts (
            seller_user_id TEXT NOT NULL,
            provider TEXT NOT NULL
              CHECK (
                provider IN (
                  'cash_app',
                  'square'
                )
              ),
            external_merchant_id TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending'
              CHECK (
                status IN (
                  'pending',
                  'active',
                  'disconnected',
                  'revoked'
                )
              ),
            connected_at TIMESTAMPTZ,
            verified_at TIMESTAMPTZ,
            cash_tag TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            PRIMARY KEY (
              seller_user_id,
              provider
            )
          )
      `;

      await sql`
        ALTER TABLE soko_seller_payment_accounts
        DROP CONSTRAINT IF EXISTS
          soko_seller_payment_provider_check
      `;

      await sql`
        ALTER TABLE soko_seller_payment_accounts
        ADD CONSTRAINT
          soko_seller_payment_provider_check
        CHECK (
          provider IN (
            'cash_app',
            'square'
          )
        )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          soko_seller_payment_external_merchant_uidx
        ON soko_seller_payment_accounts (
          provider,
          external_merchant_id
        )
        WHERE external_merchant_id <> ''
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_seller_payment_status_idx
        ON soko_seller_payment_accounts (
          provider,
          status,
          updated_at DESC
        )
      `;

      await sql`
        ALTER TABLE soko_seller_payment_accounts
        ADD COLUMN IF NOT EXISTS cash_tag TEXT
        NOT NULL DEFAULT ''
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }

  return ready;
}

function publicConnection(
  row: PaymentConnectionRow
) {
  return {
    provider: row.provider,
    status: row.status,
    connected:
      row.status === "active" &&
      Boolean(row.external_merchant_id),
    connectedAt:
      dateText(row.connected_at),
    verifiedAt:
      dateText(row.verified_at),

    /*
     * Never expose provider credentials here.
     * Merchant ID is intentionally not returned
     * to the mobile client.
     */
  };
}

export async function dbListSellerPaymentConnections(
  sellerUserId: string
) {
  await schema();

  const seller = clean(
    sellerUserId,
    180
  );

  if (!seller) {
    throw new Error("Seller user ID is required.");
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT
      payment.seller_user_id,
      payment.provider,
      payment.external_merchant_id,
      payment.status,
      payment.connected_at,
      payment.verified_at,
      payment.updated_at
    FROM soko_seller_payment_accounts payment
    JOIN soko_seller_accounts seller
      ON seller.user_id =
        payment.seller_user_id
      AND seller.status = 'active'
    WHERE payment.seller_user_id =
      ${seller}
    ORDER BY payment.provider
  ` as PaymentConnectionRow[];

  return rows.map(publicConnection);
}

/**
 * Server/provider integration only.
 *
 * Do NOT call this with a merchant ID supplied
 * directly by the mobile client.
 */
export async function dbUpsertSellerPaymentConnection(
  input: {
    sellerUserId: string;
    provider: SokoPaymentProvider;
    externalMerchantId: string;
    verified?: boolean;
  }
) {
  await schema();

  const sellerUserId = clean(
    input.sellerUserId,
    180
  );

  const externalMerchantId = clean(
    input.externalMerchantId,
    180
  );

  if (
    !sellerUserId ||
    !validProvider(input.provider) ||
    !externalMerchantId
  ) {
    throw new Error(
      "Valid seller and provider merchant identity are required."
    );
  }

  const sql = sqlClient();

  const sellerRows = await sql`
    SELECT user_id
    FROM soko_seller_accounts
    WHERE user_id = ${sellerUserId}
      AND status = 'active'
    LIMIT 1
  ` as Array<{ user_id: string }>;

  if (!sellerRows[0]) {
    throw new Error(
      "Active SOKO seller access is required."
    );
  }

  const rows = await sql`
    INSERT INTO soko_seller_payment_accounts (
      seller_user_id,
      provider,
      external_merchant_id,
      status,
      connected_at,
      verified_at,
      updated_at
    )
    VALUES (
      ${sellerUserId},
      ${input.provider},
      ${externalMerchantId},
      ${
        input.verified === true
          ? "active"
          : "pending"
      },
      ${
        input.verified === true
          ? new Date()
          : null
      },
      ${
        input.verified === true
          ? new Date()
          : null
      },
      NOW()
    )
    ON CONFLICT (
      seller_user_id,
      provider
    )
    DO UPDATE SET
      external_merchant_id =
        EXCLUDED.external_merchant_id,
      status =
        CASE
          WHEN ${input.verified === true}::boolean
            THEN 'active'
          ELSE 'pending'
        END,
      connected_at =
        CASE
          WHEN ${input.verified === true}::boolean
            THEN COALESCE(
              soko_seller_payment_accounts.connected_at,
              NOW()
            )
          ELSE
            soko_seller_payment_accounts.connected_at
        END,
      verified_at =
        CASE
          WHEN ${input.verified === true}::boolean
            THEN NOW()
          ELSE NULL
        END,
      updated_at = NOW()
    RETURNING
      seller_user_id,
      provider,
      external_merchant_id,
      status,
      connected_at,
      verified_at,
      updated_at
  ` as PaymentConnectionRow[];

  return rows[0]
    ? publicConnection(rows[0])
    : null;
}

/**
 * Server-only forward lookup used when Kristo
 * needs the provider merchant identity for a
 * specific seller.
 *
 * Never expose externalMerchantId to mobile.
 *
 * The merchant is usable only when:
 * - SOKO seller access is active
 * - seller application is approved
 * - provider connection is active
 * - provider identity has been verified
 */
export async function dbGetVerifiedSellerPaymentMerchant(
  input: {
    sellerUserId: string;
    provider: SokoPaymentProvider;
  }
) {
  await schema();

  const sellerUserId = clean(
    input.sellerUserId,
    180
  );

  if (
    !sellerUserId ||
    !validProvider(input.provider)
  ) {
    return null;
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT
      payment.seller_user_id,
      payment.provider,
      payment.external_merchant_id,
      payment.cash_tag,
      payment.verified_at
    FROM soko_seller_payment_accounts payment
    JOIN soko_seller_accounts seller
      ON seller.user_id =
        payment.seller_user_id
      AND seller.status = 'active'
    JOIN soko_seller_applications application
      ON application.id =
        seller.application_id
      AND application.user_id =
        seller.user_id
      AND application.status = 'approved'
    WHERE payment.seller_user_id =
      ${sellerUserId}
      AND payment.provider =
        ${input.provider}
      AND payment.status = 'active'
      AND payment.verified_at IS NOT NULL
      AND (
        payment.external_merchant_id <> ''
        OR payment.cash_tag <> ''
      )
    LIMIT 1
  ` as Array<{
    seller_user_id: string;
    provider: string;
    external_merchant_id: string;
    cash_tag: string;
    verified_at: string | Date;
  }>;

  const row = rows[0];

  if (!row) {
    return null;
  }

  const externalMerchantId = clean(
    row.external_merchant_id,
    180
  );

  const cashTag = clean(row.cash_tag, 20);

  if (!externalMerchantId && !cashTag) {
    return null;
  }

  return {
    sellerUserId: row.seller_user_id,
    provider: row.provider as SokoPaymentProvider,
    externalMerchantId,
    cashTag,
    verifiedAt: dateText(row.verified_at),
  };
}


/**
 * Used only after a webhook signature has already
 * been verified.
 *
 * A revoked SOKO seller can never resolve here
 * because seller.status must still be active.
 */
export async function dbResolveSellerFromProviderMerchant(
  input: {
    provider: SokoPaymentProvider;
    externalMerchantId: string;
  }
) {
  await schema();

  if (!validProvider(input.provider)) {
    return null;
  }

  const externalMerchantId = clean(
    input.externalMerchantId,
    180
  );

  if (!externalMerchantId) {
    return null;
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT
      payment.seller_user_id
    FROM soko_seller_payment_accounts payment
    JOIN soko_seller_accounts seller
      ON seller.user_id =
        payment.seller_user_id
      AND seller.status = 'active'
    JOIN soko_seller_applications application
      ON application.id =
        seller.application_id
      AND application.user_id =
        seller.user_id
      AND application.status = 'approved'
    WHERE payment.provider =
      ${input.provider}
      AND payment.external_merchant_id =
        ${externalMerchantId}
      AND payment.status = 'active'
      AND payment.verified_at IS NOT NULL
    LIMIT 1
  ` as Array<{
    seller_user_id: string;
  }>;

  return rows[0]?.seller_user_id || null;
}
