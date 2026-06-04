import { NextResponse } from "next/server";
import { readJsonFile } from "@/app/api/_lib/store/fs";
import {
  isChurchSubscriptionActiveFromRecord,
  type ChurchSubscriptionRecord,
} from "@/lib/churchSubscription";
import {
  isServerSubscriptionGateBypassed,
  isSubscriptionBypassEnabled,
  logServerSubscriptionGateCheck,
} from "@/lib/subscriptionBypass";

const STORE_FILE = "church-media.json";

type ChurchMediaStoreRow = ChurchSubscriptionRecord & {
  churchId?: string;
};

export async function getChurchMediaSubscriptionRecord(
  churchId: string
): Promise<ChurchMediaStoreRow | null> {
  const cid = String(churchId || "").trim();
  if (!cid) return null;

  const store = await readJsonFile<Record<string, ChurchMediaStoreRow>>(STORE_FILE, {});
  return Object.values(store).find((row) => String(row?.churchId || "").trim() === cid) || null;
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
