import { resolveActualChurchPastorUserId } from "@/app/api/_lib/churchMediaAccess";
import { createNotification } from "@/app/api/_lib/notifications";
import { isUnsafeActorDisplayName } from "@/app/api/_lib/notificationActor";

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
