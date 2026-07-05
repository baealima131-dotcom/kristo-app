import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { guard } from "@/app/api/_lib/rbac";
import {
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
  if (!access.isActualChurchPastor) {
    return json({ ok: false, error: "Only the church pastor can purchase church premium" }, { status: 403 });
  }

  const ownerUserId = String(access.actualPastorUserId || viewer.userId || "").trim();
  const result = await checkStoreSubscriptionPrepurchaseOwnership({
    churchId,
    ownerUserId,
  });

  if (!result.allowed) {
    if (!result.lock) {
      return json(
        {
          ok: false,
          allowed: false,
          reason: result.reason ?? "store-subscription-ownership-conflict",
        },
        { status: 409 }
      );
    }

    const conflict = await buildPrepurchaseOwnershipConflictResponse({
      churchId,
      reason: result.reason ?? "store-subscription-ownership-conflict",
      lock: result.lock,
      verification: result.verification,
    });

    return json(conflict, { status: 409 });
  }

  return json({
    ok: true,
    allowed: true,
    reason: result.reason ?? "ok",
    storeSubscriptionIdentity: result.verification?.storeSubscriptionIdentity ?? null,
    productId: result.verification?.productId ?? null,
    store: result.verification?.store ?? null,
  });
}
