import {
  readLiveJsonFile as readJsonFile,
  writeLiveJsonFile as writeJsonFile,
} from "@/app/api/_lib/store/liveDb";

const STORE_FILE = "church-live.json";

function liveStoreKey(churchId: string, liveId: string) {
  const cid = String(churchId || "").trim();
  const lid = String(liveId || "").trim() || "scheduled-live-default";
  return `${cid}|${lid}`;
}

function liveKeyMatchesSchedule(key: string, churchId: string, liveId: string) {
  const cid = String(churchId || "").trim();
  const lid = String(liveId || "").trim();
  if (!cid) return false;
  if (key === cid) return true;
  if (!lid) return key.startsWith(`${cid}|`);
  return key === liveStoreKey(cid, lid) || key.endsWith(`|${lid}`);
}

/** End church live session(s) tied to a schedule when slots are cleared. */
export async function endChurchLiveSessionsForSchedule(input: {
  churchId: string;
  liveId?: string;
  reason?: string;
}) {
  const churchId = String(input.churchId || "").trim();
  const liveId = String(input.liveId || "").trim();
  const reason = String(input.reason || "schedule-slots-cleared").trim();
  if (!churchId) return { endedKeys: [] as string[] };

  const store = await readJsonFile<Record<string, any>>(STORE_FILE, {});
  const now = Date.now();
  const endedKeys: string[] = [];

  for (const [key, raw] of Object.entries(store)) {
    if (!raw || typeof raw !== "object") continue;
    if (!liveKeyMatchesSchedule(key, churchId, liveId)) continue;

    const isLive = raw.isLive === true && !raw.endedAt;
    if (!isLive && !Object.keys(raw.requests || {}).length) continue;

    store[key] = {
      ...raw,
      isLive: false,
      endedAt: new Date(now).toISOString(),
      endedReason: reason,
      updatedAt: now,
      requests: {},
    };
    endedKeys.push(key);
  }

  if (endedKeys.length) {
    await writeJsonFile(STORE_FILE, store);
  }

  return { endedKeys };
}
