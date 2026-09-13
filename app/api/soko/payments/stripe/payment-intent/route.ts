import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import {
  getStripeClient,
  getStripePublishableKeyFromServerEnv,
  getStripeSecretKey,
  sokoStripeServerConfigured,
} from "@/app/api/_lib/sokoStripeServer";
import {
  SOKO_STRIPE_PAYMENT_METHOD,
  cleanStripeText,
  isReusableStripePaymentIntentStatus,
  isTerminalFailedStripePaymentIntentStatus,
  opaqueBuyerReference,
  stripeModeFromSecretKey,
  stripeModesMatch,
  stripePaymentIntentIdempotencyKey,
} from "@/app/api/_lib/sokoStripeCheckout";
import { sokoCheckoutTimer } from "@/app/api/_lib/sokoCheckoutTiming";
import {
  bindSokoStripePaymentIntent,
  getSokoStripePaymentContext,
} from "@/app/api/_lib/store/sokoOrdersDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function readJson(req: NextRequest) {
  if (!req.body) throw new Error("Missing payment request.");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16 * 1024) {
        await reader.cancel();
        throw new Error("Payment request is too large.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid payment request.");
  }

  return value as Record<string, unknown>;
}

function publicIntent(input: {
  orderId: string;
  clientSecret: string | null;
  status: string;
  livemode: boolean;
  totals: {
    itemPrice: number;
    deliveryPrice: number;
    finalTotal: number;
    currency: string;
  };
}) {
  return {
    ok: true,
    orderId: input.orderId,
    clientSecret: input.clientSecret,
    status: input.status,
    livemode: input.livemode,
    paymentMethod: SOKO_STRIPE_PAYMENT_METHOD,
    publishableKeyConfigured: Boolean(
      getStripePublishableKeyFromServerEnv()
    ),
    totals: input.totals,
  };
}

export async function POST(req: NextRequest) {
  const timer = sokoCheckoutTimer("stripe-payment-intent");
  const auth = await guardCheckoutAuth(req);
  timer.stage("auth");
  if (auth instanceof NextResponse) return auth;

  try {
    if (!sokoStripeServerConfigured()) {
      return reply(
        {
          ok: false,
          error: "Card checkout is not configured yet.",
        },
        503
      );
    }

    const secret = getStripeSecretKey();
    const publishable = getStripePublishableKeyFromServerEnv();
    if (publishable && !stripeModesMatch(publishable, secret)) {
      return reply(
        {
          ok: false,
          error: "Card checkout is not configured yet.",
        },
        503
      );
    }

    const body = await readJson(req);
    timer.stage("body");
    const orderId = cleanStripeText(body.orderId, 100);
    if (!orderId) {
      return reply({ ok: false, error: "Order is required." }, 400);
    }

    const context = await getSokoStripePaymentContext({
      orderId,
      buyerUserId: auth.viewer.userId,
    });
    timer.stage("context", {
      hasIntent: Boolean(context.providerPaymentId),
      orderStatus: context.status,
    });

    if (context.status === "payment_approved") {
      return reply(
        publicIntent({
          orderId: context.orderId,
          clientSecret: null,
          status: "payment_approved",
          livemode: stripeModeFromSecretKey(secret) === "live",
          totals: context.totals,
        })
      );
    }

    if (context.status !== "awaiting_payment") {
      return reply(
        {
          ok: false,
          error: "This order is not awaiting card payment.",
        },
        409
      );
    }

    const stripe = getStripeClient();
    let paymentIntent: Stripe.PaymentIntent | null = null;
    let retry = context.retry;
    let replacePreviousId = "";

    if (context.providerPaymentId) {
      paymentIntent = await stripe.paymentIntents.retrieve(
        context.providerPaymentId
      );
      timer.stage("stripe_retrieve", {
        reusable: isReusableStripePaymentIntentStatus(paymentIntent.status),
      });

      if (
        paymentIntent.metadata?.sokoOrderId &&
        paymentIntent.metadata.sokoOrderId !== context.orderId
      ) {
        return reply(
          {
            ok: false,
            error: "This payment already belongs to another order.",
          },
          409
        );
      }

      if (paymentIntent.status === "succeeded") {
        return reply(
          publicIntent({
            orderId: context.orderId,
            clientSecret: null,
            status: "processing",
            livemode: paymentIntent.livemode === true,
            totals: context.totals,
          })
        );
      }

      if (isTerminalFailedStripePaymentIntentStatus(paymentIntent.status)) {
        replacePreviousId = paymentIntent.id;
        retry += 1;
        paymentIntent = null;
        timer.stage("stripe_retrieve_replace");
      } else if (!isReusableStripePaymentIntentStatus(paymentIntent.status)) {
        return reply(
          {
            ok: false,
            error: "Card payment cannot be resumed for this order.",
          },
          409
        );
      }
    }

    if (!paymentIntent) {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: context.amountMinor,
          currency: context.currency.toLowerCase(),
          payment_method_types: ["card"],
          metadata: {
            sokoOrderId: context.orderId,
            sellerUserId: context.sellerUserId,
            buyerRef: opaqueBuyerReference(context.buyerUserId),
          },
        },
        {
          idempotencyKey: stripePaymentIntentIdempotencyKey(
            context.orderId,
            retry
          ),
        }
      );
      timer.stage("stripe_create", { retry });
    } else {
      timer.stage("stripe_reuse");
    }

    const alreadyBound =
      context.providerPaymentId === paymentIntent.id && !replacePreviousId;
    if (!alreadyBound) {
      await bindSokoStripePaymentIntent({
        orderId: context.orderId,
        buyerUserId: context.buyerUserId,
        paymentIntentId: paymentIntent.id,
        replacePreviousId,
        retry,
      });
      timer.stage("bind");
    } else {
      timer.stage("bind_skipped");
    }

    timer.stage("done");
    return reply(
      publicIntent({
        orderId: context.orderId,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
        livemode: paymentIntent.livemode === true,
        totals: context.totals,
      })
    );
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Card payment could not start.",
      },
      400
    );
  }
}
