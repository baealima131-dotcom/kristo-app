import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { guard } from "@/app/api/_lib/rbac";
import {
  buildPrepurchaseDeniedDisplayResponse,
  buildPrepurchaseOwnershipConflictResponse,
  checkStoreSubscriptionPrepurchaseOwnership,
} from "@/app/api/_lib/subscriptionOwnershipLock";

export const runtime = "nodejs";

function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { viewer, churchId: headerChurchId } = ctxOrRes;
  let bodyChurchId = headerChurchId;

  try {
    const body = await req.json();
    const requested = String(body?.churchId || "").trim();
    if (requested) bodyChurchId = requested;
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
        error: "Only the current church Pastor can purchase church premium",
        reason: access.hasPastorRole ? "not-canonical-pastor" : "not-pastor",
      },
      { status: 403 }
    );
  }

  const ownerUserId = String(access.actualPastorUserId || viewer.userId || "").trim();
  const result = await checkStoreSubscriptionPrepurchaseOwnership({
    churchId,
    ownerUserId,
  });

  if (!result.allowed) {
    const reason = String(result.reason || "").trim();
    const unverifiedReason =
      reason === "unverified-store-identity" || reason === "conflict-pending-verification";

    if (!result.lock) {
      const denied = await buildPrepurchaseDeniedDisplayResponse({
        churchId,
        ownerUserId,
        reason: reason || "store-subscription-ownership-conflict",
        lock: result.lock,
        verification: result.verification,
      });

      return json(denied, { status: unverifiedReason ? 423 : 409 });
    }

    const conflict = await buildPrepurchaseOwnershipConflictResponse({
      churchId,
      reason: result.reason ?? "store-subscription-ownership-conflict",
      lock: result.lock,
      verification: result.verification,
    });

    return json(conflict, { status: 409 });
  }

  // existingStoreProductId is observed App Store lineage (may be expired legacy).
  // It is NOT the purchase SKU — that comes from /purchase-product assignment.
  const existingStoreProductId = result.verification?.productId ?? null;
  return json({
    ok: true,
    allowed: true,
    reason: result.reason ?? "ok",
    storeSubscriptionIdentity: result.verification?.storeSubscriptionIdentity ?? null,
    existingStoreProductId,
    /** @deprecated Prefer existingStoreProductId — not the assigned purchase product. */
    productId: existingStoreProductId,
    store: result.verification?.store ?? null,
    willRenew: result.verification?.willRenew ?? result.lock?.willRenew ?? null,
    cancelledOverlapPurchasePermitted:
      result.reason === "cancelled-subscription-new-purchase-permitted",
  });
}