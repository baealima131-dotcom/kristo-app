import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AppState,
  InteractionManager,
  Platform,
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
} from "@/src/lib/firstPaint";
import {
  appendHomeFeedYoutubeStreamRows,
  clearHomeFeedYoutubeStreamSession,
  hasHomeFeedYoutubeStreamSession,
  isPartialHomeFeedYoutubeStreamSession,
  logHomeFeedSessionRestored,
  peekHomeFeedYoutubeStreamSession,
  peekHomeFeedYoutubeStreamSessionRows,
  removeHomeFeedYoutubeStreamPost,
  replaceHomeFeedYoutubeStreamRows,
  saveHomeFeedYoutubeStreamSession,
  shouldBlockHomeFeedYoutubeBackgroundUiMutation,
  shouldReplaceHomeFeedYoutubeStreamUi,
} from "@/src/lib/homeFeedYoutubeStreamSession";
import { runAfterHomeDeferredStartup } from "@/src/lib/homeFeedDeferredStartup";
import { rankHomeFeedYoutubeStreamRows } from "@/src/lib/homeFeedPersonalOrder";
import { shouldRebuildHomeFeedDisplayOrder } from "@/src/lib/homeFeedRefreshReason";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import {
  bumpHomeFeedFetchGeneration,
  logHomeFeedNetworkTrace,
  resolveHomeFeedRefreshMode,
  shouldHardRefreshHomeFeed,
} from "@/src/lib/homeFeedNetwork";
import {
  freezeHomeFeedDisplayOrder,
  isHomeFeedDisplayOrderFrozen,
  markHomeFeedReadyForBackgroundWork,
  notifyHomeFeedUserScrollActivity,
  shouldApplyHomeFeedVisibleRowUpdate,
  unfreezeHomeFeedDisplayOrder,
} from "@/src/lib/homeFeedScrollStability";
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
  getHomeFeedPagingState,
  homeFeedRowIncludedInBackendSnapshot,
  mergeYoutubeColdStartRotation,
  prepareHomeFeedYoutubeNextPageSilently,
  ensureHomeFeedYoutubeSilentNextPagePrepared,
  isHomeFeedYoutubeSilentNextPagePrepInflight,
  isHomeFeedYoutubeSilentNextPagePrepReady,
  clearHomeFeedYoutubeSilentNextPagePrep,
  refreshHomeFeedYoutubeBackgroundCache,
  revalidateHomeFeedYoutubeStaleExhaustion,
  shouldRevalidateStaleHomeFeedExhaustion,
  syncHomeFeedLike,
} from "./homeFeedApi";
import { hydrateHomeFeedRowsCacheFromStorage } from "./homeFeedRowsCache";
import {
  buildHomeFeedSkeletonRows,
  HOME_FEED_YOUTUBE_APPEND_COOLDOWN_MS,
  HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
  isHomeFeedSkeletonRow,
  homeFeedYoutubeStreamLimitForPage,
  hydrateHomeFeedPage0FromStorage,
  peekHomeFeedPage0Sync,
  hydrateHomeFeedStreamFromStorage,
  getHomeFeedLoadedPageCount,
  type HomeFeedYoutubeScrollMetrics,
  youtubeStreamDistanceFromEnd,
  shouldPrefetchHomeFeedYoutubeStreamByScroll,
} from "./homeFeedPageCache";
import {
  HOME_FEED_YOUTUBE_PREFETCH_LOG_THROTTLE_MS,
  HOME_FEED_YOUTUBE_MIN_ROWS_BEFORE_PAGINATION,
  isYoutubeFeedListOverflowing,
  resolveYoutubePageSettlingMs,
  awaitYoutubeBatchCoverGate,
  waitForYoutubePage0RevealGate,
  kickoffYoutubePagePosterPrewarm,
  kickoffYoutubePageAvatarPrewarm,
  HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT,
} from "./homeFeedYoutubeStreamUi";
import {
  hydrateHomeFeedDisplayOrderFromStorage,
  peekHomeFeedDisplayOrderSync,
  saveHomeFeedDisplayOrderCache,
} from "./homeFeedDisplayOrderCache";
import {
  HOME_FEED_INITIAL_LIMIT,
  HOME_FEED_PAGE_SIZE,
  HOME_FEED_YOUTUBE_INITIAL_VISIBLE,
  homeFeedBackendRowsDigest,
  homeFeedLocalRowsDigest,
  homeFeedRowKey,
  initialHomeFeedVisibleWindowSize,
  isHomeFeedNearEnd,
  nextHomeFeedVisibleWindowSize,
  stableMergeHomeFeedRows,
  dedupeHomeFeedRowsByKey,
} from "./homeFeedPagination";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  feedRenderKey,
  buildHomeFeedDisplayRows,
  mergeCachedHomeFeedDisplayOrder,
  homeFeedScheduleEngagementId,
  homeFeedCommentPostId,
  isHomeFeedScheduleCardRow,
  isImagePost,
  isVideoPost,
  readFeedItemLikedByMe,
  setHomeFeedViewerCanSeeMediaSlots,
  filterHomeFeedRowsByPostKind,
  filterHomeFeedYoutubeStreamRows,
  homeFeedRowChurchId,
  resolveHomeFeedAvatarCacheContext,
  type HomeFeedPostKindFilter,
} from "./homeFeedUtils";
import {
  ensureHomeFeedAvatar,
  peekHomeFeedAvatar,
  registerHomeFeedAvatarDiagnosticContext,
} from "@/src/lib/homeFeedAvatarCache";
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
import {
  ensureWatchQueueDepth,
  getWatchUpNextGeneration,
  mergeWatchUpNextCandidateRows,
  recordWatchSessionVideo,
  resetWatchUpNextSession,
  reshuffleHomeFeedRowsAfterWatchSelection,
  WATCH_QUEUE_REFILL_THRESHOLD,
  WATCH_QUEUE_TARGET_DEPTH,
} from "@/src/lib/homeFeedWatchUpNext";
import { subscribeBackgroundMediaJobsPaused, notifyWatchScreenOpened } from "@/src/lib/homeFeedWatchPlaybackPriority";
import {
  getLocallyReportedPostIds,
  markPostReportedLocally,
  syncReportedPostIdsFromApi,
} from "@/src/lib/homeFeedReport";
import {
  fetchBlockedUserIdsFromApi,
  fetchChurchModerationFromApi,
  getLocallyBlockedUserIds,
  getLocallyExcludedChurchIds,
  normalizeFeedChurchId,
  subscribeChurchFeedModeration,
} from "@/src/lib/homeFeedModeration";
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
  isHomeFeedLazyMediaPrewarmEnabled,
  isHomeFeedPosterPrewarmDisabled,
  isHomeFeedYouTubeStyleVideo,
  isHomeFeedVideoDiskCacheEnabled,
  HOME_FEED_LAZY_VISIBLE_POSTER_BUFFER,
  HOME_FEED_LAZY_VISIBLE_POSTER_COUNT,
  type HomeFeedVideoOpenPayload,
} from "@/src/lib/homeFeedVideoMode";
import {
  areHomeFeedForwardVideosDiskCached,
  scheduleHomeFeedVideoDiskCacheBackground,
  subscribeHomeFeedVideoDiskCache,
} from "@/src/lib/homeFeedVideoDiskCache";
import {
  beginHomeFeedVideoPreloadSession,
  endHomeFeedVideoPreloadSession,
} from "@/src/lib/homeFeedVideoPreload";
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
  startYoutubeHomeFeedVisiblePosterPrewarm,
  VISIBLE_PRIORITY_COUNT,
} from "@/src/lib/homeFeedPosterPrewarm";
import {
  describePosterFeedIdentity,
  describePosterVisibleIdentity,
  posterFeedIdentitySetsEqual,
} from "@/src/lib/homeFeedPosterIdentity";
import { fetchChurchSubscriptionActiveThrottled } from "@/src/lib/churchResourceRefresh";
import {
  isYoutubeFeedPaginationLocked,
  setYoutubeFeedPaginationLocked,
  runYoutubeVisualPrep,
} from "@/src/lib/homeFeedYoutubePaginationLock";
import { isHomeFeedPosterPipelineBusyForRows } from "@/src/lib/homeFeedPosterPrewarm";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  markHomeFeedStartupTiming,
  runAfterHomeFeedFirstCardMount,
} from "@/src/lib/homeFeedStartupTiming";

