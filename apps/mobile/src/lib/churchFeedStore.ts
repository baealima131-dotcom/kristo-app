export type FeedKind = "announcement" | "post" | "testimony" | "counsel";

export type FeedItem = {
  id: string;
  kind: FeedKind;
  title?: string;
  body: string;
  mediaUri?: string;
  createdAt: string; // ISO
  actorLabel?: string; // e.g. "ADMIN"
  churchLabel?: string; // e.g. "TLMC"

  // optional reactions
  liked?: boolean;
  saved?: boolean;
  likeCount?: number;
};

type Listener = () => void;

type FeedStore = {
  items: FeedItem[];
  listeners: Set<Listener>;
};

function getStore(): FeedStore {
  const g = globalThis as any;
  if (!g.__kristoFeed) {
    g.__kristoFeed = {
      items: [] as FeedItem[],
      listeners: new Set<Listener>(),
    } satisfies FeedStore;
  }
  return g.__kristoFeed as FeedStore;
}

function emit() {
  const s = getStore();
  s.listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

/**
 * COMPAT exports (already used by church home screens)
 */
export function feedList() {
  return getStore().items;
}

export function subscribe(fn: Listener) {
  const s = getStore();
  s.listeners.add(fn);
  // IMPORTANT: return void cleanup (not boolean)
  return () => {
    s.listeners.delete(fn);
  };
}

export function feedToggleLike(id: string) {
  const s = getStore();
  s.items = s.items.map((it) => {
    if (it.id !== id) return it;
    const liked = !it.liked;
    const likeCount = Math.max(0, (it.likeCount ?? 0) + (liked ? 1 : -1));
    return { ...it, liked, likeCount };
  });
  emit();
}

export function feedToggleSave(id: string) {
  const s = getStore();
  s.items = s.items.map((it) => (it.id === id ? { ...it, saved: !it.saved } : it));
  emit();
}

/**
 * New helper used by Announcements create-only screen
 */
export function feedAdd(item: FeedItem) {
  const s = getStore();
  s.items = [
    {
      likeCount: 0,
      liked: false,
      saved: false,
      ...item,
    },
    ...s.items,
  ];
  emit();
}
