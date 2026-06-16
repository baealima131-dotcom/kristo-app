import { markClaimHydrationPending, resolveClaimHydration } from "@/src/lib/claimHydrationState";
import { apiGet } from "@/src/lib/kristoApi";
import { feedSyncMediaScheduleFromBackend } from "@/src/lib/homeFeedStore";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { fetchMediaScheduleFeedSync } from "@/src/lib/mediaScheduleSilentReload";
import { scheduleSlotClaimUserId } from "@/src/lib/scheduleSlotUtils";

export type ScheduleSlotClaimBodyInput = {
  postId: string;
  scheduleFeedId?: string;
  slotId: string;
  claim: Record<string, any>;
  scheduleItem?: any;
  viewerChurchId: string;
};

export function resolveScheduleChurchId(scheduleItem?: any, fallbackChurchId?: string) {
  return String(
    scheduleItem?.churchId ||
      scheduleItem?.sourceChurchId ||
      scheduleItem?.ownerChurchId ||
      fallbackChurchId ||
      ""
  ).trim();
}

export function buildScheduleSlotClaimBody(input: ScheduleSlotClaimBodyInput) {
  const viewerChurchId = String(input.viewerChurchId || "").trim();
  const scheduleChurchId = resolveScheduleChurchId(input.scheduleItem, viewerChurchId);
  const scheduleFeedId = String(
    input.scheduleFeedId || input.postId || input.scheduleItem?.id || ""
  ).trim();
  const claimantHomeChurchId = String(
    input.claim?.claimantHomeChurchId || viewerChurchId
  ).trim();

  const body = {
    action: "claim_schedule_slot" as const,
    postId: String(input.postId || scheduleFeedId).trim(),
    scheduleFeedId,
    slotId: String(input.slotId || "").trim(),
    targetChurchId: scheduleChurchId,
    scheduleChurchId,
    claim: {
      ...input.claim,
      claimantHomeChurchId,
    },
  };

  console.log("KRISTO_CROSS_CHURCH_CLAIM_REQUEST", {
    viewerChurchId,
    targetChurchId: scheduleChurchId,
    scheduleChurchId,
    feedId: scheduleFeedId,
    slotId: body.slotId,
    claimantUserId: String(input.claim?.userId || "").trim() || null,
    claimantHomeChurchId,
    crossChurch: Boolean(scheduleChurchId && viewerChurchId && scheduleChurchId !== viewerChurchId),
  });

  markClaimHydrationPending({
    targetChurchId: scheduleChurchId,
    scheduleFeedId,
    slotId: body.slotId,
    userId: String(input.claim?.userId || "").trim(),
  });

  return body;
}

export async function refetchTargetScheduleAfterClaim(input: {
  postId: string;
  scheduleChurchId: string;
  slotId: string;
  viewerChurchId: string;
  viewerUserId: string;
  viewerRole?: string;
}) {
  const postId = String(input.postId || "").trim();
  const scheduleChurchId = String(input.scheduleChurchId || "").trim();
  const slotId = String(input.slotId || "").trim();
  const viewerChurchId = String(input.viewerChurchId || "").trim();
  const viewerUserId = String(input.viewerUserId || "").trim();

  if (!postId || !scheduleChurchId || !slotId || !viewerChurchId || !viewerUserId) {
    console.log("KRISTO_CROSS_CHURCH_CLAIM_PERSIST_RESULT", {
      viewerChurchId,
      targetChurchId: scheduleChurchId,
      scheduleChurchId,
      feedId: postId || null,
      slotId,
      backendClaimedByUserId: "",
      ok: false,
      reason: "missing-refetch-input",
    });
    return null;
  }

  const headers = getKristoHeaders({
    userId: viewerUserId,
    role: (input.viewerRole || "Member") as any,
    churchId: viewerChurchId,
  }) as Record<string, string>;

  let scheduleItem: any = null;

  try {
    const detailRes: any = await apiGet(
      `/api/church/feed?id=${encodeURIComponent(postId)}`,
      { headers, cache: "no-store" as RequestCache },
      { screen: "CrossChurchClaimRefetch", dedupe: false, throttleMs: 0 }
    );
    scheduleItem = detailRes?.data?.item || detailRes?.item || null;
  } catch {
    scheduleItem = null;
  }

  if (!scheduleItem?.scheduleSlots?.length) {
    try {
      const sync = await fetchMediaScheduleFeedSync(viewerChurchId, headers, {
        targetChurchId: scheduleChurchId,
      });
      scheduleItem =
        (sync.rows || []).find((row: any) => String(row?.id || "").trim() === postId) ||
        (sync.rows || []).find((row: any) =>
          String(row?.sourceScheduleId || "").trim() === postId
        ) ||
        null;
    } catch {
      scheduleItem = null;
    }
  }

  const slots = Array.isArray(scheduleItem?.scheduleSlots) ? scheduleItem.scheduleSlots : [];
  const matchedSlot =
    slots.find((slot: any) => String(slot?.id || slot?.slotId || "").trim() === slotId) || null;
  const backendClaimedByUserId = scheduleSlotClaimUserId(matchedSlot);

  console.log("KRISTO_CROSS_CHURCH_CLAIM_PERSIST_RESULT", {
    viewerChurchId,
    targetChurchId: scheduleChurchId,
    scheduleChurchId,
    feedId: postId,
    slotId,
    backendClaimedByUserId,
    ok: Boolean(scheduleItem && backendClaimedByUserId),
    crossChurch: scheduleChurchId !== viewerChurchId,
  });

  if (backendClaimedByUserId) {
    console.log("KRISTO_SLOT_CLAIM_BACKEND_PERSISTED", {
      viewerChurchId,
      scheduleChurchId,
      feedId: postId,
      slotId,
      claimedByUserId: backendClaimedByUserId,
      claimedByName: String(matchedSlot?.claimedByName || matchedSlot?.claimedBy?.name || "").trim(),
      claimedAt: String(matchedSlot?.claimedAt || matchedSlot?.claimedBy?.claimedAt || "").trim(),
      crossChurch: scheduleChurchId !== viewerChurchId,
    });
  }

  if (scheduleItem) {
    feedSyncMediaScheduleFromBackend(scheduleItem);
  }

  if (backendClaimedByUserId) {
    resolveClaimHydration({
      targetChurchId: scheduleChurchId,
      scheduleFeedId: postId,
      slotId,
      userId: viewerUserId,
    });
  }

  return scheduleItem;
}
