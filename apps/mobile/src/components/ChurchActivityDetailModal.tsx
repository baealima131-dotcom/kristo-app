import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dimensions,
  FlatList,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type ViewToken,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Modal } from "react-native";
import {
  activityIsVideo,
  churchActivityBody,
  churchActivityTitle,
  computeActivityGridPreviewTrace,
  postAuthorName,
  type ActivityGridItem,
} from "@/src/lib/churchActivityPosts";
import {
  resolvePostImageUri,
  resolveVideoUri,
} from "@/src/components/homeFeed/homeFeedUtils";

type Props = {
  items: ActivityGridItem[];
  initialItemId: string | null;
  onActiveItemChange: (
    item: ActivityGridItem
  ) => void;
  onEndReached: () => void;
  onClose: () => void;
};

const { height: SCREEN_HEIGHT } =
  Dimensions.get("window");

function authorAvatarUri(
  item: ActivityGridItem
) {
  return String(
    item?.authorAvatarUri ||
      (item as any)?.actorAvatarUri ||
      (item as any)?.avatarUri ||
      (item as any)?.profileImage ||
      (item as any)?.author?.avatarUri ||
      ""
  ).trim();
}

function readableDate(value?: string) {
  const date = new Date(String(value || ""));

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ActivitySlideMedia({
  item,
  active,
}: {
  item: ActivityGridItem;
  active: boolean;
}) {
  const isVideo = activityIsVideo(item);

  const previewTrace = useMemo(
    () => computeActivityGridPreviewTrace(item),
    [item]
  );

  const videoUri = String(
    resolveVideoUri(item) ||
      previewTrace?.resolvedVideoUri ||
      item?.videoUrl ||
      ""
  ).trim();

  const imageUri = String(
    resolvePostImageUri(item) ||
      previewTrace?.finalPreviewUri ||
      ""
  ).trim();

  const player = useVideoPlayer(
    isVideo && videoUri ? videoUri : null,
    (nextPlayer) => {
      nextPlayer.loop = false;
      nextPlayer.muted = false;
    }
  );

  useEffect(() => {
    try {
      if (active && isVideo && videoUri) {
        player.play();
      } else {
        player.pause();
      }
    } catch {}

    return () => {
      try {
        player.pause();
      } catch {}
    };
  }, [
    active,
    isVideo,
    player,
    videoUri,
  ]);

  if (isVideo && videoUri) {
    return (
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="contain"
        nativeControls={false}
      />
    );
  }

  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={StyleSheet.absoluteFillObject}
        resizeMode="contain"
      />
    );
  }

  return (
    <View style={s.emptyMedia}>
      <Ionicons
        name="images-outline"
        size={44}
        color="rgba(255,255,255,0.34)"
      />
    </View>
  );
}

