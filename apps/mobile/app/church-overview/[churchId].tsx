import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CINZEL_SEMIBOLD_FAMILY } from "@/src/lib/cinzelFont";
import { ChurchReportSheet } from "@/src/components/church/ChurchReportSheet";
import { formatFeedTimestamp } from "@/src/components/homeFeed/homeFeedUtils";
import { churchPublicPostIsVideo, resolveChurchPublicPostCover } from "@/src/lib/churchProfilePostCover";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { loadChurchProfileCache } from "@/src/lib/churchStore";
import { getChurchOverviewCache, parseChurchOverviewProfileFields } from "@/src/lib/screenDataCache";
import { avatarCacheBust } from "@/src/lib/avatarFreshness";
import { fetchLiveControlSelfStatus, lastKnownLiveControlStatus } from "@/src/lib/churchLiveControlAccess";
import {
  churchPublicPostTitle,
  resolveChurchProfileImageUrl,
  useChurchProfileController,
} from "@/src/lib/useChurchProfileController";

const BG = "#05070D";
const GOLD = "#D9B35F";
const TITLE_GOLD = "#F4D06F";
const LABEL_GOLD = "rgba(232,196,110,0.92)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_SECONDARY = "rgba(255,255,255,0.72)";
const BLUE_TEXT = "#8FB5FF";

/**
 * Church profile in the Church Overview style, opened from the avatar of a Home feed video post.
 * What it shows depends on the viewer, and the API enforces it (public-profile returns member /
 * ministry counts and church-only videos to members of this church or staff only; ministries,
 * media slots and other in-church APIs refuse non-members):
 * - member of this church: Church Access (Ministries, Claim Media Slot)
 * - anyone else: Follow and Send Request (membership starts only once a request is accepted)
 * Safety (hide / block / unblock / report) stays available to everyone.
 */
