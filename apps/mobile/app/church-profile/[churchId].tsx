import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  fetchChurchFollowStatus,
  fetchChurchPublicProfile,
  fetchViewerChurchMemberships,
  resolveChurchProfileViewerState,
  sendChurchJoinRequest,
  setChurchFollow,
  type ChurchProfileViewerState,
  type ChurchPublicPost,
  type ChurchPublicProfile,
} from "@/src/lib/churchProfileApi";
import { getApiBase } from "@/src/lib/kristoApi";
import { formatFeedTimestamp } from "@/src/components/homeFeed/homeFeedUtils";
import { queueOpenSharedHomeFeedPost } from "@/src/lib/homeFeedOpenSharedPost";
import {
  churchPublicPostIsVideo,
  resolveChurchPublicPostCover,
} from "@/src/lib/churchProfilePostCover";

const BG = "#05070D";
const GOLD = "#F4C95D";
const GOLD_SOFT = "rgba(244,201,93,0.22)";
const GOLD_BORDER = "rgba(244,201,93,0.28)";
const MUTED = "rgba(255,255,255,0.58)";
const GLASS = "rgba(255,255,255,0.05)";

function resolveImageUrl(raw?: string) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^(https?:|file:|data:image\/)/i.test(v)) return v;
  const base = getApiBase();
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

function buildLocationLine(profile: ChurchPublicProfile) {
  return (
    profile.location ||
    [profile.city, profile.province, profile.country].filter(Boolean).join(" • ")
  );
}

function postTitle(post: ChurchPublicPost) {
  return String(post.title || post.body || "Church post").trim();
}

const COVER_WIDTH = 120;
const COVER_HEIGHT = 68;

