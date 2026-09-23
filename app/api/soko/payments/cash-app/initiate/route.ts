import { NextRequest, NextResponse } from "next/server";

import { guardAuth } from "@/app/api/_lib/rbac";
import {
  getSokoCashAppPaymentContext,
  ensureSokoCashAppOrderReferenceById,
} from "@/app/api/_lib/store/sokoOrdersDb";

import {
  dbGetVerifiedSellerPaymentMerchant,
} from "@/app/api/_lib/store/sokoSellerPaymentAccountsDb";

import {
  dbGetVerifiedCashAppGrantForOrder,
} from "@/app/api/_lib/store/sokoCashAppCustomerGrantsDb";

import {
  dbGetCashAppCustomerRequestForExecution,
  dbPrepareCashAppCustomerRequest,
} from "@/app/api/_lib/store/sokoCashAppCustomerRequestsDb";

import {
  buildCashAppPartnerPaymentRequest,
  buildCashAppOneTimeCustomerRequest,
  buildCashAppCustomerRequestHttpRequest,
  cashAppCustomerRequestConfigured,
  cashAppNetworkConfigured,
  createCashAppServerReference,
} from "@/app/api/_lib/cashAppPartnerClient";

import {
  executeSandboxCashAppCustomerRequest,
} from "@/app/api/_lib/cashAppSandboxCustomerRequestExecutor";

import {
  executeSandboxCashAppRetrieveCustomerRequest,
} from "@/app/api/_lib/cashAppSandboxRetrieveCustomerRequestExecutor";


