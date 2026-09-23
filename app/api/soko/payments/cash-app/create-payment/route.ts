import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

import {
  getSokoCashAppPaymentContext,
} from "@/app/api/_lib/store/sokoOrdersDb";

import {
  dbGetVerifiedSellerPaymentMerchant,
} from "@/app/api/_lib/store/sokoSellerPaymentAccountsDb";

import {
  dbGetCashAppCustomerRequestForExecution,
} from "@/app/api/_lib/store/sokoCashAppCustomerRequestsDb";

import {
  dbGetVerifiedCashAppGrantForOrder,
} from "@/app/api/_lib/store/sokoCashAppCustomerGrantsDb";

import {
  executeSandboxCashAppCreatePayment,
} from "@/app/api/_lib/cashAppSandboxCreatePaymentExecutor";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

function reply(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
      headers: {
        "Cache-Control":
          "private, no-store",
      },
    }
  );
}

async function readJson(
  req: NextRequest
) {
  if (!req.body) {
    throw new Error(
      "Missing payment request."
    );
  }

  const reader =
    req.body.getReader();

  const chunks:
    Uint8Array[] = [];

  let size = 0;

  try {
    while (true) {
      const part =
        await reader.read();

      if (part.done) {
        break;
      }

      size +=
        part.value.byteLength;

      if (
        size >
        8 * 1024
      ) {
        await reader.cancel();

        throw new Error(
          "Payment request is too large."
        );
      }

      chunks.push(
        part.value
      );
    }
  } finally {
    reader.releaseLock();
  }

  const value =
    JSON.parse(
      Buffer
        .concat(chunks)
        .toString("utf8")
    );

  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "Invalid payment request."
    );
  }

  return value as Record<
    string,
    unknown
  >;
}

