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
  V1_OTHER_CHURCH_JOIN_MESSAGE,
  type ChurchProfileViewerState,
  type ChurchPublicProfile,
} from "@/src/lib/churchProfileApi";
import { getApiBase } from "@/src/lib/kristoApi";
import { formatFeedTimestamp } from "@/src/components/homeFeed/homeFeedUtils";

const BG = "#05070D";
const GOLD = "rgba(244,201,93,0.98)";
const GOLD_SOFT = "rgba(244,201,93,0.22)";
const MUTED = "rgba(255,255,255,0.58)";

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
  const [joinNotice, setJoinNotice] = useState("");
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

  const handleBlockedJoinPress = useCallback(() => {
    Alert.alert("Join unavailable", V1_OTHER_CHURCH_JOIN_MESSAGE);
  }, []);

  const handleJoin = useCallback(async () => {
    const userId = String(session?.userId || "").trim();
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in before requesting to join a church.");
      return;
    }
    if (!profile?.id || !viewerState.canJoin || viewerState.joinStatus !== "none" || requesting) {
      if (viewerState.memberOfOtherChurch) {
        handleBlockedJoinPress();
      }
      return;
    }

    setRequesting(true);
    setJoinNotice("");
    try {
      await sendChurchJoinRequest(
        profile.id,
        String(session?.displayName || session?.name || "").trim() || undefined
      );
      setViewerState((prev) => ({ ...prev, joinStatus: "pending", canJoin: false }));
      setJoinNotice("Request sent to church.");
    } catch (e: any) {
      Alert.alert("Request failed", String(e?.message || e || "Could not send join request."));
    } finally {
      setRequesting(false);
    }
  }, [
    handleBlockedJoinPress,
    profile?.id,
    requesting,
    session?.displayName,
    session?.name,
    session?.userId,
    viewerState.canJoin,
    viewerState.joinStatus,
    viewerState.memberOfOtherChurch,
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

  const joinSlot = useMemo(() => {
    if (viewerState.joinStatus === "member") {
      return (
        <View style={[styles.actionSlot, styles.joinSlotMember]}>
          <Ionicons name="checkmark-circle" size={16} color="#07101A" />
          <Text style={styles.memberBadgeText}>Member</Text>
        </View>
      );
    }

    if (viewerState.joinStatus === "pending") {
      return (
        <View style={[styles.actionSlot, styles.joinSlotPending]}>
          <Ionicons name="hourglass-outline" size={15} color={GOLD} />
          <Text style={styles.pendingBadgeText}>Request Pending</Text>
        </View>
      );
    }

    if (viewerState.memberOfOtherChurch) {
      return (
        <Pressable
          onPress={handleBlockedJoinPress}
          style={({ pressed }) => [
            styles.actionSlot,
            styles.joinSlotDisabled,
            pressed && { opacity: 0.88 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Join Church unavailable"
        >
          <Text style={styles.joinDisabledText}>Join Church</Text>
        </Pressable>
      );
    }

    return (
      <Pressable
        onPress={() => void handleJoin()}
        disabled={requesting || !viewerState.canJoin}
        style={({ pressed }) => [
          styles.actionSlot,
          styles.joinSlotActive,
          (requesting || !viewerState.canJoin) && styles.joinBtnDisabled,
          pressed && !requesting && viewerState.canJoin && { opacity: 0.92 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Join Church"
      >
        <Text style={styles.joinActiveText}>{requesting ? "Sending…" : "Join Church"}</Text>
        <Ionicons
          name={requesting ? "hourglass-outline" : "add-circle-outline"}
          size={16}
          color="#07101A"
        />
      </Pressable>
    );
  }, [
    handleBlockedJoinPress,
    handleJoin,
    requesting,
    viewerState.canJoin,
    viewerState.joinStatus,
    viewerState.memberOfOtherChurch,
  ]);

  const followButton = useMemo(() => {
    const followPrimary = viewerState.memberOfOtherChurch;
    const label = following ? "Following" : "Follow";

    return (
      <Pressable
        onPress={() => void handleFollowToggle()}
        disabled={followBusy}
        style={({ pressed }) => [
          styles.actionSlot,
          followPrimary ? styles.followSlotPrimary : styles.followSlotSecondary,
          following && !followPrimary && styles.followSlotFollowing,
          followBusy && styles.joinBtnDisabled,
          pressed && !followBusy && { opacity: 0.92 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Ionicons
          name={following ? "heart" : "heart-outline"}
          size={16}
          color={followPrimary || following ? "#07101A" : GOLD}
        />
        <Text
          style={[
            followPrimary ? styles.followPrimaryText : styles.followSecondaryText,
            following && !followPrimary && styles.followFollowingText,
          ]}
        >
          {followBusy ? "Updating…" : label}
        </Text>
      </Pressable>
    );
  }, [followBusy, following, handleFollowToggle, viewerState.memberOfOtherChurch]);

  const connectActions = useMemo(
    () => (
      <View style={styles.actionRow}>
        {followButton}
        {joinSlot}
      </View>
    ),
    [followButton, joinSlot]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

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
            {connectActions}
            {viewerState.memberOfOtherChurch && viewerState.joinStatus === "none" ? (
              <Text style={styles.v1Hint}>{V1_OTHER_CHURCH_JOIN_MESSAGE}</Text>
            ) : null}
            {joinNotice ? <Text style={styles.joinNotice}>{joinNotice}</Text> : null}
          </View>

          {profile.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>ABOUT</Text>
              <Text style={styles.bodyText}>{profile.description}</Text>
            </View>
          ) : null}

          {locationLine ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LOCATION</Text>
              <View style={styles.infoRow}>
                <Ionicons name="location-outline" size={17} color={GOLD} />
                <Text style={styles.bodyText}>{locationLine}</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>RECENT POSTS</Text>
            {profile.recentPosts.length ? (
              profile.recentPosts.map((post) => {
                const when = post.createdAt ? formatFeedTimestamp(post.createdAt) : "";
                const title = post.title || post.body || "Church post";
                return (
                  <View key={post.id} style={styles.postCard}>
                    <Text style={styles.postTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    {when ? <Text style={styles.postMeta}>{when}</Text> : null}
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyPosts}>No public posts yet.</Text>
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
    borderColor: GOLD_SOFT,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
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
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.12)",
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
  bodyText: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
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
  },
  followSlotPrimary: {
    backgroundColor: GOLD,
  },
  followSlotSecondary: {
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: GOLD_SOFT,
  },
  followSlotFollowing: {
    backgroundColor: "rgba(244,201,93,0.18)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.34)",
  },
  followPrimaryText: {
    color: "#07101A",
    fontSize: 15,
    fontWeight: "900",
  },
  followSecondaryText: {
    color: GOLD,
    fontSize: 15,
    fontWeight: "800",
  },
  followFollowingText: {
    color: "#FFFFFF",
  },
  joinSlotActive: {
    backgroundColor: GOLD,
  },
  joinSlotMember: {
    backgroundColor: GOLD,
  },
  joinSlotPending: {
    backgroundColor: "rgba(244,201,93,0.10)",
    borderWidth: 1,
    borderColor: GOLD_SOFT,
  },
  joinSlotDisabled: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    opacity: 0.72,
  },
  joinActiveText: {
    color: "#07101A",
    fontSize: 14,
    fontWeight: "900",
  },
  joinDisabledText: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  joinBtnDisabled: {
    opacity: 0.65,
  },
  memberBadgeText: {
    color: "#07101A",
    fontSize: 14,
    fontWeight: "900",
  },
  pendingBadgeText: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "800",
  },
  v1Hint: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  joinNotice: {
    color: GOLD,
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  postCard: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    gap: 4,
  },
  postTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  postMeta: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyPosts: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "600",
  },
});
