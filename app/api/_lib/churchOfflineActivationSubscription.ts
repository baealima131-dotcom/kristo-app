import { resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { getChurchById } from "@/app/api/_lib/churches";
import type { ActivationCode } from "@/app/api/_lib/offlineActivationCodeStore";
import {
  getChurchMediaByChurchId,
  upsertChurchMedia,
  type ChurchMediaProfile,
} from "@/app/api/_lib/store/mediaDb";

export type OfflineActivationSubscriptionUnlock = {
  subscriptionActive: true;
  subscriptionPlan: string;
  subscriptionExpiresAt: number;
  subscriptionActivatedAt: number;
  source: "offline_activation";
};

function addDurationMonthsMs(durationMonths: number, fromMs = Date.now()): number {
  const months = Math.max(1, Math.floor(Number(durationMonths || 1)));
  const date = new Date(fromMs);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

function resolveOfflineSubscriptionPlan(durationMonths: number): string {
  const months = Math.max(1, Math.floor(Number(durationMonths || 1)));
  return months >= 12 ? "yearly" : "monthly";
}

/**
 * Unlock Media Premium for the activated church only — never the agent/supervisor church.
 * Does not call RevenueCat.
 */
export async function unlockChurchSubscriptionFromOfflineActivation(args: {
  churchId: string;
  code: ActivationCode;
}): Promise<OfflineActivationSubscriptionUnlock & { media: ChurchMediaProfile | null }> {
  const churchId = String(args.churchId || "").trim();
  const code = args.code;
  const activationCode = String(code.code || "").trim();
  const durationMonths = Math.max(1, Math.floor(Number(code.durationMonths || 1)));
  const now = Date.now();
  const subscriptionExpiresAt = addDurationMonthsMs(durationMonths, now);
  const subscriptionPlan = resolveOfflineSubscriptionPlan(durationMonths);

  if (!churchId) throw new Error("churchId required for offline activation subscription unlock");

  let media = await getChurchMediaByChurchId(churchId);
  const pastorUserId = await resolveActualChurchPastorUserId(churchId);
  const ownerUserId = String(pastorUserId || media?.ownerUserId || "").trim();

  if (!media?.mediaName) {
    if (!ownerUserId) {
      throw new Error("Church pastor not found — cannot create media profile for subscription unlock");
    }
    const church = await getChurchById(churchId);
    const churchName = String(church?.name || churchId).trim() || churchId;
    console.log("KRISTO_AGENT_OFFLINE_ACTIVATION_MEDIA_PROFILE_BEFORE_CREATE", {
      activationCode,
      churchId,
      durationMonths,
      profileSubscriptionActive: media?.subscriptionActive ?? null,
      revenueCatActive: null,
      reason: "offline-activation-create-profile",
    });
    media = await upsertChurchMedia({
      churchId,
      ownerUserId,
      patch: {
        mediaName: `${churchName} Media`,
        category: "Church Media",
        visibility: "church",
        churchId,
        createdBy: ownerUserId,
        subscriptionActive: false,
      } as Partial<ChurchMediaProfile> & { mediaName: string },
    });
    console.log("KRISTO_AGENT_OFFLINE_ACTIVATION_MEDIA_PROFILE_AFTER_CREATE", {
      activationCode,
      churchId,
      durationMonths,
      profileSubscriptionActive: media?.subscriptionActive ?? false,
      profileSubscriptionPlan: media?.subscriptionPlan ?? null,
      revenueCatActive: null,
      reason: "profile-created-before-unlock",
    });
  }

  console.log("KRISTO_AGENT_OFFLINE_ACTIVATION_SUBSCRIPTION_UNLOCK", {
    activationCode,
    churchId,
    durationMonths,
    subscriptionActive: true,
    subscriptionExpiresAt,
    source: "offline_activation",
    offlineActivationBatchId: code.batchId,
  });

  const updated = await upsertChurchMedia({
    churchId,
    ownerUserId: media!.ownerUserId,
    patch: {
      ...media!,
      mediaName: media!.mediaName,
      subscriptionActive: true,
      subscriptionPlan,
      subscriptionUpdatedAt: now,
      subscriptionActivatedAt: now,
      subscriptionExpiresAt,
      subscriptionSource: "offline_activation",
      offlineActivationCode: activationCode,
      offlineActivationBatchId: String(code.batchId || "").trim() || undefined,
    } as Partial<ChurchMediaProfile> & { mediaName: string },
  });

  console.log("KRISTO_AGENT_OFFLINE_ACTIVATION_MEDIA_PROFILE_AFTER", {
    activationCode,
    churchId,
    durationMonths,
    subscriptionActive: updated?.subscriptionActive ?? false,
    subscriptionExpiresAt: updated?.subscriptionExpiresAt ?? null,
    subscriptionPlan: updated?.subscriptionPlan ?? null,
    subscriptionSource: updated?.subscriptionSource ?? null,
    source: "offline_activation",
  });

  return {
    subscriptionActive: true,
    subscriptionPlan,
    subscriptionExpiresAt,
    subscriptionActivatedAt: now,
    source: "offline_activation",
    media: updated,
  };
}
