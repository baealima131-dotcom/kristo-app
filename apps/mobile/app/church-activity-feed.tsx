import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Pressable,
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

import ChurchActivityMemberChips from "@/src/components/ChurchActivityMemberChips";
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

type MemberFilter = "all" | "mine" | "member";

function resolveInitialMemberFilter(
  routeMemberId: string,
  currentUserId: string
): MemberFilter {
  if (!routeMemberId) return "all";
  if (routeMemberId === currentUserId) return "mine";
  return "member";
}

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
        <Text style={[styles.actionText, saved ? styles.actionTextSaved : null]}>
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

  return (
    <View style={[styles.slide, { height }]}>
      {isVideo && videoUri ? (
        <ActivityFeedVideo uri={videoUri} posterUri={posterUri} shouldPlay={shouldPlayVideo} />
      ) : imageUri ? (
        <Image source={{ uri: mediaUrl(imageUri) }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
      ) : (
        <LinearGradient colors={["#050814", "#0A1020", "#03050C"]} style={StyleSheet.absoluteFillObject} />
      )}

      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.28)", "rgba(0,0,0,0.78)"]}
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

      <View style={styles.metaWrap}>
        <View style={styles.labelPill}>
          <Text style={styles.labelPillText}>{label}</Text>
        </View>

        {!!title ? (
          <Text style={styles.title} numberOfLines={3}>
            {title}
          </Text>
        ) : null}

        {!!body && body !== title ? (
          <Text style={styles.body} numberOfLines={5}>
            {body}
          </Text>
        ) : null}

        <View style={styles.authorRow}>
          <Text style={styles.authorName} numberOfLines={1}>
            {authorName}
          </Text>
          {!!whenLabel ? <Text style={styles.whenLabel}>{whenLabel}</Text> : null}
        </View>
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
  const mode: ChurchActivityFeedMode =
    activityMode === "member" || activityMode === "media" ? activityMode : "church";

  const [loading, setLoading] = useState(true);
  const [sourceRows, setSourceRows] = useState<any[]>([]);
  const [homeFeedTick, setHomeFeedTick] = useState(0);
  const [churchMembers, setChurchMembers] = useState<any[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [memberFilter, setMemberFilter] = useState<MemberFilter>(() =>
    resolveInitialMemberFilter(routeMemberId, currentUserId)
  );
  const [selectedMemberId, setSelectedMemberId] = useState(
    routeMemberId && routeMemberId !== currentUserId ? routeMemberId : ""
  );
  const [optimisticLikes, setOptimisticLikes] = useState<
    Record<string, { liked: boolean; likeCount: number }>
  >({});
  const [optimisticSaved, setOptimisticSaved] = useState<Record<string, boolean>>({});

  const listRef = useRef<FlatList<any>>(null);
  const focusHandledRef = useRef("");
  const slideHeight = Math.max(320, windowHeight);

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

  const effectiveMemberId = useMemo(() => {
    if (memberFilter === "mine") return currentUserId;
    if (memberFilter === "member") return selectedMemberId;
    return "";
  }, [memberFilter, currentUserId, selectedMemberId]);

  const feedRows = useMemo(() => {
    return filterChurchActivityFeedRows(
      mergedSourceRows,
      {
        activityChurchId: churchId,
        activityMemberId: effectiveMemberId || undefined,
        activityMode: mode,
      },
      mediaUrl
    );
  }, [mergedSourceRows, churchId, effectiveMemberId, mode]);

  const recentPosterMembers = useMemo(() => {
    const memberLookup = new Map<string, { name: string; avatarUri?: string }>();
    for (const member of churchMembers) {
      const userIdValue = String(member?.userId || member?.id || "").trim();
      if (!userIdValue) continue;
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
      const authorId = getPostAuthorId(item);
      if (!authorId) continue;
      const ms = new Date(String(item?.createdAt || "")).getTime();
      const prev = latestByAuthor.get(authorId) || 0;
      if (Number.isFinite(ms) && ms > prev) {
        latestByAuthor.set(authorId, ms);
      }
    }

    return [...latestByAuthor.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([userId]) => {
        const lookup = memberLookup.get(userId);
        const sample = mergedSourceRows.find((row) => getPostAuthorId(row) === userId);
        return {
          userId,
          name: lookup?.name || postAuthorName(sample) || "Member",
          avatarUri: lookup?.avatarUri,
        };
      });
  }, [mergedSourceRows, churchMembers]);

  const modeBadge = useMemo(() => {
    if (mode === "media") return "Media";
    if (effectiveMemberId) return "Member";
    return "Church";
  }, [mode, effectiveMemberId]);

  const chipSelectedKey =
    memberFilter === "member" && selectedMemberId ? selectedMemberId : memberFilter;

  const isMemberEmpty =
    feedRows.length === 0 &&
    !loading &&
    Boolean(churchId) &&
    (memberFilter === "member" || memberFilter === "mine");

  const handleMemberChipSelect = useCallback((key: "all" | "mine" | string, mid?: string) => {
    if (key === "all") {
      setMemberFilter("all");
      setSelectedMemberId("");
    } else if (key === "mine") {
      setMemberFilter("mine");
      setSelectedMemberId("");
    } else {
      setMemberFilter("member");
      setSelectedMemberId(String(mid || key || "").trim());
    }
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
      const nextIndex = Math.max(0, Math.round(y / Math.max(1, slideHeight)));
      setActiveIndex(nextIndex);
    },
    [slideHeight]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const likeState = getLikeState(item);
      const saved = getSavedState(item);

      return (
        <ActivityFeedSlide
          item={item}
          height={slideHeight}
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
      slideHeight,
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

  const headerTop = insets.top + 8;

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        colors={["rgba(3,5,12,0.92)", "rgba(3,5,12,0.72)", "rgba(3,5,12,0)"]}
        style={[styles.headerBackdrop, { height: headerTop + 148 }]}
        pointerEvents="none"
      />

      <View style={[styles.header, { paddingTop: headerTop }]}>
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed ? styles.pressed : null]}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>

          <View style={styles.headerTextWrap}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle}>Church Activity</Text>
              <View style={styles.modeBadge}>
                <Text style={styles.modeBadgeText}>{modeBadge}</Text>
              </View>
            </View>
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {feedRows.length} post{feedRows.length === 1 ? "" : "s"}
            </Text>
          </View>
        </View>

        <View style={styles.chipsWrap}>
          <ChurchActivityMemberChips
            members={recentPosterMembers}
            selectedKey={chipSelectedKey}
            onSelect={handleMemberChipSelect}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : !churchId ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>Church context is required.</Text>
        </View>
      ) : isMemberEmpty ? (
        <View style={styles.centerState}>
          <Text style={styles.emptyTitle}>No posts yet</Text>
          <Text style={styles.emptyBody}>Posts from this member will appear here.</Text>
          <Pressable
            onPress={() => handleMemberChipSelect("all")}
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
            onPress={() => handleMemberChipSelect("all")}
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
          snapToInterval={slideHeight}
          snapToAlignment="start"
          disableIntervalMomentum
          showsVerticalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          getItemLayout={(_, index) => ({
            length: slideHeight,
            offset: slideHeight * index,
            index,
          })}
          initialNumToRender={3}
          windowSize={5}
          maxToRenderPerBatch={3}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const ACTION_RAIL_BOTTOM = 118;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#03050C",
  },
  headerBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 18,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 12,
    paddingBottom: 6,
    gap: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  pressed: {
    opacity: 0.82,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  modeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  },
  modeBadgeText: {
    color: "#F4D06F",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  headerSubtitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    marginTop: 2,
    fontWeight: "600",
  },
  chipsWrap: {
    marginLeft: -2,
    marginTop: 2,
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
  bottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "52%",
  },
  metaWrap: {
    position: "absolute",
    left: 16,
    right: 92,
    bottom: 34,
  },
  labelPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: 10,
  },
  labelPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 23,
    fontWeight: "800",
    marginBottom: 8,
  },
  body: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  authorName: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
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
    gap: 14,
  },
  actionBtn: {
    width: 58,
    minHeight: 72,
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
    marginTop: 5,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  actionTextLiked: {
    color: "#FF5A7A",
  },
  actionTextSaved: {
    color: "#F3D28F",
    fontSize: 10,
  },
});
