import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
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
import { queueOpenSharedHomeFeedPost } from "@/src/lib/homeFeedOpenSharedPost";
import { resolveChurchPublicPostCover } from "@/src/lib/churchProfilePostCover";
import {
  blockHomeFeedChurch,
  fetchChurchModerationFromApi,
  getLocalChurchModerationAction,
  hideHomeFeedChurch,
  isViewerOwnChurchAdmin,
  normalizeFeedChurchId,
  type ChurchFeedActionType,
  unhideHomeFeedChurch,
  unblockHomeFeedChurch,
} from "@/src/lib/homeFeedModeration";

export function resolveChurchProfileImageUrl(raw?: string) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^(https?:|file:|data:image\/)/i.test(v)) return v;
  const base = getApiBase();
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

export function churchPublicPostTitle(post: ChurchPublicPost) {
  return String(post.title || post.body || "Church post").trim();
}

/**
 * Church profile state and actions (load, follow, join request, safety hide/block/report, open a
 * post). Same behaviour as app/church-profile/[churchId].tsx; used by the Church Overview style
 * profile opened from Home feed video avatars. Every action goes through the existing APIs, which
 * enforce the permissions.
 */
export function useChurchProfileController(churchId: string) {
  const router = useRouter();
  const { session } = useKristoSession();

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
  const [churchModerationAction, setChurchModerationAction] = useState<ChurchFeedActionType | null>(null);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [safetyBusy, setSafetyBusy] = useState(false);
  const [safetyBanner, setSafetyBanner] = useState("");
  const safetyBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSafetyBanner = useCallback((message: string) => {
    setSafetyBanner(message);
    if (safetyBannerTimerRef.current) clearTimeout(safetyBannerTimerRef.current);
    safetyBannerTimerRef.current = setTimeout(() => setSafetyBanner(""), 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (safetyBannerTimerRef.current) clearTimeout(safetyBannerTimerRef.current);
    };
  }, []);

  const refreshChurchModeration = useCallback(async () => {
    if (!churchId) return;
    const normalizedId = normalizeFeedChurchId(churchId);
    const local = await getLocalChurchModerationAction(churchId);
    setChurchModerationAction(local);
    const { ok, records } = await fetchChurchModerationFromApi();
    if (!ok) return;
    const match = records.find((row) => row.churchId === normalizedId);
    setChurchModerationAction(match?.actionType || null);
  }, [churchId]);

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

  useFocusEffect(
    useCallback(() => {
      void refreshChurchModeration();
    }, [refreshChurchModeration])
  );

  const churchBlocked = churchModerationAction === "block";
  const churchHidden = churchModerationAction === "hide";

  const confirmOwnChurchSafetyAction = useCallback(
    (actionLabel: string, onConfirm: () => void) => {
      if (!isViewerOwnChurchAdmin(churchId)) {
        onConfirm();
        return;
      }
      Alert.alert(
        "Your church",
        `You are a leader of this church. ${actionLabel} may hide your church's content from your own feed and limit connect actions. Continue?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", style: "destructive", onPress: onConfirm },
        ]
      );
    },
    [churchId]
  );

  const runHideChurch = useCallback(async () => {
    if (!profile?.id || safetyBusy) return;
    setSafetyBusy(true);
    try {
      const result = await hideHomeFeedChurch({ churchId: profile.id });
      if (!result.ok) {
        Alert.alert("Could not hide church", result.error);
        return;
      }
      setChurchModerationAction("hide");
      showSafetyBanner("Posts from this church were hidden from your Home Feed.");
    } finally {
      setSafetyBusy(false);
    }
  }, [profile?.id, safetyBusy, showSafetyBanner]);

  const runBlockChurch = useCallback(async () => {
    if (!profile?.id || safetyBusy) return;
    setSafetyBusy(true);
    try {
      if (following) {
        try {
          const unfollowResult = await setChurchFollow(profile.id, false);
          if (unfollowResult.ok) {
            setFollowing(false);
            setProfile((prev) =>
              prev ? { ...prev, followerCount: Math.max(0, Number(prev.followerCount ?? 0) - 1) } : prev
            );
          }
        } catch {}
      }
      const result = await blockHomeFeedChurch({ churchId: profile.id });
      if (!result.ok) {
        Alert.alert("Could not block church", result.error);
        return;
      }
      setChurchModerationAction("block");
      showSafetyBanner("Church blocked. Content is hidden from your feed and connect actions are disabled.");
    } finally {
      setSafetyBusy(false);
    }
  }, [following, profile?.id, safetyBusy, showSafetyBanner]);

  const runUnhideChurch = useCallback(async () => {
    if (!profile?.id || safetyBusy) return;
    setSafetyBusy(true);
    try {
      const result = await unhideHomeFeedChurch(profile.id);
      if (!result.ok) {
        Alert.alert("Could not unhide church", result.error);
        return;
      }
      setChurchModerationAction(null);
      showSafetyBanner("Posts from this church can appear in your Home Feed again.");
    } finally {
      setSafetyBusy(false);
    }
  }, [profile?.id, safetyBusy, showSafetyBanner]);

  const runUnblockChurch = useCallback(async () => {
    if (!profile?.id || safetyBusy) return;
    setSafetyBusy(true);
    try {
      const result = await unblockHomeFeedChurch(profile.id);
      if (!result.ok) {
        Alert.alert("Could not unblock church", result.error);
        return;
      }
      setChurchModerationAction(null);
      showSafetyBanner("Church unblocked. You can follow or join again.");
    } finally {
      setSafetyBusy(false);
    }
  }, [profile?.id, safetyBusy, showSafetyBanner]);

  const requestHideChurch = useCallback(() => {
    Alert.alert(
      "Hide posts from this church?",
      "Posts from this church will be removed from your Home Feed. You can still visit this profile.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Hide posts", onPress: () => confirmOwnChurchSafetyAction("Hiding posts", () => void runHideChurch()) },
      ]
    );
  }, [confirmOwnChurchSafetyAction, runHideChurch]);

  const requestBlockChurch = useCallback(() => {
    Alert.alert(
      "Block this church?",
      "All posts from this church will be removed from your Home Feed. Follow and Join will be disabled until you unblock.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block church",
          style: "destructive",
          onPress: () => confirmOwnChurchSafetyAction("Blocking this church", () => void runBlockChurch()),
        },
      ]
    );
  }, [confirmOwnChurchSafetyAction, runBlockChurch]);

  const requestUnhideChurch = useCallback(() => {
    Alert.alert("Unhide posts from this church?", "Posts from this church can appear in your Home Feed again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unhide posts", onPress: () => void runUnhideChurch() },
    ]);
  }, [runUnhideChurch]);

  const requestUnblockChurch = useCallback(() => {
    Alert.alert("Unblock this church?", "You will be able to follow or join this church again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Unblock church", onPress: () => void runUnblockChurch() },
    ]);
  }, [runUnblockChurch]);

  const safetyPillLabel = useMemo(() => {
    if (churchBlocked) return "Blocked";
    if (churchHidden) return "Hidden";
    return "Safety";
  }, [churchBlocked, churchHidden]);

  const openSafetyMenu = useCallback(() => {
    if (!profile?.id) return;
    const options: Array<{ label: string; onPress?: () => void; style?: "cancel" | "destructive" }> = [];
    if (churchBlocked) {
      options.push({ label: "Unblock this church", onPress: requestUnblockChurch });
    } else if (churchHidden) {
      options.push({ label: "Unhide posts from this church", onPress: requestUnhideChurch });
      options.push({ label: "Block this church", style: "destructive", onPress: requestBlockChurch });
    } else {
      options.push({ label: "Hide posts from this church", onPress: requestHideChurch });
      options.push({ label: "Block this church", style: "destructive", onPress: requestBlockChurch });
    }
    options.push({ label: "Report this church", onPress: () => setReportSheetOpen(true) });
    options.push({ label: "Cancel", style: "cancel" });
    Alert.alert(
      "Church safety",
      undefined,
      options.map((option) => ({ text: option.label, style: option.style, onPress: option.onPress }))
    );
  }, [profile?.id, churchBlocked, churchHidden, requestHideChurch, requestBlockChurch, requestUnhideChurch, requestUnblockChurch]);

  const handleJoin = useCallback(async () => {
    if (churchBlocked) {
      Alert.alert("Church blocked", "Unblock this church before requesting to join.");
      return;
    }
    const userId = String(session?.userId || "").trim();
    if (!userId) {
      Alert.alert("Sign in required", "Please sign in before requesting to join a church.");
      return;
    }
    if (!profile?.id || !viewerState.canJoin || viewerState.joinStatus !== "none" || requesting) return;
    setRequesting(true);
    try {
      await sendChurchJoinRequest(profile.id, String(session?.displayName || session?.name || "").trim() || undefined);
      setViewerState((prev) => ({ ...prev, joinStatus: "pending", canJoin: false }));
    } catch (e: any) {
      Alert.alert("Request failed", String(e?.message || e || "Could not send join request."));
    } finally {
      setRequesting(false);
    }
  }, [profile?.id, requesting, session?.displayName, session?.name, session?.userId, viewerState.canJoin, viewerState.joinStatus, churchBlocked]);

  const handleFollowToggle = useCallback(async () => {
    if (churchBlocked) {
      Alert.alert("Church blocked", "Unblock this church before following.");
      return;
    }
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
      if (!result.ok) throw new Error(result.error || "Could not update follow status.");
      setFollowing(Boolean(result.following ?? nextFollowing));
      if (typeof result.followerCount === "number") {
        setProfile((prev) => (prev ? { ...prev, followerCount: result.followerCount } : prev));
      } else {
        setProfile((prev) =>
          prev
            ? { ...prev, followerCount: Math.max(0, Number(prev.followerCount ?? 0) + (nextFollowing ? 1 : -1)) }
            : prev
        );
      }
    } catch (e: any) {
      Alert.alert("Follow failed", String(e?.message || e || "Could not update follow status."));
    } finally {
      setFollowBusy(false);
    }
  }, [churchBlocked, followBusy, following, profile?.id, session?.userId]);

  const handlePostPress = useCallback(
    (post: ChurchPublicPost) => {
      if (!post.id) return;
      const coverUri = resolveChurchPublicPostCover(post);
      queueOpenSharedHomeFeedPost({
        type: post.videoUrl ? "video" : "post",
        postId: post.id,
        videoUri: resolveChurchProfileImageUrl(post.videoUrl),
        posterUri: coverUri || resolveChurchProfileImageUrl(post.posterUri || post.imageUrl),
        title: churchPublicPostTitle(post),
        caption: post.body,
        churchName: post.churchName || profile?.name || churchId,
      });
      router.push("/(tabs)/" as any);
    },
    [churchId, profile?.name, router]
  );

  return {
    loading,
    error,
    profile,
    viewerState,
    following,
    followBusy,
    requesting,
    churchBlocked,
    churchHidden,
    safetyBusy,
    safetyBanner,
    showSafetyBanner,
    safetyPillLabel,
    reportSheetOpen,
    setReportSheetOpen,
    loadProfile,
    openSafetyMenu,
    requestUnblockChurch,
    handleJoin,
    handleFollowToggle,
    handlePostPress,
  };
}
