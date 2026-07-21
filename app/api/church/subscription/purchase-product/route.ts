import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import {
  releaseIosPremiumReservation,
  reserveIosPremiumPurchaseProduct,
  IosSubscriptionSlotsExhaustedError,
} from "@/app/api/_lib/iosPremiumProductAssignment";
import { guard } from "@/app/api/_lib/rbac";
import {
  IOS_SUBSCRIPTION_SLOTS_EXHAUSTED,
  LEGACY_CHURCH_PREMIUM_PRODUCT_IDS,
  PREMIUM_MONTHLY_PRODUCT_ID,
  PREMIUM_YEARLY_PRODUCT_ID,
} from "@/lib/churchPremiumRevenueCat";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

/**
 * Server authority for App Store / Play product selection.
 *
 * iOS: reserves church_premium_monthly_g2…g5 using best-effort device coordination:
 *   deviceOwnedProductIds + owner/device active reservations + owner church mappings.
 * Does NOT treat originalTransactionId as Apple ID / purchaser identity.
 *
 * POST body actions:
 * - default / action=reserve
 * - action=release (release reservation after Apple already-subscribed)
 */
export async function GET(req: NextRequest) {
  return handlePurchaseProduct(req);
}

export async function POST(req: NextRequest) {
  return handlePurchaseProduct(req);
}

async function handlePurchaseProduct(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { viewer, churchId: headerChurchId } = ctxOrRes;
  let bodyChurchId = headerChurchId;
  let platform = "ios";
  let action = "reserve";
  let deviceOwnedProductIds: string[] = [];
  let devicePurchaseScope = "";
  let purchaseSessionId: string | null = null;
  let reservationId: string | null = null;

  try {
    if (req.method === "POST") {
      const body = await req.json();
      const requested = String(body?.churchId || "").trim();
      if (requested) bodyChurchId = requested;
      const requestedPlatform = String(body?.platform || "").trim().toLowerCase();
      if (requestedPlatform) platform = requestedPlatform;
      action = String(body?.action || "reserve").trim().toLowerCase() || "reserve";
      devicePurchaseScope = String(body?.devicePurchaseScope || body?.deviceInstallationId || "").trim();
      purchaseSessionId = String(body?.purchaseSessionId || "").trim() || null;
      reservationId = String(body?.reservationId || "").trim() || null;
      if (Array.isArray(body?.deviceOwnedProductIds)) {
        deviceOwnedProductIds = body.deviceOwnedProductIds
          .map((id: unknown) => String(id || "").trim())
          .filter(Boolean);
      }
    } else {
      const url = new URL(req.url);
      const requested = String(url.searchParams.get("churchId") || "").trim();
      if (requested) bodyChurchId = requested;
      const requestedPlatform = String(url.searchParams.get("platform") || "")
        .trim()
        .toLowerCase();
      if (requestedPlatform) platform = requestedPlatform;
      devicePurchaseScope = String(url.searchParams.get("devicePurchaseScope") || "").trim();
    }
  } catch {
    // optional body
  }

  const churchId = String(bodyChurchId || "").trim();
  if (!churchId) {
    return json({ ok: false, error: "churchId is required" }, { status: 400 });
  }

  const access = await evaluateChurchMediaAccess({
    churchId,
    userId: viewer.userId,
  });
  if (!access.isActualChurchPastor || !access.canManageChurchSubscription) {
    return json(
      {
        ok: false,
        error: "Only the current church Pastor can resolve purchase products",
        reason: access.hasPastorRole ? "not-canonical-pastor" : "not-pastor",
      },
      { status: 403 }
    );
  }

  const ownerUserId = String(access.actualPastorUserId || viewer.userId || "").trim();

  if (platform === "android") {
    return json({
      ok: true,
      platform: "android",
      plan: "monthly",
      productId: PREMIUM_MONTHLY_PRODUCT_ID,
      yearlyProductId: PREMIUM_YEARLY_PRODUCT_ID,
      monthlyProductId: PREMIUM_MONTHLY_PRODUCT_ID,
      legacyProductIds: [...LEGACY_CHURCH_PREMIUM_PRODUCT_IDS],
      rotation: null,
      reservationId: null,
      coordination: null,
    });
  }

  if (action === "release") {
    if (!reservationId) {
      return json({ ok: false, error: "reservationId is required to release" }, { status: 400 });
    }
    const released = await releaseIosPremiumReservation({
      reservationId,
      ownerUserId,
      reason: "already_subscribed",
    });
    return json({
      ok: true,
      action: "release",
      released: Boolean(released),
      reservationId,
      productId: released?.productId ?? null,
    });
  }

  if (!devicePurchaseScope) {
    return json(
      {
        ok: false,
        error: "devicePurchaseScope is required for iOS product reservation",
        reason: "missing-device-purchase-scope",
      },
      { status: 400 }
    );
  }

  try {
    const assignment = await reserveIosPremiumPurchaseProduct({
      churchId,
      ownerUserId,
      devicePurchaseScope,
      purchaseSessionId,
      deviceOwnedProductIds,
    });

    return json({
      ok: true,
      platform: "ios",
      plan: "monthly",
      productId: assignment.productId,
      monthlyProductId: assignment.productId,
      yearlyProductId: null,
      group: assignment.group,
      subscriptionGroupName: assignment.subscriptionGroupName,
      sticky: assignment.sticky,
      reservationId: assignment.reservationId,
      purchaseSessionId: assignment.purchaseSessionId,
      devicePurchaseScope: assignment.devicePurchaseScope,
      appOwnerScope: assignment.appOwnerScope,
      coordination: assignment.coordination,
      blockedProductIds: assignment.blockedProductIds,
      deviceOwnedProductIds: assignment.deviceOwnedProductIds,
      reservationExpiresAt: assignment.expiresAt,
      legacyProductIds: [...LEGACY_CHURCH_PREMIUM_PRODUCT_IDS],
      /**
       * Honest contract: originalTransactionId is subscription lineage only.
       * It is NOT returned or used here as purchaser/Apple ID identity.
       */
      subscriptionLineageIdentity: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted =
      error instanceof IosSubscriptionSlotsExhaustedError ||
      (error as { code?: string } | null)?.code === IOS_SUBSCRIPTION_SLOTS_EXHAUSTED ||
      message.includes(IOS_SUBSCRIPTION_SLOTS_EXHAUSTED);
    console.log("KRISTO_IOS_PREMIUM_RESERVATION_FAILED", {
      churchId,
      ownerUserId,
      error: message,
      deviceOwnedCount: deviceOwnedProductIds.length,
      hasDevicePurchaseScope: Boolean(devicePurchaseScope),
      reason: exhausted ? IOS_SUBSCRIPTION_SLOTS_EXHAUSTED : "no-available-rotation-slot",
    });
    return json(
      {
        ok: false,
        error: message,
        reason: exhausted ? IOS_SUBSCRIPTION_SLOTS_EXHAUSTED : "no-available-rotation-slot",
        code: exhausted ? IOS_SUBSCRIPTION_SLOTS_EXHAUSTED : undefined,
      },
      { status: 409 }
    );
  }
}
