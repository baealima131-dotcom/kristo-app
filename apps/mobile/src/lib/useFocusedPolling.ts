import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";

import { logTrafficPollingPaused } from "@/src/lib/kristoTraffic";

/** Poll only while screen is focused and app is foreground-active. */
export function useFocusedPolling(
  screen: string,
  tick: () => void | Promise<void>,
  intervalMs: number,
  enabled = true
) {
  const isFocused = useIsFocused();
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    let appState: AppStateStatus = AppState.currentState;

    const canRun = () => alive && isFocused && appState === "active";

    const stop = (reason: string) => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logTrafficPollingPaused(screen, reason);
    };

    const start = () => {
      if (!canRun() || timer) {
        if (!canRun()) logTrafficPollingPaused(screen, !isFocused ? "unfocused" : "background");
        return;
      }
      void tickRef.current();
      timer = setInterval(() => {
        if (!canRun()) return;
        void tickRef.current();
      }, intervalMs);
    };

    const sub = AppState.addEventListener("change", (next) => {
      appState = next;
      if (canRun()) start();
      else stop(next === "active" ? "unfocused" : "background");
    });

    if (canRun()) start();
    else logTrafficPollingPaused(screen, !isFocused ? "unfocused" : "background");

    return () => {
      alive = false;
      stop("unmounted");
      sub.remove();
    };
  }, [screen, intervalMs, enabled, isFocused]);
}
