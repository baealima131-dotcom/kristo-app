import { DeviceEventEmitter } from "react-native";

import { markSaveCooldown } from "@/src/lib/kristoTraffic";

export const KRISTO_CHURCH_PROFILE_UPDATED = "kristo:church-profile-updated";
export const KRISTO_USER_PROFILE_UPDATED = "kristo:user-profile-updated";
export const KRISTO_CLAIM_UPDATED = "kristo:claim-updated";

export type ClaimUpdatedPayload = {
  postId: string;
  feedId?: string;
  baseFeedId?: string;
  slotId: string;
  slotNumber?: number;
  userId: string;
  action: "claim" | "unclaim";
  startMs?: number;
  endMs?: number;
  claim?: {
    userId?: string;
    name?: string;
    role?: string;
    avatarUri?: string;
    claimedAt?: string;
  };
  updatedAt?: number;
};

export type ChurchProfileUpdatedPayload = {
  churchId: string;
  name?: string;
  avatarUri?: string;
  avatarUrl?: string;
  updatedAt?: number;
  avatarUpdatedAt?: number;
};

export type UserProfileUpdatedPayload = {
  userId: string;
  avatarUri?: string;
  avatarUrl?: string;
  updatedAt?: number;
  avatarUpdatedAt?: number;
};

export function emitChurchProfileUpdated(payload: ChurchProfileUpdatedPayload) {
  markSaveCooldown(`church-profile:${String(payload.churchId || "").trim()}`);
  DeviceEventEmitter.emit(KRISTO_CHURCH_PROFILE_UPDATED, payload);
}

export function emitUserProfileUpdated(payload: UserProfileUpdatedPayload) {
  markSaveCooldown(`user-profile:${String(payload.userId || "").trim()}`);
  DeviceEventEmitter.emit(KRISTO_USER_PROFILE_UPDATED, payload);
}

export function onChurchProfileUpdated(listener: (payload: ChurchProfileUpdatedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_CHURCH_PROFILE_UPDATED, listener);
  return () => sub.remove();
}

export function onUserProfileUpdated(listener: (payload: UserProfileUpdatedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_USER_PROFILE_UPDATED, listener);
  return () => sub.remove();
}

export function emitClaimUpdated(payload: ClaimUpdatedPayload) {
  DeviceEventEmitter.emit(KRISTO_CLAIM_UPDATED, {
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  });
}

export function onClaimUpdated(listener: (payload: ClaimUpdatedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_CLAIM_UPDATED, listener);
  return () => sub.remove();
}
