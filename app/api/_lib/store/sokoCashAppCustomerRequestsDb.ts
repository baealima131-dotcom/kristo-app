import crypto from "node:crypto";

import { neon } from "@neondatabase/serverless";

import { getDatabaseUrl } from "./authDb";

export type CashAppCustomerRequestStatus =
  | "prepared"
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "failed";

type CustomerRequestRow = {
  order_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  merchant_id: string;
  reference_id: string;
  idempotency_key: string;
  request_environment: string;
  request_host: string;
  request_path: string;
  request_body: string;
  request_body_sha256: string;
  provider_request_id: string;

  /*
   * Provider-authoritative candidate identity.
   *
   * These are NOT verified grants yet.
   * Retrieve Grant must verify them later.
   */
  provider_grant_id: string;
  provider_customer_id: string;

  status: string;
  expires_at: string | Date | null;
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

function normalizeStatus(
  value: unknown
): CashAppCustomerRequestStatus {
  const status =
    clean(value, 40)
      .toLowerCase();

  if (
    status === "prepared" ||
    status === "pending" ||
    status === "approved" ||
    status === "declined" ||
    status === "expired" ||
    status === "failed"
  ) {
    return status;
  }

  throw new Error(
    "Invalid Cash App Customer Request status."
  );
}

function bodyDigest(
  body: string
) {
  return crypto
    .createHash("sha256")
    .update(body, "utf8")
    .digest("hex");
}

function dateText(
  value: string | Date | null
) {
  if (!value) return undefined;

  const parsed =
    new Date(value);

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
          soko_cash_app_customer_requests (
            order_id TEXT PRIMARY KEY,
            buyer_user_id TEXT NOT NULL,
            seller_user_id TEXT NOT NULL,
            merchant_id TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_environment TEXT
              NOT NULL DEFAULT 'unknown',
            request_host TEXT
              NOT NULL DEFAULT '',
            request_path TEXT
              NOT NULL DEFAULT '',
            request_body TEXT
              NOT NULL DEFAULT '',
            request_body_sha256 TEXT NOT NULL,
            provider_request_id TEXT
              NOT NULL DEFAULT '',

            provider_grant_id TEXT
              NOT NULL DEFAULT '',

            provider_customer_id TEXT
              NOT NULL DEFAULT '',

            status TEXT NOT NULL
              CHECK (
                status IN (
                  'prepared',
                  'pending',
                  'approved',
                  'declined',
                  'expired',
                  'failed'
                )
              ),
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
              NOT NULL DEFAULT NOW()
          )
      `;

      await sql`
        ALTER TABLE
          soko_cash_app_customer_requests
        ADD COLUMN IF NOT EXISTS
          request_environment TEXT
          NOT NULL DEFAULT 'unknown'
      `;

      await sql`
        ALTER TABLE
          soko_cash_app_customer_requests
        ADD COLUMN IF NOT EXISTS
          request_host TEXT
          NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_cash_app_customer_requests
        ADD COLUMN IF NOT EXISTS
          request_path TEXT
          NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_cash_app_customer_requests
        ADD COLUMN IF NOT EXISTS
          request_body TEXT
          NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_cash_app_customer_requests

        ADD COLUMN IF NOT EXISTS
          provider_grant_id TEXT
          NOT NULL DEFAULT ''
      `;

      await sql`
        ALTER TABLE
          soko_cash_app_customer_requests

        ADD COLUMN IF NOT EXISTS
          provider_customer_id TEXT
          NOT NULL DEFAULT ''
      `;

      /*
       * A provider grant belongs to one
       * authoritative Customer Request.
       */
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_grant_uidx

        ON soko_cash_app_customer_requests (
          provider_grant_id
        )

        WHERE provider_grant_id <> ''
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_reference_uidx
        ON soko_cash_app_customer_requests (
          reference_id
        )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_idempotency_uidx
        ON soko_cash_app_customer_requests (
          idempotency_key
        )
      `;

      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_provider_uidx
        ON soko_cash_app_customer_requests (
          provider_request_id
        )
        WHERE provider_request_id <> ''
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_buyer_idx
        ON soko_cash_app_customer_requests (
          buyer_user_id,
          updated_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_seller_idx
        ON soko_cash_app_customer_requests (
          seller_user_id,
          updated_at DESC
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS
          soko_cash_app_customer_request_status_idx
        ON soko_cash_app_customer_requests (
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
 * Persist the exact server-authoritative Customer
 * Request identity BEFORE a future Cash App call.
 *
 * IMPORTANT:
 *
 * buyer, seller, merchant, reference, amount/body
 * and idempotency identity must come from Kristo
 * server state — never directly from mobile.
 *
 * This function performs NO Cash App network call.
 */
export async function dbPrepareCashAppCustomerRequest(
  input: {
    orderId: string;
    buyerUserId: string;
    sellerUserId: string;
    merchantId: string;
    referenceId: string;
    idempotencyKey: string;
    environment: "sandbox" | "production";
    requestHost: string;
    requestPath: string;
    requestBody: string;
  }
) {
  await schema();

  const orderId =
    clean(input.orderId, 180);

  const buyerUserId =
    clean(input.buyerUserId, 180);

  const sellerUserId =
    clean(input.sellerUserId, 180);

  const merchantId =
    clean(input.merchantId, 180);

  const referenceId =
    clean(input.referenceId, 180);

  const rawIdempotencyKey =
    String(
      input.idempotencyKey || ""
    ).trim();

  if (
    rawIdempotencyKey.length > 64
  ) {
    throw new Error(
      "Cash App Customer Request idempotency key is too long."
    );
  }

  const idempotencyKey =
    rawIdempotencyKey;

  const environment =
    input.environment;

  const requestHost =
    clean(input.requestHost, 255)
      .toLowerCase();

  const requestPath =
    clean(input.requestPath, 512);

  const requestBody =
    String(input.requestBody || "");

  if (
    !orderId ||
    !buyerUserId ||
    !sellerUserId ||
    !merchantId ||
    !referenceId ||
    !idempotencyKey ||
    (
      environment !== "sandbox" &&
      environment !== "production"
    ) ||
    !requestHost ||
    !requestPath ||
    !requestBody
  ) {
    throw new Error(
      "Cash App Customer Request identity is incomplete."
    );
  }

  const digest =
    bodyDigest(requestBody);

  const sql = sqlClient();

  const rows = await sql`
    INSERT INTO
      soko_cash_app_customer_requests (
        order_id,
        buyer_user_id,
        seller_user_id,
        merchant_id,
        reference_id,
        idempotency_key,
        request_environment,
        request_host,
        request_path,
        request_body,
        request_body_sha256,
        status,
        updated_at
      )
    VALUES (
      ${orderId},
      ${buyerUserId},
      ${sellerUserId},
      ${merchantId},
      ${referenceId},
      ${idempotencyKey},
      ${environment},
      ${requestHost},
      ${requestPath},
      ${requestBody},
      ${digest},
      'prepared',
      NOW()
    )

    ON CONFLICT (
      order_id
    )

    DO UPDATE SET
      updated_at = NOW()

    WHERE
      soko_cash_app_customer_requests.buyer_user_id =
        EXCLUDED.buyer_user_id

      AND soko_cash_app_customer_requests.seller_user_id =
        EXCLUDED.seller_user_id

      AND soko_cash_app_customer_requests.merchant_id =
        EXCLUDED.merchant_id

      AND soko_cash_app_customer_requests.reference_id =
        EXCLUDED.reference_id

      AND soko_cash_app_customer_requests.idempotency_key =
        EXCLUDED.idempotency_key

      AND soko_cash_app_customer_requests.request_environment =
        EXCLUDED.request_environment

      AND soko_cash_app_customer_requests.request_host =
        EXCLUDED.request_host

      AND soko_cash_app_customer_requests.request_path =
        EXCLUDED.request_path

      AND soko_cash_app_customer_requests.request_body =
        EXCLUDED.request_body

      AND soko_cash_app_customer_requests.request_body_sha256 =
        EXCLUDED.request_body_sha256

    RETURNING
      order_id,
      buyer_user_id,
      seller_user_id,
      merchant_id,
      reference_id,
      idempotency_key,
      request_environment,
      request_host,
      request_path,
      request_body,
      request_body_sha256,
      provider_request_id,
      status,
      expires_at,
      created_at,
      updated_at
  ` as CustomerRequestRow[];

  const row = rows[0];

  if (!row) {
    throw new Error(
      "Cash App Customer Request identity conflict."
    );
  }

  return {
    orderId:
      row.order_id,

    buyerUserId:
      row.buyer_user_id,

    sellerUserId:
      row.seller_user_id,

    merchantId:
      row.merchant_id,

    referenceId:
      row.reference_id,

    idempotencyKey:
      row.idempotency_key,

    environment:
      row.request_environment,

    requestHost:
      row.request_host,

    requestPath:
      row.request_path,

    requestBody:
      row.request_body,

    requestBodySha256:
      row.request_body_sha256,

    providerRequestId:
      row.provider_request_id || undefined,

    status:
      normalizeStatus(row.status),

    expiresAt:
      dateText(row.expires_at),

    createdAt:
      dateText(row.created_at),

    updatedAt:
      dateText(row.updated_at),
  };
}

/**
 * Provider integration only.
 *
 * Call this only after Cash App itself returns
 * the Customer Request identity.
 *
 * Mobile must never supply providerRequestId.
 */
export async function dbRecordCashAppCustomerRequestResponse(
  input: {
    orderId: string;
    referenceId: string;
    providerRequestId: string;
    status: CashAppCustomerRequestStatus;
    expiresAt?: string | Date | null;
    /*
     * Parsed from the Cash App provider response.
     * Never accepted from Kristo mobile.
     */
    grantId?: string | null;
    customerId?: string | null;

    providerVerified: true;
  }
) {
  await schema();

  if (
    input.providerVerified !== true
  ) {
    throw new Error(
      "Cash App Customer Request response must be provider verified."
    );
  }

  const orderId =
    clean(input.orderId, 180);

  const referenceId =
    clean(input.referenceId, 180);

  const providerRequestId =
    clean(input.providerRequestId, 512);

  const status =
    normalizeStatus(input.status);

  const grantId =
    clean(
      input.grantId,
      512
    );

  const customerId =
    clean(
      input.customerId,
      512
    );

  /*
   * Both identities must arrive together.
   */
  if (
    Boolean(grantId) !==
    Boolean(customerId)
  ) {
    throw new Error(
      "Cash App provider grant/customer identity is incomplete."
    );
  }

  /*
   * Our Customer Request contains exactly one
   * ONE_TIME_PAYMENT action. APPROVED therefore
   * must identify exactly one provider grant pair.
   */
  if (
    status === "approved" &&
    (
      !grantId ||
      !customerId
    )
  ) {
    throw new Error(
      "Approved Cash App Customer Request is missing provider grant identity."
    );
  }

  if (
    !orderId ||
    !referenceId ||
    !providerRequestId
  ) {
    throw new Error(
      "Cash App provider request identity is incomplete."
    );
  }

  const expiresAt =
    input.expiresAt
      ? new Date(input.expiresAt)
      : null;

  if (
    expiresAt &&
    !Number.isFinite(
      expiresAt.getTime()
    )
  ) {
    throw new Error(
      "Invalid Cash App Customer Request expiration."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    UPDATE
      soko_cash_app_customer_requests

    SET
      provider_request_id =
        CASE
          WHEN provider_request_id = ''
            THEN ${providerRequestId}
          ELSE provider_request_id
        END,

      provider_grant_id =
        CASE
          WHEN provider_grant_id = ''
            AND ${grantId} <> ''
            THEN ${grantId}

          ELSE provider_grant_id
        END,

      provider_customer_id =
        CASE
          WHEN provider_customer_id = ''
            AND ${customerId} <> ''
            THEN ${customerId}

          ELSE provider_customer_id
        END,

      status = ${status},

      expires_at =
        COALESCE(
          expires_at,
          ${expiresAt}::timestamptz
        ),

      updated_at = NOW()

    WHERE order_id = ${orderId}

      AND reference_id =
        ${referenceId}

      AND (
        provider_request_id = ''
        OR provider_request_id =
          ${providerRequestId}
      )

      /*
       * Candidate grant/customer identity is
       * immutable once learned from Cash App.
       *
       * Empty incoming values are allowed for
       * PENDING responses that have no grant yet.
       */
      AND (
        ${grantId} = ''
        OR provider_grant_id = ''
        OR provider_grant_id =
          ${grantId}
      )

      AND (
        ${customerId} = ''
        OR provider_customer_id = ''
        OR provider_customer_id =
          ${customerId}
      )

      /*
       * Expiration identity:
       *
       * - first verified expiration may be stored;
       * - a later response may omit expiration;
       * - a later supplied expiration must match
       *   the already stored provider expiration.
       *
       * This prevents silent expiry mutation.
       */
      AND (
        expires_at IS NULL
        OR ${expiresAt}::timestamptz IS NULL
        OR expires_at =
          ${expiresAt}::timestamptz
      )

      /*
       * Provider status state machine.
       *
       * prepared/pending may advance.
       * Terminal states are sticky and may
       * only receive an idempotent repeat of
       * the same terminal state.
       *
       * This prevents stale provider responses
       * from regressing an authoritative state.
       */
      AND (
        (
          status IN (
            'prepared',
            'pending'
          )
          AND ${status} IN (
            'pending',
            'approved',
            'declined',
            'expired',
            'failed'
          )
        )
        OR (
          status = 'approved'
          AND ${status} = 'approved'
        )
        OR (
          status = 'declined'
          AND ${status} = 'declined'
        )
        OR (
          status = 'expired'
          AND ${status} = 'expired'
        )
        OR (
          status = 'failed'
          AND ${status} = 'failed'
        )
      )

    RETURNING
      order_id,
      buyer_user_id,
      seller_user_id,
      merchant_id,
      reference_id,
      idempotency_key,
      request_environment,
      request_host,
      request_path,
      request_body,
      request_body_sha256,
      provider_request_id,
      provider_grant_id,
      provider_customer_id,
      status,
      expires_at,
      created_at,
      updated_at
  ` as CustomerRequestRow[];

  const row = rows[0];

  if (!row) {
    throw new Error(
      "Cash App provider request identity conflict."
    );
  }

  return {
    orderId:
      row.order_id,

    providerRequestId:
      row.provider_request_id,

    referenceId:
      row.reference_id,

    providerGrantId:
      row.provider_grant_id ||
      undefined,

    providerCustomerId:
      row.provider_customer_id ||
      undefined,

    status:
      normalizeStatus(row.status),

    expiresAt:
      dateText(row.expires_at),

    updatedAt:
      dateText(row.updated_at),
  };
}


/**
 * Server-only lookup for a future Cash App
 * Customer Request network execution.
 *
 * IMPORTANT:
 *
 * This returns the exact persisted provider
 * request bytes. Never expose this object to
 * mobile/client code.
 */
export async function dbGetCashAppCustomerRequestForExecution(
  input: {
    orderId: string;
  }
) {
  await schema();

  const orderId =
    clean(input.orderId, 180);

  if (!orderId) {
    throw new Error(
      "Cash App Customer Request order ID is required."
    );
  }

  const sql = sqlClient();

  const rows = await sql`
    SELECT
      order_id,
      buyer_user_id,
      seller_user_id,
      merchant_id,
      reference_id,
      idempotency_key,
      request_environment,
      request_host,
      request_path,
      request_body,
      request_body_sha256,
      provider_request_id,
      provider_grant_id,
      provider_customer_id,
      status,
      expires_at,
      created_at,
      updated_at

    FROM
      soko_cash_app_customer_requests

    WHERE
      order_id =
        ${orderId}

    LIMIT 2
  ` as CustomerRequestRow[];

  if (rows.length !== 1) {
    return null;
  }

  const row =
    rows[0];

  const requestBody =
    String(
      row.request_body || ""
    );

  const storedDigest =
    clean(
      row.request_body_sha256,
      128
    ).toLowerCase();

  const computedDigest =
    bodyDigest(
      requestBody
    ).toLowerCase();

  if (
    !requestBody ||
    !storedDigest ||
    storedDigest !==
      computedDigest
  ) {
    throw new Error(
      "Cash App Customer Request body integrity check failed."
    );
  }

  return {
    orderId:
      row.order_id,

    buyerUserId:
      row.buyer_user_id,

    sellerUserId:
      row.seller_user_id,

    merchantId:
      row.merchant_id,

    referenceId:
      row.reference_id,

    idempotencyKey:
      row.idempotency_key,

    environment:
      row.request_environment,

    requestHost:
      row.request_host,

    requestPath:
      row.request_path,

    requestBody,

    requestBodySha256:
      storedDigest,

    providerRequestId:
      row.provider_request_id ||
      undefined,

    /*
     * Candidate only.
     *
     * Retrieve Grant must verify these before
     * anything enters the verified grant store.
     */
    providerGrantId:
      row.provider_grant_id ||
      undefined,

    providerCustomerId:
      row.provider_customer_id ||
      undefined,

    status:
      normalizeStatus(
        row.status
      ),

    expiresAt:
      dateText(
        row.expires_at
      ),

    createdAt:
      dateText(
        row.created_at
      ),

    updatedAt:
      dateText(
        row.updated_at
      ),
  };
}
