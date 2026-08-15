import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

const STORAGE_KEY = "kristo_home_feed_post_views_v1";
const CREDIT_STORAGE_KEY = "kristo_home_feed_qualified_view_credit_v1";
const CREDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const viewedIds = new Set<string>();
const creditedAtByPostId = new Map<string, number>();
const countByPostId = new Map<string, number>();
const inflightPostIds = new Set<string>();
const listeners = new Set<() => void>();

let hydratePromise: Promise<void> | null = null;

function cleanPostId(raw: unknown): string {
  return baseFeedId(String(raw || "").trim());
}

function cleanCount(raw: unknown): number {
  const count = Number(raw || 0);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

async function readJsonRecord(
  key: string
): Promise<Record<string, any>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writePersistedViewedIds() {
  try {
    const payload: Record<string, true> = {};
    for (const id of viewedIds) payload[id] = true;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

async function writePersistedCredits() {
  try {
    const payload: Record<string, number> = {};
    for (const [id, timestamp] of creditedAtByPostId) {
      payload[id] = timestamp;
    }
    await AsyncStorage.setItem(
      CREDIT_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {}
}

export async function hydrateHomeFeedPostViews(): Promise<void> {
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const [persistedViews, persistedCredits] = await Promise.all([
      readJsonRecord(STORAGE_KEY),
      readJsonRecord(CREDIT_STORAGE_KEY),
    ]);

    for (const id of Object.keys(persistedViews)) {
      const clean = cleanPostId(id);
      if (clean) viewedIds.add(clean);
    }

    for (const [id, rawTimestamp] of Object.entries(
      persistedCredits
    )) {
      const clean = cleanPostId(id);
      const timestamp = Number(rawTimestamp || 0);
      if (clean && Number.isFinite(timestamp) && timestamp > 0) {
        creditedAtByPostId.set(clean, timestamp);
      }
    }
  })();

  return hydratePromise;
}

void hydrateHomeFeedPostViews();

export function isHomeFeedPostViewedSync(
  postId: string
): boolean {
  const id = cleanPostId(postId);
  return id ? viewedIds.has(id) : false;
}

/**
 * Legacy seen-marker used by FeedChurchAvatar. This does not increase
 * the public count; qualified counting happens after the dwell timer.
 */
export function markHomeFeedPostViewed(postId: string): void {
  const id = cleanPostId(postId);
  if (!id || viewedIds.has(id)) return;

  viewedIds.add(id);
  notify();
  void writePersistedViewedIds();
}

export function getHomeFeedPostViewCountSync(
  postId: string,
  serverCount = 0
): number {
  const id = cleanPostId(postId);
  const incoming = cleanCount(serverCount);
  if (!id) return incoming;

  const current = countByPostId.get(id) || 0;
  const next = Math.max(current, incoming);

  if (next !== current) countByPostId.set(id, next);
  return next;
}

export function useHomeFeedPostViewCount(
  postId: string,
  serverCount = 0
): number {
  const id = cleanPostId(postId);
  const incoming = cleanCount(serverCount);

  const [count, setCount] = useState(() =>
    getHomeFeedPostViewCountSync(id, incoming)
  );

  useEffect(() => {
    setCount(getHomeFeedPostViewCountSync(id, incoming));

    return subscribeHomeFeedPostViews(() => {
      setCount(getHomeFeedPostViewCountSync(id, incoming));
    });
  }, [id, incoming]);

  return count;
}

export async function recordQualifiedHomeFeedPostView(args: {
  postId: string;
  serverCount?: number;
  dwellMs: number;
  mediaKind: "video" | "image" | "text" | "post";
}): Promise<void> {
  await hydrateHomeFeedPostViews();

  const postId = cleanPostId(args.postId);
  if (!postId || inflightPostIds.has(postId)) return;

  getHomeFeedPostViewCountSync(postId, args.serverCount);

  const previousCreditAt = creditedAtByPostId.get(postId) || 0;
  if (
    previousCreditAt > 0 &&
    Date.now() - previousCreditAt < CREDIT_WINDOW_MS
  ) {
    return;
  }

  const session = getSessionSync() as any;
  const userId = String(session?.userId || "").trim();
  if (!userId) return;

  inflightPostIds.add(postId);

  try {
    const response: any = await apiPost(
      "/api/church/feed",
      {
        action: "record_view",
        postId,
        dwellMs: Math.max(0, Math.floor(args.dwellMs)),
        mediaKind: args.mediaKind,
      },
      {
        headers: getKristoHeaders({
          userId,
          role: (session?.role || "Member") as any,
          churchId: session?.churchId || "",
        }),
      }
    );

    const data = response?.data || response || {};
    const viewCount = cleanCount(data?.viewCount);

    countByPostId.set(
      postId,
      Math.max(
        countByPostId.get(postId) || 0,
        viewCount
      )
    );

    // accepted=false can mean own post or already credited by another
    // device; both should stop repeated requests during this window.
    creditedAtByPostId.set(postId, Date.now());
    markHomeFeedPostViewed(postId);
    notify();
    void writePersistedCredits();

    console.log("KRISTO_HOME_FEED_QUALIFIED_VIEW_SYNC", {
      postId,
      accepted: data?.accepted === true,
      ownPost: data?.ownPost === true,
      viewCount,
      dwellMs: args.dwellMs,
      mediaKind: args.mediaKind,
    });
  } catch (error) {
    console.log("KRISTO_HOME_FEED_QUALIFIED_VIEW_FAILED", {
      postId,
      error: String(
        (error as Error)?.message || error || "unknown"
      ),
    });
  } finally {
    inflightPostIds.delete(postId);
  }
}

export function subscribeHomeFeedPostViews(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
