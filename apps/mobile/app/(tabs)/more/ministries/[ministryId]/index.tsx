import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";

import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getMinistryLiveState } from "@/src/lib/ministryLive";
import { MembersListPanel } from "@/src/features/ministries/MembersListPanel";

const VIP_BG = "#0B0F17";
const GOLD = "#D9B35F";
const MEDIA = "#22C55E";

type Ministry = {
  id: string;
  name: string;
  description?: string;
  avatarUri?: string;
  mediaAccess?: boolean;
  status?: string;
};

async function apiGetMinistries() {
  const res = await apiGet<any>("/api/church/ministries", {
    headers: getKristoHeaders(),
  });

  if (!res?.ok) {
    throw new Error((res as any)?.error || "Failed");
  }

  return (res.data || []) as Ministry[];
}

function avatarUri(item?: any) {
  return (
    item?.avatarUri ||
    "https://ui-avatars.com/api/?background=1b2433&color=ffffff&bold=true&name=" +
      encodeURIComponent(String(item?.name || "Ministry"))
  );
}

export default function MinistryDetails() {
  const router = useRouter();
  const { ministryId } = useLocalSearchParams<{ ministryId: string }>();

  const id = useMemo(() => String(ministryId || ""), [ministryId]);

  const [item, setItem] = useState<Ministry | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [membersOpen, setMembersOpen] = useState(false);

  async function load() {
    setErr(null);
    setLoading(true);

    try {
      const all = await apiGetMinistries();
      const found = all.find((x: any) => String(x.id) === id) || null;

      setItem(found);

      if (!found) {
        setErr("Ministry not found.");
      }
    } catch (e: any) {
      setErr(e?.message || "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load();
  }, [id]);

  const liveState = getMinistryLiveState(id);
  const isLive = !!liveState?.isLive;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={s.hero}>
          <View style={s.heroGlowA} />
          <View style={s.heroGlowB} />

          <View style={s.topBar}>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [
                s.iconBtn,
                pressed && { opacity: 0.88 },
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color="white"
              />
            </Pressable>

            <Text style={s.topTitle}>Ministry Hub</Text>

            <View style={s.iconBtn}>
              <Ionicons
                name="sparkles-outline"
                size={18}
                color={GOLD}
              />
            </View>
          </View>

          {loading ? (
            <View style={s.center}>
              <ActivityIndicator />
              <Text style={s.muted}>Loading ministry...</Text>
            </View>
          ) : err ? (
            <View style={s.center}>
              <Text style={s.err}>{err}</Text>
            </View>
          ) : (
            <>
              <View style={s.avatarWrap}>
                <Image
                  source={{ uri: avatarUri(item) }}
                  style={s.avatar}
                />

                {isLive ? (
                  <View style={s.liveBadge}>
                    <View style={s.liveDot} />
                    <Text style={s.liveText}>LIVE NOW</Text>
                  </View>
                ) : null}
              </View>

              <View style={item?.mediaAccess ? s.mediaBadge : s.standardBadge}>
                <Ionicons
                  name={item?.mediaAccess ? "videocam-outline" : "people-outline"}
                  size={15}
                  color={item?.mediaAccess ? MEDIA : GOLD}
                />
                <Text style={item?.mediaAccess ? s.mediaBadgeText : s.standardBadgeText}>
                  {item?.mediaAccess ? "MEDIA ACCESS" : "GROUP MINISTRY"}
                </Text>
              </View>

              <Text style={s.name}>
                {item?.name}
              </Text>

              <Text style={s.desc}>
                {item?.description || "Church ministry"}
              </Text>

              <View style={s.statsRow}>
                <View style={s.statCard}>
                  <Ionicons
                    name="people-outline"
                    size={18}
                    color={GOLD}
                  />
                  <Text style={s.statTitle}>Members</Text>
                </View>

                <View style={s.statCard}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={18}
                    color={GOLD}
                  />
                  <Text style={s.statTitle}>Chat</Text>
                </View>

                <View style={s.statCard}>
                  <Ionicons
                    name="videocam-outline"
                    size={18}
                    color={GOLD}
                  />
                  <Text style={s.statTitle}>
                    {item?.mediaAccess ? "Media" : "Room"}
                  </Text>
                </View>
              </View>

              <View style={s.actions}>
                <Pressable
                  onPress={() =>
                    router.push(
                      (`/more/my-church-room/messages/${encodeURIComponent(
                        id
                      )}?title=${encodeURIComponent(
                        String(item?.name || "Ministry")
                      )}&sub=${encodeURIComponent(
                        String(item?.description || "Church ministry")
                      )}${item?.mediaAccess ? `&roomKind=assignment&assignmentRole=leader&assignmentStatus=active%20member&assignmentId=${encodeURIComponent(id)}&assignmentTitle=${encodeURIComponent(String(item?.name || "Ministry"))}&assignmentSubtitle=${encodeURIComponent(String(item?.description || "Church ministry"))}` : `&roomMode=ministry`}&tab=ministries&source=my_ministries` as any)
                    )
                  }
                  style={({ pressed }) => [
                    s.primaryBtn,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Ionicons
                    name="chatbubble-outline"
                    size={18}
                    color="#0B0F17"
                  />
                  <Text style={s.primaryBtnText}>
                    {item?.mediaAccess ? "Open Media Room" : "Open Chat"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    setMembersOpen(true)
                  }
                  style={({ pressed }) => [
                    s.secondaryBtn,
                    pressed && { opacity: 0.92 },
                  ]}
                >
                  <Ionicons
                    name="people-outline"
                    size={18}
                    color="white"
                  />
                  <Text style={s.secondaryBtnText}>
                    Members
                  </Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() =>
                  router.push(
                    (`/more/my-church-room/messages/${encodeURIComponent(
                      id
                    )}?title=${encodeURIComponent(
                      String(item?.name || "Ministry")
                    )}&sub=${encodeURIComponent(
                      String(item?.description || "Church ministry")
                    )}&tab=ministries&source=my_ministries${item?.mediaAccess ? `&roomKind=assignment&assignmentRole=leader&assignmentStatus=active%20member&assignmentId=${encodeURIComponent(id)}&assignmentTitle=${encodeURIComponent(String(item?.name || "Ministry"))}&assignmentSubtitle=${encodeURIComponent(String(item?.description || "Church ministry"))}` : `&roomMode=ministry`}` as any)
                  )
                }
                style={({ pressed }) => [
                  s.liveCard,
                  pressed && { opacity: 0.95 },
                ]}
              >
                <View style={s.liveCardGlow} />

                <View style={s.liveRow}>
                  <View style={s.liveIcon}>
                    <Ionicons
                      name="radio-outline"
                      size={26}
                      color="#0B0F17"
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={s.liveTitle}>
                      {item?.mediaAccess ? "Media Access Room" : "Ministry Room"}
                    </Text>

                    <Text style={s.liveSub}>
                      {item?.mediaAccess
                        ? "Live tools, media team access, members and ministry communication."
                        : "Members, group communication and ministry activity."}
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color="rgba(255,255,255,0.7)"
                  />
                </View>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>

      {membersOpen ? (
        <View style={s.membersOverlay}>
          <Pressable
            style={s.membersBackdrop}
            onPress={() => setMembersOpen(false)}
          />

          <View style={s.membersSheetWrap}>
            <MembersListPanel
              ministryId={id}
              visible={membersOpen}
              onClose={() => setMembersOpen(false)}
              onOpenMember={(userId) => {
                router.push(
                  (`/profile/${encodeURIComponent(String(userId || ""))}` as any)
                );
              }}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: VIP_BG,
  },

  membersOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 90,
    justifyContent: "flex-end",
  },

  membersBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.58)",
  },

  membersSheetWrap: {
    height: "78%",
    marginTop: "auto",
    overflow: "hidden",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
    backgroundColor: "rgba(8,12,20,0.98)",
  },

  hero: {
    paddingTop: 60,
    paddingHorizontal: 18,
  },

  heroGlowA: {
    position: "absolute",
    top: 40,
    left: -40,
    width: 140,
    height: 140,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.10)",
  },

  heroGlowB: {
    position: "absolute",
    top: 120,
    right: -60,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "rgba(80,120,255,0.08)",
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  iconBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  topTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 18,
  },

  center: {
    paddingVertical: 80,
    alignItems: "center",
  },

  muted: {
    marginTop: 12,
    color: "rgba(255,255,255,0.65)",
    fontWeight: "700",
  },

  err: {
    color: "#ff8b8b",
    fontWeight: "800",
  },

  avatarWrap: {
    marginTop: 40,
    alignItems: "center",
  },

  avatar: {
    width: 120,
    height: 120,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: "rgba(34,197,94,0.42)",
    shadowColor: "#22C55E",
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },

  mediaBadge: {
    marginTop: 18,
    alignSelf: "center",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.55)",
    backgroundColor: "rgba(34,197,94,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  mediaBadgeText: {
    color: "#86EFAC",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.1,
  },

  standardBadge: {
    marginTop: 18,
    alignSelf: "center",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(217,179,95,0.10)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  standardBadgeText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1.1,
  },

  liveBadge: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,80,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,80,80,0.35)",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#ff4d4d",
  },

  liveText: {
    color: "#ffb3b3",
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 1,
  },

  name: {
    marginTop: 22,
    color: "white",
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "center",
  },

  desc: {
    marginTop: 12,
    color: "rgba(255,255,255,0.70)",
    textAlign: "center",
    lineHeight: 22,
    fontWeight: "700",
  },

  statsRow: {
    marginTop: 28,
    flexDirection: "row",
    gap: 12,
  },

  statCard: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  statTitle: {
    color: "white",
    fontWeight: "800",
    fontSize: 12,
  },

  actions: {
    marginTop: 26,
    flexDirection: "row",
    gap: 12,
  },

  primaryBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: MEDIA,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },

  primaryBtnText: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 15,
  },

  secondaryBtn: {
    width: 120,
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },

  secondaryBtnText: {
    color: "white",
    fontWeight: "800",
  },

  liveCard: {
    marginTop: 28,
    borderRadius: 28,
    padding: 20,
    overflow: "hidden",
    backgroundColor: "rgba(4,38,23,0.58)",
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.32)",
  },

  liveCardGlow: {
    position: "absolute",
    top: -20,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.10)",
  },

  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  liveIcon: {
    width: 60,
    height: 60,
    borderRadius: 22,
    backgroundColor: MEDIA,
    alignItems: "center",
    justifyContent: "center",
  },

  liveTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 18,
  },

  liveSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.68)",
    lineHeight: 20,
    fontWeight: "700",
  },
});
