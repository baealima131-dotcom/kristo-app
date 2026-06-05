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
  Modal,
  useWindowDimensions,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView, useVideoPlayer } from "expo-video";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { feedList, feedRemoveWhere } from "@/src/lib/homeFeedStore";
import { evaluateChurchMediaAccessFromSession } from "@/src/lib/churchMediaAccess";
import {
  activityIsVideo,
  formatActivityWhen,
} from "@/src/lib/churchActivityPosts";
import { isBrandedPosterUri } from "@/src/lib/brandedVideoPoster";
import { FeedVideoPosterImage } from "@/src/components/homeFeed/VideoPostFallbackPoster";
import {
  canDeleteStoragePosts,
  canPreviewStoragePost,
  getStoragePostAuthor,
  getStoragePostThumbnail,
  getStoragePostTitle,
  getStoragePostTypeBadge,
  getStoragePreviewImageUri,
  getStoragePreviewVideoUri,
  mergeStorageSourceRows,
  type StorageMode,
  type StoragePostLabel,
} from "@/src/lib/churchStoragePosts";
import { mediaStatusLabel, normalizeMediaStatus } from "@/src/lib/mediaStatus";
import {
  listActiveMediaUploadJobs,
  listMediaUploadJobs,
  subscribeMediaUploadJobs,
  type PersistedMediaUploadJob,
} from "@/src/lib/mediaUploadJobStore";
import {
  isMultipartBackendNotDeployedJob,
  markMediaUploadJobReady,
  MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE,
  resumePausedMediaUploadJobs,
  retryMediaUploadJob,
} from "@/src/lib/optimisticVideoUpload";
import { startKristoNetworkMonitor } from "@/src/lib/networkMonitor";

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
  mediaStatus?: string;
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

function StorageVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    player.play();
    return () => {
      player.pause();
    };
  }, [player, uri]);

  return (
    <VideoView
      player={player}
      style={previewStyles.videoPlayer}
      contentFit="contain"
      nativeControls
    />
  );
}

