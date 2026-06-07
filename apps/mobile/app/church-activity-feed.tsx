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
import { feedList, feedRemoveWhere, subscribe as subscribeHomeFeed } from "@/src/lib/homeFeedStore";
import {
  canDeleteChurchActivityPostFromSession,
  parseChurchActivityDeleteResponse,
} from "@/src/lib/churchActivityDelete";
import { evaluateChurchMediaAccessFromSession } from "@/src/lib/churchMediaAccess";
import { syncHomeFeedPostDelete } from "@/src/lib/homeFeedPostDeleteSync";
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
import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { VideoPostFallbackPoster } from "@/src/components/homeFeed/VideoPostFallbackPoster";

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

function memberUserIds(member: any): string[] {
  return [
    member?.userId,
    member?.id,
    member?.actorUserId,
    member?.authorId,
    member?.createdBy,
    member?.memberId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function buildCurrentUserIdSet(currentUserId: string, churchMembers: any[]): Set<string> {
  const ids = new Set<string>();
  if (currentUserId) ids.add(currentUserId);

  for (const member of churchMembers) {
    const memberIds = memberUserIds(member);
    if (memberIds.some((id) => ids.has(id))) {
      memberIds.forEach((id) => ids.add(id));
    }
  }

  return ids;
}

function isCurrentUser(userIdOrMember: string | any, currentUserIdSet: Set<string>): boolean {
  if (!currentUserIdSet.size) return false;
  if (typeof userIdOrMember === "string") {
    return currentUserIdSet.has(userIdOrMember);
  }
  return memberUserIds(userIdOrMember).some((id) => currentUserIdSet.has(id));
}

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

function pickFirstMediaUri(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const uri = mediaUrl(String(candidate || "").trim());
    if (uri) return uri;
  }
  return "";
}

function resolveChurchActivityChurchAvatar(rows: any[], session?: any) {
  const fromSession = pickFirstMediaUri(
    session?.churchAvatarUri,
    session?.churchAvatarUrl,
    session?.churchLogoUri,
    session?.churchLogoUrl,
    session?.churchProfileImage,
    session?.churchImage,
    session?.church?.avatarUri,
    session?.church?.avatarUrl,
    session?.church?.logoUri,
    session?.church?.logoUrl,
    session?.church?.image,
    session?.church?.profileImage
  );
  if (fromSession) return fromSession;

  for (const row of rows) {
    const uri = pickFirstMediaUri(
      row?.churchAvatarUri,
      row?.churchAvatarUrl,
      row?.churchLogoUri,
      row?.churchLogoUrl,
      row?.churchProfileImage,
      row?.churchImage,
      row?.church?.avatarUri,
      row?.church?.avatarUrl,
      row?.church?.logoUri,
      row?.church?.logoUrl,
      row?.church?.image,
      row?.churchProfile?.avatarUri,
      row?.churchProfile?.logoUri,
      row?.churchProfile?.image
    );
    if (uri) return uri;
  }

  return "";
}

const CHIP_AVATAR = 64;
const POSTER_AVATAR_SIZE = 56;

function resolvePostAuthorAvatar(
  item: any,
  memberAvatarMap: Map<string, { avatarUri?: string }>
) {
  const authorId = getPostAuthorId(item);
  const fromMember = authorId ? memberAvatarMap.get(authorId)?.avatarUri : "";
  return pickFirstMediaUri(
    item?.actorAvatarUri,
    item?.authorAvatarUri,
    item?.avatarUri,
    item?.profileImage,
    item?.author?.avatarUri,
    item?.actor?.avatarUri,
    item?.createdByAvatarUri,
    item?.postedByAvatarUri,
    item?.actorAvatar,
    item?.authorAvatar,
    fromMember
  );
}

const ActivityPosterAvatar = memo(function ActivityPosterAvatar({
  uri,
  initial,
}: {
  uri?: string;
  initial: string;
}) {
  const size = POSTER_AVATAR_SIZE;
  const inner = size - 6;

  return (
    <View style={styles.posterAvatarShell}>
      <View pointerEvents="none" style={styles.posterAvatarGlow} />
      <View style={styles.posterAvatarRing}>
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: inner, height: inner, borderRadius: inner / 2 }}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={["#FFE08A", "#F7D36A", "#C8943A", "#7A5218"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.posterAvatarFallback}
          >
            <Text style={styles.posterAvatarInitial}>{initial}</Text>
          </LinearGradient>
        )}
      </View>
    </View>
  );
});

