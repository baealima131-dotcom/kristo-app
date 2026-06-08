import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { ImagePostCard } from "./ImagePostCard";
import type { HomeFeedPostAccent } from "./homeFeedUtils";

type Props = {
  imageUris: string[];
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: HomeFeedPostAccent;
};

const MAX_CAROUSEL_IMAGES = 5;

export const ImagePostCarousel = memo(function ImagePostCarousel({
  imageUris,
  fallback = null,
  style,
  accent,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [pageWidth, setPageWidth] = useState(windowWidth);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList<string>>(null);

  const uris = useMemo(
    () =>
      (Array.isArray(imageUris) ? imageUris : [])
        .map((uri) => String(uri || "").trim())
        .filter(Boolean)
        .slice(0, MAX_CAROUSEL_IMAGES),
    [imageUris]
  );

  useEffect(() => {
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [uris.join("|")]);

  useEffect(() => {
    if (uris.length <= 1) return;
    const neighbors = [activeIndex - 1, activeIndex + 1].filter(
      (index) => index >= 0 && index < uris.length
    );
    for (const index of neighbors) {
      const uri = uris[index];
      if (!uri) continue;
      Image.prefetch(uri).catch(() => {});
    }
  }, [activeIndex, uris]);

  const updateIndexFromOffset = useCallback(
    (offsetX: number) => {
      if (pageWidth <= 0) return;
      const nextIndex = Math.max(0, Math.min(uris.length - 1, Math.round(offsetX / pageWidth)));
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
    },
    [pageWidth, uris.length]
  );

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateIndexFromOffset(event.nativeEvent.contentOffset.x);
    },
    [updateIndexFromOffset]
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      updateIndexFromOffset(event.nativeEvent.contentOffset.x);
    },
    [updateIndexFromOffset]
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<string>) => (
      <View style={[styles.page, { width: pageWidth }]}>
        <ImagePostCard
          imageUri={item}
          accent={accent}
          fallback={index === 0 ? fallback : undefined}
          style={styles.pageImage}
        />
      </View>
    ),
    [accent, fallback, pageWidth]
  );

  if (uris.length <= 1) {
    return (
      <ImagePostCard
        imageUri={uris[0] || ""}
        fallback={fallback}
        style={style}
        accent={accent}
      />
    );
  }

  return (
    <View
      style={[styles.wrap, style]}
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width);
        if (nextWidth > 0 && nextWidth !== pageWidth) setPageWidth(nextWidth);
      }}
    >
      <FlatList
        ref={listRef}
        data={uris}
        horizontal
        pagingEnabled
        bounces={false}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        scrollEventThrottle={16}
        keyExtractor={(uri, index) => `${uri}:${index}`}
        renderItem={renderItem}
        onScroll={onScroll}
        onMomentumScrollEnd={onMomentumScrollEnd}
        getItemLayout={
          pageWidth > 0
            ? (_, index) => ({
                length: pageWidth,
                offset: pageWidth * index,
                index,
              })
            : undefined
        }
        initialNumToRender={Math.min(uris.length, 2)}
        windowSize={3}
        maxToRenderPerBatch={2}
        removeClippedSubviews={false}
        style={styles.list}
      />

      <View pointerEvents="none" style={styles.counterPill}>
        <Text style={styles.counterText}>
          {activeIndex + 1}/{uris.length}
        </Text>
      </View>

      <View pointerEvents="none" style={styles.dotsRow}>
        {uris.map((uri, index) => (
          <View
            key={`${uri}:${index}`}
            style={[styles.dot, index === activeIndex ? styles.dotActive : null]}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  list: {
    flex: 1,
  },
  page: {
    flex: 1,
    height: "100%",
  },
  pageImage: {
    flex: 1,
  },
  counterPill: {
    position: "absolute",
    top: 14,
    right: 14,
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(3,5,12,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  dotsRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 118,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  dotActive: {
    width: 18,
    backgroundColor: "rgba(217,179,95,0.96)",
  },
});