export default function HomeFeedScreen() {
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

  const youtubeSessionOnMount = peekHomeFeedYoutubeStreamSession();

  const hadCacheOnMountRef = useRef(
    isHomeFeedYouTubeStyleVideo()
      ? youtubeSessionOnMount.rows.length > 0
      : getCachedHomeFeedBackendRows().length > 0
  );
  const initialRenderSourceLoggedRef = useRef(false);
  const homeFeedMountAtRef = useRef(Date.now());
  const first20VisibleLoggedRef = useRef(false);
  const first20PosterStartAtRef = useRef<number | null>(null);
  const first20PosterDoneLoggedRef = useRef(false);
  const lastDeferredVideoCountRef = useRef<number | null>(null);
  const first20AvatarPreloadStartAtRef = useRef<number | null>(null);
  const first20AvatarPreloadDoneLoggedRef = useRef(false);
  const androidProgressiveRevealDoneRef = useRef(false);
  const [backendRows, setBackendRows] = useState<any[]>(() =>
    isHomeFeedYouTubeStyleVideo() ? [] : getCachedHomeFeedBackendRows()
  );
  const [localFeedDigest, setLocalFeedDigest] = useState(() => homeFeedLocalRowsDigest(feedList()));
  const [scheduleTick, setScheduleTick] = useState(() => Math.floor(Date.now() / 30_000));
  const localFeedDigestRef = useRef(localFeedDigest);
  const [loading, setLoading] = useState(
    () =>
      !isHomeFeedYouTubeStyleVideo() &&
      !hadCacheOnMountRef.current &&
      feedList().length === 0
  );
  const [activeIndex, setActiveIndex] = useState(() =>
    isHomeFeedYouTubeStyleVideo() ? youtubeSessionOnMount.activeIndex : 0
  );
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportTargetPostId, setReportTargetPostId] = useState("");
  const [reportTargetAuthorUserId, setReportTargetAuthorUserId] = useState("");
  const [reportTargetItem, setReportTargetItem] =
    useState<any | null>(null);
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
  const watchUpNextPoolRef = useRef<any[]>([]);
  const watchQueueRefillInflightRef = useRef(false);
  /** Bumped on each Up Next rebuild and on full Watch close to ignore stale refill work. */
  const watchQueueRequestIdRef = useRef(0);
  /**
   * Session paging can report hasMore=false after a single in-memory page even when the
   * backend still has more. Probe once per Watch open before trusting exhaustion.
   */
  const watchQueueHasMoreProbedRef = useRef(false);
  /** One-shot network allowance after ensureWatchQueueDepth clears stale exhaustion. */
  const watchQueueStaleProbeNetworkAllowedRef = useRef(false);
  const [backgroundMediaPaused, setBackgroundMediaPaused] = useState(false);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [feedPostFilter, setFeedPostFilter] = useState<HomeFeedPostKindFilter | null>(null);

  const focusHandledRef = useRef("");
  const openPostHandledRef = useRef("");
  const pendingScrollRowKeyRef = useRef("");
  const reportablePostIdsDigestRef = useRef("");
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [excludedChurchIds, setExcludedChurchIds] = useState<string[]>([]);
  const successBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScheduleFeedIdRef = useRef<string | null>(null);
  const lastNearEndLoadAtMsRef = useRef(0);
  const appendMoreInflightRef = useRef(false);
  const activeIndexRef = useRef(0);
  const userScrollGenerationRef = useRef(0);
  const scrollGenerationAtLastAppendRef = useRef(0);
  const appendCooldownUntilMsRef = useRef(0);
  const lastUserScrollYRef = useRef(
    youtubeSessionOnMount.scrollY > 0 ? youtubeSessionOnMount.scrollY : 0
  );
  const userHasScrolledSinceAppendRef = useRef(false);
  const youtubeStreamExhaustedRef = useRef(false);
  /** Once-per-focus attempt for stale hasMore:false revalidation. */
  const homeFeedStalePagingAttemptedThisFocusRef = useRef(false);
  /** Set after an authoritative revalidate accept/repair (exhaust or recover). */
  const homeFeedStalePagingSettledRef = useRef(false);
  const homeFeedStalePagingInflightRef = useRef(false);
  const youtubePaginationStagingRef = useRef(false);
  const youtubeRevealGenerationRef = useRef(0);
  const youtubePageRevealCompleteRef = useRef(youtubeSessionOnMount.pageRevealComplete);
  const youtubePageVisualReadyRef = useRef(youtubeSessionOnMount.pageVisualReady);
  const youtubePageSettlingUntilMsRef = useRef(0);
  const youtubeVisualReadyGenerationRef = useRef(0);
  const youtubeUserScrollAfterVisualReadyRef = useRef(youtubeSessionOnMount.pageVisualReady);
  const youtubeStagedForPageIndexRef = useRef(-1);
  const youtubeLastAppendedBatchRef = useRef<any[]>([]);
  const prefetchSkipLogAtRef = useRef<Record<string, number>>({});
  const youtubeScrollMetricsRef = useRef<HomeFeedYoutubeScrollMetrics>({
    scrollY: youtubeSessionOnMount.scrollY,
    contentHeight: 0,
    viewportHeight: 1,
  });
  const feedNextCursorRef = useRef<string | null>(
    youtubeSessionOnMount.nextCursor ?? getHomeFeedPagingState().nextCursor
  );
  const feedHasMoreRef = useRef(
    youtubeSessionOnMount.rows.length > 0
      ? youtubeSessionOnMount.hasMore
      : getHomeFeedPagingState().hasMore
  );
  const [feedHasMore, setFeedHasMore] = useState(() =>
    youtubeSessionOnMount.rows.length > 0
      ? youtubeSessionOnMount.hasMore
      : getHomeFeedPagingState().hasMore
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const youtubeStreamRowsRef = useRef<any[]>(youtubeSessionOnMount.rows);
  const [youtubeRowsTick, bumpYoutubeRows] = useReducer((value: number) => value + 1, 0);
  const youtubeStreamRows = useMemo(() => {
    const sessionRows = peekHomeFeedYoutubeStreamSessionRows();
    if (sessionRows.length > 0) return sessionRows;
    // Progressive Android reveal commits to ref before session accepts a full page.
    return youtubeStreamRowsRef.current;
  }, [youtubeRowsTick]);
  const [youtubeShowSkeleton, setYoutubeShowSkeleton] = useState(() =>
    isHomeFeedYouTubeStyleVideo() ? youtubeSessionOnMount.rows.length === 0 : false
  );
  const [youtubePageVisualReady, setYoutubePageVisualReady] = useState(
    () => youtubeSessionOnMount.pageVisualReady
  );
  activeIndexRef.current = activeIndex;
  const lastVisibleRowsRef = useRef<any[]>([]);
  const visibleRowCountRef = useRef(0);
  const pageReadyLoggedRef = useRef(
    youtubeSessionOnMount.pageVisualReady || youtubeSessionOnMount.rows.length > 0
  );
  const stableDisplayRowsRef = useRef<any[]>([]);
  const initialVideoBufferWarmedRef = useRef(false);
  const initialWarmCleanupRef = useRef<(() => void) | null>(null);
  const lastVideoBufferActiveRef = useRef(-1);
  const lastVideoBufferWindowRef = useRef(
    isHomeFeedYouTubeStyleVideo() ? HOME_FEED_YOUTUBE_INITIAL_VISIBLE : HOME_FEED_INITIAL_LIMIT
  );
  const prefetchSessionIdRef = useRef(0);
  const lastPosterWarmKeyRef = useRef("");
  const feedListRef = useRef<FeedListHandle>(null);
  const lastPosterRefreshFeedKeyRef = useRef("");
  const lastPosterVisibleSignatureRef = useRef("");
  const lastPosterInitialSignatureRef = useRef("");

  const [displayOrderRebuildRequested, setDisplayOrderRebuildRequested] = useState(false);
  const startupFeedRequestedRef = useRef(youtubeSessionOnMount.rows.length > 0);
  const coldStartRotationPendingRef = useRef(false);
  const [displayOrderCacheReady, setDisplayOrderCacheReady] = useState(false);
  const [stableDisplayRows, setStableDisplayRows] = useState<any[]>(() => {
    if (isHomeFeedYouTubeStyleVideo()) return [];
    const cached = peekHomeFeedDisplayOrderSync();
    if (cached.length) {
      stableDisplayRowsRef.current = cached;
    }
    return cached;
  });
  const [visibleWindowSize, setVisibleWindowSize] = useState(() =>
    isHomeFeedYouTubeStyleVideo() ? HOME_FEED_YOUTUBE_INITIAL_VISIBLE : HOME_FEED_INITIAL_LIMIT
  );

  const session = getSessionSync();
  const viewerUserId = String(session?.userId || "").trim();
  const viewerChurchId = String(session?.churchId || "").trim();
  const [viewerCanSeeMediaSlots, setViewerCanSeeMediaSlots] = useState(false);
  const blockedUserIdSet = useMemo(
    () => new Set(blockedUserIds.map((id) => String(id || "").trim()).filter(Boolean)),
    [blockedUserIds]
  );
  const excludedChurchIdSet = useMemo(
    () => new Set(excludedChurchIds.map(normalizeFeedChurchId).filter(Boolean)),
    [excludedChurchIds]
  );

  const resolveRowAuthorUserId = useCallback((row: any) => {
    return String(
      row?.createdBy ||
        row?.authorUserId ||
        row?.ownerUserId ||
        row?.postedByUserId ||
        ""
    ).trim();
  }, []);

  const contentHeight = homeFeedSlideHeight(windowHeight, tabBarHeight);
  const feedViewportHeight = Math.max(280, contentHeight - topBarHeight);
  youtubeScrollMetricsRef.current = {
    ...youtubeScrollMetricsRef.current,
    viewportHeight: feedViewportHeight,
  };
  const homeFeedRenderPaused = isHomeFeedRenderPaused();
  const feedFocused = screenFocused && appActive && !homeFeedRenderPaused;

  const bumpLocalFeedIfChanged = useCallback(() => {
    const localRows = feedList();
    const nextDigest = homeFeedLocalRowsDigest(localRows);
    if (nextDigest === localFeedDigestRef.current) return;

    const knownIds = new Set(
      stableDisplayRowsRef.current.map((row) => homeFeedRowKey(row)).filter(Boolean)
    );
    const hasNewLocalPost = localRows.some((row) => {
      const id = homeFeedRowKey(row);
      return Boolean(id && !knownIds.has(id));
    });
    if (hasNewLocalPost) {
      setDisplayOrderRebuildRequested(true);
      unfreezeHomeFeedDisplayOrder();
    }

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
    console.log("KRISTO_HOME_FEED_PAGE_SIZE", {
      pageSize: HOME_FEED_PAGE_SIZE,
      youtubeFirstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
      youtubePageSize: homeFeedYoutubeStreamLimitForPage(1),
    });
  }, []);

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
      if (youtubeLayout) {
        const paging = getHomeFeedPagingState();
        feedNextCursorRef.current = paging.nextCursor;
        feedHasMoreRef.current = paging.hasMore;
        setFeedHasMore(paging.hasMore);
        if (!paging.hasMore) {
          youtubeStreamExhaustedRef.current = true;
        }

        if (youtubeSessionOnMount.rows.length > 0) {
          if (isPartialHomeFeedYoutubeStreamSession(youtubeSessionOnMount)) {
            console.log("KRISTO_HOME_FEED_SESSION_PARTIAL_IGNORED", {
              rowCount: youtubeSessionOnMount.rows.length,
              hasMore: youtubeSessionOnMount.hasMore,
              source: "mount-restore",
              firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
            });
            clearHomeFeedYoutubeStreamSession();
            setDisplayOrderCacheReady(true);
            return;
          }
          youtubeStreamRowsRef.current = youtubeSessionOnMount.rows;
          feedNextCursorRef.current = youtubeSessionOnMount.nextCursor;
          feedHasMoreRef.current = youtubeSessionOnMount.hasMore;
          setFeedHasMore(youtubeSessionOnMount.hasMore);
          if (!youtubeSessionOnMount.hasMore) {
            youtubeStreamExhaustedRef.current = true;
          }
          youtubePageRevealCompleteRef.current = youtubeSessionOnMount.pageRevealComplete;
          youtubePageVisualReadyRef.current = youtubeSessionOnMount.pageVisualReady;
          setYoutubePageVisualReady(youtubeSessionOnMount.pageVisualReady);
          setBackendRows(youtubeSessionOnMount.rows);
          markHomeFeedStartupTiming("FEED_CACHE_READY_TS", {
            source: "session",
            rowCount: youtubeSessionOnMount.rows.length,
          });
          markHomeFeedStartupTiming("FIRST_DATA_COMMIT_TS", {
            rowCount: youtubeSessionOnMount.rows.length,
            source: "session-restore",
          });
          setLoading(false);
          hadCacheOnMountRef.current = true;
          pageReadyLoggedRef.current = true;
          logHomeFeedSessionRestored("mount");
          setDisplayOrderCacheReady(true);
          if (youtubeSessionOnMount.pageVisualReady) {
            youtubeLastAppendedBatchRef.current = youtubeSessionOnMount.rows.slice(
              -HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE
            );
            setYoutubeFeedPaginationLocked(false);
          }
          return;
        }

        const cachedPage0 = peekHomeFeedPage0Sync();
        if (cachedPage0?.length) {
          coldStartRotationPendingRef.current = true;
          markHomeFeedStartupTiming("FEED_CACHE_READY_TS", {
            source: "page0-mem",
            rowCount: cachedPage0.length,
          });
          void revealYoutubePage0(cachedPage0, { fromCache: true });
        } else {
          const page0 = await hydrateHomeFeedPage0FromStorage();
          if (!alive) return;

          if (page0?.length) {
            coldStartRotationPendingRef.current = true;
            markHomeFeedStartupTiming("FEED_CACHE_READY_TS", {
              source: "page0",
              rowCount: page0.length,
            });
            void revealYoutubePage0(page0, { fromCache: true });
          } else {
            const streamRows = await hydrateHomeFeedStreamFromStorage();
            if (!alive) return;

            if (streamRows?.length) {
              coldStartRotationPendingRef.current = true;
              markHomeFeedStartupTiming("FEED_CACHE_READY_TS", {
                source: "stream",
                rowCount: streamRows.length,
              });
              void restoreYoutubeStreamRows(streamRows, { coldStart: true, fromCache: true });
            }
          }
        }

        setDisplayOrderCacheReady(true);
        return;
      }

      const [payload, displayPayload] = await Promise.all([
        hydrateHomeFeedRowsCacheFromStorage(),
        hydrateHomeFeedDisplayOrderFromStorage(),
      ]);
      if (!alive) return;

      if (displayPayload?.rows?.length) {
        stableDisplayRowsRef.current = displayPayload.rows;
        setStableDisplayRows(displayPayload.rows);
        setLoading(false);
      }
      setDisplayOrderCacheReady(true);

      if (!payload?.rows?.length) return;

      const paging = getHomeFeedPagingState();
      feedNextCursorRef.current = paging.nextCursor;
      feedHasMoreRef.current = paging.hasMore;
      setFeedHasMore(paging.hasMore);

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
  }, [youtubeLayout]);

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

  useEffect(() => {
    if (appActive) return;
    pauseAllHomeFeedVideos({ reason: "app-background" });
  }, [appActive]);

  const applyFeedPagingState = useCallback(
    (
      paging: { hasMore: boolean; nextCursor: string | null },
      opts?: { allowSessionOverwrite?: boolean; pagingApplied?: boolean }
    ) => {
      if (opts?.pagingApplied === false) {
        console.log("KRISTO_HOME_FEED_PAGING_STATE_DECISION", {
          action: "preserve",
          reason: "caller-pagingApplied-false",
          priorHasMore: feedHasMoreRef.current,
          priorNextCursor: feedNextCursorRef.current,
          resultHasMore: feedHasMoreRef.current,
          resultNextCursor: feedNextCursorRef.current,
        });
        return;
      }
      if (
        hasHomeFeedYoutubeStreamSession() &&
        opts?.allowSessionOverwrite !== true &&
        shouldBlockHomeFeedYoutubeBackgroundUiMutation("paging", false)
      ) {
        return;
      }

      feedHasMoreRef.current = paging.hasMore;
      feedNextCursorRef.current = paging.hasMore ? paging.nextCursor : null;
      setFeedHasMore(paging.hasMore);
      if (!paging.hasMore) {
        youtubeStreamExhaustedRef.current = true;
      } else {
        youtubeStreamExhaustedRef.current = false;
      }

      saveHomeFeedYoutubeStreamSession({
        nextCursor: feedNextCursorRef.current,
        hasMore: paging.hasMore,
        loadedPageCount: getHomeFeedLoadedPageCount(),
      });
    },
    []
  );

  const commitYoutubeStreamAppend = useCallback((incoming: any[]) => {
    const appended = appendHomeFeedYoutubeStreamRows(incoming);
    if (appended > 0) {
      youtubeStreamRowsRef.current = peekHomeFeedYoutubeStreamSessionRows();
      saveHomeFeedYoutubeStreamSession({
        loadedPageCount: getHomeFeedLoadedPageCount(),
        nextCursor: feedNextCursorRef.current,
        hasMore: feedHasMoreRef.current,
      });
      freezeHomeFeedDisplayOrder(youtubeStreamRowsRef.current);
      bumpYoutubeRows();
    }
    return appended;
  }, []);

  const runHomeFeedStalePagingRevalidate = useCallback(
    async (reason: "mount" | "focus") => {
      if (!youtubeLayout) return;
      if (homeFeedStalePagingSettledRef.current) return;
      if (homeFeedStalePagingAttemptedThisFocusRef.current) return;
      if (homeFeedStalePagingInflightRef.current) return;

      const loadedPages = getHomeFeedLoadedPageCount();
      const loadedRows = youtubeStreamRowsRef.current.length;
      const eligible = shouldRevalidateStaleHomeFeedExhaustion({
        loadedPages,
        loadedRows,
        firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
        hasMore: feedHasMoreRef.current,
        nextCursor: feedNextCursorRef.current,
      });
      if (!eligible) return;

      homeFeedStalePagingAttemptedThisFocusRef.current = true;
      homeFeedStalePagingInflightRef.current = true;
      try {
        const result = await revalidateHomeFeedYoutubeStaleExhaustion({
          reason,
          loadedPages,
          loadedRows,
          hasMore: feedHasMoreRef.current,
          nextCursor: feedNextCursorRef.current,
        });
        if (!result.attempted) return;

        if (result.preserved) {
          // Failed/stale/uncertain — keep prior paging; allow a later focus to retry.
          return;
        }

        homeFeedStalePagingSettledRef.current = true;
        applyFeedPagingState(result.paging, {
          allowSessionOverwrite: true,
          pagingApplied: true,
        });

        if (result.newRows.length) {
          commitYoutubeStreamAppend(result.newRows);
        }

        if (result.repaired) {
          youtubeStreamExhaustedRef.current = false;
          void prepareHomeFeedYoutubeNextPageSilently();
        }
      } finally {
        homeFeedStalePagingInflightRef.current = false;
      }
    },
    [applyFeedPagingState, commitYoutubeStreamAppend, youtubeLayout]
  );

  const logYoutubePrefetchSkipThrottled = useCallback(
    (reason: string, payload: Record<string, unknown>) => {
      if (reason === "no-more") return;
      const now = Date.now();
      const last = prefetchSkipLogAtRef.current[reason] ?? 0;
      if (now - last < HOME_FEED_YOUTUBE_PREFETCH_LOG_THROTTLE_MS) return;
      prefetchSkipLogAtRef.current[reason] = now;
      logHomeFeedNetworkTrace({
        event: "page-prefetch-skip-api",
        reason,
        ...payload,
      });
    },
    []
  );

  const resetYoutubeStreamPaginationState = useCallback(() => {
    youtubePageRevealCompleteRef.current = false;
    youtubePageVisualReadyRef.current = false;
    setYoutubePageVisualReady(false);
    youtubePageSettlingUntilMsRef.current = 0;
    youtubeVisualReadyGenerationRef.current += 1;
    youtubeUserScrollAfterVisualReadyRef.current = false;
    youtubeStagedForPageIndexRef.current = -1;
    youtubePaginationStagingRef.current = false;
    clearHomeFeedYoutubeSilentNextPagePrep();
    youtubeLastAppendedBatchRef.current = [];
    setYoutubeFeedPaginationLocked(true);
  }, []);

  const runYoutubePageVisualReadyGate = useCallback(async (batchRows: any[]) => {
    if (youtubePageVisualReadyRef.current && youtubePageRevealCompleteRef.current) {
      setYoutubeFeedPaginationLocked(false);
      return;
    }

    const generation = youtubeVisualReadyGenerationRef.current + 1;
    youtubeVisualReadyGenerationRef.current = generation;
    youtubePageVisualReadyRef.current = false;
    setYoutubePageVisualReady(false);
    youtubeUserScrollAfterVisualReadyRef.current = false;
    scrollGenerationAtLastAppendRef.current = userScrollGenerationRef.current;
    userHasScrolledSinceAppendRef.current = false;
    setYoutubeFeedPaginationLocked(true);

    const finishVisualReady = async () => {
      await runYoutubeVisualPrep(() =>
        awaitYoutubeBatchCoverGate(batchRows, {
          phase: "page-visual-ready",
          isCancelled: () => generation !== youtubeVisualReadyGenerationRef.current,
          avatarHeadCount: HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT,
        })
      );
      if (generation !== youtubeVisualReadyGenerationRef.current) return;

      youtubePageVisualReadyRef.current = true;
      setYoutubePageVisualReady(true);
      youtubePageSettlingUntilMsRef.current = 0;
      youtubeLastAppendedBatchRef.current = batchRows;

      console.log("KRISTO_HOME_FEED_PAGE_VISUAL_READY", {
        rowCount: youtubeStreamRowsRef.current.length,
        batchSize: batchRows.length,
      });

      saveHomeFeedYoutubeStreamSession({
        rows: youtubeStreamRowsRef.current,
        activeIndex: activeIndexRef.current,
        scrollY: Math.max(0, lastUserScrollYRef.current),
        pageRevealComplete: true,
        pageVisualReady: true,
      });
      freezeHomeFeedDisplayOrder(youtubeStreamRowsRef.current);

      setYoutubeFeedPaginationLocked(false);
      runAfterHomeFeedFirstCardMount(() => {
        void prepareHomeFeedYoutubeNextPageSilently();
      });
    };

    if (Platform.OS === "android") {
      kickoffYoutubePagePosterPrewarm(
        batchRows.slice(0, HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT)
      );
      runAfterHomeFeedFirstCardMount(() => {
        void finishVisualReady();
      });
      return;
    }

    await finishVisualReady();
  }, []);

  const restoreYoutubeStreamRows = useCallback(
    async (rows: any[], opts?: { coldStart?: boolean; fromCache?: boolean }) => {
      let videoRows = filterHomeFeedYoutubeStreamRows(rows);
      if (!videoRows.length) return;

      if (opts?.coldStart && videoRows.length > 1) {
        videoRows = rankHomeFeedYoutubeStreamRows(videoRows, homeFeedRowKey);
      }

      if (
        !opts?.coldStart &&
        youtubeStreamRowsRef.current.length >= videoRows.length &&
        youtubePageRevealCompleteRef.current
      ) {
        return;
      }

      const generation = youtubeRevealGenerationRef.current + 1;
      youtubeRevealGenerationRef.current = generation;
      const isFirstPageOnly =
        opts?.coldStart === true && videoRows.length <= HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE;
      const skipRevealGate = opts?.fromCache === true || Platform.OS === "android";

      if (isFirstPageOnly) {
        resetYoutubeStreamPaginationState();
        if (!skipRevealGate) {
          setYoutubeShowSkeleton(true);
        }
        if (skipRevealGate) {
          void waitForYoutubePage0RevealGate(videoRows, { skip: true });
        } else {
          await waitForYoutubePage0RevealGate(videoRows, { skip: false });
        }
        if (generation !== youtubeRevealGenerationRef.current) return;
      }

      youtubeStreamRowsRef.current = videoRows;
      replaceHomeFeedYoutubeStreamRows(videoRows);
      setBackendRows(videoRows);
      markHomeFeedStartupTiming("FIRST_DATA_COMMIT_TS", {
        rowCount: videoRows.length,
        source: opts?.fromCache ? "cache" : "restore",
      });
      setYoutubeShowSkeleton(false);
      setLoading(false);
      hadCacheOnMountRef.current = true;
      youtubePageRevealCompleteRef.current = true;
      bumpYoutubeRows();

      if (isFirstPageOnly) {
        void runYoutubePageVisualReadyGate(videoRows);
        return;
      }

      youtubePageVisualReadyRef.current = true;
      setYoutubePageVisualReady(true);
      youtubeUserScrollAfterVisualReadyRef.current = true;
      pageReadyLoggedRef.current = true;
      youtubeLastAppendedBatchRef.current = videoRows.slice(-HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE);
      setYoutubeFeedPaginationLocked(false);
      saveHomeFeedYoutubeStreamSession({
        rows: videoRows,
        activeIndex: activeIndexRef.current,
        scrollY: Math.max(0, lastUserScrollYRef.current),
        pageRevealComplete: true,
        pageVisualReady: true,
        loadedPageCount: getHomeFeedLoadedPageCount(),
        nextCursor: feedNextCursorRef.current,
        hasMore: feedHasMoreRef.current,
      });
      freezeHomeFeedDisplayOrder(videoRows);
    },
    [resetYoutubeStreamPaginationState, runYoutubePageVisualReadyGate]
  );

  const revealYoutubePage0 = useCallback(async (
    rows: any[],
    opts?: { progressive?: boolean; fromCache?: boolean }
  ) => {
    if (youtubeStreamRowsRef.current.length > 0 && youtubePageRevealCompleteRef.current) {
      return;
    }
    let videoRows = filterHomeFeedYoutubeStreamRows(rows);
    if (videoRows.length > 1) {
      videoRows = rankHomeFeedYoutubeStreamRows(videoRows, homeFeedRowKey);
    }
    const visible = videoRows.slice(0, HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE);
    if (!visible.length) return;

    const generation = youtubeRevealGenerationRef.current + 1;
    youtubeRevealGenerationRef.current = generation;
    const skipRevealGate = opts?.fromCache === true || Platform.OS === "android";
    if (!opts?.progressive || !youtubePageRevealCompleteRef.current) {
      resetYoutubeStreamPaginationState();
      if (!skipRevealGate) {
        setYoutubeShowSkeleton(true);
      }
    }

    if (skipRevealGate) {
      void waitForYoutubePage0RevealGate(visible, { skip: true });
    } else {
      await waitForYoutubePage0RevealGate(visible, { skip: false });
    }
    if (generation !== youtubeRevealGenerationRef.current) return;

    youtubeStreamRowsRef.current = visible;
    replaceHomeFeedYoutubeStreamRows(visible);
    setBackendRows(visible);
    markHomeFeedStartupTiming("FIRST_DATA_COMMIT_TS", {
      rowCount: visible.length,
      source: opts?.fromCache ? "cache" : opts?.progressive ? "android-progressive" : "page0",
    });
    setYoutubeShowSkeleton(false);
    setLoading(false);
    hadCacheOnMountRef.current = true;
    youtubePageRevealCompleteRef.current = true;
    bumpYoutubeRows();
    void runYoutubePageVisualReadyGate(visible);
  }, [resetYoutubeStreamPaginationState, runYoutubePageVisualReadyGate]);

  const topUpAndroidYoutubePage0 = useCallback(async (fullRows: any[]) => {
    let videoRows = filterHomeFeedYoutubeStreamRows(fullRows);
    if (!videoRows.length) return;
    if (videoRows.length > 1) {
      videoRows = rankHomeFeedYoutubeStreamRows(videoRows, homeFeedRowKey);
    }
    const fullVisible = videoRows.slice(0, HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE);
    const current = youtubeStreamRowsRef.current;
    const currentIds = current.map((row) => homeFeedRowKey(row)).filter(Boolean);
    const fullIds = fullVisible.map((row) => homeFeedRowKey(row)).filter(Boolean);
    const prefixMatch =
      currentIds.length > 0 &&
      currentIds.length <= fullIds.length &&
      currentIds.every((id, index) => id === fullIds[index]);

    console.log("KRISTO_HOME_FEED_ANDROID_PROGRESSIVE_TOPUP_DONE", {
      progressiveCount: current.length,
      fullCount: fullVisible.length,
      prefixMatch,
      appended: Math.max(0, fullVisible.length - current.length),
      firstIds: fullIds.slice(0, 8),
    });

    youtubeStreamRowsRef.current = fullVisible;
    replaceHomeFeedYoutubeStreamRows(fullVisible);
    setBackendRows(fullVisible);
    bumpYoutubeRows();

    if (fullVisible.length > current.length) {
      const currentIdSet = new Set(currentIds);
      const tail = fullVisible.filter((row) => {
        const id = homeFeedRowKey(row);
        return Boolean(id && !currentIdSet.has(id));
      });
      if (tail.length) {
        kickoffYoutubePagePosterPrewarm(tail);
        kickoffYoutubePageAvatarPrewarm(tail);
      }
    }

    saveHomeFeedYoutubeStreamSession({
      rows: fullVisible,
      pageRevealComplete: true,
      pageVisualReady: youtubePageVisualReadyRef.current,
    });
  }, [bumpYoutubeRows]);

  const loadFeedGenerationRef = useRef(0);

  const loadFeed = useCallback(async (reason = "load", opts?: { force?: boolean }) => {
    if (isHomeFeedRenderPaused()) return;

    const force = opts?.force === true;
    const forceFetch = force || reason === "cold-start-rotate";

    if (
      youtubeLayout &&
      hasHomeFeedYoutubeStreamSession() &&
      shouldBlockHomeFeedYoutubeBackgroundUiMutation(reason, forceFetch)
    ) {
      logHomeFeedNetworkTrace({
        event: "session-ui-blocked",
        reason,
        cachedRows: peekHomeFeedYoutubeStreamSessionRows().length,
      });
      if (reason === "focus" || reason === "poll") {
        void refreshHomeFeedYoutubeBackgroundCache(reason);
      }
      setLoading(false);
      return;
    }

    if (forceFetch && youtubeLayout) {
      youtubeStreamExhaustedRef.current = false;
      homeFeedStalePagingSettledRef.current = false;
      homeFeedStalePagingAttemptedThisFocusRef.current = false;
      youtubeRevealGenerationRef.current += 1;
      resetYoutubeStreamPaginationState();
      pageReadyLoggedRef.current = false;
      androidProgressiveRevealDoneRef.current = false;
      if (force) {
        clearHomeFeedYoutubeStreamSession();
      }
    }
    const refreshMode = resolveHomeFeedRefreshMode(reason, forceFetch);
    const applyVisibleRows = shouldApplyHomeFeedVisibleRowUpdate(reason, forceFetch);
    if (shouldRebuildHomeFeedDisplayOrder(reason, forceFetch)) {
      setDisplayOrderRebuildRequested(true);
      unfreezeHomeFeedDisplayOrder();
    } else if (forceFetch || shouldHardRefreshHomeFeed(reason, forceFetch)) {
      unfreezeHomeFeedDisplayOrder();
    }
    const cachedRows = getCachedHomeFeedBackendRows();
    const loadGeneration = loadFeedGenerationRef.current;

    logHomeFeedNetworkTrace({
      event: "load-feed",
      reason,
      force: forceFetch,
      refreshMode,
      cachedRows: cachedRows.length,
    });

    if (refreshMode === "skip") {
      if (cachedRows.length && applyVisibleRows) {
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
    } else if (refreshMode === "background" && cachedRows.length && applyVisibleRows) {
      logHomeFeedNetworkTrace({
        event: "swr-background",
        reason,
        cachedRows: cachedRows.length,
      });
      setBackendRows((prev) => (prev.length ? prev : cachedRows));
    }

    try {
      const enableAndroidProgressiveReveal =
        youtubeLayout &&
        Platform.OS === "android" &&
        reason === "load" &&
        refreshMode === "required" &&
        !hasHomeFeedYoutubeStreamSession();

      const rows = await fetchHomeFeedFromApi(reason, {
        force: forceFetch,
        reconcile: true,
        onAndroidProgressiveReveal: enableAndroidProgressiveReveal
          ? (partial, meta) => {
              if (loadGeneration !== loadFeedGenerationRef.current) return;
              if (youtubePageRevealCompleteRef.current) return;
              androidProgressiveRevealDoneRef.current = true;
              console.log("KRISTO_HOME_FEED_ANDROID_PROGRESSIVE_REVEAL", {
                revealCount: partial.length,
                collectedSoFar: meta.collectedSoFar,
                apiPass: meta.apiPass,
                rowIds: partial.map((row) => homeFeedRowKey(row)).filter(Boolean),
              });
              startYoutubeHomeFeedVisiblePosterPrewarm(partial);
              void revealYoutubePage0(partial, { progressive: true });
            }
          : undefined,
      });
      if (loadGeneration !== loadFeedGenerationRef.current) {
        logHomeFeedNetworkTrace({ event: "load-feed-stale", reason });
        return;
      }
      if (rows.length) {
        if (!isHomeFeedPosterPrewarmDisabled() && shouldReplaceHomeFeedYoutubeStreamUi(reason, forceFetch)) {
          const feedIdentity = describePosterFeedIdentity(rows);
          if (feedIdentity.normalizedFeedKey) {
            const previousNormalizedFeedKey = lastPosterRefreshFeedKeyRef.current;
            const previousNormalizedInitialSignature = lastPosterInitialSignatureRef.current;
            if (
              !posterFeedIdentitySetsEqual(
                previousNormalizedFeedKey,
                feedIdentity.normalizedFeedKey
              ) ||
              !posterFeedIdentitySetsEqual(
                previousNormalizedInitialSignature,
                feedIdentity.normalizedInitialSignature || ""
              )
            ) {
              console.log("KRISTO_HOME_FEED_POSTER_REFRESH_KEY_CHANGE", {
                reason,
                rawFeedKey: feedIdentity.rawFeedKey,
                normalizedFeedKey: feedIdentity.normalizedFeedKey,
                rawInitialSignature: feedIdentity.rawInitialSignature,
                normalizedInitialSignature: feedIdentity.normalizedInitialSignature,
                previousNormalizedFeedKey: previousNormalizedFeedKey || null,
                nextNormalizedFeedKey: feedIdentity.normalizedFeedKey,
                previousNormalizedInitialSignature: previousNormalizedInitialSignature || null,
                nextNormalizedInitialSignature: feedIdentity.normalizedInitialSignature,
                rowIds: feedIdentity.rawRowIds,
                normalizedRowIds: feedIdentity.normalizedRowIds,
                renderKeys: rows
                  .slice(0, 8)
                  .map((row) => feedRenderKey(row) || String(row?.id || "").trim())
                  .filter(Boolean),
              });
            }
            lastPosterRefreshFeedKeyRef.current = feedIdentity.normalizedFeedKey;
            lastPosterInitialSignatureRef.current =
              feedIdentity.normalizedInitialSignature || "";
            resetHomeFeedPosterPrewarmForFeedRefresh(rows);
          }
        }
        if (applyVisibleRows) {
          if (youtubeLayout) {
            if (reason === "cold-start-rotate" && hasHomeFeedYoutubeStreamSession()) {
              const merged = mergeYoutubeColdStartRotation(
                youtubeStreamRowsRef.current,
                rows
              );
              void restoreYoutubeStreamRows(merged, { coldStart: true });
            } else if (
              Platform.OS === "android" &&
              loadGeneration === loadFeedGenerationRef.current
            ) {
              const collectedVideos = filterHomeFeedYoutubeStreamRows(rows);
              const visibleCount = youtubeStreamRowsRef.current.length;
              if (collectedVideos.length > visibleCount) {
                const waitStart = Date.now();
                while (
                  visibleCount > 0 &&
                  !youtubePageRevealCompleteRef.current &&
                  Date.now() - waitStart < 2500 &&
                  loadGeneration === loadFeedGenerationRef.current
                ) {
                  await new Promise((resolve) => setTimeout(resolve, 32));
                }
                if (loadGeneration === loadFeedGenerationRef.current) {
                  console.log("KRISTO_HOME_FEED_ANDROID_TOPUP_FORCED", {
                    visibleCount,
                    collectedCount: collectedVideos.length,
                    targetFirstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
                    pageRevealComplete: youtubePageRevealCompleteRef.current,
                    progressiveRevealDone: androidProgressiveRevealDoneRef.current,
                    reason,
                  });
                  if (youtubePageRevealCompleteRef.current || visibleCount === 0) {
                    await topUpAndroidYoutubePage0(rows);
                  } else {
                    void revealYoutubePage0(rows);
                  }
                }
              }
              androidProgressiveRevealDoneRef.current = false;
            } else if (!hasHomeFeedYoutubeStreamSession()) {
              if (rows.length > HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE) {
                void restoreYoutubeStreamRows(rows, { coldStart: true });
              } else {
                void revealYoutubePage0(rows);
              }
            }
          } else {
            applyBackendRowsIfChanged(rows);
            if (!isHomeFeedYouTubeStyleVideo()) {
              setStableDisplayRows((prev) => {
                if (!prev.length) {
                  stableDisplayRowsRef.current = rows;
                  return rows;
                }
                const rowIds = new Set(rows.map((row) => homeFeedRowKey(row)).filter(Boolean));
                const next = prev.filter((row) => homeFeedRowIncludedInBackendSnapshot(row, rowIds));
                stableDisplayRowsRef.current = next.length ? next : prev;
                return next.length ? next : prev;
              });
            }
          }
        }
      }
      syncHomeFeedEngagementFromServerLikes(rows, buildServerLikeMap(rows));
      if (!hasHomeFeedYoutubeStreamSession() || shouldReplaceHomeFeedYoutubeStreamUi(reason, forceFetch)) {
        const paging = getHomeFeedPagingState();
        applyFeedPagingState(paging, { allowSessionOverwrite: true });
      }
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
        if (youtubeLayout && hasHomeFeedYoutubeStreamSession()) {
          return;
        }
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
  }, [forceReloadAfterSchedule, loadFeed, youtubeLayout]);

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

      if (youtubeLayout && removeHomeFeedYoutubeStreamPost(target)) {
        youtubeStreamRowsRef.current = peekHomeFeedYoutubeStreamSessionRows();
        setBackendRows(youtubeStreamRowsRef.current);
        bumpYoutubeRows();
      }
    });
  }, [youtubeLayout]);

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
    if (!displayOrderCacheReady) return;

    const session = getSessionSync() as any;
    const churchId = String(session?.churchId || "").trim();

    if (screenFocused) {
      loadFeedGenerationRef.current += 1;
      const dirty = consumeHomeFeedScheduleDirty(churchId);
      if (dirty) {
        forceReloadAfterSchedule("schedule-dirty-focus", dirty.backendFeedId);
        return;
      }
      if (youtubeLayout) {
        const youtubeSession = peekHomeFeedYoutubeStreamSession();
        if (isPartialHomeFeedYoutubeStreamSession(youtubeSession)) {
          console.log("KRISTO_HOME_FEED_SESSION_PARTIAL_IGNORED", {
            rowCount: youtubeSession.rows.length,
            hasMore: youtubeSession.hasMore,
            source: "focus-restore",
            firstPageSize: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
          });
          clearHomeFeedYoutubeStreamSession();
          startupFeedRequestedRef.current = true;
          void loadFeed("load");
          return;
        }
      }
      if (youtubeLayout && hasHomeFeedYoutubeStreamSession()) {
        if (coldStartRotationPendingRef.current) {
          coldStartRotationPendingRef.current = false;
          startupFeedRequestedRef.current = true;
          void loadFeed("cold-start-rotate");
          return;
        }
        if (!startupFeedRequestedRef.current) {
          startupFeedRequestedRef.current = true;
        }
        logHomeFeedSessionRestored("focus");
        void (async () => {
          await runHomeFeedStalePagingRevalidate("focus");
          void refreshHomeFeedYoutubeBackgroundCache("focus");
        })();
        return;
      }
      if (!startupFeedRequestedRef.current) {
        startupFeedRequestedRef.current = true;
        void loadFeed("load");
        return;
      }
      if (!isHomeFeedDisplayOrderFrozen()) {
        void loadFeed("focus");
      } else {
        void loadFeed("poll");
      }
      return;
    }

    bumpHomeFeedFetchGeneration("blur");
    loadFeedGenerationRef.current += 1;
    homeFeedStalePagingAttemptedThisFocusRef.current = false;
  }, [
    loadFeed,
    screenFocused,
    forceReloadAfterSchedule,
    displayOrderCacheReady,
    youtubeLayout,
    runHomeFeedStalePagingRevalidate,
  ]);

  // Mount path: revalidate stale one-page exhaustion after session restore paints.
  useEffect(() => {
    if (!youtubeLayout || !displayOrderCacheReady) return;
    if (!hasHomeFeedYoutubeStreamSession()) return;
    void runHomeFeedStalePagingRevalidate("mount");
  }, [youtubeLayout, displayOrderCacheReady, runHomeFeedStalePagingRevalidate]);

  useEffect(() => {
    if (!feedFocused || videoModalPayload) return;
    const timer = setInterval(() => {
      void loadFeed("poll");
    }, 45000);
    return () => clearInterval(timer);
  }, [feedFocused, loadFeed, videoModalPayload]);

  useEffect(() => {
    if (!feedFocused || homeFeedRenderPaused || isHomeFeedDisplayOrderFrozen()) return;
    const timer = setInterval(() => {
      setScheduleTick(Math.floor(Date.now() / 30_000));
    }, 30_000);
    return () => clearInterval(timer);
  }, [feedFocused, homeFeedRenderPaused]);

  const localFeedSnapshot = useMemo(() => {
    if (isHomeFeedDisplayOrderFrozen()) return [];
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

    runAfterHomeDeferredStartup(
      () => {
        loadSubscription();
      },
      { reason: "home-feed-church-subscription" }
    );

    return () => {
      cancelled = true;
    };
  }, [viewerChurchId, viewerUserId, session?.role]);

  const feedRows = useMemo(() => {
    if (youtubeLayout) {
      return youtubeStreamRows;
    }

    if (isHomeFeedDisplayOrderFrozen()) {
      return stableDisplayRowsRef.current.length
        ? stableDisplayRowsRef.current
        : stableDisplayRows;
    }

    if (youtubeLayout) {
      if (!displayOrderCacheReady) {
        return stableDisplayRowsRef.current.length
          ? stableDisplayRowsRef.current
          : stableDisplayRows;
      }

      if (displayOrderRebuildRequested) {
        return buildHomeFeedDisplayRows(backendRows, localFeedSnapshot, Date.now(), {
          rebuildPersonalOrder: true,
          rebuildReason: "force",
          force: true,
        });
      }

      const cachedBase =
        stableDisplayRowsRef.current.length
          ? stableDisplayRowsRef.current
          : stableDisplayRows.length
            ? stableDisplayRows
            : peekHomeFeedDisplayOrderSync();

      if (cachedBase.length) {
        if (!backendRows.length && !localFeedSnapshot.length) {
          return cachedBase;
        }
        return mergeCachedHomeFeedDisplayOrder(cachedBase, backendRows, localFeedSnapshot);
      }

      return buildHomeFeedDisplayRows(backendRows, localFeedSnapshot, Date.now(), {
        rebuildPersonalOrder: true,
        rebuildReason: "first-install",
        force: true,
      });
    }

    if (homeFeedRenderPaused && backendRows.length) {
      return backendRows;
    }
    return buildHomeFeedDisplayRows(backendRows, localFeedSnapshot, Date.now(), {
      rebuildPersonalOrder: displayOrderRebuildRequested,
      rebuildReason: displayOrderRebuildRequested ? "force" : "",
      force: displayOrderRebuildRequested,
    });
  }, [
    backendRows,
    localFeedSnapshot,
    homeFeedRenderPaused,
    stableDisplayRows,
    youtubeLayout,
    youtubeStreamRows,
    localFeedDigest,
    displayOrderCacheReady,
    displayOrderRebuildRequested,
  ]);

  const displayFeedRows = useMemo(() => {
    const hasUserBlocks = blockedUserIdSet.size > 0;
    const hasChurchBlocks = excludedChurchIdSet.size > 0;
    if (!hasUserBlocks && !hasChurchBlocks) return feedRows;

    return feedRows.filter((row) => {
      if (hasChurchBlocks) {
        const churchId = normalizeFeedChurchId(homeFeedRowChurchId(row));
        if (churchId && excludedChurchIdSet.has(churchId)) return false;
      }
      if (hasUserBlocks) {
        const authorUserId = resolveRowAuthorUserId(row);
        if (authorUserId && blockedUserIdSet.has(authorUserId)) return false;
      }
      return true;
    });
  }, [feedRows, blockedUserIdSet, excludedChurchIdSet, resolveRowAuthorUserId]);

  useEffect(() => {
    if (isHomeFeedDisplayOrderFrozen()) return;
    if (youtubeLayout) return;
    if (!displayOrderRebuildRequested) return;
    const incoming = displayFeedRows;
    if (!incoming.length && stableDisplayRowsRef.current.length) return;

    setDisplayOrderRebuildRequested(false);

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
  }, [displayFeedRows, displayOrderRebuildRequested]);

  useEffect(() => {
    if (isHomeFeedDisplayOrderFrozen()) return;
    if (youtubeLayout) return;
    if (!displayOrderCacheReady || displayOrderRebuildRequested) return;

    const cachedBase =
      stableDisplayRowsRef.current.length
        ? stableDisplayRowsRef.current
        : stableDisplayRows.length
          ? stableDisplayRows
          : peekHomeFeedDisplayOrderSync();
    if (!cachedBase.length) return;
    if (!backendRows.length && !localFeedSnapshot.length) return;

    const merged = mergeCachedHomeFeedDisplayOrder(cachedBase, backendRows, localFeedSnapshot);
    if (!merged.length) return;

    stableDisplayRowsRef.current = merged;
    setStableDisplayRows((prev) => {
      if (
        homeFeedBackendRowsDigest(prev) === homeFeedBackendRowsDigest(merged) &&
        prev.length === merged.length
      ) {
        return prev;
      }
      return merged;
    });
  }, [backendRows, localFeedSnapshot, displayOrderCacheReady, stableDisplayRows.length, displayOrderRebuildRequested]);

  useEffect(() => {
    if (youtubeLayout) {
      if (
        hasHomeFeedYoutubeStreamSession() &&
        (youtubePageVisualReadyRef.current || youtubeSessionOnMount.pageVisualReady)
      ) {
        pageReadyLoggedRef.current = true;
        return;
      }
      if (!youtubeStreamRows.length || pageReadyLoggedRef.current) return;
      pageReadyLoggedRef.current = true;
      console.log("KRISTO_HOME_FEED_PAGE_READY", {
        visibleCount: youtubeStreamRows.length,
        totalCached: youtubeStreamRows.length,
        activeIndex: 0,
        reason: "youtube-stream-page0",
      });
      logFirstPaintReady("HomeFeed", {
        reason: "page-ready",
        visibleCount: youtubeStreamRows.length,
      });
      setTimeout(() => markHomeFeedReadyForBackgroundWork(), 1500);
      return;
    }

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
  }, [stableDisplayRows.length, youtubeLayout, youtubeStreamRows.length]);

  const getYoutubePrefetchBlockReason = useCallback(
    (metrics: HomeFeedYoutubeScrollMetrics, rowCount: number): string | null => {
      if (youtubePaginationStagingRef.current || appendMoreInflightRef.current) {
        return "staging-inflight";
      }
      if (isYoutubeFeedPaginationLocked()) return "pagination-locked";
      const lastBatch = youtubeLastAppendedBatchRef.current;
      if (lastBatch.length && isHomeFeedPosterPipelineBusyForRows(lastBatch)) {
        return "poster-pipeline-busy";
      }
      if (isHomeFeedYoutubeSilentNextPagePrepInflight()) return "silent-prep-inflight";
      if (youtubeShowSkeleton || !rowCount) return "skeleton";
      if (!youtubePageRevealCompleteRef.current) return "reveal-incomplete";
      if (!youtubePageVisualReadyRef.current) return "page-not-visual-ready";
      if (Date.now() < youtubePageSettlingUntilMsRef.current) return "page-settling";
      if (!feedHasMoreRef.current) return "no-more";
      if (Date.now() < appendCooldownUntilMsRef.current) return "append-cooldown";
      if (
        rowCount < HOME_FEED_YOUTUBE_MIN_ROWS_BEFORE_PAGINATION &&
        !isYoutubeFeedListOverflowing(metrics)
      ) {
        return "sparse-batch";
      }
      if (!shouldPrefetchHomeFeedYoutubeStreamByScroll(metrics)) return "not-near-end";
      if (!youtubeUserScrollAfterVisualReadyRef.current) return "no-scroll-after-visual-ready";
      if (userScrollGenerationRef.current <= scrollGenerationAtLastAppendRef.current) {
        return "no-scroll-gen";
      }
      const stagingPageIndex = getHomeFeedLoadedPageCount();
      if (
        feedHasMoreRef.current &&
        !isHomeFeedYoutubeSilentNextPagePrepReady(stagingPageIndex)
      ) {
        return "silent-prep-pending";
      }
      if (youtubeStagedForPageIndexRef.current === stagingPageIndex) return "already-staged";
      return null;
    },
    [youtubeShowSkeleton]
  );

  const getYoutubeStagedAppendBlockReason = useCallback(
    (rowCount: number): string | null => {
      if (!feedHasMoreRef.current) return "no-more";
      if (appendMoreInflightRef.current) return "inflight";
      if (isYoutubeFeedPaginationLocked()) return "pagination-locked";
      const lastBatch = youtubeLastAppendedBatchRef.current;
      if (lastBatch.length && isHomeFeedPosterPipelineBusyForRows(lastBatch)) {
        return "poster-pipeline-busy";
      }
      if (isHomeFeedYoutubeSilentNextPagePrepInflight()) return "silent-prep-inflight";
      const nextPageIndex = getHomeFeedLoadedPageCount();
      if (!isHomeFeedYoutubeSilentNextPagePrepReady(nextPageIndex)) {
        return "silent-prep-pending";
      }
      if (!youtubePageRevealCompleteRef.current) return "reveal-incomplete";
      if (!youtubePageVisualReadyRef.current) return "page-not-visual-ready";
      if (Date.now() < youtubePageSettlingUntilMsRef.current) return "page-settling";
      if (!rowCount) return "skeleton";
      return null;
    },
    []
  );

  const handleYoutubeUserScroll = useCallback(
    (metrics: HomeFeedYoutubeScrollMetrics, source: "drag" | "momentum" | "scroll") => {
      youtubeScrollMetricsRef.current = metrics;
      if (source === "scroll") {
        if (Math.abs(metrics.scrollY - lastUserScrollYRef.current) < 12) return;
      }
      lastUserScrollYRef.current = metrics.scrollY;
      userScrollGenerationRef.current += 1;
      userHasScrolledSinceAppendRef.current = true;
      if (youtubePageVisualReadyRef.current) {
        youtubeUserScrollAfterVisualReadyRef.current = true;
      }
      const scrollY = Math.max(0, Number(metrics.scrollY) || 0);
      saveHomeFeedYoutubeStreamSession({ scrollY });
      notifyHomeFeedUserScrollActivity();
    },
    []
  );

  const runYoutubePageAppend = useCallback(async () => {
    if (!feedHasMoreRef.current || appendMoreInflightRef.current) return;

    const rowCount = youtubeStreamRowsRef.current.length;
    const block = getYoutubeStagedAppendBlockReason(rowCount);
    if (block) {
      appendCooldownUntilMsRef.current = Date.now() + 1500;
      if (block !== "no-more") {
        logYoutubePrefetchSkipThrottled(`staged-append-${block}`, {
          rowCount,
          distanceFromEnd: youtubeStreamDistanceFromEnd(youtubeScrollMetricsRef.current),
        });
      }
      return;
    }

    youtubeStagedForPageIndexRef.current = -1;
    appendMoreInflightRef.current = true;
    const before = youtubeStreamRowsRef.current.length;
    const nextPageIndex = getHomeFeedLoadedPageCount();
    const pageLimit = homeFeedYoutubeStreamLimitForPage(nextPageIndex);
    const cursor = feedNextCursorRef.current ?? String(before);

    console.log("KRISTO_HOME_FEED_APPEND_MORE_START", {
      before,
      cursor,
      pageIndex: nextPageIndex,
      pageLimit,
      loadedDisplayRows: before,
    });

    try {
      await ensureHomeFeedYoutubeSilentNextPagePrepared();

      setYoutubeFeedPaginationLocked(true);

      const page = await fetchHomeFeedNextPage(cursor, pageLimit);
      applyFeedPagingState(
        { hasMore: page.hasMore, nextCursor: page.nextCursor },
        {
          allowSessionOverwrite: true,
          pagingApplied: page.pagingApplied !== false,
        }
      );

      let afterCount = youtubeStreamRowsRef.current.length;
      if (page.appended > 0 && page.newRows.length) {
        youtubePageVisualReadyRef.current = false;
        setYoutubePageVisualReady(false);
        syncHomeFeedEngagementFromServerLikes(page.rows, buildServerLikeMap(page.rows));

        await runYoutubeVisualPrep(() =>
          awaitYoutubeBatchCoverGate(page.newRows, { phase: "pre-append" })
        );

        commitYoutubeStreamAppend(page.newRows);
        afterCount = youtubeStreamRowsRef.current.length;
        youtubeLastAppendedBatchRef.current = page.newRows;
        scrollGenerationAtLastAppendRef.current = userScrollGenerationRef.current;
        userHasScrolledSinceAppendRef.current = false;
        youtubeUserScrollAfterVisualReadyRef.current = false;
        appendCooldownUntilMsRef.current = Date.now() + HOME_FEED_YOUTUBE_APPEND_COOLDOWN_MS;
        youtubePageSettlingUntilMsRef.current = Date.now() + resolveYoutubePageSettlingMs();

        await runYoutubeVisualPrep(() =>
          awaitYoutubeBatchCoverGate(page.newRows, { phase: "post-append" })
        );

        youtubePageVisualReadyRef.current = true;
        setYoutubePageVisualReady(true);

        console.log("KRISTO_HOME_FEED_PAGE_VISUAL_READY", {
          rowCount: afterCount,
          batchSize: page.newRows.length,
        });

        saveHomeFeedYoutubeStreamSession({
          rows: youtubeStreamRowsRef.current,
          activeIndex: activeIndexRef.current,
          scrollY: Math.max(0, lastUserScrollYRef.current),
          pageRevealComplete: true,
          pageVisualReady: true,
          loadedPageCount: getHomeFeedLoadedPageCount(),
          nextCursor: feedNextCursorRef.current,
          hasMore: feedHasMoreRef.current,
        });
        freezeHomeFeedDisplayOrder(youtubeStreamRowsRef.current);

        setYoutubeFeedPaginationLocked(false);
        void prepareHomeFeedYoutubeNextPageSilently();
      } else {
        setYoutubeFeedPaginationLocked(false);
      }

      console.log("KRISTO_HOME_FEED_APPEND_MORE_DONE", {
        before,
        incoming: page.incoming,
        appended: page.appended,
        merged: Math.max(0, afterCount - before),
        after: afterCount,
        nextCursor: feedNextCursorRef.current,
        hasMore: page.hasMore,
      });
    } catch (error) {
      console.log("KRISTO_HOME_FEED_APPEND_MORE_ERROR", {
        cursor,
        message: error instanceof Error ? error.message : String(error),
      });
      setYoutubeFeedPaginationLocked(false);
    } finally {
      appendMoreInflightRef.current = false;
    }
  }, [
    applyFeedPagingState,
    buildServerLikeMap,
    getYoutubeStagedAppendBlockReason,
    logYoutubePrefetchSkipThrottled,
    commitYoutubeStreamAppend,
  ]);

  const tryYoutubeStreamPrefetch = useCallback(
    (metrics?: HomeFeedYoutubeScrollMetrics) => {
      if (!youtubeLayout || !feedFocused) return;
      if (youtubeStreamExhaustedRef.current || !feedHasMoreRef.current) return;
      if (youtubePaginationStagingRef.current || appendMoreInflightRef.current) {
        return;
      }

      if (metrics) {
        youtubeScrollMetricsRef.current = metrics;
      }
      const scrollMetrics = youtubeScrollMetricsRef.current;
      const rowCount = youtubeStreamRowsRef.current.length;
      const block = getYoutubePrefetchBlockReason(scrollMetrics, rowCount);
      if (block) {
        if (block === "silent-prep-pending") {
          void ensureHomeFeedYoutubeSilentNextPagePrepared().then(() => {
            tryYoutubeStreamPrefetch(scrollMetrics);
          });
        }
        if (
          block !== "no-more" &&
          block !== "already-staged" &&
          block !== "staging-inflight" &&
          block !== "silent-prep-pending" &&
          block !== "silent-prep-inflight"
        ) {
          logYoutubePrefetchSkipThrottled(block, {
            rowCount,
            distanceFromEnd: youtubeStreamDistanceFromEnd(scrollMetrics),
            scrollY: scrollMetrics.scrollY,
            contentHeight: scrollMetrics.contentHeight,
            viewportHeight: scrollMetrics.viewportHeight,
          });
        }
        return;
      }

      const stagingPageIndex = getHomeFeedLoadedPageCount();
      youtubeStagedForPageIndexRef.current = stagingPageIndex;
      youtubePaginationStagingRef.current = true;

      void (async () => {
        try {
          const ready = await ensureHomeFeedYoutubeSilentNextPagePrepared();
          if (!ready) return;

          const appendBlock = getYoutubeStagedAppendBlockReason(
            youtubeStreamRowsRef.current.length
          );
          if (appendBlock) {
            if (appendBlock !== "no-more") {
              logYoutubePrefetchSkipThrottled(`staged-append-${appendBlock}`, {
                rowCount: youtubeStreamRowsRef.current.length,
                distanceFromEnd: youtubeStreamDistanceFromEnd(scrollMetrics),
              });
            }
            return;
          }

          console.log("KRISTO_HOME_FEED_BOTTOM_LOADING_START", {
            loadedRows: rowCount,
            pageIndex: stagingPageIndex,
            distanceFromEnd: youtubeStreamDistanceFromEnd(scrollMetrics),
            mode: "youtube-stream-silent",
            scrollGen: userScrollGenerationRef.current,
          });

          await runYoutubePageAppend();
        } finally {
          youtubePaginationStagingRef.current = false;
          if (youtubeStagedForPageIndexRef.current === stagingPageIndex) {
            youtubeStagedForPageIndexRef.current = -1;
          }
        }
      })();
    },
    [
      youtubeLayout,
      feedFocused,
      getYoutubePrefetchBlockReason,
      getYoutubeStagedAppendBlockReason,
      logYoutubePrefetchSkipThrottled,
      runYoutubePageAppend,
    ]
  );

  const loadMoreFeedPage = useCallback(async () => {
    if (!feedHasMoreRef.current || appendMoreInflightRef.current) return;

    const now = Date.now();
    if (now - lastNearEndLoadAtMsRef.current < 3000) {
      logHomeFeedNetworkTrace({
        event: "page-prefetch-skip-api",
        reason: "append-more-throttled",
      });
      return;
    }
    lastNearEndLoadAtMsRef.current = now;

    appendMoreInflightRef.current = true;
    setLoadingMore(true);

    const before = getCachedHomeFeedBackendCount();
    const cursor = feedNextCursorRef.current ?? String(before);

    console.log("KRISTO_HOME_FEED_APPEND_MORE_START", {
      before,
      cursor,
      loadedDisplayRows: stableDisplayRowsRef.current.length,
    });

    try {
      const page = await fetchHomeFeedNextPage(cursor, HOME_FEED_PAGE_SIZE);

      applyFeedPagingState(
        { hasMore: page.hasMore, nextCursor: page.nextCursor },
        { pagingApplied: page.pagingApplied !== false }
      );

      if (page.appended > 0 && page.newRows.length) {
        syncHomeFeedEngagementFromServerLikes(page.rows, buildServerLikeMap(page.rows));
        applyBackendRowsIfChanged(page.rows);
        setStableDisplayRows((prev) => {
          const result = stableMergeHomeFeedRows(prev, page.newRows);
          stableDisplayRowsRef.current = result.merged;
          if (isHomeFeedDisplayOrderFrozen()) {
            freezeHomeFeedDisplayOrder(result.merged);
          }
          void saveHomeFeedDisplayOrderCache(result.merged);
          return result.merged;
        });

        const loaded = stableDisplayRowsRef.current.length;
        setVisibleWindowSize((prev) =>
          Math.min(loaded, nextHomeFeedVisibleWindowSize(prev, loaded, HOME_FEED_PAGE_SIZE))
        );
      }

      console.log("KRISTO_HOME_FEED_APPEND_MORE_DONE", {
        before,
        incoming: page.incoming,
        appended: page.appended,
        after: getCachedHomeFeedBackendCount(),
        nextCursor: feedNextCursorRef.current,
        hasMore: page.hasMore,
      });
    } catch (error) {
      console.log("KRISTO_HOME_FEED_APPEND_MORE_ERROR", {
        cursor,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      appendMoreInflightRef.current = false;
      setLoadingMore(false);
    }
  }, [applyBackendRowsIfChanged, applyFeedPagingState, buildServerLikeMap]);

  const handleFeedEndReached = useCallback(() => {
    if (youtubeLayout) return;
    void loadMoreFeedPage();
  }, [loadMoreFeedPage, youtubeLayout]);

  // Near-end TikTok: expand visible window first, then fetch next API page.
  useEffect(() => {
    if (!feedFocused || youtubeLayout) return;
    if (!stableDisplayRows.length) return;

    const visibleCount = Math.min(visibleWindowSize, stableDisplayRows.length);
    if (!isHomeFeedNearEnd(activeIndex, visibleCount)) return;

    console.log("KRISTO_HOME_FEED_NEAR_END_TRIGGER", {
      activeIndex,
      visibleCount,
      loadedRows: stableDisplayRows.length,
      hasMore: feedHasMoreRef.current,
      mode: "tiktok-window",
    });

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
    if (nextLimit < stableDisplayRows.length) {
      return;
    }

    if (!feedHasMoreRef.current) return;
    void loadMoreFeedPage();
  }, [
    activeIndex,
    visibleWindowSize,
    stableDisplayRows.length,
    feedFocused,
    youtubeLayout,
    loadMoreFeedPage,
  ]);

  const visibleData = useMemo(() => {
    const rowSource =
      stableDisplayRows.length > 0 ? stableDisplayRows : displayFeedRows;

    if (youtubeLayout) {
      const windowSize = Math.min(
        visibleWindowSize,
        Math.max(1, rowSource.length - Math.max(0, activeIndex))
      );
      const windowed = rowSource.slice(
        Math.max(0, activeIndex),
        Math.max(0, activeIndex) + windowSize
      );
      if (windowed.length > 0) {
        lastVisibleRowsRef.current = windowed;
        return windowed;
      }
      return lastVisibleRowsRef.current;
    }

    const windowed = rowSource.slice(0, visibleWindowSize);

    if (windowed.length > 0) {
      lastVisibleRowsRef.current = windowed;
      return windowed;
    }
    return lastVisibleRowsRef.current;
  }, [stableDisplayRows, displayFeedRows, visibleWindowSize, activeIndex, youtubeLayout]);

  const filteredVisibleData = useMemo(
    () => filterHomeFeedRowsByPostKind(visibleData, feedPostFilter),
    [visibleData, feedPostFilter]
  );

  const moderatedYoutubeStreamRows = useMemo(() => {
    const hasUserBlocks = blockedUserIdSet.size > 0;
    const hasChurchBlocks = excludedChurchIdSet.size > 0;
    if (!hasUserBlocks && !hasChurchBlocks) return youtubeStreamRows;

    return youtubeStreamRows.filter((row) => {
      if (hasChurchBlocks) {
        const churchId = normalizeFeedChurchId(homeFeedRowChurchId(row));
        if (churchId && excludedChurchIdSet.has(churchId)) return false;
      }
      if (hasUserBlocks) {
        const authorUserId = resolveRowAuthorUserId(row);
        if (authorUserId && blockedUserIdSet.has(authorUserId)) return false;
      }
      return true;
    });
  }, [youtubeStreamRows, blockedUserIdSet, excludedChurchIdSet, resolveRowAuthorUserId]);

  const youtubeFeedRows = useMemo(() => {
    if (youtubeShowSkeleton) {
      return buildHomeFeedSkeletonRows();
    }
    const rows = dedupeHomeFeedRowsByKey(filterHomeFeedYoutubeStreamRows(moderatedYoutubeStreamRows));
    const deficit = HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE - rows.length;
    const showTailSkeletons =
      deficit > 0 &&
      feedHasMore &&
      rows.length > 0 &&
      rows.length < HOME_FEED_YOUTUBE_MIN_ROWS_BEFORE_PAGINATION &&
      !youtubePageVisualReady;

    if (showTailSkeletons) {
      return [...rows, ...buildHomeFeedSkeletonRows(deficit)];
    }
    return rows;
  }, [youtubeShowSkeleton, moderatedYoutubeStreamRows, feedHasMore, youtubePageVisualReady]);

  const feedListRows = youtubeLayout ? youtubeFeedRows : filteredVisibleData;
  const feedCaughtUp =
    youtubeLayout &&
    !youtubeShowSkeleton &&
    !feedHasMore &&
    youtubeStreamRows.length > 0;
  const youtubePrefetchEnabled =
    youtubeLayout &&
    feedHasMore &&
    !youtubeShowSkeleton &&
    !feedCaughtUp &&
    youtubePageVisualReady;
  const feedListRowsRef = useRef(feedListRows);
  const displayFeedRowsRef = useRef(displayFeedRows);
  feedListRowsRef.current = feedListRows;
  displayFeedRowsRef.current = displayFeedRows;

  const youtubeFirst20Rows = useMemo(
    () =>
      youtubeFeedRows
        .filter((row) => !isHomeFeedSkeletonRow(row))
        .slice(0, HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE),
    [youtubeFeedRows]
  );

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

  // Poster prewarm: YouTube uses metadata-only for visible page; inline TikTok uses full prewarm.
  useEffect(() => {
    if (backgroundMediaPaused || videoModalPayload) return;
    if (youtubeLayout) {
      if (!youtubeStreamRows.length) return;
      const run = () => startInitialHomeFeedPosterPrewarm(youtubeStreamRows);
      if (Platform.OS === "android") {
        runAfterHomeFeedFirstCardMount(run);
        return;
      }
      run();
      return;
    }
    if (isHomeFeedPosterPrewarmDisabled()) return;
    const rows = stableDisplayRows.length ? stableDisplayRows : displayFeedRows;
    if (!rows.length) return;
    const feedIdentity = describePosterFeedIdentity(rows);
    const initialSignature = feedIdentity.normalizedInitialSignature || "";
    if (
      !posterFeedIdentitySetsEqual(
        lastPosterInitialSignatureRef.current,
        initialSignature
      )
    ) {
      console.log("KRISTO_HOME_FEED_POSTER_INITIAL_SOURCE_CHANGE", {
        rawInitialSignature: feedIdentity.rawInitialSignature,
        normalizedInitialSignature: initialSignature || null,
        previousNormalizedInitialSignature: lastPosterInitialSignatureRef.current || null,
        nextNormalizedInitialSignature: initialSignature || null,
        rowIds: feedIdentity.rawRowIds,
        normalizedRowIds: feedIdentity.normalizedRowIds,
      });
      lastPosterInitialSignatureRef.current = initialSignature;
    }
    startInitialHomeFeedPosterPrewarm(rows);
  }, [stableDisplayRows, displayFeedRows, backgroundMediaPaused, videoModalPayload, youtubeLayout, youtubeStreamRows]);

  // Prewarm the next videos when the user nears the end of loaded content.
  useEffect(() => {
    if (isHomeFeedPosterPrewarmDisabled()) return;
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

  // Full-feed disk cache: inline autoplay only — YouTube caches on tap.
  useEffect(() => {
    if (isHomeFeedLazyMediaPrewarmEnabled()) return;
    if (!isHomeFeedVideoDiskCacheEnabled()) return;
    if (youtubeLayout) return;
    if (!stableDisplayRows.length || backgroundMediaPaused || videoModalPayload) return;
    scheduleHomeFeedVideoDiskCacheBackground(stableDisplayRows, activeIndex);
  }, [
    stableDisplayRows,
    activeIndex,
    backgroundMediaPaused,
    videoModalPayload,
    youtubeLayout,
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
    if (youtubeLayout && !displayOrderCacheReady) return;
    if (youtubeLayout && displayOrderCacheReady && visibleData.length === 0 && !hadCacheOnMountRef.current) {
      return;
    }
    if (loading && visibleData.length === 0) return;

    initialRenderSourceLoggedRef.current = true;
    const source: "cache" | "api" | "empty" =
      visibleData.length > 0
        ? hadCacheOnMountRef.current
          ? "cache"
          : "api"
        : "empty";
    console.log("KRISTO_HOME_FEED_INITIAL_RENDER_SOURCE", { source });
  }, [loading, visibleData.length, displayOrderCacheReady, youtubeLayout]);

  useEffect(() => {
    if (!youtubeLayout) return;
    if (first20VisibleLoggedRef.current) return;
    if (youtubeFirst20Rows.length < HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE) return;

    const first20VisibleMs = Date.now() - homeFeedMountAtRef.current;
    first20VisibleLoggedRef.current = true;
    console.log("KRISTO_HOME_FEED_FIRST_20_VISIBLE", {
      posterCount: HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE,
      preloadDurationMs: null,
      first20VisibleMs,
      deferredVideoCount: null,
    });
  }, [youtubeLayout, youtubeFirst20Rows.length]);

  useEffect(() => {
    if (!youtubeLayout) return;
    if (first20PosterDoneLoggedRef.current) return;
    if (!youtubeFirst20Rows.length) return;

    if (first20PosterStartAtRef.current == null) {
      first20PosterStartAtRef.current = Date.now();
      console.log("KRISTO_HOME_FEED_POSTER_PRELOAD_START", {
        posterCount: youtubeFirst20Rows.length,
        preloadDurationMs: 0,
        first20VisibleMs: first20VisibleLoggedRef.current
          ? Date.now() - homeFeedMountAtRef.current
          : null,
        deferredVideoCount: null,
      });
    }

    if (isHomeFeedPosterPipelineBusyForRows(youtubeFirst20Rows)) return;

    const startedAt = first20PosterStartAtRef.current ?? Date.now();
    const preloadDurationMs = Math.max(0, Date.now() - startedAt);
    first20PosterDoneLoggedRef.current = true;
    console.log("KRISTO_HOME_FEED_POSTER_PRELOAD_DONE", {
      posterCount: youtubeFirst20Rows.length,
      preloadDurationMs,
      first20VisibleMs: first20VisibleLoggedRef.current
        ? Date.now() - homeFeedMountAtRef.current
        : null,
      deferredVideoCount: null,
    });
  }, [youtubeLayout, youtubeFirst20Rows]);

  useEffect(() => {
    if (!youtubeLayout) return;
    if (!youtubeFirst20Rows.length) return;

    const leadingDeferredWindow = new Set<number>([
      Math.max(0, activeIndex),
      Math.max(0, activeIndex + 1),
      Math.max(0, activeIndex + 2),
    ]);
    const deferredVideoCount = youtubeFirst20Rows.reduce((count, row, index) => {
      if (!isVideoPost(row)) return count;
      return leadingDeferredWindow.has(index) ? count : count + 1;
    }, 0);
    if (lastDeferredVideoCountRef.current === deferredVideoCount) return;
    lastDeferredVideoCountRef.current = deferredVideoCount;

    console.log("KRISTO_HOME_FEED_VIDEO_DEFERRED", {
      posterCount: youtubeFirst20Rows.length,
      preloadDurationMs:
        first20PosterStartAtRef.current == null
          ? null
          : Math.max(0, Date.now() - first20PosterStartAtRef.current),
      first20VisibleMs: first20VisibleLoggedRef.current
        ? Date.now() - homeFeedMountAtRef.current
        : null,
      deferredVideoCount,
    });
  }, [youtubeLayout, youtubeFirst20Rows, activeIndex]);

  useEffect(() => {
    if (!youtubeLayout) return;
    if (!youtubeFirst20Rows.length) return;
    if (first20AvatarPreloadDoneLoggedRef.current) return;

    const headCount =
      Platform.OS === "android"
        ? HOME_FEED_YOUTUBE_APPEND_POSTER_HEAD_COUNT
        : youtubeFirst20Rows.length;
    const headRows = youtubeFirst20Rows.slice(0, headCount);
    const tailRows = youtubeFirst20Rows.slice(headCount);

    const startedAt = Date.now();
    if (first20AvatarPreloadStartAtRef.current == null) {
      first20AvatarPreloadStartAtRef.current = startedAt;
    }

    console.log("KRISTO_HOME_FEED_AVATAR_PRELOAD_START", {
      posterCount: headRows.length,
      deferredCount: tailRows.length,
      preloadDurationMs: 0,
      first20VisibleMs: first20VisibleLoggedRef.current
        ? startedAt - homeFeedMountAtRef.current
        : null,
      deferredVideoCount: null,
    });

    const preloadAvatarRows = async (rows: any[]) => {
      await Promise.all(
        rows.map(async (row, rowIndex) => {
          const churchId = homeFeedRowChurchId(row) || null;
          const mediaId = String(row?.mediaId || row?.id || "").trim() || null;
          const avatar = resolveHomeFeedAvatarCacheContext(row);
          const cacheKey = String(avatar.cacheKey || "").trim();
          const primaryUri = String(avatar.uri || avatar.backupUri || "").trim();
          const hasAvatarUri = Boolean(primaryUri);
          const payloadBase = {
            churchId,
            mediaId,
            avatarUri: hasAvatarUri ? "present" : "missing",
            rowIndex,
          };

          if (!cacheKey || !hasAvatarUri) {
            console.log("KRISTO_HOME_FEED_AVATAR_MISSING", {
              ...payloadBase,
              source: "fallback",
              statusCode: null,
            });
            return;
          }

          registerHomeFeedAvatarDiagnosticContext(cacheKey, {
            churchId: churchId || "",
            mediaId: mediaId || "",
            rowIndex,
          });
          const cached = peekHomeFeedAvatar(cacheKey, avatar.avatarUpdatedAt);
          if (cached) return;

          const resolved = await ensureHomeFeedAvatar({
            cacheKey,
            remoteUrls: avatar.remoteUris,
            sourceUpdatedAt: avatar.avatarUpdatedAt,
          });

          if (!resolved) {
            console.log("KRISTO_HOME_FEED_AVATAR_MISSING", {
              ...payloadBase,
              source: "fallback",
              statusCode: null,
            });
          }
        })
      );
    };

    const finishAvatarPreloadLog = () => {
      const preloadDurationMs = Math.max(
        0,
        Date.now() - (first20AvatarPreloadStartAtRef.current ?? startedAt)
      );
      first20AvatarPreloadDoneLoggedRef.current = true;
      console.log("KRISTO_HOME_FEED_AVATAR_PRELOAD_DONE", {
        posterCount: youtubeFirst20Rows.length,
        preloadDurationMs,
        first20VisibleMs: first20VisibleLoggedRef.current
          ? Date.now() - homeFeedMountAtRef.current
          : null,
        deferredVideoCount: null,
      });
    };

    void preloadAvatarRows(headRows).then(() => {
      if (!tailRows.length) {
        finishAvatarPreloadLog();
        return;
      }
      const runTail = () => {
        void preloadAvatarRows(tailRows).finally(finishAvatarPreloadLog);
      };
      if (Platform.OS === "android") {
        runAfterHomeFeedFirstCardMount(() => {
          InteractionManager.runAfterInteractions(runTail);
        });
        return;
      }
      void preloadAvatarRows(tailRows).finally(finishAvatarPreloadLog);
    });
  }, [youtubeLayout, youtubeFirst20Rows]);

  useEffect(() => {
    if (!youtubeLayout || !youtubeStreamRows.length) return;
    saveHomeFeedYoutubeStreamSession({
      activeIndex,
      pageRevealComplete: youtubePageRevealCompleteRef.current,
      pageVisualReady: youtubePageVisualReadyRef.current,
      nextCursor: feedNextCursorRef.current,
      hasMore: feedHasMoreRef.current,
      loadedPageCount: getHomeFeedLoadedPageCount(),
    });
  }, [activeIndex, youtubeLayout, youtubeStreamRows.length]);


  useEffect(() => {
    if (!feedFocused) {
      endHomeFeedPrefetchSession();
      endHomeFeedVideoPreloadSession();
      return;
    }

    if (isHomeFeedLazyMediaPrewarmEnabled()) return;

    prefetchSessionIdRef.current = beginHomeFeedPrefetchSession();
    beginHomeFeedVideoPreloadSession();
    return () => {
      endHomeFeedPrefetchSession();
      endHomeFeedVideoPreloadSession();
    };
  }, [feedFocused]);

  const posterWarmKey = useMemo(() => {
    const warmAhead = isHomeFeedLazyMediaPrewarmEnabled()
      ? HOME_FEED_LAZY_VISIBLE_POSTER_COUNT + HOME_FEED_LAZY_VISIBLE_POSTER_BUFFER
      : 6;
    if (youtubeLayout) {
      return visibleData
        .slice(0, warmAhead)
        .map((row) => feedRenderKey(row) || String(row?.id || ""))
        .join("|");
    }
    const end = Math.min(visibleData.length, activeIndex + warmAhead);
    return visibleData
      .slice(Math.max(0, activeIndex), end)
      .map((row) => feedRenderKey(row) || String(row?.id || ""))
      .join("|");
  }, [visibleData, activeIndex, youtubeLayout]);

  // Visible-window poster priority — inline TikTok only.
  useEffect(() => {
    if (isHomeFeedPosterPrewarmDisabled()) return;
    if (backgroundMediaPaused || videoModalPayload) return;
    const posterRows = youtubeLayout ? youtubeFirst20Rows : visibleData;
    if (!posterRows.length) return;
    if (!feedFocused) return;
    if (youtubeLayout && hasHomeFeedYoutubeStreamSession() && youtubePageVisualReadyRef.current) {
      return;
    }
    const lazyWarmCount = HOME_FEED_LAZY_VISIBLE_POSTER_COUNT + HOME_FEED_LAZY_VISIBLE_POSTER_BUFFER;
    const windowCount = youtubeLayout
      ? Math.min(HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE, posterRows.length)
      : isHomeFeedLazyMediaPrewarmEnabled()
        ? Math.min(lazyWarmCount, Math.max(1, posterRows.length))
        : Math.min(VISIBLE_PRIORITY_COUNT, Math.max(1, posterRows.length - Math.max(0, activeIndex)));
    const posterStartIndex = youtubeLayout ? 0 : activeIndex;
    const visibleItems = youtubeLayout
      ? posterRows.slice(0, windowCount)
      : posterRows.slice(
          Math.max(0, activeIndex),
          Math.max(0, activeIndex) + windowCount
        );
    const visibleIdentity = describePosterVisibleIdentity(
      visibleItems.filter((row) => isVideoPost(row))
    );
    const nextVisibleSignature = visibleIdentity.normalizedVisibleSignature || "";
    if (
      !posterFeedIdentitySetsEqual(
        lastPosterVisibleSignatureRef.current,
        nextVisibleSignature
      )
    ) {
      console.log("KRISTO_HOME_FEED_POSTER_VISIBLE_WINDOW_CHANGE", {
        rawVisibleSignature: visibleIdentity.rawVisibleSignature,
        normalizedVisibleSignature: nextVisibleSignature || null,
        previousNormalizedVisibleSignature: lastPosterVisibleSignatureRef.current || null,
        nextNormalizedVisibleSignature: nextVisibleSignature || null,
        activeIndex,
        windowCount,
        rowIds: visibleIdentity.rawRowIds,
        normalizedRowIds: visibleIdentity.normalizedRowIds,
        renderKeys: visibleItems
          .map((row) => feedRenderKey(row) || String(row?.id || "").trim())
          .filter(Boolean),
      });
      lastPosterVisibleSignatureRef.current = nextVisibleSignature;
    }
    prewarmVisibleHomeFeedVideoPosters(posterRows, posterStartIndex, windowCount);
  }, [
    visibleData,
    youtubeFirst20Rows,
    activeIndex,
    posterWarmKey,
    backgroundMediaPaused,
    videoModalPayload,
    feedFocused,
    youtubeLayout,
  ]);

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    if (!feedFocused || !visibleData.length || backgroundMediaPaused || videoModalPayload) return;
    if (youtubeLayout) return;

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
  }, [posterWarmKey, activeIndex, feedFocused, visibleData, backgroundMediaPaused, videoModalPayload, inlineVideoAutoplay, youtubeLayout]);

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
      warmHomeFeedUpcoming(rows, 0, visibleWindowSize);
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
    warmHomeFeedUpcoming(visibleData, activeIndex, visibleWindowSize);
  }, [
    inlineVideoAutoplay,
    activeIndex,
    feedFocused,
    visibleData,
    visibleWindowSize,
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
    warmHomeFeedUpcoming(visibleData, activeIndex, visibleWindowSize);
  }, [
    inlineVideoAutoplay,
    visibleWindowSize,
    activeIndex,
    feedFocused,
    visibleData,
    backgroundMediaPaused,
    videoModalPayload,
  ]);

  const handleVideoPress = useCallback(
    (payload: HomeFeedVideoOpenPayload) => {
      const postId = String(payload.postId || "").trim();
      console.log("KRISTO_WATCH_OPEN_TAP", { postId, at: Date.now() });
      notifyWatchScreenOpened(postId);

      const previousGeneration = getWatchUpNextGeneration();
      const generation = recordWatchSessionVideo(payload.postId);

      // Duplicate tap on the current Watch video must not reshuffle, refill, or reset payload.
      if (generation === previousGeneration) {
        return;
      }

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
    watchQueueRequestIdRef.current += 1;
    watchQueueHasMoreProbedRef.current = false;
    watchQueueStaleProbeNetworkAllowedRef.current = false;
    setVideoModalPayload(null);
    setRelatedVideoItems([]);
    watchUpNextPoolRef.current = [];
    resetWatchUpNextSession();
    setWatchUpNextGeneration(0);
  }, []);

  const fetchWatchQueueNextPage = useCallback(async (requestId: number) => {
    const loadedPageCount = getHomeFeedLoadedPageCount();
    // ensureWatchQueueDepth may clear local exhaustion for a one-shot probe; allow
    // exactly one matching network call even when feedHasMoreRef is still false.
    const allowStaleHasMoreProbe =
      !feedHasMoreRef.current && watchQueueStaleProbeNetworkAllowedRef.current;

    if (!feedHasMoreRef.current && !allowStaleHasMoreProbe) {
      return { rows: [] as any[], hasMore: false, source: "no-more" };
    }
    if (watchQueueRefillInflightRef.current || appendMoreInflightRef.current) {
      return {
        rows: [] as any[],
        hasMore: feedHasMoreRef.current,
        source: "inflight-skip",
      };
    }
    if (watchQueueRequestIdRef.current !== requestId) {
      return {
        rows: [] as any[],
        hasMore: feedHasMoreRef.current,
        source: "stale-skip",
      };
    }

    watchQueueRefillInflightRef.current = true;
    if (allowStaleHasMoreProbe) {
      watchQueueStaleProbeNetworkAllowedRef.current = false;
    }
    const beforeCount = youtubeLayout
      ? youtubeStreamRowsRef.current.length
      : getCachedHomeFeedBackendCount();
    const cursor = feedNextCursorRef.current ?? String(beforeCount);
    const pageLimit = youtubeLayout
      ? homeFeedYoutubeStreamLimitForPage(loadedPageCount)
      : HOME_FEED_PAGE_SIZE;

    console.log("KRISTO_WATCH_QUEUE_FETCH_START", {
      requestId,
      cursor,
      pageLimit,
      staleHasMoreProbe: allowStaleHasMoreProbe,
      priorHasMore: feedHasMoreRef.current,
      loadedPageCount,
    });

    try {
      // Lightweight page fetch only — skip YouTube cover gates / feed UI append work.
      const page = await fetchHomeFeedNextPage(cursor, pageLimit);

      // Ignore stale responses so an older Watch generation cannot move cursor/hasMore.
      if (watchQueueRequestIdRef.current !== requestId) {
        return {
          rows: [] as any[],
          hasMore: feedHasMoreRef.current,
          source: "stale-skip",
        };
      }

      applyFeedPagingState(
        { hasMore: page.hasMore, nextCursor: page.nextCursor },
        {
          allowSessionOverwrite: true,
          pagingApplied: page.pagingApplied !== false,
        }
      );

      if (page.newRows.length) {
        watchUpNextPoolRef.current = mergeWatchUpNextCandidateRows(
          watchUpNextPoolRef.current,
          page.newRows
        );

        if (youtubeLayout) {
          const merged = stableMergeHomeFeedRows(youtubeStreamRowsRef.current, page.newRows);
          youtubeStreamRowsRef.current = merged.merged;
          saveHomeFeedYoutubeStreamSession({
            rows: youtubeStreamRowsRef.current,
            nextCursor: feedNextCursorRef.current,
            hasMore: feedHasMoreRef.current,
            loadedPageCount: getHomeFeedLoadedPageCount(),
          });
        } else {
          applyBackendRowsIfChanged(page.rows);
          // Keep refs warm for subsequent Up Next rebuilds without forcing a visible
          // feed reshuffle mid-playback (state update is append-only / stable-merge).
          setStableDisplayRows((prev) => {
            if (watchQueueRequestIdRef.current !== requestId) return prev;
            const base = prev.length ? prev : stableDisplayRowsRef.current;
            const result = stableMergeHomeFeedRows(base, page.newRows);
            stableDisplayRowsRef.current = result.merged;
            return result.merged;
          });
        }
      }

      console.log("KRISTO_WATCH_QUEUE_FETCH_DONE", {
        requestId,
        fetchedCount: page.incoming,
        appended: page.appended,
        hasMore: page.hasMore,
      });

      return {
        rows: page.newRows,
        hasMore: page.hasMore,
        source: "watch-queue-feed-page",
      };
    } catch (error) {
      console.log("KRISTO_WATCH_QUEUE_FETCH_ERROR", {
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      watchQueueRefillInflightRef.current = false;
    }
  }, [applyBackendRowsIfChanged, applyFeedPagingState, youtubeLayout]);

  useEffect(() => {
    if (!videoModalPayload?.postId || !videoModalPayload?.item) {
      setRelatedVideoItems([]);
      return;
    }

    const payload = videoModalPayload;
    const generation = watchUpNextGeneration;
    const currentPostId = String(payload.postId || "").trim();
    const requestId = ++watchQueueRequestIdRef.current;
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      const timeout = setTimeout(() => {
        void (async () => {
          if (cancelled || watchQueueRequestIdRef.current !== requestId) return;

          watchUpNextPoolRef.current = mergeWatchUpNextCandidateRows(
            watchUpNextPoolRef.current,
            feedListRowsRef.current,
            youtubeStreamRowsRef.current,
            stableDisplayRowsRef.current,
            displayFeedRowsRef.current
          );

          const loadedPageCount = getHomeFeedLoadedPageCount();
          const allowStaleExhaustionProbe =
            !feedHasMoreRef.current && !watchQueueHasMoreProbedRef.current;

          const ensured = await ensureWatchQueueDepth({
            currentItem: payload.item,
            candidates: watchUpNextPoolRef.current,
            viewerChurchId,
            limit: WATCH_QUEUE_TARGET_DEPTH,
            generationSeed: generation,
            threshold: WATCH_QUEUE_REFILL_THRESHOLD,
            targetDepth: WATCH_QUEUE_TARGET_DEPTH,
            hasMore: feedHasMoreRef.current,
            loadedPageCount,
            allowStaleExhaustionProbe,
            onStaleExhaustionProbe: () => {
              watchQueueHasMoreProbedRef.current = true;
              watchQueueStaleProbeNetworkAllowedRef.current = true;
            },
            fetchNextPage: () => fetchWatchQueueNextPage(requestId),
          });

          if (cancelled || watchQueueRequestIdRef.current !== requestId) return;

          watchUpNextPoolRef.current = ensured.mergedCandidates;

          console.log("KRISTO_WATCH_UP_NEXT_DEFERRED", {
            postId: currentPostId,
            generation: ensured.generation,
            queueSize: ensured.queueSize,
            refillRequested: ensured.refillRequested,
            refillSource: ensured.refillSource,
            pagesFetched: ensured.pagesFetched,
            fetchedCount: ensured.fetchedCount,
            dedupedCount: ensured.dedupedCount,
            unseenCount: ensured.unseenCount,
            recycledCount: ensured.recycledCount,
            finalQueueCount: ensured.finalQueueCount,
            backendExhausted: ensured.backendExhausted,
            staleHasMoreProbeAttempted: ensured.staleHasMoreProbeAttempted,
            at: Date.now(),
          });

          setRelatedVideoItems(ensured.items);
        })();
      }, 900);

      return () => clearTimeout(timeout);
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [
    videoModalPayload?.postId,
    viewerChurchId,
    watchUpNextGeneration,
    fetchWatchQueueNextPage,
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
    const index = visibleData.findIndex(
      (row) => (feedRenderKey(row) || String(row?.id || "").trim()) === rowKey
    );
    if (index < 0) return;
    pendingScrollRowKeyRef.current = "";
    setActiveIndex(index);
    requestAnimationFrame(() => {
      feedListRef.current?.scrollToIndex(index, true);
    });
  }, [visibleData, feedPostFilter]);

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

  useEffect(() => {
    let alive = true;

    void getLocallyBlockedUserIds().then((ids) => {
      if (!alive) return;
      if (ids.length) setBlockedUserIds(ids);
    });

    void getLocallyExcludedChurchIds().then((ids) => {
      if (!alive) return;
      if (ids.length) setExcludedChurchIds(ids);
    });

    runAfterHomeDeferredStartup(() => {
      void fetchBlockedUserIdsFromApi().then((ids) => {
        if (!alive || !ids.length) return;
        setBlockedUserIds((prev) => {
          const merged = Array.from(new Set([...prev, ...ids]));
          return merged.length === prev.length ? prev : merged;
        });
      });

      void fetchChurchModerationFromApi().then(({ ok, records }) => {
        if (!alive || !ok) return;
        const ids = records.map((row) => row.churchId).filter(Boolean);
        setExcludedChurchIds(ids);
      });
    }, { reason: "home-feed-blocked-users-sync" });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return subscribeChurchFeedModeration(() => {
      void getLocallyExcludedChurchIds().then((ids) => {
        setExcludedChurchIds(ids);
        setDisplayOrderRebuildRequested(true);
      });
    });
  }, []);

  useEffect(() => {
    if (!excludedChurchIdSet.size && feedRows.length === displayFeedRows.length) return;
    console.log("KRISTO_HOME_FEED_CHURCH_FILTER_APPLIED", {
      excludedChurchIds: Array.from(excludedChurchIdSet),
      excludedCount: excludedChurchIdSet.size,
      beforeCount: feedRows.length,
      afterCount: displayFeedRows.length,
      removedCount: Math.max(0, feedRows.length - displayFeedRows.length),
    });
  }, [excludedChurchIdSet, feedRows.length, displayFeedRows.length]);

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

    runAfterHomeDeferredStartup(
      () => {
        void syncReportedPostIdsFromApi(ids).then((reported) => {
          if (!alive || !reported.length) return;
          hydrateHomeFeedReportedPostIds(reported);
        });
      },
      { reason: "home-feed-report-sync" }
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
    const authorUserId = resolveRowAuthorUserId(item);
    setReportTargetPostId(postId);
    setReportTargetAuthorUserId(authorUserId);

    /*
     * Preserve the exact item shown to the user.
     * This becomes the durable evidence snapshot.
     */
    setReportTargetItem(item);

    setReportSheetOpen(true);
  }, [resolveRowAuthorUserId]);

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

  const handleBlockedUser = useCallback((blockedUserId: string) => {
    const uid = String(blockedUserId || "").trim();
    if (!uid) return;
    setBlockedUserIds((prev) => {
      if (prev.includes(uid)) return prev;
      return [...prev, uid];
    });
    setSuccessBanner("User blocked. Their content was removed from your feed.");
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
          loadingMore={loadingMore}
          showCaughtUpFooter={feedCaughtUp}
          youtubePrefetchEnabled={youtubePrefetchEnabled}
          onEndReached={handleFeedEndReached}
          onYoutubeUserScroll={handleYoutubeUserScroll}
          onYoutubePrefetchCheck={tryYoutubeStreamPrefetch}
          onActiveIndexChange={setActiveIndex}
          onUserScrollActivity={notifyHomeFeedUserScrollActivity}
          onLike={handleLike}
          onComment={handleComment}
          onShare={handleShare}
          onSave={handleSave}
          onReport={handleReport}
          onVideoPress={handleVideoPress}
          emptyTitle={feedEmptyCopy.title}
          emptyBody={feedEmptyCopy.body}
          youtubeInitialScrollOffset={youtubeSessionOnMount.scrollY}
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
        reportTargetItem={reportTargetItem}
        onCloseReport={() => {
          setReportSheetOpen(false);
          setReportTargetPostId("");
          setReportTargetAuthorUserId("");
          setReportTargetItem(null);
        }}
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
        rows={youtubeLayout ? youtubeStreamRows : stableDisplayRows.length ? stableDisplayRows : displayFeedRows}
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
          authorUserId={reportTargetAuthorUserId}
          targetItem={reportTargetItem}
          onClose={() => {
            setReportSheetOpen(false);
            setReportTargetPostId("");
            setReportTargetAuthorUserId("");
            setReportTargetItem(null);
          }}
          onReported={handleReported}
          onBlocked={handleBlockedUser}
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
