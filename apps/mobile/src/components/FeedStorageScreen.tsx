import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { feedList, feedRemoveWhere } from "@/src/lib/homeFeedStore";
import { evaluateChurchMediaAccessClient } from "@/src/lib/churchMediaAccess";
import {
  activityIsVideo,
  formatActivityWhen,
} from "@/src/lib/churchActivityPosts";
import {
  canDeleteStoragePosts,
  getStoragePostAuthor,
  getStoragePostThumbnail,
  getStoragePostTitle,
  getStoragePostTypeBadge,
  mergeStorageSourceRows,
  type StorageMode,
  type StoragePostLabel,
} from "@/src/lib/churchStoragePosts";

type FeedStorageItem = {
  id: string;
  title?: string;
  text?: string;
  body?: string;
  type?: string;
  source?: string;
  mediaName?: string;
  actorLabel?: string;
  authorName?: string;
  authorAvatarUri?: string;
  createdAt?: string;
  ownershipType?: string;
  churchName?: string;
  mediaType?: string;
  videoUrl?: string;
  mediaUri?: string;
  imageUrl?: string;
};

function badgeTone(label: StoragePostLabel) {
  switch (label) {
    case "VIDEO":
      return { bg: "rgba(125,211,252,0.14)", color: "#7DD3FC" };
    case "IMAGE":
      return { bg: "rgba(244,201,93,0.14)", color: "#F4C95D" };
    case "MEDIA":
      return { bg: "rgba(167,139,250,0.14)", color: "#C4B5FD" };
    case "TESTIMONY":
      return { bg: "rgba(244,201,93,0.16)", color: "#F3D28F" };
    case "ANNOUNCEMENT":
      return { bg: "rgba(255,255,255,0.10)", color: "#FFFFFF" };
    default:
      return { bg: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.88)" };
  }
}

