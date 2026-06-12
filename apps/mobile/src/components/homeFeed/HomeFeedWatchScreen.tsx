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
import { useEventListener } from "expo";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedVideoOpenPayload } from "@/src/lib/homeFeedVideoMode";
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
  formatFeedMetaLine,
  formatFeedTimestamp,
  isChurchRoomMemberFeedPost,
  resolveChurchName,
  resolveFeedChurchVerified,
  resolveFeedPostTypeTitle,
  resolveHomeFeedDisplayAvatar,
  resolveHomeFeedVideoTitle,
  resolveVideoUri,
} from "./homeFeedUtils";
import { FeedYouTubeCard } from "./FeedYouTubeCard";
import { PostActionsInline } from "./PostActionsInline";
import { useHomeFeedRowEngagement } from "@/src/lib/homeFeedEngagement";
import { FeedVideoPosterImage } from "./VideoPostFallbackPoster";
import {
  HOME_FEED_BG,
  HOME_FEED_BORDER,
  HOME_FEED_GOLD,
  HOME_FEED_GOLD_SOFT,
  HOME_FEED_MUTED,
} from "./theme";

const AVATAR_SIZE = 46;
const STATS_COLOR = "rgba(255,255,255,0.45)";

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
};

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
  const engagement = useHomeFeedRowEngagement(item);

  return (
    <PostActionsInline
      liked={engagement.likedByMe || engagement.liked}
      likeCount={engagement.likeCount}
      commentCount={engagement.commentCount}
      shareCount={Number(item?.shareCount || 0)}
      saved={engagement.saved}
      reported={engagement.reported}
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
  if (fromPayload) return fromPayload;
  const item = payload.item;
  if (item) return resolveHomeFeedVideoUri(item);
  return "";
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

  const player = useVideoPlayer(initialUriRef.current || playbackUri, (p) => {
    p.loop = false;
    p.muted = false;
  });

  useEventListener(player, "playToEnd", () => {
    setEnded(true);
    notifyWatchPlaybackPaused(postId);
  });

  useEffect(() => {
    if (!playbackUri) return;
    setEnded(false);
    try {
      const currentUri = String((player as any)?.source?.uri || "").trim();
      if (currentUri && currentUri !== playbackUri) {
        player.replace({ uri: playbackUri, contentType: "progressive" });
      } else if (!currentUri) {
        player.replace({ uri: playbackUri, contentType: "progressive" });
      }
      player.play();
      notifyWatchPlaybackActive(postId);
    } catch {}
  }, [player, playbackUri, postId]);

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
    try {
      player.currentTime = 0;
      player.play();
      notifyWatchPlaybackActive(postId);
    } catch {}
  }, [player, postId]);

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
      {!ended ? (
        <VideoView
          player={player}
          style={styles.video}
          contentFit={isTikTokLayout ? "cover" : "contain"}
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
              <Ionicons name="play" size={28} color="#FFFFFF" style={styles.replayIcon} />
            </View>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Same metadata block as FeedYouTubeCard — church row, then title, then stats. */
function WatchVideoMeta({ item, fallbackTitle = "" }: { item: any; fallbackTitle?: string }) {
  const churchRoomPost = isChurchRoomMemberFeedPost(item);
  const postTitle = resolveHomeFeedVideoTitle(item);
  const title = churchRoomPost ? resolveFeedPostTypeTitle(item) : postTitle || fallbackTitle;
  const churchName = resolveChurchName(item);
  const churchVerified = resolveFeedChurchVerified(item);
  const whenLabel = formatFeedTimestamp(item?.createdAt);
  const statsLine = formatFeedMetaLine(item, whenLabel);

  const { uri: avatarUri, backupUri, initial } = useMemo(
    () => resolveHomeFeedDisplayAvatar(item),
    [item]
  );
  const avatarSrc = String(avatarUri || backupUri || "").trim();

  return (
    <View style={styles.metaRow}>
      {avatarSrc ? (
        <Image source={{ uri: avatarSrc }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarInitial}>{initial || "K"}</Text>
        </View>
      )}
      <View style={styles.metaTextCol}>
        {churchName ? (
          <View style={styles.churchNameRow}>
            <Text style={styles.churchName} numberOfLines={1}>
              {churchName}
            </Text>
            {churchVerified ? (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={HOME_FEED_GOLD}
                style={styles.verifiedBadge}
              />
            ) : null}
          </View>
        ) : null}
        {title ? (
          <Text style={styles.videoTitle} numberOfLines={3}>
            {title}
          </Text>
        ) : null}
        {statsLine ? (
          <Text style={styles.statsLine} numberOfLines={1}>
            {statsLine}
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
            <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
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
          {item ? <WatchVideoMeta item={item} fallbackTitle={payload.title} /> : null}
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
    borderBottomColor: HOME_FEED_BORDER,
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
    backgroundColor: "#000000",
  },
  video: {
    flex: 1,
    width: "100%",
    height: "100%",
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
    borderWidth: 2,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HOME_FEED_BORDER,
    backgroundColor: HOME_FEED_BG,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingTop: 10,
    paddingBottom: 4,
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
  statsLine: {
    color: STATS_COLOR,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
    marginTop: 2,
  },
  actionsWrap: {
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingBottom: 8,
  },
  upNextLabel: {
    color: HOME_FEED_MUTED,
    fontSize: 13,
    fontWeight: "800",
    paddingHorizontal: YOUTUBE_CARD_H_PADDING,
    paddingTop: 12,
    paddingBottom: 4,
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
