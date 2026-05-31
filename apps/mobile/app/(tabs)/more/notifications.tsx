import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getSessionSync } from "@/src/lib/kristoSession";
import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { createDebouncer, shouldAllowScreenRefresh } from "@/src/lib/kristoTraffic";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  safeAvatarUri,
  safeBody,
  safeDisplayName,
  safeInitial,
  type NotificationLike,
} from "@/src/lib/notificationDisplay";

const VIP_BG = "#070C14";
const CARD = "rgba(16,20,29,0.92)";
const BORDER = "rgba(255,255,255,0.10)";
const GOLD = "#D9B35F";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.72)";
const GREEN = "#63D18C";
const RED = "#FF8A8A";
const BLUE = "#7DB7FF";

type Notice = NotificationLike & {
  membershipId?: string;
  id: string;
  title: string;
  body: string;
  createdAt?: string;
  read?: boolean;
  type?: string;
};

type NoticeGroup = {
  key: "today" | "yesterday" | "earlier";
  label: string;
  items: Notice[];
};

function buildDemoNotifications(): Notice[] {
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

  const rows = [
    {
      id: "demo-live-prayer",
      title: "Pastor started live prayer",
      body: "Join the live prayer room now.",
      createdAt: minutesAgo(12),
      read: false,
      type: "LiveStarted",
    },
    {
      id: "demo-media-video",
      title: "TLMC Media uploaded a new video",
      body: "A new worship video is now on the global feed.",
      createdAt: minutesAgo(48),
      read: false,
      type: "MediaUpload",
    },
    {
      id: "demo-ministry-added",
      title: "You were added to Worship ministry",
      body: "Welcome to the Worship team. Check your ministry room for updates.",
      createdAt: hoursAgo(3),
      read: true,
      type: "MinistryAdded",
    },
    {
      id: "demo-testimony-comment",
      title: "Prince commented on your testimony",
      body: "Prince: \"This testimony blessed me. Glory to God.\"",
      createdAt: hoursAgo(8),
      read: false,
      type: "Comment",
    },
    {
      id: "demo-live-soon",
      title: "Live room starts in 10 minutes",
      body: "Sunday service live room opens soon. Tap to enter the waiting room.",
      createdAt: hoursAgo(20),
      read: true,
      type: "LiveReminder",
    },
    {
      id: "demo-schedule-approved",
      title: "Prayer schedule approved",
      body: "Your Friday prayer slot was approved by church media.",
      createdAt: daysAgo(1),
      read: true,
      type: "ScheduleApproved",
    },
    {
      id: "demo-post-likes",
      title: "Your post received 24 likes",
      body: "Members are engaging with your latest testimony post.",
      createdAt: daysAgo(2),
      read: true,
      type: "Engagement",
    },
  ];

  return rows
    .map((row) => ({
      ...row,
      actorName: safeDisplayName(row),
      body: safeBody(row),
    }))
    .sort((a, b) => {
      const aa = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bb - aa;
    });
}

function isDemoNoticeId(id: string) {
  return String(id || "").startsWith("demo-");
}

function groupNotices(items: Notice[]): NoticeGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const today: Notice[] = [];
  const yesterday: Notice[] = [];
  const earlier: Notice[] = [];

  for (const item of items) {
    const ts = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    if (!ts || ts >= startOfToday.getTime()) today.push(item);
    else if (ts >= startOfYesterday.getTime()) yesterday.push(item);
    else earlier.push(item);
  }

  return ([
    { key: "today" as const, label: "Today", items: today },
    { key: "yesterday" as const, label: "Yesterday", items: yesterday },
    { key: "earlier" as const, label: "Earlier", items: earlier },
  ] as NoticeGroup[]).filter((group) => group.items.length > 0);
}

function formatWhen(input?: string) {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;

  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return "Just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 7) return `${day}d ago`;

  return d.toLocaleString();
}

function cardTone(n: Notice): "approved" | "rejected" | "role" | "request" | "default" {
  const t = String(n.type || "");
  const title = String(n.title || "").toLowerCase();

  if (t === "MembershipRejected" || title.includes("rejected")) return "rejected";
  if (title.includes("approved")) return "approved";
  if (title.includes("role updated") || title.includes("leader assigned") || t === "MinistryLeaderAssigned") return "role";
  if (title.includes("request") || title.includes("requested")) return "request";
  return "default";
}

