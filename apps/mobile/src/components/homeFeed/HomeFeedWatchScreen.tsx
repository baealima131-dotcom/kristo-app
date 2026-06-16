import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
import {
  safePauseVideoPlayer,
  safePlayVideoPlayer,
  safeSeekVideoPlayer,
} from "@/src/lib/expoVideoPlayerSafe";
import { useEventListener } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
import { resolveHomeFeedPlaybackUri } from "@/src/lib/homeFeedVideoDiskCache";
import { resolveHomeFeedVideoUri } from "@/src/lib/homeFeedVideoStartup";
import {
  notifyWatchPlaybackActive,
  notifyWatchPlaybackPaused,
  notifyWatchScreenClosed,
  notifyWatchScreenOpened,
} from "@/src/lib/homeFeedWatchPlaybackPriority";
import {
  YOUTUBE_CARD_H_PADDING,
  YOUTUBE_THUMB_ASPECT,
  TIKTOK_THUMB_ASPECT,
} from "@/src/lib/homeFeedYouTubeLayout";
import { resolveHomeFeedVideoDisplayType } from "@/src/lib/homeFeedVideoDisplayType";
import { resolveVideoDurationMs } from "@/src/lib/mediaVideoPoster";
import {
  formatFeedTimestamp,
  isChurchRoomMemberFeedPost,
  resolveChurchName,
  resolveFeedPostTypeTitle,
  resolveHomeFeedVideoTitle,
  resolveVideoUri,
} from "./homeFeedUtils";
import { FeedChurchBrandRow } from "./FeedChurchBrandRow";
import { FeedYouTubeCard } from "./FeedYouTubeCard";
import { FeedCommentsSheet } from "./FeedCommentsSheet";
import { FeedReportSheet } from "./FeedReportSheet";
import { HomeFeedShareSheet } from "./HomeFeedShareSheet";
import { ShareToChatSheet } from "./ShareToChatSheet";
import { useHomeFeedRowEngagement } from "@/src/lib/homeFeedEngagement";
import type { HomeFeedSharePayload } from "@/src/lib/homeFeedShare";
import { FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import { formatActionCount } from "./homeFeedUtils";
import {
  HOME_FEED_BG,
  HOME_FEED_BORDER,
  HOME_FEED_GOLD,
  HOME_FEED_GOLD_SOFT,
  HOME_FEED_MUTED,
} from "./theme";

const AVATAR_SIZE = 46;
const WATCH_ACTION_ICON_SIZE = 20;
const WATCH_PANEL_BORDER_TOP = "rgba(244, 208, 111, 0.30)";
const WATCH_PANEL_BORDER_BOTTOM = "rgba(168, 85, 247, 0.38)";
const WATCH_DATE_COLOR = "rgba(255,255,255,0.45)";
const AVATAR_RING_SIZE = AVATAR_SIZE + 6;
const WATCH_PANEL_TOP_RADIUS = 38;

type Props = {
  visible: boolean;
  payload: HomeFeedVideoOpenPayload | null;
  relatedItems: any[];
  onClose: () => void;
  onSelectRelated: (payload: HomeFeedVideoOpenPayload) => void;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
  onItemLike: (item: any) => void;
  onItemComment: (item: any) => void;
  onItemShare: (item: any) => void;
  onItemSave: (item: any) => void;
  onItemReport: (item: any) => void;
  commentsSheetOpen: boolean;
  commentTargetPostId: string;
  commentRailCount: number;
  onCloseComments: () => void;
  onDiscussionCountChange: (postId: string, count: number) => void;
  onDiscussionCountBump: (postId: string, delta: number) => void;
  reportSheetOpen: boolean;
  reportTargetPostId: string;
  onCloseReport: () => void;
  onReported: (postId: string) => void;
  shareSheetOpen: boolean;
  sharePayload: HomeFeedSharePayload | null;
  onCloseShare: () => void;
  onOpenShareToChat: () => void;
  shareToChatOpen: boolean;
  shareSourceItem: any;
  onCloseShareToChat: () => void;
};

function WatchPanelActions({
  item,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: {
  item: any;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
}) {
  const engagement = useHomeFeedRowEngagement(item);

  return (
    <View style={styles.watchActionsRow}>
      <WatchPanelAction
        icon={engagement.likedByMe || engagement.liked ? "heart" : "heart-outline"}
        label={formatActionCount(engagement.likeCount)}
        active={engagement.likedByMe || engagement.liked}
        activeColor="#FF6B8A"
        onPress={onLike}
      />
      <WatchPanelAction
        icon="chatbubble-ellipses-outline"
        label={formatActionCount(engagement.commentCount)}
        onPress={onComment}
      />
      <WatchPanelAction
        icon="arrow-redo-outline"
        label={formatActionCount(Number(item?.shareCount || 0))}
        onPress={onShare}
      />
      <WatchPanelAction
        icon={engagement.saved ? "bookmark" : "bookmark-outline"}
        label={engagement.saved ? "Saved" : "Save"}
        active={engagement.saved}
        onPress={onSave}
      />
      <WatchPanelAction
        icon={engagement.reported ? "flag" : "flag-outline"}
        label={engagement.reported ? "Reported" : "Report"}
        active={engagement.reported}
        onPress={onReport}
      />
    </View>
  );
}

function WatchPanelAction({
  icon,
  label,
  onPress,
  active,
  activeColor = HOME_FEED_GOLD_SOFT,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <Pressable style={styles.watchAction} onPress={onPress} hitSlop={8}>
      <Ionicons
        name={icon}
        size={WATCH_ACTION_ICON_SIZE}
        color={active ? activeColor : "rgba(255,255,255,0.68)"}
      />
      <Text
        style={[styles.watchActionLabel, active ? styles.watchActionLabelActive : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function WatchVideoEngagementActions({
  item,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
}: {
  item: any;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onReport: () => void;
}) {
  return (
    <WatchPanelActions
      item={item}
      onLike={onLike}
      onComment={onComment}
      onShare={onShare}
      onSave={onSave}
      onReport={onReport}
    />
  );
}

function resolveWatchScreenPlaybackUri(payload: HomeFeedVideoOpenPayload): string {
  const fromPayload = String(payload.videoUri || "").trim();
  const remoteUri =
    fromPayload || (payload.item ? resolveHomeFeedVideoUri(payload.item) : "");
  if (!remoteUri) return "";
  return resolveHomeFeedPlaybackUri(remoteUri) || remoteUri;
}

function WatchVideoSurface({
  payload,
  isTikTokLayout = false,
}: {
  payload: HomeFeedVideoOpenPayload;
  isTikTokLayout?: boolean;
}) {
  const item = payload.item;
  const postId = String(payload.postId || "").trim();
  const playbackUri = resolveWatchScreenPlaybackUri(payload);
  const [ended, setEnded] = useState(false);
  const initialUriRef = useRef(playbackUri);

  useEffect(() => {
    console.log("KRISTO_WATCH_BACKDROP_DIAG", {
      postId,
      isTikTokLayout,
      playbackUri,
      hasItem: Boolean(item),
      displayType: item ? resolveHomeFeedVideoDisplayType(item) : null,
    });
  }, [postId, isTikTokLayout, playbackUri, item]);

  const player = useVideoPlayer(initialUriRef.current || playbackUri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  const backdropPlayer = useVideoPlayer(initialUriRef.current || playbackUri, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEventListener(player, "playToEnd", () => {
    setEnded(true);
    notifyWatchPlaybackPaused(postId);
  });

  useEffect(() => {
    if (!playbackUri) return;
    setEnded(false);

    let cancelled = false;
    const source = { uri: playbackUri, contentType: "progressive" as const };

    void (async () => {
      try {
        const currentUri = String((player as any)?.source?.uri || "").trim();
        const needsReplace = !currentUri || currentUri !== playbackUri;

        if (needsReplace) {
          if (typeof player.replaceAsync === "function") {
            console.log("KRISTO_WATCH_VIDEO_REPLACE_ASYNC_START", {
              postId,
              playbackUri,
              at: Date.now(),
            });
            await player.replaceAsync(source);
            if (cancelled) return;
            console.log("KRISTO_WATCH_VIDEO_REPLACE_ASYNC_END", {
              postId,
              at: Date.now(),
            });
          } else {
            console.log("KRISTO_WATCH_VIDEO_REPLACE_FALLBACK_SYNC", {
              postId,
              playbackUri,
              at: Date.now(),
            });
            player.replace(source);
            if (cancelled) return;
          }
        }

        if (cancelled) return;

        if (isTikTokLayout) {
          const backdropCurrentUri = String((backdropPlayer as any)?.source?.uri || "").trim();
          const backdropNeedsReplace = !backdropCurrentUri || backdropCurrentUri !== playbackUri;
          if (backdropNeedsReplace) {
            if (typeof backdropPlayer.replaceAsync === "function") {
              await backdropPlayer.replaceAsync(source);
            } else {
              backdropPlayer.replace(source);
            }
          }
          backdropPlayer.muted = true;
          backdropPlayer.loop = true;
          safePlayVideoPlayer(backdropPlayer, { source: "home-feed-watch-backdrop", uri: playbackUri });
        }

        safePlayVideoPlayer(player, { source: "home-feed-watch", uri: playbackUri });
        notifyWatchPlaybackActive(postId);
      } catch {}
    })();

    return () => {
      cancelled = true;
      safePauseVideoPlayer(backdropPlayer, { source: "home-feed-watch-backdrop", uri: playbackUri });
      safePauseVideoPlayer(player, { source: "home-feed-watch", uri: playbackUri });
    };
  }, [player, backdropPlayer, playbackUri, postId, isTikTokLayout]);

  useEffect(() => {
    let lastPlaying: boolean | null = null;
    const poll = setInterval(() => {
      if (ended) return;
      const playing = Boolean((player as any)?.playing);
      if (playing === lastPlaying) return;
      lastPlaying = playing;
      if (playing) notifyWatchPlaybackActive(postId);
      else notifyWatchPlaybackPaused(postId);
    }, 400);
    return () => clearInterval(poll);
  }, [player, postId, ended]);

  const handleReplay = useCallback(() => {
    setEnded(false);
    safeSeekVideoPlayer(player, 0, { source: "home-feed-watch", uri: playbackUri });
    safePlayVideoPlayer(player, { source: "home-feed-watch", uri: playbackUri });
    notifyWatchPlaybackActive(postId);
  }, [player, postId, playbackUri]);

  const churchName = item ? resolveChurchName(item) : "";
  const churchRoomPost = Boolean(item && isChurchRoomMemberFeedPost(item));
  const title =
    item && churchRoomPost
      ? resolveFeedPostTypeTitle(item)
      : item
        ? resolveHomeFeedVideoTitle(item)
        : payload.title;
  const videoUri = item ? resolveVideoUri(item) || payload.videoUri : payload.videoUri;
  const videoDurationMs = payload.videoDurationMs ?? (item ? resolveVideoDurationMs(item) : undefined);
  const mediaStatus = String(item?.mediaStatus || item?.status || "").trim();

  if (!playbackUri) return null;

  return (
    <View style={styles.playerSurface}>
      {!ended && isTikTokLayout ? (
        <>
          <VideoView
            player={backdropPlayer}
            style={styles.tikTokVideoBackdrop}
            contentFit="cover"
            pointerEvents="none"
          />
          <View style={styles.tikTokBackdropOverlay} pointerEvents="none" />
        </>
      ) : null}
      {!ended ? (
        <VideoView
          player={player}
          style={isTikTokLayout ? styles.videoOverBackdrop : styles.video}
          contentFit="contain"
          nativeControls
        />
      ) : null}
      {ended ? (
        <Pressable style={styles.replayOverlay} onPress={handleReplay} accessibilityLabel="Replay video">
          {item ? (
            <FeedVideoPosterImage
              item={item}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
              postId={postId}
              title={title}
              churchName={churchName}
              videoUrl={videoUri}
              mediaStatus={mediaStatus}
              videoDurationMs={videoDurationMs}
              enableVideoFrameFallback
              youtubeMode
            />
          ) : null}
          <View style={styles.replayBadgeWrap} pointerEvents="none">
            <View style={styles.replayBadge}>
              <Ionicons name="play" size={32} color="#FFFFFF" style={styles.replayIcon} />
            </View>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Current-video metadata — avatar, church, title, date. */
function WatchVideoMeta({ item, fallbackTitle = "" }: { item: any; fallbackTitle?: string }) {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolveHomeFeedVideoTitle(item);
  const titleLine = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle || fallbackTitle;
  const whenLabel = formatFeedTimestamp(item?.createdAt);

  return (
    <View style={styles.metaRow}>
      <View style={styles.avatarRing}>
        <View style={styles.avatarGlow}>
          <FeedChurchBrandRow item={item} variant="watch" part="avatar" source="watch-screen" />
        </View>
      </View>
      <View style={styles.metaTextCol}>
        <FeedChurchBrandRow item={item} variant="watch" part="name" source="watch-screen" />
        {titleLine ? (
          <Text style={styles.videoTitle} numberOfLines={3}>
            {titleLine}
          </Text>
        ) : null}
        {whenLabel ? (
          <Text style={styles.dateMuted} numberOfLines={1}>
            {whenLabel}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export const HomeFeedWatchScreen = memo(function HomeFeedWatchScreen({
  visible,
  payload,
  relatedItems,
  onClose,
  onSelectRelated,
  onLike,
  onComment,
  onShare,
  onSave,
  onReport,
  onItemLike,
  onItemComment,
  onItemShare,
  onItemSave,
  onItemReport,
  commentsSheetOpen,
  commentTargetPostId,
  commentRailCount,
  onCloseComments,
  onDiscussionCountChange,
  onDiscussionCountBump,
  reportSheetOpen,
  reportTargetPostId,
  onCloseReport,
  onReported,
  shareSheetOpen,
  sharePayload,
  onCloseShare,
  onOpenShareToChat,
  shareToChatOpen,
  shareSourceItem,
  onCloseShareToChat,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const displayType = resolveHomeFeedVideoDisplayType(payload?.item);
  const isTikTokLayout = displayType === "tiktok";
  const playerHeight = isTikTokLayout
    ? Math.min(Math.round(width / TIKTOK_THUMB_ASPECT), Math.round(windowHeight * 0.72))
    : Math.round(width / YOUTUBE_THUMB_ASPECT);
  const scrollRef = useRef<ScrollView | null>(null);

  const item = payload?.item;

  const handleRelatedVideoPress = useCallback(
    (next: HomeFeedVideoOpenPayload) => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      onSelectRelated(next);
    },
    [onSelectRelated]
  );

  useEffect(() => {
    if (!visible) return;
    notifyWatchScreenOpened(String(payload?.postId || "").trim());
    return () => notifyWatchScreenClosed();
  }, [visible]);

  useEffect(() => {
    if (!payload?.postId) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [payload?.postId]);

  if (!payload) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close video">
            <Ionicons name="chevron-back" size={32} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            Watch
          </Text>
          <View style={styles.topBarSpacer} />
        </View>

        <View
          style={[
            styles.playerWrap,
            { height: playerHeight },
            isTikTokLayout ? styles.playerWrapTikTok : null,
          ]}
        >
          <WatchVideoSurface payload={payload} isTikTokLayout={isTikTokLayout} />
        </View>

        <View style={styles.currentVideoPanel}>
          <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFillObject} />
          <LinearGradient
            colors={[
              "rgba(52, 4, 82, 0.76)",
              "rgba(46, 3, 73, 0.72)",
              "rgba(38, 2, 62, 0.74)",
            ]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          <View style={styles.panelContent}>
            {item ? <WatchVideoMeta item={item} fallbackTitle={payload.title} /> : null}
            {item ? <View style={styles.actionsDivider} /> : null}
            <View style={styles.actionsWrap}>
              {item ? (
                <WatchVideoEngagementActions
                  item={item}
                  onLike={onLike}
                  onComment={onComment}
                  onShare={onShare}
                  onSave={onSave}
                  onReport={onReport}
                />
              ) : null}
            </View>
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.upNextLabel}>Up next</Text>
          {relatedItems.map((related) => {
            const key = String(related?.id || related?.homeFeedRecycleKey || "").trim();
            if (!key) return null;
            return (
              <FeedYouTubeCard
                key={key}
                item={related}
                onLike={() => onItemLike(related)}
                onComment={() => onItemComment(related)}
                onShare={() => onItemShare(related)}
                onSave={() => onItemSave(related)}
                onReport={() => onItemReport(related)}
                onVideoPress={handleRelatedVideoPress}
              />
            );
          })}
        </ScrollView>

        <FeedCommentsSheet
          visible={commentsSheetOpen}
          postId={commentTargetPostId}
          railDiscussionCount={commentRailCount}
          onClose={onCloseComments}
          onDiscussionCountChange={onDiscussionCountChange}
          onDiscussionCountBump={onDiscussionCountBump}
        />

        <FeedReportSheet
          visible={reportSheetOpen}
          postId={reportTargetPostId}
          onClose={onCloseReport}
          onReported={onReported}
        />

        <HomeFeedShareSheet
          visible={shareSheetOpen}
          payload={sharePayload}
          onClose={onCloseShare}
          onOpenShareToChat={onOpenShareToChat}
        />

        <ShareToChatSheet
          visible={shareToChatOpen}
          payload={sharePayload}
          sourceItem={shareSourceItem}
          onClose={onCloseShareToChat}
        />
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: HOME_FEED_BG,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(244,208,111,0.18)",
  },
  topBarTitle: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  topBarSpacer: {
    width: 36,
  },
  playerWrap: {
    width: "100%",
    backgroundColor: "#000000",
  },
  playerWrapTikTok: {
    alignItems: "center",
    justifyContent: "center",
  },
  playerSurface: {
    flex: 1,
    width: "100%",
    backgroundColor: "#12031F",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  videoOverBackdrop: {
    height: "100%",
    aspectRatio: 9 / 16,
    alignSelf: "center",
    zIndex: 2,
    backgroundColor: "transparent",
  },
  tikTokVideoBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  tikTokBackdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(18,3,31,0.24)",
    zIndex: 1,
  },
  replayOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
  },
  replayBadgeWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  replayBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  replayIcon: {
    marginLeft: 3,
  },
  scroll: {
    flex: 1,
  },
  currentVideoPanel: {
    borderTopWidth: 1,
    borderTopColor: "rgba(244,208,111,0.28)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(168,85,247,0.30)",
    backgroundColor: "rgba(46,3,73,0.96)",
    shadowColor: "#A855F7",
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 9,
  },
  panelContent: {
    position: "relative",
    zIndex: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingTop: 14,
    paddingBottom: 4,
  },
  avatarRing: {
    width: AVATAR_RING_SIZE,
    height: AVATAR_RING_SIZE,
    borderRadius: AVATAR_RING_SIZE / 2,
    borderWidth: 3,
    borderColor: "rgba(244, 208, 111, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#9333EA",
    shadowOpacity: 0.48,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  avatarGlow: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
    backgroundColor: "rgba(124, 58, 237, 0.16)",
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "#1A2230",
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: "rgba(217,179,95,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 18,
    fontWeight: "900",
  },
  metaTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  churchNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
  },
  churchName: {
    flexShrink: 1,
    color: HOME_FEED_GOLD,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  verifiedBadge: {
    flexShrink: 0,
    marginTop: 1,
  },
  videoTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
    letterSpacing: 0.05,
  },
  dateMuted: {
    color: WATCH_DATE_COLOR,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
    marginTop: 2,
  },
  actionsDivider: {
    height: 1,
    backgroundColor: "rgba(244,208,111,0.18)",
    marginHorizontal: YOUTUBE_CARD_H_PADDING,
    shadowColor: "#F4D06F",
    shadowOpacity: 0.16,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
  },
  actionsWrap: {
    paddingTop: 11,
    paddingBottom: 9,
    backgroundColor: "rgba(7,1,16,0.18)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.045)",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: -3 },
  },
  watchActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  watchAction: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 4,
  },
  watchActionLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "600",
  },
  watchActionLabelActive: {
    color: HOME_FEED_GOLD_SOFT,
  },
  upNextLabel: {
    color: HOME_FEED_MUTED,
    fontSize: 15,
    fontWeight: "800",
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingTop: 12,
    paddingBottom: 4,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
