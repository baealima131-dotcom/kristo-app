import AsyncStorage from "@react-native-async-storage/async-storage";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

const STORAGE_KEY = "kristo_home_feed_post_views_v1";

const viewedIds = new Set<string>();
const listeners = new Set<() => void>();
let hydratePromise: Promise<void> | null = null;

function cleanPostId(raw: unknown): string {
  return baseFeedId(String(raw || "").trim());
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

async function readPersistedViews(): Promise<Record<string, true>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

async function writePersistedViews() {
  try {
    const payload: Record<string, true> = {};
    for (const id of viewedIds) payload[id] = true;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

export async function hydrateHomeFeedPostViews(): Promise<void> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const persisted = await readPersistedViews();
    for (const id of Object.keys(persisted)) {
      const clean = cleanPostId(id);
      if (clean) viewedIds.add(clean);
    }
  })();
  return hydratePromise;
}

void hydrateHomeFeedPostViews();

export function isHomeFeedPostViewedSync(postId: string): boolean {
  const id = cleanPostId(postId);
  return id ? viewedIds.has(id) : false;
}

export function markHomeFeedPostViewed(postId: string): void {
  const id = cleanPostId(postId);
  if (!id || viewedIds.has(id)) return;
  viewedIds.add(id);
  notify();
  void writePersistedViews();
}

export function subscribeHomeFeedPostViews(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
