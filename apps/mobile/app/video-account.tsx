import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CINZEL_SEMIBOLD_FAMILY } from "@/src/lib/cinzelFont";
import {
  formatFeedTimestamp,
  resolveBestFeedPosterUri,
  resolveHomeFeedVideoTitle,
} from "@/src/components/homeFeed/homeFeedUtils";
import {
  fetchVideoAccountOverview,
  peekVideoAccountOverview,
  type VideoAccountOverview,
} from "@/src/lib/videoAccountApi";
import { videoAccountPlatformLabel } from "@/src/lib/videoAccountKey";
import { queueHomeFeedWatchRequest } from "@/src/lib/homeFeedWatchRequest";

/**
 * Video Account Overview: the YouTube / TikTok / Facebook account behind System Admin video links,
 * opened from the author avatar / name on Home Feed and Watch. Styled after Church Overview but its
 * own screen: no church fields (pastor, members, ministries, address) and no Send Request.
 * A video opens in the existing Home Watch (no second player).
 */

const BG = "#05070D";
const GOLD = "#D9B35F";
const TITLE_GOLD = "#F4D06F";
const LABEL_GOLD = "rgba(232,196,110,0.92)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_SECONDARY = "rgba(255,255,255,0.72)";
const GOLD_GLOW = "0 0 24px rgba(217,179,95,0.60), 0 0 6px rgba(217,179,95,0.55), inset 0 0 16px rgba(217,179,95,0.16)";

const PLATFORM_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  youtube: "logo-youtube",
  tiktok: "logo-tiktok",
  facebook: "logo-facebook",
};

function param(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] || "" : value || "").trim();
}

export default function VideoAccountOverviewScreen() {
  const params = useLocalSearchParams<{ key?: string; provider?: string; name?: string; avatar?: string; source?: string }>();
  const key = param(params.key);
  const providerParam = param(params.provider);
  const nameParam = param(params.name);
  const avatarParam = param(params.avatar);

  const [data, setData] = useState<VideoAccountOverview | null>(() => (key ? peekVideoAccountOverview(key) : null));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState("");
  const [avatarFailed, setAvatarFailed] = useState(false);

  const load = useCallback(async () => {
    if (!key) {
      setError("Akaunti hii haipatikani.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setData(await fetchVideoAccountOverview({ key, provider: providerParam, name: nameParam }));
    } catch (e: any) {
      setError(String(e?.message || "Video za akaunti hii hazikupatikana."));
    } finally {
      setLoading(false);
    }
  }, [key, providerParam, nameParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const provider = data?.account.provider || providerParam;
  const name = data?.account.name || nameParam || "Akaunti ya video";
  const avatar = !avatarFailed ? data?.account.avatarUrl || avatarParam : "";
  const items = data?.items || [];
  const videoCount = data?.videoCount ?? 0;
  const platformLabel = videoAccountPlatformLabel(provider);

  // Plays in the existing Home Watch: queue the row, then go back to Home (which opens it).
  const openVideo = useCallback((item: any) => {
    if (!queueHomeFeedWatchRequest(item, "video-account")) return;
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as any);
  }, []);

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={s.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          Video Account
        </Text>
        <View style={s.headerSpacer} />
      </View>

      {loading && !data ? (
        <View style={s.center}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : error && !data ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          {key ? (
            <Pressable onPress={() => void load()} style={s.retryBtn}>
              <Text style={s.retryText}>Jaribu tena</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.profileCard}>
            <View style={s.avatarRing}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={s.avatar} resizeMode="cover" onError={() => setAvatarFailed(true)} />
              ) : (
                <View style={s.avatarEmpty}>
                  <Text style={s.avatarInitial}>{name.trim().charAt(0).toUpperCase() || "V"}</Text>
                </View>
              )}
            </View>
            <View style={s.details}>
              <Text style={s.eyebrow}>Video Account</Text>
              <Text style={s.accountName} numberOfLines={3}>
                {name}
              </Text>
              <View style={s.platformChip}>
                <Ionicons name={PLATFORM_ICON[provider] || "play-circle-outline"} size={14} color={GOLD} />
                <Text style={s.platformText}>{platformLabel}</Text>
              </View>
            </View>
          </View>

          <View style={s.statChip}>
            <Ionicons name="film-outline" size={16} color={GOLD} />
            <Text style={s.statValue}>{videoCount}</Text>
            <Text style={s.statLabel}>Video kwenye Kristo App</Text>
          </View>

          <Text style={s.sectionLabel}>Videos</Text>
          {items.length ? (
            items.map((item) => {
              const postId = String(item?.id || "");
              const cover = resolveBestFeedPosterUri(item, postId);
              const title = resolveHomeFeedVideoTitle(item) || "Video";
              const when = item?.createdAt ? formatFeedTimestamp(String(item.createdAt)) : "";
              return (
                <Pressable key={postId} onPress={() => openVideo(item)} style={s.videoRow} accessibilityLabel={`Open video ${title}`}>
                  <View style={s.videoThumb}>
                    {cover ? <Image source={{ uri: cover }} style={s.videoThumbImage} resizeMode="cover" /> : null}
                    <View style={s.playBadge}>
                      <Ionicons name="play" size={12} color="#07101A" />
                    </View>
                  </View>
                  <View style={s.videoText}>
                    <Text style={s.videoTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    {when ? <Text style={s.videoTime}>{when}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={TEXT_SECONDARY} />
                </Pressable>
              );
            })
          ) : (
            <View style={s.emptyCard}>
              <Text style={s.emptyText}>Hakuna video za akaunti hii kwa sasa.</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

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
  headerSpacer: { width: 44, height: 44 },
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  errorText: { color: TEXT_SECONDARY, fontSize: 15, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderColor: GOLD, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8 },
  retryText: { color: GOLD, fontWeight: "800" },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 14 },

  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 16,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.95)",
    backgroundColor: "rgba(8,14,24,0.92)",
    boxShadow: GOLD_GLOW,
  },
  // Accounts have round profile pictures (YouTube / TikTok / Facebook), unlike the church photo frame.
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.90)",
    backgroundColor: "rgba(217,179,95,0.06)",
    boxShadow: "0 0 16px rgba(217,179,95,0.55)",
  },
  avatar: { width: "100%", height: "100%" },
  avatarEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: GOLD, fontSize: 38, fontWeight: "900" },
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
  accountName: {
    color: TEXT_PRIMARY,
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 25,
    textShadowColor: "rgba(232,196,110,0.60)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  platformChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(232,196,110,0.55)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  platformText: { color: TEXT_PRIMARY, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
  statChip: {
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(232,196,110,0.75)",
    backgroundColor: "rgba(8,14,24,0.94)",
    gap: 2,
  },
  statValue: {
    color: TEXT_PRIMARY,
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
    textShadowColor: "rgba(255,255,255,0.40)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  statLabel: { color: TEXT_SECONDARY, fontSize: 12, fontWeight: "800", letterSpacing: 0.3 },
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
  videoThumb: {
    width: 112,
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(217,179,95,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  videoThumbImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  playBadge: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,201,93,0.92)" },
  videoText: { flex: 1, minWidth: 0 },
  videoTitle: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "800", lineHeight: 19 },
  videoTime: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 3 },
  emptyCard: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.03)" },
  emptyText: { color: TEXT_SECONDARY, fontSize: 13, textAlign: "center" },
});
