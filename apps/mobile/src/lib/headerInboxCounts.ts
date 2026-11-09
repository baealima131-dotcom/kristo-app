import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { apiPatch } from "@/src/lib/kristoApi";
import { getSessionSync } from "@/src/lib/kristoSessionSync";
import {
  fetchChurchNotifications,
} from "@/src/lib/churchNotificationsApi";
import {
  fetchProfileCommunicationInboxSnapshot,
  parsePrivateCallIdFromNotification,
} from "@/src/lib/profileCommunicationInbox";

/**
 * Unread messages and missed calls for the Home / Watch header icons. One shared store, counted
 * exactly like the Me tab badge (fetchProfileCommunicationInboxSnapshot), refreshed while a
 * header is mounted: on mount, when the app comes back, and every 30 s.
 */

export type HeaderInboxCounts = { unreadMessages: number; missedCalls: number };

const REFRESH_INTERVAL_MS = 30_000;
const EMPTY: HeaderInboxCounts = { unreadMessages: 0, missedCalls: 0 };

let counts: HeaderInboxCounts = EMPTY;
let inFlight: Promise<void> | null = null;
let mountedHeaders = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
const listeners = new Set<() => void>();

function apiBase() {
  return String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
}

function setCounts(next: HeaderInboxCounts) {
  if (next.unreadMessages === counts.unreadMessages && next.missedCalls === counts.missedCalls) return;
  counts = next;
  listeners.forEach((listener) => listener());
}

export function refreshHeaderInboxCounts(): Promise<void> {
  if (inFlight) return inFlight;
  const base = apiBase();
  if (!base || !getSessionSync()?.sessionToken) {
    setCounts(EMPTY);
    return Promise.resolve();
  }
  inFlight = fetchProfileCommunicationInboxSnapshot({ base })
    .then((snapshot) =>
      setCounts({
        unreadMessages: Math.max(0, Number(snapshot.unreadMessages) || 0),
        missedCalls: Math.max(0, Number(snapshot.missedCalls) || 0),
      })
    )
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Opening the call list counts as seeing the missed calls: their notifications become read. */
export async function markMissedCallsSeen() {
  const base = apiBase();
  if (!base || !getSessionSync()?.sessionToken) return;
  try {
    const result = await fetchChurchNotifications({ base, scope: "forMe", limit: 200, logPrefix: "card" });
    const unreadCallIds = result.items
      .filter((item) => !item.read && parsePrivateCallIdFromNotification(item))
      .map((item) => String(item.id || ""))
      .filter(Boolean);
    await Promise.all(
      unreadCallIds.map((id) =>
        apiPatch(`/api/church/notifications?id=${encodeURIComponent(id)}&scope=forMe`, { isRead: true }).catch(
          () => null
        )
      )
    );
    console.log("KRISTO_MISSED_CALLS_SEEN", { marked: unreadCallIds.length });
  } catch {}
  await refreshHeaderInboxCounts();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return counts;
}

/** Counts for a header; keeps them fresh while at least one header is mounted. */
export function useHeaderInboxCounts(): HeaderInboxCounts {
  useEffect(() => {
    mountedHeaders += 1;
    void refreshHeaderInboxCounts();
    if (mountedHeaders === 1) {
      timer = setInterval(() => void refreshHeaderInboxCounts(), REFRESH_INTERVAL_MS);
      appStateSub = AppState.addEventListener("change", (state) => {
        if (state === "active") void refreshHeaderInboxCounts();
      });
    }
    return () => {
      mountedHeaders -= 1;
      if (mountedHeaders === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        appStateSub?.remove();
        appStateSub = null;
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
