import { router } from "expo-router";

/**
 * Shared between the incoming-call poller and push: each incoming call opens the call screen once,
 * and an "Answer" pressed on the notification is accepted when that screen loads.
 */
const openedIncomingCallIds = new Set<string>();
const pendingAnswerCallIds = new Set<string>();

export function wasIncomingCallScreenOpened(callId: string) {
  return openedIncomingCallIds.has(callId);
}

export function markIncomingCallScreenOpened(callId: string) {
  openedIncomingCallIds.add(callId);
}

export function markPendingCallAnswer(callId: string) {
  if (callId) pendingAnswerCallIds.add(callId);
}

export function consumePendingCallAnswer(callId: string) {
  return pendingAnswerCallIds.delete(callId);
}

export function openIncomingCallScreen(callId: string, source: string) {
  if (!callId || openedIncomingCallIds.has(callId)) return false;
  openedIncomingCallIds.add(callId);
  console.log("KRISTO_PRIVATE_CALL_RECEIVER_SCREEN_OPENED", { callId, source });
  router.push({ pathname: "/more/private-call/[callId]", params: { callId } } as any);
  return true;
}
