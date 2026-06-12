import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from "react-native";
import { FeedRow } from "./FeedRow";
import { FeedYouTubeCard } from "./FeedYouTubeCard";
import {
  feedRenderKey,
  isVideoPost,
} from "./homeFeedUtils";
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
import { hydrateHomeFeedVideoDiskCache } from "@/src/lib/homeFeedVideoDiskCache";
import { enforceHomeFeedVideoAudioOwnership } from "@/src/lib/homeFeedVideoOwner";
import {
  isHomeFeedYouTubeStyleVideo,
  isHomeFeedInlineVideoAutoplayEnabled,
  type HomeFeedVideoOpenPayload,
} from "@/src/lib/homeFeedVideoMode";

// Dedupe for the first-3-video-rows index diagnostic (keyed by row id).
const lastFeedVideoIndexDiag = new Map<string, string>();

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

type Props = {
  rows: any[];
  contentHeight: number;
  activeIndex: number;
  screenFocused: boolean;
  loading: boolean;
  likeUiEpoch: number;
  getLikeState: (
    item: any,
    logContext?: { index?: number }
  ) => { likedByMe: boolean; liked: boolean; likeCount: number };
  getSavedState: (item: any) => boolean;
  getVisibleDiscussionCount: (item: any) => number;
  isPostReported: (item: any) => boolean;
  onActiveIndexChange: (index: number) => void;
  onLike: (item: any) => void;
  onComment: (item: any) => void;
  onShare: (item: any) => void;
  onSave: (item: any) => void;
  onReport: (item: any) => void;
  onVideoPress?: (payload: HomeFeedVideoOpenPayload) => void;
  emptyTitle?: string;
  emptyBody?: string;
};

export const FeedList = memo(
  forwardRef<FeedListHandle, Props>(function FeedList(
    {
      rows,
      contentHeight,
      activeIndex,
      screenFocused,
      loading,
      likeUiEpoch,
      getLikeState,
      getSavedState,
      getVisibleDiscussionCount,
      isPostReported,
      onActiveIndexChange,
      onLike,
      onComment,
      onShare,
      onSave,
      onReport,
      onVideoPress,
      emptyTitle,
      emptyBody,
    },
    ref
  ) {
  const youtubeLayout = isHomeFeedYouTubeStyleVideo();
  const inlineVideoAutoplay = isHomeFeedInlineVideoAutoplayEnabled();
  const [scheduleNowMs] = useState(() => Date.now());
  const renderPaused = isHomeFeedRenderPaused();
  const effectiveScreenFocused = screenFocused && !renderPaused;
  const listRef = useRef<FlatList>(null);
  const activeIndexRef = useRef(activeIndex);
  const onActiveIndexChangeRef = useRef(onActiveIndexChange);

  activeIndexRef.current = activeIndex;
  onActiveIndexChangeRef.current = onActiveIndexChange;

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex(index: number, animated = true) {
        const clamped = Math.max(0, index);
        if (youtubeLayout) {
          listRef.current?.scrollToIndex({ index: clamped, animated });
          return;
        }
        listRef.current?.scrollToOffset({
          offset: clamped * Math.max(1, contentHeight),
          animated,
        });
      },
    }),
    [contentHeight, youtubeLayout]
  );

  const viewabilityConfig = useRef(VIEWABILITY_CONFIG).current;

  const publishActiveIndex = useCallback(
    (nextIndex: number, source: "viewability" | "momentum-fallback") => {
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

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
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

  useEffect(() => {
    if (!inlineVideoAutoplay) return;
    void hydrateHomeFeedVideoDiskCache();
  }, [inlineVideoAutoplay]);

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
      const likeState = getLikeState(item, { index });

      const videoWarmMode = isVideoPost(item)
        ? resolveHomeFeedVideoWarmMode(index, activeIndex, mountedVideoIndexes, rows)
        : "off";

      const videoIndexes = collectVideoFeedIndexes(rows);
      const indexRank = videoIndexes.indexOf(index);
      const activeVideoRank = resolveActiveVideoRank(videoIndexes, activeIndex);
      const videoRankDelta = indexRank >= 0 ? indexRank - activeVideoRank : index - activeIndex;

      // Decode-prime the next 2–3 forward neighbors before the user scrolls there.
      const decodePrime =
        inlineVideoAutoplay &&
        videoWarmMode === "preload" &&
        videoRankDelta >= 1 &&
        videoRankDelta <= 3;

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
          likedByMe={likeState.likedByMe}
          liked={likeState.liked}
          likeCount={likeState.likeCount}
          visibleDiscussionCount={getVisibleDiscussionCount(item)}
          saved={getSavedState(item)}
          reported={isPostReported(item)}
          onLike={() => onLike(item)}
          onComment={() => onComment(item)}
          onShare={() => onShare(item)}
          onSave={() => onSave(item)}
          onReport={() => onReport(item)}
          onVideoPress={onVideoPress}
        />
      );
    },
    [
      contentHeight,
      activeIndex,
      mountedVideoIndexes,
      rows,
      firstVideoIndex,
      screenFocused,
      effectiveScreenFocused,
      renderPaused,
      scheduleNowMs,
      likeUiEpoch,
      getLikeState,
      getSavedState,
      getVisibleDiscussionCount,
      isPostReported,
      onLike,
      onComment,
      onShare,
      onSave,
      onReport,
      onVideoPress,
    ]
  );

  const keyExtractor = useCallback(
    (item: any, index: number) => feedRenderKey(item) || String(item?.id || `row-${index}`),
    []
  );

  const renderYouTubeItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const likeState = getLikeState(item, { index });

      return (
        <FeedYouTubeCard
          item={item}
          likedByMe={likeState.likedByMe}
          liked={likeState.liked}
          likeCount={likeState.likeCount}
          commentCount={getVisibleDiscussionCount(item)}
          shareCount={Number(item?.shareCount || 0)}
          saveCount={Number(item?.saveCount || 0)}
          saved={getSavedState(item)}
          reported={isPostReported(item)}
          onLike={() => onLike(item)}
          onComment={() => onComment(item)}
          onShare={() => onShare(item)}
          onSave={() => onSave(item)}
          onReport={() => onReport(item)}
          onVideoPress={onVideoPress}
        />
      );
    },
    [
      getLikeState,
      getSavedState,
      getVisibleDiscussionCount,
      isPostReported,
      onLike,
      onComment,
      onShare,
      onSave,
      onReport,
      onVideoPress,
    ]
  );

  const viewportStyle = youtubeLayout ? styles.youtubeList : { height: contentHeight };

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
        ref={listRef}
        data={rows}
        keyExtractor={keyExtractor}
        extraData={`${likeUiEpoch}:${scheduleNowMs}`}
        renderItem={renderYouTubeItem}
        showsVerticalScrollIndicator={false}
        initialNumToRender={4}
        windowSize={8}
        maxToRenderPerBatch={6}
        removeClippedSubviews
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
      extraData={`${likeUiEpoch}:${activeIndex}:${scheduleNowMs}`}
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
    paddingBottom: 24,
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
});
