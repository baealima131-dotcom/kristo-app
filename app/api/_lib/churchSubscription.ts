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

export async function getChurchMediaSubscriptionRecord(
  churchId: string
): Promise<ChurchMediaStoreRow | null> {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  // Church media (incl. subscription fields) is durably owned by mediaDb
  // (Postgres kristo_church_media in production, church-media.json locally).
  // Reading via mediaDb avoids the previous /tmp dependency that made
  // subscriptions read empty on Vercel.
  const media = await getChurchMediaByChurchId(cid);
  if (!media) return null;

  return {
    churchId: media.churchId,
    subscriptionActive: media.subscriptionActive,
    subscriptionPlan: media.subscriptionPlan,
    subscriptionUpdatedAt: media.subscriptionUpdatedAt,
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

export function churchSubscriptionRequiredResponse() {
  return NextResponse.json({ ok: false, error: "Subscription required" }, { status: 403 });
}
