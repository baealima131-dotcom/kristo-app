import { NextResponse } from "next/server";
import { getChurchMediaByChurchId } from "@/app/api/_lib/store/mediaDb";
import {
  isChurchSubscriptionActiveFromRecord,
  type ChurchSubscriptionRecord,
} from "@/lib/churchSubscription";
import {
  isServerSubscriptionGateBypassed,
  isSubscriptionBypassEnabled,
  logServerSubscriptionGateCheck,
} from "@/lib/subscriptionBypass";

type ChurchMediaStoreRow = ChurchSubscriptionRecord & {
  churchId?: string;
};

export const CHURCH_SUBSCRIPTION_REQUIRED_CODE = "CHURCH_SUBSCRIPTION_REQUIRED";

export type SubscriptionGuardContext = {
  endpoint: string;
  churchId: string;
  userId: string;
  role: string;
  action: string;
};

export async function getChurchMediaSubscriptionRecord(
  churchId: string
): Promise<ChurchMediaStoreRow | null> {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  const media = await getChurchMediaByChurchId(cid);
  if (!media) return null;

  return {
    churchId: media.churchId,
    subscriptionActive: media.subscriptionActive,
    subscriptionPlan: media.subscriptionPlan,
    subscriptionUpdatedAt: media.subscriptionUpdatedAt,
    subscriptionSource: media.subscriptionSource,
    subscriptionStatus: media.subscriptionStatus,
    stripeCustomerId: media.stripeCustomerId,
    stripeSubscriptionId: media.stripeSubscriptionId,
  };
}

export async function isChurchSubscriptionActive(
  churchId: string,
  opts?: { isPastor?: boolean; isMediaHost?: boolean; gate?: string }
): Promise<boolean> {
  const cid = String(churchId || "").trim();
  if (isSubscriptionBypassEnabled()) {
    logServerSubscriptionGateCheck({
      churchId: cid,
      isPastor: opts?.isPastor,
      isMediaHost: opts?.isMediaHost,
      gate: opts?.gate || "isChurchSubscriptionActive",
    });
    if (
      isServerSubscriptionGateBypassed({
        churchId: cid,
        isPastor: opts?.isPastor,
        isMediaHost: opts?.isMediaHost,
        gate: opts?.gate || "isChurchSubscriptionActive",
      })
    ) {
      return true;
    }
    return false;
  }

  const media = await getChurchMediaSubscriptionRecord(cid);
  return isChurchSubscriptionActiveFromRecord(media);
}

export function logSubscriptionGuardBlocked(
  ctx: SubscriptionGuardContext,
  subscriptionActive: boolean
) {
  console.log("KRISTO_SUBSCRIPTION_GUARD_BLOCKED", {
    endpoint: ctx.endpoint,
    churchId: ctx.churchId,
    userId: ctx.userId,
    role: ctx.role,
    action: ctx.action,
    subscriptionActive,
  });
}

export function churchSubscriptionRequiredResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "Subscription required",
      code: CHURCH_SUBSCRIPTION_REQUIRED_CODE,
    },
    { status: 403 }
  );
}

export async function requireChurchSubscriptionActive(
  churchId: string,
  ctx: SubscriptionGuardContext
): Promise<NextResponse | null> {
  const cid = String(churchId || "").trim();
  if (!cid) {
    return NextResponse.json({ ok: false, error: "churchId is required" }, { status: 400 });
  }

  const role = String(ctx.role || "").trim();
  const subscriptionActive = await isChurchSubscriptionActive(cid, {
    isPastor: role.toLowerCase().includes("pastor"),
    gate: ctx.action,
  });

  if (subscriptionActive) return null;

  logSubscriptionGuardBlocked(ctx, false);
  return churchSubscriptionRequiredResponse();
}
