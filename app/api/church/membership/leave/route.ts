import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { evaluateChurchDeleteSubscriptionGuardForPastor } from "@/app/api/_lib/churchDeleteSubscription";
import { evaluateChurchMediaAccess } from "@/app/api/_lib/churchMediaAccess";
import { guard } from "@/app/api/_lib/rbac";
import { getMembershipsForUser, leaveActiveMembership } from "@/app/api/_lib/memberships";
import { createNotification } from "@/app/api/_lib/notifications";
import { preserveSubscriptionOwnershipLockTombstoneForChurchDelete } from "@/app/api/_lib/subscriptionOwnershipLock";

function json(data: any, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await guard(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;

  const { viewer, churchId: headerChurchId } = ctxOrRes;

  const memberships = await getMembershipsForUser(viewer.userId);
  const activeMembership = memberships.find(
    (row) => String(row.status || "").trim() === "Active"
  );
  const churchId = String(activeMembership?.churchId || headerChurchId || "").trim();

  let pastorDeleteGuard: Awaited<
    ReturnType<typeof evaluateChurchDeleteSubscriptionGuardForPastor>
  > | null = null;

  if (churchId) {
    const access = await evaluateChurchMediaAccess({
      churchId,
      userId: viewer.userId,
    });

    if (access.isActualChurchPastor) {
      pastorDeleteGuard = await evaluateChurchDeleteSubscriptionGuardForPastor({
        ownerUserId: viewer.userId,
        churchId,
      });

      if (pastorDeleteGuard.blocked) {
        console.log("KRISTO_CHURCH_DELETE_BLOCKED_ACTIVE_SUBSCRIPTION_SERVER", {
          churchId,
          userId: viewer.userId,
          blockReason: pastorDeleteGuard.blockReason,
          willRenew: pastorDeleteGuard.willRenew,
        });
        return json(
          {
            ok: false,
            error: "active-subscription-renewal",
            reason: pastorDeleteGuard.blockReason,
            blockReason: pastorDeleteGuard.blockReason,
            willRenew: pastorDeleteGuard.willRenew,
            store: pastorDeleteGuard.store,
          },
          { status: 403 }
        );
      }

      const tombstone = await preserveSubscriptionOwnershipLockTombstoneForChurchDelete({
        ownerUserId: viewer.userId,
        churchId,
      });
      console.log("KRISTO_CHURCH_DELETE_LOCK_TOMBSTONE_SERVER", {
        churchId,
        userId: viewer.userId,
        preserved: tombstone.preserved,
        reason: tombstone.reason ?? null,
      });
    }
  }

  const r = await leaveActiveMembership(viewer.userId);
  if (!r.ok) return json({ ok: false, error: r.error }, { status: 400 });

  createNotification({
    churchId: r.membership?.churchId || churchId,
    type: "Generic",
    title: "You left the church",
    message: `You are no longer an Active member.`,
    targetUserId: viewer.userId,
  });

  return json({
    ok: true,
    membership: r.membership,
    requiresCancellationWarning: pastorDeleteGuard?.requiresCancellationWarning === true,
  });
}
