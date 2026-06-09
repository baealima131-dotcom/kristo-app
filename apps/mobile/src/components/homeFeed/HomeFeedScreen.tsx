import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import {
  feedList,
  feedToggleLike,
  feedToggleSave,
  subscribe as subscribeHomeFeed,
} from "@/src/lib/homeFeedStore";
import { FeedList } from "./FeedList";
import { FeedReportSheet } from "./FeedReportSheet";
import { FeedCommentsSheet } from "./FeedCommentsSheet";
import {
  normalizeCommentPostId,
  userHasActiveChurchMembership,
} from "@/src/lib/homeFeedComments";
import {
  beginHomeFirstVideoPriorityMode,
  markHomeFirstFrame,
  markHomeMount,
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
  fetchHomeFeedFromApi,
  fetchHomeFeedNextPage,
  getCachedHomeFeedBackendCount,
  getCachedHomeFeedBackendRows,
  homeFeedRowIncludedInBackendSnapshot,
  logMediaSlotHomeFeedVisibility,
  syncHomeFeedLike,
} from "./homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "./homeFeedRowsCache";
import {
  HOME_FEED_INITIAL_LIMIT,
  HOME_FEED_PAGE_SIZE,
  buildRecycledHomeFeedRows,
  homeFeedRowKey,
  initialHomeFeedVisibleWindowSize,
  isHomeFeedNearEnd,
  nextHomeFeedVisibleWindowSize,
  stableMergeHomeFeedRows,
} from "./homeFeedPagination";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  feedRenderKey,
  hydrateFeedRowLikes,
  buildHomeFeedDisplayRows,
  filterHomeFeedClaimableSlotRows,
  homeFeedRowChurchId,
  homeFeedScheduleEngagementId,
  homeFeedCommentPostId,
  isHomeFeedActiveOrNearLiveChurchScheduleVisible,
  isHomeFeedScheduleCardRow,
  isImagePost,
  isVideoPost,
  readFeedItemLikedByMe,
} from "./homeFeedUtils";
import { HOME_FEED_BG, homeFeedSlideHeight } from "./theme";
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
import { warmHomeFeedUpcoming } from "@/src/lib/homeFeedVideoStartup";
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
import { onSlotClaimChanged } from "@/src/lib/slotClaimEvents";
import { pollRemoteSlotClaimUpdates } from "@/src/lib/slotClaimApply";
import {
  SLOT_CLAIM_POLL_FALLBACK_MS,
  SLOT_CLAIM_POLL_LIVE_MS,
} from "@/src/lib/slotClaimSync";
const CLAIM_SLOT_EMPTY_MESSAGE =
  "No open media slots right now. Check back when your church posts a live schedule.";

