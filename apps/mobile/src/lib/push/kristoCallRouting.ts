import { router } from "expo-router";

/**
 * Shared between the incoming-call poller and push: each incoming call opens the call screen once,
 * and an "Answer" pressed on the notification is accepted when that screen loads.
 */
const openedIncomingCallIds = new Set<string>();
const pendingAnswerCallIds = new Set<string>();
const liveCallScreenIds = new Set<string>();

/**
 * A call screen whose call is still ringing or connected. While one is open the poller does not
 * open another incoming call over it; a finished call's screen does not count.
 */
export function setCallScreenLive(callId: string, live: boolean) {
  if (!callId) return;
  if (live) liveCallScreenIds.add(callId);
  else liveCallScreenIds.delete(callId);
}

export function hasLiveCallScreen() {
  return liveCallScreenIds.size > 0;
}

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
