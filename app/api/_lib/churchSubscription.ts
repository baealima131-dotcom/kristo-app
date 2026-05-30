import { NextResponse } from "next/server";
import { readJsonFile } from "@/app/api/_lib/store/fs";
import {
  isChurchSubscriptionActiveFromRecord,
  type ChurchSubscriptionRecord,
} from "@/lib/churchSubscription";
import { isSubscriptionBypassEnabled } from "@/lib/subscriptionBypass";

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

export async function isChurchSubscriptionActive(churchId: string): Promise<boolean> {
  if (isSubscriptionBypassEnabled()) return true;
  const media = await getChurchMediaSubscriptionRecord(churchId);
  return isChurchSubscriptionActiveFromRecord(media);
}

export function churchSubscriptionRequiredResponse() {
  return NextResponse.json({ ok: false, error: "Subscription required" }, { status: 403 });
}
