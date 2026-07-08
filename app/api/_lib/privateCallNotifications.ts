import { createNotification } from "@/app/api/_lib/notifications";
import type { PrivateCallSession } from "@/app/api/_lib/privateCallSessions";

export function privateCallNotificationId(callId: string, pastorUserId: string) {
  return `ntf_private_call_${callId}_${pastorUserId}`;
}

export async function notifyPastorPrivateCallIncoming(session: PrivateCallSession) {
  const callerName = String(session.callerName || "A church member").trim();
  const pastorUserId = String(session.pastorUserId || "").trim();
  const created = await createNotification({
    id: privateCallNotificationId(session.id, pastorUserId),
    churchId: session.churchId,
    type: "PastorPrivateCallIncoming",
    title: `${callerName} is calling`,
    message: `private-call:${session.id}`,
    actorName: callerName,
    actorUserId: session.callerUserId,
    actorAvatarUri: session.callerAvatarUrl,
    targetUserId: pastorUserId,
  });

  console.log("KRISTO_PRIVATE_CALL_NOTIFICATION_CREATED", {
    callId: session.id,
    callerUserId: session.callerUserId,
    receiverUserId: pastorUserId,
    pastorUserId,
    targetUserId: pastorUserId,
    churchId: session.churchId,
    notificationId: created.id,
    status: session.status,
  });

  return created;
}