export async function POST(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
      NextResponse
  ) {
    return auth;
  }

  try {
    /*
     * SANDBOX ONLY.
     *
     * Production Create Payment
     * remains disabled.
     */
    const sandboxEnabled =
      String(
        process.env
          .CASH_APP_PARTNER_SANDBOX ||
        ""
      )
        .trim()
        .toLowerCase() ===
      "true";

    if (!sandboxEnabled) {
      return reply(
        {
          ok: false,
          available: false,

          code:
            "CASH_APP_PARTNER_NOT_ACTIVE",

          error:
            "Automatic Cash App payment is not active yet.",
        },
        503
      );
    }

    const body =
      await readJson(req);

    /*
     * SECURITY:
     *
     * Client supplies ONLY orderId.
     */
    const orderId =
      String(
        body.orderId ||
        ""
      ).trim();

    if (!orderId) {
      return reply(
        {
          ok: false,
          available: false,

          code:
            "CASH_APP_ORDER_ID_REQUIRED",

          error:
            "Order ID is required.",
        },
        400
      );
    }

    const context =
      await getSokoCashAppPaymentContext({
        orderId,

        buyerUserId:
          auth.viewer.userId,
      });

    /*
     * If a trusted provider payment
     * is already bound, do not create
     * another provider payment.
     *
     * Never expose the PWC identity.
     */
    if (
      String(
        context.providerPaymentId ||
        ""
      ).trim()
    ) {
      return reply(
        {
          ok: true,
          available: true,

          environment:
            "sandbox",

          code:
            "CASH_APP_PAYMENT_ALREADY_BOUND",

          status:
            "payment_bound_awaiting_webhook",
        },
        200
      );
    }

    const merchant =
      await dbGetVerifiedSellerPaymentMerchant({
        sellerUserId:
          context.sellerUserId,

        provider:
          "cash_app",
      });

    if (!merchant) {
      return reply(
        {
          ok: false,
          available: false,

          code:
            "CASH_APP_SELLER_NOT_CONNECTED",

          error:
            "Automatic Cash App payment is not available for this seller.",
        },
        503
      );
    }

    const prepared =
      await dbGetCashAppCustomerRequestForExecution({
        orderId:
          context.orderId,
      });

    if (!prepared) {
      return reply(
        {
          ok: false,
          available: false,

          code:
            "CASH_APP_AUTHORIZATION_NOT_STARTED",

          error:
            "Cash App authorization has not been started.",
        },
        409
      );
    }

    /*
     * Customer Request must already
     * have been provider-verified APPROVED.
     */
    if (
      prepared.orderId !==
        context.orderId ||
      prepared.buyerUserId !==
        context.buyerUserId ||
      prepared.sellerUserId !==
        context.sellerUserId ||
      prepared.merchantId !==
        merchant.externalMerchantId ||
      prepared.environment !==
        "sandbox" ||
      prepared.status !==
        "approved"
    ) {
      return reply(
        {
          ok: false,
          available: false,

          code:
            "CASH_APP_AUTHORIZATION_NOT_APPROVED",

          error:
            "Cash App authorization is not approved yet.",
        },
        409
      );
    }

    const referenceId =
      String(
        prepared.referenceId ||
        ""
      ).trim();

    if (!referenceId) {
      throw new Error(
        "Cash App authorization reference is unavailable."
      );
    }

    /*
     * Require provider-verified ACTIVE
     * ONE_TIME_PAYMENT grant before
     * Create Payment.
     */
    const grant =
      await dbGetVerifiedCashAppGrantForOrder({
        buyerUserId:
          context.buyerUserId,

        referenceId,

        merchantId:
          merchant.externalMerchantId,

        amountMinor:
          context.amountMinor,

        currency:
          context.currency,
      });

    if (
      !grant ||
      grant.buyerUserId !==
        context.buyerUserId ||
      grant.referenceId !==
        referenceId ||
      grant.merchantId !==
        merchant.externalMerchantId ||
      grant.amountMinor !==
        context.amountMinor ||
      String(
        grant.currency ||
        ""
      ).toUpperCase() !==
        context.currency.toUpperCase() ||
      grant.actionType !==
        "ONE_TIME_PAYMENT" ||
      String(
        grant.status ||
        ""
      ).toUpperCase() !==
        "ACTIVE"
    ) {
      return reply(
        {
          ok: false,
          available: false,

          code:
            "CASH_APP_GRANT_NOT_VERIFIED",

          error:
            "Verified Cash App authorization grant is not ready.",
        },
        409
      );
    }

    /*
     * SANDBOX provider execution.
     *
     * Executor:
     * - reloads authoritative order;
     * - reloads verified grant;
     * - signs Network API request;
     * - strictly parses Cash App;
     * - binds trusted PWC identity;
     * - DOES NOT approve order.
     */
    const created =
      await executeSandboxCashAppCreatePayment({
        orderId:
          context.orderId,

        buyerUserId:
          context.buyerUserId,

        sellerUserId:
          context.sellerUserId,

        merchantId:
          merchant.externalMerchantId,

        referenceId,
      });

    /*
     * Defense-in-depth after trusted
     * executor return.
     */
    if (
      !created.providerPaymentId ||
      created.merchantId !==
        merchant.externalMerchantId ||
      created.referenceId !==
        referenceId ||
      created.grantId !==
        grant.grantId ||
      created.customerId !==
        grant.customerId ||
      created.amountMinor !==
        context.amountMinor ||
      String(
        created.currency ||
        ""
      ).toUpperCase() !==
        context.currency.toUpperCase()
    ) {
      throw new Error(
        "Cash App Create Payment identity mismatch."
      );
    }

    const providerStatus =
      String(
        created.status ||
        ""
      ).toUpperCase();

    if (
      providerStatus !==
        "AUTHORIZED" &&
      providerStatus !==
        "CAPTURED"
    ) {
      throw new Error(
        "Cash App Create Payment status is unsupported."
      );
    }

    console.log(
      "KRISTO_SOKO_CASHAPP_SANDBOX_PAYMENT_BOUND",
      {
        orderId:
          context.orderId,

        sellerUserId:
          context.sellerUserId,

        providerStatus,

        providerPaymentBound:
          true,

        providerPaymentIdExposed:
          false,

        referenceIdExposed:
          false,

        grantIdExposed:
          false,

        customerIdExposed:
          false,

        merchantIdExposed:
          false,

        amountExposed:
          false,

        orderApproved:
          false,
      }
    );

    /*
     * CAPTURED here still does NOT mean
     * Kristo marks order paid.
     *
     * Signed CAPTURED webhook remains
     * the final approval authority.
     */
    return reply(
      {
        ok: true,
        available: true,

        environment:
          "sandbox",

        code:
          providerStatus ===
            "CAPTURED"
            ? "CASH_APP_PAYMENT_CAPTURED_AWAITING_WEBHOOK"
            : "CASH_APP_PAYMENT_AUTHORIZED",

        status:
          providerStatus ===
            "CAPTURED"
            ? "payment_captured_awaiting_webhook"
            : "payment_authorized",
      },
      200
    );
  } catch (error) {
    return reply(
      {
        ok: false,
        available: false,

        error:
          error instanceof Error
            ? error.message
            : "Cash App payment could not be created.",
      },
      400
    );
  }
}
