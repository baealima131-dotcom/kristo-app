import { Image } from "react-native";
import {
  buildHomeFeedDisplayRows,
  homeFeedMediaUrl,
  isVideoPost,
  resolvePosterUri,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";
import { getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "@/src/components/homeFeed/homeFeedRowsCache";
import { feedList } from "@/src/lib/homeFeedStore";
import { markHomeFeedVideoPreloadReady } from "@/src/lib/homeFeedVideoReadiness";
import type { KristoSession } from "@/src/lib/kristoSession";
import { isLoggedOutFlagSet, setSessionSync } from "@/src/lib/kristoSession";
import { isSessionExitInProgress } from "@/src/lib/kristoSessionExit";

/**
 * Consolidated Home Feed video startup/preload (TikTok-style, v1).
 *
 * Two jobs only:
 *  1) Prepare the FIRST playable video before Home Feed opens — warm the exact
 *     single playback URL the player will mount (no quality swapping), so the
 *     active player paints fast.
 *  2) Warm the next 1-3 upcoming URLs at the network layer as a backstop. Real
 *     buffering for visible neighbors is done by HomeFeedVideoPlayer rows
 *     mounted in role="preload" (buffer-only). This is just a head-start for
 *     rows not yet in the mounted window.
 *
 * No low-res previews, no startup/full URL split, no remount-on-upgrade.
 */

/** The single, stable playback URL for an item. */
export function resolveHomeFeedVideoUri(item: any): string {
  const original = resolveVideoUri(item);
  return homeFeedMediaUrl(original) || original;
}

// ~384KB: typically enough to land the moov atom + first GOP so AVPlayer can
// paint quickly once it issues its own range requests against the warmed edge.
const FIRST_VIDEO_RANGE = "bytes=0-393215";
const UPCOMING_RANGE = "bytes=0-65535";
const WARM_TIMEOUT_MS = 8000;
const UPCOMING_MAX = 3;

const warmedUrls = new Set<string>();
const inflightUrls = new Set<string>();

function normalizeUrl(url: string): string {
  return String(url || "").trim().split("?")[0];
}

function isNetworkUrl(url: string): boolean {
  const trimmed = String(url || "").trim();
  return Boolean(trimmed) && /^https?:\/\//i.test(trimmed);
}

export function wasHomeFeedVideoWarmed(url: string): boolean {
  return warmedUrls.has(normalizeUrl(url));
}

async function warmVideoBytes(url: string, rangeHeader: string): Promise<boolean> {
  const normalized = normalizeUrl(url);
  if (warmedUrls.has(normalized)) return true;
  if (!isNetworkUrl(url) || inflightUrls.has(normalized)) return false;

  inflightUrls.add(normalized);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WARM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: rangeHeader },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok || res.status === 206) {
      warmedUrls.add(normalized);
      return true;
    }
  } catch {
    clearTimeout(timer);
  } finally {
    inflightUrls.delete(normalized);
  }
  return false;
}

// ---------------------------------------------------------------------------
// First video — prepared before Home Feed opens.
// ---------------------------------------------------------------------------

export type FirstHomeFeedVideoPrepareResult = {
  rowId: string;
  url: string;
  prewarmHit: boolean;
};

let prepareInflight: Promise<FirstHomeFeedVideoPrepareResult | null> | null = null;
let preparedKey = "";

export function isFirstHomeFeedVideoPrepared(): boolean {
  return Boolean(preparedKey);
}

function buildCachedDisplayRows(): any[] {
  return buildHomeFeedDisplayRows(getCachedHomeFeedBackendRows(), feedList());
}

/**
 * Warm the exact URL the first video player will mount. Idempotent per session;
 * on a cold start the rows cache is still empty, so it stays "unprepared" and is
 * safely retried (e.g. after the feed fetch) instead of locking in a no-op.
 */
