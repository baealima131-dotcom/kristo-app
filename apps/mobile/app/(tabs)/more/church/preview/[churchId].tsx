import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { CINZEL_SEMIBOLD_FAMILY } from "@/src/lib/cinzelFont";
import { getApiBase } from "@/src/lib/kristoApi";
import { fetchChurchPublicProfile, type ChurchPublicProfile } from "@/src/lib/churchProfileApi";
import { CHURCH_PHOTO_ASPECT, CHURCH_PHOTO_FRAME_WIDTH } from "@/src/lib/churchPhotoFrame";

const BG = "#05070D";
const GOLD = "#D9B35F";
const TITLE_GOLD = "#F4D06F";
const LABEL_GOLD = "rgba(232,196,110,0.92)";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_SECONDARY = "rgba(255,255,255,0.72)";

function imageUrl(raw?: string) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^(https?:|file:|data:image\/)/i.test(v)) return v;
  const base = getApiBase();
  return `${base}${v.startsWith("/") ? "" : "/"}${v}`;
}

/**
 * Church Overview of another church, opened from Find a Church (View Profile). Read-only: only the
 * church's public profile (picture, name, verification, pastor, location, stats) from
 * /api/church/public-profile. No ministries, media slots or other member services, and no join
 * here: Send Request stays on Find a Church and membership starts only once a request is accepted.
 */