function ChurchProfilePostCard({
  post,
  churchName,
  churchAvatarUri,
  onPress,
}: {
  post: ChurchPublicPost;
  churchName: string;
  churchAvatarUri: string;
  onPress: () => void;
}) {
  const title = postTitle(post);
  const when = post.createdAt ? formatFeedTimestamp(post.createdAt) : "";
  const coverUri = resolveChurchPublicPostCover(post);
  const isVideo = churchPublicPostIsVideo(post);
  const likeCount = Number(post.likeCount || 0);
  const commentCount = Number(post.commentCount || 0);
  const showEngagement = likeCount > 0 || commentCount > 0;
  const churchInitial = churchName.charAt(0).toUpperCase() || "C";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.postCard, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
      accessibilityLabel={`Open post ${title}`}
    >
      <View pointerEvents="none" style={styles.postCardGlow} />
      <View style={styles.postCardInner}>
        <View style={styles.postThumbWrap}>
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.postThumbImage} resizeMode="cover" />
          ) : (
            <LinearGradient
              colors={["rgba(244,201,93,0.18)", "rgba(8,12,20,0.96)", "rgba(167,139,250,0.08)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.postThumbFallback}
            >
              <Ionicons
                name={isVideo ? "play-circle-outline" : "sparkles-outline"}
                size={28}
                color={GOLD}
              />
            </LinearGradient>
          )}
          {isVideo ? (
            <View style={styles.postPlayBadge}>
              <Ionicons name="play" size={12} color="#07101A" />
            </View>
          ) : null}
        </View>

        <View style={styles.postContent}>
          <View style={styles.postTopRow}>
            <View style={styles.postBrandRow}>
              <View style={styles.postMiniAvatar}>
                {churchAvatarUri ? (
                  <Image source={{ uri: churchAvatarUri }} style={styles.postMiniAvatarImage} />
                ) : (
                  <Text style={styles.postMiniAvatarInitial}>{churchInitial}</Text>
                )}
              </View>
              <Text style={styles.postChurchName} numberOfLines={1}>
                {post.churchName || churchName}
              </Text>
            </View>
            {when ? <Text style={styles.postTime}>{when}</Text> : null}
          </View>

          <Text style={styles.postTitle} numberOfLines={2}>
            {title}
          </Text>

          {showEngagement ? (
            <View style={styles.postEngagementRow}>
              {likeCount > 0 ? (
                <View style={styles.postEngagementItem}>
                  <Ionicons name="heart-outline" size={13} color={GOLD} />
                  <Text style={styles.postEngagementText}>{likeCount}</Text>
                </View>
              ) : null}
              {commentCount > 0 ? (
                <View style={styles.postEngagementItem}>
                  <Ionicons name="chatbubble-outline" size={13} color={GOLD} />
                  <Text style={styles.postEngagementText}>{commentCount}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ChurchProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();
  const params = useLocalSearchParams<{ churchId?: string; churchName?: string }>();

  const churchId = String(params.churchId || "").trim();
  const hintName = String(params.churchName || "").trim();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ChurchPublicProfile | null>(null);
  const [viewerState, setViewerState] = useState<ChurchProfileViewerState>({
    joinStatus: "none",
    memberOfOtherChurch: false,
    activeChurchId: null,
    canJoin: false,
  });
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!churchId) {
      setError("Church not found.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextProfile = await fetchChurchPublicProfile(churchId);

      if (!nextProfile) {
        setProfile(null);
        setError("Could not load this church profile.");
        return;
      }

      const memberships = await fetchViewerChurchMemberships().catch(() => []);
      const nextViewerState = resolveChurchProfileViewerState(
        nextProfile.id,
        memberships,
        nextProfile.viewerMembershipStatus
      );
      const nextFollowing =
        typeof nextProfile.viewerFollowing === "boolean"
          ? nextProfile.viewerFollowing
          : await fetchChurchFollowStatus(nextProfile.id).catch(() => false);

      setProfile(nextProfile);
      setViewerState(nextViewerState);
      setFollowing(nextFollowing);
    } catch (e: any) {
      setProfile(null);
      setError(String(e?.message || e || "Could not load church profile."));
    } finally {
      setLoading(false);
    }
  }, [churchId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const displayName = profile?.name || hintName || churchId;
  const avatarUri = resolveImageUrl(profile?.avatarUri || profile?.avatarUrl || profile?.logoUrl);
  const initial = displayName.charAt(0).toUpperCase() || "C";
  const locationLine = profile ? buildLocationLine(profile) : "";

  const handleJoin = useCallback(async () => {
    const userId = String(session?.userId || "").trim();
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in before requesting to join a church.");
      return;
    }
    if (!profile?.id || !viewerState.canJoin || viewerState.joinStatus !== "none" || requesting) {
      return;
    }

    setRequesting(true);
    try {
      await sendChurchJoinRequest(
        profile.id,
        String(session?.displayName || session?.name || "").trim() || undefined
      );
      setViewerState((prev) => ({ ...prev, joinStatus: "pending", canJoin: false }));
    } catch (e: any) {
      Alert.alert("Request failed", String(e?.message || e || "Could not send join request."));
    } finally {
      setRequesting(false);
    }
  }, [
    profile?.id,
    requesting,
    session?.displayName,
    session?.name,
    session?.userId,
    viewerState.canJoin,
    viewerState.joinStatus,
  ]);

  const handleFollowToggle = useCallback(async () => {
    const userId = String(session?.userId || "").trim();
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in before following a church.");
      return;
    }
    if (!profile?.id || followBusy) return;

    const nextFollowing = !following;
    setFollowBusy(true);
    try {
      const result = await setChurchFollow(profile.id, nextFollowing);
      if (!result.ok) {
        throw new Error(result.error || "Could not update follow status.");
      }

      setFollowing(Boolean(result.following ?? nextFollowing));
      if (typeof result.followerCount === "number") {
        setProfile((prev) =>
          prev ? { ...prev, followerCount: result.followerCount } : prev
        );
      } else {
        setProfile((prev) => {
          if (!prev) return prev;
          const current = Number(prev.followerCount ?? 0);
          return {
            ...prev,
            followerCount: Math.max(0, current + (nextFollowing ? 1 : -1)),
          };
        });
      }
    } catch (e: any) {
      Alert.alert("Follow failed", String(e?.message || e || "Could not update follow status."));
    } finally {
      setFollowBusy(false);
    }
  }, [followBusy, following, profile?.id, session?.userId]);

  const handlePostPress = useCallback(
    (post: ChurchPublicPost) => {
      if (!post.id) return;
      const coverUri = resolveChurchPublicPostCover(post);
      queueOpenSharedHomeFeedPost({
        type: post.videoUrl ? "video" : "post",
        postId: post.id,
        videoUri: resolveImageUrl(post.videoUrl),
        posterUri: coverUri || resolveImageUrl(post.posterUri || post.imageUrl),
        title: postTitle(post),
        caption: post.body,
        churchName: post.churchName || profile?.name || displayName,
      });
      router.push("/(tabs)/" as any);
    },
    [displayName, profile?.name, router]
  );

  const joinSlot = useMemo(() => {
    if (viewerState.joinStatus === "member") {
      return (
        <View style={[styles.actionSlot, styles.joinSlotMember]}>
          <Ionicons name="checkmark-circle" size={16} color={GOLD} />
          <Text style={styles.joinMemberText}>Member</Text>
        </View>
      );
    }

    if (viewerState.joinStatus === "pending") {
      return (
        <View style={[styles.actionSlot, styles.joinSlotGlass]}>
          <Ionicons name="hourglass-outline" size={15} color={GOLD} />
          <Text style={styles.joinGlassText}>Request Pending</Text>
        </View>
      );
    }

    if (viewerState.memberOfOtherChurch) {
      return (
        <View style={[styles.actionSlot, styles.joinSlotGlass, styles.joinSlotDisabled]}>
          <Text style={styles.joinDisabledText}>Join Church</Text>
        </View>
      );
    }

    return (
      <Pressable
        onPress={() => void handleJoin()}
        disabled={requesting || !viewerState.canJoin}
        style={({ pressed }) => [
          styles.actionSlot,
          styles.joinSlotGlass,
          (requesting || !viewerState.canJoin) && styles.joinSlotDisabled,
          pressed && !requesting && viewerState.canJoin && { opacity: 0.92 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Join Church"
      >
        <Text style={styles.joinGlassText}>{requesting ? "Sending…" : "Join Church"}</Text>
        <Ionicons
          name={requesting ? "hourglass-outline" : "add-circle-outline"}
          size={16}
          color={GOLD}
        />
      </Pressable>
    );
  }, [
    handleJoin,
    requesting,
    viewerState.canJoin,
    viewerState.joinStatus,
    viewerState.memberOfOtherChurch,
  ]);

  const followButton = useMemo(() => {
    const label = following ? "Following" : "Follow";

    return (
      <Pressable
        onPress={() => void handleFollowToggle()}
        disabled={followBusy}
        style={({ pressed }) => [
          styles.actionSlot,
          following ? styles.followSlotGold : styles.followSlotOutline,
          followBusy && styles.actionBusy,
          pressed && !followBusy && { opacity: 0.92 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <LinearGradient
          pointerEvents="none"
          colors={
            following
              ? ["#F7DF9A", GOLD, "#B8892E"]
              : ["rgba(255,255,255,0.08)", "rgba(255,255,255,0.02)"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <Ionicons
          name={following ? "heart" : "heart-outline"}
          size={16}
          color={following ? "#07101A" : GOLD}
        />
        <Text style={[styles.followText, following && styles.followTextFilled]}>
          {followBusy ? "Updating…" : label}
        </Text>
      </Pressable>
    );
  }, [followBusy, following, handleFollowToggle]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <LinearGradient
        pointerEvents="none"
        colors={["#03050A", BG, "#0A101C"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={styles.ambientGoldOrb} />
      <View pointerEvents="none" style={styles.ambientBlueOrb} />

      <View style={styles.topBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={GOLD} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          Church Profile
        </Text>
        <View style={styles.backBtnSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void loadProfile()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : profile ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 28 }]}
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient
            colors={["rgba(244,201,93,0.10)", "rgba(167,139,250,0.05)", "rgba(255,255,255,0.02)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGlow}
          />

          <View style={styles.hero}>
            <View style={styles.avatarRing}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{initial}</Text>
                </View>
              )}
            </View>
            <Text style={styles.churchName}>{displayName}</Text>
            <Text style={styles.churchId}>{profile.id}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{profile.memberCount}</Text>
              <Text style={styles.statLabel}>Members</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{profile.followerCount ?? 0}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{profile.ministriesCount}</Text>
              <Text style={styles.statLabel}>Ministries</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CONNECT</Text>
            <View style={styles.connectPanel}>
              <View style={styles.actionRow}>
                {followButton}
                {joinSlot}
              </View>
            </View>
          </View>

          {profile.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>ABOUT</Text>
              <View style={styles.glassPanel}>
                <Text style={styles.bodyText}>{profile.description}</Text>
              </View>
            </View>
          ) : null}

          {locationLine ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LOCATION</Text>
              <View style={styles.glassPanel}>
                <View style={styles.infoRow}>
                  <Ionicons name="location-outline" size={17} color={GOLD} />
                  <Text style={styles.bodyText}>{locationLine}</Text>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RECENT POSTS</Text>
            {profile.recentPosts.length ? (
              profile.recentPosts.map((post) => (
                <ChurchProfilePostCard
                  key={post.id}
                  post={post}
                  churchName={displayName}
                  churchAvatarUri={avatarUri}
                  onPress={() => handlePostPress(post)}
                />
              ))
            ) : (
              <View style={styles.emptyPostsCard}>
                <Ionicons name="albums-outline" size={24} color={GOLD} />
                <Text style={styles.emptyPosts}>No public posts yet.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  ambientGoldOrb: {
    position: "absolute",
    top: 80,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(244,201,93,0.08)",
  },
  ambientBlueOrb: {
    position: "absolute",
    top: 260,
    left: -60,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "rgba(126,180,255,0.06)",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnSpacer: {
    width: 40,
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  errorText: {
    color: MUTED,
    fontSize: 15,
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: GOLD_SOFT,
  },
  retryText: {
    color: GOLD,
    fontWeight: "800",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
    gap: 18,
  },
  heroGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    borderRadius: 24,
  },
  hero: {
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  avatarRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: GOLD_BORDER,
    overflow: "hidden",
    backgroundColor: GLASS,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.10)",
  },
  avatarInitial: {
    color: GOLD,
    fontSize: 34,
    fontWeight: "900",
  },
  churchName: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  churchId: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    color: GOLD,
    fontSize: 22,
    fontWeight: "900",
  },
  statLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  section: {
    gap: 10,
  },
  sectionLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  glassPanel: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  connectPanel: {
    borderRadius: 18,
    padding: 10,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  bodyText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    flex: 1,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  actionSlot: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    overflow: "hidden",
  },
  followSlotGold: {
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.55)",
  },
  followSlotOutline: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  followText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "800",
  },
  followTextFilled: {
    color: "#07101A",
    fontWeight: "900",
  },
  joinSlotGlass: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  joinSlotMember: {
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  joinSlotDisabled: {
    opacity: 0.58,
  },
  joinGlassText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  joinMemberText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: "900",
  },
  joinDisabledText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  actionBusy: {
    opacity: 0.72,
  },
  postCard: {
    borderRadius: 18,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    overflow: "hidden",
  },
  postCardGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(244,201,93,0.35)",
  },
  postCardInner: {
    flexDirection: "row",
    padding: 12,
    gap: 12,
  },
  postThumbWrap: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.24)",
    backgroundColor: "rgba(8,12,20,0.92)",
  },
  postThumbImage: {
    width: "100%",
    height: "100%",
  },
  postThumbFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  postPlayBadge: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  postContent: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  postTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  postBrandRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  postMiniAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    backgroundColor: "rgba(244,201,93,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  postMiniAvatarImage: {
    width: "100%",
    height: "100%",
  },
  postMiniAvatarInitial: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
  },
  postChurchName: {
    flex: 1,
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  postTime: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },
  postTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
  },
  postEngagementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  postEngagementItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  postEngagementText: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyPostsCard: {
    borderRadius: 16,
    padding: 22,
    alignItems: "center",
    gap: 8,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
  },
  emptyPosts: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "600",
  },
});
