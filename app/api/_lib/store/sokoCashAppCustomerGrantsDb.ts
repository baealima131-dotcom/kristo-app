import { neon } from "@neondatabase/serverless";

import { getDatabaseUrl } from "./authDb";

export type CashAppGrantAction =
  | "ONE_TIME_PAYMENT";

type CashAppGrantRow = {
  grant_id: string;
  buyer_user_id: string;
  customer_id: string;
  request_id: string;
  reference_id: string;
  action_type: string;
  scope_id: string;
  amount_minor: number | string;
  currency: string;
  status: string;
  expires_at: string | Date | null;
  verified_at: string | Date | null;
  created_at: string | Date;
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

function clean(
  value: unknown,
  max: number
) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function normalizeCurrency(
  value: unknown
) {
  return clean(value, 10)
    .toUpperCase();
}

function dateText(
  value: string | Date | null
) {
  if (!value) return undefined;

  const parsed = new Date(value);

  return Number.isFinite(
    parsed.getTime()
  )
    ? parsed.toISOString()
    : undefined;
}

async function schema() {
  if (!ready) {
    ready = (async () => {
      const sql = sqlClient();

      await sql`
        CREATE TABLE IF NOT EXISTS
          soko_cash_app_customer_grants (
            grant_id TEXT PRIMARY KEY,

            buyer_user_id TEXT NOT NULL,

            customer_id TEXT NOT NULL,

            request_id TEXT NOT NULL,

            reference_id TEXT NOT NULL,

            action_type TEXT NOT NULL
              CHECK (
                action_type IN (
                  'ONE_TIME_PAYMENT'
                )
              ),

            scope_id TEXT NOT NULL,

            amount_minor BIGINT NOT NULL
              CHECK (
                amount_minor > 0
              ),

            currency TEXT NOT NULL,

            status TEXT NOT NULL,

            expires_at TIMESTAMPTZ,

            verified_at TIMESTAMPTZ NOT NULL,

            created_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW(),

            updated_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW()
          )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          soko_cash_app_grant_request_uidx
        ON soko_cash_app_customer_grants (
          request_id
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_cash_app_grant_buyer_idx
        ON soko_cash_app_customer_grants (
          buyer_user_id,
          updated_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_cash_app_grant_scope_idx
        ON soko_cash_app_customer_grants (
          scope_id,
          status,
          updated_at DESC
        )
      `;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }

  return ready;
}

/**
 * Server/provider integration only.
 *
 * IMPORTANT:
 *
 * Do not call this directly with a grant ID,
 * customer ID, request ID, merchant scope,
 * amount or status supplied by mobile.
 *
 * Before this function is used in production,
 * those values must be confirmed using the
 * Cash App Network API.
 */
export async function dbSaveVerifiedCashAppGrant(
  input: {
    buyerUserId: string;
    grantId: string;
    customerId: string;
    requestId: string;
    referenceId: string;
    actionType: CashAppGrantAction;
    scopeId: string;
    amountMinor: number;
    currency: string;
    status: string;
    expiresAt?: string | Date | null;
    verified: true;
  }
) {
  await schema();

  const buyerUserId =
    clean(input.buyerUserId, 180);

  const grantId =
    clean(input.grantId, 512);

  const customerId =
    clean(input.customerId, 512);

  const requestId =
    clean(input.requestId, 512);

  const referenceId =
    clean(input.referenceId, 180);

  const scopeId =
    clean(input.scopeId, 180);

  const currency =
    normalizeCurrency(
      input.currency
    );

  const status =
    clean(input.status, 40)
      .toUpperCase();

  const amountMinor =
    input.amountMinor;

  if (input.verified !== true) {
    throw new Error(
      "Cash App grant must be provider verified."
    );
  }

  if (
    !buyerUserId ||
    !grantId ||
    !customerId ||
    !requestId ||
    !referenceId ||
    !scopeId ||
    !currency
  ) {
    throw new Error(
      "Verified Cash App grant identity is incomplete."
    );
  }

  if (
    input.actionType !==
    "ONE_TIME_PAYMENT"
  ) {
    throw new Error(
      "Unsupported Cash App grant action."
    );
  }

  if (status !== "ACTIVE") {
    throw new Error(
      "Cash App grant is not active."
    );
  }

  if (
    typeof amountMinor !== "number" ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor <= 0
  ) {
    throw new Error(
      "Invalid Cash App grant amount."
    );
  }

  if (
    !input.expiresAt
  ) {
    throw new Error(
      "Cash App grant expiration is required."
    );
  }

  const expiresAt =
    new Date(input.expiresAt);

  if (
    !Number.isFinite(
      expiresAt.getTime()
    )
  ) {
    throw new Error(
      "Invalid Cash App grant expiration."
    );
  }

  if (
    expiresAt.getTime() <=
      Date.now()
  ) {
    throw new Error(
      "Cash App grant has expired."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    INSERT INTO
      soko_cash_app_customer_grants (
        grant_id,
        buyer_user_id,
        customer_id,
        request_id,
        reference_id,
        action_type,
        scope_id,
        amount_minor,
        currency,
        status,
        expires_at,
        verified_at,
        updated_at
      )
    VALUES (
      ${grantId},
      ${buyerUserId},
      ${customerId},
      ${requestId},
      ${referenceId},
      ${input.actionType},
      ${scopeId},
      ${amountMinor},
      ${currency},
      ${status},
      ${expiresAt},
      NOW(),
      NOW()
    )
    ON CONFLICT (
      grant_id
    )
    DO UPDATE SET
      updated_at = NOW()
    WHERE
      soko_cash_app_customer_grants.buyer_user_id =
        EXCLUDED.buyer_user_id
      AND soko_cash_app_customer_grants.customer_id =
        EXCLUDED.customer_id
      AND soko_cash_app_customer_grants.request_id =
        EXCLUDED.request_id
      AND soko_cash_app_customer_grants.reference_id =
        EXCLUDED.reference_id
      AND soko_cash_app_customer_grants.action_type =
        EXCLUDED.action_type
      AND soko_cash_app_customer_grants.scope_id =
        EXCLUDED.scope_id
      AND soko_cash_app_customer_grants.amount_minor =
        EXCLUDED.amount_minor
      AND UPPER(
        soko_cash_app_customer_grants.currency
      ) = UPPER(EXCLUDED.currency)
      AND soko_cash_app_customer_grants.status =
        EXCLUDED.status
      AND soko_cash_app_customer_grants.expires_at =
        EXCLUDED.expires_at
    RETURNING *
  ` as CashAppGrantRow[];

  if (!rows[0]) {
    throw new Error(
      "Cash App grant identity conflict."
    );
  }

  return true;
}

/**
 * Server-only checkout resolver.
 *
 * Every authoritative order property must match
 * the provider-verified ONE_TIME_PAYMENT grant.
 *
 * Grant ID is intentionally returned only to
 * server code, never to mobile/public APIs.
 */
export async function dbGetVerifiedCashAppGrantForOrder(
  input: {
    buyerUserId: string;
    referenceId: string;
    merchantId: string;
    amountMinor: number;
    currency: string;
  }
) {
  await schema();

  const buyerUserId =
    clean(input.buyerUserId, 180);

  const referenceId =
    clean(input.referenceId, 180);

  const merchantId =
    clean(input.merchantId, 180);

  const currency =
    normalizeCurrency(
      input.currency
    );

  const amountMinor =
    Number(input.amountMinor);

  if (
    !buyerUserId ||
    !referenceId ||
    !merchantId ||
    !currency ||
    !Number.isSafeInteger(
      amountMinor
    ) ||
    amountMinor <= 0
  ) {
    return null;
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT *
    FROM soko_cash_app_customer_grants
    WHERE buyer_user_id =
      ${buyerUserId}

      AND reference_id =
        ${referenceId}

      AND action_type =
        'ONE_TIME_PAYMENT'

      AND scope_id =
        ${merchantId}

      AND amount_minor =
        ${amountMinor}

      AND UPPER(currency) =
        ${currency}

      AND status =
        'ACTIVE'

      AND verified_at
        IS NOT NULL

      AND expires_at
        IS NOT NULL

      AND expires_at >
        NOW()

    ORDER BY verified_at DESC

    LIMIT 2
  ` as CashAppGrantRow[];

  if (rows.length !== 1) {
    return null;
  }

  const row = rows[0];

  const storedAmount =
    Number(row.amount_minor);

  if (
    !Number.isSafeInteger(
      storedAmount
    ) ||
    storedAmount !==
      amountMinor
  ) {
    return null;
  }

  return {
    grantId: row.grant_id,
    customerId:
      row.customer_id,
    requestId:
      row.request_id,
    buyerUserId:
      row.buyer_user_id,
    referenceId:
      row.reference_id,
    merchantId:
      row.scope_id,
    actionType:
      row.action_type as CashAppGrantAction,
    amountMinor:
      storedAmount,
    currency:
      row.currency.toUpperCase(),
    status:
      row.status,
    verifiedAt:
      dateText(row.verified_at),
    expiresAt:
      dateText(row.expires_at),
  };
}
