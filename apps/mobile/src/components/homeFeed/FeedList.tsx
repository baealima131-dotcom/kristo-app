import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { HomeLiveScheduleCard } from "@/src/components/HomeLiveScheduleCard";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import { FeedRow } from "./FeedRow";
import {
  feedRenderKey,
  isExplicitHomeFeedMediaScheduleRow,
  isHomeFeedExpandedScheduleSlotRow,
  isHomeFeedScheduleCardRow,
  isMediaLiveSlotsHomeFeedRow,
  resolveHomeFeedSlotCardStatus,
} from "./homeFeedUtils";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";
import { isHomeFeedRenderPaused } from "@/src/lib/liveRoomStartup";
import { isKristoVerboseFeedDebug } from "@/src/lib/kristoDebugFlags";
import {
  collectHomeFeedVideoWindowIds,
  computeHomeFeedMountedVideoIndexes,
  resolveHomeFeedVideoWarmMode,
} from "@/src/lib/homeFeedVideoWindow";
import { isVideoPost } from "./homeFeedUtils";

// Dedupe for the first-3-video-rows index diagnostic (keyed by row id).
const lastFeedVideoIndexDiag = new Map<string, string>();

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
};

type FeedScheduleRowProps = {
  item: any;
  height: number;
  isActive: boolean;
  likedByMe: boolean;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
};

