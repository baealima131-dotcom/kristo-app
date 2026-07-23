import { resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { createNotification } from "@/app/api/_lib/notifications";
import { isUnsafeActorDisplayName } from "@/app/api/_lib/notificationActor";
import {
  patchChurchMediaSubscription,
  type ChurchMediaProfile,
} from "@/app/api/_lib/store/mediaDb";

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

function publicHostLabel(hostName?: string | null): string {
  const raw = String(hostName || "").trim();
  if (raw && !isUnsafeActorDisplayName(raw)) return raw;
  return "A church member";
}

function mediaHostAddedHostId(churchId: string, hostUserId: string) {
  return `ntf_media_host_added_host_${churchId}_${hostUserId}`;
}

function mediaHostAddedPastorId(churchId: string, hostUserId: string, pastorUserId: string) {
  return `ntf_media_host_added_pastor_${churchId}_${hostUserId}_${pastorUserId}`;
}

function mediaHostRemovedHostId(churchId: string, hostUserId: string) {
  return `ntf_media_host_removed_host_${churchId}_${hostUserId}`;
}

function mediaHostRemovedPastorId(churchId: string, hostUserId: string, pastorUserId: string) {
  return `ntf_media_host_removed_pastor_${churchId}_${hostUserId}_${pastorUserId}`;
}

function subscriptionActivatedId(churchId: string, pastorUserId: string) {
  return `ntf_sub_activated_${churchId}_${pastorUserId}`;
}

function subscriptionExpiringId(churchId: string, pastorUserId: string, expiryDay: string) {
  return `ntf_sub_expiring_${churchId}_${pastorUserId}_${expiryDay}`;
}

function subscriptionExpiredId(churchId: string, pastorUserId: string) {
  return `ntf_sub_expired_${churchId}_${pastorUserId}`;
}

function expiryDayKey(expiresAtMs: number): string {
  return new Date(expiresAtMs).toISOString().slice(0, 10);
}

export function parseSubscriptionExpiresAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

export async function notifyTrustedMediaHostAdded(args: {
  churchId: string;
  hostUserId: string;
  hostName?: string;
  pastorUserId?: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const hostUserId = String(args.hostUserId || "").trim();
  if (!churchId || !hostUserId) return 0;

  const pastorUserId =
    String(args.pastorUserId || "").trim() ||
    (await resolveActualChurchPastorUserId(churchId));
  const hostName = publicHostLabel(args.hostName);

  let sent = 0;

  await createNotification({
    id: mediaHostAddedHostId(churchId, hostUserId),
    churchId,
    type: "TrustedMediaHostAdded",
    title: "You were added as a media host",
    message: "You can now help manage church media in Media Studio.",
    targetUserId: hostUserId,
  });
  sent += 1;

  if (pastorUserId && pastorUserId !== hostUserId) {
    await createNotification({
      id: mediaHostAddedPastorId(churchId, hostUserId, pastorUserId),
      churchId,
      type: "TrustedMediaHostAdded",
      title: "Media host added",
      message: `${hostName} was added as a trusted media host.`,
      targetUserId: pastorUserId,
      actorName: hostName,
      actorUserId: hostUserId,
    });
    sent += 1;
  }

  return sent;
}

export async function notifyTrustedMediaHostRemoved(args: {
  churchId: string;
  hostUserId: string;
  hostName?: string;
  pastorUserId?: string;
}): Promise<number> {
  const churchId = String(args.churchId || "").trim();
  const hostUserId = String(args.hostUserId || "").trim();
  if (!churchId || !hostUserId) return 0;

  const pastorUserId =
    String(args.pastorUserId || "").trim() ||
    (await resolveActualChurchPastorUserId(churchId));
  const hostName = publicHostLabel(args.hostName);

  let sent = 0;

  await createNotification({
    id: mediaHostRemovedHostId(churchId, hostUserId),
    churchId,
    type: "TrustedMediaHostRemoved",
    title: "You were removed as a media host",
    message: "You no longer have trusted media host access for this church.",
    targetUserId: hostUserId,
  });
  sent += 1;

  if (pastorUserId && pastorUserId !== hostUserId) {
    await createNotification({
      id: mediaHostRemovedPastorId(churchId, hostUserId, pastorUserId),
      churchId,
      type: "TrustedMediaHostRemoved",
      title: "Media host removed",
      message: `${hostName} was removed as a trusted media host.`,
      targetUserId: pastorUserId,
      actorName: hostName,
      actorUserId: hostUserId,
    });
    sent += 1;
  }

  return sent;
}

export async function notifyChurchSubscriptionActivated(args: {
  churchId: string;
  pastorUserId: string;
  plan?: string;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const pastorUserId = String(args.pastorUserId || "").trim();
  if (!churchId || !pastorUserId) return false;

  const plan = String(args.plan || "").trim();
  const message = plan
    ? `Your church subscription (${plan}) is now active. Media Studio tools are unlocked.`
    : "Your church subscription is now active. Media Studio tools are unlocked.";

  await createNotification({
    id: subscriptionActivatedId(churchId, pastorUserId),
    churchId,
    type: "ChurchSubscriptionActivated",
    title: "Church subscription activated",
    message,
    targetUserId: pastorUserId,
  });

  return true;
}

export async function notifyChurchSubscriptionExpiringSoon(args: {
  churchId: string;
  pastorUserId: string;
  expiresAtMs: number;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const pastorUserId = String(args.pastorUserId || "").trim();
  const expiresAtMs = parseSubscriptionExpiresAtMs(args.expiresAtMs);
  if (!churchId || !pastorUserId || !expiresAtMs) return false;

  const expiryLabel = new Date(expiresAtMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  await createNotification({
    id: subscriptionExpiringId(churchId, pastorUserId, expiryDayKey(expiresAtMs)),
    churchId,
    type: "ChurchSubscriptionExpiringSoon",
    title: "Church subscription expiring soon",
    message: `Your church subscription expires on ${expiryLabel}. Renew in Media Studio to keep access.`,
    targetUserId: pastorUserId,
  });

  return true;
}

export async function notifyChurchSubscriptionExpired(args: {
  churchId: string;
  pastorUserId: string;
}): Promise<boolean> {
  const churchId = String(args.churchId || "").trim();
  const pastorUserId = String(args.pastorUserId || "").trim();
  if (!churchId || !pastorUserId) return false;

  await createNotification({
    id: subscriptionExpiredId(churchId, pastorUserId),
    churchId,
    type: "ChurchSubscriptionExpired",
    title: "Church subscription expired",
    message: "Your church subscription is no longer active. Renew in Media Studio to restore access.",
    targetUserId: pastorUserId,
  });

  return true;
}

export async function reconcileChurchSubscriptionExpiryNotifications(args: {
  churchId: string;
  pastorUserId: string;
  media: ChurchMediaProfile | null;
}): Promise<{ expired: boolean; expiringSoon: boolean }> {
  const churchId = String(args.churchId || "").trim();
  const pastorUserId = String(args.pastorUserId || "").trim();
  const media = args.media;
  if (!churchId || !pastorUserId || !media?.subscriptionActive) {
    return { expired: false, expiringSoon: false };
  }

  const expiresAtMs = parseSubscriptionExpiresAtMs(media.subscriptionExpiresAt);
  if (!expiresAtMs) {
    return { expired: false, expiringSoon: false };
  }

  const now = Date.now();
  if (now >= expiresAtMs) {
    await patchChurchMediaSubscription(churchId, {
      subscriptionActive: false,
      subscriptionPlan: media.subscriptionPlan,
      subscriptionExpiresAt: expiresAtMs,
    });
    await notifyChurchSubscriptionExpired({ churchId, pastorUserId });
    return { expired: true, expiringSoon: false };
  }

  if (expiresAtMs - now <= EXPIRING_SOON_MS) {
    await notifyChurchSubscriptionExpiringSoon({
      churchId,
      pastorUserId,
      expiresAtMs,
    });
    return { expired: false, expiringSoon: true };
  }

  return { expired: false, expiringSoon: false };
}
