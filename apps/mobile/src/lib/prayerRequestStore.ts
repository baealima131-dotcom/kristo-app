export type PrayerAudience = "private" | "church_team";

export type PrayerRequestItem = {
  id: string;
  title: string;
  body: string;
  audience: PrayerAudience;
  createdAt: string;
  actorLabel?: string;
  churchLabel?: string;
  answered?: boolean;
};

type Listener = () => void;

type PrayerStore = {
  items: PrayerRequestItem[];
  listeners: Set<Listener>;
};

function getStore(): PrayerStore {
  const g = globalThis as any;
  if (!g.__kristoPrayerRequests) {
    g.__kristoPrayerRequests = {
      items: [] as PrayerRequestItem[],
      listeners: new Set<Listener>(),
    } satisfies PrayerStore;
  }
  return g.__kristoPrayerRequests as PrayerStore;
}

function emit() {
  const s = getStore();
  s.listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

export function prayerRequestList() {
  return [...getStore().items];
}

export function prayerRequestGetById(id: string) {
  return getStore().items.find((it) => it.id === id);
}

export function prayerRequestSubscribe(fn: Listener) {
  const s = getStore();
  s.listeners.add(fn);
  return () => {
    s.listeners.delete(fn);
  };
}

export function prayerRequestAdd(
  item: Omit<PrayerRequestItem, "id" | "createdAt">
) {
  const s = getStore();
  const next: PrayerRequestItem = {
    id: `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    answered: false,
    ...item,
  };
  s.items = [next, ...s.items];
  emit();
  return next;
}

export function prayerRequestToggleAnswered(id: string) {
  const s = getStore();
  s.items = s.items.map((it) =>
    it.id === id ? { ...it, answered: !it.answered } : it
  );
  emit();
}

export function prayerRequestRemove(id: string) {
  const s = getStore();
  s.items = s.items.filter((it) => it.id !== id);
  emit();
}