const FeedScheduleRow = memo(function FeedScheduleRow({
  item,
  height,
  isActive,
  likedByMe,
  liked,
  likeCount,
  saved,
  onLike,
  onComment,
  onShare,
  onSave,
}: FeedScheduleRowProps) {
  const router = useRouter();
  const session = getSessionSync() as any;
  const [nowMs, setNowMs] = useState(Date.now());
  const isExpandedSlot = item?.homeFeedSlotExpanded === true;

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const activeSlot = useMemo(() => {
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    return slots[0] || null;
  }, [item?.scheduleSlots]);

  const slotNumber = Math.max(1, Number(item?.slotNumber || 1));
  const slotFeedTotal = Math.max(
    1,
    Number(item?.parentScheduleSlotCount || item?.scheduleSlots?.length || 1)
  );
  const slotFeedIndex = slotNumber - 1;

  const openLiveRoom = useCallback(() => {
    (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
    const feedId = baseFeedId(
      String(item?.parentScheduleId || item?.sourceScheduleId || item?.id || "")
    );
    router.push({
      pathname: "/(tabs)/more/my-church-room/messages/live-room",
      params: {
        id: "church-media-room",
        feedId,
        sourceScheduleId: feedId,
        scheduleType: String(item?.scheduleType || "media-live-slots"),
      },
    } as any);
  }, [item?.id, item?.scheduleType, item?.sourceScheduleId, router]);

  const profileName = String(
    session?.displayName || session?.name || session?.fullName || "You"
  ).trim();
  const profileAvatarUri = String(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  ).trim();

  return (
    <View style={[scheduleStyles.slide, { height }]}>
      <LinearGradient
        colors={["#030508", "#0A0F18", "#050810"]}
        style={StyleSheet.absoluteFillObject}
      />
      <HomeLiveScheduleCard
        item={item}
        activeSlot={activeSlot}
        slotFeedIndex={slotFeedIndex}
        slotFeedTotal={slotFeedTotal}
        nowMs={nowMs}
        isActive={isActive}
        fullBleed
        disableSlotCarousel={isExpandedSlot}
        profileName={profileName}
        profileAvatarUri={profileAvatarUri}
        onOpenLiveRoom={openLiveRoom}
        displayLiked={likedByMe || liked}
        likeCount={likeCount}
        localSaved={saved}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onToggleSave={onSave}
      />
    </View>
  );
});

export const FeedList = memo(function FeedList({
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
}: Props) {
  const [scheduleNowMs] = useState(() => Date.now());
  const renderPaused = isHomeFeedRenderPaused();
  const effectiveScreenFocused = screenFocused && !renderPaused;

  const mountedVideoIndexes = useMemo(
    () => computeHomeFeedMountedVideoIndexes(rows, activeIndex),
    [rows, activeIndex]
  );

  const prevWarmWindowRef = useRef<{ key: string; postIds: string[] }>({
    key: "",
    postIds: [],
  });

  useEffect(() => {
    const key = mountedVideoIndexes.join(",");
    const postIds = mountedVideoIndexes
      .map((idx) => String(rows[idx]?.id || "").trim())
      .filter(Boolean);

    if (key !== prevWarmWindowRef.current.key) {
      for (const id of prevWarmWindowRef.current.postIds) {
        if (!postIds.includes(id)) {
          console.log("KRISTO_VIDEO_PLAYER_EVICT", { id, reason: "window-shift" });
        }
      }
      prevWarmWindowRef.current = { key, postIds };

      console.log("KRISTO_VIDEO_WARM_WINDOW", {
        activeIndex,
        mountedIndexes: mountedVideoIndexes,
        reason: "window-update",
      });
    }
  }, [mountedVideoIndexes, activeIndex, rows]);

  const syncActiveIndexFromOffset = useCallback(
    (y: number) => {
      const nextIndex = Math.max(0, Math.round(y / Math.max(1, contentHeight)));
      if (nextIndex !== activeIndex) {
        onActiveIndexChange(nextIndex);
      }
    },
    [activeIndex, contentHeight, onActiveIndexChange]
  );

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      syncActiveIndexFromOffset(Number(event?.nativeEvent?.contentOffset?.y || 0));
    },
    [syncActiveIndexFromOffset]
  );

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      syncActiveIndexFromOffset(Number(event?.nativeEvent?.contentOffset?.y || 0));
    },
    [syncActiveIndexFromOffset]
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
      const isScheduleCandidate =
        isExplicitHomeFeedMediaScheduleRow(item) || isMediaLiveSlotsHomeFeedRow(item);
      const isScheduleCard = isHomeFeedScheduleCardRow(item, scheduleNowMs);

      if (!renderPaused && isKristoVerboseFeedDebug()) {
        console.log("KRISTO_FEED_RENDER_ITEM", {
          index,
          id: feedRenderKey(item) || String(item?.id || ""),
          scheduleType: String(item?.scheduleType || ""),
          source: String(item?.source || ""),
          slotCount: Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0,
          isScheduleCandidate,
          isScheduleCard,
          rowKind: isScheduleCard ? "schedule-card" : "feed-row",
        });
      }

      if (isScheduleCandidate && !isScheduleCard && isKristoVerboseFeedDebug()) {
        console.log("KRISTO_HOME_FEED_SCHEDULE_ROW_DROPPED", {
          index,
          id: feedRenderKey(item) || String(item?.id || ""),
          scheduleType: String(item?.scheduleType || ""),
          reason: "schedule_card_gate",
        });
      }

      if (isScheduleCard) {
        const slot = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots[0] : null;
        if (isHomeFeedExpandedScheduleSlotRow(item) && isKristoVerboseFeedDebug()) {
          console.log("KRISTO_HOME_FEED_SCHEDULE_SLOT_RENDERED", {
            index,
            parentScheduleId: String(item?.parentScheduleId || item?.sourceScheduleId || ""),
            slotNumber: Number(item?.slotNumber || 0),
            status: resolveHomeFeedSlotCardStatus(slot),
            rowKey: feedRenderKey(item),
          });
        } else if (isKristoVerboseFeedDebug()) {
          console.log("KRISTO_HOME_FEED_SCHEDULE_ROW_RENDERED", {
            index,
            id: feedRenderKey(item) || String(item?.id || ""),
            scheduleType: String(item?.scheduleType || ""),
            slotCount: Array.isArray(item?.scheduleSlots) ? item.scheduleSlots.length : 0,
          });
        }
        return (
          <FeedScheduleRow
            item={item}
            height={contentHeight}
            isActive={index === activeIndex}
            likedByMe={likeState.likedByMe}
            liked={likeState.liked}
            likeCount={likeState.likeCount}
            saved={getSavedState(item)}
            onLike={() => onLike(item)}
            onComment={() => onComment(item)}
            onShare={() => onShare(item)}
            onSave={() => onSave(item)}
          />
        );
      }

      const videoWarmMode = isVideoPost(item)
        ? resolveHomeFeedVideoWarmMode(index, activeIndex, mountedVideoIndexes)
        : "off";

      // Diagnostic for the first 3 video rows: shows whether the first visible
      // video is the active row and whether it mounts a player in the rolling window.
      if (isKristoVerboseFeedDebug() && isVideoPost(item) && index <= 2) {
        const rowId = String(item?.id || "");
        const mountsPlayer = videoWarmMode !== "off" && effectiveScreenFocused;
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
        />
      );
    },
    [
      contentHeight,
      activeIndex,
      mountedVideoIndexes,
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
    ]
  );

  const keyExtractor = useCallback(
    (item: any, index: number) => feedRenderKey(item) || String(item?.id || `row-${index}`),
    []
  );

  const viewportStyle = { height: contentHeight };

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
        <Text style={styles.emptyTitle}>Your feed is quiet</Text>
        <Text style={styles.emptyBody}>
          Posts from your church and community will appear here.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={keyExtractor}
      extraData={`${likeUiEpoch}:${activeIndex}:${scheduleNowMs}`}
      renderItem={renderItem}
      pagingEnabled
      decelerationRate="fast"
      snapToInterval={contentHeight}
      snapToAlignment="start"
      disableIntervalMomentum
      showsVerticalScrollIndicator={false}
      onScroll={handleScroll}
      scrollEventThrottle={16}
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
});

const scheduleStyles = StyleSheet.create({
  slide: {
    width: "100%",
    backgroundColor: "#03050C",
    overflow: "hidden",
  },
});

const styles = StyleSheet.create({
  list: {
    backgroundColor: HOME_FEED_BG,
    overflow: "hidden",
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
