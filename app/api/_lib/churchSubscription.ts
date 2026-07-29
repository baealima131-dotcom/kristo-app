import { NextResponse } from "next/server";
import { getChurchMediaByChurchId } from "@/app/api/_lib/store/mediaDb";
import {
  isChurchSubscriptionActiveFromRecord,
  logSubscriptionGateBlocked,
  type ChurchSubscriptionRecord,
} from "@/lib/churchSubscription";
import { isIosV1SubscriptionGateBypassed } from "@/lib/iosV1MonetizationPolicy";

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
  /** Incoming request headers — used for iOS V1 free policy. */
  headers?: Headers | Record<string, string | string[] | undefined> | null;
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
  } as ChurchMediaStoreRow;
}

export async function isChurchSubscriptionActive(
  churchId: string,
  opts?: { isPastor?: boolean; isMediaHost?: boolean; gate?: string }
): Promise<boolean> {
  const cid = String(churchId || "").trim();
  if (!cid) return false;

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

  // iOS V1 free: allow gated actions only with kill switch + HMAC proof (not platform header alone).
  if (
    isIosV1SubscriptionGateBypassed(ctx.headers || null, {
      userId: ctx.userId,
    })
  ) {
    console.log("KRISTO_IOS_V1_SUBSCRIPTION_GATE_ALLOWED", {
      endpoint: ctx.endpoint,
      churchId: cid,
      userId: ctx.userId,
      role: ctx.role,
      action: ctx.action,
      policy: "ios_v1_free",
      trust: "kill_switch+hmac_proof",
      // Never log proof header or secret material.
    });
    return null;
  }

  const role = String(ctx.role || "").trim();
  const subscriptionActive = await isChurchSubscriptionActive(cid, {
    isPastor: role.toLowerCase().includes("pastor"),
    gate: ctx.action,
  });

  if (subscriptionActive) return null;

  logSubscriptionGateBlocked(ctx.action, false, {
    endpoint: ctx.endpoint,
    churchId: cid,
    userId: ctx.userId,
    role: ctx.role,
  });
  logSubscriptionGuardBlocked(ctx, false);
  return churchSubscriptionRequiredResponse();
}
