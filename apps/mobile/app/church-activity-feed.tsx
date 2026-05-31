import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useIsFocused } from "@react-navigation/native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { fetchChurchMembers } from "@/src/lib/churchMembersApi";
import { feedList, subscribe as subscribeHomeFeed } from "@/src/lib/homeFeedStore";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import {
  filterChurchActivityFeedRows,
  formatActivityWhen,
  getChurchActivityLabel,
  getPostAuthorId,
  isChurchActivityAllowedPost,
  isChurchActivityExcludedCard,
  normalizeActivityMediaUrl,
  postAuthorName,
  stampChurchFeedScope,
  type ChurchActivityFeedMode,
} from "@/src/lib/churchActivityPosts";

function mediaUrl(uri?: string) {
  return normalizeActivityMediaUrl(uri);
}

function formatActionCount(value?: number) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

function syncActivityFeedLike(postId: string, liked?: boolean) {
  const session = getSessionSync() as any;
  const cleanPostId = baseFeedId(postId);
  if (!cleanPostId) return;

  apiPost(
    "/api/church/feed",
    {
      action: "toggle_like",
      postId: cleanPostId,
      ...(typeof liked === "boolean" ? { liked } : {}),
    },
    {
      headers: getKristoHeaders({
        userId: session?.userId || "",
        role: (session?.role || "Member") as any,
        churchId: session?.churchId || "",
      }),
    }
  ).catch(() => {});
}

type ChipFilterKey = "all" | "media" | "me" | string;

function resolveInitialChip(
  routeMode: ChurchActivityFeedMode,
  routeMemberId: string,
  currentUserId: string
): ChipFilterKey {
  if (routeMode === "media") return "media";
  if (routeMemberId && routeMemberId === currentUserId) return "me";
  if (routeMemberId) return routeMemberId;
  return "all";
}

const CHIP_AVATAR = 60;

const ActivityFeedFilterChips = memo(function ActivityFeedFilterChips({
  selectedKey,
  currentUserAvatar,
  currentUserName,
  members,
  onSelect,
}: {
  selectedKey: ChipFilterKey;
  currentUserAvatar?: string;
  currentUserName?: string;
  members: { userId: string; name: string; avatarUri?: string }[];
  onSelect: (key: ChipFilterKey) => void;
}) {
  const renderChip = (
    key: ChipFilterKey,
    label: string,
    content: React.ReactNode
  ) => {
    const active = selectedKey === key;
    return (
      <Pressable key={key} onPress={() => onSelect(key)} style={styles.filterChip}>
        <View style={styles.filterChipAvatarShell}>
          {active ? <View pointerEvents="none" style={styles.filterChipGlow} /> : null}
          <View style={[styles.filterChipRing, active ? styles.filterChipRingActive : null]}>
            {content}
          </View>
        </View>
        <Text style={[styles.filterChipLabel, active ? styles.filterChipLabelActive : null]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  };

  const meInitial = String(currentUserName || "Me").trim().charAt(0).toUpperCase() || "M";

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterChipRow}
    >
      {renderChip(
        "all",
        "All Church",
        <View style={styles.filterChipFallback}>
          <Ionicons name="business-outline" size={24} color="#F4D06F" />
        </View>
      )}
      {renderChip(
        "media",
        "Media",
        <View style={styles.filterChipFallback}>
          <Ionicons name="images-outline" size={24} color="#F4D06F" />
        </View>
      )}
      {renderChip(
        "me",
        "Me",
        currentUserAvatar ? (
          <Image source={{ uri: currentUserAvatar }} style={styles.filterChipAvatar} resizeMode="cover" />
        ) : (
          <View style={styles.filterChipFallback}>
            <Text style={styles.filterChipInitial}>{meInitial}</Text>
          </View>
        )
      )}
      {members.map((member) => {
        const initial = String(member.name || "?").trim().charAt(0).toUpperCase() || "?";
        const firstName = String(member.name || "Member").trim().split(/\s+/)[0] || "Member";
        return renderChip(
          member.userId,
          firstName,
          member.avatarUri ? (
            <Image source={{ uri: member.avatarUri }} style={styles.filterChipAvatar} resizeMode="cover" />
          ) : (
            <View style={styles.filterChipFallback}>
              <Text style={styles.filterChipInitial}>{initial}</Text>
            </View>
          )
        );
      })}
    </ScrollView>
  );
});

