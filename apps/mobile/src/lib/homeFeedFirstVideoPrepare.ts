import { Image } from "react-native";
import {
  buildHomeFeedDisplayRows,
  isVideoPost,
  resolvePosterUri,
} from "@/src/components/homeFeed/homeFeedUtils";
import { getCachedHomeFeedBackendRows } from "@/src/components/homeFeed/homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "@/src/components/homeFeed/homeFeedRowsCache";
import {
  earlyWarmHomeFeedFirstVideo,
  type HomeFeedEarlyWarmResult,
} from "@/src/lib/homeFeedVideoBufferAhead";
import { feedList } from "@/src/lib/homeFeedStore";
import { markHomeFeedVideoPreloadReady } from "@/src/lib/homeFeedVideoReadiness";
import type { KristoSession } from "@/src/lib/kristoSession";
import { isLoggedOutFlagSet, setSessionSync } from "@/src/lib/kristoSession";
import { isSessionExitInProgress } from "@/src/lib/kristoSessionExit";
import { getPosterPrefetchTimeoutMs, withPreviewTimeout } from "@/src/lib/videoGridThumbnail";

let prepareInflight: Promise<HomeFeedEarlyWarmResult | null> | null = null;
let prepareReady = false;
let lastPrepareKey = "";

export function isHomeFirstVideoPrepareReady() {
  return prepareReady;
}

export function buildCachedHomeFeedDisplayRows() {
  return buildHomeFeedDisplayRows(getCachedHomeFeedBackendRows(), feedList());
}

/** Prime first Home Feed video from cached rows before the feed screen mounts. */
export async function prepareHomeFirstVideoBeforeOpen(
  session: KristoSession
): Promise<HomeFeedEarlyWarmResult | null> {
  const key = `${session.userId}:${session.churchId || ""}`;
  if (prepareReady && lastPrepareKey === key) {
    return null;
  }
  if (prepareInflight) {
    return prepareInflight;
  }

  console.log("KRISTO_HOME_FIRST_VIDEO_PREPARE_BEFORE_OPEN", {
    userId: session.userId,
    churchId: session.churchId || null,
  });

  const startedAt = Date.now();
  prepareInflight = (async () => {
    if (await isLoggedOutFlagSet() || isSessionExitInProgress()) {
      return null;
    }

    try {
      setSessionSync(session);
    } catch {}

    try {
      await hydrateHomeFeedRowsCacheFromStorage(session.userId);
    } catch {}

    const orderedRows = buildCachedHomeFeedDisplayRows();
    const firstVideoRow = orderedRows.find((row) => row && isVideoPost(row));
    const posterUri = firstVideoRow ? String(resolvePosterUri(firstVideoRow) || "").trim() : "";
    if (posterUri) {
      void withPreviewTimeout(
        Image.prefetch(posterUri).then(() => true),
        getPosterPrefetchTimeoutMs(),
        false
      );
    }

    const result = await earlyWarmHomeFeedFirstVideo(orderedRows);
    if (result?.rowId && result.url) {
      markHomeFeedVideoPreloadReady(result.rowId, result.url);
    }

    prepareReady = true;
    lastPrepareKey = key;

    console.log("KRISTO_HOME_FIRST_VIDEO_PREPARE_READY", {
      ms: Date.now() - startedAt,
      rowId: result?.rowId || null,
      url: result?.url || null,
      prewarmHit: result?.prewarmHit ?? false,
      cachedRowCount: orderedRows.length,
    });

    return result;
  })().finally(() => {
    prepareInflight = null;
  });

  return prepareInflight;
}

export function startHomeFirstVideoPrepareBeforeOpen(session: KristoSession | null | undefined) {
  const userId = String(session?.userId || "").trim();
  const sessionToken = String(session?.sessionToken || "").trim();
  const churchId = String(session?.churchId || "").trim();
  if (!userId || !sessionToken || !churchId) return;
  void prepareHomeFirstVideoBeforeOpen(session as KristoSession);
}
