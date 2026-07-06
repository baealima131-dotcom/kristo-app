import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { guard } from "@/app/api/_lib/rbac";
import { preserveSubscriptionOwnershipLockTombstoneForChurchDelete } from "@/app/api/_lib/subscriptionOwnershipLock";

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
    return json({ ok: false, error: "Only the church pastor can delete this church" }, { status: 403 });
  }

  const result = await preserveSubscriptionOwnershipLockTombstoneForChurchDelete({
    ownerUserId: viewer.userId,
    churchId,
  });

  if (!result.preserved) {
    const reason = String(result.reason || "").trim();
    const skippable =
      reason === "no-active-lock" || reason === "lock-held-by-other-church-skipped";

    if (skippable) {
      return json({
        ok: true,
        preserved: false,
        skipped: true,
        reason,
        lock: result.lock
          ? {
              lockedChurchId: result.lock.lockedChurchId,
              expiresAt: result.lock.expiresAt,
              status: result.lock.status,
            }
          : null,
      });
    }

    return json(
      {
        ok: false,
        preserved: false,
        reason: reason || "not-preserved",
        lock: result.lock
          ? {
              lockedChurchId: result.lock.lockedChurchId,
              expiresAt: result.lock.expiresAt,
              status: result.lock.status,
            }
          : null,
      },
      { status: 400 }
    );
  }

  return json({
    ok: true,
    preserved: true,
    lock: result.lock
      ? {
          lockedChurchId: result.lock.lockedChurchId,
          lockedChurchDeleted: result.lock.lockedChurchDeleted === true,
          expiresAt: result.lock.expiresAt,
          status: result.lock.status,
          store: result.lock.store,
        }
      : null,
  });
}