import {
  executeSandboxCashAppRetrieveGrant,
} from "@/app/api/_lib/cashAppSandboxRetrieveGrantExecutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(
  body: unknown,
  status = 200
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
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

  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const part =
        await reader.read();

      if (part.done) break;

      size +=
        part.value.byteLength;

      if (size > 8 * 1024) {
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

  const value = JSON.parse(
    Buffer.concat(chunks)
      .toString("utf8")
  );

  if (
    !value ||
    typeof value !== "object" ||
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

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  try {
    /*
     * Mobile supplies ONLY the Kristo/SOKO order ID.
     *
     * Provider request ID, reference, merchant,
     * seller, amount and currency remain server-side.
     */
    const orderId =
      String(
        req.nextUrl.searchParams.get(
          "orderId"
        ) || ""
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

    await ensureSokoCashAppOrderReferenceById(
      context.orderId
    );

    const merchant =
      await dbGetVerifiedSellerPaymentMerchant({
        sellerUserId:
          context.sellerUserId,
        provider:
          "cash_app",
      });

    if (!merchant?.externalMerchantId) {
      return reply(
        {
          ok: false,
          available: false,
          code:
            "CASH_APP_SELLER_NOT_CONNECTED",
          error:
            "Automatic Cash App payment is not available for this seller yet.",
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
            "Cash App authorization has not been started for this order.",
        },
        404
      );
    }

    /*
     * Full authoritative identity check before
     * any provider polling occurs.
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
        "sandbox"
    ) {
      throw new Error(
        "Cash App authorization state identity mismatch."
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
     * Production remains OFF.
     *
     * GET continuation executes provider polling
     * only for a persisted sandbox request and
     * literal sandbox environment flag.
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

    /*
     * If a prior verified poll already moved this
     * immutable Customer Request to a terminal state,
     * do not call the pending-only executor again.
     *
     * Never expose providerRequestId, grant/customer
     * candidate IDs, merchant ID, reference, or amount.
     */
    if (
      prepared.status ===
        "approved"
    ) {
      /*
       * APPROVED Customer Request means Cash App
       * supplied a candidate grant/customer pair.
       *
       * It is NOT enough to create a payment.
       *
       * First resolve an already provider-verified
       * grant. If none exists, Retrieve Grant from
       * the SANDBOX Network API and verify it.
       */
      let verifiedGrant =
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

      let retrieveGrantExecuted =
        false;

      if (!verifiedGrant) {
        verifiedGrant =
          await executeSandboxCashAppRetrieveGrant({
            orderId:
              context.orderId,

            buyerUserId:
              context.buyerUserId,

            sellerUserId:
              context.sellerUserId,

            merchantId:
              merchant.externalMerchantId,

            referenceId,

            amountMinor:
              context.amountMinor,

            currency:
              context.currency,
          });

        retrieveGrantExecuted =
          true;
      }

      /*
       * Defense-in-depth after either DB resolution
       * or provider Retrieve Grant.
       *
       * No grant/customer/provider IDs are returned
       * to Kristo mobile.
       */
      if (
        !verifiedGrant ||
        verifiedGrant.buyerUserId !==
          context.buyerUserId ||
        verifiedGrant.referenceId !==
          referenceId ||
        verifiedGrant.merchantId !==
          merchant.externalMerchantId ||
        verifiedGrant.amountMinor !==
          context.amountMinor ||
        String(
          verifiedGrant.currency ||
          ""
        ).toUpperCase() !==
          context.currency.toUpperCase() ||
        String(
          verifiedGrant.status ||
          ""
        ).toUpperCase() !==
          "ACTIVE"
      ) {
        throw new Error(
          "Cash App verified grant identity mismatch."
        );
      }

      console.log(
        "KRISTO_SOKO_CASHAPP_SANDBOX_GRANT_VERIFIED",
        {
          orderId:
            context.orderId,

          sellerUserId:
            context.sellerUserId,

          authorizationStatus:
            "approved",

          grantVerified:
            true,

          retrieveGrantExecuted,

          grantIdExposed:
            false,

          customerIdExposed:
            false,

          providerRequestIdExposed:
            false,

          referenceIdExposed:
            false,

          paymentCreated:
            false,

          orderApproved:
            false,
        }
      );

      return reply(
        {
          ok: true,
          available: true,

          environment:
            "sandbox",

          code:
            "CASH_APP_GRANT_VERIFIED",

          status:
            "grant_verified",

          expiresAt:
            verifiedGrant.expiresAt ||
            prepared.expiresAt ||
            null,
        },
        200
      );
    }

    if (
      [
        "declined",
        "expired",
        "failed",
      ].includes(
        String(
          prepared.status ||
          ""
        )
      )
    ) {
      return reply(
        {
          ok: true,
          available: true,
          environment:
            "sandbox",
          code:
            "CASH_APP_AUTHORIZATION_TERMINAL",
          status:
            `authorization_${prepared.status}`,
          expiresAt:
            prepared.expiresAt ||
            null,
        },
        200
      );
    }

    if (
      prepared.status !==
        "pending"
    ) {
      throw new Error(
        "Cash App authorization state is not supported."
      );
    }

    const retrieved =
      await executeSandboxCashAppRetrieveCustomerRequest({
        orderId:
          context.orderId,

        buyerUserId:
          context.buyerUserId,

        sellerUserId:
          context.sellerUserId,

        merchantId:
          merchant.externalMerchantId,

        referenceId,

        amountMinor:
          context.amountMinor,

        currency:
          context.currency,
      });

    if (
      retrieved.providerRequestId !==
        prepared.providerRequestId
    ) {
      throw new Error(
        "Cash App retrieved authorization identity mismatch."
      );
    }

    const providerStatus =
      retrieved.status;

    let publicCode:
      string;

    let publicStatus:
      string;

    if (
      providerStatus ===
        "approved"
    ) {
      publicCode =
        "CASH_APP_AUTHORIZATION_APPROVED";

      publicStatus =
        "authorization_approved";
    } else if (
      providerStatus ===
        "pending"
    ) {
      publicCode =
        "CASH_APP_AUTHORIZATION_PENDING";

      publicStatus =
        "authorization_pending";
    } else {
      publicCode =
        "CASH_APP_AUTHORIZATION_TERMINAL";

      publicStatus =
        `authorization_${providerStatus}`;
    }

    console.log(
      "KRISTO_SOKO_CASHAPP_SANDBOX_AUTHORIZATION_STATUS",
      {
        orderId:
          context.orderId,
        status:
          providerStatus,
        retrieveExecuted:
          true,
        providerRequestIdExposed:
          false,
        referenceIdExposed:
          false,
        grantIdExposed:
          false,
        customerIdExposed:
          false,
      }
    );

    return reply(
      {
        ok: true,
        available: true,

        environment:
          "sandbox",

        code:
          publicCode,

        status:
          publicStatus,

        /*
         * Pending may still carry the safe
         * Cash App authorization URL.
         */
        authorizationUrl:
          providerStatus ===
            "pending"
            ? String(
                retrieved.mobileUrl ||
                ""
              ).trim() ||
              null
            : null,

        expiresAt:
          retrieved.expiresAt ||
          null,
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
            : "Cash App authorization status could not be checked.",
      },
      400
    );
  }
}

export async function POST(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof NextResponse
  ) {
    return auth;
  }

  try {
    const body =
      await readJson(req);

    const orderId =
      String(
        body.orderId || ""
      ).trim();

    /*
     * SECURITY:
     *
     * The client supplies only the order ID.
     *
     * Buyer identity comes from authenticated
     * Kristo session.
     *
     * Amount, currency, seller identity and
     * provider binding information are loaded
     * from the authoritative order record.
     */
    const context =
      await getSokoCashAppPaymentContext({
        orderId,
        buyerUserId:
          auth.viewer.userId,
      });

    await ensureSokoCashAppOrderReferenceById(
      context.orderId
    );

    /*
     * SERVER-ONLY PAYMENT IDENTITY CHAIN:
     *
     * 1. Order supplied seller identity.
     * 2. Verified seller connection supplies
     *    Cash App merchant identity.
     * 3. Kristo generates the reference.
     * 4. Only a provider-verified grant matching
     *    buyer + merchant + amount + currency +
     *    reference can resolve.
     *
     * None of these identities are accepted
     * from the mobile request.
     */
    const merchant =
      await dbGetVerifiedSellerPaymentMerchant({
        sellerUserId:
          context.sellerUserId,
        provider: "cash_app",
      });

    if (!merchant?.externalMerchantId) {
      return reply(
        {
          ok: false,
          available: false,
          code:
            "CASH_APP_SELLER_NOT_CONNECTED",
          error:
            "Automatic Cash App payment is not available for this seller yet. Use the existing Cash App payment flow.",
        },
        503
      );
    }

    const referenceId =
      createCashAppServerReference(
        context.orderId
      );

    /*
     * CASH APP AUTHORIZATION CHAIN
     *
     * BUYER:
     * authenticated Kristo App user + order.
     *
     * SELLER:
     * verified Cash App merchant belonging to
     * the SOKO seller attached to this order.
     *
     * Customer Request comes BEFORE grant:
     *
     * Customer Request
     * -> Kristo buyer authorizes
     * -> Cash App creates grant
     * -> verified grant
     * -> provider payment.
     *
     * Mobile cannot choose merchant, amount,
     * currency, grant, or provider identity.
     */
    const customerRequest =
      buildCashAppOneTimeCustomerRequest({
        orderId:
          context.orderId,

        merchantId:
          merchant.externalMerchantId,

        amountMinor:
          context.amountMinor,

        currency:
          context.currency,

        redirectUrl:
          "https://kristo-app.vercel.app/cash-app/return",
      });

    const customerAction =
      customerRequest.request.actions[0];

    if (
      customerRequest.request.channel !==
        "IN_APP" ||
      customerAction.type !==
        "ONE_TIME_PAYMENT" ||
      customerAction.scope_id !==
        merchant.externalMerchantId ||
      customerAction.amount !==
        context.amountMinor ||
      customerAction.currency !==
        context.currency.toUpperCase() ||
      customerRequest.request.reference_id !==
        referenceId
    ) {
      throw new Error(
        "Cash App customer request context mismatch."
      );
    }

    /*
     * Dormant Customer Request HTTP descriptor.
     *
     * IMPORTANT:
     * This prepares method/path/headers/body only.
     * It does NOT call Cash App.
     *
     * Customer Request API uses the client ID,
     * not the Network API key/secret signer.
     */
    const customerRequestClientId =
      String(
        process.env
          .CASH_APP_PARTNER_CLIENT_ID || ""
      ).trim();

    const customerRequestConfigured =
      cashAppCustomerRequestConfigured();

    const environmentFlag =
      String(
        process.env
          .CASH_APP_PARTNER_SANDBOX || ""
      )
        .trim()
        .toLowerCase();

    const customerRequestEnvironment =
      environmentFlag === "true"
        ? "sandbox"
        : environmentFlag === "false"
          ? "production"
          : null;

    const customerRequestHttp =
      customerRequestConfigured &&
      customerRequestClientId &&
      customerRequestEnvironment
        ? buildCashAppCustomerRequestHttpRequest({
            clientId:
              customerRequestClientId,

            request:
              customerRequest,

            sandbox:
              customerRequestEnvironment ===
              "sandbox",
          })
        : null;

    if (customerRequestHttp) {
      if (
        customerRequestHttp.method !==
          "POST" ||
        customerRequestHttp.path !==
          "/customer-request/v1/requests" ||
        customerRequestHttp.headers.Authorization !==
          `Client ${customerRequestClientId}` ||
        customerRequestHttp.body !==
          JSON.stringify(customerRequest)
      ) {
        throw new Error(
          "Cash App Customer Request HTTP descriptor mismatch."
        );
      }
    }

    /*
     * Persist the immutable server-authoritative
     * Customer Request identity before any future
     * provider network execution is enabled.
     *
     * This does NOT call Cash App.
     */
    if (customerRequestHttp) {
      if (
        customerRequestEnvironment !== "sandbox" &&
        customerRequestEnvironment !== "production"
      ) {
        throw new Error(
          "Cash App Customer Request environment is invalid."
        );
      }

      const preparedCustomerRequest =
        await dbPrepareCashAppCustomerRequest({
          orderId:
            context.orderId,

          buyerUserId:
            context.buyerUserId,

          sellerUserId:
            context.sellerUserId,

          merchantId:
            merchant.externalMerchantId,

          referenceId:
            referenceId,

          idempotencyKey:
            customerRequest.idempotency_key,

          environment:
            customerRequestEnvironment,

          requestHost:
            customerRequestHttp.host,

          requestPath:
            customerRequestHttp.path,

          requestBody:
            customerRequestHttp.body,
        });

      if (
        preparedCustomerRequest.orderId !==
          context.orderId ||
        preparedCustomerRequest.referenceId !==
          referenceId ||
        preparedCustomerRequest.idempotencyKey !==
          customerRequest.idempotency_key ||
        preparedCustomerRequest.environment !==
          customerRequestEnvironment ||
        preparedCustomerRequest.requestHost !==
          customerRequestHttp.host ||
        preparedCustomerRequest.requestPath !==
          customerRequestHttp.path ||
        preparedCustomerRequest.requestBody !==
          customerRequestHttp.body
      ) {
        throw new Error(
          "Cash App Customer Request persistence mismatch."
        );
      }
    }

    /*
     * SANDBOX CUSTOMER AUTHORIZATION EXECUTION
     *
     * This is the first intentionally enabled
     * provider-network step in the initiate route.
     *
     * SECURITY:
     *
     * - literal sandbox environment only;
     * - all identities came from server-side order /
     *   verified seller mapping;
     * - executor re-reads the immutable request;
     * - mobile never supplies merchant/amount/reference;
     * - provider request/grant/customer IDs never leave
     *   this server boundary;
     * - this step does NOT create a payment;
     * - this step does NOT bind PWC;
     * - this step does NOT approve the order.
     */
    if (
      customerRequestEnvironment ===
        "sandbox" &&
      customerRequestHttp
    ) {
      const executedCustomerRequest =
        await executeSandboxCashAppCustomerRequest({
          orderId:
            context.orderId,

          buyerUserId:
            context.buyerUserId,

          sellerUserId:
            context.sellerUserId,

          merchantId:
            merchant.externalMerchantId,

          referenceId,

          amountMinor:
            context.amountMinor,

          currency:
            context.currency,
        });

      if (
        executedCustomerRequest.referenceId !==
          referenceId ||
        !executedCustomerRequest.providerRequestId
      ) {
        throw new Error(
          "Cash App sandbox Customer Request identity mismatch."
        );
      }

      const authorizationStatus =
        executedCustomerRequest.status;

      const authorizationUrl =
        String(
          executedCustomerRequest.mobileUrl ||
          ""
        ).trim();

      if (
        authorizationStatus ===
          "pending"
      ) {
        if (
          !authorizationUrl ||
          !authorizationUrl.startsWith(
            "https://"
          )
        ) {
          throw new Error(
            "Cash App sandbox authorization URL is unavailable."
          );
        }

        console.log(
          "KRISTO_SOKO_CASHAPP_SANDBOX_AUTHORIZATION_READY",
          {
            orderId:
              context.orderId,

            sellerUserId:
              context.sellerUserId,

            status:
              authorizationStatus,

            hasAuthorizationUrl:
              true,

            providerRequestIdExposed:
              false,

            referenceIdExposed:
              false,

            grantIdExposed:
              false,

            customerIdExposed:
              false,
          }
        );

        return reply(
          {
            ok: true,
            available: true,

            environment:
              "sandbox",

            code:
              "CASH_APP_AUTHORIZATION_REQUIRED",

            status:
              "authorization_required",

            authorizationUrl,

            expiresAt:
              executedCustomerRequest.expiresAt ||
              null,
          },
          200
        );
      }

      /*
       * CREATE normally begins PENDING.
       *
       * If Cash App returns another verified state,
       * do not guess the next action here.
       * Retrieve Customer Request / Retrieve Grant
       * remain separate orchestration stages.
       */
      return reply(
        {
          ok: true,
          available: true,

          environment:
            "sandbox",

          code:
            "CASH_APP_AUTHORIZATION_STATE",

          status:
            authorizationStatus,

          authorizationUrl:
            authorizationUrl ||
            null,

          expiresAt:
            executedCustomerRequest.expiresAt ||
            null,
        },
        200
      );
    }

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

    if (!grant) {
      return reply(
        {
          ok: false,
          available: false,
          code:
            "CASH_APP_GRANT_NOT_READY",
          error:
            "Cash App authorization is not ready for this order. Use the existing Cash App payment flow.",
        },
        503
      );
    }

    /*
     * Future Network API activation gate.
     *
     * This only checks whether all Network API
     * credentials are configured.
     *
     * IMPORTANT:
     * It does NOT perform a Cash App request.
     */
    const networkConfigured =
      cashAppNetworkConfigured();

    /*
     * Build the exact server-authoritative
     * Cash App payment payload.
     *
     * This DOES NOT perform a network request.
     */
    const providerRequest =
      buildCashAppPartnerPaymentRequest(
        context.orderId,
        {
          amountMinor:
            context.amountMinor,
          currency:
            context.currency,
          merchantId:
            merchant.externalMerchantId,
          grantId:
            grant.grantId,
          referenceId,
        }
      );

    /*
     * Defense-in-depth:
     *
     * Ensure the payload produced for the
     * future provider call still matches the
     * authoritative order + verified identities.
     */
    if (
      providerRequest.payment.amount !==
        context.amountMinor ||
      providerRequest.payment.currency !==
        context.currency.toUpperCase() ||
      providerRequest.payment.merchant_id !==
        merchant.externalMerchantId ||
      providerRequest.payment.grant_id !==
        grant.grantId ||
      providerRequest.payment.reference_id !==
        referenceId ||
      providerRequest.payment.capture !== true
    ) {
      throw new Error(
        "Cash App provider payment context mismatch."
      );
    }

    /*
     * Cash App Partner payment creation is
     * intentionally dormant.
     *
     * Do NOT bind provider payment IDs here
     * until they come from a verified provider
     * API response.
     *
     * Manual Cash App + screenshot/OCR flow
     * remains the active fallback.
     */
    console.log(
      "KRISTO_SOKO_CASHAPP_INIT_DORMANT",
      {
        orderId:
          context.orderId,
        sellerUserId:
          context.sellerUserId,
        amountMinor:
          context.amountMinor,
        currency:
          context.currency,
        merchantVerified: true,
        grantVerified: true,
        networkConfigured,
        providerRequestPrepared: true,
        idempotencyKeyPresent:
          Boolean(
            providerRequest.idempotency_key
          ),
      }
    );

    return reply(
      {
        ok: false,
        available: false,
        code:
            "CASH_APP_PARTNER_NOT_ACTIVE",
          error:
            "Cash App checkout is not available yet.",
      },
      503
    );
  } catch (error) {
    return reply(
      {
        ok: false,
        available: false,
        error:
          error instanceof Error
            ? error.message
            : "Cash App payment could not be prepared.",
      },
      400
    );
  }
}