const ActivitySlide = memo(
  function ActivitySlide({
    item,
    active,
  }: {
    item: ActivityGridItem;
    active: boolean;
  }) {
    const title = churchActivityTitle(item);
    const body = churchActivityBody(item);
    const author = postAuthorName(item);
    const avatarUri = authorAvatarUri(item);

    const initial =
      String(author || "?")
        .trim()
        .charAt(0)
        .toUpperCase() || "?";

    return (
      <View style={s.slide}>
        <ActivitySlideMedia
          item={item}
          active={active}
        />

        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(0,0,0,0.20)",
            "transparent",
            "rgba(1,3,8,0.16)",
            "rgba(1,3,8,0.97)",
          ]}
          locations={[0, 0.34, 0.62, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={s.postInformation}>
          <View style={s.identityRow}>
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={s.avatar}
                resizeMode="cover"
              />
            ) : (
              <View style={s.avatarFallback}>
                <Text style={s.avatarInitial}>
                  {initial}
                </Text>
              </View>
            )}

            <View style={s.identityText}>
              <Text
                style={s.authorName}
                numberOfLines={1}
              >
                {author}
              </Text>

              <Text style={s.postDate}>
                {readableDate(item?.createdAt)}
              </Text>
            </View>
          </View>

          <Text
            style={s.title}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {title}
          </Text>

          {body && body !== title ? (
            <Text
              style={s.body}
              numberOfLines={5}
            >
              {body}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }
);

export const ChurchActivityDetailModal = memo(
  function ChurchActivityDetailModal({
    items,
    initialItemId,
    onActiveItemChange,
    onEndReached,
    onClose,
  }: Props) {
    const insets = useSafeAreaInsets();
    const listRef =
      useRef<FlatList<ActivityGridItem>>(null);

    const initialIndex = useMemo(() => {
      if (!initialItemId) return 0;

      const foundIndex = items.findIndex(
        (item) =>
          String(item?.id || "") ===
          String(initialItemId)
      );

      return foundIndex >= 0 ? foundIndex : 0;
    }, [initialItemId, items]);

    const [activeIndex, setActiveIndex] =
      useState(initialIndex);

    useEffect(() => {
      if (!initialItemId || !items.length) {
        return;
      }

      setActiveIndex(initialIndex);

      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({
          index: initialIndex,
          animated: false,
        });
      });
    }, [
      initialIndex,
      initialItemId,
      items.length,
    ]);

    const viewabilityConfig = useRef({
      itemVisiblePercentThreshold: 72,
      minimumViewTime: 80,
    }).current;

    const onViewableItemsChanged = useRef(
      ({
        viewableItems,
      }: {
        viewableItems: Array<
          ViewToken<ActivityGridItem>
        >;
      }) => {
        const visible = viewableItems.find(
          (token) =>
            token.isViewable &&
            typeof token.index === "number"
        );

        if (
          !visible ||
          typeof visible.index !== "number" ||
          !visible.item
        ) {
          return;
        }

        setActiveIndex(visible.index);
        onActiveItemChange(visible.item);
      }
    ).current;

    const panResponder = useMemo(
      () =>
        PanResponder.create({
          onMoveShouldSetPanResponder: (
            _event,
            gesture
          ) =>
            gesture.dx > 22 &&
            Math.abs(gesture.dx) >
              Math.abs(gesture.dy) * 1.35,
          onPanResponderRelease: (
            _event,
            gesture
          ) => {
            if (
              gesture.dx > 95 &&
              gesture.vx > 0.15
            ) {
              onClose();
            }
          },
        }),
      [onClose]
    );

    const renderItem = useCallback(
      ({
        item,
        index,
      }: ListRenderItemInfo<ActivityGridItem>) => (
        <ActivitySlide
          item={item}
          active={index === activeIndex}
        />
      ),
      [activeIndex]
    );

    return (
      <Modal
        visible={Boolean(
          initialItemId && items.length
        )}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={onClose}
      >
        <View
          style={s.screen}
          {...panResponder.panHandlers}
        >
          <FlatList
            ref={listRef}
            data={items}
            renderItem={renderItem}
            keyExtractor={(item) =>
              String(item.id)
            }
            extraData={activeIndex}
            pagingEnabled
            bounces={false}
            decelerationRate="fast"
            disableIntervalMomentum
            snapToInterval={SCREEN_HEIGHT}
            snapToAlignment="start"
            showsVerticalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            getItemLayout={(_data, index) => ({
              length: SCREEN_HEIGHT,
              offset: SCREEN_HEIGHT * index,
              index,
            })}
            viewabilityConfig={viewabilityConfig}
            onViewableItemsChanged={
              onViewableItemsChanged
            }
            onEndReached={onEndReached}
            onEndReachedThreshold={1.2}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            removeClippedSubviews
          />

          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Back to Church Activity"
            style={({ pressed }) => [
              s.backButton,
              {
                top: insets.top + 10,
              },
              pressed
                ? s.backButtonPressed
                : null,
            ]}
          >
            <Ionicons
              name="chevron-back"
              size={27}
              color="#FFFFFF"
            />
          </Pressable>
        </View>
      </Modal>
    );
  }
);

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#02050B",
  },
  backButton: {
    position: "absolute",
    left: 14,
    zIndex: 20,
    width: 45,
    height: 45,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(25,8,34,0.82)",
    borderWidth: 1,
    borderColor: "rgba(226,189,97,0.72)",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 5,
    },
    elevation: 8,
  },
  backButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.94 }],
  },
  slide: {
    width: "100%",
    height: SCREEN_HEIGHT,
    overflow: "hidden",
    backgroundColor: "#02050B",
  },
  emptyMedia: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#090D15",
  },
  postInformation: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 93,
  },
  identityRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: "rgba(226,189,97,0.94)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  avatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(226,189,97,0.94)",
    backgroundColor: "rgba(217,179,95,0.18)",
  },
  avatarInitial: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,0.90)",
    textShadowRadius: 7,
  },
  postDate: {
    marginTop: 2,
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.90)",
    textShadowRadius: 6,
  },
  title: {
    marginTop: 11,
    color: "#F0C969",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0.05,
    textShadowColor: "rgba(0,0,0,0.94)",
    textShadowRadius: 8,
  },
  body: {
    marginTop: 5,
    color: "rgba(255,255,255,0.90)",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.92)",
    textShadowRadius: 8,
  },
});
