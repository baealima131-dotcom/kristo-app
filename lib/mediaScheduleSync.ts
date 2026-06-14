import fs from "fs";
import path from "path";
import { getKristoDataDir } from "@/app/api/_lib/store/fs";
import { isMediaScheduleFeedItem } from "@/lib/mediaScheduleLock";

const SYNC_FILE_NAME = "media-schedule-sync.json";

export type MediaScheduleSyncEntry = {
  version: number;
  updatedAt: string;
};

type MediaScheduleSyncStore = Record<string, MediaScheduleSyncEntry>;

declare global {
  // eslint-disable-next-line no-var
  var __kristoMediaScheduleSync: MediaScheduleSyncStore | undefined;
  // eslint-disable-next-line no-var
  var __kristoMediaScheduleSyncHydrated: boolean | undefined;
}

function syncFilePath() {
  return path.join(getKristoDataDir(), SYNC_FILE_NAME);
}

function bundledSyncFilePath() {
  return path.join(process.cwd(), "data", SYNC_FILE_NAME);
}

function readSyncStoreFromDisk(): MediaScheduleSyncStore {
  for (const file of [syncFilePath(), bundledSyncFilePath()]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      // try next path
    }
  }
  return {};
}

function syncStore(): MediaScheduleSyncStore {
  if (!globalThis.__kristoMediaScheduleSyncHydrated) {
    globalThis.__kristoMediaScheduleSync = readSyncStoreFromDisk();
    globalThis.__kristoMediaScheduleSyncHydrated = true;
  }
  if (!globalThis.__kristoMediaScheduleSync) {
    globalThis.__kristoMediaScheduleSync = {};
  }
  return globalThis.__kristoMediaScheduleSync;
}

function persistSyncStore(store: MediaScheduleSyncStore) {
  globalThis.__kristoMediaScheduleSync = store;
  globalThis.__kristoMediaScheduleSyncHydrated = true;

  try {
    const dir = getKristoDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(syncFilePath(), JSON.stringify(store, null, 2));
    console.log("[ScheduleFeed] write success", {
      file: SYNC_FILE_NAME,
      dir,
      churchCount: Object.keys(store).length,
    });
  } catch (error: any) {
    console.error("[ScheduleFeed] write failure", {
      file: SYNC_FILE_NAME,
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });
  }
}

export function getMediaScheduleSync(churchId: string): MediaScheduleSyncEntry {
  const cid = String(churchId || "").trim();
  if (!cid) return { version: 0, updatedAt: "" };

  const store = syncStore();
  return store[cid] || { version: 0, updatedAt: "" };
}

export function bumpMediaScheduleSync(
  churchId: string,
  reason = "media-schedule-change"
): MediaScheduleSyncEntry {
  const cid = String(churchId || "").trim();
  if (!cid) return { version: 0, updatedAt: "" };

  const store = syncStore();
  const prev = Number(store[cid]?.version || 0);
  const next: MediaScheduleSyncEntry = {
    version: prev + 1,
    updatedAt: new Date().toISOString(),
  };

  store[cid] = next;
  persistSyncStore(store);

  console.log("KRISTO_MEDIA_SCHEDULE_VERSION_BUMP", {
    churchId: cid,
    reason,
    version: next.version,
    updatedAt: next.updatedAt,
  });

  return next;
}

export function isMediaScheduleFeedRecord(item: any): boolean {
  if (!item || typeof item !== "object") return false;

  const id = String(item.id || "").toLowerCase();
  return (
    isMediaScheduleFeedItem(item) ||
    id.startsWith("media-live-") ||
    id.startsWith("media-schedule-")
  );
}

export function bumpMediaScheduleSyncForFeedItem(
  item: any,
  reason = "media-schedule-change"
): MediaScheduleSyncEntry | null {
  if (!isMediaScheduleFeedRecord(item)) return null;

  const churchId = String(item?.churchId || "").trim();
  if (!churchId) return null;

  return bumpMediaScheduleSync(churchId, reason);
}
