type SafetyLookup = {
  permanentBan: boolean;
  suspension: boolean;
  restriction: boolean;
};

type CacheEntry = {
  expiresAt: number;
  value: SafetyLookup;
};

const TTL_MS = 8_000;
const MAX_ENTRIES = 2_000;

type Gate = {
  memory: Map<string, CacheEntry>;
  inflight: Map<string, Promise<SafetyLookup>>;
};

function gate(): Gate {
  const globalState = globalThis as typeof globalThis & {
    __kristoSafetyEnforcementCache?: Gate;
  };
  if (!globalState.__kristoSafetyEnforcementCache) {
    globalState.__kristoSafetyEnforcementCache = {
      memory: new Map(),
      inflight: new Map(),
    };
  }
  return globalState.__kristoSafetyEnforcementCache;
}

export function readSafetyEnforcementCache(userId: string): SafetyLookup | null {
  const id = String(userId || "").trim();
  if (!id) return null;
  const entry = gate().memory.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    gate().memory.delete(id);
    return null;
  }
  return entry.value;
}

export function writeSafetyEnforcementCache(userId: string, value: SafetyLookup) {
  const id = String(userId || "").trim();
  if (!id) return;
  const store = gate().memory;
  if (store.size >= MAX_ENTRIES) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
  }
  store.set(id, { expiresAt: Date.now() + TTL_MS, value });
}

export function invalidateSafetyEnforcementCache(userId: string) {
  const id = String(userId || "").trim();
  if (!id) return;
  gate().memory.delete(id);
  gate().inflight.delete(id);
}

export async function loadSafetyEnforcementCached(
  userId: string,
  loader: () => Promise<SafetyLookup>
): Promise<{ value: SafetyLookup; cacheHit: boolean; coalesced: boolean }> {
  const cached = readSafetyEnforcementCache(userId);
  if (cached) return { value: cached, cacheHit: true, coalesced: false };

  const id = String(userId || "").trim();
  const inflight = gate().inflight;
  const existing = inflight.get(id);
  if (existing) {
    return { value: await existing, cacheHit: false, coalesced: true };
  }

  const pending = loader().then((value) => {
    writeSafetyEnforcementCache(id, value);
    return value;
  });
  inflight.set(id, pending);
  try {
    return { value: await pending, cacheHit: false, coalesced: false };
  } finally {
    inflight.delete(id);
  }
}
