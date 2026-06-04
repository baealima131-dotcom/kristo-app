import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
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
  isHomeFeedScheduleCardRow,
  resolveHomeFeedActiveScheduleSlot,
} from "./homeFeedUtils";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

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
  const [slotIndex, setSlotIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const slots = useMemo(() => {
    const all = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    const upcoming = all.filter((slot: any) => {
      const active = resolveHomeFeedActiveScheduleSlot(
        { scheduleSlots: [slot] },
        nowMs
      );
      return Boolean(active);
    });
    return upcoming.length ? upcoming : all;
  }, [item?.scheduleSlots, nowMs]);

  useEffect(() => {
    setSlotIndex(0);
  }, [item?.id]);

  const activeSlot = slots[slotIndex % Math.max(1, slots.length)] || resolveHomeFeedActiveScheduleSlot(item, nowMs);
  const slotFeedTotal = Math.max(1, slots.length);

  const openLiveRoom = useCallback(() => {
    (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
    const feedId = baseFeedId(String(item?.sourceScheduleId || item?.id || ""));
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
        slotFeedIndex={slotIndex % slotFeedTotal}
        slotFeedTotal={slotFeedTotal}
        nowMs={nowMs}
        isActive={isActive}
        fullBleed
        profileName={profileName}
        profileAvatarUri={profileAvatarUri}
        onSkipSlots={() => setSlotIndex((prev) => (prev + 1) % slotFeedTotal)}
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

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = Number(event?.nativeEvent?.contentOffset?.y || 0);
      const nextIndex = Math.max(0, Math.round(y / Math.max(1, contentHeight)));
      onActiveIndexChange(nextIndex);
    },
    [contentHeight, onActiveIndexChange]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const likeState = getLikeState(item, { index });
      const isScheduleCard = isHomeFeedScheduleCardRow(item, scheduleNowMs);

      if (isScheduleCard) {
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

      return (
        <FeedRow
          item={item}
          height={contentHeight}
          isActive={index === activeIndex}
          isNext={index === activeIndex + 1}
          screenFocused={screenFocused}
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
      screenFocused,
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
      onMomentumScrollEnd={handleMomentumScrollEnd}
      getItemLayout={(_, index) => ({
        length: contentHeight,
        offset: contentHeight * index,
        index,
      })}
      initialNumToRender={2}
      windowSize={3}
      maxToRenderPerBatch={2}
      removeClippedSubviews
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
