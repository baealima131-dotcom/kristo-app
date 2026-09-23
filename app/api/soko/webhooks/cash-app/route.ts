import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  getPaymentWebhookEvent,
  markPaymentWebhookOrderMatch,
  recordPaymentWebhookReconciliation,
  savePaymentWebhookEvent,
} from "@/app/api/_lib/store/sokoPaymentWebhookDb";
import { findSokoCashAppOrderMatch } from "@/app/api/_lib/store/sokoOrdersDb";
import { verifyCashAppWebhookSignature } from "@/app/api/_lib/cashAppWebhookSignature";
import { dbResolveSellerFromProviderMerchant } from "@/app/api/_lib/store/sokoSellerPaymentAccountsDb";
import { applyStoredCashAppCapturedWebhook } from "@/app/api/_lib/cashAppCapturedPaymentBoundary";
import {
  cashAppWebhookEnvironmentMatches,
  configuredCashAppPartnerEnvironment,
  extractCashAppEventEnvironment,
  isFinalSuccessfulCashAppPaymentStatus,
  type CashAppReconciliationReason,
} from "@/app/api/_lib/cashAppPaymentConfirmation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function clean(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!rawBody || rawBody.length > 256 * 1024) {
    return reply({ ok: false, error: "Invalid webhook body." }, 400);
  }

  const payloadSha256 = createHash("sha256")
    .update(Buffer.from(rawBody, "utf8"))
    .digest("hex")
    .toLowerCase();

  const verification = verifyCashAppWebhookSignature({
    method: req.method,
    path: `${req.nextUrl.pathname}${req.nextUrl.search}`,
    rawBody,
    headers: req.headers,
  });

  if (!verification.ok) {
    console.warn("KRISTO_SOKO_CASHAPP_WEBHOOK_REJECTED", {
      reason: verification.reason,
    });

    return reply(
      {
        ok: false,
        error: "Invalid webhook signature.",
      },
      403
    );
  }

  let body: Record<string, any>;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply({ ok: false, error: "Invalid JSON." }, 400);
  }

  const eventId = clean(
    body.event_id ||
      body.eventId ||
      body.id,
    180
  );

  if (!eventId) {
    return reply({ ok: false, error: "Missing event id." }, 400);
  }

  /*
   * IMPORTANT:
   * Signature verification already happened above,
   * before JSON parsing or event storage.
   *
   * We intentionally do NOT approve an order here yet.
   */
  const event = objectValue(body.event);
  const data = objectValue(body.data);
  const dataObject = objectValue(data.object);
  const payment = objectValue(
    dataObject.payment ||
      data.payment ||
      event.payment ||
      body.payment
  );

  const amount = objectValue(
    payment.amount_money ||
      payment.amountMoney
  );

  const sellerExternalId = clean(
    payment.merchant_id ||
      payment.merchantId ||
      data.merchant_id ||
      data.merchantId,
    180
  );

  const sellerUserId = sellerExternalId
    ? await dbResolveSellerFromProviderMerchant({
        provider: "cash_app",
        externalMerchantId: sellerExternalId,
      })
    : null;

  const amountMinor =
    typeof payment.amount === "number"
      ? payment.amount
      : typeof amount.amount === "number"
        ? amount.amount
        : null;

  const currency = clean(
    payment.currency ||
      amount.currency,
    12
  ).toUpperCase();

  const transactionReference = clean(
    payment.reference_id ||
      payment.referenceId ||
      payment.reference ||
      data.reference_id ||
      data.referenceId,
    180
  );

  const eventEnvironment =
    extractCashAppEventEnvironment(body);
  const configuredEnvironment =
    configuredCashAppPartnerEnvironment();

  const result = await savePaymentWebhookEvent({
    id: eventId,
    provider: "cash_app",
    eventType: clean(
      body.event_type ||
        body.type ||
        event.type,
      120
    ),
    providerPaymentId: clean(
      payment.id ||
        payment.payment_id ||
        payment.paymentId,
      180
    ),
    sellerExternalId,
    sellerUserId,
    amountMinor,
    currency,
    paymentStatus: clean(
      payment.status ||
        data.status,
      80
    ),
    transactionReference,
    eventEnvironment,
    payload: body,
    payloadSha256,
  });

  /*
   * Read the first verified copy from storage.
   *
   * The stored event is authoritative for duplicate retries.
   * A later request cannot replace its provider/order data
   * merely by reusing the same event id.
   */
  const storedEvent = await getPaymentWebhookEvent({
    eventId,
    provider: "cash_app",
  });

  if (!storedEvent) {
    throw new Error(
      "Stored Cash App webhook event could not be read."
    );
  }

  const storedDigest = clean(
    storedEvent.payload_sha256,
    64
  ).toLowerCase();

  /*
   * Same event id + different body:
   * never use that duplicate to affect an order.
   *
   * Old rows created before payload_sha256 existed have an
   * empty digest. Those legacy rows remain readable but do
   * not get duplicate reconciliation.
   */
  const duplicatePayloadConflict =
    !result.inserted &&
    Boolean(storedDigest) &&
    storedDigest !== payloadSha256;

  const legacyDuplicateWithoutDigest =
    !result.inserted &&
    !storedDigest;

  let matchedOrderId = clean(
    storedEvent.matched_order_id,
    180
  );

  /*
   * Reconciliation is allowed for:
   * - a newly inserted verified CAPTURED event, or
   * - an exact duplicate of that same stored event.
   *
   * We always match using first-seen stored fields.
   */
  if (
    !duplicatePayloadConflict &&
    !legacyDuplicateWithoutDigest &&
    !Boolean(storedEvent.processed) &&
    !matchedOrderId &&
    clean(
      storedEvent.payment_status,
      80
    ).toUpperCase() === "CAPTURED"
  ) {
    const amountRaw = storedEvent.amount_minor;

    const amountNumber =
      typeof amountRaw === "number"
        ? amountRaw
        : amountRaw !== null &&
            amountRaw !== undefined &&
            String(amountRaw).trim() !== ""
          ? Number(amountRaw)
          : null;

    const safeAmountMinor =
      typeof amountNumber === "number" &&
      Number.isInteger(amountNumber) &&
      amountNumber >= 0
        ? amountNumber
        : null;

    const matchedOrder =
      await findSokoCashAppOrderMatch({
        sellerUserId:
          clean(
            storedEvent.seller_user_id,
            180
          ) || undefined,

        amountMinor: safeAmountMinor,

        currency: clean(
          storedEvent.currency,
          12
        ).toUpperCase(),

        providerPaymentId: clean(
          storedEvent.provider_payment_id,
          180
        ),

        providerReference: clean(
          storedEvent.transaction_reference,
          180
        ),
      });

    if (matchedOrder?.id) {
      const candidateOrderId =
        String(matchedOrder.id);

      const marked =
        await markPaymentWebhookOrderMatch({
          eventId,
          orderId: candidateOrderId,
        });

      if (marked) {
        matchedOrderId = candidateOrderId;
      }
    }
  }

  if (duplicatePayloadConflict) {
    await recordPaymentWebhookReconciliation({
      eventId,
      provider: "cash_app",
      reason: "duplicate_event_body_conflict",
    });
    console.warn(
      "KRISTO_SOKO_CASHAPP_WEBHOOK_DUPLICATE_CONFLICT",
      {
        eventId,
      }
    );
  }

  const environmentOk = cashAppWebhookEnvironmentMatches({
    eventEnvironment,
    configuredEnvironment,
  });

  if (
    !environmentOk &&
    isFinalSuccessfulCashAppPaymentStatus(
      storedEvent.payment_status
    )
  ) {
    await recordPaymentWebhookReconciliation({
      eventId,
      provider: "cash_app",
      reason: "environment_mismatch",
    });
  }

  let capturedApplied = false;

  if (
    !duplicatePayloadConflict &&
    !legacyDuplicateWithoutDigest &&
    !Boolean(storedEvent.processed) &&
    environmentOk &&
    isFinalSuccessfulCashAppPaymentStatus(
      storedEvent.payment_status
    )
  ) {
    try {
      const applied =
        await applyStoredCashAppCapturedWebhook({
          eventId,
        });

      capturedApplied =
        applied.applied === true ||
        applied.alreadyApplied === true;

      if (
        matchedOrderId &&
        clean(applied.orderId, 180) !== matchedOrderId
      ) {
        throw new Error(
          "Cash App captured webhook/order identity changed during application."
        );
      }

      console.log(
        "KRISTO_SOKO_CASHAPP_CAPTURED_APPLIED",
        {
          eventId,
          orderId: applied.orderId,
          applied: applied.applied,
          alreadyApplied: applied.alreadyApplied,
          processed: applied.processed,
        }
      );
    } catch (error) {
      const message = String(
        error instanceof Error
          ? error.message
          : error || ""
      );
      const reason = reconciliationReasonFromApplyError(
        message
      );
      await recordPaymentWebhookReconciliation({
        eventId,
        provider: "cash_app",
        reason,
      });
      console.warn(
        "KRISTO_SOKO_CASHAPP_CAPTURED_NOT_APPLIED",
        {
          eventId,
          reason,
        }
      );
    }
  }

  console.log(
    "KRISTO_SOKO_CASHAPP_WEBHOOK_RECEIVED",
    {
      eventId,
      sellerMatched: Boolean(sellerUserId),
      orderMatched: Boolean(matchedOrderId),
      capturedApplied,
      duplicate: !result.inserted,
      duplicatePayloadConflict,
      legacyDuplicateWithoutDigest,
    }
  );

  return reply({
    ok: true,
    received: true,
    duplicate: !result.inserted,
    duplicatePayloadConflict,
  });
}

function reconciliationReasonFromApplyError(
  message: string
): CashAppReconciliationReason {
  const text = message.toLowerCase();
  if (text.includes("environment")) return "environment_mismatch";
  if (text.includes("already matched to another")) return "payment_id_reused";
  if (text.includes("does not uniquely match")) return "reference_mismatch";
  if (text.includes("not eligible") || text.includes("cancelled")) {
    return "order_not_payable";
  }
  if (text.includes("currency")) return "currency_mismatch";
  if (text.includes("amount")) return "amount_mismatch";
  if (text.includes("merchant") || text.includes("seller") || text.includes("recipient")) {
    return "recipient_mismatch";
  }
  if (text.includes("reference")) {
    return text.includes("missing")
      ? "missing_reference"
      : "reference_mismatch";
  }
  return "reference_mismatch";
}
