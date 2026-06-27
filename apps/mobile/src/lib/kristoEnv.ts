import Constants from "expo-constants";

const PRODUCTION_API_BASE = "https://kristo-app.vercel.app";
const LOCAL_API_PORT = 3000;

function trimBase(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function resolveLocalDevApiBase(): string {
  const lanHost = inferDevLanHost();
  if (lanHost) return `http://${lanHost}:${LOCAL_API_PORT}`;
  return `http://localhost:${LOCAL_API_PORT}`;
}

/** Metro / dev-client host, e.g. 192.168.12.141 from 192.168.12.141:8081 */
function inferDevLanHost(): string | null {
  const hostUri = trimBase(String(Constants.expoConfig?.hostUri || ""));
  const debuggerHost = trimBase(String((Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost || ""));
  const legacyDebugger = trimBase(String((Constants as any)?.manifest?.debuggerHost || ""));

  const candidate = hostUri || debuggerHost || legacyDebugger;
  if (!candidate) return null;

  const host = candidate.split(":")[0]?.trim();
  if (!host || host === "localhost" || host === "127.0.0.1") return null;
  return host;
}

export function resolveApiBase(): string {
  const explicit = trimBase(process.env.EXPO_PUBLIC_API_BASE || "");
  if (explicit) return explicit;

  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return resolveLocalDevApiBase();
  }

  return PRODUCTION_API_BASE;
}

export function resolveWebBase(): string {
  const explicit = trimBase(process.env.EXPO_PUBLIC_WEB_BASE || "");
  if (explicit) return explicit;
  return resolveApiBase();
}

export const ENV = {
  get API_BASE() {
    return resolveApiBase();
  },
  get WEB_BASE() {
    return resolveWebBase();
  },
  DEMO: (process.env.EXPO_PUBLIC_DEMO ?? "0") === "1",
};

if (typeof __DEV__ !== "undefined" && __DEV__) {
  console.log("[KRISTO ENV] API_BASE", resolveApiBase(), {
    explicit: trimBase(process.env.EXPO_PUBLIC_API_BASE || "") || null,
    metroHost: inferDevLanHost(),
  });
}
