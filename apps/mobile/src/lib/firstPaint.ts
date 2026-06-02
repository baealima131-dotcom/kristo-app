import { InteractionManager } from "react-native";

const loggedScreens = new Set<string>();

export function logFirstPaintReady(screen: string, extra?: Record<string, unknown>) {
  if (loggedScreens.has(screen)) return;
  loggedScreens.add(screen);
  console.log("KRISTO_FIRST_PAINT_READY", {
    screen,
    ...(extra || {}),
  });
}

/** Run work after interactions settle — does not block screen mount. */
export function runAfterFirstPaint(task: () => void, delayMs = 1200) {
  InteractionManager.runAfterInteractions(() => {
    if (delayMs <= 0) {
      task();
      return;
    }
    setTimeout(task, delayMs);
  });
}

export function deferNonCriticalRefresh(task: () => void | Promise<void>, delayMs = 2200) {
  runAfterFirstPaint(() => {
    void task();
  }, delayMs);
}
