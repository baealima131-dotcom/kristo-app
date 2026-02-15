export type CounselItem = {
  id: string;
  kind: "counsel";
  title: string;
  body: string;
  createdAt: string;

  saved?: boolean;
  savedAt?: string;
  mine?: boolean;
};

const KEY = "__KRISTO_COUNSEL_STORE__";
const LKEY = "__KRISTO_COUNSEL_STORE_LISTENERS__";

type Listener = () => void;

function getStore(): CounselItem[] {
  const g = globalThis as any;
  if (!g[KEY]) g[KEY] = [] as CounselItem[];
  return g[KEY] as CounselItem[];
}

function getListeners(): Listener[] {
  const g = globalThis as any;
  if (!g[LKEY]) g[LKEY] = [] as Listener[];
  return g[LKEY] as Listener[];
}

function emit() {
  for (const fn of getListeners()) {
    try { fn(); } catch {}
  }
}

export function subscribe(fn: Listener) {
  const arr = getListeners();
  arr.push(fn);
  return () => {
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
}

export function counselList(): CounselItem[] {
  return [...getStore()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function counselAdd(item: CounselItem) {
  getStore().unshift(item);
  emit();
}

export function counselRemove(id: string) {
  const s = getStore();
  const i = s.findIndex((x) => x.id === id);
  if (i >= 0) s.splice(i, 1);
  emit();
}

export function counselToggleSave(id: string) {
  const s = getStore();
  const it = s.find((x) => x.id === id);
  if (!it) return;
  const on = !it.saved;
  it.saved = on;
  it.savedAt = on ? new Date().toISOString() : undefined;
  emit();
}