export default function HomeFeedScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const screenFocused = useIsFocused();
  const { focusPostId, focus, churchId: focusChurchIdParam, source: focusSource } =
    useLocalSearchParams<{
      focusPostId?: string;
      focus?: string;
      churchId?: string;
      source?: string;
    }>();

  const hadCacheOnMountRef = useRef(getCachedHomeFeedBackendRows().length > 0);
  const initialRenderSourceLoggedRef = useRef(false);
  const [backendRows, setBackendRows] = useState<any[]>(() => getCachedHomeFeedBackendRows());
  const [localTick, setLocalTick] = useState(0);
  const [loading, setLoading] = useState(
    () => !hadCacheOnMountRef.current && feedList().length === 0
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [optimisticLikes, setOptimisticLikes] = useState<
    Record<string, { likedByMe: boolean; likeCount: number }>
  >({});
  const [likeUiEpoch, setLikeUiEpoch] = useState(0);
  const [optimisticSaved, setOptimisticSaved] = useState<Record<string, boolean>>({});
  const [reportedPostIds, setReportedPostIds] = useState<Record<string, true>>({});
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportTargetPostId, setReportTargetPostId] = useState("");
  const [commentsSheetOpen, setCommentsSheetOpen] = useState(false);
  const [commentTargetPostId, setCommentTargetPostId] = useState("");
  const [commentRailCount, setCommentRailCount] = useState(0);
  const [commentCountOverrides, setCommentCountOverrides] = useState<Record<string, number>>({});
  const [successBanner, setSuccessBanner] = useState("");

  const focusHandledRef = useRef("");
  const reportablePostIdsDigestRef = useRef("");
  const claimSlotFocusHandledRef = useRef("");
  const claimSlotFocusReloadedRef = useRef(false);
  const claimSlotFocusLoadDoneRef = useRef(false);
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
  const lastScheduleVisibilityDigestRef = useRef("");

  const [stableDisplayRows, setStableDisplayRows] = useState<any[]>([]);
  const [visibleWindowSize, setVisibleWindowSize] = useState(HOME_FEED_INITIAL_LIMIT);

  const session = getSessionSync();
  const viewerUserId = String(session?.userId || "").trim();
  const claimSlotFocusChurchId = String(focusChurchIdParam || session?.churchId || "").trim();
  const isClaimSlotFocus = String(focus || "").trim() === "claim-media-slot";

  const contentHeight = homeFeedSlideHeight(windowHeight, tabBarHeight);
  const homeFeedRenderPaused = isHomeFeedRenderPaused();
  const feedFocused = screenFocused && appActive && !homeFeedRenderPaused;

  useLayoutEffect(() => {
    markHomeMount();
    beginHomeFirstVideoPriorityMode("home-feed-screen");
  }, []);

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
      setLocalTick((n) => n + 1);
    });
    return () => {
      try {
        (unsub as any)?.();
      } catch {}
    };
  }, []);

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

    const hasLocalSchedule = feedList().some(isHomeFeedScheduleCardRow);
    const hasVisibleRows =
      visibleRowCountRef.current > 0 ||
      backendRows.length > 0 ||
      cachedRows.length > 0 ||
      feedList().length > 0;
    const showBlockingLoader =
      refreshMode === "required" &&
      !hasVisibleRows &&
      (reason === "claim-slot-focus" || !force || !hasLocalSchedule);

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
        setBackendRows(rows);
        setStableDisplayRows((prev) => {
          const rowIds = new Set(rows.map((row) => homeFeedRowKey(row)).filter(Boolean));
          const next = prev.filter((row) => homeFeedRowIncludedInBackendSnapshot(row, rowIds));
          stableDisplayRowsRef.current = next.length ? next : prev;
          return next.length ? next : prev;
        });
      }
      setOptimisticLikes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const row of rows) {
          const postId = homeFeedScheduleEngagementId(row);
          if (!postId || !(postId in next)) continue;
          const serverLikedByMe = readFeedItemLikedByMe(row);
          if (serverLikedByMe || next[postId].likedByMe === serverLikedByMe) {
            delete next[postId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setLikeUiEpoch((n) => n + 1);
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
      setLocalTick((n) => n + 1);
      void loadFeed("schedule-dirty", { force: true });
    },
    [loadFeed]
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
      setLocalTick((n) => n + 1);

      if (!screenFocused) return;

      const consumed = consumeHomeFeedScheduleDirty(churchId);
      if (consumed) {
        forceReloadAfterSchedule("schedule-dirty-subscribe", consumed.backendFeedId);
      }
    });
    return unsub;
  }, [forceReloadAfterSchedule, screenFocused]);

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
    if (!feedFocused) return;
    const timer = setInterval(() => {
      void loadFeed("poll");
    }, 45000);
    return () => clearInterval(timer);
  }, [feedFocused, loadFeed]);

  useEffect(() => {
    return onSlotClaimChanged((payload) => {
      if (isHomeFeedRenderPaused()) return;

      console.log("KRISTO_SLOT_CLAIM_BROADCAST_RECEIVED", {
        churchId: payload.churchId,
        postId: payload.postId || null,
        slotId: payload.slotId,
        action: payload.action,
        source: payload.source || null,
      });

      setLocalTick((n) => n + 1);

      console.log("KRISTO_SLOT_CLAIM_UI_UPDATED", {
        source: "broadcast",
        churchId: payload.churchId,
        slotId: payload.slotId,
        action: payload.action,
      });
    });
  }, []);

  useEffect(() => {
    if (!feedFocused || homeFeedRenderPaused) return;
    const timer = setInterval(() => {
      setLocalTick((n) => n + 1);
    }, 20_000);
    return () => clearInterval(timer);
  }, [feedFocused, homeFeedRenderPaused]);

  const serverLikeByPostId = useMemo(() => {
    const map: Record<string, { likedByMe: boolean; likeCount: number }> = {};
    for (const row of backendRows) {
      const postId = homeFeedScheduleEngagementId(row);
      if (!postId) continue;
      map[postId] = {
        likedByMe: readFeedItemLikedByMe(row),
        likeCount: Number(row?.likeCount || 0),
      };
    }
    return map;
  }, [backendRows]);

  const localFeedSnapshot = useMemo(() => {
    void localTick;
    return feedList();
  }, [localTick]);

  const feedRows = useMemo(() => {
    if (homeFeedRenderPaused && backendRows.length) {
      return backendRows;
    }
    const merged = buildHomeFeedDisplayRows(backendRows, localFeedSnapshot);
    return hydrateFeedRowLikes(merged, serverLikeByPostId);
  }, [backendRows, localFeedSnapshot, serverLikeByPostId, homeFeedRenderPaused]);

  useEffect(() => {
    const digest = feedRows
      .filter((row) => isHomeFeedScheduleCardRow(row))
      .map((row) => {
        const scheduleId = baseFeedId(
          String(row?.parentScheduleId || row?.sourceScheduleId || row?.id || "")
        );
        const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
        const slotIds = slots.map((slot) => String(slot?.id || "").trim()).filter(Boolean);
        return `${scheduleId}:${slotIds.join(",")}`;
      })
      .join("|");
    if (!digest) return;
    if (digest === lastScheduleVisibilityDigestRef.current) return;
    lastScheduleVisibilityDigestRef.current = digest;

    for (const row of feedRows) {
      if (!isHomeFeedScheduleCardRow(row)) continue;
      const scheduleId =
        baseFeedId(String(row?.parentScheduleId || row?.sourceScheduleId || row?.id || "")) ||
        String(row?.id || "").trim() ||
        null;
      const slots = Array.isArray(row?.scheduleSlots) ? row.scheduleSlots : [];
      if (!slots.length) {
        logMediaSlotHomeFeedVisibility({
          slotId: null,
          scheduleId,
          stage: "display_build",
          included: true,
          reason: "schedule_card_without_slots",
        });
        continue;
      }
      for (const slot of slots) {
        logMediaSlotHomeFeedVisibility({
          slotId: String(slot?.id || "").trim() || null,
          scheduleId,
          stage: "display_build",
          included: true,
          reason: "visible_in_feed_rows",
        });
      }
    }
  }, [feedRows]);

  const claimableSlotRows = useMemo(() => {
    if (!isClaimSlotFocus || !claimSlotFocusChurchId) return [];
    return filterHomeFeedClaimableSlotRows(feedRows, claimSlotFocusChurchId, viewerUserId);
  }, [feedRows, isClaimSlotFocus, claimSlotFocusChurchId, viewerUserId]);

  const displayFeedRows = useMemo(() => {
    if (isClaimSlotFocus && claimableSlotRows.length) return claimableSlotRows;
    return feedRows;
  }, [feedRows, isClaimSlotFocus, claimableSlotRows]);

  useEffect(() => {
    if (isClaimSlotFocus && claimableSlotRows.length) {
      stableDisplayRowsRef.current = claimableSlotRows;
      setStableDisplayRows(claimableSlotRows);
      setVisibleWindowSize(claimableSlotRows.length);
      return;
    }

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
  }, [displayFeedRows, isClaimSlotFocus, claimableSlotRows]);

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
    markHomeFirstFrame({ reason: "page-ready", visibleCount });
  }, [stableDisplayRows.length]);

  // Staged endless feed: at ~70% through the visible window, first reveal the
  // next batch of already-loaded rows (cheap, no network), then — only when the
  // window already covers every loaded row — append more from the API. The
  // append is single-flight, throttled, and never deletes existing rows.
  useEffect(() => {
    if (isClaimSlotFocus || !feedFocused || !stableDisplayRows.length) return;

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
          setBackendRows(page.rows);
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
    isClaimSlotFocus,
  ]);

  const visibleData = useMemo(() => {
    const rowSource =
      stableDisplayRows.length > 0 ? stableDisplayRows : displayFeedRows;
    const windowed =
      isClaimSlotFocus && claimableSlotRows.length
        ? rowSource
        : rowSource.slice(0, visibleWindowSize);

    if (windowed.length > 0) {
      lastVisibleRowsRef.current = windowed;
      return windowed;
    }
    return lastVisibleRowsRef.current;
  }, [
    stableDisplayRows,
    displayFeedRows,
    visibleWindowSize,
    isClaimSlotFocus,
    claimableSlotRows.length,
  ]);

  useEffect(() => {
    visibleRowCountRef.current = visibleData.length;
  }, [visibleData]);

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

  useEffect(() => {
    if (!feedFocused || isClaimSlotFocus || !visibleData.length) return;
    if (posterWarmKey === lastPosterWarmKeyRef.current) return;
    lastPosterWarmKeyRef.current = posterWarmKey;
    warmHomeFeedVideoPostersNearActive(
      visibleData,
      activeIndex,
      prefetchSessionIdRef.current
    );
  }, [posterWarmKey, activeIndex, feedFocused, isClaimSlotFocus, visibleData]);

  // Initial buffer-ahead is deferred until the FIRST video's first frame paints
  // (or a short fallback). This guarantees the first video keeps full startup
  // priority and we only warm the next 2–3 rows once it is playing. The pending
  // subscription is tracked in a ref so feed re-renders never cancel it.
  useEffect(() => {
    if (!feedFocused || isClaimSlotFocus || !visibleData.length) return;
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
    const fallbackTimer = setTimeout(fire, 4000);
    initialWarmCleanupRef.current = () => {
      try {
        unsubscribe();
      } catch {}
      clearTimeout(fallbackTimer);
    };
  }, [feedFocused, isClaimSlotFocus, visibleData.length]);

  useEffect(() => {
    return () => {
      try {
        initialWarmCleanupRef.current?.();
      } catch {}
      initialWarmCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!feedFocused || isClaimSlotFocus || !visibleData.length) return;
    if (lastVideoBufferActiveRef.current === activeIndex) return;
    lastVideoBufferActiveRef.current = activeIndex;
    warmHomeFeedUpcoming(visibleData, activeIndex);
  }, [activeIndex, feedFocused, isClaimSlotFocus, visibleData.length]);

  useEffect(() => {
    if (!feedFocused || isClaimSlotFocus || !visibleData.length) return;
    const prevWindow = lastVideoBufferWindowRef.current;
    if (visibleWindowSize <= prevWindow) {
      lastVideoBufferWindowRef.current = visibleWindowSize;
      return;
    }
    lastVideoBufferWindowRef.current = visibleWindowSize;
    warmHomeFeedUpcoming(visibleData, activeIndex);
  }, [visibleWindowSize, activeIndex, feedFocused, isClaimSlotFocus, visibleData.length]);

  const viewerChurchId = String(session?.churchId || "").trim();

  const hasChurchScheduleSlots = useMemo(() => {
    if (!viewerChurchId) return false;
    return visibleData.some(
      (row) =>
        isHomeFeedScheduleCardRow(row) && homeFeedRowChurchId(row) === viewerChurchId
    );
  }, [visibleData, viewerChurchId]);

  const hasActiveOrLiveChurchSchedule = useMemo(() => {
    if (!viewerChurchId) return false;
    return isHomeFeedActiveOrNearLiveChurchScheduleVisible(
      visibleData,
      viewerChurchId
    );
  }, [visibleData, viewerChurchId]);

  const slotClaimPollIntervalMs = hasActiveOrLiveChurchSchedule
    ? SLOT_CLAIM_POLL_LIVE_MS
    : SLOT_CLAIM_POLL_FALLBACK_MS;

  useEffect(() => {
    if (!feedFocused || !hasChurchScheduleSlots || homeFeedRenderPaused || !viewerChurchId) {
      return;
    }

    let alive = true;

    const runPoll = () => {
      void pollRemoteSlotClaimUpdates(viewerChurchId, "home-feed-fallback-poll").then(
        (updated) => {
          if (!alive || !updated) return;
          setLocalTick((n) => n + 1);
          console.log("KRISTO_SLOT_CLAIM_UI_UPDATED", {
            source: "poll",
            churchId: viewerChurchId,
          });
        }
      );
    };

    const timer = setInterval(runPoll, slotClaimPollIntervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [
    feedFocused,
    hasChurchScheduleSlots,
    homeFeedRenderPaused,
    viewerChurchId,
    slotClaimPollIntervalMs,
  ]);

  useEffect(() => {
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
  }, [feedFocused, activeIndex, visibleData]);

  useEffect(() => {
    const targetId = String(pendingScheduleFeedIdRef.current || "").trim();
    if (!targetId) return;

    const visible = feedRows.some((row) => {
      if (!isHomeFeedScheduleCardRow(row)) return false;
      const rowId = String(row?.id || "").trim();
      const parentId = String(row?.parentScheduleId || row?.sourceScheduleId || "").trim();
      return (
        rowId === targetId ||
        parentId === targetId ||
        baseFeedId(rowId) === baseFeedId(targetId)
      );
    });

    if (!visible) return;

    console.log("KRISTO_HOME_FEED_SCHEDULE_VISIBLE_AFTER_CREATE", {
      backendFeedId: targetId,
      feedCount: feedRows.length,
      scheduleSlotCount: feedRows.filter(isHomeFeedScheduleCardRow).length,
    });
    pendingScheduleFeedIdRef.current = null;
  }, [feedRows]);

  useEffect(() => {
    let alive = true;

    void getLocallyReportedPostIds().then((ids) => {
      if (!alive || !ids.length) return;
      setReportedPostIds((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = true;
        return next;
      });
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
    void syncReportedPostIdsFromApi(ids).then((reported) => {
      if (!alive || !reported.length) return;
      setReportedPostIds((prev) => {
        const next = { ...prev };
        for (const id of reported) next[id] = true;
        return next;
      });
    });

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
    if (!isClaimSlotFocus) return;
    claimSlotFocusHandledRef.current = "";
    claimSlotFocusReloadedRef.current = false;
    claimSlotFocusLoadDoneRef.current = false;
  }, [isClaimSlotFocus, focusChurchIdParam, focusSource]);

  useEffect(() => {
    if (!isClaimSlotFocus || !screenFocused || claimSlotFocusReloadedRef.current) return;
    claimSlotFocusReloadedRef.current = true;
    void loadFeed("claim-slot-focus", { force: true }).finally(() => {
      claimSlotFocusLoadDoneRef.current = true;
    });
  }, [isClaimSlotFocus, screenFocused, loadFeed]);

  useEffect(() => {
    if (!isClaimSlotFocus || !claimSlotFocusChurchId) return;

    const focusKey = `claim-media-slot:${claimSlotFocusChurchId}`;
    if (claimSlotFocusHandledRef.current === focusKey) return;
    if (!claimSlotFocusLoadDoneRef.current || loading) return;

    console.log("KRISTO_HOME_FEED_CLAIM_SLOT_FOCUS", {
      churchId: claimSlotFocusChurchId,
      source: String(focusSource || ""),
      feedCount: feedRows.length,
      loading,
    });

    if (claimableSlotRows.length > 0) {
      const firstRow = claimableSlotRows[0];
      console.log("KRISTO_HOME_FEED_CLAIM_SLOT_FOUND", {
        churchId: claimSlotFocusChurchId,
        slotCount: claimableSlotRows.length,
        firstSlotId: feedRenderKey(firstRow) || String(firstRow?.id || ""),
        firstSlotNumber: Number(firstRow?.slotNumber || 0) || null,
      });
      claimSlotFocusHandledRef.current = focusKey;
      setActiveIndex(0);
      return;
    }

    console.log("KRISTO_HOME_FEED_CLAIM_SLOT_EMPTY", {
      churchId: claimSlotFocusChurchId,
      feedCount: feedRows.length,
    });
    claimSlotFocusHandledRef.current = focusKey;
    setSuccessBanner(CLAIM_SLOT_EMPTY_MESSAGE);
    if (successBannerTimerRef.current) {
      clearTimeout(successBannerTimerRef.current);
    }
    successBannerTimerRef.current = setTimeout(() => {
      setSuccessBanner("");
    }, 4200);
  }, [
    isClaimSlotFocus,
    claimSlotFocusChurchId,
    claimableSlotRows,
    feedRows.length,
    focusSource,
    loading,
  ]);

  useEffect(() => {
    const rawFocusId = String(focusPostId || "").trim();
    if (!rawFocusId || !visibleData.length || isClaimSlotFocus) return;
    if (focusHandledRef.current === rawFocusId) return;

    const matchIndex = visibleData.findIndex((item) => String(item?.id || "") === rawFocusId);
    if (matchIndex < 0) return;

    focusHandledRef.current = rawFocusId;
    setActiveIndex(matchIndex);
  }, [focusPostId, visibleData, isClaimSlotFocus]);

  useEffect(() => {
    if (activeIndex >= visibleData.length && visibleData.length > 0) {
      setActiveIndex(Math.max(0, visibleData.length - 1));
    }
  }, [activeIndex, visibleData.length]);

  const getLikeState = useCallback(
    (item: any, logContext?: { index?: number }) => {
      const postId = homeFeedScheduleEngagementId(item);
      if (!postId) {
        return { likedByMe: false, liked: false, likeCount: 0 };
      }

      const itemLikedByMe = readFeedItemLikedByMe(item);
      const hydrated = serverLikeByPostId[postId];
      const serverLikedByMe = hydrated?.likedByMe === true || itemLikedByMe;
      const serverLikeCount = Math.max(
        Number(item?.likeCount || 0),
        Number(hydrated?.likeCount || 0)
      );

      const override = Object.prototype.hasOwnProperty.call(optimisticLikes, postId)
        ? optimisticLikes[postId]
        : undefined;
      const overrideLikedByMe = override?.likedByMe;

      let finalLikedByMe = serverLikedByMe;
      if (override) {
        if (serverLikedByMe) {
          finalLikedByMe = true;
        } else if (overrideLikedByMe === true) {
          finalLikedByMe = true;
        } else {
          finalLikedByMe = false;
        }
      }

      const likeCount = Math.max(
        serverLikeCount,
        override ? Number(override.likeCount || 0) : 0
      );

      if (logContext?.index === activeIndex && isKristoVerboseFeedDebug()) {
        console.log("KRISTO_LIKE_UI_STATE", {
          postId,
          itemLikedByMe,
          overrideLikedByMe: overrideLikedByMe ?? null,
          finalLikedByMe,
          likeCount,
        });
      }

      return {
        likedByMe: finalLikedByMe,
        liked: finalLikedByMe,
        likeCount,
      };
    },
    [activeIndex, optimisticLikes, serverLikeByPostId]
  );

  const getSavedState = useCallback(
    (item: any) => {
      const postId = String(item?.id || "");
      if (Object.prototype.hasOwnProperty.call(optimisticSaved, postId)) {
        return optimisticSaved[postId];
      }
      return Boolean(item?.saved);
    },
    [optimisticSaved]
  );

  const handleLike = useCallback(
    (item: any) => {
      const postId = homeFeedScheduleEngagementId(item);
      if (!postId) return;

      const current = getLikeState(item);
      const nextLikedByMe = !current.likedByMe;
      const nextCount = Math.max(0, current.likeCount + (nextLikedByMe ? 1 : -1));

      setOptimisticLikes((prev) => ({
        ...prev,
        [postId]: { likedByMe: nextLikedByMe, likeCount: nextCount },
      }));
      setLikeUiEpoch((n) => n + 1);

      feedToggleLike(postId);
      syncHomeFeedLike(postId, nextLikedByMe);
    },
    [getLikeState]
  );

  const handleSave = useCallback(
    (item: any) => {
      const postId = String(item?.id || "").trim();
      if (!postId) return;

      const nextSaved = !getSavedState(item);
      setOptimisticSaved((prev) => ({ ...prev, [postId]: nextSaved }));
      feedToggleSave(postId);
    },
    [getSavedState]
  );

  const discussionCountFromItem = useCallback((item: any) => {
    const total = Number(item?.totalDiscussionCount || 0);
    if (total > 0) return total;
    return Number(item?.commentCount || 0) + Number(item?.replyCount || 0);
  }, []);

  const getVisibleDiscussionCount = useCallback(
    (item: any) => {
      const postId = homeFeedCommentPostId(item);
      const serverCount = discussionCountFromItem(item);
      const hasOverride =
        Boolean(postId) && Object.prototype.hasOwnProperty.call(commentCountOverrides, postId);
      const overrideCount = hasOverride ? commentCountOverrides[postId] : undefined;
      const visibleCount = hasOverride
        ? Math.max(serverCount, overrideCount ?? 0)
        : serverCount;

      if (hasOverride && serverCount < (overrideCount ?? 0)) {
        console.log("KRISTO_COMMENT_COUNT_STALE_FEED_IGNORED", {
          postId,
          serverCount,
          overrideCount,
          visibleCount,
        });
      }

      return visibleCount;
    },
    [commentCountOverrides, discussionCountFromItem]
  );

  const handleComment = useCallback((item: any) => {
    const postId = homeFeedCommentPostId(item);
    if (!postId) return;

    const session = getSessionSync();
    if (!userHasActiveChurchMembership(session)) {
      Alert.alert("Join a church", "Join a church to comment on posts.");
      return;
    }

    setCommentTargetPostId(postId);
    setCommentRailCount(getVisibleDiscussionCount(item));
    setCommentsSheetOpen(true);
  }, [getVisibleDiscussionCount]);

  const handleDiscussionCountChange = useCallback((postId: string, count: number) => {
    const cleanId = normalizeCommentPostId(postId);
    if (!cleanId || !Number.isFinite(count)) return;
    const nextCount = Math.max(0, count);
    console.log("KRISTO_COMMENT_COUNT_OVERRIDE_SET", {
      postId: cleanId,
      count: nextCount,
      source: "comments_confirmed",
    });
    setCommentCountOverrides((prev) => ({ ...prev, [cleanId]: nextCount }));
  }, []);

  const handleDiscussionCountBump = useCallback(
    (postId: string, delta: number) => {
      const cleanId = normalizeCommentPostId(postId);
      if (!cleanId || !Number.isFinite(delta) || delta === 0) return;

      setCommentCountOverrides((prev) => {
        const item = feedRows.find((row) => homeFeedCommentPostId(row) === cleanId);
        const serverCount = discussionCountFromItem(item || {});
        const prevOverride = Object.prototype.hasOwnProperty.call(prev, cleanId)
          ? prev[cleanId]
          : undefined;
        const visibleBase =
          prevOverride !== undefined ? Math.max(serverCount, prevOverride) : serverCount;
        const nextCount = Math.max(0, visibleBase + delta);
        console.log("KRISTO_COMMENT_COUNT_OVERRIDE_SET", {
          postId: cleanId,
          count: nextCount,
          source: delta > 0 ? "optimistic_bump" : "optimistic_rollback",
          delta,
        });
        return { ...prev, [cleanId]: nextCount };
      });
    },
    [feedRows, discussionCountFromItem]
  );

  const handleShare = useCallback(async (item: any) => {
    const title = String(item?.title || "").trim();
    const body = String(item?.body || item?.text || "").trim();
    const church = String(item?.churchName || item?.churchLabel || "").trim();
    const message = [title, body, church].filter(Boolean).join("\n\n");
    try {
      await Share.share({ message: message || "Shared from Kristo", title: title || "Kristo" });
    } catch {}
  }, []);

  const isPostReported = useCallback(
    (item: any) => {
      const postId = baseFeedId(String(item?.id || ""));
      return Boolean(postId && reportedPostIds[postId]);
    },
    [reportedPostIds]
  );

  const handleReport = useCallback((item: any) => {
    const postId = normalizeCommentPostId(String(item?.id || "").trim());
    if (!postId) return;
    setReportTargetPostId(postId);
    setReportSheetOpen(true);
  }, []);

  const handleReported = useCallback((postId: string) => {
    const cleanId = baseFeedId(postId);
    if (!cleanId) return;

    void markPostReportedLocally(cleanId);
    setReportedPostIds((prev) => ({ ...prev, [cleanId]: true }));
    setSuccessBanner("Report submitted. Thank you for helping keep Kristo safe.");

    if (successBannerTimerRef.current) {
      clearTimeout(successBannerTimerRef.current);
    }
    successBannerTimerRef.current = setTimeout(() => {
      setSuccessBanner("");
    }, 3200);
  }, []);

  return (
    <View style={[styles.screen, { height: contentHeight }]}>
      {successBanner ? (
        <View style={styles.successBanner} pointerEvents="none">
          <Text style={styles.successBannerText}>{successBanner}</Text>
        </View>
      ) : null}

      <FeedList
        rows={visibleData}
        contentHeight={contentHeight}
        activeIndex={activeIndex}
        screenFocused={feedFocused}
        loading={loading}
        likeUiEpoch={likeUiEpoch}
        getLikeState={getLikeState}
        getSavedState={getSavedState}
        getVisibleDiscussionCount={getVisibleDiscussionCount}
        isPostReported={isPostReported}
        onActiveIndexChange={setActiveIndex}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
        onSave={handleSave}
        onReport={handleReport}
      />

      <FeedReportSheet
        visible={reportSheetOpen}
        postId={reportTargetPostId}
        onClose={() => setReportSheetOpen(false)}
        onReported={handleReported}
      />

      <FeedCommentsSheet
        visible={commentsSheetOpen}
        postId={commentTargetPostId}
        railDiscussionCount={commentRailCount}
        onClose={() => setCommentsSheetOpen(false)}
        onDiscussionCountChange={handleDiscussionCountChange}
        onDiscussionCountBump={handleDiscussionCountBump}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignSelf: "stretch",
    backgroundColor: HOME_FEED_BG,
    overflow: "hidden",
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
