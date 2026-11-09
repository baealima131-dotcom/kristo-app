import { PUSH_DEVICES_STORE_KEY, readCoreJsonFile, updateCoreJsonFile } from "./coreDb";

/**
 * Device tokens for Kristo push: FCM tokens (Android: calls and direct messages) and APNs VoIP
 * tokens (iOS: incoming calls through PushKit / CallKit).
 */
export type PushDeviceKind = "fcm" | "apns-voip";

export type PushDevice = {
  userId: string;
  token: string;
  /** Missing on devices saved before iOS VoIP push existed: those are FCM. */
  kind?: PushDeviceKind;
  platform: "android" | "ios";
  updatedAt: string;
};

type PushDevicesStore = { devices: PushDevice[] };

const MAX_DEVICES_PER_USER = 5;

function defaultStore(): PushDevicesStore {
  return { devices: [] };
}

function deviceKind(device: PushDevice): PushDeviceKind {
  return device.kind === "apns-voip" ? "apns-voip" : "fcm";
}

export function parsePushDeviceKind(value: unknown): PushDeviceKind | null {
  if (value === undefined || value === null || value === "" || value === "fcm") return "fcm";
  return value === "apns-voip" ? "apns-voip" : null;
}

export function validFcmToken(token: string) {
  return /^[A-Za-z0-9:_\-.]{20,4096}$/.test(token);
}

/** An APNs device token is 32 bytes, sent as hex. */
export function validApnsToken(token: string) {
  return /^[0-9a-fA-F]{64}$/.test(token);
}

export function validPushToken(token: string, kind: PushDeviceKind) {
  return kind === "apns-voip" ? validApnsToken(token) : validFcmToken(token);
}

export async function savePushDevice(userId: string, token: string, kind: PushDeviceKind = "fcm") {
  const uid = String(userId || "").trim();
  if (!uid || !validPushToken(token, kind)) return;
  await updateCoreJsonFile<PushDevicesStore>(
    PUSH_DEVICES_STORE_KEY,
    (current) => {
      // A token belongs to one signed-in user: re-registering moves it.
      const others = (current.devices || []).filter((d) => d.token !== token);
      const mine = others
        .filter((d) => d.userId === uid && deviceKind(d) === kind)
        .slice(0, MAX_DEVICES_PER_USER - 1);
      const rest = others.filter((d) => !(d.userId === uid && deviceKind(d) === kind));
      const device: PushDevice = {
        userId: uid,
        token,
        kind,
        platform: kind === "apns-voip" ? "ios" : "android",
        updatedAt: new Date().toISOString(),
      };
      return { devices: [device, ...mine, ...rest] };
    },
    defaultStore()
  );
}

export async function deletePushDevice(userId: string, token: string) {
  const uid = String(userId || "").trim();
  await updateCoreJsonFile<PushDevicesStore>(
    PUSH_DEVICES_STORE_KEY,
    (current) => ({
      devices: (current.devices || []).filter((d) => !(d.token === token && (!uid || d.userId === uid))),
    }),
    defaultStore()
  );
}

export async function pushTokensForUser(userId: string, kind: PushDeviceKind = "fcm"): Promise<string[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const store = await readCoreJsonFile<PushDevicesStore>(PUSH_DEVICES_STORE_KEY, defaultStore());
  return (store.devices || []).filter((d) => d.userId === uid && deviceKind(d) === kind).map((d) => d.token);
}