export default function ChurchPreviewScreen() {
  const params = useLocalSearchParams<{ churchId?: string }>();
  const churchId = String(params.churchId || "").trim().toUpperCase();

  const [profile, setProfile] = useState<ChurchPublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [photoFailed, setPhotoFailed] = useState(false);

  const load = useCallback(async () => {
    if (!churchId) {
      setError("Church not found.");
      setLoading(false);
      return;
    }
    setLoading(true);
    const next = await fetchChurchPublicProfile(churchId).catch(() => null);
    if (next) {
      setProfile(next);
      setPhotoFailed(false);
      setError("");
    } else {
      setError("Could not load this church.");
    }
    setLoading(false);
  }, [churchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const photo = photoFailed ? "" : imageUrl(profile?.avatarUri || profile?.avatarUrl || profile?.logoUrl);
  const location = profile ? profile.location || [profile.city, profile.province, profile.country].filter(Boolean).join(" • ") : "";
  const status = profile?.viewerMembershipStatus || "none";

  // Member / ministry counts come back only for members of this church (API decides).
  const stats = profile
    ? [
        { key: "members", label: "Active Members", value: profile.memberCount, icon: "people-outline" as const, tone: s.statBlue, iconTone: s.statIconBlue, color: "#7EB4FF" },
        { key: "followers", label: "Followers", value: Number(profile.followerCount || 0), icon: "heart-outline" as const, tone: s.statBlue, iconTone: s.statIconBlue, color: "#7EB4FF" },
        { key: "ministries", label: "Ministries", value: profile.ministriesCount, icon: "grid-outline" as const, tone: s.statGold, iconTone: s.statIconGold, color: GOLD },
      ].filter((c) => c.value != null)
    : [];

  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Back to Find a Church">
          <Ionicons name="chevron-back" size={22} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={s.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          Church Overview
        </Text>
        <Pressable onPress={() => void load()} hitSlop={10} style={s.headerBtn} accessibilityLabel="Refresh">
          <Ionicons name="refresh" size={18} color={TEXT_PRIMARY} />
        </Pressable>
      </View>

      {loading && !profile ? (
        <View style={s.center}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : error && !profile ? (
        <View style={s.center}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
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
                {profile.name}
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

          {/* Visitor notice instead of member services (Church Access, Ministries, Claim Media Slot). */}
          <View style={s.noticeCard}>
            <View style={s.noticeIcon}>
              <Ionicons name={status === "member" ? "checkmark-circle" : status === "pending" ? "time-outline" : "eye-outline"} size={20} color="#061020" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.noticeEyebrow}>{status === "member" ? "Your church" : "Visitor view"}</Text>
              <Text style={s.noticeText}>
                {status === "member"
                  ? "You are a member of this church. Open your Church Overview for the services you can use."
                  : status === "pending"
                  ? "Your join request is waiting for approval. Member services open once it is accepted."
                  : "You can view this church's information. Ministries, media slots and other member services open after your join request is accepted."}
              </Text>
              {status === "member" ? (
                <Pressable onPress={() => router.push("/(tabs)/church/overview" as any)} style={s.noticeBtn}>
                  <Text style={s.noticeBtnText}>Open my Church Overview</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={s.statsGrid}>
            {stats.map((c) => (
              <View key={c.key} style={[s.statCard, c.tone]}>
                <View style={[s.statIcon, c.iconTone]}>
                  <Ionicons name={c.icon} size={18} color={c.color} />
                </View>
                <Text style={s.statValue}>{c.value}</Text>
                <Text style={s.statLabel} numberOfLines={2}>
                  {c.label}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const GOLD_GLOW = "0 0 24px rgba(217,179,95,0.60), 0 0 6px rgba(217,179,95,0.55), inset 0 0 16px rgba(217,179,95,0.16)";
const BLUE_GLOW = "0 0 24px rgba(86,139,255,0.60), 0 0 6px rgba(86,139,255,0.55), inset 0 0 16px rgba(86,139,255,0.18)";

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
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
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: 3,
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
    gap: 14,
    padding: 14,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.95)",
    backgroundColor: "rgba(8,14,24,0.92)",
    boxShadow: GOLD_GLOW,
  },
  // Fixed Church Overview shape (5:8, see churchPhotoFrame.ts) so the cropped picture is never cut.
  photoFrame: {
    width: CHURCH_PHOTO_FRAME_WIDTH,
    aspectRatio: CHURCH_PHOTO_ASPECT,
    alignSelf: "center",
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
    letterSpacing: 0.2,
    textShadowColor: "rgba(232,196,110,0.60)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 14,
  },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  verifiedText: { color: TEXT_SECONDARY, fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
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

  noticeCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: "rgba(120,170,255,0.95)",
    backgroundColor: "rgba(10,16,28,0.96)",
    boxShadow: BLUE_GLOW,
  },
  noticeIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#568BFF",
  },
  noticeEyebrow: {
    color: "#8FB5FF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 3,
    textShadowColor: "rgba(110,160,255,0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  noticeText: { color: TEXT_SECONDARY, fontSize: 13, lineHeight: 19, fontWeight: "600" },
  noticeBtn: {
    alignSelf: "flex-start",
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: GOLD,
  },
  noticeBtnText: { color: "#07101A", fontWeight: "900", fontSize: 13 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    width: "47%",
    flexGrow: 1,
    minHeight: 132,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1.8,
    justifyContent: "space-between",
  },
  statBlue: {
    backgroundColor: "rgba(8,16,32,0.94)",
    borderColor: "rgba(110,165,255,0.92)",
    boxShadow: "0 0 20px rgba(74,144,255,0.55), 0 0 5px rgba(74,144,255,0.50), inset 0 0 14px rgba(74,144,255,0.16)",
  },
  statGold: {
    backgroundColor: "rgba(14,12,8,0.94)",
    borderColor: "rgba(232,196,110,0.90)",
    boxShadow: "0 0 20px rgba(217,179,95,0.55), 0 0 5px rgba(217,179,95,0.50), inset 0 0 14px rgba(217,179,95,0.16)",
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  statIconBlue: { backgroundColor: "rgba(74,144,255,0.14)", borderColor: "rgba(110,165,255,0.45)" },
  statIconGold: { backgroundColor: "rgba(217,179,95,0.14)", borderColor: "rgba(232,196,110,0.45)" },
  statValue: {
    color: TEXT_PRIMARY,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    marginTop: 10,
    textShadowColor: "rgba(255,255,255,0.45)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  statLabel: { color: TEXT_SECONDARY, fontSize: 14, lineHeight: 18, fontWeight: "800", marginTop: 4 },
});
