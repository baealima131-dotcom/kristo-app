export type KingdomTarget =
  | "Members"
  | "Pastors"
  | "Leaders"
  | "Ministry Leaders"
  | "Church Admins"
  | "Specific People";

export type KingdomEvent = {
  id: string;
  projectId: string;
  branchId: string;
  title: string;
  countries: string[];
  churches: string[];
  ministries: string[];
  targets: KingdomTarget[];
  startAt: number;
  endAt: number;
  createdAt: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let events: KingdomEvent[] = [];

function emit() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {}
  });
}

export function subscribeKingdomEvents(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listKingdomEvents() {
  return [...events].sort((a, b) => b.createdAt - a.createdAt);
}

export function createKingdomEvent(input: Omit<KingdomEvent, "id" | "createdAt">) {
  const item: KingdomEvent = {
    ...input,
    id: `ke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  events = [item, ...events];
  emit();
  return item;
}

export function clearKingdomEvents() {
  events = [];
  emit();
}

export function getBranchSignal(branchId: string, now = Date.now()) {
  const found = events
    .filter((x) => x.branchId === branchId)
    .sort((a, b) => a.startAt - b.startAt)[0];

  if (!found) {
    return {
      state: "locked" as const,
      title: "",
      startAt: undefined,
      endAt: undefined,
      event: undefined,
    };
  }

  if (now < found.startAt) {
    return {
      state: "soon" as const,
      title: found.title,
      startAt: found.startAt,
      endAt: found.endAt,
      event: found,
    };
  }

  if (now >= found.endAt) {
    return {
      state: "expired" as const,
      title: found.title,
      startAt: found.startAt,
      endAt: found.endAt,
      event: found,
    };
  }

  return {
    state: "live" as const,
    title: found.title,
    startAt: found.startAt,
    endAt: found.endAt,
    event: found,
  };
}
