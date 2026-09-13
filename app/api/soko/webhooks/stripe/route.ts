import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  getPaymentWebhookEvent,
  markPaymentWebhookOrderMatch,
  markPaymentWebhookProcessed,
  recordPaymentWebhookReconciliation,
  savePaymentWebhookEvent,
} from "@/app/api/_lib/store/sokoPaymentWebhookDb";
import {
  applySokoStripeCapturedPaymentToOrder,
  findSokoOrderByStripePaymentIntent,
} from "@/app/api/_lib/store/sokoOrdersDb";
import {
  getStripeSecretKey,
  getStripeWebhookSecret,
  verifyStripeWebhookEvent,
} from "@/app/api/_lib/sokoStripeServer";
import {
  SOKO_STRIPE_PROVIDER,
  canApproveSokoStripePayment,
  cleanStripeText,
  configuredSokoStripeSellerUserId,
  toStripeAmountMinor,
} from "@/app/api/_lib/sokoStripeCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function paymentIntentFromEvent(event: Stripe.Event) {
  const object = event.data.object as Stripe.PaymentIntent;
  return object;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!rawBody || rawBody.length > 256 * 1024) {
    return reply({ ok: false, error: "Invalid webhook body." }, 400);
  }

  const signature = cleanStripeText(
    req.headers.get("stripe-signature"),
    1024
  );

  if (!getStripeWebhookSecret() || !signature) {
    return reply({ ok: false, error: "Invalid webhook signature." }, 400);
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhookEvent({
      rawBody,
      signature,
    });
  } catch {
    console.warn("KRISTO_SOKO_STRIPE_WEBHOOK_REJECTED", {
      reason: "invalid_signature",
    });
    return reply({ ok: false, error: "Invalid webhook signature." }, 403);
  }

  const payloadSha256 = createHash("sha256")
    .update(Buffer.from(rawBody, "utf8"))
    .digest("hex")
    .toLowerCase();

  const eventId = cleanStripeText(event.id, 180);
  if (!eventId) {
    return reply({ ok: false, error: "Missing event id." }, 400);
  }

  const existing = await getPaymentWebhookEvent({
    eventId,
    provider: SOKO_STRIPE_PROVIDER,
  });

  if (existing) {
    const existingHash = cleanStripeText(
      (existing as { payload_sha256?: string }).payload_sha256,
      64
    ).toLowerCase();
    if (existingHash && existingHash !== payloadSha256) {
      await recordPaymentWebhookReconciliation({
        eventId,
        provider: SOKO_STRIPE_PROVIDER,
        reason: "duplicatePayloadConflict",
      });
      return reply({
        ok: true,
        received: true,
        duplicate: true,
        conflict: true,
      });
    }

    if ((existing as { processed?: boolean }).processed) {
      return reply({
        ok: true,
        received: true,
        duplicate: true,
      });
    }
  }

  const type = cleanStripeText(event.type, 120);
  const paymentIntent =
    type.startsWith("payment_intent.")
      ? paymentIntentFromEvent(event)
      : null;

  const amountMinor =
    paymentIntent && typeof paymentIntent.amount_received === "number"
      ? paymentIntent.amount_received
      : paymentIntent && typeof paymentIntent.amount === "number"
        ? paymentIntent.amount
        : null;

  const saved = await savePaymentWebhookEvent({
    id: eventId,
    provider: SOKO_STRIPE_PROVIDER,
    eventType: type,
    providerPaymentId: cleanStripeText(paymentIntent?.id, 180),
    sellerUserId: cleanStripeText(
      paymentIntent?.metadata?.sellerUserId,
      180
    ),
    amountMinor,
    currency: cleanStripeText(paymentIntent?.currency, 12).toUpperCase(),
    paymentStatus: cleanStripeText(paymentIntent?.status, 80),
    transactionReference: cleanStripeText(
      paymentIntent?.metadata?.sokoOrderId,
      180
    ),
    eventEnvironment: event.livemode ? "live" : "test",
    payload: event as unknown as Record<string, unknown>,
    payloadSha256,
  });

  if (
    type !== "payment_intent.succeeded" ||
    !paymentIntent
  ) {
    return reply({
      ok: true,
      received: true,
      inserted: saved.inserted,
    });
  }

  const matches = await findSokoOrderByStripePaymentIntent(
    paymentIntent.id
  );

  if (!matches || matches.length !== 1) {
    await recordPaymentWebhookReconciliation({
      eventId,
      provider: SOKO_STRIPE_PROVIDER,
      reason:
        matches && matches.length > 1
          ? "multiple_orders"
          : "order_not_found",
    });
    return reply({
      ok: true,
      received: true,
      applied: false,
    });
  }

  const order = matches[0] as {
    id: string;
    status: string;
    payment_method: string;
    payment_provider: string;
    provider_payment_id: string;
    seller_user_id: string;
    snapshot?: {
      totals?: {
        finalTotal?: number;
        currency?: string;
      };
      currency?: string;
    };
  };

  const orderAmountMinor = toStripeAmountMinor(
    Number(order.snapshot?.totals?.finalTotal),
    String(order.snapshot?.totals?.currency || order.snapshot?.currency || "")
  );

  const decision = canApproveSokoStripePayment({
    orderStatus: order.status,
    orderPaymentMethod: order.payment_method,
    orderProvider: order.payment_provider,
    storedPaymentIntentId: order.provider_payment_id,
    eventPaymentIntentId: paymentIntent.id,
    metadataOrderId: String(paymentIntent.metadata?.sokoOrderId || ""),
    orderId: order.id,
    amountReceived: Number(paymentIntent.amount_received),
    orderAmountMinor: orderAmountMinor || -1,
    eventCurrency: String(paymentIntent.currency || ""),
    orderCurrency: String(
      order.snapshot?.totals?.currency || order.snapshot?.currency || ""
    ),
    orderSellerUserId: order.seller_user_id,
    allowedSellerUserId: configuredSokoStripeSellerUserId(),
    livemode: event.livemode === true,
    secretKey: getStripeSecretKey(),
    paymentIntentAlreadyUsedOnOtherOrder: false,
  });

  if (!decision.ok) {
    if ("alreadyApproved" in decision && decision.alreadyApproved) {
      await markPaymentWebhookOrderMatch({
        eventId,
        orderId: order.id,
      });
      await markPaymentWebhookProcessed({
        eventId,
        orderId: order.id,
      });
      return reply({
        ok: true,
        received: true,
        duplicate: true,
      });
    }

    await recordPaymentWebhookReconciliation({
      eventId,
      provider: SOKO_STRIPE_PROVIDER,
      reason: decision.code,
    });

    return reply({
      ok: true,
      received: true,
      applied: false,
    });
  }

  const matched = await markPaymentWebhookOrderMatch({
    eventId,
    orderId: order.id,
  });

  if (!matched) {
    return reply({
      ok: true,
      received: true,
      applied: false,
    });
  }

  let applied;
  try {
    applied = await applySokoStripeCapturedPaymentToOrder({
      orderId: order.id,
      paymentIntentId: paymentIntent.id,
      amountMinor: Number(paymentIntent.amount_received),
      currency: String(paymentIntent.currency || ""),
      eventId,
      livemode: event.livemode === true,
    });
  } catch {
    return reply({ ok: false, error: "Could not apply card payment." }, 500);
  }

  if (applied.applied || applied.alreadyApplied) {
    await markPaymentWebhookProcessed({
      eventId,
      orderId: order.id,
    });
  }

  console.log("KRISTO_SOKO_STRIPE_CAPTURED_APPLIED", {
    orderId: order.id,
    applied: applied.applied,
    alreadyApplied: applied.alreadyApplied,
  });

  return reply({
    ok: true,
    received: true,
    applied: applied.applied,
    duplicate: applied.alreadyApplied,
  });
}
