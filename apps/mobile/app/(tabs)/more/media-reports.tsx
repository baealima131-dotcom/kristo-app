import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { evaluateChurchMediaAccessFromSession } from "@/src/lib/churchMediaAccess";
import { homeFeedMediaUrl } from "@/src/components/homeFeed/homeFeedUtils";
import { feedRemoveWhere } from "@/src/lib/homeFeedStore";
import { syncHomeFeedPostDelete } from "@/src/lib/homeFeedPostDeleteSync";
import {
  deleteMediaReportPost,
  dismissMediaReport,
  fetchMediaReports,
  type MediaReportQueueRow,
} from "@/src/lib/mediaReportsApi";

function formatReportWhen(value: string) {
  const stamp = String(value || "").trim();
  if (!stamp) return "";
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return stamp;
  return date.toLocaleString();
}

function ReportCard({
  item,
  busy,
  onDismiss,
  onDelete,
}: {
  item: MediaReportQueueRow;
  busy: boolean;
  onDismiss: (item: MediaReportQueueRow) => void;
  onDelete: (item: MediaReportQueueRow) => void;
}) {
  const posterUri = homeFeedMediaUrl(item.posterUri || "");
  const reasonLine = item.topReasons.length
    ? item.topReasons.join(" · ")
    : item.reports[0]?.reason || "Reported";

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        {posterUri ? (
          <Image source={{ uri: posterUri }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterFallback]}>
            <Ionicons name="videocam-outline" size={24} color="rgba(255,255,255,0.55)" />
          </View>
        )}

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title || "Reported post"}
          </Text>
          <Text style={styles.cardMeta}>
            {item.uniqueReporterCount} member{item.uniqueReporterCount === 1 ? "" : "s"} ·{" "}
            {item.pendingReportCount} report{item.pendingReportCount === 1 ? "" : "s"}
          </Text>
          <Text style={styles.cardReason} numberOfLines={2}>
            {reasonLine}
          </Text>
          {item.latestReportAt ? (
            <Text style={styles.cardWhen}>{formatReportWhen(item.latestReportAt)}</Text>
          ) : null}
          {item.hiddenByReports ? (
            <View style={styles.hiddenBadge}>
              <Text style={styles.hiddenBadgeText}>Hidden from feed</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.actionsRow}>
        <Pressable
          disabled={busy}
          onPress={() => onDismiss(item)}
          style={({ pressed }) => [styles.actionBtn, styles.keepBtn, pressed ? styles.pressed : null]}
        >
          <Text style={styles.keepBtnText}>Keep video</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => onDelete(item)}
          style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed ? styles.pressed : null]}
        >
          <Text style={styles.deleteBtnText}>Delete video</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function MediaReportsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const churchId = String(session?.churchId || "").trim();
  const userId = String(session?.userId || "").trim();
  const role = String(session?.role || "Member");

  const access = useMemo(
    () =>
      evaluateChurchMediaAccessFromSession({
        userId,
        role,
        churchRole: (session as any)?.churchRole,
      }),
    [userId, role, (session as any)?.churchRole]
  );

  const [rows, setRows] = useState<MediaReportQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyPostId, setBusyPostId] = useState("");

  const canReview = access.canOpenMediaScreen;

  const loadRows = useCallback(async () => {
    if (!canReview || !userId || !churchId) {
      setRows([]);
      setLoading(false);
      return;
    }

    try {
      const items = await fetchMediaReports({ userId, role, churchId });
      setRows(items);
    } catch (error) {
      console.log("KRISTO_MEDIA_REPORTS_LOAD_ERROR", {
        churchId,
        message: String((error as Error)?.message || error),
      });
      Alert.alert("Reports", "Could not load flagged posts. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canReview, userId, churchId, role]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const handleDismiss = useCallback(
    (item: MediaReportQueueRow) => {
      if (!userId || !churchId || busyPostId) return;

      Alert.alert(
        "Keep this video?",
        "Dismiss these reports and keep the video visible in the feed.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Keep video",
            onPress: async () => {
              setBusyPostId(item.postId);
              try {
                await dismissMediaReport({
                  userId,
                  role,
                  churchId,
                  postId: item.postId,
                });
                setRows((prev) => prev.filter((row) => row.postId !== item.postId));
              } catch (error) {
                Alert.alert("Keep failed", String((error as Error)?.message || error));
              } finally {
                setBusyPostId("");
              }
            },
          },
        ]
      );
    },
    [busyPostId, churchId, role, userId]
  );

  const handleDelete = useCallback(
    (item: MediaReportQueueRow) => {
      if (!userId || !churchId || busyPostId) return;

      Alert.alert(
        "Delete this video?",
        "This removes the post from Home Feed and storage.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setBusyPostId(item.postId);
              try {
                await deleteMediaReportPost({
                  userId,
                  role,
                  churchId,
                  postId: item.postId,
                });
                feedRemoveWhere((row) => String(row.id || "") === String(item.postId));
                await syncHomeFeedPostDelete({
                  postId: item.postId,
                  storageDeleted: true,
                  feedDeleted: true,
                });
                setRows((prev) => prev.filter((row) => row.postId !== item.postId));
              } catch (error) {
                Alert.alert("Delete failed", String((error as Error)?.message || error));
              } finally {
                setBusyPostId("");
              }
            },
          },
        ]
      );
    },
    [busyPostId, churchId, role, userId]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.subtitle}>Review flagged posts from your church</Text>
        </View>
      </View>

      {!canReview ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Pastor or trusted host access required</Text>
          <Text style={styles.emptyBody}>
            Only your church pastor or trusted media hosts can review flagged posts.
          </Text>
        </View>
      ) : loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#F4C95D" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.postId}
          contentContainerStyle={rows.length ? styles.listContent : styles.listContentEmpty}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#F4C95D"
              onRefresh={() => {
                setRefreshing(true);
                void loadRows();
              }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>No flagged posts</Text>
              <Text style={styles.emptyBody}>
                When members report a video, it will appear here for review.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ReportCard
              item={item}
              busy={busyPostId === item.postId}
              onDismiss={handleDismiss}
              onDelete={handleDelete}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0B1220",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 14,
  },
  listContentEmpty: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyBody: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardTop: {
    flexDirection: "row",
    gap: 12,
  },
  poster: {
    width: 88,
    height: 88,
    borderRadius: 12,
    backgroundColor: "#111827",
  },
  posterFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  cardMeta: {
    color: "#FCA5A5",
    fontSize: 13,
    fontWeight: "600",
  },
  cardReason: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    lineHeight: 18,
  },
  cardWhen: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
  },
  hiddenBadge: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(252,165,165,0.14)",
  },
  hiddenBadgeText: {
    color: "#FCA5A5",
    fontSize: 11,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  keepBtn: {
    backgroundColor: "rgba(244,201,93,0.14)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.28)",
  },
  keepBtnText: {
    color: "#F4C95D",
    fontSize: 14,
    fontWeight: "700",
  },
  deleteBtn: {
    backgroundColor: "rgba(239,68,68,0.14)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.28)",
  },
  deleteBtnText: {
    color: "#FCA5A5",
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.82,
  },
});
