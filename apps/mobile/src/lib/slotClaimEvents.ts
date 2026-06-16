import { DeviceEventEmitter } from "react-native";

export const KRISTO_SLOT_CLAIM_CHANGED = "kristo:slot-claim-changed";

export type SlotClaimChangedPayload = {
  churchId: string;
  postId?: string;
  slotId: string;
  action: "claim" | "unclaim";
  userId: string;
  source?: string;
  updatedAt?: number;
};

export function emitSlotClaimChanged(payload: SlotClaimChangedPayload) {
  const event: SlotClaimChangedPayload = {
    ...payload,
    updatedAt: payload.updatedAt ?? Date.now(),
  };

  console.log("KRISTO_SLOT_CLAIM_BROADCAST", {
    churchId: event.churchId,
    postId: event.postId || null,
    slotId: event.slotId,
    action: event.action,
    userId: event.userId,
    source: event.source || null,
  });

  DeviceEventEmitter.emit(KRISTO_SLOT_CLAIM_CHANGED, event);
}

export function onSlotClaimChanged(listener: (payload: SlotClaimChangedPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_SLOT_CLAIM_CHANGED, listener);
  return () => sub.remove();
}
