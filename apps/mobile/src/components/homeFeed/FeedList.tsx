import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { FeedRow } from "./FeedRow";
import { FeedYouTubeCard } from "./FeedYouTubeCard";
import { FeedYouTubeSkeletonCard } from "./FeedYouTubeSkeletonCard";
import {
  feedRenderKey,
  isVideoPost,
} from "./homeFeedUtils";
import { isHomeFeedSkeletonRow, HOME_FEED_YOUTUBE_BOTTOM_SKELETON_COUNT, HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE } from "./homeFeedPageCache";
import type { HomeFeedYoutubeScrollMetrics } from "./homeFeedPageCache";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";
import { isHomeFeedRenderPaused } from "@/src/lib/liveRoomStartup";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  collectHomeFeedVideoWindowIds,
  computeHomeFeedMountedVideoIndexes,
  collectVideoFeedIndexes,
  resolveActiveVideoRank,
  resolveHomeFeedVideoWarmMode,
} from "@/src/lib/homeFeedVideoWindow";
import { resolveYouTubeFeedItemLayout, type YouTubeFeedItemLayoutCache } from "@/src/lib/homeFeedYouTubeLayout";
import { enforceHomeFeedVideoAudioOwnership } from "@/src/lib/homeFeedVideoOwner";
import { markHomeFeedPostViewed } from "@/src/lib/homeFeedPostViews";
import {
  isHomeFeedYouTubeStyleVideo,
  isHomeFeedInlineVideoAutoplayEnabled,
  type HomeFeedVideoOpenPayload,
} from "@/src/lib/homeFeedVideoMode";

/** Android first paint — align with visible poster prewarm; iOS keeps full page size. */
const HOME_FEED_YOUTUBE_ANDROID_INITIAL_RENDER = 7;
const HOME_FEED_YOUTUBE_ANDROID_EAGER_IMAGE_COUNT = 6;

function youtubeFlatListInitialRenderCount() {
  return Platform.OS === "android"
    ? HOME_FEED_YOUTUBE_ANDROID_INITIAL_RENDER
    : HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE;
}

function youtubeEagerImageIndexLimit() {
  return Platform.OS === "android"
    ? HOME_FEED_YOUTUBE_ANDROID_EAGER_IMAGE_COUNT
    : HOME_FEED_YOUTUBE_FIRST_PAGE_SIZE;
}

// Dedupe for the first-3-video-rows index diagnostic (keyed by row id).
const lastFeedVideoIndexDiag = new Map<string, string>();

function estimateFallbackYouTubeItemLength(windowWidth: number) {
  return Math.max(320, Math.round(windowWidth * 1.05));
}

/** Imperative scroll API for programmatic focus (deep links, claim-slot, clamp). */
export type FeedListHandle = {
  scrollToIndex: (index: number, animated?: boolean) => void;
};

/**
 * Row becomes a viewability candidate once ≥80% visible — Reels/TikTok-style
 * handoff (one primary row; avoids 50% round() flips mid-drag).
 */
const VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 80,
  minimumViewTime: 0,
  waitForInteraction: false,
} as const;

const YOUTUBE_VIEWABILITY_CONFIG = {
  itemVisiblePercentThreshold: 70,
  minimumViewTime: 500,
  waitForInteraction: false,
} as const;

const YOUTUBE_ACTIVE_INDEX_DEBOUNCE_MS = 500;

