export type FeedKind = "video" | "text";

export type FeedItem = {
  id: string;
  kind: FeedKind;

  // UI content
  title: string;
  description?: string;

  // optional media
  videoUrl?: string;

  // counts (new)
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saveCount: number;
};

type Listener = () => void;

const store: {
  items: FeedItem[];
  listeners: Set<Listener>;
} = {
  items: [
    {
      id: "f-1",
      kind: "text",
      title: "Ujumbe mfupi",
      description: "Usikate tamaa. Kristo App inajengwa kwa hatua, lakini matunda ni makubwa.",
      likeCount: 1240,
      commentCount: 86,
      shareCount: 12,
      saveCount: 203,
    },
    {
      id: "f-2",
      kind: "text",
      title: "Ushindi",
      description: "Leo ni hatua ndogo, kesho ni ushindi mkubwa.",
      likeCount: 987,
      commentCount: 41,
      shareCount: 6,
      saveCount: 58,
    },
    {
      id: "f-3",
      kind: "text",
      title: "Imani",
      description: "Imani ni mwanzo wa kila jambo. Endelea mbele.",
      likeCount: 12_540,
      commentCount: 1_020,
      shareCount: 220,
      saveCount: 1_340,
    },
  ],
  listeners: new Set(),
};

export function feedGetAll() {
  return store.items;
}

export function feedSubscribe(fn: Listener) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

export function feedPatch(id: string, patch: Partial<FeedItem>) {
  const idx = store.items.findIndex((x) => x.id === id);
  if (idx < 0) return;
  store.items[idx] = { ...store.items[idx], ...patch };
  for (const l of store.listeners) l();
}
