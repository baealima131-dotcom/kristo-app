import React, { memo, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { FeedRow } from "./FeedRow";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  rows: any[];
  contentHeight: number;
  activeIndex: number;
  screenFocused: boolean;
  loading: boolean;
  getLikeState: (item: any) => { liked: boolean; likeCount: number };
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

export const FeedList = memo(function FeedList({
  rows,
  contentHeight,
  activeIndex,
  screenFocused,
  loading,
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
      const likeState = getLikeState(item);
      return (
        <FeedRow
          item={item}
          height={contentHeight}
          isActive={index === activeIndex}
          isNext={index === activeIndex + 1}
          screenFocused={screenFocused}
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

  const keyExtractor = useCallback((item: any, index: number) => String(item?.id || `row-${index}`), []);

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
