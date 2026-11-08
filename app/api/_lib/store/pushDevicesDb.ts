import { PUSH_DEVICES_STORE_KEY, readCoreJsonFile, updateCoreJsonFile } from "./coreDb";

/** Native FCM device tokens for Kristo push (calls and direct messages). */
export type PushDevice = {
  userId: string;
  token: string;
  platform: "android";
  updatedAt: string;
};

type PushDevicesStore = { devices: PushDevice[] };

const MAX_DEVICES_PER_USER = 5;

function defaultStore(): PushDevicesStore {
  return { devices: [] };
}

export function validFcmToken(token: string) {
  return /^[A-Za-z0-9:_\-.]{20,4096}$/.test(token);
}

export async function savePushDevice(userId: string, token: string) {
  const uid = String(userId || "").trim();
  if (!uid || !validFcmToken(token)) return;
  await updateCoreJsonFile<PushDevicesStore>(
    PUSH_DEVICES_STORE_KEY,
    (current) => {
      // A token belongs to one signed-in user: re-registering moves it.
      const others = (current.devices || []).filter((d) => d.token !== token);
      const mine = others.filter((d) => d.userId === uid).slice(0, MAX_DEVICES_PER_USER - 1);
      const rest = others.filter((d) => d.userId !== uid);
      const device: PushDevice = { userId: uid, token, platform: "android", updatedAt: new Date().toISOString() };
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

export async function pushTokensForUser(userId: string): Promise<string[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const store = await readCoreJsonFile<PushDevicesStore>(PUSH_DEVICES_STORE_KEY, defaultStore());
  return (store.devices || []).filter((d) => d.userId === uid).map((d) => d.token);
}
