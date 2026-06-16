import { AppState, type AppStateStatus } from "react-native";

type NetworkListener = (online: boolean) => void;

const listeners = new Set<NetworkListener>();
let online = true;
let started = false;
let probeTimer: ReturnType<typeof setInterval> | undefined;

function setOnline(next: boolean) {
  if (online === next) return;
  online = next;
  console.log("KRISTO_NETWORK_STATUS", { online: next });
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {}
  });
}

export function isKristoNetworkOnline() {
  return online;
}

export function subscribeKristoNetworkStatus(listener: NetworkListener) {
  listeners.add(listener);
  listener(online);
  return () => {
    listeners.delete(listener);
  };
}

export async function probeKristoNetwork(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch("https://clients3.google.com/generate_204", {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const next = response.status === 204 || response.ok;
    setOnline(next);
    return next;
  } catch {
    setOnline(false);
    return false;
  }
}

export function startKristoNetworkMonitor() {
  if (started) return;
  started = true;

  void probeKristoNetwork();

  probeTimer = setInterval(() => {
    void probeKristoNetwork();
  }, 5000);

  const onAppStateChange = (state: AppStateStatus) => {
    if (state === "active") {
      void probeKristoNetwork();
    }
  };

  AppState.addEventListener("change", onAppStateChange);
}
