export type MinistryLivePayload = {
  id: string;
  name?: string;
  description?: string;
  avatarUri?: string;
  status?: string;
  churchId?: string;
  createdAt?: string;
  updatedAt?: string;
  isLive?: boolean;
  liveHostName?: string;
  liveStartedAt?: string;
};

type Listener = (payload: MinistryLivePayload) => void;

const listeners = new Set<Listener>();
const liveState = new Map<string, MinistryLivePayload>();

export function emitMinistryUpdated(payload: MinistryLivePayload) {
  if (!payload?.id) return;

  const id = String(payload.id);
  const prev = liveState.get(id) || ({ id } as MinistryLivePayload);

  const next: MinistryLivePayload = {
    ...prev,
    ...payload,
    id,
  };

  liveState.set(id, next);

  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {}
  });
}

export function onMinistryUpdated(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMinistryLiveState(id?: string | null) {
  if (!id) return null;
  return liveState.get(String(id)) || null;
}

export function setMinistryLiveState(
  id: string,
  patch: Omit<MinistryLivePayload, "id">
) {
  if (!id) return;
  emitMinistryUpdated({
    id: String(id),
    ...patch,
  });
}
