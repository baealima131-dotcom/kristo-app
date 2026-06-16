import { DeviceEventEmitter } from "react-native";

export const KRISTO_CHURCH_INVITE_SENT = "church-invite-sent";
export const KRISTO_CHURCH_INVITE_ACCEPTED = "church-invite-accepted";
export const KRISTO_CHURCH_MEMBERSHIP_CHANGED = "church-membership-changed";

export type ChurchInviteEventPayload = {
  targetUserId?: string;
  targetKristoId?: string;
  userId?: string;
  kristoId?: string;
  churchId?: string;
  role?: string;
  membershipId?: string;
  action?: "sent" | "accepted" | "rejected" | "changed";
  updatedAt?: number;
};

function stamp(payload: ChurchInviteEventPayload): ChurchInviteEventPayload {
  return { ...payload, updatedAt: payload.updatedAt ?? Date.now() };
}

export function emitChurchInviteSent(payload: ChurchInviteEventPayload) {
  const next = stamp({ ...payload, action: payload.action || "sent" });
  console.log("[ChurchInvites] event sent", next);
  DeviceEventEmitter.emit(KRISTO_CHURCH_INVITE_SENT, next);
  DeviceEventEmitter.emit(KRISTO_CHURCH_MEMBERSHIP_CHANGED, next);
}

export function emitChurchInviteAccepted(payload: ChurchInviteEventPayload) {
  const next = stamp({ ...payload, action: "accepted" });
  console.log("[ChurchInvites] event sent", next);
  DeviceEventEmitter.emit(KRISTO_CHURCH_INVITE_ACCEPTED, next);
  DeviceEventEmitter.emit(KRISTO_CHURCH_MEMBERSHIP_CHANGED, next);
}

export function emitChurchMembershipChanged(payload: ChurchInviteEventPayload) {
  const next = stamp({ ...payload, action: payload.action || "changed" });
  console.log("[ChurchInvites] event sent", next);
  DeviceEventEmitter.emit(KRISTO_CHURCH_MEMBERSHIP_CHANGED, next);
}

export function onChurchInviteSent(listener: (payload: ChurchInviteEventPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_CHURCH_INVITE_SENT, listener);
  return () => sub.remove();
}

export function onChurchInviteAccepted(listener: (payload: ChurchInviteEventPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_CHURCH_INVITE_ACCEPTED, listener);
  return () => sub.remove();
}

export function onChurchMembershipChanged(listener: (payload: ChurchInviteEventPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_CHURCH_MEMBERSHIP_CHANGED, listener);
  return () => sub.remove();
}

export function inviteEventTargetsCurrentUser(
  payload: ChurchInviteEventPayload,
  current: { userId?: string; kristoId?: string }
) {
  const uid = String(current.userId || "").trim();
  const kid = String(current.kristoId || "").trim().toUpperCase();
  const targetUid = String(payload.targetUserId || payload.userId || "").trim();
  const targetKid = String(payload.targetKristoId || payload.kristoId || "").trim().toUpperCase();

  if (!targetUid && !targetKid) return true;
  if (uid && targetUid && targetUid.toLowerCase() === uid.toLowerCase()) return true;
  if (kid && targetKid && targetKid === kid) return true;
  if (uid && targetKid && kid && targetKid === kid) return true;
  return false;
}