function StorageMediaPreviewModal({
  visible,
  item,
  onClose,
}: {
  visible: boolean;
  item: FeedStorageItem | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  if (!item) return null;

  const isVideo = activityIsVideo(item);
  const videoUri = getStoragePreviewVideoUri(item);
  const imageUri = getStoragePreviewImageUri(item);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={previewStyles.backdrop}>
        <Pressable
          onPress={onClose}
          style={[previewStyles.closeBtn, { top: insets.top + 12 }]}
          hitSlop={12}
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>

        <View style={[previewStyles.content, { maxHeight: height - insets.top - insets.bottom - 80 }]}>
          {isVideo && videoUri ? (
            <StorageVideoPreview uri={videoUri} />
          ) : imageUri && !isBrandedPosterUri(imageUri) ? (
            <Image source={{ uri: imageUri }} style={previewStyles.image} resizeMode="contain" />
          ) : (
            <View style={previewStyles.emptyPreview}>
              <Ionicons name="image-outline" size={36} color="rgba(255,255,255,0.55)" />
              <Text style={previewStyles.emptyPreviewText}>Preview unavailable</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function StoragePostCard({
  item,
  mode,
  canDelete,
  deleting,
  onDelete,
  onPreview,
}: {
  item: FeedStorageItem;
  mode: StorageMode;
  canDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  onPreview: () => void;
}) {
  const author = getStoragePostAuthor(item);
  const thumbnailUri = getStoragePostThumbnail(item);
  const title = getStoragePostTitle(item, mode);
  const typeBadge = getStoragePostTypeBadge(item, mode);
  const whenLabel = formatActivityWhen(item.createdAt);
  const isVideo = activityIsVideo(item);
  const mediaStatus = normalizeMediaStatus(item.mediaStatus);
  const statusLabel =
    mediaStatus && mediaStatus !== "ready" ? mediaStatusLabel(mediaStatus) : "";
  const tone = badgeTone(typeBadge);
  const canPreview = canPreviewStoragePost(item);
  const authorInitial =
    String(author.name || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";
  const churchLabel = String(item.churchName || "").trim();

  return (
    <View style={s.card}>
      {canDelete ? (
        <Pressable
          onPress={onDelete}
          disabled={deleting}
          accessibilityLabel="Delete post"
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
              <Ionicons name="trash-outline" size={18} color="#FFB4B4" />
            )}
          </BlurView>
        </Pressable>
      ) : null}

      <View style={s.cardMainRow}>
        <Pressable
          onPress={canPreview ? onPreview : undefined}
          disabled={!canPreview}
          style={({ pressed }) => [s.thumbWrap, pressed && canPreview ? s.pressed : null]}
        >
          {thumbnailUri && !isBrandedPosterUri(thumbnailUri) ? (
            <>
              <FeedVideoPosterImage
                uri={thumbnailUri}
                style={s.thumbImage}
                resizeMode="cover"
                title={title}
                videoUrl={isVideo ? getStoragePreviewVideoUri(item) : ""}
                mediaStatus={mediaStatus}
              />
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
                {isVideo && canPreview ? (
                  <View style={s.playHint}>
                    <Ionicons name="play" size={12} color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
            </LinearGradient>
          )}
        </Pressable>

        <View style={[s.cardContent, canDelete ? s.cardContentWithDelete : null]}>
          <Text style={s.cardTitle} numberOfLines={2}>
            {title}
          </Text>

          <View style={s.metaRow}>
            <View style={[s.typeBadge, { backgroundColor: tone.bg }]}>
              <Text style={[s.typeBadgeText, { color: tone.color }]}>{typeBadge}</Text>
            </View>
            {statusLabel ? (
              <View style={s.processingBadge}>
                {mediaStatus === "processing" ? (
                  <ActivityIndicator size="small" color="#F4C95D" style={s.processingSpinner} />
                ) : null}
                <Text style={s.processingBadgeText}>{statusLabel}</Text>
              </View>
            ) : null}
            <Text style={s.whenLabel} numberOfLines={1}>
              {whenLabel || "—"}
            </Text>
          </View>

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
              {author.role ? (
                <Text style={s.authorRole} numberOfLines={1}>
                  {author.role}
                </Text>
              ) : null}
            </View>
          </View>

          {churchLabel ? (
            <Text style={s.churchLabel} numberOfLines={1}>
              {churchLabel}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function MediaUploadJobCard({
  job,
  onRetry,
}: {
  job: PersistedMediaUploadJob;
  onRetry: () => void;
}) {
  const phase = job.phase;
  const multipartBlocked = isMultipartBackendNotDeployedJob(job);
  const progress =
    phase === "processing" || phase === "ready"
      ? 100
      : Math.max(0, Math.min(100, Math.round(job.uploadProgress || 0)));

  const statusLabel =
    phase === "uploading"
      ? `Uploading ${progress}%`
      : phase === "paused"
        ? `Paused at ${Math.round(job.pausedAtProgress ?? progress)}%`
        : phase === "processing"
          ? "Processing..."
          : phase === "ready"
            ? "Ready"
            : phase === "failed"
              ? "Failed"
              : "Uploading";

  const showProgressTrack = phase === "uploading" || phase === "paused";
  const showSpinner =
    phase === "uploading" || phase === "processing" || (phase === "paused" && !multipartBlocked);

  return (
    <View style={s.uploadJobCard}>
      <View style={s.uploadJobHeader}>
        {showSpinner ? <ActivityIndicator size="small" color="#F4C95D" /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.uploadJobTitle} numberOfLines={2}>
            {job.title}
          </Text>
          {job.caption ? (
            <Text style={s.uploadJobCaption} numberOfLines={2}>
              {job.caption}
            </Text>
          ) : null}
        </View>
        <View style={s.uploadJobStatusBadge}>
          <Text style={s.uploadJobStatusText}>{statusLabel}</Text>
        </View>
      </View>

      {showProgressTrack ? (
        <View style={s.uploadJobProgressTrack}>
          <View style={[s.uploadJobProgressFill, { width: `${progress}%` }]} />
        </View>
      ) : null}

      {phase === "paused" ? (
        <Text style={s.uploadJobHint}>
          {multipartBlocked
            ? "Resumable upload is waiting for the server update. Retry is disabled until multipart upload routes are deployed."
            : job.resumableMode === "chunk"
              ? "Connection lost. Upload will resume from the last completed chunk when you are back online."
              : "Connection lost. Retry will restart the file until chunk upload is fully enabled."}
        </Text>
      ) : null}

      {phase === "processing" ? (
        <Text style={s.uploadJobHint}>
          Video saved to Media Storage. Home Feed will show it when mediaStatus is ready.
        </Text>
      ) : null}

      {phase === "ready" ? (
        <Text style={s.uploadJobHint}>Ready for Home Feed.</Text>
      ) : null}

      {job.error && (phase === "paused" || phase === "failed") ? (
        <Text style={s.uploadJobError} numberOfLines={3}>
          {job.error}
        </Text>
      ) : null}

      {phase === "paused" || phase === "failed" ? (
        <Pressable
          onPress={() => {
            if (multipartBlocked) {
              Alert.alert(
                "Upload not available yet",
                `${MULTIPART_BACKEND_NOT_DEPLOYED_MESSAGE} Deploy the multipart upload routes on the server, then tap Retry again.`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Retry now", onPress: onRetry },
                ]
              );
              return;
            }
            onRetry();
          }}
          style={({ pressed }) => [
            s.uploadJobRetryBtn,
            multipartBlocked ? s.uploadJobRetryBtnDisabled : null,
            !multipartBlocked && pressed ? s.pressed : null,
          ]}
        >
          <Ionicons name="refresh-outline" size={16} color={multipartBlocked ? "#64748B" : "#07111F"} />
          <Text style={[s.uploadJobRetryText, multipartBlocked ? s.uploadJobRetryTextDisabled : null]}>
            {multipartBlocked ? "Waiting for server" : phase === "paused" ? "Retry now" : "Try again"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function parseStorageDeleteResponse(res: any, postId: string) {
  const payload = res?.data && typeof res.data === "object" ? res.data : res;
  const deletedId = String(payload?.postId || res?.postId || postId || "").trim();
  const deleted =
    res?.ok !== false &&
    !res?.error &&
    (payload?.deleted === true || res?.deleted === true);

  return {
    deleted,
    deletedId,
    status: Number(res?.status || 0),
    error: String(res?.error || "").trim(),
    payload,
  };
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
  const [previewItem, setPreviewItem] = useState<FeedStorageItem | null>(null);
  const [uploadJobs, setUploadJobs] = useState<PersistedMediaUploadJob[]>([]);

  const churchId = String(session?.churchId || "").trim();

  const mediaAccess = useMemo(
    () =>
      evaluateChurchMediaAccessFromSession({
        userId: session?.userId,
        role: session?.role,
        churchRole: (session as any)?.churchRole,
      }),
    [session?.userId, session?.role, (session as any)?.churchRole, isMediaHost]
  );

  const canDelete = canDeleteStoragePosts(mode, session, mediaAccess.isMediaHost);

  const refreshUploadJobs = useCallback(async () => {
    if (!churchId) {
      setUploadJobs([]);
      return;
    }
    const jobs = await listMediaUploadJobs(churchId);
    setUploadJobs(listActiveMediaUploadJobs(jobs));
  }, [churchId]);

  useEffect(() => {
    startKristoNetworkMonitor();
    void refreshUploadJobs();
    void resumePausedMediaUploadJobs("media-storage-mount");

    return subscribeMediaUploadJobs(() => {
      void refreshUploadJobs();
    });
  }, [refreshUploadJobs]);

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
        const access = evaluateChurchMediaAccessFromSession(
          {
            userId: session.userId,
            role: session.role,
            churchRole: (session as any)?.churchRole,
          },
          res
        );
        setIsMediaHost(access.isMediaHost || access.isActualChurchPastor);
      })
      .catch(() => {
        if (!alive) return;
        const fallback = evaluateChurchMediaAccessFromSession({
          userId: session.userId,
          role: session.role,
          churchRole: (session as any)?.churchRole,
        });
        setIsMediaHost(fallback.isMediaHost || fallback.isActualChurchPastor);
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

      if (mode === "media") {
        const jobs = await listMediaUploadJobs(churchId);
        for (const job of jobs) {
          if (!job.backendFeedId || job.phase === "ready") continue;
          const backendRow = filtered.find((row: any) => String(row?.id || "") === job.backendFeedId);
          const backendStatus = normalizeMediaStatus(backendRow?.mediaStatus);
          if (backendStatus === "ready") {
            await markMediaUploadJobReady(job.jobId, "ready");
          }
        }
      }

      const activeJobs = listActiveMediaUploadJobs(await listMediaUploadJobs(churchId));
      const activeBackendIds = new Set(
        activeJobs.map((job) => String(job.backendFeedId || "").trim()).filter(Boolean)
      );

      const visibleRows = filtered.filter((row: any) => {
        const id = String(row?.id || "").trim();
        if (!id) return true;
        if (!activeBackendIds.has(id)) return true;
        const status = normalizeMediaStatus(row?.mediaStatus);
        return status === "ready";
      });

      setUploadJobs(activeJobs);
      setRows(visibleRows);

      const processingCount = visibleRows.filter(
        (item: any) => normalizeMediaStatus(item?.mediaStatus) === "processing"
      ).length;

      if (__DEV__) {
        console.log("KRISTO_STORAGE_LOAD", {
          storageType: mode,
          apiCount: apiList.length,
          supplementalCount: supplemental.length,
          filteredCount: visibleRows.length,
          activeUploadJobs: activeJobs.length,
          processingCount,
        });
      }
    } catch (e) {
      console.log("KRISTO_FEED_STORAGE_LOAD_ERROR", mode, e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [churchId, mode, session?.role, session?.userId]);

  const hasProcessingRows = useMemo(
    () =>
      rows.some((item) => normalizeMediaStatus(item.mediaStatus) === "processing") ||
      uploadJobs.some((job) => job.phase === "processing"),
    [rows, uploadJobs]
  );

  useEffect(() => {
    const pendingRefreshId = String((globalThis as any).__KRISTO_MEDIA_STORAGE_REFRESH__ || "").trim();
    if (!pendingRefreshId) return;
    delete (globalThis as any).__KRISTO_MEDIA_STORAGE_REFRESH__;
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (mode !== "media" || !hasProcessingRows) return;
    const timer = setInterval(() => {
      void loadRows();
    }, 4000);
    return () => clearInterval(timer);
  }, [hasProcessingRows, loadRows, mode]);

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
            const postId = String(item.id || "").trim();
            const payload = { action: "delete_post", postId };

            if (!postId) {
              Alert.alert("Delete failed", "Could not delete post. Please try again.");
              return;
            }

            setDeletingId(item.id);
            try {
              const res: any = await apiPost("/api/church/feed", payload, {
                headers: getKristoHeaders({
                  userId: session.userId,
                  role: (session.role || "Member") as any,
                  churchId,
                }),
              });

              const parsed = parseStorageDeleteResponse(res, postId);

              if (!parsed.deleted) {
                console.log("KRISTO_STORAGE_DELETE_FAIL_DETAIL", {
                  postId,
                  status: parsed.status || res?.status,
                  responseText: parsed.error || res?.error,
                  payload: parsed.payload ?? res,
                });
                if (__DEV__) {
                  console.log("KRISTO_STORAGE_DELETE_POST", {
                    postId,
                    storageType: mode,
                    status: "failed",
                  });
                }
                Alert.alert("Delete failed", "Could not delete post. Please try again.");
                return;
              }

              if (__DEV__) {
                console.log("KRISTO_STORAGE_DELETE_POST", {
                  postId: parsed.deletedId || postId,
                  storageType: mode,
                  status: "success",
                });
              }

              feedRemoveWhere((row) => String(row.id || "") === String(item.id));
              setRows((prev) => prev.filter((row) => row.id !== item.id));
            } catch (e) {
              console.log("KRISTO_STORAGE_DELETE_FAIL_DETAIL", {
                postId,
                status: "exception",
                responseText: e instanceof Error ? e.message : String(e),
                payload: { action: "delete_post", postId },
              });
              if (__DEV__) {
                console.log("KRISTO_STORAGE_DELETE_POST", {
                  postId,
                  storageType: mode,
                  status: "failed",
                });
              }
              console.log("KRISTO_FEED_STORAGE_DELETE_ERROR", e);
              Alert.alert("Delete failed", "Could not delete post. Please try again.");
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
      <StorageMediaPreviewModal
        visible={Boolean(previewItem)}
        item={previewItem}
        onClose={() => setPreviewItem(null)}
      />

      <View style={s.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed ? s.pressed : null]}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <View style={s.titleRow}>
            <Text style={s.title}>{title}</Text>
            {!loading ? (
              <Text style={s.countBadge}>{rows.length + (mode === "media" ? uploadJobs.length : 0)}</Text>
            ) : null}
          </View>
          <Text style={s.subtitle}>{subtitle}</Text>
        </View>
      </View>

      {loading && !(mode === "media" && uploadJobs.length) ? (
        <View style={s.center}>
          <ActivityIndicator color="#F4C95D" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 28 }]}
        >
          {mode === "media" && uploadJobs.length
            ? uploadJobs.map((job) => (
                <MediaUploadJobCard
                  key={job.jobId}
                  job={job}
                  onRetry={() => {
                    void retryMediaUploadJob(job.jobId, { manual: true });
                  }}
                />
              ))
            : null}

          {loading ? (
            <View style={s.inlineLoading}>
              <ActivityIndicator color="#F4C95D" />
            </View>
          ) : null}

          {!rows.length && !(mode === "media" && uploadJobs.length) ? (
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
                onPreview={() => setPreviewItem(item)}
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 128;
const DELETE_BTN_SIZE = 44;

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
  inlineLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
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
    position: "relative",
    borderRadius: 22,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.12)",
  },
  cardMainRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  thumbWrap: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    flexShrink: 0,
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
  playHint: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  cardContent: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cardContentWithDelete: {
    paddingRight: 54,
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 26,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  typeBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  processingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(244,201,93,0.14)",
    flexShrink: 0,
  },
  processingSpinner: {
    transform: [{ scale: 0.7 }],
  },
  processingBadgeText: {
    color: "#F4C95D",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  uploadJobCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.18)",
    gap: 10,
  },
  uploadJobHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  uploadJobTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 22,
  },
  uploadJobCaption: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  uploadJobStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(244,201,93,0.14)",
  },
  uploadJobStatusText: {
    color: "#F4C95D",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  uploadJobProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  uploadJobProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#F4C95D",
  },
  uploadJobHint: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    lineHeight: 17,
  },
  uploadJobError: {
    color: "#FFB4B4",
    fontSize: 12,
    lineHeight: 17,
  },
  uploadJobRetryBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#F4C95D",
  },
  uploadJobRetryBtnDisabled: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  uploadJobRetryText: {
    color: "#07111F",
    fontSize: 13,
    fontWeight: "800",
  },
  uploadJobRetryTextDisabled: {
    color: "#94A3B8",
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  authorAvatarRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    padding: 2,
    backgroundColor: "rgba(244,201,93,0.22)",
    flexShrink: 0,
  },
  authorAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  authorAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  authorAvatarInitial: {
    color: "#1A1205",
    fontSize: 10,
    fontWeight: "900",
  },
  authorMeta: {
    flex: 1,
    minWidth: 0,
  },
  authorName: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  authorRole: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  whenLabel: {
    flex: 1,
    minWidth: 0,
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
  },
  churchLabel: {
    color: "rgba(244,201,93,0.72)",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
  },
  deleteBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    zIndex: 2,
    width: DELETE_BTN_SIZE,
    height: DELETE_BTN_SIZE,
    borderRadius: 14,
    overflow: "hidden",
  },
  deleteBlur: {
    width: DELETE_BTN_SIZE,
    height: DELETE_BTN_SIZE,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,80,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.28)",
    borderRadius: 14,
  },
  deleteBtnBusy: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.88,
  },
});

const previewStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    zIndex: 3,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  content: {
    width: "100%",
    flex: 1,
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
    minHeight: 280,
  },
  videoPlayer: {
    width: "100%",
    height: "100%",
    minHeight: 280,
  },
  emptyPreview: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 220,
  },
  emptyPreviewText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "700",
  },
});
