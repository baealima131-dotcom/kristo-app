import { DeviceEventEmitter } from "react-native";

export const KRISTO_CHURCH_PROFILE_UPDATED = "kristo:church-profile-updated";
export const KRISTO_USER_PROFILE_UPDATED = "kristo:user-profile-updated";

export type ChurchProfileUpdatedPayload = {
  churchId: string;
  updatedAt?: number;
  avatarUpdatedAt?: number;
};

export type UserProfileUpdatedPayload = {
  userId: string;
  updatedAt?: number;
  avatarUpdatedAt?: number;
};

export function emitChurchProfileUpdated(payload: ChurchProfileUpdatedPayload) {
  DeviceEventEmitter.emit(KRISTO_CHURCH_PROFILE_UPDATED, payload);
}

export function emitUserProfileUpdated(payload: UserProfileUpdatedPayload) {
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