export default function ChurchOverviewProfileScreen() {
  const params = useLocalSearchParams<{ churchId?: string; churchName?: string }>();
  const churchId = String(params.churchId || "").trim();
  const hintName = String(params.churchName || "").trim();
  const c = useChurchProfileController(churchId);
  const { session } = useKristoSession();
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoUri, setPhotoUri] = useState("");

  const profile = c.profile;
  const displayName = profile?.name || hintName || churchId;

  // Church picture chosen exactly like Church Overview: the church record (API) first, and the same
  // device caches Overview uses for this church (only present for the viewer's own church).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!profile) return;
      const userId = String(session?.userId || "").trim();
      const overviewCache = userId ? await getChurchOverviewCache(profile.id, userId).catch(() => null) : null;
      const legacyCache = await loadChurchProfileCache(profile.id).catch(() => null);
      const fields = parseChurchOverviewProfileFields(
        profile.id,
        {
          avatarUri: profile.avatarUri,
          avatarUrl: profile.avatarUrl,
          churchLogoUrl: profile.logoUrl,
          avatarUpdatedAt: profile.avatarUpdatedAt,
        },
        {
          uri: overviewCache?.profile?.avatarUri || legacyCache?.avatarUri || legacyCache?.avatarUrl || "",
          updatedAt: overviewCache?.profile?.avatarUpdatedAt || legacyCache?.avatarUpdatedAt,
        }
      );
      const uri = fields.avatarUri ? avatarCacheBust(resolveChurchProfileImageUrl(fields.avatarUri), fields.avatarUpdatedAt) : "";
      if (!cancelled) {
        setPhotoFailed(false);
        setPhotoUri(uri);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, session?.userId]);

  const photo = photoFailed ? "" : photoUri;
  const location = profile
    ? profile.location || [profile.city, profile.province, profile.country].filter(Boolean).join(" • ")
    : "";
  const isMember = c.viewerState.joinStatus === "member";
  const isPending = c.viewerState.joinStatus === "pending";
  const videos = (profile?.recentPosts || []).filter((post) => churchPublicPostIsVideo(post));

  // Compact stats in one row; members / ministries only when the API returns them for this viewer.
  const stats = profile
    ? [
        { key: "followers", label: "Followers", value: Number(profile.followerCount ?? 0), icon: "heart-outline" as const, color: "#7EB4FF", tone: s.chipBlue },
        { key: "members", label: "Members", value: profile.memberCount, icon: "people-outline" as const, color: "#7EB4FF", tone: s.chipBlue },
        { key: "videos", label: "Videos", value: videos.length, icon: "play-circle-outline" as const, color: GOLD, tone: s.chipGold },
        { key: "ministries", label: "Ministries", value: profile.ministriesCount, icon: "grid-outline" as const, color: GOLD, tone: s.chipGold },
      ].filter((stat) => stat.value != null)
    : [];

  // Church Live Control suspension locks Claim Media Slot (the server refuses it as well).
  const viewerUserId = String(session?.userId || "").trim();
  const [liveControlSuspended, setLiveControlSuspended] = useState(
    () => lastKnownLiveControlStatus(viewerUserId) === "Suspended"
  );
  const [checkingLiveControl, setCheckingLiveControl] = useState(false);
  useEffect(() => {
    if (!isMember || !viewerUserId) return;
    let alive = true;
    void fetchLiveControlSelfStatus(viewerUserId).then((status) => {
      if (alive && status) setLiveControlSuspended(status === "Suspended");
    });
    return () => {
      alive = false;
    };
  }, [isMember, viewerUserId]);

  const showLiveControlSuspendedAlert = () =>
    Alert.alert(
      "Access suspended",
      "Your Church Live Control access is suspended. You cannot claim media slots until a church leader restores your access."
    );

  const openMinistries = () => router.push("/more/ministries" as any);
  const openClaimMediaSlot = async () => {
    if (liveControlSuspended) {
      showLiveControlSuspendedAlert();
      return;
    }
    if (checkingLiveControl) return;
    // Re-check on tap: a suspension made since this screen loaded applies now.
    setCheckingLiveControl(true);
    const status = await fetchLiveControlSelfStatus(viewerUserId);
    setCheckingLiveControl(false);
    if (status === "Suspended") {
      setLiveControlSuspended(true);
      showLiveControlSuspendedAlert();
      return;
    }
    router.push({
      pathname: "/(tabs)/more/my-church-room/messages/[id]",
      params: {
        id: "church-media-room",
        title: "Church Live Control",
        sub: "Whole church assignment room",
        tab: "ministries",
        source: "church-live-control",
        roomKind: "assignment",
        assignmentId: "church-media-room",
      },
    } as any);
  };

  const sendDisabled = c.requesting || !c.viewerState.canJoin || c.churchBlocked;
  // Member of another church (or blocked): Send Request stays disabled with a lock; the API refuses too.
  const sendLocked = !c.requesting && (c.viewerState.memberOfOtherChurch || c.churchBlocked);

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={s.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          Church Overview
        </Text>
        <Pressable
          onPress={c.openSafetyMenu}
          disabled={!profile || c.safetyBusy}
          hitSlop={8}
          style={[s.safetyBtn, c.churchBlocked && s.safetyBtnBlocked]}
          accessibilityLabel="Church safety options"
        >
          <Ionicons name={c.churchBlocked ? "warning-outline" : "shield-outline"} size={15} color={c.churchBlocked ? "#FF9B9B" : GOLD} />
          <Text style={[s.safetyText, c.churchBlocked && { color: "#FF9B9B" }]}>{c.safetyPillLabel}</Text>
        </Pressable>
      </View>

      {c.safetyBanner ? (
        <View style={s.safetyBanner} pointerEvents="none">
          <Text style={s.safetyBannerText}>{c.safetyBanner}</Text>
        </View>
      ) : null}

      {c.loading && !profile ? (
        <View style={s.center}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : c.error && !profile ? (
        <View style={s.center}>
          <Text style={s.errorText}>{c.error}</Text>
          <Pressable onPress={() => void c.loadProfile()} style={s.retryBtn}>
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : profile ? (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.profileCard}>
            <View style={s.photoFrame}>
              {photo ? (
                <Image source={{ uri: photo }} style={s.photo} resizeMode="cover" onError={() => setPhotoFailed(true)} />
              ) : (
                <View style={s.photoEmpty}>
                  <Ionicons name="business-outline" size={46} color={GOLD} />
                </View>
              )}
            </View>
            <View style={s.details}>
              <Text style={s.eyebrow}>Church Profile</Text>
              <Text style={s.churchName} numberOfLines={3}>
                {displayName}
              </Text>
              {profile.verified ? (
                <View style={s.verifiedRow}>
                  <Ionicons name="shield-checkmark" size={12} color={GOLD} />
                  <Text style={s.verifiedText}>Verified church identity</Text>
                </View>
              ) : null}
              <View style={s.infoList}>
                <View style={s.infoRow}>
                  <View style={s.infoIcon}>
                    <Ionicons name="person-outline" size={21} color={GOLD} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoLabel}>Pastor</Text>
                    <Text style={s.infoValue}>{profile.pastorName || "Pastor Not Assigned"}</Text>
                  </View>
                </View>
                <View style={s.infoRow}>
                  <View style={s.infoIcon}>
                    <Ionicons name="location-outline" size={21} color={GOLD} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.infoLabel}>Location</Text>
                    <Text style={s.infoValue}>{location || "—"}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {c.churchBlocked ? (
            <View style={s.blockedCard}>
              <Text style={s.blockedTitle}>You blocked this church</Text>
              <Text style={s.blockedText}>Content from this church is hidden from your feed. Follow and Send Request are off.</Text>
              <View style={s.blockedActions}>
                <Pressable onPress={c.requestUnblockChurch} disabled={c.safetyBusy} style={s.blockedBtn}>
                  <Text style={s.blockedBtnText}>Unblock church</Text>
                </Pressable>
                <Pressable onPress={() => c.setReportSheetOpen(true)} style={s.blockedLink}>
                  <Text style={s.blockedLinkText}>Report issue</Text>
                </Pressable>
              </View>
            </View>
          ) : c.churchHidden ? (
            <View style={s.hiddenCard}>
              <Text style={s.hiddenText}>Posts from this church are hidden from your Home Feed.</Text>
            </View>
          ) : null}

          {isMember ? (
            // Member of this church: the services they can use (same as their Church Overview).
            <View style={s.accessCard}>
              <View style={s.accessTop}>
                <View style={s.accessIcon}>
                  <Ionicons name="people" size={19} color="#061020" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.accessEyebrow}>Church Access</Text>
                  <Text style={s.accessTitle}>Serve with your church</Text>
                </View>
              </View>
              <View style={s.actionRow}>
                <Pressable onPress={openMinistries} style={[s.btn, s.btnBlue]}>
                  <Ionicons name="grid-outline" size={17} color={BLUE_TEXT} />
                  <Text style={s.btnBlueText}>Ministries</Text>
                </Pressable>
                {liveControlSuspended ? (
                  <Pressable onPress={openClaimMediaSlot} style={[s.btn, s.btnGoldOutline, s.btnSuspended]}>
                    <Ionicons name="lock-closed" size={15} color={GOLD} />
                    <Text style={s.btnGoldOutlineText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                      Access suspended
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={openClaimMediaSlot} style={[s.btn, s.btnGold]}>
                    <Ionicons name="radio-outline" size={17} color="#07101A" />
                    <Text style={s.btnGoldText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                      Claim Media Slot
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : (
            // Not a member: Follow and Send Request instead of Ministries / Claim Media Slot.
            <View style={s.accessCard}>
              <View style={s.accessTop}>
                <View style={s.accessIcon}>
                  <Ionicons name={isPending ? "time-outline" : "heart"} size={19} color="#061020" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.accessEyebrow}>Connect</Text>
                  <Text style={s.accessTitle}>
                    {isPending ? "Your join request is pending" : "Follow or join this church"}
                  </Text>
                </View>
              </View>
              <View style={s.actionRow}>
                <Pressable
                  onPress={() => void c.handleFollowToggle()}
                  disabled={c.followBusy || c.churchBlocked}
                  style={[s.btn, s.btnBlue, (c.followBusy || c.churchBlocked) && s.btnDisabled]}
                >
                  <Ionicons name={c.following ? "heart" : "heart-outline"} size={17} color={BLUE_TEXT} />
                  <Text style={s.btnBlueText}>{c.followBusy ? "Updating…" : c.following ? "Following" : "Follow"}</Text>
                </Pressable>
                {isPending ? (
                  <View style={[s.btn, s.btnGoldOutline]}>
                    <Ionicons name="hourglass-outline" size={16} color={GOLD} />
                    <Text style={s.btnGoldOutlineText}>Request Pending</Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void c.handleJoin()}
                    disabled={sendDisabled}
                    style={[s.btn, s.btnGold, sendDisabled && s.btnDisabled]}
                  >
                    <Ionicons
                      name={c.requesting ? "hourglass-outline" : sendLocked ? "lock-closed" : "paper-plane-outline"}
                      size={16}
                      color="#07101A"
                    />
                    <Text style={s.btnGoldText}>{c.requesting ? "Sending…" : "Send Request"}</Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          <View style={s.statsRow}>
            {stats.map((stat) => (
              <View key={stat.key} style={[s.statChip, stat.tone]}>
                <Ionicons name={stat.icon} size={16} color={stat.color} />
                <Text style={s.statChipValue} numberOfLines={1}>
                  {stat.value}
                </Text>
                <Text style={s.statChipLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>

          <Text style={s.sectionLabel}>Videos</Text>
          {videos.length ? (
            videos.map((post) => {
              const cover = resolveChurchPublicPostCover(post);
              const when = post.createdAt ? formatFeedTimestamp(post.createdAt) : "";
              return (
                <Pressable key={post.id} onPress={() => c.handlePostPress(post)} style={s.videoRow} accessibilityLabel={`Open video ${churchPublicPostTitle(post)}`}>
                  <View style={s.videoThumb}>
                    {cover ? <Image source={{ uri: cover }} style={s.videoThumbImage} resizeMode="cover" /> : null}
                    <View style={s.playBadge}>
                      <Ionicons name="play" size={12} color="#07101A" />
                    </View>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.videoTitle} numberOfLines={2}>
                      {churchPublicPostTitle(post)}
                    </Text>
                    {when ? <Text style={s.videoTime}>{when}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
                </Pressable>
              );
            })
          ) : (
            <View style={s.emptyCard}>
              <Text style={s.emptyText}>No videos to show yet.</Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      <ChurchReportSheet
        visible={c.reportSheetOpen}
        churchId={churchId}
        churchName={displayName}
        onClose={() => c.setReportSheetOpen(false)}
        onReported={() => c.showSafetyBanner("Report submitted. Thank you for helping keep Kristo safe.")}
      />
    </SafeAreaView>
  );
}

const GOLD_GLOW = "0 0 24px rgba(217,179,95,0.60), 0 0 6px rgba(217,179,95,0.55), inset 0 0 16px rgba(217,179,95,0.16)";
const BLUE_GLOW = "0 0 24px rgba(86,139,255,0.60), 0 0 6px rgba(86,139,255,0.55), inset 0 0 16px rgba(86,139,255,0.18)";

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  // Same heading as Church Overview / MY MINISTRIES.
  title: {
    flex: 1,
    textAlign: "center",
    fontFamily: CINZEL_SEMIBOLD_FAMILY,
    color: TITLE_GOLD,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: 2.6,
    textTransform: "uppercase",
    textShadowColor: "rgba(244,208,111,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  safetyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  safetyBtnBlocked: { borderColor: "rgba(255,120,120,0.55)", backgroundColor: "rgba(255,90,90,0.10)" },
  safetyText: { color: GOLD, fontSize: 12, fontWeight: "800" },
  safetyBanner: {
    marginHorizontal: 16,
    marginBottom: 6,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.40)",
  },
  safetyBannerText: { color: TEXT_PRIMARY, fontSize: 13, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { color: TEXT_SECONDARY, fontSize: 15, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderColor: GOLD, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: GOLD, fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 14 },

  profileCard: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.95)",
    backgroundColor: "rgba(8,14,24,0.92)",
    boxShadow: GOLD_GLOW,
  },
  photoFrame: {
    width: "42%",
    minHeight: 220,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.90)",
    backgroundColor: "rgba(217,179,95,0.06)",
    boxShadow: "0 0 16px rgba(217,179,95,0.55)",
  },
  photo: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  photoEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  details: { flex: 1, minWidth: 0, justifyContent: "center", paddingVertical: 4 },
  eyebrow: {
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    marginBottom: 5,
    textShadowColor: "rgba(232,196,110,0.75)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  churchName: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 25,
    textShadowColor: "rgba(232,196,110,0.60)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  verifiedText: { color: TEXT_SECONDARY, fontSize: 11, fontWeight: "700" },
  infoList: { gap: 10, marginTop: 12 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.80)",
    boxShadow: "0 0 10px rgba(217,179,95,0.45)",
  },
  infoLabel: {
    color: LABEL_GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 2,
    textShadowColor: "rgba(232,196,110,0.65)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  infoValue: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "700", lineHeight: 20 },

  blockedCard: {
    padding: 14,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255,120,120,0.55)",
    backgroundColor: "rgba(40,10,14,0.85)",
    gap: 6,
  },
  blockedTitle: { color: "#FFB4B4", fontSize: 15, fontWeight: "900" },
  blockedText: { color: TEXT_SECONDARY, fontSize: 13, lineHeight: 18 },
  blockedActions: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 6 },
  blockedBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, backgroundColor: GOLD },
  blockedBtnText: { color: "#07101A", fontWeight: "900" },
  blockedLink: { paddingVertical: 9 },
  blockedLinkText: { color: GOLD, fontWeight: "800" },
  hiddenCard: { padding: 12, borderRadius: 18, borderWidth: 1, borderColor: "rgba(217,179,95,0.35)", backgroundColor: "rgba(217,179,95,0.08)" },
  hiddenText: { color: TEXT_SECONDARY, fontSize: 13 },

  accessCard: {
    padding: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(120,170,255,0.95)",
    backgroundColor: "rgba(10,16,28,0.96)",
    boxShadow: BLUE_GLOW,
    gap: 12,
  },
  accessTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  accessIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#568BFF" },
  accessEyebrow: {
    color: BLUE_TEXT,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 2,
    textShadowColor: "rgba(110,160,255,0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  accessTitle: { color: TEXT_PRIMARY, fontSize: 16, fontWeight: "900" },
  actionRow: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, minHeight: 46, borderRadius: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10 },
  btnBlue: { borderWidth: 1.3, borderColor: "rgba(120,170,255,0.70)", backgroundColor: "rgba(86,139,255,0.12)" },
  btnBlueText: { color: BLUE_TEXT, fontWeight: "900", fontSize: 14 },
  btnGold: { backgroundColor: "#E9C46A", borderWidth: 1, borderColor: "rgba(255,226,140,0.95)", boxShadow: "0 0 14px rgba(244,201,93,0.40)" },
  btnGoldText: { color: "#07101A", fontWeight: "900", fontSize: 14 },
  btnGoldOutline: { borderWidth: 1.3, borderColor: "rgba(232,196,110,0.70)", backgroundColor: "rgba(244,201,93,0.10)" },
  btnGoldOutlineText: { color: GOLD, fontWeight: "900", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
  btnSuspended: { opacity: 0.72 },

  statsRow: { flexDirection: "row", gap: 8 },
  statChip: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 18,
    borderWidth: 1.5,
    gap: 2,
  },
  chipBlue: {
    backgroundColor: "rgba(8,16,32,0.94)",
    borderColor: "rgba(110,165,255,0.85)",
    boxShadow: "0 0 12px rgba(74,144,255,0.45), inset 0 0 10px rgba(74,144,255,0.14)",
  },
  chipGold: {
    backgroundColor: "rgba(14,12,8,0.94)",
    borderColor: "rgba(232,196,110,0.85)",
    boxShadow: "0 0 12px rgba(217,179,95,0.45), inset 0 0 10px rgba(217,179,95,0.14)",
  },
  statChipValue: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    textShadowColor: "rgba(255,255,255,0.40)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  statChipLabel: { color: TEXT_SECONDARY, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  sectionLabel: {
    color: LABEL_GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 4,
    textShadowColor: "rgba(232,196,110,0.65)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  videoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(232,196,110,0.55)",
    backgroundColor: "rgba(8,14,24,0.92)",
    boxShadow: "0 0 12px rgba(217,179,95,0.30)",
  },
  videoThumb: { width: 112, height: 64, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(217,179,95,0.10)", alignItems: "center", justifyContent: "center" },
  videoThumbImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  playBadge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.92)" },
  videoTitle: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "800", lineHeight: 19 },
  videoTime: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 3 },
  emptyCard: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)" },
  emptyText: { color: TEXT_SECONDARY, fontSize: 13, textAlign: "center" },
});