const ActivityFeedVideo = memo(function ActivityFeedVideo({
  uri,
  posterUri,
  shouldPlay,
}: {
  uri: string;
  posterUri?: string;
  shouldPlay: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    if (shouldPlay) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, shouldPlay]);

  const poster = String(posterUri || "").trim();
  const showPoster = !!poster && !shouldPlay;

  return (
    <View style={StyleSheet.absoluteFillObject}>
      {showPoster ? (
        <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : null}
      <VideoView player={player} style={StyleSheet.absoluteFillObject} contentFit="cover" nativeControls={false} />
    </View>
  );
});

const ActivityActionRail = memo(function ActivityActionRail({
  liked,
  likeCount,
  commentCount,
  shareCount,
  saved,
  onLike,
  onComment,
  onShare,
  onSave,
}: {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saved: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
}) {
  const likeScale = useRef(new Animated.Value(1)).current;
  const likeRipple = useRef(new Animated.Value(0)).current;

  const pulseLike = useCallback(() => {
    likeScale.setValue(0.88);
    likeRipple.setValue(0);
    Animated.parallel([
      Animated.spring(likeScale, {
        toValue: 1,
        friction: 4,
        tension: 180,
        useNativeDriver: true,
      }),
      Animated.timing(likeRipple, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
    ]).start(() => likeRipple.setValue(0));
  }, [likeRipple, likeScale]);

  const handleLike = useCallback(() => {
    pulseLike();
    onLike();
  }, [onLike, pulseLike]);

  return (
    <View pointerEvents="box-none" style={styles.actionRail}>
      <Pressable
        hitSlop={18}
        style={[styles.actionBtn, liked ? styles.actionBtnActive : null]}
        onPress={handleLike}
      >
        <BlurView
          intensity={38}
          tint="dark"
          style={[styles.actionIconWrap, liked ? styles.actionIconWrapLiked : null]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.likeRipple,
              {
                opacity: likeRipple.interpolate({
                  inputRange: [0, 0.25, 1],
                  outputRange: [0, 0.45, 0],
                }),
                transform: [
                  {
                    scale: likeRipple.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.7, 1.75],
                    }),
                  },
                ],
              },
            ]}
          />
          <Animated.View style={{ transform: [{ scale: likeScale }] }}>
            <Ionicons name={liked ? "heart" : "heart-outline"} size={26} color={liked ? "#FF5A7A" : "#FFFFFF"} />
          </Animated.View>
        </BlurView>
        <Text style={[styles.actionText, liked ? styles.actionTextLiked : null]}>
          {formatActionCount(likeCount)}
        </Text>
      </Pressable>

      <Pressable hitSlop={18} style={styles.actionBtn} onPress={onComment}>
        <BlurView intensity={38} tint="dark" style={styles.actionIconWrap}>
          <Ionicons name="chatbubble-ellipses-outline" size={25} color="#FFFFFF" />
        </BlurView>
        <Text style={styles.actionText}>{formatActionCount(commentCount)}</Text>
      </Pressable>

      <Pressable hitSlop={18} style={styles.actionBtn} onPress={onShare}>
        <BlurView intensity={38} tint="dark" style={styles.actionIconWrap}>
          <Ionicons name="arrow-redo-outline" size={25} color="#FFFFFF" />
        </BlurView>
        <Text style={styles.actionText}>{formatActionCount(shareCount)}</Text>
      </Pressable>

      <Pressable
        hitSlop={18}
        style={[styles.actionBtn, saved ? styles.actionBtnActive : null]}
        onPress={onSave}
      >
        <View style={[styles.actionIconWrap, saved ? styles.actionIconWrapSaved : null]}>
          <Ionicons
            name={saved ? "bookmark" : "bookmark-outline"}
            size={24}
            color={saved ? "#F3D28F" : "#FFFFFF"}
          />
        </View>
        <Text style={[styles.actionText, styles.actionTextCompact, saved ? styles.actionTextSaved : null]}>
          {saved ? "Saved" : "Save"}
        </Text>
      </Pressable>
    </View>
  );
});

