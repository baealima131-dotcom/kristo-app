import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, Pressable, StyleSheet, View, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  safeAvatarUri,
  safeBody,
  safeDisplayName,
  safeInitial,
  type NotificationLike,
} from "@/src/lib/notificationDisplay";

const VIP_BG = "#07111F";
const GOLD = "#F4D06F";
const MUTED = "rgba(255,255,255,0.68)";

type Notice = NotificationLike & {
  id?: string;
  title?: string;
  body?: string;
  message?: string;
  createdAt?: string;
  readAt?: string;
  read?: boolean;
  status?: string;
  membershipStatus?: string;
  inviteStatus?: string;
};

function mapApiNotice(x: any, i: number): Notice {
  const raw: NotificationLike = {
    title: String(x?.title || "Notification"),
    body: String(x?.body || x?.message || x?.text || ""),
    message: String(x?.message || x?.body || x?.text || ""),
    actorName: x?.actorName,
    actorUserId: x?.actorUserId,
    actorAvatarUri: x?.actorAvatarUri,
    actorRole: x?.actorRole,
    avatarUri: x?.avatarUri,
    avatarUrl: x?.avatarUrl,
    profileImage: x?.profileImage,
    type: String(x?.type || ""),
  };

  return {
    id: String(x?.id || i),
    title: String(raw.title || "Notification"),
    body: safeBody(raw),
    message: safeBody(raw),
    createdAt: String(x?.createdAt || ""),
    readAt: x?.readAt,
    read: !!(x?.readAt || x?.isRead || x?.read),
    actorName: safeDisplayName(raw),
    actorUserId: raw.actorUserId,
    actorAvatarUri: raw.actorAvatarUri,
    actorRole: raw.actorRole,
    avatarUri: raw.avatarUri,
    avatarUrl: raw.avatarUrl,
    profileImage: raw.profileImage,
    type: raw.type,
  };
}

