import { DeviceEventEmitter } from "react-native";

export const KRISTO_LIVE_RING_REFRESH = "kristo:live-ring-refresh";

export type LiveRingRefreshPayload = {
  reason: string;
  at: number;
};

export function emitLiveRingRefresh(reason: string) {
  DeviceEventEmitter.emit(KRISTO_LIVE_RING_REFRESH, {
    reason: String(reason || "manual"),
    at: Date.now(),
  } satisfies LiveRingRefreshPayload);
}

export function onLiveRingRefresh(listener: (payload: LiveRingRefreshPayload) => void) {
  const sub = DeviceEventEmitter.addListener(KRISTO_LIVE_RING_REFRESH, listener);
  return () => sub.remove();
}
