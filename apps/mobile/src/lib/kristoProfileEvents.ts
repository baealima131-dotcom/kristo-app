import { DeviceEventEmitter } from "react-native";

import { markSaveCooldown } from "@/src/lib/kristoTraffic";

export const KRISTO_CHURCH_PROFILE_UPDATED = "kristo:church-profile-updated";
export const KRISTO_USER_PROFILE_UPDATED = "kristo:user-profile-updated";
export const KRISTO_CLAIM_UPDATED = "kristo:claim-updated";
export const KRISTO_MINISTRIES_UPDATED = "kristo:ministries-updated";
export const KRISTO_CHURCH_PREMIUM_ACCESS_CHANGED = "kristo:church-premium-access-changed";

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

export type MinistriesUpdatedPayload = {
  churchId: string;
  userId: string;
  ministryId?: string;
  action: "created" | "updated" | "refresh";
  updatedAt?: number;
};

export function emitMinistriesUpdated(payload: MinistriesUpdatedPayload) {
  DeviceEventEmitter.emit(KRISTO_MINISTRIES_UPDATED, {
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  });
}

export function onMinistriesUpdated(listener: (payload: MinistriesUpdatedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_MINISTRIES_UPDATED, listener);
  return () => sub.remove();
}

export type ChurchPremiumAccessChangedPayload = {
  churchId: string;
  userId?: string;
  subscriptionActive: boolean;
  backendSubscriptionActive: boolean;
  canUseMediaTools: boolean;
  subscriptionPlan?: "monthly" | "yearly" | null;
  updatedAt?: number;
};

export function emitChurchPremiumAccessChanged(payload: ChurchPremiumAccessChangedPayload) {
  DeviceEventEmitter.emit(KRISTO_CHURCH_PREMIUM_ACCESS_CHANGED, {
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  });
}

export function onChurchPremiumAccessChanged(
  listener: (payload: ChurchPremiumAccessChangedPayload) => void
) {
  const sub = DeviceEventEmitter.addListener(KRISTO_CHURCH_PREMIUM_ACCESS_CHANGED, listener);
  return () => sub.remove();
}
