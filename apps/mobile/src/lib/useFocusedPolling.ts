import { useCallback, useEffect, useRef } from "react";
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
    let inflight = false;

    const canRun = () => alive && isFocused && appState === "active";

    const stop = (reason: string) => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logTrafficPollingPaused(screen, reason);
    };

    const runTick = async () => {
      if (!canRun() || inflight) return;
      inflight = true;
      try {
        await tickRef.current();
      } finally {
        inflight = false;
      }
    };

    const start = () => {
      if (!canRun()) {
        logTrafficPollingPaused(screen, !isFocused ? "unfocused" : "background");
        return;
      }
      if (timer) return;
      void runTick();
      timer = setInterval(() => {
        void runTick();
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

/** Run async work once at a time (skip overlapping silent refresh ticks). */
export function useSilentInflightGuard() {
  const inflightRef = useRef(false);
  return useCallback(async (fn: () => void | Promise<void>) => {
    if (inflightRef.current) return false;
    inflightRef.current = true;
    try {
      await fn();
      return true;
    } finally {
      inflightRef.current = false;
    }
  }, []);
}