export async function prepareFirstHomeFeedVideo(
  session: KristoSession
): Promise<FirstHomeFeedVideoPrepareResult | null> {
  const key = `${session.userId}:${session.churchId || ""}`;
  if (preparedKey === key) return null;
  if (prepareInflight) return prepareInflight;

  console.log("KRISTO_HOME_FIRST_VIDEO_PREPARE_BEFORE_OPEN", {
    userId: session.userId,
    churchId: session.churchId || null,
  });

  const startedAt = Date.now();
  prepareInflight = (async () => {
    if ((await isLoggedOutFlagSet()) || isSessionExitInProgress()) return null;

    try {
      setSessionSync(session);
    } catch {}
    try {
      await hydrateHomeFeedRowsCacheFromStorage(session.userId);
    } catch {}

    const rows = buildCachedDisplayRows();
    const firstVideoRow = rows.find((row) => row && isVideoPost(row));
    if (!firstVideoRow) {
      console.log("KRISTO_HOME_FIRST_VIDEO_PREPARE_READY", {
        ms: Date.now() - startedAt,
        rowId: null,
        url: null,
        prewarmHit: false,
        prepared: false,
        cachedRowCount: rows.length,
      });
      return null;
    }

    const rowId = String(firstVideoRow?.id || "").trim();
    const url = resolveHomeFeedVideoUri(firstVideoRow);

    const posterUri = String(resolvePosterUri(firstVideoRow) || "").trim();
    if (posterUri) Image.prefetch(posterUri).catch(() => {});

    const prewarmHit = await warmVideoBytes(url, FIRST_VIDEO_RANGE);

    // Publish readiness ONLY when bytes actually landed — never lie to the player.
    if (prewarmHit && rowId && url) {
      markHomeFeedVideoPreloadReady(rowId, url);
      preparedKey = key;
    }

    console.log("KRISTO_HOME_FIRST_VIDEO_PREPARE_READY", {
      ms: Date.now() - startedAt,
      rowId: rowId || null,
      url: url || null,
      prewarmHit,
      prepared: prewarmHit,
      cachedRowCount: rows.length,
    });

    return { rowId, url, prewarmHit };
  })().finally(() => {
    prepareInflight = null;
  });

  return prepareInflight;
}

/** Fire-and-forget entry used at session startup. */
export function startFirstHomeFeedVideoPrepare(
  session: KristoSession | null | undefined
): void {
  const userId = String(session?.userId || "").trim();
  const sessionToken = String(session?.sessionToken || "").trim();
  const churchId = String(session?.churchId || "").trim();
  if (!userId || !sessionToken || !churchId) return;
  void prepareFirstHomeFeedVideo(session as KristoSession);
}

// ---------------------------------------------------------------------------
// Upcoming videos — network backstop for rows not yet in the mounted window.
// ---------------------------------------------------------------------------

/** Warm the next up-to-3 video URLs after `fromIndex` (fire-and-forget). */
export function warmHomeFeedUpcoming(
  rows: any[],
  fromIndex: number,
  count = UPCOMING_MAX
): void {
  if (!Array.isArray(rows) || !rows.length) return;
  const start = Math.max(0, fromIndex) + 1;
  const targets: string[] = [];
  for (let i = start; i < rows.length && targets.length < count; i += 1) {
    const row = rows[i];
    if (!row || !isVideoPost(row)) continue;
    const url = resolveHomeFeedVideoUri(row);
    const normalized = normalizeUrl(url);
    if (!isNetworkUrl(url) || warmedUrls.has(normalized) || inflightUrls.has(normalized)) {
      continue;
    }
    targets.push(url);
  }
  if (!targets.length) return;
  console.log("KRISTO_VIDEO_PRELOAD_STARTED", { scope: "network-upcoming", count: targets.length });
  for (const url of targets) {
    void warmVideoBytes(url, UPCOMING_RANGE).then((ok) => {
      if (ok) {
        console.log("KRISTO_VIDEO_PRELOAD_READY", { scope: "network-upcoming", url: normalizeUrl(url) });
      }
    });
  }
}

/** Test/diagnostic reset. */
export function __resetHomeFeedVideoStartupForTest(): void {
  warmedUrls.clear();
  inflightUrls.clear();
  prepareInflight = null;
  preparedKey = "";
}