function mapApiNotice(x: any, i: number): Notice {
  const raw: NotificationLike = {
    title: String(x?.title || x?.subject || "Notification"),
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
    membershipId: x?.membershipId || x?.meta?.membershipId,
    id: String(x?.id || `n-${i}`),
    title: String(raw.title || "Notification"),
    body: safeBody(raw),
    createdAt: String(x?.createdAt || x?.date || ""),
    read: !!(x?.readAt || x?.isRead || x?.read),
    type: String(x?.type || ""),
    actorName: safeDisplayName(raw),
    actorUserId: raw.actorUserId,
    actorAvatarUri: raw.actorAvatarUri,
    actorRole: raw.actorRole,
    avatarUri: raw.avatarUri,
    avatarUrl: raw.avatarUrl,
    profileImage: raw.profileImage,
  };
}

export default function MoreNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();

  const auth = getSessionSync() as any;
  const churchId = String(
    auth?.churchId
  );
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

  const effectiveAuthUserId = String(auth?.userId || "");
  const effectiveAuthRole = String(auth?.role || "Member");
  const effectiveDisplayName = String(auth?.displayName || auth?.name || "").trim();

  const getHeaders = () => ({
    accept: "application/json",
    "content-type": "application/json",
    "x-kristo-user-id": effectiveAuthUserId,
    "x-kristo-role": effectiveAuthRole,
    "x-kristo-church-id": churchId,
    ...(effectiveDisplayName
      ? { "x-kristo-user-name": effectiveDisplayName, "x-kristo-display-name": effectiveDisplayName }
      : {}),
  });

  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [openedIds, setOpenedIds] = useState<Record<string, boolean>>({});
  const [usingDemo, setUsingDemo] = useState(false);
  const debouncedRefresh = useRef(createDebouncer(900)).current;

  const canMarkAll =
    effectiveAuthRole === "Pastor" ||
    effectiveAuthRole === "Church_Admin" ||
    effectiveAuthRole === "System_Admin";

  async function load(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setErr(null);

    try {
      if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
      // No church yet is OK here: invites are church-scoped, dev fallback handles testing.
      if (!effectiveAuthUserId) throw new Error("userId missing");

      const r = await fetch(`${base}/api/church/notifications`, {
        headers: getHeaders(),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `Request failed (${r.status})`));
      }

      const raw = Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : [];
      const inviteSafeRaw = raw.filter((x: any) => {
        const title = String(x?.title || x?.subject || "").toLowerCase();
        const body = String(x?.body || x?.message || x?.text || "").toLowerCase();
        const type = String(x?.type || x?.kind || x?.category || "").toLowerCase();
        return !(
          title.includes("invite") ||
          title.includes("invitation") ||
          body.includes("invited") ||
          body.includes("invite") ||
          body.includes("invitation") ||
          type.includes("invite") ||
          type.includes("invitation") ||
          Boolean(x?.membershipId || x?.meta?.membershipId || x?.ministryMemberId)
        );
      });

      const mapped: Notice[] = inviteSafeRaw
        .map((x: any, i: number) => mapApiNotice(x, i))
        .sort((a: Notice, b: Notice) => {
          const aa = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bb - aa;
        });

      if (mapped.length) {
        setUsingDemo(false);
        setItems(mapped);
      } else {
        setUsingDemo(true);
        setItems(buildDemoNotifications());
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function markOneRead(id: string) {
    try {
      if (isDemoNoticeId(id) || usingDemo) {
        setItems((cur) => cur.map((x) => (x.id === id ? { ...x, read: true } : x)));
        return;
      }

      if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
      setBusyId(id);

      const r = await fetch(`${base}/api/church/notifications?id=${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: getHeaders(),
        body: JSON.stringify({ isRead: true }),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `Request failed (${r.status})`));
      }

      setItems((cur) => cur.map((x) => (x.id === id ? { ...x, read: true } : x)));
    } catch (e: any) {
      Alert.alert("Failed", String(e?.message ?? e ?? "Error"));
    } finally {
      setBusyId("");
    }
  }

  async function deleteOne(id: string) {
    try {
      if (isDemoNoticeId(id) || usingDemo) {
        setItems((cur) => cur.filter((x) => x.id !== id));
        setOpenedIds((cur) => {
          const next = { ...cur };
          delete next[id];
          return next;
        });
        return;
      }

      if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
      setDeletingId(id);

      const r = await fetch(`${base}/api/church/notifications?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: getHeaders(),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `Request failed (${r.status})`));
      }

      setItems((cur) => cur.filter((x) => x.id !== id));
      setOpenedIds((cur) => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
    } catch (e: any) {
      Alert.alert("Failed", String(e?.message ?? e ?? "Error"));
    } finally {
      setDeletingId("");
    }
  }

  async function markEverythingRead() {
    try {
      if (usingDemo) {
        setItems((cur) => cur.map((x) => ({ ...x, read: true })));
        return;
      }

      if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
      setMarkingAll(true);

      const r = await fetch(`${base}/api/church/notifications/mark-all`, {
        method: "POST",
        headers: getHeaders(),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `Request failed (${r.status})`));
      }

      setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    } catch (e: any) {
      Alert.alert("Failed", String(e?.message ?? e ?? "Error"));
    } finally {
      setMarkingAll(false);
    }
  }

  const openNotice = useCallback(
    async (n: Notice) => {
      setOpenedIds((cur) => ({ ...cur, [n.id]: !cur[n.id] }));

      if (!n.read && !busyId) {
        try {
          await markOneRead(n.id);
        } catch {}
      }
    },
    [busyId]
  );

  useEffect(() => {
    if (!isFocused) return;
    if (!shouldAllowScreenRefresh("Notifications", { minMs: 60000 })) return;
    load({ silent: !loading });
  }, [isFocused]);

  const unreadCount = useMemo(() => items.filter((x) => !x.read).length, [items]);
  const groupedItems = useMemo(() => groupNotices(items), [items]);

  const renderNoticeCard = (n: Notice) => {
    const tone = cardTone(n);
    const expanded = !!openedIds[n.id];
    const visuallyRead = !!n.read;
    const isGeneric = tone === "default";
    const avatarUri = safeAvatarUri(n);
    const actorName = safeDisplayName(n);
    const actorInitial = safeInitial(n);
    const displayBody = safeBody(n);

    return (
      <Pressable
        key={n.id}
        onPress={() => {
          openNotice(n);
        }}
        style={[
          s.card,
          tone === "approved" && s.cardApproved,
          tone === "rejected" && s.cardRejected,
          tone === "role" && s.cardRole,
          tone === "request" && s.cardRequest,
          !n.read && s.cardUnread,
          n.read && s.cardReadDone,
          expanded && s.cardExpanded,
          expanded && isGeneric && s.cardExpandedGeneric,
        ]}
      >
        <View
          style={[
            s.cardAccent,
            tone === "approved" && s.cardAccentApproved,
            tone === "rejected" && s.cardAccentRejected,
            tone === "role" && s.cardAccentRole,
            tone === "request" && s.cardAccentRequest,
            tone === "default" && !n.read && s.cardAccentUnread,
            n.read && s.cardAccentRead,
            expanded && isGeneric && s.cardAccentExpandedGeneric,
          ]}
        />

        <View style={s.rowTop}>
          <View style={s.titleWrap}>
            <View style={s.avatarWrap}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={s.avatarImage} resizeMode="cover" />
              ) : (
                <Text style={s.avatarText}>{actorInitial}</Text>
              )}
            </View>

            <View style={s.titleTextWrap}>
              {!!actorName ? (
                <Text style={s.actorName} numberOfLines={1}>
                  {actorName}
                </Text>
              ) : null}

              {!n.read ? (
                <Text style={s.cardTitle} numberOfLines={expanded ? 3 : 1}>
                  {n.title}
                </Text>
              ) : (
                <Text style={s.cardTitleRead} numberOfLines={expanded ? 3 : 1}>
                  {n.title}
                </Text>
              )}

              {!!n.createdAt ? <Text style={s.metaTop}>{formatWhen(n.createdAt)}</Text> : null}
            </View>
          </View>

          <View style={s.rightTop}>
            <View style={[s.pill, !visuallyRead ? s.pillGold : s.pillGreen]}>
              <Text style={[s.pillText, !visuallyRead ? s.pillTextGold : s.pillTextGreen]}>
                {!visuallyRead ? "Unread" : "Read"}
              </Text>
            </View>

            <View style={s.chevWrap}>
              <Ionicons
                name={expanded ? "chevron-up" : "chevron-down"}
                size={16}
                color="rgba(255,255,255,0.74)"
              />
            </View>
          </View>
        </View>

        {!!displayBody ? (
          expanded ? (
            <View style={s.bodyPanel}>
              <Text style={s.pExpanded} numberOfLines={20}>
                {displayBody}
              </Text>
            </View>
          ) : (
            <Text style={s.p} numberOfLines={1}>
              {displayBody}
            </Text>
          )
        ) : null}

        {expanded ? (
          <View style={s.actionsWrap}>
            <View style={s.actionsRow}>
              {!n.read ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    markOneRead(n.id);
                  }}
                  disabled={busyId === n.id || deletingId === n.id}
                  style={[s.itemBtn, (busyId === n.id || deletingId === n.id) && s.itemBtnDisabled]}
                >
                  <Text style={s.itemBtnText}>
                    {busyId === n.id ? "Working..." : "Mark read"}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={(e) => {
                  e.stopPropagation();
                  deleteOne(n.id);
                }}
                disabled={deletingId === n.id || busyId === n.id}
                style={[s.deleteBtn, (deletingId === n.id || busyId === n.id) && s.itemBtnDisabled]}
              >
                <Text style={s.deleteBtnText}>
                  {deletingId === n.id ? "Deleting..." : "Delete"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={[s.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.iconBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.h1}>Notifications</Text>
          <Text style={s.h2}>{refreshing ? "Refreshing..." : "Church activity updates"}</Text>
        </View>

        <Pressable onPress={() => debouncedRefresh(() => load({ silent: true }))} style={s.iconBtn} hitSlop={10}>
          <Ionicons name="refresh" size={18} color="white" />
        </Pressable>
      </View>

      {canMarkAll ? (
        <View style={s.utilityRow}>
          <View style={s.utilityCount}>
            <Ionicons name="notifications" size={15} color={GOLD} />
            <Text style={s.utilityCountText}>{unreadCount} unread</Text>


          </View>

          <Pressable
            onPress={markEverythingRead}
            disabled={markingAll || unreadCount === 0}
            style={[s.markAllBtn, (markingAll || unreadCount === 0) && s.markAllBtnDisabled]}
          >
            <Text style={s.markAllBtnText}>{markingAll ? "Working..." : "Mark all"}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.utilityRowSolo}>
          <View style={s.utilityCount}>
            <Ionicons name="notifications" size={15} color={GOLD} />
            <Text style={s.utilityCountText}>{unreadCount} unread</Text>
          </View>
        </View>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={GOLD} />
          <Text style={s.centerText}>Loading notifications...</Text>
        </View>
      ) : err ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Failed to load</Text>
          <Text style={s.errorText}>{err}</Text>

          <Pressable onPress={() => load()} style={[s.btn, s.btnGold]}>
            <Text style={[s.btnText, s.btnTextGold]}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 18 }}>
          {!items.length ? (
            <View style={s.emptyCard}>
              <Ionicons name="notifications-off-outline" size={28} color={GOLD} />
              <Text style={s.emptyTitle}>No notifications yet</Text>
              <Text style={s.emptyText}>Church activity will appear here.</Text>
            </View>
          ) : (
            groupedItems.map((group) => (
              <View key={group.key} style={s.groupSection}>
                <Text style={s.groupLabel}>{group.label}</Text>
                {group.items.map((n) => renderNoticeCard(n))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: VIP_BG, paddingHorizontal: 16 },

  topRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },

  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },

  h1: { color: "white", fontSize: 24, fontWeight: "900" },
  h2: { color: MUTED, marginTop: 1, fontSize: 13, fontWeight: "700" },

  groupSection: {
    marginBottom: 8,
  },

  groupLabel: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 2,
  },

  utilityRow: {
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  utilityRowSolo: {
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },

  utilityCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  utilityCountText: {
    color: TEXT,
    fontSize: 10.8,
    fontWeight: "800",
  },


  markAllBtn: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.12)",
  },

  markAllBtnDisabled: { opacity: 0.5 },

  markAllBtnText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },

  centerText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: "700",
  },

  card: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 20,
    padding: 12,
    paddingLeft: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(14,18,28,0.95)",
  },

  cardUnread: {
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(35,28,14,0.55)",
  },

  cardApproved: {
    borderColor: "rgba(52,211,153,0.35)",
    backgroundColor: "rgba(12,45,32,0.95)",
  },

  cardReadDone: {
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(18,22,30,0.82)",
  },

  cardExpanded: {
    transform: [{ scale: 1.0 }],
  },

  cardExpandedGeneric: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(26,22,14,0.96)",
  },

  cardRejected: {
    borderColor: "rgba(248,113,113,0.35)",
    backgroundColor: "rgba(45,16,16,0.95)",
  },

  cardRole: {
    borderColor: "rgba(96,165,250,0.35)",
    backgroundColor: "rgba(18,30,55,0.95)",
  },

  cardRequest: {
    borderColor: "rgba(245,158,11,0.35)",
    backgroundColor: "rgba(45,32,12,0.92)",
  },

  cardAccent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  cardAccentUnread: { backgroundColor: "rgba(217,179,95,0.85)" },
  cardAccentApproved: { backgroundColor: GREEN },
  cardAccentRejected: { backgroundColor: RED },
  cardAccentRole: { backgroundColor: BLUE },
  cardAccentRequest: { backgroundColor: GOLD },
  cardAccentRead: { backgroundColor: "rgba(255,255,255,0.14)" },
  cardAccentExpandedGeneric: { backgroundColor: GOLD },

  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  titleWrap: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  titleTextWrap: { flex: 1, minWidth: 0, paddingRight: 6 },
  rightTop: { alignItems: "flex-end", justifyContent: "space-between", minHeight: 36, gap: 6 },

  chevWrap: {
    width: 26,
    height: 26,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginTop: 1,
  },

  avatarWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.04)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    overflow: "hidden",
  },

  avatarImage: {
    width: 34,
    height: 34,
    borderRadius: 999,
  },

  avatarText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },

  actorName: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 2,
  },

  cardTitle: { flex: 1, color: "white", fontSize: 15, fontWeight: "900", lineHeight: 20 },
  cardTitleRead: { flex: 1, color: "rgba(255,255,255,0.84)", fontSize: 15, fontWeight: "800", lineHeight: 20 },
  p: { color: MUTED, fontSize: 14, lineHeight: 21, marginTop: 6 },
  pExpanded: { color: "rgba(255,255,255,0.82)", fontSize: 13.5, lineHeight: 22 },
  metaTop: { color: "rgba(255,255,255,0.52)", marginTop: 5, fontSize: 11, fontWeight: "800" },

  bodyPanel: {
    marginTop: 6,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  actionsWrap: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },

  actionsRow: {
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  itemBtn: {
    alignSelf: "flex-start",
    borderRadius: 11,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.14)",
    minWidth: 88,
  },

  itemBtnText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },

  deleteBtn: {
    alignSelf: "flex-start",
    borderRadius: 11,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "rgba(255,138,138,0.28)",
    backgroundColor: "rgba(255,138,138,0.10)",
    minWidth: 82,
  },

  deleteBtnText: {
    color: "#FFC1C1",
    fontSize: 12,
    fontWeight: "900",
  },

  itemBtnDisabled: { opacity: 0.6 },

  pill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
  },

  pillGold: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.25)",
  },

  pillGreen: {
    backgroundColor: "rgba(99,209,140,0.14)",
    borderColor: "rgba(99,209,140,0.26)",
  },

  pillText: {
    fontSize: 11,
    fontWeight: "900",
  },

  pillTextGold: { color: GOLD },
  pillTextGreen: { color: GREEN },

  emptyCard: {
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: CARD,
    alignItems: "center",
  },

  emptyTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
    marginTop: 6,
  },

  emptyText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    textAlign: "center",
  },

  errorCard: {
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.18)",
    backgroundColor: "rgba(45,16,16,0.82)",
  },

  errorTitle: {
    color: "white",
    fontSize: 15,
    fontWeight: "900",
  },

  errorText: {
    color: "rgba(255,255,255,0.80)",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
  },

  btn: {
    marginTop: 14,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  btnGold: {
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.14)",
  },

  btnText: {
    fontSize: 13,
    fontWeight: "900",
  },

  btnTextGold: {
    color: GOLD,
  },
});