const ActivityFeedSlide = memo(function ActivityFeedSlide({
  item,
  height,
  isActive,
  screenFocused,
  liked,
  likeCount,
  saved,
  onLike,
  onComment,
  onShare,
  onSave,
}: {
  item: any;
  height: number;
  isActive: boolean;
  screenFocused: boolean;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
}) {
  const title = String(item?.title || "").trim();
  const body = String(item?.body || item?.text || "").trim();
  const authorName = String(item?.authorName || item?.actorLabel || "Church member").trim();
  const whenLabel = formatActivityWhen(item?.createdAt);
  const label = getChurchActivityLabel(item);
  const isVideo = item?.mediaType === "video" && Boolean(String(item?.videoUrl || item?.mediaUri || "").trim());
  const imageUri = String(item?.mediaUri || item?.imageUrl || "").trim();
  const videoUri = mediaUrl(item?.videoUrl || item?.mediaUri);
  const posterUri = mediaUrl(item?.posterUri || item?.thumbnailUri || item?.thumbnailUrl);
  const shouldPlayVideo = isVideo && isActive && screenFocused;
  const commentCount = Number(item?.commentCount || 0);
  const shareCount = Number(item?.shareCount || 0);
  const hasImage = Boolean(imageUri);

  return (
    <View style={[styles.slide, { height }]}>
      {isVideo && videoUri ? (
        <ActivityFeedVideo uri={videoUri} posterUri={posterUri} shouldPlay={shouldPlayVideo} />
      ) : hasImage ? (
        <Image source={{ uri: mediaUrl(imageUri) }} style={styles.mediaFill} resizeMode="cover" />
      ) : (
        <LinearGradient colors={["#050814", "#0A1020", "#03050C"]} style={StyleSheet.absoluteFillObject} />
      )}

      <LinearGradient
        pointerEvents="none"
        colors={["transparent", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.75)"]}
        locations={[0, 0.55, 1]}
        style={styles.bottomGradient}
      />

      <ActivityActionRail
        liked={liked}
        likeCount={likeCount}
        commentCount={commentCount}
        shareCount={shareCount}
        saved={saved}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onSave={onSave}
      />

      <View style={styles.metaFooter}>
        <View style={styles.labelPill}>
          <Text style={styles.labelPillText}>{label}</Text>
        </View>

        {!!title ? (
          <Text style={styles.title} numberOfLines={3}>
            {title}
          </Text>
        ) : null}

        {!!body && body !== title ? (
          <Text style={styles.body} numberOfLines={6}>
            {body}
          </Text>
        ) : null}

        <Text style={styles.authorName} numberOfLines={1}>
          {authorName}
        </Text>
        {!!whenLabel ? <Text style={styles.whenLabel}>{whenLabel}</Text> : null}
      </View>
    </View>
  );
});

export default function ChurchActivityFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const screenFocused = useIsFocused();
  const session = getSessionSync() as any;
  const currentUserId = String(session?.userId || "").trim();
  const currentUserAvatar = mediaUrl(String(session?.avatarUrl || session?.avatarUri || "").trim());
  const currentUserName = String(session?.displayName || session?.name || "Me").trim();

  const {
    focusPostId,
    activityChurchId,
    activityMemberId,
    activityMode,
  } = useLocalSearchParams<{
    focusPostId?: string;
    activityChurchId?: string;
    activityMemberId?: string;
    activityMode?: ChurchActivityFeedMode;
  }>();

  const churchId = String(activityChurchId || "").trim();
  const routeMemberId = String(activityMemberId || "").trim();
  const routeMode: ChurchActivityFeedMode =
    activityMode === "member" || activityMode === "media" ? activityMode : "church";

  const [loading, setLoading] = useState(true);
  const [sourceRows, setSourceRows] = useState<any[]>([]);
  const [homeFeedTick, setHomeFeedTick] = useState(0);
  const [churchMembers, setChurchMembers] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeChip, setActiveChip] = useState<ChipFilterKey>(() =>
    resolveInitialChip(routeMode, routeMemberId, currentUserId)
  );
  const [optimisticLikes, setOptimisticLikes] = useState<
    Record<string, { liked: boolean; likeCount: number }>
  >({});
  const [optimisticSaved, setOptimisticSaved] = useState<Record<string, boolean>>({});

  const listRef = useRef<FlatList<any>>(null);
  const focusHandledRef = useRef("");
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const contentHeight = Math.max(280, windowHeight - topChromeHeight);

  useEffect(() => {
    return subscribeHomeFeed(() => setHomeFeedTick((v) => v + 1));
  }, []);

  useEffect(() => {
    if (!churchId) {
      setChurchMembers([]);
      return;
    }

    let alive = true;
    void fetchChurchMembers()
      .then((rows) => {
        if (!alive) return;
        setChurchMembers(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (alive) setChurchMembers([]);
      });

    return () => {
      alive = false;
    };
  }, [churchId]);

  const loadFeed = useCallback(async () => {
    if (!churchId) {
      setSourceRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await apiGet<any>(
        "/api/church/feed",
        { headers: getKristoHeaders() },
        { screen: "ChurchActivityFeed", throttleMs: 0 }
      );
      const feedItems = Array.isArray(res?.data) ? res.data : [];
      const scopedApiRows = feedItems.map((item: any) => stampChurchFeedScope(item, churchId));
      setSourceRows(scopedApiRows);
    } catch {
      setSourceRows([]);
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const mergedSourceRows = useMemo(() => {
    void homeFeedTick;
    const localRows = feedList().map((item) => stampChurchFeedScope(item, churchId));
    return [...sourceRows, ...localRows];
  }, [sourceRows, homeFeedTick, churchId]);

  const filterContext = useMemo(() => {
    if (activeChip === "all") {
      return { activityMode: "church" as ChurchActivityFeedMode, activityMemberId: undefined };
    }
    if (activeChip === "media") {
      return { activityMode: "media" as ChurchActivityFeedMode, activityMemberId: undefined };
    }
    if (activeChip === "me") {
      return { activityMode: "member" as ChurchActivityFeedMode, activityMemberId: currentUserId };
    }
    return { activityMode: "member" as ChurchActivityFeedMode, activityMemberId: activeChip };
  }, [activeChip, currentUserId]);

  const feedRows = useMemo(() => {
    return filterChurchActivityFeedRows(
      mergedSourceRows,
      {
        activityChurchId: churchId,
        activityMemberId: filterContext.activityMemberId,
        activityMode: filterContext.activityMode,
      },
      mediaUrl
    );
  }, [mergedSourceRows, churchId, filterContext]);

  const recentPosterMembers = useMemo(() => {
    const memberLookup = new Map<string, { name: string; avatarUri?: string }>();
    for (const member of churchMembers) {
      const userIdValue = String(member?.userId || member?.id || "").trim();
      if (!userIdValue || userIdValue === currentUserId) continue;
      memberLookup.set(userIdValue, {
        name: String(
          member?.fullName ||
            member?.name ||
            member?.displayName ||
            member?.username ||
            "Member"
        ).trim(),
        avatarUri: mediaUrl(
          String(member?.avatarUrl || member?.avatarUri || member?.profileImage || "").trim()
        ),
      });
    }

    const latestByAuthor = new Map<string, number>();
    for (const item of mergedSourceRows) {
      if (isChurchActivityExcludedCard(item)) continue;
      if (!isChurchActivityAllowedPost(item)) continue;
      const authorId = getPostAuthorId(item);
      if (!authorId || authorId === currentUserId) continue;
      const ms = new Date(String(item?.createdAt || "")).getTime();
      const prev = latestByAuthor.get(authorId) || 0;
      if (Number.isFinite(ms) && ms > prev) {
        latestByAuthor.set(authorId, ms);
      }
    }

    return [...latestByAuthor.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([userId]) => {
        const lookup = memberLookup.get(userId);
        const sample = mergedSourceRows.find((row) => getPostAuthorId(row) === userId);
        return {
          userId,
          name: lookup?.name || postAuthorName(sample) || "Member",
          avatarUri: lookup?.avatarUri,
        };
      });
  }, [mergedSourceRows, churchMembers, currentUserId]);

  const isMemberChipEmpty =
    feedRows.length === 0 &&
    !loading &&
    Boolean(churchId) &&
    activeChip !== "all" &&
    activeChip !== "media";

  const handleChipSelect = useCallback((key: ChipFilterKey) => {
    setActiveChip(key);
    setActiveIndex(0);
    focusHandledRef.current = "";
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      } catch {}
    });
  }, []);

  const getLikeState = useCallback(
    (item: any) => {
      const postId = String(item?.id || "");
      const optimistic = optimisticLikes[postId];
      if (optimistic) return optimistic;
      return {
        liked: Boolean(item?.liked),
        likeCount: Number(item?.likeCount || 0),
      };
    },
    [optimisticLikes]
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
      const postId = String(item?.id || "").trim();
      if (!postId) return;

      const current = getLikeState(item);
      const nextLiked = !current.liked;
      const nextCount = Math.max(0, current.likeCount + (nextLiked ? 1 : -1));

      setOptimisticLikes((prev) => ({
        ...prev,
        [postId]: { liked: nextLiked, likeCount: nextCount },
      }));
      syncActivityFeedLike(postId, nextLiked);
    },
    [getLikeState]
  );

  const handleSave = useCallback(
    (item: any) => {
      const postId = String(item?.id || "").trim();
      if (!postId) return;

      setOptimisticSaved((prev) => ({
        ...prev,
        [postId]: !getSavedState(item),
      }));
    },
    [getSavedState]
  );

  const handleComment = useCallback(() => {
    Alert.alert("Comments", "Comments coming soon.");
  }, []);

  const handleShare = useCallback(async (item: any) => {
    const title = String(item?.title || "Church Activity").trim();
    const body = String(item?.body || item?.text || "").trim();
    const authorName = String(item?.authorName || item?.actorLabel || "Church member").trim();
    const message = [title, body, `— ${authorName}`].filter(Boolean).join("\n\n");

    try {
      await Share.share({ message, title });
    } catch {}
  }, []);

  useEffect(() => {
    const rawFocusId = String(focusPostId || "").trim();
    if (!rawFocusId || !feedRows.length) return;
    if (focusHandledRef.current === rawFocusId) return;

    const matchIndex = feedRows.findIndex((item) => String(item?.id || "") === rawFocusId);
    if (matchIndex < 0) return;

    focusHandledRef.current = rawFocusId;
    setActiveIndex(matchIndex);

    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index: matchIndex, animated: false });
      } catch {}
    });
  }, [focusPostId, feedRows]);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = Number(event?.nativeEvent?.contentOffset?.y || 0);
      const nextIndex = Math.max(0, Math.round(y / Math.max(1, contentHeight)));
      setActiveIndex(nextIndex);
    },
    [contentHeight]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const likeState = getLikeState(item);
      const saved = getSavedState(item);

      return (
        <ActivityFeedSlide
          item={item}
          height={contentHeight}
          isActive={index === activeIndex}
          screenFocused={screenFocused}
          liked={likeState.liked}
          likeCount={likeState.likeCount}
          saved={saved}
          onLike={() => handleLike(item)}
          onComment={handleComment}
          onShare={() => handleShare(item)}
          onSave={() => handleSave(item)}
        />
      );
    },
    [
      contentHeight,
      activeIndex,
      screenFocused,
      getLikeState,
      getSavedState,
      handleLike,
      handleComment,
      handleShare,
      handleSave,
    ]
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View
        style={[styles.topChrome, { paddingTop: insets.top + 4 }]}
        onLayout={(event) => {
          const nextHeight = Math.ceil(event.nativeEvent.layout.height);
          if (nextHeight > 0 && nextHeight !== topChromeHeight) {
            setTopChromeHeight(nextHeight);
          }
        }}
      >
        <View style={styles.topChromeRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed ? styles.pressed : null]}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>

          <View style={styles.chipsWrap}>
            <ActivityFeedFilterChips
              selectedKey={activeChip}
              currentUserAvatar={currentUserAvatar}
              currentUserName={currentUserName}
              members={recentPosterMembers}
              onSelect={handleChipSelect}
            />
          </View>

          {!loading && feedRows.length > 0 ? (
            <Text style={styles.postCount}>{feedRows.length}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.contentBlock}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : !churchId ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>Church context is required.</Text>
          </View>
        ) : isMemberChipEmpty ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyBody}>Posts from this member will appear here.</Text>
            <Pressable
              onPress={() => handleChipSelect("all")}
              style={({ pressed }) => [styles.emptyChipBtn, pressed ? styles.pressed : null]}
            >
              <Text style={styles.emptyChipBtnText}>All Church</Text>
            </Pressable>
          </View>
        ) : feedRows.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyBody}>Church activity for this filter will appear here.</Text>
            <Pressable
              onPress={() => handleChipSelect("all")}
              style={({ pressed }) => [styles.emptyChipBtn, pressed ? styles.pressed : null]}
            >
              <Text style={styles.emptyChipBtnText}>All Church</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={feedRows}
            keyExtractor={(item, index) => String(item?.id || index)}
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
          />
        )}
      </View>
    </View>
  );
}