export default function ChurchNotifications() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState("");

  async function load() {
    setLoading(true);
    try {
      const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
      const r = await fetch(`${base}/api/church/notifications`, { headers: getKristoHeaders() });
      const j = await r.json().catch(() => ({} as any));
      const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];

      const inviteFiltered = raw.filter((x: any) => {
        const title = String(x?.title || "").toLowerCase();
        const body = String(x?.body || x?.message || x?.text || "").toLowerCase();
        const type = String(x?.type || x?.kind || x?.category || "").toLowerCase();

        const hasInviteShape = Boolean(x?.membershipId || x?.ministryMemberId);
        const looksLikeInvite =
          title.includes("invite") ||
          title.includes("invitation") ||
          body.includes("invite") ||
          body.includes("invitation") ||
          type.includes("invite") ||
          type.includes("invitation") ||
          hasInviteShape;

        return !looksLikeInvite;
      });

      const seen = new Set<string>();
      const clean = inviteFiltered
        .filter((x: Notice, i: number) => {
          const title = String(x?.title || "").toLowerCase();
          const status = String(x?.status || x?.membershipStatus || x?.inviteStatus || "").toLowerCase();
          const key = String((x as any)?.membershipId || (x as any)?.ministryMemberId || (x as any)?.churchId || x?.id || i);

          if (title.includes("invite") && status && status !== "pending") return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((x: any, i: number) => mapApiNotice(x, i));

      setItems(clean);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const unread = useMemo(() => items.filter((x) => !(x.readAt || x.read)).length, [items]);

  return (
    <View style={[s.wrap, { paddingTop: insets.top + 12 }]}>
      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.roundBtn}>
          <Ionicons name="chevron-back" size={30} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.h1}>Notifications</Text>
          <Text style={s.h2}>Real alerts inside More tab</Text>
        </View>

        <Pressable onPress={load} style={s.roundBtn}>
          <Ionicons name="refresh" size={23} color="white" />
        </Pressable>
      </View>

      <View style={s.actionRow}>
        <View style={s.unreadPill}>
          <Ionicons name="notifications" size={18} color={GOLD} />
          <Text style={s.unreadText}>{unread} unread</Text>
        </View>

        <Pressable onPress={() => setItems((prev) => prev.map((x) => ({ ...x, readAt: x.readAt || new Date().toISOString(), read: true })))} style={s.markBtn}>
          <Text style={s.markText}>Mark all</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.emptyText}>Loading notifications...</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
          {!items.length ? (
            <View style={s.emptyCard}>
              <Ionicons name="mail-open-outline" size={38} color={GOLD} />
              <Text style={s.emptyTitle}>No notifications</Text>
              <Text style={s.emptyText}>Clean alerts will appear here.</Text>
            </View>
          ) : (
            items.map((n, i) => {
              const id = String(n.id || i);
              const open = expandedId === id;
              const body = safeBody(n);
              const actorName = safeDisplayName(n);
              const avatarUri = safeAvatarUri(n);
              const actorInitial = safeInitial(n);

              return (
                <Pressable key={id} onPress={() => setExpandedId(open ? "" : id)} style={s.noticeCard}>
                  <View style={s.noticeLeftBar} />
                  <View style={s.noticeTop}>
                    <View style={s.noticeIcon}>
                      {avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={s.noticeAvatarImage} resizeMode="cover" />
                      ) : (
                        <Text style={s.noticeIconText}>{actorInitial}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      {!!actorName ? (
                        <Text style={s.noticeActor} numberOfLines={1}>
                          {actorName}
                        </Text>
                      ) : null}
                      <Text style={s.noticeTitle} numberOfLines={1}>{n.title || "Notification"}</Text>
                      <Text style={s.noticeTime}>Now</Text>
                    </View>
                    <View style={s.unreadBadge}>
                      <Text style={s.unreadBadgeText}>{n.readAt || n.read ? "Read" : "Unread"}</Text>
                    </View>
                  </View>

                  <Text style={s.noticeBody} numberOfLines={open ? 8 : 1}>{body}</Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: VIP_BG, paddingHorizontal: 16 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 18 },
  roundBtn: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  h1: { color: "white", fontSize: 36, fontWeight: "900" },
  h2: { color: MUTED, fontSize: 16, fontWeight: "800" },
  actionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  unreadPill: { flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 16, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  unreadText: { color: "white", fontWeight: "900", fontSize: 16 },
  markBtn: { height: 48, paddingHorizontal: 20, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(244,208,111,0.12)", borderWidth: 1, borderColor: "rgba(244,208,111,0.45)" },
  markText: { color: GOLD, fontSize: 16, fontWeight: "900" },
  noticeCard: { marginBottom: 14, padding: 18, borderRadius: 22, backgroundColor: "rgba(19,20,14,0.96)", borderWidth: 1, borderColor: "rgba(244,208,111,0.26)", overflow: "hidden" },
  noticeLeftBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 7, backgroundColor: GOLD },
  noticeTop: { flexDirection: "row", gap: 14, alignItems: "center" },
  noticeIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: 1.3, borderColor: "rgba(244,208,111,0.45)", overflow: "hidden" },
  noticeAvatarImage: { width: 58, height: 58, borderRadius: 29 },
  noticeIconText: { color: GOLD, fontWeight: "900", fontSize: 18 },
  noticeActor: { color: "rgba(255,255,255,0.92)", fontSize: 15, fontWeight: "800", marginBottom: 4 },
  noticeTitle: { color: "white", fontSize: 20, fontWeight: "900" },
  noticeTime: { marginTop: 10, color: MUTED, fontWeight: "800" },
  unreadBadge: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(244,208,111,0.13)", borderWidth: 1, borderColor: "rgba(244,208,111,0.35)" },
  unreadBadgeText: { color: GOLD, fontWeight: "900" },
  noticeBody: { marginTop: 18, color: "rgba(255,255,255,0.78)", fontSize: 17, lineHeight: 24 },
  center: { marginTop: 80, alignItems: "center", gap: 12 },
  emptyCard: { marginTop: 30, minHeight: 220, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.035)" },
  emptyTitle: { marginTop: 14, color: "white", fontSize: 24, fontWeight: "900" },
  emptyText: { marginTop: 6, color: MUTED, fontWeight: "800" },
});