function StoragePostCard({
  item,
  mode,
  canDelete,
  deleting,
  onDelete,
}: {
  item: FeedStorageItem;
  mode: StorageMode;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const author = getStoragePostAuthor(item);
  const thumbnailUri = getStoragePostThumbnail(item);
  const title = getStoragePostTitle(item);
  const typeBadge = getStoragePostTypeBadge(item, mode);
  const whenLabel = formatActivityWhen(item.createdAt);
  const isVideo = activityIsVideo(item);
  const tone = badgeTone(typeBadge);
  const authorInitial =
    String(author.name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  return (
    <View style={s.card}>
      <View style={s.thumbWrap}>
        {thumbnailUri ? (
          <>
            <Image source={{ uri: thumbnailUri }} style={s.thumbImage} resizeMode="cover" />
            {isVideo ? (
              <View style={s.videoOverlay}>
                <Ionicons name="play" size={18} color="#FFFFFF" />
              </View>
            ) : null}
          </>
        ) : (
          <LinearGradient
            colors={["#141A28", "#0A0F18", "#05070D"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          >
            <View style={s.thumbPlaceholder}>
              <Ionicons
                name={isVideo ? "videocam-outline" : "document-text-outline"}
                size={22}
                color="rgba(244,201,93,0.72)"
              />
            </View>
          </LinearGradient>
        )}
      </View>

      <View style={s.cardBody}>
        <View style={s.authorRow}>
          <View style={s.authorAvatarRing}>
            {author.avatarUri ? (
              <Image source={{ uri: author.avatarUri }} style={s.authorAvatar} resizeMode="cover" />
            ) : (
              <LinearGradient
                colors={["#FFE08A", "#C8943A", "#7A5218"]}
                style={s.authorAvatarFallback}
              >
                <Text style={s.authorAvatarInitial}>{authorInitial}</Text>
              </LinearGradient>
            )}
          </View>
          <View style={s.authorMeta}>
            <Text style={s.authorName} numberOfLines={1}>
              {author.name}
            </Text>
            <Text style={s.authorRole} numberOfLines={1}>
              {author.role}
            </Text>
          </View>
          <View style={[s.typeBadge, { backgroundColor: tone.bg }]}>
            <Text style={[s.typeBadgeText, { color: tone.color }]}>{typeBadge}</Text>
          </View>
        </View>

        <Text style={s.cardTitle} numberOfLines={2}>
          {title}
        </Text>

        <View style={s.cardFooter}>
          <Text style={s.whenLabel} numberOfLines={1}>
            {whenLabel || "—"}
          </Text>
          {item.churchName ? (
            <Text style={s.churchLabel} numberOfLines={1}>
              {item.churchName}
            </Text>
          ) : null}
        </View>
      </View>

      {canDelete ? (
        <Pressable
          onPress={onDelete}
          disabled={deleting}
          style={({ pressed }) => [
            s.deleteBtn,
            deleting ? s.deleteBtnBusy : null,
            pressed ? s.pressed : null,
          ]}
        >
          <BlurView intensity={28} tint="dark" style={s.deleteBlur}>
            {deleting ? (
              <ActivityIndicator size="small" color="#FFB4B4" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={16} color="#FFB4B4" />
                <Text style={s.deleteText}>Delete</Text>
              </>
            )}
          </BlurView>
        </Pressable>
      ) : null}
    </View>
  );
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
  const [isMediaHost, setIsMediaHost] = useState(false);

  const churchId = String(session?.churchId || "").trim();

  const mediaAccess = useMemo(
    () =>
      evaluateChurchMediaAccessClient({
        userId: session?.userId,
        isMediaHost,
      }),
    [session?.userId, isMediaHost]
  );

  const canDelete = canDeleteStoragePosts(mode, session, mediaAccess.isMediaHost);

  useEffect(() => {
    let alive = true;

    if (!session?.userId || !churchId) {
      setIsMediaHost(false);
      return () => {
        alive = false;
      };
    }

    void apiGet("/api/church/media-hosts", {
      headers: getKristoHeaders({
        userId: session.userId,
        role: (session.role || "Member") as any,
        churchId,
      }),
    })
      .then((res: any) => {
        if (!alive) return;
        const access = evaluateChurchMediaAccessClient({
          userId: session.userId,
          actualPastorUserId: res?.actualPastorUserId,
          mediaHostUserIds: res?.mediaHostUserIds,
          isActualChurchPastor: res?.isActualChurchPastor,
          isMediaHost: res?.isMediaHost ?? res?.viewerIsHost,
        });
        setIsMediaHost(access.isMediaHost || access.isActualChurchPastor);
      })
      .catch(() => {
        if (alive) setIsMediaHost(false);
      });

    return () => {
      alive = false;
    };
  }, [churchId, session?.role, session?.userId]);

  const loadRows = useCallback(async () => {
    if (!session?.userId || !churchId) {
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
          churchId,
        }),
      });

      const apiList = Array.isArray(res?.data) ? res.data : [];
      const supplemental =
        mode === "media"
          ? feedList().filter((item: any) => String(item?.churchId || "").trim() === churchId)
          : [];

      const filtered = mergeStorageSourceRows(apiList, supplemental, mode, churchId);
      setRows(filtered);

      if (__DEV__) {
        console.log("KRISTO_STORAGE_LOAD", {
          storageType: mode,
          apiCount: apiList.length,
          supplementalCount: supplemental.length,
          filteredCount: filtered.length,
        });
      }
    } catch (e) {
      console.log("KRISTO_FEED_STORAGE_LOAD_ERROR", mode, e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [churchId, mode, session?.role, session?.userId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRows();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadRows]);

  async function handleDelete(item: FeedStorageItem) {
    if (!session?.userId || !churchId || deletingId || !canDelete) return;

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
                    churchId,
                  }),
                }
              );

              if (!res?.ok) {
                Alert.alert("Delete failed", String(res?.error || "Could not delete post."));
                return;
              }

              if (__DEV__) {
                console.log("KRISTO_STORAGE_DELETE_POST", {
                  postId: item.id,
                  storageType: mode,
                });
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
          <View style={s.titleRow}>
            <Text style={s.title}>{title}</Text>
            {!loading ? <Text style={s.countBadge}>{rows.length}</Text> : null}
          </View>
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
              <Text style={s.emptyText}>
                {mode === "media"
                  ? "Church media posts and videos will appear here for review."
                  : "Church-owned posts from members will appear here for review."}
              </Text>
            </View>
          ) : (
            rows.map((item) => (
              <StoragePostCard
                key={item.id}
                item={item}
                mode={mode}
                canDelete={canDelete}
                deleting={deletingId === item.id}
                onDelete={() => void handleDelete(item)}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const THUMB_SIZE = 88;

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
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  countBadge: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    textAlign: "center",
    color: "#F4C95D",
    fontSize: 13,
    fontWeight: "900",
    backgroundColor: "rgba(244,201,93,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.22)",
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
  card: {
    borderRadius: 22,
    padding: 12,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.12)",
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  thumbPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 6,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  authorAvatarRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    padding: 2,
    backgroundColor: "rgba(244,201,93,0.22)",
  },
  authorAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  authorAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  authorAvatarInitial: {
    color: "#1A1205",
    fontSize: 12,
    fontWeight: "900",
  },
  authorMeta: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  authorRole: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },
  cardFooter: {
    gap: 2,
  },
  whenLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
  },
  churchLabel: {
    color: "rgba(244,201,93,0.72)",
    fontSize: 10,
    fontWeight: "700",
  },
  deleteBtn: {
    alignSelf: "center",
    borderRadius: 14,
    overflow: "hidden",
  },
  deleteBlur: {
    minWidth: 72,
    minHeight: 72,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,80,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.28)",
    borderRadius: 14,
  },
  deleteBtnBusy: {
    opacity: 0.7,
  },
  deleteText: {
    color: "#FFB4B4",
    fontSize: 11,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.88,
  },
});
