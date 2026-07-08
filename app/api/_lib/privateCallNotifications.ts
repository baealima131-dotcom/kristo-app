import { createNotification } from "@/app/api/_lib/notifications";
import type { PrivateCallSession } from "@/app/api/_lib/privateCallSessions";

export function privateCallNotificationId(callId: string, pastorUserId: string) {
  return `ntf_private_call_${callId}_${pastorUserId}`;
}

export async function notifyPastorPrivateCallIncoming(session: PrivateCallSession) {
  const callerName = String(session.callerName || "A church member").trim();
  await createNotification({
    id: privateCallNotificationId(session.id, session.pastorUserId),
    churchId: session.churchId,
    type: "PastorPrivateCallIncoming",
    title: `${callerName} is calling`,
    message: `private-call:${session.id}`,
    actorName: callerName,
    actorUserId: session.callerUserId,
    actorAvatarUri: session.callerAvatarUrl,
    targetUserId: session.pastorUserId,
  });
}