type Props = {
  rows: any[];
  contentHeight: number;
  activeIndex: number;
  screenFocused: boolean;
  loading: boolean;
  loadingMore?: boolean;
  showCaughtUpFooter?: boolean;
  /** When false, skip near-end prefetch checks (exhausted feed). */
  youtubePrefetchEnabled?: boolean;
  onEndReached?: () => void;
  onYoutubeUserScroll?: (
    metrics: import("./homeFeedPageCache").HomeFeedYoutubeScrollMetrics,
    source: "drag" | "momentum" | "scroll"
  ) => void;
  onYoutubePrefetchCheck?: (
    metrics: import("./homeFeedPageCache").HomeFeedYoutubeScrollMetrics
  ) => void;
  onActiveIndexChange: (index: number) => void;
  onUserScrollActivity?: () => void;
  onLike: (item: any) => void;
  onComment: (item: any) => void;
  onShare: (item: any) => void;
  onSave: (item: any) => void;
  onReport: (item: any) => void;
  onVideoPress?: (payload: HomeFeedVideoOpenPayload) => void;
  emptyTitle?: string;
  emptyBody?: string;
  youtubeInitialScrollOffset?: number;
};

export const FeedList = memo(
  forwardRef<FeedListHandle, Props>(function FeedList(
    {
      rows,
      contentHeight,
      activeIndex,
      screenFocused,
      loading,
      loadingMore = false,
      showCaughtUpFooter = false,
      youtubePrefetchEnabled = true,
      onEndReached,
      onYoutubeUserScroll,
      onYoutubePrefetchCheck,
      onActiveIndexChange,
      onUserScrollActivity,
      onLike,
      onComment,
      onShare,
      onSave,
      onReport,
      onVideoPress,
      emptyTitle,
      emptyBody,
      youtubeInitialScrollOffset = 0,
    },
    ref
  ) {
  const youtubeLayout = isHomeFeedYouTubeStyleVideo();
  const { width: windowWidth } = useWindowDimensions();
  const inlineVideoAutoplay = isHomeFeedInlineVideoAutoplayEnabled();
  const renderPaused = isHomeFeedRenderPaused();
  const effectiveScreenFocused = screenFocused && !renderPaused;
  const listRef = useRef<FlatList>(null);
  const youtubeLayoutCacheRef = useRef<YouTubeFeedItemLayoutCache>({
    heights: [],
    offsets: [],
    rowKeys: [],
    windowWidth: 0,
  });
  const youtubeImageLoadUnlockedRef = useRef(new Set<number>());

  useEffect(() => {
    if (!youtubeLayout) return;
    const unlocked = youtubeImageLoadUnlockedRef.current;
    for (const index of [...unlocked]) {
      if (index >= rows.length) unlocked.delete(index);
    }
  }, [rows.length, youtubeLayout]);

  const youtubeRowKey = useCallback(
    (row: any, index: number) => feedRenderKey(row) || String(row?.id || `row-${index}`),
    []
  );
  const youtubeLayoutMetrics = useMemo(() => {
    const resolved = resolveYouTubeFeedItemLayout(
      rows,
      windowWidth,
      youtubeLayoutCacheRef.current,
      youtubeRowKey
    );
    youtubeLayoutCacheRef.current = resolved.cache;
    return resolved;
  }, [rows, windowWidth, youtubeRowKey]);

  const scrollYouTubeToIndex = useCallback(
    (index: number, animated = true) => {
      const clamped = Math.max(0, Math.min(index, Math.max(0, rows.length - 1)));
      const offset = youtubeLayoutMetrics.offsets[clamped];
      if (offset != null) {
        listRef.current?.scrollToOffset({ offset, animated });
        return;
      }
      listRef.current?.scrollToIndex({ index: clamped, animated });
    },
    [rows.length, youtubeLayoutMetrics.offsets]
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index: number, animated = true) {
        if (youtubeLayout) {
          scrollYouTubeToIndex(index, animated);
          return;
        }
        const clamped = Math.max(0, index);
        listRef.current?.scrollToOffset({
          offset: clamped * Math.max(1, contentHeight),
          animated,
        });
      },
    }),
    [contentHeight, youtubeLayout, scrollYouTubeToIndex]
  );

  const activeIndexRef = useRef(activeIndex);
  const onActiveIndexChangeRef = useRef(onActiveIndexChange);
  const onUserScrollActivityRef = useRef(onUserScrollActivity);
  const pendingActiveIndexRef = useRef<number | null>(null);
  const activeIndexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onYoutubeUserScrollRef = useRef(onYoutubeUserScroll);
  const onYoutubePrefetchCheckRef = useRef(onYoutubePrefetchCheck);
  const youtubePrefetchEnabledRef = useRef(youtubePrefetchEnabled);
  const lastReportedScrollYRef = useRef(
    youtubeInitialScrollOffset > 0 ? youtubeInitialScrollOffset : 0
  );
  const youtubeScrollMetricsRef = useRef<HomeFeedYoutubeScrollMetrics>({
    scrollY: youtubeInitialScrollOffset > 0 ? youtubeInitialScrollOffset : 0,
    contentHeight: 0,
    viewportHeight: 1,
  });
  const listScrollAnimatingRef = useRef(false);
  const youtubeScrollRestoredRef = useRef(false);
  const handlersRef = useRef({
    onLike,
    onComment,
    onShare,
    onSave,
    onReport,
    onVideoPress,
  });

  activeIndexRef.current = activeIndex;
  onActiveIndexChangeRef.current = onActiveIndexChange;
  onUserScrollActivityRef.current = onUserScrollActivity;
  onYoutubeUserScrollRef.current = onYoutubeUserScroll;
  onYoutubePrefetchCheckRef.current = onYoutubePrefetchCheck;
  youtubePrefetchEnabledRef.current = youtubePrefetchEnabled;
  handlersRef.current = {
    onLike,
    onComment,
    onShare,
    onSave,
    onReport,
    onVideoPress,
  };

  const youtubeGetItemLayout = useCallback(
    (_: any, index: number) => ({
      length: youtubeLayoutMetrics.heights[index] ?? estimateFallbackYouTubeItemLength(windowWidth),
      offset:
        youtubeLayoutMetrics.offsets[index] ??
        index * estimateFallbackYouTubeItemLength(windowWidth),
      index,
    }),
    [youtubeLayoutMetrics, windowWidth]
  );

  const handleYouTubeScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number; highestMeasuredFrameIndex: number }) => {
      const offset =
        youtubeLayoutMetrics.offsets[info.index] ??
        info.index * Math.max(1, info.averageItemLength);
      listRef.current?.scrollToOffset({ offset, animated: false });
      requestAnimationFrame(() => {
        scrollYouTubeToIndex(info.index, false);
      });
    },
    [scrollYouTubeToIndex, youtubeLayoutMetrics.offsets]
  );
  const viewabilityConfig = useRef(VIEWABILITY_CONFIG).current;
  const youtubeViewabilityConfig = useRef(YOUTUBE_VIEWABILITY_CONFIG).current;

  const markViewablePosts = useCallback((viewableItems: ViewToken[]) => {
    for (const token of viewableItems) {
      if (!token.isViewable) continue;
      const id = String((token.item as any)?.id || "").trim();
      if (id) markHomeFeedPostViewed(id);
    }
  }, []);

  const publishActiveIndex = useCallback(
    (nextIndex: number, source: "viewability" | "momentum-fallback" | "youtube-viewability") => {
      if (nextIndex < 0 || nextIndex === activeIndexRef.current) return;
      console.log("KRISTO_FEED_ACTIVE_INDEX", {
        from: activeIndexRef.current,
        to: nextIndex,
        source,
      });
      onActiveIndexChangeRef.current(nextIndex);
    },
    []
  );

  const scheduleDebouncedActiveIndex = useCallback(
    (nextIndex: number, source: "youtube-viewability") => {
      if (nextIndex < 0 || nextIndex === activeIndexRef.current) return;
      pendingActiveIndexRef.current = nextIndex;
      if (activeIndexDebounceRef.current) {
        clearTimeout(activeIndexDebounceRef.current);
      }
      activeIndexDebounceRef.current = setTimeout(() => {
        activeIndexDebounceRef.current = null;
        const pending = pendingActiveIndexRef.current;
        pendingActiveIndexRef.current = null;
        if (pending == null || pending === activeIndexRef.current) return;
        publishActiveIndex(pending, source);
      }, YOUTUBE_ACTIVE_INDEX_DEBOUNCE_MS);
    },
    [publishActiveIndex]
  );

  useEffect(
    () => () => {
      if (activeIndexDebounceRef.current) {
        clearTimeout(activeIndexDebounceRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!youtubeLayout) return;
    if (!rows.length || youtubeInitialScrollOffset <= 0) return;
    if (youtubeScrollRestoredRef.current) return;
    youtubeScrollRestoredRef.current = true;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: youtubeInitialScrollOffset,
        animated: false,
      });
    });
  }, [rows.length, youtubeInitialScrollOffset, youtubeLayout]);

  const readYoutubeScrollMetrics = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>): HomeFeedYoutubeScrollMetrics => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      return {
        scrollY: Number(contentOffset?.y || 0),
        contentHeight: Number(contentSize?.height || 0),
        viewportHeight: Number(layoutMeasurement?.height || 0),
      };
    },
    []
  );

  const notifyYoutubeUserScroll = useCallback(
    (metrics: HomeFeedYoutubeScrollMetrics, source: "drag" | "momentum" | "scroll") => {
      youtubeScrollMetricsRef.current = metrics;
      onYoutubeUserScrollRef.current?.(metrics, source);
    },
    []
  );

  const notifyYoutubePrefetchCheck = useCallback(() => {
    if (!youtubePrefetchEnabledRef.current) return;
    onYoutubePrefetchCheckRef.current?.(youtubeScrollMetricsRef.current);
  }, []);

  const handleUserScrollActivity = useCallback(() => {
    onUserScrollActivityRef.current?.();
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    listScrollAnimatingRef.current = true;
    pendingActiveIndexRef.current = null;
    handleUserScrollActivity();
    notifyYoutubeUserScroll(youtubeScrollMetricsRef.current, "drag");
  }, [handleUserScrollActivity, notifyYoutubeUserScroll]);

  const handleMomentumScrollBegin = useCallback(() => {
    listScrollAnimatingRef.current = true;
    handleUserScrollActivity();
    notifyYoutubeUserScroll(youtubeScrollMetricsRef.current, "momentum");
  }, [handleUserScrollActivity, notifyYoutubeUserScroll]);

  const handleListMomentumScrollEnd = useCallback(() => {
    listScrollAnimatingRef.current = false;
    handleUserScrollActivity();
    if (youtubeLayout) {
      notifyYoutubePrefetchCheck();
    }
  }, [handleUserScrollActivity, notifyYoutubePrefetchCheck, youtubeLayout]);

  const handleScrollEndDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      handleUserScrollActivity();
      const metrics = readYoutubeScrollMetrics(event);
      notifyYoutubeUserScroll(metrics, "scroll");
      const velocityY = Number(event?.nativeEvent?.velocity?.y || 0);
      if (Math.abs(velocityY) < 0.05) {
        listScrollAnimatingRef.current = false;
        if (youtubeLayout) {
          notifyYoutubePrefetchCheck();
        }
      }
    },
    [
      handleUserScrollActivity,
      notifyYoutubeUserScroll,
      notifyYoutubePrefetchCheck,
      readYoutubeScrollMetrics,
      youtubeLayout,
    ]
  );

  const handleYoutubeScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const metrics = readYoutubeScrollMetrics(event);
      youtubeScrollMetricsRef.current = metrics;
      if (Math.abs(metrics.scrollY - lastReportedScrollYRef.current) < 12) return;
      lastReportedScrollYRef.current = metrics.scrollY;
      notifyYoutubeUserScroll(metrics, "scroll");
    },
    [notifyYoutubeUserScroll, readYoutubeScrollMetrics, youtubeLayout]
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      markViewablePosts(viewableItems);

      const viewable = viewableItems.filter(
        (token) => token.isViewable && token.index != null && token.index >= 0
      );
      if (!viewable.length) return;

      let nextIndex = viewable[0].index as number;
      if (viewable.length > 1) {
        nextIndex = viewable.reduce((best, token) => {
          const idx = token.index as number;
          const bestIdx = best.index as number;
          return idx > bestIdx ? token : best;
        }).index as number;
      }

      if (nextIndex < 0 || nextIndex === activeIndexRef.current) return;
      console.log("KRISTO_FEED_ACTIVE_INDEX", {
        from: activeIndexRef.current,
        to: nextIndex,
        source: "viewability",
      });
      onActiveIndexChangeRef.current(nextIndex);
    }
  ).current;

  const onYouTubeViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      markViewablePosts(viewableItems);

      const viewable = viewableItems.filter(
        (token) => token.isViewable && token.index != null && token.index >= 0
      );
      if (!viewable.length) return;

      const nextIndex = viewable.reduce((best, token) => {
        const idx = token.index as number;
        const bestIdx = best.index as number;
        return idx < bestIdx ? token : best;
      }).index as number;

      if (nextIndex < 0 || nextIndex === activeIndexRef.current) return;
      pendingActiveIndexRef.current = nextIndex;
      if (listScrollAnimatingRef.current) return;
      scheduleDebouncedActiveIndex(nextIndex, "youtube-viewability");
    }
  ).current;

  const mountedVideoIndexes = useMemo(
    () => computeHomeFeedMountedVideoIndexes(rows, activeIndex),
    [rows, activeIndex]
  );

  // The first video row — adopts the player decode-primed during app open so its
  // first frame is already painted when Home opens.
  const firstVideoIndex = useMemo(() => rows.findIndex((row) => isVideoPost(row)), [rows]);

  const prevWarmWindowRef = useRef<{ key: string; postIds: string[] }>({
    key: "",
    postIds: [],
  });

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    const key = mountedVideoIndexes.join(",");
    const postIds = mountedVideoIndexes
      .map((idx) => String(rows[idx]?.id || "").trim())
      .filter(Boolean);

    if (key !== prevWarmWindowRef.current.key) {
      for (const id of prevWarmWindowRef.current.postIds) {
        if (!postIds.includes(id)) {
          console.log("KRISTO_VIDEO_PLAYER_EVICT", { id, reason: "retention-distance" });
        }
      }
      prevWarmWindowRef.current = { key, postIds };

      console.log("KRISTO_VIDEO_WARM_WINDOW", {
        activeIndex,
        mountedIndexes: mountedVideoIndexes,
        reason: "window-update",
      });
    }
  }, [mountedVideoIndexes, activeIndex, rows, inlineVideoAutoplay]);

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    enforceHomeFeedVideoAudioOwnership(activeIndex);
  }, [activeIndex, inlineVideoAutoplay]);

  // Fallback only: if viewability did not fire after snap (fast fling, edge case).
  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = Number(event?.nativeEvent?.contentOffset?.y || 0);
      const nextIndex = Math.max(0, Math.round(y / Math.max(1, contentHeight)));
      publishActiveIndex(nextIndex, "momentum-fallback");
    },
    [contentHeight, publishActiveIndex]
  );

  useEffect(() => {
    if (renderPaused || !isKristoVerboseFeedDebug()) return;
    const warmIds = collectHomeFeedVideoWindowIds(rows, activeIndex);
    console.log("KRISTO_VIDEO_WINDOW_STATE", {
      activeIndex,
      warmIds,
      videoCount: rows.filter((row) => isVideoPost(row)).length,
    });
  }, [activeIndex, rows, renderPaused]);

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const videoWarmMode = isVideoPost(item)
        ? resolveHomeFeedVideoWarmMode(index, activeIndex, mountedVideoIndexes, rows)
        : "off";

      const videoIndexes = collectVideoFeedIndexes(rows);
      const indexRank = videoIndexes.indexOf(index);
      const activeVideoRank = resolveActiveVideoRank(videoIndexes, activeIndex);
      const videoRankDelta = indexRank >= 0 ? indexRank - activeVideoRank : index - activeIndex;

      // Decode-prime the next 1–2 forward neighbors before the user scrolls there.
      const decodePrime =
        inlineVideoAutoplay &&
        videoWarmMode === "preload" &&
        videoRankDelta >= 1 &&
        videoRankDelta <= 2;

      // Diagnostic for the first 3 video rows: shows whether the first visible
      // video is the active row and whether it mounts a player in the rolling window.
      if (isKristoVerboseFeedDebug() && isVideoPost(item) && index <= 2) {
        const rowId = String(item?.id || "");
        const mountsPlayer = videoWarmMode !== "off";
        const diagKey = `${index}:${index === activeIndex ? 1 : 0}:${videoWarmMode}:${mountsPlayer ? 1 : 0}`;
        if (lastFeedVideoIndexDiag.get(rowId) !== diagKey) {
          lastFeedVideoIndexDiag.set(rowId, diagKey);
          console.log("KRISTO_VIDEO_FEED_INDEX_DIAG", {
            id: rowId || null,
            index,
            activeIndex,
            isActive: index === activeIndex,
            warmMode: videoWarmMode,
            mountsPlayer,
            screenFocused: effectiveScreenFocused,
          });
        }
      }

      return (
        <FeedRow
          item={item}
          height={contentHeight}
          isActive={index === activeIndex}
          videoWarmMode={videoWarmMode}
          screenFocused={effectiveScreenFocused}
          feedIndex={index}
          isFirstFeedVideo={index === firstVideoIndex}
          decodePrime={decodePrime}
          onLike={() => handlersRef.current.onLike(item)}
          onComment={() => handlersRef.current.onComment(item)}
          onShare={() => handlersRef.current.onShare(item)}
          onSave={() => handlersRef.current.onSave(item)}
          onReport={() => handlersRef.current.onReport(item)}
          onVideoPress={handlersRef.current.onVideoPress}
        />
      );
    },
    [
      contentHeight,
      activeIndex,
      mountedVideoIndexes,
      rows,
      firstVideoIndex,
      effectiveScreenFocused,
      inlineVideoAutoplay,
    ]
  );

  const keyExtractor = useCallback(
    (item: any, index: number) => feedRenderKey(item) || String(item?.id || `row-${index}`),
    []
  );

  const renderYouTubeItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      if (isHomeFeedSkeletonRow(item)) {
        return <FeedYouTubeSkeletonCard />;
      }
      const nearActive = Math.abs(index - activeIndexRef.current) <= 2;
      const shouldLoadImages =
        index < youtubeEagerImageIndexLimit() ||
        youtubeImageLoadUnlockedRef.current.has(index) ||
        nearActive;
      if (shouldLoadImages) {
        youtubeImageLoadUnlockedRef.current.add(index);
      }
      return (
        <FeedYouTubeCard
          item={item}
          rowIndex={index}
          shouldLoadImages={shouldLoadImages}
          onLike={() => handlersRef.current.onLike(item)}
          onComment={() => handlersRef.current.onComment(item)}
          onShare={() => handlersRef.current.onShare(item)}
          onSave={() => handlersRef.current.onSave(item)}
          onReport={() => handlersRef.current.onReport(item)}
          onVideoPress={handlersRef.current.onVideoPress}
        />
      );
    },
    [rows.length]
  );

  const viewportStyle = youtubeLayout ? styles.youtubeList : { height: contentHeight };

  const listFooter = useMemo(() => {
    if (youtubeLayout) {
      if (showCaughtUpFooter) {
        return (
          <View style={styles.footer}>
            <Text style={styles.caughtUpText}>You&apos;re all caught up</Text>
          </View>
        );
      }
      return null;
    }
    if (showCaughtUpFooter) {
      return (
        <View style={styles.footer}>
          <Text style={styles.caughtUpText}>You&apos;re all caught up</Text>
        </View>
      );
    }
    if (loadingMore) {
      return (
        <View style={styles.footerLoading}>
          {Array.from({ length: HOME_FEED_YOUTUBE_BOTTOM_SKELETON_COUNT }, (_, index) => (
            <FeedYouTubeSkeletonCard key={`bottom-skeleton-${index}`} />
          ))}
          <ActivityIndicator color={HOME_FEED_GOLD_SOFT} size="small" style={styles.footerSpinner} />
        </View>
      );
    }
    return null;
  }, [loadingMore, showCaughtUpFooter, youtubeLayout]);

  const handleEndReached = useCallback(() => {
    onEndReached?.();
  }, [onEndReached]);

  if (loading && !rows.length) {
    return (
      <View style={[styles.center, viewportStyle]}>
        <ActivityIndicator color={HOME_FEED_GOLD_SOFT} size="large" />
      </View>
    );
  }

  if (!rows.length) {
    return (
      <View style={[styles.center, viewportStyle]}>
        <Text style={styles.emptyTitle}>{emptyTitle || "Your feed is quiet"}</Text>
        <Text style={styles.emptyBody}>
          {emptyBody || "Posts from your church and community will appear here."}
        </Text>
      </View>
    );
  }

  if (youtubeLayout) {
    return (
      <FlatList
        key="home-youtube-feed-list"
        ref={listRef}
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderYouTubeItem}
        showsVerticalScrollIndicator={false}
        initialNumToRender={youtubeFlatListInitialRenderCount()}
        windowSize={7}
        maxToRenderPerBatch={youtubeFlatListInitialRenderCount()}
        updateCellsBatchingPeriod={16}
        removeClippedSubviews={Platform.OS === "android"}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onViewableItemsChanged={onYouTubeViewableItemsChanged}
        viewabilityConfig={youtubeViewabilityConfig}
        onScrollBeginDrag={handleScrollBeginDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onScroll={handleYoutubeScroll}
        scrollEventThrottle={32}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleListMomentumScrollEnd}
        getItemLayout={youtubeGetItemLayout}
        onScrollToIndexFailed={handleYouTubeScrollToIndexFailed}
        ListFooterComponent={listFooter}
        style={[styles.list, viewportStyle]}
        contentContainerStyle={styles.youtubeContent}
      />
    );
  }

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={keyExtractor}
      extraData={activeIndex}
      renderItem={renderItem}
      pagingEnabled
      directionalLockEnabled={Platform.OS === "ios"}
      nestedScrollEnabled
      decelerationRate="fast"
      snapToInterval={contentHeight}
      snapToAlignment="start"
      disableIntervalMomentum
      showsVerticalScrollIndicator={false}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      getItemLayout={(_, index) => ({
        length: contentHeight,
        offset: contentHeight * index,
        index,
      })}
      initialNumToRender={3}
      windowSize={7}
      maxToRenderPerBatch={4}
      removeClippedSubviews={false}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.7}
      ListFooterComponent={listFooter}
      style={[styles.list, viewportStyle]}
    />
  );
  })
);

const styles = StyleSheet.create({
  list: {
    backgroundColor: HOME_FEED_BG,
    overflow: "hidden",
  },
  youtubeList: {
    flex: 1,
    backgroundColor: HOME_FEED_BG,
  },
  youtubeContent: {
    paddingTop: 6,
    paddingBottom: 16,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 10,
    backgroundColor: HOME_FEED_BG,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  footer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    paddingHorizontal: 28,
  },
  footerLoading: {
    paddingTop: 8,
    paddingBottom: 28,
    paddingHorizontal: 12,
    gap: 12,
    alignItems: "center",
  },
  footerSpinner: {
    marginTop: 4,
  },
  caughtUpText: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
