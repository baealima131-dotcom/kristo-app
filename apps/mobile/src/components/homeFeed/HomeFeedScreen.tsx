import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  InteractionManager,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  feedList,
  feedToggleLike,
  feedToggleSave,
  subscribe as subscribeHomeFeed,
} from "@/src/lib/homeFeedStore";
import { CHURCH_LIVE_CONTROL_ROOM_NAV_PARAMS } from "@/src/lib/churchLiveControlSchedule";
import { FeedList, type FeedListHandle } from "./FeedList";
import { FeedReportSheet } from "./FeedReportSheet";
import { FeedCommentsSheet } from "./FeedCommentsSheet";
import { HomeFeedShareSheet } from "./HomeFeedShareSheet";
import { ShareToChatSheet } from "./ShareToChatSheet";
import { HomeFeedWatchScreen } from "./HomeFeedWatchScreen";
import { HomeFeedTopBar } from "./HomeFeedTopBar";
import { HomeFeedSearchSheet } from "./HomeFeedSearchSheet";
import {
  consumePendingHomeFeedOpenRequest,
  dropStalePendingHomeFeedOpenRequest,
  isPendingHomeFeedOpenRequestFresh,
  peekPendingHomeFeedOpenRequest,
  resolveSharedPostOpenAction,
} from "@/src/lib/homeFeedOpenSharedPost";
import {
  normalizeCommentPostId,
  userHasActiveChurchMembership,
} from "@/src/lib/homeFeedComments";
import {
  beginHomeFirstVideoPriorityMode,
  logFirstPaintReady,
  markHomeMount,
  deferStartupWorkAfterHomeFirstFrame,
} from "@/src/lib/firstPaint";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import {
  bumpHomeFeedFetchGeneration,
  logHomeFeedNetworkTrace,
  resolveHomeFeedRefreshMode,
} from "@/src/lib/homeFeedNetwork";
import { subscribeHomeFeedPostDelete } from "@/src/lib/homeFeedPostDeleteSync";
import {
  buildHomeFeedSharePayload,
  type HomeFeedSharePayload,
} from "@/src/lib/homeFeedShare";
import {
  fetchHomeFeedFromApi,
  fetchHomeFeedNextPage,
  getCachedHomeFeedBackendCount,
  getCachedHomeFeedBackendRows,
  homeFeedRowIncludedInBackendSnapshot,
  syncHomeFeedLike,
} from "./homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "./homeFeedRowsCache";
import {
  HOME_FEED_INITIAL_LIMIT,
  HOME_FEED_PAGE_SIZE,
  buildRecycledHomeFeedRows,
  homeFeedBackendRowsDigest,
  homeFeedLocalRowsDigest,
  homeFeedRowKey,
  initialHomeFeedVisibleWindowSize,
  isHomeFeedNearEnd,
  nextHomeFeedVisibleWindowSize,
  stableMergeHomeFeedRows,
} from "./homeFeedPagination";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  feedRenderKey,
  buildHomeFeedDisplayRows,
  homeFeedScheduleEngagementId,
  homeFeedCommentPostId,
  isHomeFeedScheduleCardRow,
  isImagePost,
  isVideoPost,
  readFeedItemLikedByMe,
  setHomeFeedViewerCanSeeMediaSlots,
  filterHomeFeedRowsByPostKind,
  type HomeFeedPostKindFilter,
} from "./homeFeedUtils";
import {
  hydrateHomeFeedReportedPostIds,
  resolveHomeFeedDiscussionCount,
  resolveHomeFeedLikeState,
  resolveHomeFeedSavedState,
  setHomeFeedDiscussionCountOverride,
  setHomeFeedOptimisticLike,
  setHomeFeedOptimisticSaved,
  setHomeFeedReported,
  syncHomeFeedEngagementFromServerLikes,
} from "@/src/lib/homeFeedEngagement";
import { HOME_FEED_BG, homeFeedSlideHeight, homeFeedTopBarTotalHeight } from "./theme";
import { hydrateHomeFeedVideoDiskCache } from "@/src/lib/homeFeedVideoDiskCache";
import {
  buildWatchUpNextVideos,
  recordWatchSessionVideo,
  reshuffleHomeFeedRowsAfterWatchSelection,
} from "@/src/lib/homeFeedWatchUpNext";
import { subscribeBackgroundMediaJobsPaused, notifyWatchScreenOpened } from "@/src/lib/homeFeedWatchPlaybackPriority";
import {
  getLocallyReportedPostIds,
  markPostReportedLocally,
  syncReportedPostIdsFromApi,
} from "@/src/lib/homeFeedReport";
import { isHomeFeedRenderPaused } from "@/src/lib/liveRoomStartup";
import {
  bumpHomeFeedVideoOwnership,
  consumeHomeFeedVideoRecovery,
  pauseAllHomeFeedVideos,
  peekHomeFeedVideoRecovery,
  recoverHomeFeedPlaybackAfterLiveExit,
} from "@/src/lib/homeFeedVideoOwner";
import { warmHomeFeedUpcoming, startFirstHomeFeedVideoPrepare } from "@/src/lib/homeFeedVideoStartup";
import {
  isHomeFeedInlineVideoAutoplayEnabled,
  isHomeFeedVideoDiskCacheEnabled,
  type HomeFeedVideoOpenPayload,
} from "@/src/lib/homeFeedVideoMode";
import {
  areHomeFeedForwardVideosDiskCached,
  scheduleHomeFeedVideoDiskCacheBackground,
  subscribeHomeFeedVideoDiskCache,
} from "@/src/lib/homeFeedVideoDiskCache";
import {
  beginHomeFeedPrefetchSession,
  endHomeFeedPrefetchSession,
  warmHomeFeedVideoPostersNearActive,
} from "@/src/lib/homeFeedVideoBufferAhead";
import {
  isHomeFeedActiveFirstFrameReady,
  subscribeHomeFeedActiveFirstFrame,
} from "@/src/lib/homeFeedVideoReadiness";
import {
  consumeHomeFeedScheduleDirty,
  peekHomeFeedScheduleDirty,
  subscribeHomeFeedScheduleDirty,
} from "@/src/lib/homeFeedScheduleDirty";
import {
  prewarmHomeFeedPostersOnNearEnd,
  prewarmVisibleHomeFeedVideoPosters,
  resetHomeFeedPosterPrewarmForFeedRefresh,
  startInitialHomeFeedPosterPrewarm,
  VISIBLE_PRIORITY_COUNT,
} from "@/src/lib/homeFeedPosterPrewarm";
import { fetchChurchSubscriptionActiveThrottled } from "@/src/lib/churchResourceRefresh";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export default function HomeFeedScreen() {
  React.useEffect(() => {
    if (!isHomeFeedVideoDiskCacheEnabled()) return;
    let cancelled = false;
    console.log("KRISTO_VIDEO_DISK_CACHE_EARLY_HYDRATE_START");
    hydrateHomeFeedVideoDiskCache()
      .then(() => {
        if (!cancelled) {
          console.log("KRISTO_VIDEO_DISK_CACHE_EARLY_HYDRATE_READY");
        }
      })
      .catch((error) => {
        console.log("KRISTO_VIDEO_DISK_CACHE_EARLY_HYDRATE_FAILED", {
          error: String(error?.message || error || "hydrate-failed"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);


  const router = useRouter();
  const { height: windowHeight } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const topBarHeight = homeFeedTopBarTotalHeight(insets.top);
  const screenFocused = useIsFocused();
  const { focusPostId, focus, openPostId } = useLocalSearchParams<{
    focusPostId?: string;
    focus?: string;
    openPostId?: string;
  }>();

  const hadCacheOnMountRef = useRef(getCachedHomeFeedBackendRows().length > 0);
  const initialRenderSourceLoggedRef = useRef(false);
  const [backendRows, setBackendRows] = useState<any[]>(() => getCachedHomeFeedBackendRows());
  const [localFeedDigest, setLocalFeedDigest] = useState(() => homeFeedLocalRowsDigest(feedList()));
  const [scheduleTick, setScheduleTick] = useState(() => Math.floor(Date.now() / 30_000));
  const localFeedDigestRef = useRef(localFeedDigest);
  const [loading, setLoading] = useState(
    () => !hadCacheOnMountRef.current && feedList().length === 0
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportTargetPostId, setReportTargetPostId] = useState("");
  const [commentsSheetOpen, setCommentsSheetOpen] = useState(false);
  const [commentTargetPostId, setCommentTargetPostId] = useState("");
  const [commentRailCount, setCommentRailCount] = useState(0);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [shareToChatOpen, setShareToChatOpen] = useState(false);
  const [sharePayload, setSharePayload] = useState<HomeFeedSharePayload | null>(null);
  const [shareSourceItem, setShareSourceItem] = useState<any>(null);
  const [successBanner, setSuccessBanner] = useState("");
  const [videoModalPayload, setVideoModalPayload] = useState<HomeFeedVideoOpenPayload | null>(
    null
  );
  const [watchUpNextGeneration, setWatchUpNextGeneration] = useState(0);
  const [relatedVideoItems, setRelatedVideoItems] = useState<any[]>([]);
  const [backgroundMediaPaused, setBackgroundMediaPaused] = useState(false);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [feedPostFilter, setFeedPostFilter] = useState<HomeFeedPostKindFilter | null>(null);

  const focusHandledRef = useRef("");
  const openPostHandledRef = useRef("");
  const pendingScrollRowKeyRef = useRef("");
  const reportablePostIdsDigestRef = useRef("");
  const successBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScheduleFeedIdRef = useRef<string | null>(null);
  const lastNearEndLoadAtMsRef = useRef(0);
  const appendMoreInflightRef = useRef(false);
  const feedNextCursorRef = useRef<string | null>(null);
  const feedHasMoreRef = useRef(true);
  const recycleCycleRef = useRef(0);
  const lastVisibleRowsRef = useRef<any[]>([]);
  const visibleRowCountRef = useRef(0);
  const pageReadyLoggedRef = useRef(false);
  const stableDisplayRowsRef = useRef<any[]>([]);
  const initialVideoBufferWarmedRef = useRef(false);
  const initialWarmCleanupRef = useRef<(() => void) | null>(null);
  const lastVideoBufferActiveRef = useRef(-1);
  const lastVideoBufferWindowRef = useRef(HOME_FEED_INITIAL_LIMIT);
  const prefetchSessionIdRef = useRef(0);
  const lastPosterWarmKeyRef = useRef("");
  const feedListRef = useRef<FeedListHandle>(null);

  const [stableDisplayRows, setStableDisplayRows] = useState<any[]>([]);
  const [visibleWindowSize, setVisibleWindowSize] = useState(HOME_FEED_INITIAL_LIMIT);

  const session = getSessionSync();
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const [viewerCanSeeMediaSlots, setViewerCanSeeMediaSlots] = useState(false);

  const contentHeight = homeFeedSlideHeight(windowHeight, tabBarHeight);
  const feedViewportHeight = Math.max(280, contentHeight - topBarHeight);
  const homeFeedRenderPaused = isHomeFeedRenderPaused();
  const feedFocused = screenFocused && appActive && !homeFeedRenderPaused;

  const bumpLocalFeedIfChanged = useCallback(() => {
    const nextDigest = homeFeedLocalRowsDigest(feedList());
    if (nextDigest === localFeedDigestRef.current) return;
    localFeedDigestRef.current = nextDigest;
    setLocalFeedDigest(nextDigest);
  }, []);

  const applyBackendRowsIfChanged = useCallback((next: any[]) => {
    setBackendRows((prev) => {
      if (!next.length) return prev;
      if (homeFeedBackendRowsDigest(prev) === homeFeedBackendRowsDigest(next)) {
        return prev;
      }
      return next;
    });
  }, []);

  const buildServerLikeMap = useCallback((rows: any[]) => {
    const map: Record<string, { likedByMe: boolean; likeCount: number }> = {};
    for (const row of rows) {
      const postId = homeFeedScheduleEngagementId(row);
      if (!postId) continue;
      map[postId] = {
        likedByMe: readFeedItemLikedByMe(row),
        likeCount: Number(row?.likeCount || 0),
      };
    }
    return map;
  }, []);

  useEffect(() => subscribeBackgroundMediaJobsPaused(setBackgroundMediaPaused), []);
  const inlineVideoAutoplay = isHomeFeedInlineVideoAutoplayEnabled();
  const youtubeLayout = !inlineVideoAutoplay;

  useEffect(() => {
    if (String(focus || "").trim() !== "claim-media-slot") return;
    router.replace({
      pathname: "/(tabs)/more/my-church-room/messages/[id]",
      params: { ...CHURCH_LIVE_CONTROL_ROOM_NAV_PARAMS },
    } as any);
  }, [focus, router]);

  useLayoutEffect(() => {
    markHomeMount();
    if (inlineVideoAutoplay) {
      beginHomeFirstVideoPriorityMode("home-feed-screen");
    }
  }, [inlineVideoAutoplay]);

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!session?.userId || !session?.sessionToken || !session?.churchId) return;
    startFirstHomeFeedVideoPrepare(session as any);
  }, [inlineVideoAutoplay, session?.userId, session?.sessionToken, session?.churchId]);

  useLayoutEffect(() => {
    let alive = true;
    void (async () => {
      const payload = await hydrateHomeFeedRowsCacheFromStorage();
      if (!alive || !payload?.rows?.length) return;

      hadCacheOnMountRef.current = true;
      setBackendRows((prev) => {
        const hydrated = payload.rows;
        if (!hydrated.length) return prev;
        if (!prev.length) return hydrated;
        const hydratedIds = new Set(hydrated.map((row) => homeFeedRowKey(row)).filter(Boolean));
        const filtered = prev.filter((row) => {
          const id = homeFeedRowKey(row);
          return Boolean(id && hydratedIds.has(id));
        });
        return filtered.length ? filtered : hydrated;
      });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!homeFeedRenderPaused) return;
    pauseAllHomeFeedVideos({ reason: "live-room-open" });
  }, [homeFeedRenderPaused]);

  useEffect(() => {
    const unsub = subscribeHomeFeed(() => {
      if (isHomeFeedRenderPaused()) return;
      bumpLocalFeedIfChanged();
    });
    return () => {
      try {
        (unsub as any)?.();
      } catch {}
    };
  }, [bumpLocalFeedIfChanged]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  const loadFeedGenerationRef = useRef(0);

  const loadFeed = useCallback(async (reason = "load", opts?: { force?: boolean }) => {
    if (isHomeFeedRenderPaused()) return;

    const force = opts?.force === true;
    const refreshMode = resolveHomeFeedRefreshMode(reason, force);
    const cachedRows = getCachedHomeFeedBackendRows();
    const loadGeneration = loadFeedGenerationRef.current;

    logHomeFeedNetworkTrace({
      event: "load-feed",
      reason,
      force,
      refreshMode,
      cachedRows: cachedRows.length,
    });

    if (refreshMode === "skip") {
      if (cachedRows.length) {
        setBackendRows((prev) => (prev.length ? prev : cachedRows));
      }
      setLoading(false);
      return;
    }

    const hasVisibleRows =
      visibleRowCountRef.current > 0 ||
      backendRows.length > 0 ||
      cachedRows.length > 0 ||
      feedList().length > 0;
    const showBlockingLoader = refreshMode === "required" && !hasVisibleRows;

    if (showBlockingLoader) {
      setLoading(true);
    } else if (refreshMode === "background" && cachedRows.length) {
      logHomeFeedNetworkTrace({
        event: "swr-background",
        reason,
        cachedRows: cachedRows.length,
      });
      setBackendRows((prev) => (prev.length ? prev : cachedRows));
    }

    try {
      const rows = await fetchHomeFeedFromApi(reason, {
        force,
        reconcile: true,
      });
      if (loadGeneration !== loadFeedGenerationRef.current) {
        logHomeFeedNetworkTrace({ event: "load-feed-stale", reason });
        return;
      }
      if (rows.length) {
        const refreshFeedKey = rows
          .slice(0, 8)
          .map((row) => String(row?.id || "").trim())
          .filter(Boolean)
          .join("|");
        if (refreshFeedKey) {
          resetHomeFeedPosterPrewarmForFeedRefresh(refreshFeedKey);
        }
        applyBackendRowsIfChanged(rows);
        setStableDisplayRows((prev) => {
          const rowIds = new Set(rows.map((row) => homeFeedRowKey(row)).filter(Boolean));
          const next = prev.filter((row) => homeFeedRowIncludedInBackendSnapshot(row, rowIds));
          stableDisplayRowsRef.current = next.length ? next : prev;
          return next.length ? next : prev;
        });
      }
      syncHomeFeedEngagementFromServerLikes(rows, buildServerLikeMap(rows));
    } catch {
      setBackendRows((prev) => prev);
    } finally {
      if (loadGeneration === loadFeedGenerationRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const forceReloadAfterSchedule = useCallback(
    (source: string, backendFeedId?: string | null) => {
      if (backendFeedId) {
        pendingScheduleFeedIdRef.current = String(backendFeedId).trim();
      }
      console.log("KRISTO_HOME_FEED_FORCE_RELOAD_AFTER_SCHEDULE", {
        source,
        backendFeedId: pendingScheduleFeedIdRef.current,
      });
      bumpLocalFeedIfChanged();
      void loadFeed("schedule-dirty", { force: true });
    },
    [bumpLocalFeedIfChanged, loadFeed]
  );

  useEffect(() => {
    const reload = (source: string) => {
      if (String(source || "").includes("post-delete")) {
        void loadFeed("post-delete-sync", { force: true });
        return;
      }
      const dirty = peekHomeFeedScheduleDirty();
      forceReloadAfterSchedule(source, dirty?.backendFeedId || null);
    };
    (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__ = reload;
    return () => {
      if ((globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__ === reload) {
        delete (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__;
      }
    };
  }, [forceReloadAfterSchedule, loadFeed]);

  useEffect(() => {
    return subscribeHomeFeedPostDelete((postId) => {
      const target = String(postId || "").trim();
      if (!target) return;

      const matches = (row: any) => {
        const rowId = String(row?.id || "").trim();
        if (!rowId) return false;
        if (rowId === target) return true;
        return baseFeedId(rowId) === baseFeedId(target);
      };

      setBackendRows((prev) => prev.filter((row) => !matches(row)));
      setStableDisplayRows((prev) => {
        const next = prev.filter((row) => !matches(row));
        stableDisplayRowsRef.current = next;
        return next;
      });
    });
  }, []);

  useEffect(() => {
    const unsub = subscribeHomeFeedScheduleDirty(() => {
      if (isHomeFeedRenderPaused()) return;

      const session = getSessionSync() as any;
      const churchId = String(session?.churchId || "").trim();
      const dirty = peekHomeFeedScheduleDirty(churchId);
      if (dirty?.backendFeedId) {
        pendingScheduleFeedIdRef.current = dirty.backendFeedId;
      }
      bumpLocalFeedIfChanged();

      if (!screenFocused) return;

      const consumed = consumeHomeFeedScheduleDirty(churchId);
      if (consumed) {
        forceReloadAfterSchedule("schedule-dirty-subscribe", consumed.backendFeedId);
      }
    });
    return unsub;
  }, [forceReloadAfterSchedule, screenFocused, bumpLocalFeedIfChanged]);

  useEffect(() => {
    const session = getSessionSync() as any;
    const churchId = String(session?.churchId || "").trim();

    if (screenFocused) {
      loadFeedGenerationRef.current += 1;
      const dirty = consumeHomeFeedScheduleDirty(churchId);
      if (dirty) {
        forceReloadAfterSchedule("schedule-dirty-focus", dirty.backendFeedId);
        return;
      }
      void loadFeed("focus");
      return;
    }

    bumpHomeFeedFetchGeneration("blur");
    loadFeedGenerationRef.current += 1;
  }, [loadFeed, screenFocused, forceReloadAfterSchedule]);

  useEffect(() => {
    if (!feedFocused || videoModalPayload) return;
    const timer = setInterval(() => {
      void loadFeed("poll");
    }, 45000);
    return () => clearInterval(timer);
  }, [feedFocused, loadFeed, videoModalPayload]);

  useEffect(() => {
    if (!feedFocused || homeFeedRenderPaused) return;
    const timer = setInterval(() => {
      setScheduleTick(Math.floor(Date.now() / 30_000));
    }, 30_000);
    return () => clearInterval(timer);
  }, [feedFocused, homeFeedRenderPaused]);

  const localFeedSnapshot = useMemo(() => {
    void localFeedDigest;
    void scheduleTick;
    return feedList();
  }, [localFeedDigest, scheduleTick]);

  useEffect(() => {
    if (!viewerChurchId || !viewerUserId) {
      setHomeFeedViewerCanSeeMediaSlots("", false);
      setViewerCanSeeMediaSlots(false);
      return;
    }

    let cancelled = false;

    const loadSubscription = () => {
      void fetchChurchSubscriptionActiveThrottled(
        viewerChurchId,
        getKristoHeaders({
          userId: viewerUserId,
          role: (session?.role || "Member") as any,
          churchId: viewerChurchId,
        }) as Record<string, string>,
        { userId: viewerUserId }
      ).then((active) => {
        if (cancelled) return;
        const canSee = active === true;
        setHomeFeedViewerCanSeeMediaSlots(viewerChurchId, canSee);
        setViewerCanSeeMediaSlots(canSee);
      });
    };

    deferStartupWorkAfterHomeFirstFrame(loadSubscription, {
      reason: "home-feed-church-subscription",
      delayMs: 600,
    });

    return () => {
      cancelled = true;
    };
  }, [viewerChurchId, viewerUserId, session?.role]);

  const feedRows = useMemo(() => {
    if (homeFeedRenderPaused && backendRows.length) {
      return backendRows;
    }
    return buildHomeFeedDisplayRows(backendRows, localFeedSnapshot);
  }, [backendRows, localFeedSnapshot, homeFeedRenderPaused, viewerCanSeeMediaSlots]);

  const displayFeedRows = feedRows;

  useEffect(() => {
    const incoming = displayFeedRows;
    if (!incoming.length && stableDisplayRowsRef.current.length) return;

    setStableDisplayRows((prev) => {
      const base = prev.length ? prev : stableDisplayRowsRef.current;
      if (!incoming.length) return base;
      if (!base.length) {
        stableDisplayRowsRef.current = incoming;
        return incoming;
      }
      const result = stableMergeHomeFeedRows(base, incoming);
      if (result.appended > 0 || result.before !== result.after) {
        console.log("KRISTO_HOME_FEED_STABLE_MERGE", {
          before: result.before,
          incoming: result.incoming,
          after: result.after,
          appended: result.appended,
        });
      }
      stableDisplayRowsRef.current = result.merged;
      return result.merged;
    });
  }, [displayFeedRows]);

  useEffect(() => {
    if (!stableDisplayRows.length || pageReadyLoggedRef.current) return;
    pageReadyLoggedRef.current = true;
    const visibleCount = initialHomeFeedVisibleWindowSize(stableDisplayRows.length);
    setVisibleWindowSize(visibleCount);
    console.log("KRISTO_HOME_FEED_PAGE_READY", {
      visibleCount,
      totalCached: Math.max(
        stableDisplayRows.length,
        getCachedHomeFeedBackendCount()
      ),
      activeIndex: 0,
      reason: "initial",
    });
    logFirstPaintReady("HomeFeed", { reason: "page-ready", visibleCount });
  }, [stableDisplayRows.length]);

  // Staged endless feed: at ~70% through the visible window, first reveal the
  // next batch of already-loaded rows (cheap, no network), then — only when the
  // window already covers every loaded row — append more from the API. The
  // append is single-flight, throttled, and never deletes existing rows.
  useEffect(() => {
    if (!feedFocused || !stableDisplayRows.length) return;

    const visibleCount = Math.min(visibleWindowSize, stableDisplayRows.length);
    if (!isHomeFeedNearEnd(activeIndex, visibleCount)) return;

    console.log("KRISTO_HOME_FEED_NEAR_END_TRIGGER", {
      activeIndex,
      visibleCount,
      loadedRows: stableDisplayRows.length,
    });

    // STAGED reveal of the next page of already-loaded rows.
    const nextLimit = nextHomeFeedVisibleWindowSize(
      visibleWindowSize,
      stableDisplayRows.length,
      HOME_FEED_PAGE_SIZE
    );
    if (nextLimit > visibleWindowSize) {
      setVisibleWindowSize(nextLimit);
      console.log("KRISTO_HOME_FEED_PAGE_READY", {
        visibleCount: nextLimit,
        totalCached: Math.max(stableDisplayRows.length, getCachedHomeFeedBackendCount()),
        activeIndex,
        reason: "window-expand",
      });
    }

    // Only fetch more when the window already shows every loaded row.
    if (nextLimit < stableDisplayRows.length) {
      logHomeFeedNetworkTrace({
        event: "page-prefetch-skip-api",
        activeIndex,
        nextLimit,
        reason: "client-window-only",
      });
      return;
    }

    if (appendMoreInflightRef.current) {
      logHomeFeedNetworkTrace({
        event: "page-prefetch-skip-api",
        activeIndex,
        reason: "append-more-inflight",
      });
      return;
    }

    const now = Date.now();
    if (now - lastNearEndLoadAtMsRef.current < 10_000) {
      logHomeFeedNetworkTrace({
        event: "page-prefetch-skip-api",
        activeIndex,
        reason: "append-more-throttled",
      });
      return;
    }

    lastNearEndLoadAtMsRef.current = now;
    appendMoreInflightRef.current = true;
    const before = getCachedHomeFeedBackendCount();
    // Ask the backend for rows beyond what we already hold. The cursor advances
    // as pages arrive; on a fresh feed it starts at the current loaded count.
    const cursor = feedNextCursorRef.current ?? String(before);
    console.log("KRISTO_HOME_FEED_APPEND_MORE_START", {
      activeIndex,
      visibleCount,
      before,
      cursor,
    });

    const recycleEndlessFeed = (reason: string) => {
      const tail = stableDisplayRowsRef.current;
      const cycle = recycleCycleRef.current + 1;
      const recycled = buildRecycledHomeFeedRows(tail, cycle, {
        isRecyclable: (row) =>
          !isHomeFeedScheduleCardRow(row) && (isVideoPost(row) || isImagePost(row)),
        avoidLeadingId: String(tail[tail.length - 1]?.id || ""),
      });
      if (!recycled.length) {
        console.log("KRISTO_HOME_FEED_RECYCLE_SKIP", { reason, cycle, recyclable: 0 });
        return 0;
      }
      recycleCycleRef.current = cycle;
      setStableDisplayRows((prev) => {
        const base = prev.length ? prev : stableDisplayRowsRef.current;
        const merged = stableMergeHomeFeedRows(base, recycled);
        stableDisplayRowsRef.current = merged.merged;
        return merged.merged;
      });
      console.log("KRISTO_HOME_FEED_RECYCLE_APPEND", {
        reason,
        cycle,
        appended: recycled.length,
      });
      return recycled.length;
    };

    void fetchHomeFeedNextPage(cursor, HOME_FEED_PAGE_SIZE)
      .then((page) => {
        const after = getCachedHomeFeedBackendCount();
        let appended = page.appended;

        if (appended > 0 && page.rows.length) {
          applyBackendRowsIfChanged(page.rows);
          syncHomeFeedEngagementFromServerLikes(page.rows, buildServerLikeMap(page.rows));
        }

        feedHasMoreRef.current = page.hasMore;
        feedNextCursorRef.current = page.hasMore ? page.nextCursor : null;

        // Backend exhausted (or returned nothing new) → recycle for endless feel.
        if (appended === 0) {
          appended = recycleEndlessFeed(
            page.hasMore ? "no-new-rows" : "backend-exhausted"
          );
        }

        const finalAfter = getCachedHomeFeedBackendCount();
        console.log("KRISTO_HOME_FEED_APPEND_MORE_DONE", {
          activeIndex,
          visibleCount,
          before,
          incoming: page.incoming,
          appended,
          after: finalAfter,
          nextCursor: feedNextCursorRef.current,
          hasMore: page.hasMore,
        });

        if (appended > 0) {
          const loaded = Math.max(finalAfter, stableDisplayRowsRef.current.length);
          setVisibleWindowSize((prev) =>
            Math.min(loaded, nextHomeFeedVisibleWindowSize(prev, loaded, HOME_FEED_PAGE_SIZE))
          );
        }
      })
      .catch(() => {
        // Network failure shouldn't dead-end the feed — recycle so scroll continues.
        const appended = recycleEndlessFeed("page-fetch-error");
        if (appended > 0) {
          const loaded = stableDisplayRowsRef.current.length;
          setVisibleWindowSize((prev) =>
            Math.min(loaded, nextHomeFeedVisibleWindowSize(prev, loaded, HOME_FEED_PAGE_SIZE))
          );
        }
      })
      .finally(() => {
        appendMoreInflightRef.current = false;
      });
  }, [
    activeIndex,
    visibleWindowSize,
    stableDisplayRows.length,
    feedFocused,
  ]);

  const visibleData = useMemo(() => {
    const rowSource =
      stableDisplayRows.length > 0 ? stableDisplayRows : displayFeedRows;
    const windowed = rowSource.slice(0, visibleWindowSize);

    if (windowed.length > 0) {
      lastVisibleRowsRef.current = windowed;
      return windowed;
    }
    return lastVisibleRowsRef.current;
  }, [stableDisplayRows, displayFeedRows, visibleWindowSize]);

  const filteredVisibleData = useMemo(
    () => filterHomeFeedRowsByPostKind(visibleData, feedPostFilter),
    [visibleData, feedPostFilter]
  );

  const feedListRows = filteredVisibleData;
  const feedListRowsRef = useRef(feedListRows);
  const displayFeedRowsRef = useRef(displayFeedRows);
  feedListRowsRef.current = feedListRows;
  displayFeedRowsRef.current = displayFeedRows;

  const feedEmptyCopy = useMemo(() => {
    if (feedPostFilter === "testimony") {
      return {
        title: "No testimonies yet",
        body: "Testimony posts from your churches will appear here.",
      };
    }
    if (feedPostFilter === "announcement") {
      return {
        title: "No announcements yet",
        body: "Announcement posts from your churches will appear here.",
      };
    }
    return {
      title: "Your feed is quiet",
      body: "Posts from your church and community will appear here.",
    };
  }, [feedPostFilter]);

  useEffect(() => {
    visibleRowCountRef.current = visibleData.length;
  }, [visibleData]);

  // YouTube-style poster prewarm: first 20 videos as soon as feed rows exist.
  useEffect(() => {
    if (backgroundMediaPaused || videoModalPayload) return;
    const rows = stableDisplayRows.length ? stableDisplayRows : displayFeedRows;
    if (!rows.length) return;
    startInitialHomeFeedPosterPrewarm(rows);
  }, [stableDisplayRows, displayFeedRows, backgroundMediaPaused, videoModalPayload]);

  // Prewarm the next 10 videos when the user nears the end of loaded content.
  useEffect(() => {
    if (!feedFocused || !stableDisplayRows.length || backgroundMediaPaused || videoModalPayload) {
      return;
    }
    const visibleCount = Math.min(visibleWindowSize, stableDisplayRows.length);
    prewarmHomeFeedPostersOnNearEnd(stableDisplayRows, activeIndex, visibleCount);
  }, [
    feedFocused,
    stableDisplayRows,
    activeIndex,
    visibleWindowSize,
    backgroundMediaPaused,
    videoModalPayload,
  ]);

  // Full-feed disk cache: YouTube tap-to-play + inline autoplay.
  useEffect(() => {
    if (!isHomeFeedVideoDiskCacheEnabled()) return;
    if (!stableDisplayRows.length || backgroundMediaPaused || videoModalPayload) return;
    scheduleHomeFeedVideoDiskCacheBackground(stableDisplayRows, activeIndex);
  }, [
    stableDisplayRows,
    activeIndex,
    backgroundMediaPaused,
    videoModalPayload,
  ]);

  // Cold start: rows may arrive after the prepare gate — re-run prime once feed data exists.
  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!session?.userId || !session?.sessionToken || !session?.churchId) {
      return;
    }
    if (!visibleData.some((row) => isVideoPost(row))) return;
    startFirstHomeFeedVideoPrepare(session as any);
  }, [
    inlineVideoAutoplay,
    visibleData,
    session?.userId,
    session?.sessionToken,
    session?.churchId,
  ]);

  useEffect(() => {
    if (initialRenderSourceLoggedRef.current) return;
    if (loading && visibleData.length === 0) return;

    initialRenderSourceLoggedRef.current = true;
    const source: "cache" | "api" | "empty" =
      visibleData.length > 0
        ? hadCacheOnMountRef.current
          ? "cache"
          : "api"
        : "empty";
    console.log("KRISTO_HOME_FEED_INITIAL_RENDER_SOURCE", { source });
  }, [loading, visibleData.length]);

  const prevFeedFocusedRef = useRef(feedFocused);

  useEffect(() => {
    const wasFocused = prevFeedFocusedRef.current;
    prevFeedFocusedRef.current = feedFocused;

    if (!wasFocused && feedFocused) {
      const activeRow = visibleData[activeIndex];
      console.log("KRISTO_HOME_FEED_RESTORE", {
        activeIndex,
        postId: String(activeRow?.id || "").trim() || null,
        visibleCount: visibleData.length,
        hadCacheOnMount: hadCacheOnMountRef.current,
      });
    }
  }, [feedFocused, activeIndex, visibleData]);

  useEffect(() => {
    if (!feedFocused) {
      endHomeFeedPrefetchSession();
      return;
    }

    prefetchSessionIdRef.current = beginHomeFeedPrefetchSession();
    return () => {
      endHomeFeedPrefetchSession();
    };
  }, [feedFocused]);

  const posterWarmKey = useMemo(() => {
    const end = Math.min(visibleData.length, activeIndex + 6);
    return visibleData
      .slice(Math.max(0, activeIndex), end)
      .map((row) => feedRenderKey(row) || String(row?.id || ""))
      .join("|");
  }, [visibleData, activeIndex]);

  // Visible-window poster priority — all on-screen rows, rechecked every 500ms.
  useEffect(() => {
    if (backgroundMediaPaused || videoModalPayload) return;
    if (!visibleData.length) return;
    if (!feedFocused) return;
    const windowCount = Math.min(
      VISIBLE_PRIORITY_COUNT,
      Math.max(1, visibleData.length - Math.max(0, activeIndex))
    );
    prewarmVisibleHomeFeedVideoPosters(visibleData, activeIndex, windowCount);
  }, [
    visibleData,
    activeIndex,
    posterWarmKey,
    backgroundMediaPaused,
    videoModalPayload,
    feedFocused,
  ]);

  useEffect(() => {
    if (!feedFocused || !visibleData.length || backgroundMediaPaused || videoModalPayload) return;

    const tryPosterWarm = () => {
      if (backgroundMediaPaused || videoModalPayload) return;
      if (inlineVideoAutoplay) {
        if (!isHomeFeedActiveFirstFrameReady()) return;
        if (!areHomeFeedForwardVideosDiskCached(visibleData, activeIndex)) return;
      }
      if (posterWarmKey === lastPosterWarmKeyRef.current) return;
      lastPosterWarmKeyRef.current = posterWarmKey;
      warmHomeFeedVideoPostersNearActive(
        visibleData,
        activeIndex,
        prefetchSessionIdRef.current
      );
    };

    tryPosterWarm();
    const unsubFrame = inlineVideoAutoplay
      ? subscribeHomeFeedActiveFirstFrame(tryPosterWarm)
      : () => {};
    const unsubCache = inlineVideoAutoplay
      ? subscribeHomeFeedVideoDiskCache(tryPosterWarm)
      : () => {};
    return () => {
      unsubFrame();
      unsubCache();
    };
  }, [posterWarmKey, activeIndex, feedFocused, visibleData, backgroundMediaPaused, videoModalPayload]);

  // Initial buffer-ahead is deferred until the FIRST video's first frame paints
  // (or a short fallback). This guarantees the first video keeps full startup
  // priority and we only warm the next 2–3 rows once it is playing. The pending
  // subscription is tracked in a ref so feed re-renders never cancel it.
  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!feedFocused || !visibleData.length || backgroundMediaPaused || videoModalPayload) return;
    if (initialVideoBufferWarmedRef.current) return;
    initialVideoBufferWarmedRef.current = true;

    const runInitialWarm = () => {
      const rows = lastVisibleRowsRef.current;
      if (!rows.length) return;
      warmHomeFeedUpcoming(rows, 0);
    };

    if (isHomeFeedActiveFirstFrameReady()) {
      runInitialWarm();
      return;
    }

    const cancel = () => {
      try {
        initialWarmCleanupRef.current?.();
      } catch {}
      initialWarmCleanupRef.current = null;
    };
    const fire = () => {
      cancel();
      runInitialWarm();
    };
    const unsubscribe = subscribeHomeFeedActiveFirstFrame(fire);
    const fallbackTimer = setTimeout(fire, 1500);
    initialWarmCleanupRef.current = () => {
      try {
        unsubscribe();
      } catch {}
      clearTimeout(fallbackTimer);
    };
  }, [
    inlineVideoAutoplay,
    feedFocused,
    visibleData.length,
    backgroundMediaPaused,
    videoModalPayload,
  ]);

  useEffect(() => {
    return () => {
      try {
        initialWarmCleanupRef.current?.();
      } catch {}
      initialWarmCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!feedFocused || !visibleData.length || backgroundMediaPaused || videoModalPayload) return;
    if (lastVideoBufferActiveRef.current === activeIndex) return;
    lastVideoBufferActiveRef.current = activeIndex;
    warmHomeFeedUpcoming(visibleData, activeIndex);
  }, [
    inlineVideoAutoplay,
    activeIndex,
    feedFocused,
    visibleData.length,
    backgroundMediaPaused,
    videoModalPayload,
  ]);

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!feedFocused || !visibleData.length || backgroundMediaPaused || videoModalPayload) return;
    const prevWindow = lastVideoBufferWindowRef.current;
    if (visibleWindowSize <= prevWindow) {
      lastVideoBufferWindowRef.current = visibleWindowSize;
      return;
    }
    lastVideoBufferWindowRef.current = visibleWindowSize;
    warmHomeFeedUpcoming(visibleData, activeIndex);
  }, [
    inlineVideoAutoplay,
    visibleWindowSize,
    activeIndex,
    feedFocused,
    visibleData.length,
    backgroundMediaPaused,
    videoModalPayload,
  ]);

  const handleVideoPress = useCallback(
    (payload: HomeFeedVideoOpenPayload) => {
      const postId = String(payload.postId || "").trim();
      console.log("KRISTO_WATCH_OPEN_TAP", { postId, at: Date.now() });
      notifyWatchScreenOpened(postId);

      const generation = recordWatchSessionVideo(payload.postId);
      setWatchUpNextGeneration(generation);
      setVideoModalPayload(payload);

      InteractionManager.runAfterInteractions(() => {
        setStableDisplayRows((prev) => {
          const base = prev.length ? prev : stableDisplayRowsRef.current;
          const next = reshuffleHomeFeedRowsAfterWatchSelection({
            rows: base,
            currentItem: payload.item,
            viewerChurchId,
            generationSeed: generation,
          });
          stableDisplayRowsRef.current = next;
          return next;
        });
      });
    },
    [viewerChurchId]
  );

  const handleCloseVideo = useCallback(() => {
    setVideoModalPayload(null);
    setRelatedVideoItems([]);
  }, []);

  useEffect(() => {
    if (!videoModalPayload?.postId || !videoModalPayload?.item) {
      setRelatedVideoItems([]);
      return;
    }

    const payload = videoModalPayload;
    const generation = watchUpNextGeneration;
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      const timeout = setTimeout(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          const sourceRows =
            feedListRowsRef.current.length > 0
              ? feedListRowsRef.current
              : stableDisplayRowsRef.current.length > 0
                ? stableDisplayRowsRef.current
                : displayFeedRowsRef.current;
          const items = buildWatchUpNextVideos({
            currentItem: payload.item,
            candidates: sourceRows,
            viewerChurchId,
            limit: 20,
            generationSeed: generation,
          });
          console.log("KRISTO_WATCH_UP_NEXT_DEFERRED", {
            postId: String(payload.postId || "").trim(),
            count: items.length,
            at: Date.now(),
          });
          setRelatedVideoItems(items);
        });
      }, 900);

      return () => clearTimeout(timeout);
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [
    videoModalPayload?.postId,
    videoModalPayload?.item,
    viewerChurchId,
    watchUpNextGeneration,
  ]);

  const watchEngagementItem = videoModalPayload?.item ?? null;

  const scrollFeedToRow = useCallback((row: any) => {
    const rowKey = feedRenderKey(row) || String(row?.id || "").trim();
    if (!rowKey) return;
    pendingScrollRowKeyRef.current = rowKey;
    setFeedPostFilter(null);
    setSearchSheetOpen(false);
  }, []);

  useEffect(() => {
    const rowKey = pendingScrollRowKeyRef.current;
    if (!rowKey) return;
    const index = feedListRows.findIndex(
      (row) => (feedRenderKey(row) || String(row?.id || "").trim()) === rowKey
    );
    if (index < 0) return;
    pendingScrollRowKeyRef.current = "";
    setActiveIndex(index);
    feedListRef.current?.scrollToIndex(index, true);
  }, [feedListRows, feedPostFilter]);

  const handleTestimoniesPress = useCallback(() => {
    setFeedPostFilter((prev) => (prev === "testimony" ? null : "testimony"));
    setActiveIndex(0);
    feedListRef.current?.scrollToIndex(0, false);
  }, []);

  const handleAnnouncementsPress = useCallback(() => {
    setFeedPostFilter((prev) => (prev === "announcement" ? null : "announcement"));
    setActiveIndex(0);
    feedListRef.current?.scrollToIndex(0, false);
  }, []);

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!feedFocused) return;

    const recoveryReason = peekHomeFeedVideoRecovery();
    if (!recoveryReason) return;

    console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_AFTER_LIVE", {
      reason: recoveryReason,
      activeIndex,
      feedCount: visibleData.length,
    });

    const activeItem = visibleData[activeIndex];
    const postId = String(activeItem?.id || "").trim();

    if (!postId || !isVideoPost(activeItem)) {
      console.log("KRISTO_HOME_FEED_VIDEO_RECOVERY_SKIPPED", {
        reason: recoveryReason,
        why: !postId ? "no-active-post" : "not-video-post",
        activeIndex,
      });
      consumeHomeFeedVideoRecovery();
      return;
    }

    bumpHomeFeedVideoOwnership(postId);
    const recovered = recoverHomeFeedPlaybackAfterLiveExit({
      postId,
      shouldPlay: true,
      videoReady: true,
      reason: recoveryReason,
      activeFeedIndex: activeIndex,
      feedIndex: activeIndex,
      activeFeedItemId: postId,
      screenFocused: true,
      appState: "active",
      isStrictVideoPost: true,
    });

    if (recovered) {
      consumeHomeFeedVideoRecovery();
    }
  }, [inlineVideoAutoplay, feedFocused, activeIndex, visibleData]);

  useEffect(() => {
    let alive = true;

    void getLocallyReportedPostIds().then((ids) => {
      if (!alive || !ids.length) return;
      hydrateHomeFeedReportedPostIds(ids);
    });

    return () => {
      alive = false;
    };
  }, []);

  const reportablePostIdsDigest = useMemo(() => {
    return feedRows
      .filter((item) => isVideoPost(item) || isImagePost(item))
      .map((item) => baseFeedId(String(item?.id || "")))
      .filter(Boolean)
      .sort()
      .join("|");
  }, [feedRows]);

  useEffect(() => {
    if (!reportablePostIdsDigest) return;
    if (reportablePostIdsDigest === reportablePostIdsDigestRef.current) return;
    reportablePostIdsDigestRef.current = reportablePostIdsDigest;

    const ids = reportablePostIdsDigest.split("|").filter(Boolean);
    if (!ids.length) return;

    let alive = true;

    deferStartupWorkAfterHomeFirstFrame(
      () => {
        void syncReportedPostIdsFromApi(ids).then((reported) => {
          if (!alive || !reported.length) return;
          hydrateHomeFeedReportedPostIds(reported);
        });
      },
      { reason: "home-feed-report-sync", delayMs: 800 }
    );

    return () => {
      alive = false;
    };
  }, [reportablePostIdsDigest]);

  useEffect(() => {
    return () => {
      if (successBannerTimerRef.current) {
        clearTimeout(successBannerTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const rawFocusId = String(focusPostId || "").trim();
    if (!rawFocusId || !visibleData.length) return;
    if (focusHandledRef.current === rawFocusId) return;

    const matchIndex = visibleData.findIndex((item) => String(item?.id || "") === rawFocusId);
    if (matchIndex < 0) return;

    focusHandledRef.current = rawFocusId;
    setActiveIndex(matchIndex);
    feedListRef.current?.scrollToIndex(matchIndex, false);
  }, [focusPostId, visibleData]);

  const tryOpenSharedPost = useCallback(() => {
    dropStalePendingHomeFeedOpenRequest();

    const routePostId = normalizeCommentPostId(String(openPostId || "").trim());
    const pending = peekPendingHomeFeedOpenRequest();
    const hasRouteIntent = Boolean(routePostId);
    const hasFreshQueueIntent = isPendingHomeFeedOpenRequestFresh(pending);

    if (!hasRouteIntent && !hasFreshQueueIntent) return;

    const rawId = normalizeCommentPostId(
      String(routePostId || pending?.postId || "").trim()
    );
    if (!rawId) return;
    if (openPostHandledRef.current === rawId) return;

    const shared = pending?.sharedContent || {
      type: "post" as const,
      postId: rawId,
    };
    const action = resolveSharedPostOpenAction(shared, visibleData);

    if (action.mode === "watch" && action.payload) {
      openPostHandledRef.current = rawId;
      consumePendingHomeFeedOpenRequest();
      handleVideoPress(action.payload);
      console.log("KRISTO_SHARED_POST_OPEN_WATCH", { postId: rawId });
      return;
    }

    if (action.mode === "scroll" && action.item) {
      openPostHandledRef.current = rawId;
      consumePendingHomeFeedOpenRequest();
      scrollFeedToRow(action.item);
      console.log("KRISTO_SHARED_POST_OPEN_SCROLL", { postId: rawId });
      return;
    }

    const matchIndex = visibleData.findIndex(
      (row) => normalizeCommentPostId(String(row?.id || "")) === rawId
    );
    if (matchIndex >= 0) {
      openPostHandledRef.current = rawId;
      consumePendingHomeFeedOpenRequest();
      setActiveIndex(matchIndex);
      feedListRef.current?.scrollToIndex(matchIndex, false);
      console.log("KRISTO_SHARED_POST_OPEN_SCROLL_LATE", { postId: rawId });
    }
  }, [openPostId, visibleData, handleVideoPress, scrollFeedToRow]);

  useEffect(() => {
    if (!screenFocused) return;
    tryOpenSharedPost();
  }, [screenFocused, openPostId, visibleData, tryOpenSharedPost]);

  useEffect(() => {
    if (activeIndex >= visibleData.length && visibleData.length > 0) {
      const next = Math.max(0, visibleData.length - 1);
      setActiveIndex(next);
      feedListRef.current?.scrollToIndex(next, false);
    }
  }, [activeIndex, visibleData.length]);

  const handleLike = useCallback((item: any) => {
    const postId = homeFeedScheduleEngagementId(item);
    if (!postId) return;

    const current = resolveHomeFeedLikeState(item, postId);
    const nextLikedByMe = !current.likedByMe;
    const nextCount = Math.max(0, current.likeCount + (nextLikedByMe ? 1 : -1));

    if (isKristoVerboseFeedDebug()) {
      console.log("KRISTO_LIKE_UI_STATE", {
        postId,
        finalLikedByMe: nextLikedByMe,
        likeCount: nextCount,
      });
    }

    setHomeFeedOptimisticLike(postId, {
      likedByMe: nextLikedByMe,
      liked: nextLikedByMe,
      likeCount: nextCount,
    });
    feedToggleLike(postId);
    syncHomeFeedLike(postId, nextLikedByMe);
  }, []);

  const handleSave = useCallback((item: any) => {
    const postId = String(item?.id || "").trim();
    if (!postId) return;

    const nextSaved = !resolveHomeFeedSavedState(item, postId);
    setHomeFeedOptimisticSaved(postId, nextSaved);
    feedToggleSave(postId);
  }, []);

  const handleComment = useCallback((item: any) => {
    const postId = homeFeedCommentPostId(item);
    if (!postId) return;

    const session = getSessionSync();
    if (!userHasActiveChurchMembership(session)) {
      Alert.alert("Join a church", "Join a church to comment on posts.");
      return;
    }

    setCommentTargetPostId(postId);
    setCommentRailCount(resolveHomeFeedDiscussionCount(item, postId));
    setCommentsSheetOpen(true);
  }, []);

  const handleWatchComment = useCallback(() => {
    if (!watchEngagementItem) return;
    handleComment(watchEngagementItem);
  }, [watchEngagementItem, handleComment]);

  useEffect(() => {
    console.log("KRISTO_COMMENT_OPEN_STATE", {
      commentsSheetOpen,
      commentTargetPostId,
      watchOpen: Boolean(videoModalPayload),
    });
  }, [commentsSheetOpen, commentTargetPostId, videoModalPayload]);

  const handleDiscussionCountChange = useCallback((postId: string, count: number) => {
    const cleanId = normalizeCommentPostId(postId);
    if (!cleanId || !Number.isFinite(count)) return;
    const nextCount = Math.max(0, count);
    console.log("KRISTO_COMMENT_COUNT_OVERRIDE_SET", {
      postId: cleanId,
      count: nextCount,
      source: "comments_confirmed",
    });
    setHomeFeedDiscussionCountOverride(cleanId, nextCount);
  }, []);

  const handleDiscussionCountBump = useCallback(
    (postId: string, delta: number) => {
      const cleanId = normalizeCommentPostId(postId);
      if (!cleanId || !Number.isFinite(delta) || delta === 0) return;

      const item = feedRows.find((row) => homeFeedCommentPostId(row) === cleanId);
      const current = resolveHomeFeedDiscussionCount(item || {}, cleanId);
      const nextCount = Math.max(0, current + delta);
      console.log("KRISTO_COMMENT_COUNT_OVERRIDE_SET", {
        postId: cleanId,
        count: nextCount,
        source: delta > 0 ? "optimistic_bump" : "optimistic_rollback",
        delta,
      });
      setHomeFeedDiscussionCountOverride(cleanId, nextCount);
    },
    [feedRows]
  );

  const handleShare = useCallback((item: any) => {
    const payload = buildHomeFeedSharePayload(item);
    if (!payload) return;
    setShareSourceItem(item);
    setSharePayload(payload);
    setShareSheetOpen(true);
  }, []);

  useEffect(() => {
    console.log("KRISTO_SHARE_OPEN_STATE", {
      shareSheetOpen,
      postId: sharePayload?.postId || "",
      shareUrl: sharePayload?.shareUrl || "",
      watchOpen: Boolean(videoModalPayload),
    });
  }, [shareSheetOpen, sharePayload, videoModalPayload]);

  const handleReport = useCallback((item: any) => {
    const postId = normalizeCommentPostId(String(item?.id || "").trim());
    if (!postId) return;
    setReportTargetPostId(postId);
    setReportSheetOpen(true);
  }, []);

  useEffect(() => {
    console.log("KRISTO_REPORT_OPEN_STATE", {
      reportSheetOpen,
      reportTargetPostId,
      watchOpen: Boolean(videoModalPayload),
    });
  }, [reportSheetOpen, reportTargetPostId, videoModalPayload]);

  const handleReported = useCallback((postId: string) => {
    const cleanId = baseFeedId(postId);
    if (!cleanId) return;

    void markPostReportedLocally(cleanId);
    setHomeFeedReported(cleanId);
    setSuccessBanner("Report submitted. Thank you for helping keep Kristo safe.");

    if (successBannerTimerRef.current) {
      clearTimeout(successBannerTimerRef.current);
    }
    successBannerTimerRef.current = setTimeout(() => {
      setSuccessBanner("");
    }, 3200);
  }, []);

  return (
    <View style={[styles.screen, youtubeLayout ? styles.screenYoutube : { height: contentHeight }]}>
      <HomeFeedTopBar
        activeFilter={feedPostFilter}
        onSearchPress={() => setSearchSheetOpen(true)}
        onTestimoniesPress={handleTestimoniesPress}
        onAnnouncementsPress={handleAnnouncementsPress}
      />

      {successBanner ? (
        <View style={[styles.successBanner, { top: topBarHeight + 12 }]} pointerEvents="none">
          <Text style={styles.successBannerText}>{successBanner}</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.feedBody,
          youtubeLayout ? styles.feedBodyYoutube : { height: feedViewportHeight },
        ]}
      >
        <FeedList
          ref={feedListRef}
          rows={feedListRows}
          contentHeight={feedViewportHeight}
          activeIndex={activeIndex}
          screenFocused={feedFocused}
          loading={loading}
          onActiveIndexChange={setActiveIndex}
          onLike={handleLike}
          onComment={handleComment}
          onShare={handleShare}
          onSave={handleSave}
          onReport={handleReport}
          onVideoPress={handleVideoPress}
          emptyTitle={feedEmptyCopy.title}
          emptyBody={feedEmptyCopy.body}
        />
      </View>

      <HomeFeedWatchScreen
        visible={Boolean(videoModalPayload)}
        payload={videoModalPayload}
        relatedItems={relatedVideoItems}
        onClose={handleCloseVideo}
        onSelectRelated={handleVideoPress}
        onLike={() => {
          if (watchEngagementItem) handleLike(watchEngagementItem);
        }}
        onComment={handleWatchComment}
        onShare={() => {
          if (watchEngagementItem) void handleShare(watchEngagementItem);
        }}
        onSave={() => {
          if (watchEngagementItem) handleSave(watchEngagementItem);
        }}
        onReport={() => {
          if (watchEngagementItem) handleReport(watchEngagementItem);
        }}
        onItemLike={handleLike}
        onItemComment={handleComment}
        onItemShare={(item) => void handleShare(item)}
        onItemSave={handleSave}
        onItemReport={handleReport}
        commentsSheetOpen={commentsSheetOpen}
        commentTargetPostId={commentTargetPostId}
        commentRailCount={commentRailCount}
        onCloseComments={() => setCommentsSheetOpen(false)}
        onDiscussionCountChange={handleDiscussionCountChange}
        onDiscussionCountBump={handleDiscussionCountBump}
        reportSheetOpen={reportSheetOpen}
        reportTargetPostId={reportTargetPostId}
        onCloseReport={() => setReportSheetOpen(false)}
        onReported={handleReported}
        shareSheetOpen={shareSheetOpen}
        sharePayload={sharePayload}
        onCloseShare={() => setShareSheetOpen(false)}
        onOpenShareToChat={() => setShareToChatOpen(true)}
        shareToChatOpen={shareToChatOpen}
        shareSourceItem={shareSourceItem}
        onCloseShareToChat={() => setShareToChatOpen(false)}
      />

      <HomeFeedSearchSheet
        visible={searchSheetOpen}
        rows={stableDisplayRows.length ? stableDisplayRows : displayFeedRows}
        onClose={() => setSearchSheetOpen(false)}
        onSelectRow={scrollFeedToRow}
      />

      {!videoModalPayload ? (
        <HomeFeedShareSheet
          visible={shareSheetOpen}
          payload={sharePayload}
          onClose={() => setShareSheetOpen(false)}
          onOpenShareToChat={() => setShareToChatOpen(true)}
        />
      ) : null}

      {!videoModalPayload ? (
        <ShareToChatSheet
          visible={shareToChatOpen}
          payload={sharePayload}
          sourceItem={shareSourceItem}
          onClose={() => setShareToChatOpen(false)}
        />
      ) : null}

      {!videoModalPayload ? (
        <FeedReportSheet
          visible={reportSheetOpen}
          postId={reportTargetPostId}
          onClose={() => setReportSheetOpen(false)}
          onReported={handleReported}
        />
      ) : null}

      {!videoModalPayload ? (
        <FeedCommentsSheet
          visible={commentsSheetOpen}
          postId={commentTargetPostId}
          railDiscussionCount={commentRailCount}
          onClose={() => setCommentsSheetOpen(false)}
          onDiscussionCountChange={handleDiscussionCountChange}
          onDiscussionCountBump={handleDiscussionCountBump}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignSelf: "stretch",
    backgroundColor: HOME_FEED_BG,
    overflow: "hidden",
  },
  screenYoutube: {
    flex: 1,
    height: undefined,
  },
  feedBody: {
    flex: 1,
    minHeight: 0,
    backgroundColor: HOME_FEED_BG,
  },
  feedBodyYoutube: {
    flex: 1,
  },
  successBanner: {
    position: "absolute",
    top: 12,
    left: 14,
    right: 14,
    zIndex: 40,
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  successBannerText: {
    color: "#F4D06F",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
});
