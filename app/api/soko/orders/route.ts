import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { getProfile } from "@/app/api/auth/_lib/profile";
import {
  createSokoOrder,
  listSokoOrders,
  updateSokoOrder,
} from "@/app/api/_lib/store/sokoOrdersDb";
import { SokoPaymentAccountMismatchError } from "@/app/api/_lib/cashAppPaymentConfirmation";
import { sokoCheckoutTimer } from "@/app/api/_lib/sokoCheckoutTiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

async function readJson(req: NextRequest) {
  if (!req.body) throw new Error("Missing request body.");

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
        throw new Error("Order request is too large.");
      }

      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid order request.");
  }

  return value as Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const mode =
      req.nextUrl.searchParams.get("mode") === "selling"
        ? "selling"
        : "buying";

    const orders = await listSokoOrders(auth.viewer.userId, mode);
    return reply({ ok: true, orders });
  } catch {
    return reply({ ok: false, error: "Could not load SOKO orders." }, 503);
  }
}

export async function POST(req: NextRequest) {
  const timer = sokoCheckoutTimer("orders");
  const auth = await guardCheckoutAuth(req);
  timer.stage("auth");
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readJson(req);
    timer.stage("body");
    const buyerNamePromise = getProfile(auth.viewer.userId).then((profile) =>
      String(profile?.fullName || auth.viewer.name || "Kristo buyer")
    );

    const order = await createSokoOrder({
      buyerUserId: auth.viewer.userId,
      buyerName: buyerNamePromise,
      productId: String(body.productId || ""),
      paymentMethod: String(body.paymentMethod || ""),
      clientKey: String(body.clientKey || ""),
      deliveryDetails:
        body.deliveryDetails &&
        typeof body.deliveryDetails === "object" &&
        !Array.isArray(body.deliveryDetails)
          ? body.deliveryDetails as Record<string, unknown>
          : {},
      deliverySelection:
        body.deliverySelection &&
        typeof body.deliverySelection === "object" &&
        !Array.isArray(body.deliverySelection)
          ? body.deliverySelection as Record<string, unknown>
          : {},
      requestDeliveryQuote: body.requestDeliveryQuote === true,
    });
    timer.stage("createSokoOrder");
    const response = reply({ ok: true, order }, 201);
    timer.stage("response");
    return response;
  } catch (error) {
    if (error instanceof SokoPaymentAccountMismatchError) {
      return reply(
        {
          ok: false,
          code: error.code,
          error: "Seller payment account does not match this listing.",
        },
        409
      );
    }

    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create SOKO order.",
      },
      400
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await guardCheckoutAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await readJson(req);

    const order = await updateSokoOrder({
      userId: auth.viewer.userId,
      orderId: String(body.orderId || ""),
      action: String(body.action || ""),
      note: String(body.note || ""),
      transactionReference: String(body.transactionReference || ""),
      paymentDate: String(body.paymentDate || ""),
      trackingNumber: String(body.trackingNumber || ""),
      deliveryQuoteAmount:
        typeof body.deliveryQuoteAmount === "number" ||
        typeof body.deliveryQuoteAmount === "string"
          ? body.deliveryQuoteAmount
          : "",
      deliveryQuoteEstimatedDays:
        typeof body.deliveryQuoteEstimatedDays === "number" ||
        typeof body.deliveryQuoteEstimatedDays === "string"
          ? body.deliveryQuoteEstimatedDays
          : "",
    });

    return reply({ ok: true, order });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not update SOKO order.",
      },
      400
    );
  }
}
