import { useEffect, useSyncExternalStore } from "react";

import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  normalizePersonRingCategory,
  type PersonRingCategory,
} from "@/src/components/PersonAvatarRing";

/**
 * Verified avatar-ring categories from /api/people/relations, cached for the session and
 * fetched in small batches. Until the server answers (or on any error) a person is "unknown",
 * which shows the neutral ring — never a guessed role.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const BATCH_DELAY_MS = 60;
const BATCH_MAX = 50;

type Entry = { category: PersonRingCategory; at: number; viewerId: string };

const cache = new Map<string, Entry>();
const queued = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function viewerId() {
  return String((getKristoHeaders() as any)?.["x-kristo-user-id"] || "").trim();
}

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function fresh(userId: string): Entry | null {
  const entry = cache.get(userId);
  if (!entry) return null;
  if (entry.viewerId !== viewerId() || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry;
}

async function flush() {
  timer = null;
  const ids = Array.from(queued).slice(0, BATCH_MAX);
  ids.forEach((id) => {
    queued.delete(id);
    inFlight.add(id);
  });
  if (queued.size) schedule();
  if (!ids.length) return;
  const viewer = viewerId();
  try {
    const res: any = await apiGet(
      `/api/people/relations?userIds=${ids.map(encodeURIComponent).join(",")}`,
      { headers: getKristoHeaders() as any },
      { screen: "PersonRelations", throttleMs: 0, dedupe: false } as any
    );
    const data = res?.ok && res?.data && typeof res.data === "object" ? res.data : {};
    const now = Date.now();
    ids.forEach((id) => {
      cache.set(id, { category: normalizePersonRingCategory(data[id]), at: now, viewerId: viewer });
    });
    emit();
  } catch {
    // Leave them unknown (neutral); a later render asks again after the TTL.
  } finally {
    ids.forEach((id) => inFlight.delete(id));
  }
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => void flush(), BATCH_DELAY_MS);
}

function request(userId: string) {
  if (!userId || fresh(userId) || queued.has(userId) || inFlight.has(userId)) return;
  queued.add(userId);
  schedule();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The person's verified ring category ("unknown" until known). */
export function usePersonRingCategory(userId: string | null | undefined): PersonRingCategory {
  const id = String(userId || "").trim();
  useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    if (id) request(id);
  }, [id]);
  return (id && fresh(id)?.category) || "unknown";
}