function FilterChipAvatarContent({
  uri,
  fallbackIcon,
  fallbackInitial,
  mediaBadge,
}: {
  uri?: string;
  fallbackIcon?: React.ComponentProps<typeof Ionicons>["name"];
  fallbackInitial?: string;
  mediaBadge?: boolean;
}) {
  return (
    <View style={styles.filterChipAvatarContentWrap}>
      <View style={styles.filterChipAvatarFrame}>
        {uri ? (
          <Image source={{ uri }} style={styles.filterChipAvatar} resizeMode="cover" />
        ) : (
          <View style={styles.filterChipFallback}>
            {fallbackIcon ? (
              <Ionicons name={fallbackIcon} size={26} color="#F4D06F" />
            ) : (
              <Text style={styles.filterChipInitial}>{fallbackInitial || "?"}</Text>
            )}
          </View>
        )}
      </View>
      {mediaBadge ? (
        <View style={styles.filterChipMediaBadge}>
          <Ionicons name="images" size={12} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const ActivityFeedFilterChips = memo(function ActivityFeedFilterChips({
  selectedKey,
  churchAvatarUri,
  currentUserAvatar,
  currentUserName,
  members,
  onSelect,
}: {
  selectedKey: ChipFilterKey;
  churchAvatarUri?: string;
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
        <FilterChipAvatarContent uri={churchAvatarUri} fallbackIcon="business-outline" />
      )}
      {renderChip(
        "media",
        "Media",
        <FilterChipAvatarContent uri={churchAvatarUri} fallbackIcon="business-outline" mediaBadge />
      )}
      {renderChip(
        "me",
        "Me",
        <FilterChipAvatarContent
          uri={currentUserAvatar}
          fallbackInitial={meInitial}
        />
      )}
      {members.map((member) => {
        const initial = String(member.name || "?").trim().charAt(0).toUpperCase() || "?";
        const firstName = String(member.name || "Member").trim().split(/\s+/)[0] || "Member";
        return renderChip(
          member.userId,
          firstName,
          <FilterChipAvatarContent uri={member.avatarUri} fallbackInitial={initial} />
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
  const showPoster = !!poster && !shouldPlay && !isBrandedPosterUri(poster);

  return (
    <View style={StyleSheet.absoluteFillObject}>
      {isBrandedPosterUri(poster) && !shouldPlay ? (
        <VideoPostFallbackPoster variant="full" videoUrl={uri} />
      ) : showPoster ? (
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
  canDelete,
  deleting,
  onLike,
  onComment,
  onShare,
  onSave,
  onDelete,
}: {
  liked: boolean;
  likeCount: number;
  commentCount: number;
  shareCount: number;
  saved: boolean;
  canDelete?: boolean;
  deleting?: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onDelete?: () => void;
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
        <Text style={styles.actionText}>
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

      <View style={styles.actionSaveDeleteCluster}>
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
          <Text
            style={[styles.actionSaveLabel, saved ? styles.actionTextSaved : null]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {saved ? "Saved" : "Save"}
          </Text>
        </Pressable>

        {canDelete ? (
          <Pressable
            hitSlop={20}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.actionBtnDelete,
              pressed ? styles.actionBtnDeletePressed : null,
              deleting ? styles.actionBtnDeleteBusy : null,
            ]}
            onPress={onDelete}
            disabled={deleting}
            accessibilityRole="button"
            accessibilityLabel="Delete post"
          >
            <View style={styles.actionDeleteIconWrap}>
              {deleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="trash" size={28} color="#FFFFFF" />
              )}
            </View>
            <Text
              style={styles.actionDeleteLabel}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              Delete
            </Text>
          </Pressable>
        ) : null}
      </View>
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
  memberAvatarMap,
  onLike,
  onComment,
  onShare,
  onSave,
  canDelete,
  deleting,
  onDelete,
}: {
  item: any;
  height: number;
  isActive: boolean;
  screenFocused: boolean;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  memberAvatarMap: Map<string, { avatarUri?: string; name?: string }>;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete?: () => void;
}) {
  const body = String(item?.body || item?.text || "").trim();
  const authorName = String(item?.authorName || item?.actorLabel || "Church member").trim();
  const whenLabel = formatActivityWhen(item?.createdAt);
  const label = getChurchActivityLabel(item);
  const authorInitial =
    String(authorName || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";
  const authorAvatarUri = resolvePostAuthorAvatar(item, memberAvatarMap);
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
        colors={["transparent", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.85)"]}
        locations={[0, 0.55, 1]}
        style={styles.bottomGradient}
      />

      <ActivityActionRail
        liked={liked}
        likeCount={likeCount}
        commentCount={commentCount}
        shareCount={shareCount}
        saved={saved}
        canDelete={canDelete}
        deleting={deleting}
        onLike={onLike}
        onComment={onComment}
        onShare={onShare}
        onSave={onSave}
        onDelete={onDelete}
      />

      <View style={styles.metaFooter}>
        <View style={styles.identityRow}>
          <ActivityPosterAvatar uri={authorAvatarUri} initial={authorInitial} />
          <View style={styles.identityTextWrap}>
            <Text style={styles.kindLabel} numberOfLines={1}>
              {label}
            </Text>
            <Text style={styles.authorName} numberOfLines={1}>
              {authorName}
            </Text>
          </View>
        </View>

        {!!body ? (
          <Text style={styles.body} numberOfLines={6}>
            {body}
          </Text>
        ) : null}

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
  const effectiveChurchId = String(churchId || session?.churchId || "").trim();
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
  const [deletingId, setDeletingId] = useState("");
  const [deleteAccess, setDeleteAccess] = useState({
    isActualChurchPastor: false,
    isMediaHost: false,
    actualPastorUserId: "",
  });

  const listRef = useRef<FlatList<any>>(null);
  const focusHandledRef = useRef("");
  const [topChromeHeight, setTopChromeHeight] = useState(0);
  const contentHeight = Math.max(280, windowHeight - topChromeHeight);

  useEffect(() => {
    return subscribeHomeFeed(() => setHomeFeedTick((v) => v + 1));
  }, []);

  useEffect(() => {
    if (!currentUserId || !effectiveChurchId) {
      setDeleteAccess({
        isActualChurchPastor: false,
        isMediaHost: false,
        actualPastorUserId: "",
      });
      return;
    }

    let alive = true;

    void apiGet("/api/church/media-hosts", {
      headers: getKristoHeaders({
        userId: currentUserId,
        role: (session?.role || "Member") as any,
        churchId: effectiveChurchId,
      }),
    })
      .then((res: any) => {
        if (!alive) return;
        const access = evaluateChurchMediaAccessFromSession(
          {
            userId: currentUserId,
            role: session?.role,
            churchRole: session?.churchRole,
          },
          res
        );
        setDeleteAccess({
          isActualChurchPastor: access.isActualChurchPastor,
          isMediaHost: access.isMediaHost,
          actualPastorUserId: access.actualPastorUserId,
        });
      })
      .catch(() => {
        if (!alive) return;
        const access = evaluateChurchMediaAccessFromSession({
          userId: currentUserId,
          role: session?.role,
          churchRole: session?.churchRole,
        });
        setDeleteAccess({
          isActualChurchPastor: access.isActualChurchPastor,
          isMediaHost: access.isMediaHost,
          actualPastorUserId: access.actualPastorUserId,
        });
      });

    return () => {
      alive = false;
    };
  }, [currentUserId, effectiveChurchId, session?.role, session?.churchRole]);

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
        "/api/church/feed?scope=church",
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

  const churchAvatarUri = useMemo(
    () => resolveChurchActivityChurchAvatar(mergedSourceRows, session),
    [mergedSourceRows, session]
  );

  const memberAvatarMap = useMemo(() => {
    const map = new Map<string, { avatarUri?: string; name?: string }>();
    for (const member of churchMembers) {
      const userIdValue = String(member?.userId || member?.id || "").trim();
      if (!userIdValue) continue;
      map.set(userIdValue, {
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
    if (currentUserId) {
      map.set(currentUserId, {
        name: currentUserName,
        avatarUri: currentUserAvatar,
      });
    }
    return map;
  }, [churchMembers, currentUserId, currentUserName, currentUserAvatar]);

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

  const currentUserIdSet = useMemo(
    () => buildCurrentUserIdSet(currentUserId, churchMembers),
    [currentUserId, churchMembers]
  );

  const recentPosterMembers = useMemo(() => {
    const memberLookup = new Map<string, { name: string; avatarUri?: string }>();
    for (const member of churchMembers) {
      if (isCurrentUser(member, currentUserIdSet)) continue;
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
      if (isChurchActivityExcludedCard(item)) continue;
      if (!isChurchActivityAllowedPost(item)) continue;
      const authorId = getPostAuthorId(item);
      if (!authorId || isCurrentUser(authorId, currentUserIdSet)) continue;
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
      })
      .filter((member) => !isCurrentUser(member.userId, currentUserIdSet));
  }, [mergedSourceRows, churchMembers, currentUserIdSet]);

  const isMemberChipEmpty =
    feedRows.length === 0 &&
    !loading &&
    Boolean(churchId) &&
    activeChip !== "all" &&
    activeChip !== "media";

  const goBackToProfile = useCallback(() => {
    try {
      router.replace("/(tabs)/profile");
    } catch {
      try {
        router.replace("/(tabs)");
      } catch {}
    }
  }, [router]);

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

  const canDeletePost = useCallback(
    (item: any) =>
      canDeleteChurchActivityPostFromSession(item, session, deleteAccess, effectiveChurchId),
    [session, deleteAccess, effectiveChurchId]
  );

  const handleDelete = useCallback(
    (item: any) => {
      const postId = String(item?.id || "").trim();
      if (!postId || !effectiveChurchId || deletingId || !canDeletePost(item)) return;

      Alert.alert(
        "Delete post?",
        "This removes the post from Church Activity and Home Feed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setDeletingId(postId);
                try {
                  const res: any = await apiPost(
                    "/api/church/feed",
                    { action: "delete_post", postId },
                    {
                      headers: getKristoHeaders({
                        userId: currentUserId,
                        role: (session?.role || "Member") as any,
                        churchId: effectiveChurchId,
                      }),
                    }
                  );

                  const parsed = parseChurchActivityDeleteResponse(res, postId);
                  if (!parsed.deleted) {
                    Alert.alert("Delete failed", "Could not delete post. Please try again.");
                    return;
                  }

                  const deletedId = parsed.deletedId || postId;
                  feedRemoveWhere((row) => String(row.id || "") === deletedId);
                  setSourceRows((prev) =>
                    prev.filter((row) => String(row.id || "") !== deletedId)
                  );
                  setActiveIndex((prev) => Math.max(0, prev));

                  await syncHomeFeedPostDelete({
                    postId: deletedId,
                    storageDeleted: true,
                    feedDeleted: true,
                  });
                } catch {
                  Alert.alert("Delete failed", "Could not delete post. Please try again.");
                } finally {
                  setDeletingId("");
                }
              })();
            },
          },
        ]
      );
    },
    [
      canDeletePost,
      currentUserId,
      deletingId,
      effectiveChurchId,
      session?.role,
    ]
  );

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
      const postId = String(item?.id || "").trim();
      const canDelete = canDeletePost(item);

      return (
        <ActivityFeedSlide
          item={item}
          height={contentHeight}
          isActive={index === activeIndex}
          screenFocused={screenFocused}
          liked={likeState.liked}
          likeCount={likeState.likeCount}
          saved={saved}
          memberAvatarMap={memberAvatarMap}
          onLike={() => handleLike(item)}
          onComment={handleComment}
          onShare={() => handleShare(item)}
          onSave={() => handleSave(item)}
          canDelete={canDelete}
          deleting={deletingId === postId}
          onDelete={() => handleDelete(item)}
        />
      );
    },
    [
      contentHeight,
      activeIndex,
      screenFocused,
      memberAvatarMap,
      getLikeState,
      getSavedState,
      handleLike,
      handleComment,
      handleShare,
      handleSave,
      canDeletePost,
      deletingId,
      handleDelete,
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
            onPress={goBackToProfile}
            style={({ pressed }) => [styles.backBtn, pressed ? styles.pressed : null]}
            hitSlop={12}
          >
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>

          <View style={styles.chipsWrap}>
            <ActivityFeedFilterChips
              selectedKey={activeChip}
              churchAvatarUri={churchAvatarUri}
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
const ACTION_RAIL_BTN_WIDTH = 78;

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
    gap: 4,
    alignItems: "flex-start",
  },
  filterChip: {
    width: 72,
    alignItems: "center",
    gap: 4,
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
    overflow: "visible",
  },
  filterChipRingActive: {
    borderColor: "rgba(217,179,95,0.96)",
    borderWidth: 2,
  },
  filterChipAvatarContentWrap: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
  filterChipAvatarFrame: {
    width: "100%",
    height: "100%",
    borderRadius: CHIP_AVATAR / 2,
    overflow: "hidden",
  },
  filterChipAvatar: {
    width: "100%",
    height: "100%",
    borderRadius: CHIP_AVATAR / 2,
  },
  filterChipFallback: {
    flex: 1,
    width: "100%",
    height: "100%",
    borderRadius: CHIP_AVATAR / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  filterChipMediaBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,10,16,0.92)",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.92)",
  },
  filterChipInitial: {
    color: "#F4D06F",
    fontSize: 18,
    fontWeight: "900",
  },
  filterChipLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 16,
    maxWidth: 72,
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
    height: "48%",
  },
  metaFooter: {
    position: "absolute",
    left: 16,
    right: 84,
    bottom: 22,
    gap: 8,
    maxWidth: "78%",
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  identityTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 2,
  },
  posterAvatarShell: {
    width: POSTER_AVATAR_SIZE + 10,
    height: POSTER_AVATAR_SIZE + 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  posterAvatarGlow: {
    position: "absolute",
    width: POSTER_AVATAR_SIZE + 8,
    height: POSTER_AVATAR_SIZE + 8,
    borderRadius: (POSTER_AVATAR_SIZE + 8) / 2,
    backgroundColor: "rgba(247,211,106,0.20)",
    shadowColor: "#F7D36A",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  posterAvatarRing: {
    width: POSTER_AVATAR_SIZE,
    height: POSTER_AVATAR_SIZE,
    borderRadius: POSTER_AVATAR_SIZE / 2,
    borderWidth: 2.5,
    borderColor: "rgba(247,211,106,0.82)",
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    overflow: "hidden",
  },
  posterAvatarFallback: {
    width: POSTER_AVATAR_SIZE - 6,
    height: POSTER_AVATAR_SIZE - 6,
    borderRadius: (POSTER_AVATAR_SIZE - 6) / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  posterAvatarInitial: {
    color: "#1A1205",
    fontSize: 20,
    fontWeight: "900",
  },
  kindLabel: {
    color: "#F3D28F",
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  body: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4,
  },
  authorName: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  whenLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    marginTop: 2,
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
    width: ACTION_RAIL_BTN_WIDTH,
    minWidth: ACTION_RAIL_BTN_WIDTH,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 4,
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
  actionSaveDeleteCluster: {
    width: ACTION_RAIL_BTN_WIDTH,
    minWidth: ACTION_RAIL_BTN_WIDTH,
    alignItems: "center",
    gap: 14,
    marginTop: 2,
  },
  actionBtnDelete: {
    minHeight: 82,
  },
  actionBtnDeletePressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  actionBtnDeleteBusy: {
    opacity: 0.82,
  },
  actionDeleteIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E53935",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#E53935",
    shadowOpacity: 0.72,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  actionDeleteLabel: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 17,
    lineHeight: 20,
    marginTop: 6,
    width: ACTION_RAIL_BTN_WIDTH,
    paddingHorizontal: 6,
    textAlign: "center",
    letterSpacing: 0.2,
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
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
    fontWeight: "900",
    fontSize: 18,
    lineHeight: 22,
    marginTop: 5,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  actionSaveLabel: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 15,
    lineHeight: 18,
    marginTop: 5,
    width: ACTION_RAIL_BTN_WIDTH,
    paddingHorizontal: 6,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  actionTextLiked: {
    color: "#FF5A7A",
  },
  actionTextSaved: {
    color: "#F3D28F",
  },
});