const ACTION_RAIL_BOTTOM = 108;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#03050C",
  },
  topChrome: {
    backgroundColor: "#03050C",
    paddingHorizontal: 8,
    paddingBottom: 4,
    zIndex: 10,
  },
  topChromeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  pressed: {
    opacity: 0.82,
  },
  chipsWrap: {
    flex: 1,
    minWidth: 0,
  },
  postCount: {
    marginTop: 18,
    minWidth: 18,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  filterChipRow: {
    paddingVertical: 2,
    paddingRight: 4,
    gap: 6,
    alignItems: "flex-start",
  },
  filterChip: {
    width: 68,
    alignItems: "center",
    gap: 5,
  },
  filterChipAvatarShell: {
    width: CHIP_AVATAR + 8,
    height: CHIP_AVATAR + 8,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipGlow: {
    position: "absolute",
    width: CHIP_AVATAR + 10,
    height: CHIP_AVATAR + 10,
    borderRadius: (CHIP_AVATAR + 10) / 2,
    backgroundColor: "rgba(217,179,95,0.14)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  filterChipRing: {
    width: CHIP_AVATAR,
    height: CHIP_AVATAR,
    borderRadius: CHIP_AVATAR / 2,
    padding: 2,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
    overflow: "hidden",
  },
  filterChipRingActive: {
    borderColor: "rgba(217,179,95,0.96)",
    borderWidth: 2,
  },
  filterChipAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: CHIP_AVATAR / 2,
  },
  filterChipFallback: {
    flex: 1,
    borderRadius: CHIP_AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  filterChipInitial: {
    color: "#F4D06F",
    fontSize: 16,
    fontWeight: "900",
  },
  filterChipLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 9.5,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 12,
    maxWidth: 68,
  },
  filterChipLabelActive: {
    color: "#F4D06F",
  },
  contentBlock: {
    flex: 1,
    backgroundColor: "#03050C",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 8,
  },
  emptyChipBtn: {
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  },
  emptyChipBtnText: {
    color: "#F4D06F",
    fontSize: 13,
    fontWeight: "800",
  },
  slide: {
    width: "100%",
    backgroundColor: "#03050C",
    overflow: "hidden",
  },
  mediaFill: {
    ...StyleSheet.absoluteFillObject,
  },
  bottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "42%",
  },
  metaFooter: {
    position: "absolute",
    left: 16,
    right: 84,
    bottom: 22,
    gap: 7,
  },
  labelPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  labelPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
  body: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    lineHeight: 22,
  },
  authorName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  whenLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
  },
  actionRail: {
    position: "absolute",
    right: 10,
    bottom: ACTION_RAIL_BOTTOM,
    zIndex: 12,
    alignItems: "center",
    gap: 12,
  },
  actionBtn: {
    width: 56,
    minHeight: 68,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  actionBtnActive: {
    transform: [{ scale: 1.03 }],
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(7,10,16,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  actionIconWrapLiked: {
    backgroundColor: "rgba(255,90,122,0.22)",
    borderColor: "rgba(255,90,122,0.82)",
  },
  actionIconWrapSaved: {
    backgroundColor: "rgba(243,210,143,0.14)",
    borderColor: "rgba(243,210,143,0.58)",
  },
  likeRipple: {
    position: "absolute",
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(255,90,122,0.72)",
  },
  actionText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
    lineHeight: 14,
    marginTop: 4,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  actionTextCompact: {
    fontSize: 10,
    lineHeight: 12,
  },
  actionTextLiked: {
    color: "#FF5A7A",
  },
  actionTextSaved: {
    color: "#F3D28F",
  },
});
