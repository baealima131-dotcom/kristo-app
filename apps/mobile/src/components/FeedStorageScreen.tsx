import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { feedRemoveWhere } from "@/src/lib/homeFeedStore";

type StorageMode = "media" | "church";

type FeedStorageItem = {
  id: string;
  title?: string;
  text?: string;
  type?: string;
  source?: string;
  mediaName?: string;
  actorLabel?: string;
  authorName?: string;
  createdAt?: string;
  ownershipType?: string;
};

function formatWhen(createdAt?: string) {
  const t = new Date(String(createdAt || "")).getTime();
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleString();
}

function itemLabel(item: FeedStorageItem) {
  return String(item.title || item.text || item.mediaName || item.actorLabel || "Untitled post").trim();
}

function itemMeta(item: FeedStorageItem) {
  const parts = [
    String(item.type || "post").toUpperCase(),
    String(item.source || "").trim(),
    String(item.ownershipType || "").trim(),
  ].filter(Boolean);
  return parts.join(" • ");
}

export default function FeedStorageScreen({
  mode,
  title,
  subtitle,
}: {
  mode: StorageMode;
  title: string;
  subtitle: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FeedStorageItem[]>([]);
  const [deletingId, setDeletingId] = useState("");

  const loadRows = useCallback(async () => {
    if (!session?.userId || !session?.churchId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const res: any = await apiGet(`/api/church/feed?storage=${mode}`, {
        headers: getKristoHeaders({
          userId: session.userId,
          role: (session.role || "Member") as any,
          churchId: session.churchId || "",
        }),
      });

      const list = Array.isArray(res?.data) ? res.data : [];
      setRows(list);
    } catch (e) {
      console.log("KRISTO_FEED_STORAGE_LOAD_ERROR", mode, e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [mode, session?.churchId, session?.role, session?.userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRows();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadRows]);

  async function handleDelete(item: FeedStorageItem) {
    if (!session?.userId || !session?.churchId || deletingId) return;

    Alert.alert(
      "Delete post?",
      "This removes the post from Home Feed and storage. The user profile is not deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeletingId(item.id);
            try {
              const res: any = await apiPost(
                "/api/church/feed",
                { action: "delete_post", postId: item.id },
                {
                  headers: getKristoHeaders({
                    userId: session.userId,
                    role: (session.role || "Member") as any,
                    churchId: session.churchId || "",
                  }),
                }
              );

              if (!res?.ok) {
                Alert.alert("Delete failed", String(res?.error || "Could not delete post."));
                return;
              }

              feedRemoveWhere((row) => String(row.id || "") === String(item.id));
              setRows((prev) => prev.filter((row) => row.id !== item.id));
            } catch (e) {
              console.log("KRISTO_FEED_STORAGE_DELETE_ERROR", e);
              Alert.alert("Delete failed", "Could not delete post.");
            } finally {
              setDeletingId("");
            }
          },
        },
      ]
    );
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed ? s.pressed : null]}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#F4C95D" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 28 }]}
        >
          {!rows.length ? (
            <View style={s.emptyCard}>
              <Ionicons name="folder-open-outline" size={28} color="#F4C95D" />
              <Text style={s.emptyTitle}>No posts yet</Text>
              <Text style={s.emptyText}>Posts managed here will appear in this list.</Text>
            </View>
          ) : (
            rows.map((item) => (
              <View key={item.id} style={s.rowCard}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle} numberOfLines={2}>
                    {itemLabel(item)}
                  </Text>
                  <Text style={s.rowMeta} numberOfLines={1}>
                    {itemMeta(item)}
                  </Text>
                  <Text style={s.rowMeta}>
                    {String(item.authorName || "Member")} • {formatWhen(item.createdAt)}
                  </Text>
                </View>

                <Pressable
                  onPress={() => void handleDelete(item)}
                  disabled={deletingId === item.id}
                  style={({ pressed }) => [
                    s.deleteBtn,
                    deletingId === item.id ? s.deleteBtnBusy : null,
                    pressed ? s.pressed : null,
                  ]}
                >
                  {deletingId === item.id ? (
                    <ActivityIndicator size="small" color="#FFB4B4" />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={16} color="#FFB4B4" />
                      <Text style={s.deleteText}>Delete</Text>
                    </>
                  )}
                </Pressable>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0B0F17",
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 4,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyCard: {
    marginTop: 24,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  emptyTitle: {
    marginTop: 12,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyText: {
    marginTop: 6,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
  },
  rowCard: {
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  rowTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 21,
  },
  rowMeta: {
    marginTop: 4,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "700",
  },
  deleteBtn: {
    minWidth: 84,
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(255,120,120,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.28)",
  },
  deleteBtnBusy: {
    opacity: 0.7,
  },
  deleteText: {
    color: "#FFB4B4",
    fontSize: 12,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.88,
  },
});
