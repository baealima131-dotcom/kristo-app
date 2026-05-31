import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TextInput,
  ScrollView,
  Platform,
  Modal,
  KeyboardAvoidingView,
  ActivityIndicator,
  View,
  FlatList,
  StyleSheet,
  useWindowDimensions,
  Text,
  Image,
  Pressable,
  Share,
  Animated,
  Easing,
  AppState,
  Alert,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import Slider from "@react-native-community/slider";
import { VideoView, useVideoPlayer } from "expo-video";
import { useEvent } from "expo";
import { LiveKitRoom, useRoomContext } from "@livekit/react-native";
import { RoomEvent } from "livekit-client";
import { RTCView, MediaStream, registerGlobals } from "@livekit/react-native-webrtc";

import { useRouter } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  feedList,
  subscribe,
  feedToggleLike,
  feedToggleSave,
  feedClaimSchedule,
  feedUnclaimSchedule,
  feedJoinSlotQueue,
  feedRemoveWhere,
  feedRemoveScheduleMirrors,
  isPastorClaimActor,
  resolveClaimFeedTarget,
  clearLocalMediaVideoPosts,
  clearHomeFeedLocalCaches,
  clearHomeFeedRuntimeCaches,
  clearHomeFeedPostsOnly,
  isLocalMediaVideoPost,
  isStandaloneAvatarFeedPost,
  isRealHomeFeedRow,
  isMediaScheduleFeedItem as isHomeMediaScheduleItem,
  isFeedVideoItem,
  resolveFeedItemAvatar,
} from "@/src/lib/homeFeedStore";
import { getSessionSync } from "@/src/lib/kristoSession";
import { loadProfileDraft } from "@/src/lib/profileStore";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { buildLiveRoomAuthorityParams } from "@/src/lib/liveMediaAuthority";
import { baseFeedId, normalizeLiveScheduleSlots, patchMediaSlotClaimAvatarFields, collectScheduleAliasIds } from "@/src/lib/scheduleSlotUtils";
import { mergeFeedRowsForScheduleScan } from "@/src/lib/liveScheduleRing";
import { HomeLiveScheduleCard } from "@/src/components/HomeLiveScheduleCard";
import {
  logHomeFeedVideoPlayState,
  pauseAllHomeFeedVideos,
  pauseHomeFeedVideo,
  registerHomeFeedVideo,
  syncHomeFeedVideoOwnership,
  unregisterHomeFeedVideo,
} from "@/src/lib/homeFeedVideoController";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BODY_PREVIEW_CHARS = 140;

function userHasActiveChurchMembership(session?: { churchId?: string; activeChurchId?: string } | null) {
  return Boolean(String(session?.churchId || session?.activeChurchId || "").trim());
}

function isClaimableScheduleFeedItem(item: any) {
  const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
  return (
    slots.length > 0 ||
    String(item?.scheduleType || "").includes("media-live-slots") ||
    String(item?.source || "").includes("media-schedule") ||
    String(item?.scheduleType || "").includes("live") ||
    String(item?.title || "").toLowerCase().includes("live time card")
  );
}
const TITLE_PREVIEW_LIMIT = 18;
const TITLE_HOLD_MS = 5000;
const TITLE_TYPE_MS = 70;
const TITLE_DELETE_MS = 55;

registerGlobals();

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE || "http://localhost:3000").replace(/\/$/, "");
const FOR_YOU_SIGNALS_KEY = "kristo_for_you_signals_v1";
const FEED_INITIAL_VISIBLE_COUNT = 10;
const FEED_APPEND_BATCH_SIZE = 5;
const FEED_APPEND_PREFETCH_AHEAD = 6;
const FEED_APPEND_DELAY_MS = 100;
const HOME_FEED_BOTTOM_OFFSET = 70;
const HOME_FEED_OVERLAY_BOTTOM = 80;
const HOME_FEED_VIDEO_OVERLAY_BOTTOM = 24;
const HOME_FEED_ACTIONS_BOTTOM = 84;
const VIDEO_META_PANEL_MAX_HEIGHT = 148;
const VIDEO_IDENTITY_ROW_HEIGHT = 66;
const VIDEO_TITLE_SLOT_HEIGHT = 26;
const VIDEO_CAPTION_SLOT_HEIGHT = 44;

type ForYouSignal = {
  watchedCount?: number;
  skippedCount?: number;
  likedCount?: number;
  commentedCount?: number;
  savedCount?: number;
  watchDurationMs?: number;
  lastWatchedAt?: number;
  lastActionAt?: number;
  languageScores?: Record<string, number>;
  mediaScores?: Record<string, number>;
  geoScores?: Record<string, number>;
};

let recordForYouSignalGlobal: ((rawId: any, patch: Partial<ForYouSignal>) => void) | null = null;

function recordForYouSignal(rawId: any, patch: Partial<ForYouSignal>) {
  try {
    recordForYouSignalGlobal?.(rawId, patch);
  } catch {}
}

function detectLanguage(text: any) {
  const t = String(text || "").toLowerCase();
  if (/mungu|kanisa|maombi|baraka|yesu|amen|wachungaji|ibada/.test(t)) return "sw";
  if (/imana|gusenga|mwami|amahoro|urukundo|ubuntu/.test(t)) return "rn";
  if (/dieu|eglise|église|jesus|priere|prière|pasteur/.test(t)) return "fr";
  return "en";
}

function tokenizeInterest(text: any) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((v) => v.length >= 4)
    .slice(0, 18);
}

function mediaUrl(u: any) {
  const v = String(u || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v) || v.startsWith("file://")) return v;
  return `${API_BASE}${v.startsWith("/") ? "" : "/"}${v}`;
}

const feedVideoPosterCache = new Map<string, string>();

function feedVideoPlayUri(item: any) {
  const raw = String(item?.videoUrl || item?.mediaUri || "").trim();
  if (!raw || raw.startsWith("file://")) return "";
  return mediaUrl(raw);
}

function isStrictVideoFeedItem(item: any) {
  return item?.mediaType === "video" && Boolean(feedVideoPlayUri(item));
}

function isImageFeedItem(item: any) {
  return item?.mediaType === "image" || Boolean(String(item?.mediaUri || "").trim());
}

function logNonVideoActivePause(meta: Record<string, unknown>) {
  if (__DEV__) {
    console.log("KRISTO_FEED_NON_VIDEO_ACTIVE_PAUSE", meta);
  }
  pauseAllHomeFeedVideos({
    ...(meta as any),
    reason: String(meta.reason || "non-video-active"),
  });
}

function formatFeedVideoTime(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function resolveFeedVideoPoster(item: any): string {
  if (item?.mediaType !== "video") return "";

  const videoUri = feedVideoPlayUri(item);
  const cached = videoUri ? feedVideoPosterCache.get(videoUri) : "";
  if (cached) return cached;

  return mediaUrl(
    item?.posterUri ||
      item?.thumbnailUri ||
      item?.thumbnailUrl ||
      ""
  );
}

function rememberFeedVideoPoster(videoUri: string, posterUri: string) {
  const video = String(videoUri || "").trim();
  const poster = String(posterUri || "").trim();
  if (!video || !poster) return;
  feedVideoPosterCache.set(video, poster);
}

const FEED_MEDIA_AVATAR_SIZE = 56;

const FeedMediaAvatar = memo(function FeedMediaAvatar({
  uri,
  initial,
  live,
  size = FEED_MEDIA_AVATAR_SIZE,
}: {
  uri?: string;
  initial: string;
  live?: boolean;
  size?: number;
}) {
  const inner = size - 6;
  return (
    <View style={{ width: size + 10, height: size + 10, alignItems: "center", justifyContent: "center", marginRight: 12 }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: size + 8,
          height: size + 8,
          borderRadius: (size + 8) / 2,
          backgroundColor: "rgba(247,211,106,0.20)",
          shadowColor: "#F7D36A",
          shadowOpacity: 0.45,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
          elevation: 8,
        }}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2.5,
          borderColor: "rgba(247,211,106,0.82)",
          padding: 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(0,0,0,0.28)",
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        {uri ? (
          <Image source={{ uri }} style={{ width: inner, height: inner, borderRadius: inner / 2 }} resizeMode="cover" />
        ) : (
          <LinearGradient
            colors={["#FFE08A", "#F7D36A", "#C8943A", "#7A5218"]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={{ width: inner, height: inner, borderRadius: inner / 2, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: "#1A1205", fontSize: 22, fontWeight: "900" }}>{initial}</Text>
          </LinearGradient>
        )}
      </View>
      {live ? (
        <View
          style={{
            position: "absolute",
            bottom: 3,
            right: 3,
            width: 11,
            height: 11,
            borderRadius: 6,
            backgroundColor: "#FF375F",
            borderWidth: 2,
            borderColor: "#0B0F17",
          }}
        />
      ) : null}
    </View>
  );
});

type FeedImageFrameMeta = {
  imageWidth: number;
  imageHeight: number;
  aspectRatio: number;
  focusX: number;
  focusY: number;
};

type SmartImageFit = {
  foregroundMode: "cover" | "contain";
  usePremiumFrame: boolean;
  focusX: number;
  focusY: number;
};

const feedImageDimensionCache = new Map<string, FeedImageFrameMeta>();

function rememberFeedImageDimensions(itemId: string, width: number, height: number) {
  const id = String(itemId || "").trim();
  const imageWidth = Math.max(0, Number(width || 0));
  const imageHeight = Math.max(0, Number(height || 0));
  if (!id || imageWidth <= 0 || imageHeight <= 0) return;

  const aspectRatio = imageWidth / imageHeight;
  const prev = feedImageDimensionCache.get(id);

  if (
    prev &&
    prev.imageWidth === imageWidth &&
    prev.imageHeight === imageHeight &&
    prev.aspectRatio === aspectRatio
  ) {
    return;
  }

  feedImageDimensionCache.set(id, {
    imageWidth,
    imageHeight,
    aspectRatio,
    focusX: prev?.focusX ?? 0.5,
    focusY: prev?.focusY ?? 0.5,
  });
}

function getItemImageAspectRatio(item: any, itemId?: string) {
  const cached = feedImageDimensionCache.get(String(itemId || item?.id || ""));
  if (cached?.aspectRatio) return cached.aspectRatio;

  const width = Number(item?.imageWidth || item?.mediaWidth || 0);
  const height = Number(item?.imageHeight || item?.mediaHeight || 0);
  if (width > 0 && height > 0) return width / height;

  const ratio = Number(item?.aspectRatio || 0);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function getSmartImageFit(item: any, itemId?: string): SmartImageFit {
  const focusX = feedImageDimensionCache.get(String(itemId || item?.id || ""))?.focusX ?? 0.5;
  const focusY = feedImageDimensionCache.get(String(itemId || item?.id || ""))?.focusY ?? 0.5;
  const aspect = getItemImageAspectRatio(item, itemId);

  if (!aspect || !Number.isFinite(aspect)) {
    return {
      foregroundMode: "cover",
      usePremiumFrame: false,
      focusX,
      focusY,
    };
  }

  if (aspect > 1.4) {
    return {
      foregroundMode: "contain",
      usePremiumFrame: true,
      focusX,
      focusY,
    };
  }

  return {
    foregroundMode: "cover",
    usePremiumFrame: false,
    focusX,
    focusY,
  };
}

function getSmartImageTransform(fit: SmartImageFit) {
  const shiftX = (0.5 - fit.focusX) * 18;
  const shiftY = (0.5 - fit.focusY) * 18;

  if (Math.abs(shiftX) < 0.01 && Math.abs(shiftY) < 0.01) return undefined;

  return [{ translateX: shiftX }, { translateY: shiftY }];
}

const FeedSmartImage = memo(function FeedSmartImage({
  uri,
  itemId,
  item,
}: {
  uri: string;
  itemId: string;
  item?: any;
  isActive?: boolean;
}) {
  const [frameVersion, setFrameVersion] = useState(0);
  const fit = useMemo(() => getSmartImageFit(item, itemId), [item, itemId, frameVersion]);
  const imageTransform = useMemo(() => getSmartImageTransform(fit), [fit]);

  const handleImageLoad = useCallback(
    (event: any) => {
      const width = Number(event?.nativeEvent?.source?.width || 0);
      const height = Number(event?.nativeEvent?.source?.height || 0);
      rememberFeedImageDimensions(itemId, width, height);
      setFrameVersion((v) => v + 1);
    },
    [itemId]
  );

  if (fit.usePremiumFrame) {
    return (
      <View style={s.media}>
        <Image
          source={{ uri }}
          style={s.smartImageBackdrop}
          resizeMode="cover"
          blurRadius={Platform.OS === "ios" ? 24 : 0}
        />
        {Platform.OS !== "ios" ? (
          <Image source={{ uri }} style={s.smartImageBackdropSoft} resizeMode="cover" />
        ) : null}
        <BlurView pointerEvents="none" intensity={42} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View pointerEvents="none" style={s.smartImageBackdropDim} />
        <Image
          source={{ uri }}
          onLoad={handleImageLoad}
          style={[s.smartImageForeground, imageTransform ? { transform: imageTransform } : null]}
          resizeMode={fit.foregroundMode}
        />
      </View>
    );
  }

  return (
    <View style={s.media}>
      <Image
        source={{ uri }}
        onLoad={handleImageLoad}
        style={[s.mediaImage, imageTransform ? { transform: imageTransform } : null]}
        resizeMode="cover"
      />
    </View>
  );
});

function normalizeFeedItemMedia(item: any) {
  if (item?.mediaType === "video" || item?.mediaType === "image" || item?.mediaType === "none") {
    return item;
  }

  const normalizedMediaType =
    item?.type === "video" || item?.videoUrl || item?.contentType === "video" || item?.isMediaVideo
      ? "video"
      : item?.mediaUri
        ? "image"
        : "none";

  const mediaUri =
    normalizedMediaType === "image"
      ? mediaUrl(item?.mediaUri)
      : undefined;

  const videoUrl =
    normalizedMediaType === "video"
      ? mediaUrl(item?.videoUrl || item?.mediaUri)
      : undefined;

  const avatarFields =
    normalizedMediaType === "video" ? resolveFeedItemAvatar(item, mediaUrl) : null;

  return {
    ...item,
    mediaType: normalizedMediaType,
    mediaUri,
    videoUrl,
    ...(avatarFields
      ? {
          actorAvatarUri: avatarFields.actorAvatarUri,
          mediaAvatarUri: avatarFields.mediaAvatarUri,
          churchAvatarUri: avatarFields.churchAvatarUri,
        }
      : {}),
    ...(normalizedMediaType === "video" && item?.posterUri
      ? { posterUri: mediaUrl(item.posterUri) }
      : {}),
  };
}

type HomeFeedFilterSource = "localFeed" | "finalVisibleData";

function keepRealHomeFeedRow(item: any, source: HomeFeedFilterSource) {
  if (isRealHomeFeedRow(item)) return true;

  if (__DEV__) {
    console.log("KRISTO_HOME_FEED_FILTERED_AVATAR_POST", {
      source,
      id: item?.id,
      mediaType: item?.mediaType,
      mediaUri: item?.mediaUri,
      videoUrl: item?.videoUrl,
      actorAvatarUri: item?.actorAvatarUri,
      mediaAvatarUri: item?.mediaAvatarUri,
      churchAvatarUri: item?.churchAvatarUri,
      standaloneAvatar: isStandaloneAvatarFeedPost(item),
    });
  }

  return false;
}



type HomeItem = ReturnType<typeof feedList>[number];


function MiniLivePreview({ roomName }: { roomName: string }) {
  const [tokenState, setTokenState] = useState<{ url: string; token: string } | null>(null);
  const [streamURL, setStreamURL] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadToken() {
      try {
        const res: any = await apiPost(
          "/api/livekit/token",
          {
            roomName,
            canPublish: false,
            identity: `home-live-preview-${Date.now().toString(36)}`,
          },
          { headers: getKristoHeaders() }
        );

        if (!alive) return;

        if (res?.ok && res?.url && res?.token) {
          setTokenState({ url: String(res.url), token: String(res.token) });
        }
      } catch {}
    }

    loadToken();

    return () => {
      alive = false;
    };
  }, [roomName]);

  if ((globalThis as any).__KRISTO_LIVE_ACTIVE__) {
    return null;
  }

  if (!tokenState?.url || !tokenState?.token) return null;

  return (
    <LiveKitRoom
      serverUrl={tokenState.url}
      token={tokenState.token}
      connect
      audio={false}
      video={false}
      connectOptions={{ autoSubscribe: false } as any}
    >
      <MiniLiveRemoteVideo onStream={setStreamURL} />

      {streamURL ? (
        <RTCView
          streamURL={streamURL}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
          }}
          objectFit="cover"
        />
      ) : null}
    </LiveKitRoom>
  );
}

function MiniLiveRemoteVideo({ onStream }: { onStream: (url: string) => void }) {
  const room = useRoomContext();

  useEffect(() => {
    if (!room) return;

    const pick = () => {
      try {
        room.remoteParticipants.forEach((participant: any) => {
          const pubs = Array.from(participant?.videoTrackPublications?.values?.() || []);

          pubs.forEach((pub: any) => {
            if (typeof pub?.setSubscribed === "function") pub.setSubscribed(true);

            const track =
              pub?.videoTrack ||
              pub?.track ||
              pub?.trackPublication?.track ||
              pub?.publication?.track ||
              null;

            if (track?.mediaStreamTrack) {
              const stream: any = new MediaStream([track.mediaStreamTrack]);
              const url = stream?.toURL?.();

              if (url) onStream(url);
            }
          });
        });
      } catch {}
    };

    pick();

    room
      .on(RoomEvent.TrackSubscribed, pick)
      .on(RoomEvent.TrackPublished, pick)
      .on(RoomEvent.ParticipantConnected, pick);

    return () => {
      room
        .off(RoomEvent.TrackSubscribed, pick)
        .off(RoomEvent.TrackPublished, pick)
        .off(RoomEvent.ParticipantConnected, pick);
    };
  }, [room, onStream]);

  return null;
}

const FEED_VIDEO_DOUBLE_TAP_MS = 280;
const FEED_VIDEO_SINGLE_TAP_DELAY_MS = 300;
const FEED_VIDEO_CONTROLS_HIDE_MS = 3200;
const FEED_VIDEO_CENTER_BTN_SIZE = 80;
const FEED_VIDEO_CENTER_ICON_PLAY = 38;
const FEED_VIDEO_CENTER_ICON_PAUSE = 36;
const FEED_VIDEO_HEART_SIZE = 86;

const FeedVideo = memo(function FeedVideo({
  postId,
  feedIndex,
  uri,
  posterUri,
  shouldPlay,
  interactive,
  playbackMeta,
  onVideoReadyChange,
  onDoubleTapLike,
}: {
  postId: string;
  feedIndex: number;
  uri: string;
  posterUri?: string;
  shouldPlay: boolean;
  interactive?: boolean;
  playbackMeta: Record<string, unknown>;
  onVideoReadyChange?: (ready: boolean) => void;
  onDoubleTapLike?: () => void;
}) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
  });

  const shouldPlayRef = useRef(shouldPlay);
  shouldPlayRef.current = shouldPlay;

  const userPausedRef = useRef(false);
  const [userPaused, setUserPaused] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [centerFlashIcon, setCenterFlashIcon] = useState<"play" | "pause" | null>(null);

  const centerFlashOpacity = useRef(new Animated.Value(0)).current;
  const heartBurstScale = useRef(new Animated.Value(0)).current;
  const heartBurstOpacity = useRef(new Animated.Value(0)).current;

  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);

  const { status } = useEvent(player, "statusChange", { status: player.status });
  const videoReady = status === "readyToPlay";
  const poster =
    String(posterUri || "").trim() ||
    feedVideoPosterCache.get(String(uri || "").trim()) ||
    "";
  const showPosterLayer = !!poster && (!shouldPlay || !videoReady);
  const showBackdrop = !poster && (!shouldPlay || !videoReady);

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsHideTimer();
    controlsHideTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, FEED_VIDEO_CONTROLS_HIDE_MS);
  }, [clearControlsHideTimer]);

  const revealControls = useCallback(() => {
    if (!interactive) return;
    setShowControls(true);
    scheduleControlsHide();
  }, [interactive, scheduleControlsHide]);

  const flashCenterIcon = useCallback(
    (icon: "play" | "pause", holdMs = 650) => {
      if (centerFlashTimerRef.current) {
        clearTimeout(centerFlashTimerRef.current);
      }
      setCenterFlashIcon(icon);
      centerFlashOpacity.stopAnimation();
      centerFlashOpacity.setValue(0.92);
      Animated.timing(centerFlashOpacity, {
        toValue: 0,
        duration: holdMs,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setCenterFlashIcon(null);
      });
    },
    [centerFlashOpacity]
  );

  const playHeartBurst = useCallback(() => {
    heartBurstScale.stopAnimation();
    heartBurstOpacity.stopAnimation();
    heartBurstScale.setValue(0.52);
    heartBurstOpacity.setValue(0.88);

    Animated.parallel([
      Animated.sequence([
        Animated.spring(heartBurstScale, {
          toValue: 1.06,
          friction: 5.5,
          tension: 160,
          useNativeDriver: true,
        }),
        Animated.timing(heartBurstScale, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(360),
        Animated.timing(heartBurstOpacity, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [heartBurstOpacity, heartBurstScale]);

  const togglePlayPause = useCallback(() => {
    try {
      const playing = Boolean(player.playing);
      const meta = {
        postId,
        feedIndex,
        shouldPlay: shouldPlayRef.current,
        ...(playbackMeta as any),
      };

      if (playing) {
        player.pause();
        player.muted = true;
        userPausedRef.current = true;
        setUserPaused(true);
        logHomeFeedVideoPlayState({
          ...meta,
          shouldPlay: false,
          reason: "user-pause",
        });
        return;
      }

      userPausedRef.current = false;
      setUserPaused(false);
      syncHomeFeedVideoOwnership({
        ...meta,
        shouldPlay: true,
        reason: "user-play",
      });
      player.loop = true;
      player.muted = false;
      player.play();
      flashCenterIcon("pause", 380);
      logHomeFeedVideoPlayState({
        ...meta,
        shouldPlay: true,
        reason: "user-play",
      });
    } catch {}
  }, [feedIndex, flashCenterIcon, playbackMeta, player, postId]);

  const handleDoubleTap = useCallback(() => {
    onDoubleTapLike?.();
    playHeartBurst();
    revealControls();
  }, [onDoubleTapLike, playHeartBurst, revealControls]);

  const handleVideoPress = useCallback(() => {
    if (!interactive) return;

    revealControls();

    const now = Date.now();
    if (now - lastTapRef.current < FEED_VIDEO_DOUBLE_TAP_MS) {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      handleDoubleTap();
      return;
    }

    lastTapRef.current = now;
    if (singleTapTimerRef.current) {
      clearTimeout(singleTapTimerRef.current);
    }
    singleTapTimerRef.current = setTimeout(() => {
      singleTapTimerRef.current = null;
      togglePlayPause();
    }, FEED_VIDEO_SINGLE_TAP_DELAY_MS);
  }, [handleDoubleTap, interactive, revealControls, togglePlayPause]);

  useEffect(() => {
    registerHomeFeedVideo(postId, player, {
      postId,
      feedIndex,
      ...(playbackMeta as any),
      reason: "mount",
    });
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      if (centerFlashTimerRef.current) clearTimeout(centerFlashTimerRef.current);
      clearControlsHideTimer();
      pauseHomeFeedVideo(postId, {
        postId,
        feedIndex,
        ...(playbackMeta as any),
        reason: "unmount",
      });
      unregisterHomeFeedVideo(postId, {
        postId,
        feedIndex,
        ...(playbackMeta as any),
        reason: "unmount",
      });
    };
  }, [postId, player, feedIndex, playbackMeta, clearControlsHideTimer]);

  useEffect(() => {
    if (videoReady && poster) {
      rememberFeedVideoPoster(uri, poster);
    }
  }, [videoReady, poster, uri]);

  useEffect(() => {
    onVideoReadyChange?.(shouldPlay && videoReady);
  }, [shouldPlay, videoReady, onVideoReadyChange]);

  useEffect(() => {
    if (shouldPlay) return;
    userPausedRef.current = false;
    setUserPaused(false);
    setShowControls(false);
    setCenterFlashIcon(null);
    clearControlsHideTimer();
  }, [shouldPlay, clearControlsHideTimer]);

  useEffect(() => {
    const applyPlayback = (reason: string) => {
      const play = shouldPlayRef.current;
      const blockedByUser = userPausedRef.current;
      const meta = {
        postId,
        feedIndex,
        shouldPlay: play && !blockedByUser,
        reason,
        ...(playbackMeta as any),
      };

      logHomeFeedVideoPlayState(meta);

      if (!play) {
        pauseHomeFeedVideo(postId, meta);
        return;
      }

      if (blockedByUser) {
        try {
          player.pause();
          player.muted = true;
        } catch {}
        return;
      }

      syncHomeFeedVideoOwnership({
        ...meta,
        shouldPlay: true,
        reason,
      });

      try {
        player.loop = true;
        player.muted = false;
        player.play();
      } catch {}
    };

    if (!shouldPlay) {
      pauseHomeFeedVideo(postId, {
        postId,
        feedIndex,
        shouldPlay: false,
        ...(playbackMeta as any),
        reason: "should-play-false-immediate",
      });
      return;
    }

    applyPlayback("should-play-true");
  }, [player, uri, shouldPlay, postId, feedIndex, playbackMeta]);

  useEffect(() => {
    if (!shouldPlay) return;

    const timer = setInterval(() => {
      if (!shouldPlayRef.current) return;
      if (userPausedRef.current) return;
      try {
        const nextDuration = Number((player as any)?.duration || 0);
        const nextCurrent = Number((player as any)?.currentTime || 0);
        if (!scrubbing) {
          setDuration(nextDuration);
          setCurrentTime(nextCurrent);
        }

        if (nextDuration > 0 && nextCurrent >= Math.max(0, nextDuration - 0.25)) {
          player.currentTime = 0;
          player.muted = false;
          player.play();
        }
      } catch {}
    }, 250);

    return () => clearInterval(timer);
  }, [player, shouldPlay, scrubbing]);

  const maxDuration = Math.max(duration, 0.01);

  return (
    <View style={s.media}>
      {showPosterLayer ? (
        <Image
          source={{ uri: poster }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      ) : showBackdrop ? (
        <LinearGradient
          colors={["#050814", "#0B1020", "#070B14"]}
          style={StyleSheet.absoluteFillObject}
        />
      ) : null}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        nativeControls={false}
      />

      {interactive ? (
        <>
          <Pressable
            style={s.feedVideoTouchLayer}
            onPressIn={revealControls}
            onPress={handleVideoPress}
          />

          {userPaused ? (
            <View pointerEvents="none" style={s.feedVideoCenterPlay}>
              <View style={s.feedVideoCenterPlayCircle}>
                <BlurView intensity={26} tint="dark" style={StyleSheet.absoluteFillObject} />
                <Ionicons
                  name="play"
                  size={FEED_VIDEO_CENTER_ICON_PLAY}
                  color="rgba(255,255,255,0.92)"
                  style={s.feedVideoPlayIconOffset}
                />
              </View>
            </View>
          ) : null}

          {centerFlashIcon ? (
            <Animated.View
              pointerEvents="none"
              style={[s.feedVideoCenterFlash, { opacity: centerFlashOpacity }]}
            >
              <View style={s.feedVideoCenterPlayCircleSoft}>
                <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFillObject} />
                <Ionicons
                  name={centerFlashIcon === "pause" ? "pause" : "play"}
                  size={
                    centerFlashIcon === "pause"
                      ? FEED_VIDEO_CENTER_ICON_PAUSE
                      : FEED_VIDEO_CENTER_ICON_PLAY
                  }
                  color="rgba(255,255,255,0.88)"
                  style={centerFlashIcon === "play" ? s.feedVideoPlayIconOffset : undefined}
                />
              </View>
            </Animated.View>
          ) : null}

          <Animated.View
            pointerEvents="none"
            style={[
              s.feedVideoHeartBurst,
              {
                opacity: heartBurstOpacity,
                transform: [{ scale: heartBurstScale }],
              },
            ]}
          >
            <Ionicons name="heart" size={FEED_VIDEO_HEART_SIZE} color="rgba(255,107,136,0.94)" />
          </Animated.View>

          {showControls ? (
            <View style={s.feedVideoControls} pointerEvents="box-none">
              <LinearGradient
                colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.34)"]}
                style={StyleSheet.absoluteFillObject}
              />
              <View style={s.feedVideoControlsRow}>
                <Text style={s.feedVideoTimeText}>{formatFeedVideoTime(currentTime)}</Text>
                <View style={s.feedVideoSliderWrap}>
                  <Slider
                    style={s.feedVideoSlider}
                    minimumValue={0}
                    maximumValue={maxDuration}
                    value={Math.min(currentTime, maxDuration)}
                    minimumTrackTintColor="rgba(247,211,106,0.92)"
                    maximumTrackTintColor="rgba(255,255,255,0.16)"
                    thumbTintColor="rgba(255,255,255,0.94)"
                    onSlidingStart={() => {
                      setScrubbing(true);
                      clearControlsHideTimer();
                    }}
                    onValueChange={(value) => {
                      setCurrentTime(value);
                    }}
                    onSlidingComplete={(value) => {
                      try {
                        player.currentTime = value;
                      } catch {}
                      setCurrentTime(value);
                      setScrubbing(false);
                      scheduleControlsHide();
                    }}
                  />
                </View>
                <Text style={s.feedVideoTimeText}>{formatFeedVideoTime(duration)}</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
});

const FeedVideoSurface = memo(function FeedVideoSurface({
  postId,
  feedIndex,
  uri,
  posterUri,
  shouldPlay,
  interactive,
  playbackMeta,
  onVideoReadyChange,
  onDoubleTapLike,
}: {
  postId: string;
  feedIndex: number;
  uri: string;
  posterUri?: string;
  shouldPlay: boolean;
  interactive?: boolean;
  playbackMeta: Record<string, unknown>;
  onVideoReadyChange?: (ready: boolean) => void;
  onDoubleTapLike?: () => void;
}) {
  const resolvedPoster =
    String(posterUri || "").trim() ||
    feedVideoPosterCache.get(String(uri || "").trim()) ||
    "";

  return (
    <FeedVideo
      postId={postId}
      feedIndex={feedIndex}
      uri={uri}
      posterUri={resolvedPoster}
      shouldPlay={shouldPlay}
      interactive={interactive}
      playbackMeta={playbackMeta}
      onVideoReadyChange={onVideoReadyChange}
      onDoubleTapLike={onDoubleTapLike}
    />
  );
});

function pickPrimaryViewableItem(viewableItems: any[]) {
  const viewable = (viewableItems || [])
    .filter((v) => {
      const pct = Number(v?.itemVisiblePercent ?? 0);
      return (
        v?.isViewable &&
        v?.item?.id &&
        pct >= 82
      );
    })
    .sort((a, b) => {
      const aPct = Number(a?.itemVisiblePercent ?? 0);
      const bPct = Number(b?.itemVisiblePercent ?? 0);
      if (aPct !== bPct) {
        return bPct - aPct;
      }
      return Number(a?.index ?? 0) - Number(b?.index ?? 0);
    });

  return viewable[0] || null;
}

const SLOT_THEMES = [
  { accent: "#F7D36A", border: "rgba(247,211,106,0.82)", glow: "rgba(247,211,106,0.22)" },
  { accent: "#38BDF8", border: "rgba(56,189,248,0.82)", glow: "rgba(56,189,248,0.22)" },
  { accent: "#A78BFA", border: "rgba(167,139,250,0.82)", glow: "rgba(167,139,250,0.22)" },
  { accent: "#34D399", border: "rgba(52,211,153,0.82)", glow: "rgba(52,211,153,0.22)" },
  { accent: "#FB7185", border: "rgba(251,113,133,0.82)", glow: "rgba(251,113,133,0.22)" },
  { accent: "#F59E0B", border: "rgba(245,158,11,0.82)", glow: "rgba(245,158,11,0.22)" },
  { accent: "#22C55E", border: "rgba(34,197,94,0.82)", glow: "rgba(34,197,94,0.22)" },
  { accent: "#EC4899", border: "rgba(236,72,153,0.82)", glow: "rgba(236,72,153,0.22)" },
  { accent: "#60A5FA", border: "rgba(96,165,250,0.82)", glow: "rgba(96,165,250,0.22)" },
];

function syncBackendLike(postId: string, liked?: boolean) {
  const session = getSessionSync() as any;
  const cleanPostId = baseFeedId(postId);
  if (!cleanPostId) return;

  console.log("KRISTO_LIKE_SEND", {
    postId: cleanPostId,
    rawPostId: postId,
    churchId: session?.churchId || "",
    userId: session?.userId || "",
  });

  apiPost(
    "/api/church/feed",
    {
      action: "toggle_like",
      postId: cleanPostId,
      ...(typeof liked === "boolean" ? { liked } : {}),
    },
    {
      headers: getKristoHeaders({
        userId: session?.userId || "",
        role: (session?.role || "Member") as any,
        churchId: session?.churchId || "",
      }),
    }
  )
    .then((res) => {
      console.log("KRISTO_BACKEND_LIKE_SYNCED", res);
    })
    .catch((e) => {
      console.log("KRISTO_BACKEND_LIKE_ERROR", e);
    });
}

const FeedSlide = memo(function FeedSlide({
  item,
  height,
  feedIndex,
  activeFeedIndex,
  activeFeedItemId,
  activeItemIsStrictVideo,
  isActive,
  screenFocused,
  appActive,
  nowMs,
  onSkipSlots,
  profileName,
  profileAvatarUri,
  onOptimisticBackendLike,
  onOptimisticSlotClaim,
}: {
  item: HomeItem;
  height: number;
  feedIndex: number;
  activeFeedIndex: number;
  activeFeedItemId: string | null;
  activeItemIsStrictVideo: boolean;
  isActive: boolean;
  screenFocused: boolean;
  appActive: boolean;
  nowMs: number;
  onSkipSlots?: () => void;
  profileName?: string;
  profileAvatarUri?: string;
  onOptimisticBackendLike?: (id: string, liked: boolean, likeCount: number) => void;
  onOptimisticSlotClaim?: (params: {
    postId: string;
    slotId: string;
    claim: { userId: string; name: string; role: string; avatarUri: string };
  }) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isLiveNow = Boolean((item as any)?.isLiveNow);
  const liveRoomPath = String((item as any)?.liveRoomPath || "/more/my-church-room/messages/live-room");
  const title = String(item.title || "").trim();
  const titleUpper = title.toUpperCase();
  const body = String(
    item.body ||
    item.text ||
    item.description ||
    item.caption ||
    ""
  ).trim();
  const isScheduleCard = String((item as any)?.scheduleType || "").includes("live") || title.toLowerCase().includes("live time card");
  const firstSlotClaimedBy = (item as any)?.scheduleSlots?.[0]?.claimedBy;
  const claimed = Boolean(
    String((item as any)?.claimedByUserId || "").trim() ||
    String((item as any)?.scheduleSlots?.[0]?.claimedByUserId || "").trim() ||
    String(firstSlotClaimedBy && typeof firstSlotClaimedBy === "object" ? firstSlotClaimedBy.userId || "" : "").trim()
  );
  const claimedCount = Number((item as any)?.claimedCount || 0);
  const scheduleSlots = Array.isArray((item as any)?.scheduleSlots) ? ((item as any).scheduleSlots as any[]) : [];
  const forcedScheduleSlot = scheduleSlots.length === 1 ? scheduleSlots[0] : null;
  const slotFeedIndex = Number((item as any)?.slotFeedIndex ?? 0);
  const slotFeedTotal = Number((item as any)?.slotFeedTotal || scheduleSlots.length || 1);
  const slotTheme = SLOT_THEMES[slotFeedIndex % SLOT_THEMES.length] || SLOT_THEMES[0];

  const liveGlow =
    isLiveNow
      ? "rgba(255,59,92,0.34)"
      : slotTheme.glow;

  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isActive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isActive, pulse]);

  const cardScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.996, 1.004],
  });

  const glowBreath = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.72, 1],
  });

  const feedAvatar = useMemo(() => resolveFeedItemAvatar(item, mediaUrl), [item]);
  const actorAvatarUri = feedAvatar.uri;
  const isVideoFeedPost = isFeedVideoItem(item);
  const isStrictVideoPost = isStrictVideoFeedItem(item);
  const stableActive =
    isStrictVideoPost &&
    isActive &&
    activeFeedIndex === feedIndex &&
    String(item.id || "") === String(activeFeedItemId || "");
  const appState = appActive ? "active" : "inactive";
  const playbackMeta = useMemo(
    () => ({
      postId: String(item.id || ""),
      activeFeedIndex,
      feedIndex,
      activeFeedItemId,
      screenFocused,
      appState,
      isStrictVideoPost,
    }),
    [
      item.id,
      activeFeedIndex,
      feedIndex,
      activeFeedItemId,
      screenFocused,
      appState,
      isStrictVideoPost,
    ]
  );
  const shouldPlayVideo =
    isStrictVideoPost &&
    stableActive &&
    screenFocused &&
    appActive;

  const shouldKeepVideoMounted =
    isStrictVideoPost &&
    (stableActive ||
      (activeItemIsStrictVideo &&
        activeFeedIndex >= 0 &&
        Math.abs(activeFeedIndex - feedIndex) <= 2));

  useEffect(() => {
    if (!__DEV__) return;
    console.log("KRISTO_FEED_PLAYBACK_GUARD", {
      postId: item.id,
      mediaType: item.mediaType,
      hasVideoUrl: Boolean(item.videoUrl),
      isStrictVideoPost,
      stableActive,
      screenFocused,
      appState,
      shouldPlay: shouldPlayVideo,
    });
  }, [
    item.id,
    item.mediaType,
    item.videoUrl,
    isStrictVideoPost,
    stableActive,
    screenFocused,
    appState,
    shouldPlayVideo,
  ]);

  useEffect(() => {
    if (!isVideoFeedPost) return;
    if (__DEV__) {
      console.log("KRISTO_FEED_VIDEO_AVATAR", {
        postId: item.id,
        hasAvatar: Boolean(feedAvatar.uri),
        avatarSource: feedAvatar.source,
        actorLabel: String((item as any)?.actorLabel || (item as any)?.mediaName || ""),
        kind: String((item as any)?.kind || (item as any)?.type || item.mediaType || ""),
      });
    }
  }, [item.id, isVideoFeedPost, feedAvatar.uri, feedAvatar.source, item]);

  const postSource = String(
    (item as any)?.source ||
    (item as any)?.kind ||
    ""
  ).toLowerCase();

  const isMediaPost = isVideoFeedPost || item.mediaType === "video";
  
const isScheduleOnlyCard =
  String((item as any)?.scheduleType || "").includes("media-live-slots") ||
  String((item as any)?.source || "").includes("media-schedule") ||
  scheduleSlots.length > 0;

const noMediaPost =
  !isScheduleOnlyCard &&
  item.mediaType !== "image" &&
  item.mediaType !== "video" &&
  !scheduleSlots.length;

  const noMediaLongText = title.length > 45 || body.length > 150;
  const noMediaPreviewBody =
    body.length > 150 ? body.slice(0, 150).trimEnd() + "..." : body;

  const displayChurchName = String(
    (item as any)?.churchName ||
    (item as any)?.churchLabel ||
    (item as any)?.church?.name ||
    (item as any)?.mediaChurchName ||
    "MY CHURCH"
  ).trim();

  const displayChurchId = String(
    (item as any)?.churchId ||
    (item as any)?.churchCode ||
    (item as any)?.church?.id ||
    ""
  ).trim();

  const displayMediaName = String(
    (item as any)?.mediaName ||
    (item as any)?.actorLabel ||
    ""
  ).trim();

  const hasDisplayMediaName = Boolean(displayMediaName);

  const isTestimony = postSource.includes("testimony");
  const isCounsel = postSource.includes("counsel");
  const isPrayer = postSource.includes("prayer");
  const isAnnouncement =
    postSource.includes("announcement") ||
    String((item as any)?.type || "").toLowerCase() === "announcement";

  const categoryTitle =
    isTestimony ? "TESTIMONY" :
    isCounsel ? "I NEED COUNSEL" :
    isPrayer ? "PRAYER REQUEST" :
    isAnnouncement ? "ANNOUNCEMENT" :
    "POST";

  const categoryAccent =
    isTestimony ? "#1DA1FF" :
    isCounsel ? "#34D399" :
    isPrayer ? "#FB7185" :
    isAnnouncement ? "#FF8A3D" :
    "#FFFFFF";

  const displayAuthorName = String(
    (item as any)?.authorName ||
    (item as any)?.profileName ||
    (item as any)?.postedByName ||
    (item as any)?.userName ||
    (item as any)?.actorLabel ||
    profileName ||
    "Church Member"
  ).trim();

  const feedHeadline = isMediaPost ? displayChurchName : categoryTitle;

  const feedSubline = isMediaPost
    ? (hasDisplayMediaName ? displayMediaName : "")
    : displayAuthorName;
  const feedHeadlineColor = isMediaPost ? "#F7D36A" : categoryAccent;

  const displayVideoTitle = String(item.title || (item as any)?.postTitle || "").trim();
  const displayVideoCaption = String(
    item.body ||
    item.text ||
    item.description ||
    item.caption ||
    ""
  ).trim();

  const noMediaCardBg =
    isTestimony ? "rgba(4, 24, 45, 0.92)" :
    isCounsel ? "rgba(4, 38, 30, 0.92)" :
    isPrayer ? "rgba(45, 10, 20, 0.92)" :
    isAnnouncement ? "rgba(48, 25, 8, 0.92)" :
    "rgba(18, 22, 32, 0.92)";

  const noMediaSoftBg =
    isTestimony ? "rgba(29,161,255,0.12)" :
    isCounsel ? "rgba(52,211,153,0.12)" :
    isPrayer ? "rgba(251,113,133,0.12)" :
    isAnnouncement ? "rgba(255,138,61,0.13)" :
    "rgba(255,255,255,0.08)";

  const mediaInitial = (
    isMediaPost ? displayChurchName : feedSubline
  ).slice(0, 1).toUpperCase() || "M";
  const mediaName = isMediaPost
    ? (displayMediaName || "Church Media")
    : feedSubline;

  const [optimisticClaim, setOptimisticClaim] = useState<any>(null);
  const claimStartedRef = useRef(false);

  const claimedBy =
    optimisticClaim ||
    (item as any)?.scheduleSlots?.[0]?.claimedBy ||
    (item as any)?.claimedBy ||
    null;
  const claimedName = String(claimedBy?.name || "You").trim();
  const claimedRole = String(claimedBy?.role || "Member").replaceAll("_", " ");
  const rawClaimedAvatarUri = String(
    claimedBy?.avatarUri ||
    (item as any)?.scheduleSlots?.[0]?.claimedByAvatar ||
    (item as any)?.claimedByAvatar ||
    ""
  ).trim();

  const apiBase = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
  const claimedAvatarUri =
    rawClaimedAvatarUri.startsWith("/uploads/")
      ? `${apiBase}${rawClaimedAvatarUri}`
      : rawClaimedAvatarUri;
  const claimedInitial = claimedName.slice(0, 1).toUpperCase() || "Y";
  const currentSession = getSessionSync();
  const liveSession: any = currentSession;
  const currentUserId = String(currentSession?.userId || "");
  const claimUserId = String(claimedBy?.userId || "");
  const claimedByMe =
    !!claimed &&
    (
      (!!claimUserId && claimUserId === currentUserId) ||
      (
        !claimUserId &&
        (
          String((item as any)?.liveClaimName || "").trim().toLowerCase() ===
          String(profileName || "").trim().toLowerCase()
        )
      )
    );
  const claimedByOther = !!claimed && !!claimUserId && claimUserId !== currentUserId;

  const rawFeedActionId = String(
    (item as any)?.sourceScheduleId || item.id || ""
  );

  // Slot cards can be rendered as cloned ids like feed_xxx__slot_4.
  // Backend only knows the original feed_xxx id.
  const feedActionId = baseFeedId(rawFeedActionId);
  const isBackendFeedPost = String(feedActionId || "").startsWith("feed_");
  const optimisticLikeState =
    (globalThis as any).__KRISTO_OPTIMISTIC_LIKES__?.[feedActionId];

  const displayLiked =
    optimisticLikeState?.liked ??
    Boolean((item as any)?.liked);

  const likeCount = Number(
    optimisticLikeState?.likeCount ??
    (item as any)?.likesCount ??
    (item as any)?.likeCount ??
    (Array.isArray((item as any)?.likes)
      ? (item as any)?.likes.length
      : 0) ??
    0
  );

  const triggerVideoDoubleTapLike = useCallback(() => {
    if (isBackendFeedPost) {
      const nextLiked = !displayLiked;
      const nextCount = Math.max(0, Number(likeCount || 0) + (nextLiked ? 1 : -1));
      onOptimisticBackendLike?.(feedActionId, nextLiked, nextCount);
      recordForYouSignal(feedActionId, { likedCount: nextLiked ? 1 : 0, lastActionAt: Date.now() });
      syncBackendLike(feedActionId, nextLiked);
      return;
    }

    recordForYouSignal(feedActionId, { likedCount: 1, lastActionAt: Date.now() });
    feedToggleLike(item.id);
  }, [
    displayLiked,
    feedActionId,
    isBackendFeedPost,
    item.id,
    likeCount,
    onOptimisticBackendLike,
  ]);

  async function claimThisSlot() {
    if (!userHasActiveChurchMembership(currentSession)) return;
    if (claimStartedRef.current || claimed || !activeSlot) return;
    claimStartedRef.current = true;

    const seedId = baseFeedId(String((item as any)?.sourceScheduleId || item.id));
    const claimTarget = resolveClaimFeedTarget(seedId);
    const slotId = String(activeSlot?.id || "");
    const isPastorClaim = isPastorClaimActor(currentUserId, item);

    if (isPastorClaim) {
      console.log("KRISTO_PASTOR_CLAIM_ALLOWED", {
        seedId: claimTarget.seedId,
        apiFeedId: claimTarget.apiFeedId,
        slotId,
        userId: currentUserId,
      });
    }

    const liveProfileName =
      String(
        liveSession?.displayName ||
        liveSession?.fullName ||
        liveSession?.name ||
        profileName ||
        (isPastorClaim ? "Pastor" : "Church Member")
      ).trim();

    const liveProfileAvatar =
      String(
        liveSession?.avatarUri ||
        liveSession?.avatarUrl ||
        liveSession?.profileImage ||
        profileAvatarUri ||
        ""
      ).trim();

    const claim = {
      slotId,
      userId: currentUserId,
      name: liveProfileName,
      role: isPastorClaim ? "Pastor" : currentSession?.role || "Member",
      avatarUri: liveProfileAvatar,
    };

    feedClaimSchedule(seedId, claim);

    try {
      console.log("[ClaimSlot] backend sync start", {
        seedId: claimTarget.seedId,
        apiFeedId: claimTarget.apiFeedId,
        slotId,
        churchId: currentSession?.churchId || "",
        userId: currentUserId,
      });

      const res: any = await apiPost("/api/church/feed", {
        action: "claim_schedule_slot",
        postId: claimTarget.apiFeedId,
        slotId,
        claim,
      }, {
        headers: getKristoHeaders({
          userId: currentSession?.userId || "",
          role: currentSession?.role || "Member",
          churchId: currentSession?.churchId || "",
        }),
      });

      if (isPastorClaim) {
        console.log("KRISTO_PASTOR_CLAIM_PERSISTED", {
          seedId: claimTarget.seedId,
          apiFeedId: claimTarget.apiFeedId,
          slotId,
          userId: currentUserId,
          ok: res?.ok !== false,
        });
      }

      console.log("[ClaimSlot] backend sync result", {
        ok: res?.ok,
        apiFeedId: claimTarget.apiFeedId,
        slotId,
        claimedBy: res?.data?.slot?.claimedByUserId || res?.slot?.claimedByUserId,
      });

      const savedSlot = res?.data?.slot || res?.slot || null;
      const savedClaim = savedSlot?.claimedBy || claim;

      const backendClaimUserId = String(savedSlot?.claimedByUserId || savedClaim?.userId || "").trim();
      const backendClaimName = String(savedSlot?.claimedByName || savedClaim?.name || "").trim();
      if (backendClaimUserId && backendClaimName) {
        (activeSlot as any).claimedBy = savedClaim;
        (activeSlot as any).claimedByUserId = backendClaimUserId;
        (activeSlot as any).claimedByName = backendClaimName;
        (activeSlot as any).claimedByAvatar = String(savedSlot?.claimedByAvatar || savedClaim?.avatarUri || "");
      }
      (activeSlot as any).claimed = true;
      (activeSlot as any).isClaimed = true;
      (activeSlot as any).status = "claimed";
    } catch (e) {
      console.log("KRISTO_CLAIM_BACKEND_SYNC_ERROR", {
        seedId: claimTarget.seedId,
        apiFeedId: claimTarget.apiFeedId,
        slotId,
        userId: currentUserId,
        isPastorClaim,
        keepLocalClaim: true,
        error: String((e as any)?.message || e),
      });
      claimStartedRef.current = false;
      return;
    }
  }

  function joinSlotQueue(priority = false) {
    const session = getSessionSync() as any;
    feedJoinSlotQueue(String((item as any)?.sourceScheduleId || item.id), {
      slotId: activeSlot?.id,
      userId: String(session?.userId || ""),
      name:
        String(session?.displayName || session?.fullName || session?.name || "").trim() ||
        "Prince Fariji",
      role: session?.role || "Member",
      avatarUri: String(session?.avatarUri || session?.avatarUrl || session?.profileImage || "").trim(),
      priority,
    });
  }

  function unclaimThisSlot() {
    if (!claimedByMe || slotLocked) return;
    feedUnclaimSchedule(String((item as any)?.sourceScheduleId || item.id), {
      slotId: activeSlot?.id,
      userId: currentUserId,
    });
  }

  const [localSaved, setLocalSaved] = useState(Boolean(item.saved));

  useEffect(() => {
    setLocalSaved(Boolean(item.saved));
  }, [item.id, item.saved]);

  const [bodyExpanded, setBodyExpanded] = useState(false);

  const parseSlotClockMs = (rawDate: string, rawTime: string) => {
    if (!rawDate || !rawTime) return 0;

    const base = new Date(rawDate);

    if (!Number.isFinite(base.getTime())) return 0;

    const [timePart = "12:00", meridiemRaw = "AM"] = rawTime.split(" ");
    const [hhRaw = "12", mmRaw = "00"] = timePart.split(":");

    let hh = Number(hhRaw || 0);
    const mm = Number(mmRaw || 0);

    const meridiem = meridiemRaw.toUpperCase();

    if (meridiem === "PM" && hh < 12) hh += 12;
    if (meridiem === "AM" && hh == 12) hh = 0;

    return new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      hh,
      mm,
      0,
      0
    ).getTime();
  };

  const parseSlotStartMs = (slot: any) => {
    const rawDate = String(slot?.meetingDate || "").trim();
    const rawTime = String(slot?.startTime || slot?.time || "").trim();

    if (!rawDate) return 0;

    const base = new Date(rawDate);

    if (!Number.isFinite(base.getTime())) return 0;

    if (!rawTime) {
      return base.getTime();
    }

    const [timePart = "12:00", meridiemRaw = "AM"] = rawTime.split(" ");
    const [hhRaw = "12", mmRaw = "00"] = timePart.split(":");

    let hh = Number(hhRaw || 0);
    const mm = Number(mmRaw || 0);

    const meridiem = meridiemRaw.toUpperCase();

    if (meridiem === "PM" && hh < 12) hh += 12;
    if (meridiem === "AM" && hh === 12) hh = 0;

    return new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      hh,
      mm,
      0,
      0
    ).getTime();
  };

  const allScheduleSlots = [...scheduleSlots]
    .map((slot: any, index: number) => {
      const startMs = parseSlotStartMs(slot);

      const endMsFromClock = parseSlotClockMs(
        String(slot?.meetingDate || ""),
        String(slot?.endTime || "")
      );

      const durationMs =
        Math.max(1, Number(slot?.durationMin || 10)) * 60000;

      const endMs =
        endMsFromClock > startMs
          ? endMsFromClock
          : startMs + durationMs;

      const slotNumber = Number(
        String(
          slot?.slot ||
          slot?.slotNumber ||
          slot?.order ||
          index + 1
        ).toString().match(/\d+/)?.[0] || (index + 1)
      );

      return {
        ...slot,
        slotNumber,
        startMs,
        endMs,
        isLiveNow:
          startMs > 0 &&
          endMs > 0 &&
          nowMs >= startMs &&
          nowMs <= endMs,
        isUpcoming:
          startMs > nowMs,
        isEnded:
          endMs > 0 &&
          nowMs > endMs,
      };
    })
    .filter((slot: any) => slot.startMs > 0)
    .sort((a: any, b: any) => a.startMs - b.startMs);

  const currentLiveSlot =
    allScheduleSlots.find((slot: any) => slot.isLiveNow) || null;

  const nextUpcomingSlot =
    allScheduleSlots.find((slot: any) => slot.isUpcoming) || null;

  const eventStarted =
    allScheduleSlots.some((slot: any) => nowMs >= slot.startMs);

  const eventEnded =
    allScheduleSlots.length > 0 &&
    allScheduleSlots.every((slot: any) => slot.isEnded);

  const eventPhase =
    currentLiveSlot
      ? "live"
      : nextUpcomingSlot && eventStarted
        ? "between-slots"
        : nextUpcomingSlot
          ? "upcoming"
          : eventEnded
            ? "ended"
            : "idle";

  const myClaimedSlot =
    allScheduleSlots.find((slot: any) => {
      const uid = String(
        slot?.claimedByUserId ||
        slot?.claimedBy?.userId ||
        ""
      );

      return !!uid && uid === currentUserId;
    }) || null;

  const myClaimedSlotPhase =
    !myClaimedSlot
      ? "none"
      : myClaimedSlot.isLiveNow
        ? "live"
        : myClaimedSlot.isUpcoming
          ? (
              myClaimedSlot.startMs - nowMs <= 5 * 60000
                ? "ready"
                : "upcoming"
            )
          : "ended";


  const activeSlot = forcedScheduleSlot ||
    scheduleSlots.find((slot: any) => {
      const startMs = parseSlotStartMs(slot);

      if (!startMs || startMs <= 0) {
        return false;
      }

      const endMsFromClock = parseSlotClockMs(
        String(slot?.meetingDate || ""),
        String(slot?.endTime || "")
      );

      const fallbackDuration =
        Math.max(1, Number(slot?.durationMin || 10)) * 60000;

      const endMs =
        endMsFromClock > startMs
          ? endMsFromClock
          : startMs + fallbackDuration;

      // For Home feed claim cards: keep future/current slots visible.
      // Live Now card is handled separately by liveNowItems.
      return endMs > nowMs;
    }) || null;

  const showBottomMeta = !noMediaPost && (Boolean(activeSlot) || Boolean(body) || isStrictVideoPost);

  const isActivePost = stableActive;
  const showVideoMetaChrome = isStrictVideoPost && !activeSlot && isActivePost;
  const [feedVideoReady, setFeedVideoReady] = useState(false);
  const videoMetaFade = useRef(new Animated.Value(0)).current;
  const hasVideoPoster = Boolean(resolveFeedVideoPoster(item));

  const handleFeedVideoReady = useCallback((ready: boolean) => {
    if (!isActivePost) return;
    setFeedVideoReady(ready);
  }, [isActivePost]);

  useEffect(() => {
    setFeedVideoReady(false);
    setBodyExpanded(false);
    videoMetaFade.stopAnimation();
    videoMetaFade.setValue(0);
  }, [item.id, videoMetaFade]);

  useEffect(() => {
    if (isActivePost) return;
    setFeedVideoReady(false);
    setBodyExpanded(false);
    videoMetaFade.stopAnimation();
    videoMetaFade.setValue(0);
  }, [isActivePost, item.id, videoMetaFade]);

  const videoMetaCanFadeIn = showVideoMetaChrome;

  useEffect(() => {
    if (!videoMetaCanFadeIn) {
      videoMetaFade.stopAnimation();
      videoMetaFade.setValue(0);
      return;
    }

    videoMetaFade.setValue(0);
    Animated.timing(videoMetaFade, {
      toValue: 1,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [videoMetaCanFadeIn, item.id, videoMetaFade]);

  useEffect(() => {
    if (isStrictVideoPost) return;
    setFeedVideoReady(false);
    videoMetaFade.stopAnimation();
    videoMetaFade.setValue(0);
  }, [isStrictVideoPost, item.id, videoMetaFade]);

  useEffect(() => {
    if (!isStrictVideoPost || !__DEV__) return;
    console.log("KRISTO_VIDEO_META_ACTIVE_RENDER", {
      postId: item.id,
      index: feedIndex,
      activeIndex: activeFeedIndex,
      isActivePost,
    });
  }, [isStrictVideoPost, item.id, feedIndex, activeFeedIndex, isActivePost]);

  const isMediaSchedulePost =
    String((item as any)?.scheduleType || "").includes("media-live-slots") ||
    String((item as any)?.source || "").includes("media-schedule");

  const isDedicatedScheduleSlide =
    isMediaSchedulePost &&
    !!activeSlot &&
    item.mediaType !== "video" &&
    item.mediaType !== "image";

  const slotApproved = Boolean(activeSlot?.approved);
  const slotLocked = Boolean(activeSlot?.locked || activeSlot?.approved);
  const slotLockedOnly = slotLocked && !claimed;
  const slotQueue = Array.isArray(activeSlot?.queue) ? activeSlot.queue : [];
  const currentUserQueued = slotQueue.some((x: any) => String(x?.userId || "") === currentUserId);
  const waitingCount = slotQueue.length;

  const effectiveDisplaySlot =
    currentLiveSlot ||
    myClaimedSlot ||
    nextUpcomingSlot ||
    activeSlot;

  const slotStartMs = effectiveDisplaySlot
    ? (
        effectiveDisplaySlot.startMs ||
        parseSlotStartMs(effectiveDisplaySlot)
      )
    : 0;

  const msUntilStart =
    slotStartMs > 0 ? slotStartMs - nowMs : null;

  const minutesToStart =
    msUntilStart !== null
      ? Math.ceil(msUntilStart / 60000)
      : null;
  const countdownLabel =
    minutesToStart === null
      ? "Live time ready"
      : minutesToStart > 60
        ? `${Math.floor(minutesToStart / 60)}h ${minutesToStart % 60}m left`
        : minutesToStart > 1
          ? `${minutesToStart} min left`
          : minutesToStart === 1
            ? "1 min left"
            : "Ready now";
  const countdownUrgent = minutesToStart !== null && minutesToStart <= 15;
  const slotEndMs =
    slotStartMs > 0
      ? slotStartMs + Math.max(1, Number(activeSlot?.durationMin || 1)) * 60000
      : 0;

  const slotIsLiveNow =
    !!currentLiveSlot ||
    (
      slotStartMs > 0 &&
      slotEndMs > 0 &&
      nowMs >= slotStartMs &&
      nowMs <= slotEndMs
    );

  useEffect(() => {
    if (!isLiveNow) return;

    const removeId = String((item as any)?.sourceScheduleId || item.id || "");
    const allSlotsExpired =
      Array.isArray(scheduleSlots) &&
      scheduleSlots.length > 0 &&
      scheduleSlots.every((slot: any) => {
        const start = parseSlotStartMs(slot);
        const dur = Math.max(1, Number(slot?.durationMin || 1));
        const end = start > 0 ? start + dur * 60000 : 0;
        return end > 0 && nowMs > end;
      });

    const expiredByEnd =
      (!!slotEndMs && slotEndMs > 0 && nowMs > slotEndMs) ||
      allSlotsExpired ||
      (isLiveNow && scheduleSlots.length > 0 && !activeSlot);

    if (!expiredByEnd) return;

    feedRemoveScheduleMirrors(removeId);

    console.log("KRISTO_EXPIRED_LIVE_REMOVED", {
      removeId,
      expiredByEnd,
      slotEndMs,
      nowMs,
    });
  }, [isLiveNow, nowMs, slotEndMs, item]);

  const livePhaseAccent =
    myClaimedSlotPhase === "live"
      ? "#F7D36A"
      : myClaimedSlotPhase === "ready"
        ? "#F59E0B"
        : eventPhase === "live"
          ? "#FF375F"
          : eventPhase === "between-slots"
            ? "#FB7185"
            : eventPhase === "upcoming"
              ? "#38BDF8"
              : "#FFFFFF";

  const livePhaseLabel =
    myClaimedSlotPhase === "live"
      ? "YOUR SLOT LIVE"
      : myClaimedSlotPhase === "ready"
        ? "YOUR SLOT READY"
        : eventPhase === "live"
          ? "EVENT LIVE"
          : eventPhase === "between-slots"
            ? "NEXT SLOT SOON"
            : eventPhase === "upcoming"
              ? "UPCOMING EVENT"
              : "";

  const countdownLive =
    msUntilStart !== null &&
    msUntilStart <= 15000 &&
    (slotEndMs <= 0 || nowMs <= slotEndMs);
  const canUnclaim = claimedByMe && !countdownLive && !slotLocked;
  const liveActionLabel =
    countdownLive
      ? "Enter Live"
      : minutesToStart !== null && minutesToStart <= 15
        ? "Enter Ready Room"
        : countdownLabel;

  const slotProgress =
    activeSlot?.durationMin && minutesToStart !== null
      ? Math.max(0, Math.min(1, 1 - minutesToStart / Math.max(1, Number(activeSlot.durationMin))))
      : 0;
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [typedCount, setTypedCount] = useState(0);
  const [deleteFromLeft, setDeleteFromLeft] = useState(0);
  const likeScale = useRef(new Animated.Value(1)).current;
  const likeRipple = useRef(new Animated.Value(0)).current;

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  const commentInputRef = useRef<TextInput | null>(null);
  const sendingCommentRef = useRef(false);

  async function loadComments() {
    try {
      setCommentsLoading(true);

      const session = getSessionSync() as any;

      const r = await fetch(
        `${process.env.EXPO_PUBLIC_API_BASE}/api/church/feed?id=${encodeURIComponent(String(feedActionId || ""))}`,
        {
          headers: {
            accept: "application/json",
            ...getKristoHeaders({
              userId: session?.userId || "",
              role: session?.role || "Member",
              churchId: session?.churchId || "",
            }),
          },
        }
      );

      const j = await r.json().catch(() => ({}));

      if (r.ok && j?.ok) {
        const rows = Array.isArray(j?.data?.comments)
          ? j.data.comments
          : [];

        setComments(rows);
      }
    } catch (e) {
      console.log("KRISTO_LOAD_COMMENTS_ERROR", e);
    } finally {
      setCommentsLoading(false);
    }
  }

  async function openComments() {
    const session = getSessionSync() as any;
    if (!userHasActiveChurchMembership(session)) {
      Alert.alert("Join a church to comment.");
      return;
    }

    setCommentsOpen(true);
    await loadComments();
  }

  async function toggleCommentLike(commentId: string) {
    try {
      const session = getSessionSync() as any;

      const r = await fetch(
        `${process.env.EXPO_PUBLIC_API_BASE}/api/church/feed`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...getKristoHeaders({
              userId: session?.userId || "",
              role: session?.role || "Member",
              churchId: session?.churchId || "",
            }),
          },
          body: JSON.stringify({
            action: "toggle_comment_like",
            commentId,
          }),
        }
      );

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        console.log("KRISTO_COMMENT_LIKE_FAILED", j);
        return;
      }

      await loadComments();
    } catch (e) {
      console.log("KRISTO_COMMENT_LIKE_ERROR", e);
    }
  }

  async function sendComment() {
    if (sendingCommentRef.current) return;

    const text = String(commentText || "").trim();

    const session = getSessionSync() as any;
    if (!userHasActiveChurchMembership(session)) {
      Alert.alert("Join a church to comment.");
      return;
    }

    if (!text) return;

    sendingCommentRef.current = true;

    try {
      setSendingComment(true);

      const r = await fetch(
        `${process.env.EXPO_PUBLIC_API_BASE}/api/church/feed`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...getKristoHeaders({
              userId: session?.userId || "",
              role: session?.role || "Member",
              churchId: session?.churchId || "",
            }),
          },
          body: JSON.stringify(
            replyTo
              ? {
                  action: "add_reply",
                  postId: feedActionId,
                  parentCommentId: replyTo.id,
                  text,
                }
              : {
                  action: "add_comment",
                  postId: feedActionId,
                  text,
                }
          ),
        }
      );

      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j?.ok) {
        console.log("KRISTO_SEND_COMMENT_FAILED", j);
        return;
      }

      const detectedLanguage = detectLanguage(text);
      const wordScores = tokenizeInterest(text);

      const mediaKey = String(
        item.actorLabel ||
        item.churchLabel ||
        (item as any).scheduleType ||
        "general"
      ).toLowerCase();

      const geoKey = [
        (item as any).churchNormalizedCountry || (item as any).churchCountry || "",
        (item as any).churchNormalizedProvince || (item as any).churchProvince || "",
        (item as any).churchNormalizedCity || (item as any).churchCity || "",
      ].filter(Boolean).join("|").toLowerCase();

      recordForYouSignal(feedActionId, {
        commentedCount: 1,
        lastActionAt: Date.now(),
        languageScores: {
          [detectedLanguage]: 1,
          ...Object.fromEntries(wordScores.map((w) => [`kw:${w}`, 1])),
        },
        mediaScores: {
          [mediaKey]: 1,
        },
        geoScores: geoKey ? { [geoKey]: 1 } : {},
      });

      setCommentText("");
      setReplyTo(null);

      await loadComments();
      requestAnimationFrame(() => {
        commentInputRef.current?.focus();
      });
    } catch (e) {
      console.log("KRISTO_SEND_COMMENT_ERROR", e);
    } finally {
      sendingCommentRef.current = false;
      setSendingComment(false);
    }
  }



  const showBodyReadMore = body.length > BODY_PREVIEW_CHARS;

  const previewBody =
    bodyExpanded || body.length <= BODY_PREVIEW_CHARS
      ? body
      : body.slice(0, BODY_PREVIEW_CHARS).trimEnd() + "...";

  const titleLimit = Math.min(
    TITLE_PREVIEW_LIMIT,
    (isStrictVideoPost ? displayVideoTitle.toUpperCase() : titleUpper).length
  );
  const titleNeedsReadMore = (
    isStrictVideoPost ? displayVideoTitle.toUpperCase() : titleUpper
  ).length > TITLE_PREVIEW_LIMIT;

  useEffect(() => {
    setTypedCount(0);
    setDeleteFromLeft(0);
    setTitleExpanded(false);
  }, [item.id]);

  useEffect(() => {
    if (isActive) return;
    setTypedCount(0);
    setDeleteFromLeft(0);
    setTitleExpanded(false);
  }, [isActive, item.id]);

  useEffect(() => {
    const sequenceTitleUpper = isStrictVideoPost
      ? displayVideoTitle.toUpperCase()
      : titleUpper;

    if (!sequenceTitleUpper || titleExpanded || !isActive) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const typeNext = (n: number) => {
      if (cancelled) return;
      const next = Math.min(titleLimit, n + 1);
      setTypedCount(next);

      if (next < titleLimit) {
        timer = setTimeout(() => typeNext(next), TITLE_TYPE_MS);
        return;
      }

      timer = setTimeout(() => deleteNext(0), TITLE_HOLD_MS);
    };

    const deleteNext = (removed: number) => {
      if (cancelled) return;
      const nextRemoved = Math.min(titleLimit, removed + 1);
      setDeleteFromLeft(nextRemoved);

      if (nextRemoved < titleLimit) {
        timer = setTimeout(() => deleteNext(nextRemoved), TITLE_DELETE_MS);
      }
    };

    timer = setTimeout(() => typeNext(0), 220);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    titleUpper,
    displayVideoTitle,
    isStrictVideoPost,
    titleExpanded,
    isActive,
    titleLimit,
  ]);


  useEffect(() => {
    likeScale.stopAnimation();
    likeRipple.stopAnimation();

    if (displayLiked) {
      likeScale.setValue(0.64);
      likeRipple.setValue(0.10);

      Animated.parallel([
        Animated.sequence([
          Animated.timing(likeScale, {
            toValue: 1.40,
            duration: 165,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.spring(likeScale, {
            toValue: 1,
            friction: 2.8,
            tension: 230,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(likeRipple, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(likeRipple, {
            toValue: 0,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(likeScale, {
          toValue: 1,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(likeRipple, {
          toValue: 0,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [item.liked, likeScale, likeRipple]);

  const animatedTitle =
    titleExpanded
      ? (isStrictVideoPost ? displayVideoTitle.toUpperCase() : titleUpper)
      : (isStrictVideoPost ? displayVideoTitle.toUpperCase() : titleUpper)
          .slice(deleteFromLeft, Math.max(deleteFromLeft, typedCount))
          .trim();

  const titleFinishedClosing =
    !titleExpanded &&
    titleNeedsReadMore &&
    typedCount >= titleLimit &&
    deleteFromLeft >= titleLimit;

  const titleFullyHidden =
    !titleExpanded &&
    typedCount >= titleLimit &&
    deleteFromLeft >= titleLimit;

  const showTitle =
    showVideoMetaChrome && !!displayVideoTitle && !titleFullyHidden;
  const showCaption =
    showVideoMetaChrome && titleFullyHidden && !!displayVideoCaption;

  useEffect(() => {
    if (!isStrictVideoPost || !isMediaPost) return;

    const session = getSessionSync() as any;
    const viewerChurchId = String(session?.churchId || "").trim();
    const isVerifiedChurchId = Boolean(
      displayChurchId &&
      viewerChurchId &&
      displayChurchId === viewerChurchId
    );
    const isSameChurch = isVerifiedChurchId;

    console.log("KRISTO_CHURCH_MEDIA_OVERLAY_SOURCE", {
      postId: String(item.id || ""),
      churchName: String((item as any)?.churchName || ""),
      churchLabel: String((item as any)?.churchLabel || ""),
      churchId: String((item as any)?.churchId || ""),
      mediaName: String((item as any)?.mediaName || ""),
      actorLabel: String((item as any)?.actorLabel || ""),
      title: String(item.title || ""),
      postTitle: String((item as any)?.postTitle || ""),
      caption: String(item.caption || ""),
      body: String(item.body || ""),
      description: String(item.description || ""),
    });

    if (displayChurchId && !isVerifiedChurchId) {
      console.log("KRISTO_FEED_CHURCH_ID_HIDDEN_UNVERIFIED", {
        postId: String(item.id || ""),
        displayChurchId,
        viewerChurchId,
        churchName: displayChurchName,
        reason: "church_id_not_verified_from_session",
      });
    }

    console.log("KRISTO_FEED_CHURCH_ACTION_GATE", {
      postId: String(item.id || ""),
      churchId: displayChurchId,
      churchName: displayChurchName,
      viewerChurchId,
      isSameChurch,
      showFollow: !isSameChurch,
      showViewProfile: isSameChurch,
      churchIdShown: false,
    });
  }, [
    isStrictVideoPost,
    isMediaPost,
    item.id,
    item.title,
    item.body,
    item.caption,
    item.description,
    displayVideoTitle,
    displayVideoCaption,
    displayChurchId,
    displayChurchName,
    item,
  ]);

  const logVideoMetaLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!isStrictVideoPost || !__DEV__) return;
      console.log("KRISTO_VIDEO_META_LAYOUT", {
        postId: item.id,
        overlayHeight: Math.round(e.nativeEvent.layout.height),
        titleLines: title && !titleFullyHidden ? 1 : 0,
        hasCaption: Boolean(body),
      });
    },
    [isStrictVideoPost, item.id, title, body, titleFullyHidden]
  );

  async function onShare() {
    try {
      const msg = [title, body].filter(Boolean).join("\n\n").trim() || "Kristo App post";
      const res = await Share.share({ message: msg });
      if (res.action === Share.sharedAction) {
        undefined;
      }
    } catch {}
  }

  function openLiveRoom() {
    // Stop heavy Home feed work immediately before entering live room.
    (globalThis as any).__KRISTO_LIVE_ACTIVE__ = true;
    (globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ =
      Math.max(1, Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0));

    const liveRoomParams = (item as any)?.liveRoomParams || {};
    const isScheduleSlotLive =
      String((item as any)?.scheduleType || "").includes("media-live") ||
      Array.isArray((item as any)?.scheduleSlots);

    const scheduleFeedId = baseFeedId(
      liveRoomParams.liveId ||
      liveRoomParams.feedId ||
      liveRoomParams.sourceScheduleId ||
      (item as any)?.sourceScheduleId ||
      item.id ||
      "media-live-default"
    );

    const allScheduleSlotsForLive = normalizeLiveScheduleSlots(
      Array.isArray((item as any)?.allScheduleSlotsForLive)
        ? (item as any).allScheduleSlotsForLive
        : Array.isArray((item as any)?.liveAllScheduleSlots)
          ? (item as any).liveAllScheduleSlots
          : allScheduleSlots.length
            ? allScheduleSlots
            : scheduleSlots
    );

    const liveAllScheduleSlotsJson =
      liveRoomParams.liveAllScheduleSlotsJson ||
      (allScheduleSlotsForLive.length
        ? JSON.stringify(allScheduleSlotsForLive)
        : "");

    const claimedRouteSlotNumber = Number(
      liveRoomParams.claimedSlotNumber ||
      liveRoomParams.preferredSlotNumber ||
      (item as any)?.liveSlotNumber ||
      0
    );

    const activeRouteSlotNumber = Number(
      String(activeSlot?.slot || activeSlot?.slotNumber || activeSlot?.order || activeSlot?.slotLabel || "")
        .match(/\d+/)?.[0] || 0
    );

    const effectiveRoomSlot =
      myClaimedSlot ||
      currentLiveSlot ||
      nextUpcomingSlot ||
      activeSlot;

    const slotNumber = Number(
      String(
        effectiveRoomSlot?.slot ||
        effectiveRoomSlot?.slotNumber ||
        effectiveRoomSlot?.order ||
        ""
      ).match(/\d+/)?.[0] || 1
    );

    const pickLiveRoomChurchLabel = (...values: unknown[]) => {
      for (const value of values) {
        const label = String(value || "").trim();
        if (!label) continue;
        if (/^CH\d+-[A-Z0-9]+$/i.test(label)) continue;
        return label;
      }
      return "MY CHURCH";
    };

    const resolvedMediaName = String(
      liveRoomParams.mediaName ||
        (item as any)?.liveMediaName ||
        (item as any)?.mediaName ||
        item.actorLabel ||
        "Church Media"
    ).trim();

    const resolvedChurchName = pickLiveRoomChurchLabel(
      liveRoomParams.churchName,
      liveRoomParams.churchLabel,
      (item as any)?.churchName,
      (item as any)?.churchLabel
    );

    const resolvedTitle = String(
      liveRoomParams.title ||
        (activeSlot as any)?.name ||
        (item as any)?.title ||
        resolvedMediaName ||
        "Church Live"
    ).trim();

    console.log("KRISTO_LIVE_ROOM_FAST_OPEN", {
      feedId: scheduleFeedId,
      slotCount: allScheduleSlotsForLive.length,
      slotNumber,
      claimedByMe,
      countdownLive,
      hasLiveAllScheduleSlotsJson: !!liveAllScheduleSlotsJson,
    });

    router.push({
      pathname: liveRoomPath as any,
      params: {
        ...liveRoomParams,
        source: liveRoomParams.source || "media",
        liveMode: isScheduleSlotLive ? "schedule" : (liveRoomParams.liveMode || "instant"),
        layout: isScheduleSlotLive ? "grid6" : (liveRoomParams.layout || "focus"),
        role: claimedByMe && countdownLive ? "host" : (liveRoomParams.role || "viewer"),
        mode: claimedByMe && countdownLive ? "host" : (liveRoomParams.mode || "viewer"),
        entryMode: liveRoomParams.entryMode || "live",
        room: liveRoomParams.room || "media",
        mediaName: resolvedMediaName,
        churchName: resolvedChurchName,
        churchLabel: liveRoomParams.churchLabel || resolvedChurchName,
        actorLabel: String(liveRoomParams.actorLabel || item.actorLabel || resolvedMediaName || ""),
        churchId: liveRoomParams.churchId || (item as any)?.churchId || "",
        liveId: scheduleFeedId,
        feedId: scheduleFeedId,
        sourceScheduleId: scheduleFeedId,
        ...buildLiveRoomAuthorityParams(item as any),
        mediaOwnerPastorUserId: buildLiveRoomAuthorityParams(item as any).actualChurchPastorUserId,
        preferredSlotNumber: liveRoomParams.preferredSlotNumber || String(slotNumber),
        currentSlotNumber: liveRoomParams.currentSlotNumber || String(slotNumber),
        claimedSlotNumber: String(slotNumber),
        scheduleStartMs: liveRoomParams.scheduleStartMs || String(slotStartMs || ""),
        scheduleEndMs: liveRoomParams.scheduleEndMs || String(slotEndMs || ""),
        liveAllScheduleSlotsJson,
        title: resolvedTitle,
        claimedByName: liveRoomParams.claimedByName || (item as any)?.liveClaimName || (activeSlot as any)?.claimedByName || claimedName || "",
        liveClaimName: liveRoomParams.liveClaimName || liveRoomParams.claimedByName || (item as any)?.liveClaimName || claimedName || "",
        claimedByAvatar: liveRoomParams.claimedByAvatar || (activeSlot as any)?.claimedByAvatar || (activeSlot as any)?.avatarUri || "",
        claimedByUserId: String(liveRoomParams.claimedByUserId || (activeSlot as any)?.claimedByUserId || ""),
        mediaSlotPublisher: claimedByMe && countdownLive ? "1" : "0",
        canPublish: claimedByMe && countdownLive ? "1" : "0",
        canPublishCamera: claimedByMe && countdownLive ? "1" : "0",
        canPublishMic: claimedByMe && countdownLive ? "1" : "0",
      },
    } as any);
  }

  if (isLiveNow && claimedByMe) {
    return null;
  }

  if (isLiveNow) {
    const liveName = String(
      (item as any)?.liveClaimName ||
      (item as any)?.claimedByName ||
      claimedName ||
      (item as any)?.mediaName ||
      (item as any)?.actorLabel ||
      title ||
      "Live"
    ).trim();
    const liveTopic = String(
      (item as any)?.liveTopic ||
      (activeSlot as any)?.script ||
      (activeSlot as any)?.task ||
      (activeSlot as any)?.role ||
      body ||
      (item as any)?.topic ||
      "Live media topic"
    ).split("\n").join(" ").trim();

    const liveSlotIndex = activeSlot
      ? Math.max(0, scheduleSlots.findIndex((slot: any) => String(slot?.id || "") === String(activeSlot?.id || "")))
      : -1;

    const liveSlotNumber = liveSlotIndex >= 0 ? liveSlotIndex + 1 : Number(activeSlot?.slot || activeSlot?.slotNumber || 1);
    const liveSlotTotal = Math.max(1, scheduleSlots.length || Number((item as any)?.slotFeedTotal || 1));

    const liveRemainingMin =
      slotEndMs > 0
        ? Math.max(0, Math.ceil((slotEndMs - nowMs) / 60000))
        : 0;

    const liveRemainingLabel =
      Number((item as any)?.liveRemainingMin || 0) > 0
        ? `${Number((item as any).liveRemainingMin)} min`
        : liveRemainingMin > 0
          ? `${liveRemainingMin} min`
          : "Ending";

    const liveSlotLabel = String((item as any)?.liveSlotNumber && (item as any)?.liveSlotTotal
      ? `${(item as any).liveSlotNumber}/${(item as any).liveSlotTotal}`
      : `${liveSlotNumber}/${liveSlotTotal}`);

    const liveTimeLabel = String(
      (item as any)?.liveTimeLabel ||
      activeSlot?.timeLabel ||
      ((activeSlot?.startTime || activeSlot?.endTime)
        ? `${activeSlot?.startTime || ""}${activeSlot?.endTime ? " - " + activeSlot.endTime : ""}`
        : "")
    ).trim() || "Live now";

    const liveNextLeft =
      typeof (item as any)?.liveSlotsRemaining === "number"
        ? Number((item as any).liveSlotsRemaining)
        : scheduleSlots.filter((slot: any) => {
            const start = parseSlotStartMs(slot);
            return start > nowMs;
          }).length;

    const liveNextLabel = `${liveNextLeft} left`;

    return (
      <View style={[s.slide, { height }]}>
        <LinearGradient colors={["#050814", "#080817", "#03050C"]} style={StyleSheet.absoluteFillObject} />

        <View style={s.liveNowPremiumOuter}>
          <View style={s.liveNowPremiumGlowLeft} />
          <View style={s.liveNowPremiumGlowRight} />

          <View style={s.liveNowPremiumHeader}>
            <View style={s.liveNowPremiumIcon}>
              <Ionicons name="radio-outline" size={34} color="#FF8A8A" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={s.liveNowPremiumKicker}>LIVE NOW</Text>
              <Text style={s.liveNowPremiumName} numberOfLines={1}>{liveName}</Text>
              <Text style={s.liveNowPremiumTopic} numberOfLines={1}>{liveTopic}</Text>
            </View>
          </View>

          <Pressable onPress={openLiveRoom} style={s.liveNowPremiumPreview}>
            {isStrictVideoPost && shouldKeepVideoMounted ? (
              <FeedVideoSurface
                postId={String(item.id || "")}
                feedIndex={feedIndex}
                uri={feedVideoPlayUri(item)}
                posterUri={resolveFeedVideoPoster(item)}
                shouldPlay={shouldPlayVideo}
                interactive={shouldPlayVideo}
                playbackMeta={playbackMeta}
                onDoubleTapLike={triggerVideoDoubleTapLike}
              />
            ) : item.mediaType === "image" && item.mediaUri ? (
              <Image
                source={{ uri: item.mediaUri }}
                style={s.liveNowPremiumPreviewImg}
                resizeMode="cover"
              />
            ) : isActive && screenFocused ? (
              <View style={s.liveNowVideoPlaceholder}>
                <Ionicons name="radio" size={80} color="#FF4D57" />
                <Text style={s.liveNowVideoPlaceholderText}>LIVE VIDEO</Text>
              </View>
            ) : (
              <View style={s.liveNowVideoPlaceholder}>
                <Ionicons name="radio" size={80} color="#FF4D57" />
                <Text style={s.liveNowVideoPlaceholderText}>LIVE VIDEO</Text>
              </View>
            )}

            <View style={s.liveNowPremiumLivePill}>
              <Text style={s.liveNowPremiumLivePillText}>LIVE</Text>
            </View>
          </Pressable>

          <View style={s.liveNowPremiumStatsRow}>
            <View style={s.liveNowPremiumStatBox}>
              <Text style={s.liveNowPremiumStatLabel}>REMAINING</Text>
              <Text style={s.liveNowPremiumStatValue}>{liveRemainingLabel}</Text>
            </View>

            <View style={s.liveNowPremiumStatBox}>
              <Text style={s.liveNowPremiumStatLabel}>SLOT</Text>
              <Text style={s.liveNowPremiumStatValue}>{liveSlotLabel}</Text>
            </View>
          </View>

          <View style={s.liveNowPremiumTimeBox}>
            <View>
              <Text style={s.liveNowPremiumTimeLabel}>TIME</Text>
              <Text style={s.liveNowPremiumTimeValue}>{liveTimeLabel}</Text>
            </View>
            <Text style={s.liveNowPremiumEnds}>{liveNextLabel}</Text>
          </View>

          <Pressable onPress={openLiveRoom} style={({ pressed }) => [s.liveNowPremiumBtn, pressed ? s.pressed : null]}>
            <Ionicons name="play" size={28} color="#fff" />
            <Text style={s.liveNowPremiumBtnText}>WATCH LIVE</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.slide, isDedicatedScheduleSlide ? s.scheduleOnlySlide : null, { height }]}>
      {isDedicatedScheduleSlide ? (
        <>
          <LinearGradient
            colors={["#030508", "#0A0F18", "#050810"]}
            style={StyleSheet.absoluteFillObject}
          />
          <HomeLiveScheduleCard
            item={item}
            activeSlot={activeSlot}
            slotFeedIndex={slotFeedIndex}
            slotFeedTotal={slotFeedTotal}
            nowMs={nowMs}
            isActive={isActive}
            fullBleed
            profileName={profileName}
            profileAvatarUri={profileAvatarUri}
            onSkipSlots={onSkipSlots}
            onOpenLiveRoom={openLiveRoom}
            onOptimisticClaim={onOptimisticSlotClaim}
            displayLiked={displayLiked}
            likeCount={likeCount}
            localSaved={localSaved}
            onLike={() => {
              if (isBackendFeedPost) {
                const nextLiked = !displayLiked;
                const nextCount = Math.max(0, Number(likeCount || 0) + (nextLiked ? 1 : -1));
                onOptimisticBackendLike?.(feedActionId, nextLiked, nextCount);
                syncBackendLike(feedActionId, nextLiked);
              } else {
                feedToggleLike(item.id);
              }
            }}
            onComment={openComments}
            onShare={onShare}
            onToggleSave={() => {
              setLocalSaved((v) => !v);
              feedToggleSave(item.id);
            }}
          />
        </>
      ) : (
      <Pressable onPress={isLiveNow ? openLiveRoom : undefined} style={s.page}>
        {isStrictVideoPost && shouldKeepVideoMounted ? (
          <FeedVideoSurface
            postId={String(item.id || "")}
            feedIndex={feedIndex}
            uri={feedVideoPlayUri(item)}
            posterUri={resolveFeedVideoPoster(item)}
            shouldPlay={shouldPlayVideo}
            interactive={shouldPlayVideo}
            playbackMeta={playbackMeta}
            onDoubleTapLike={triggerVideoDoubleTapLike}
            onVideoReadyChange={
              !activeSlot ? handleFeedVideoReady : undefined
            }
          />
        ) : item.mediaType === "image" && item.mediaUri ? (
          <FeedSmartImage
            uri={item.mediaUri}
            itemId={String(item.id || "")}
            item={item}
            isActive={isActive}
          />
        ) : isMediaSchedulePost && activeSlot ? null : (
        <View style={[s.noMediaBg, { borderColor: feedHeadlineColor }]}>
          <View style={[s.noMediaGlow, { backgroundColor: feedHeadlineColor }]} />
          <View style={[
            s.noMediaCard,
            noMediaLongText ? s.noMediaCardLarge : s.noMediaCardCompact,
            { borderColor: feedHeadlineColor, backgroundColor: noMediaCardBg }
          ]}>
            <View style={s.noMediaTopRow}>
              <FeedMediaAvatar uri={actorAvatarUri} initial={mediaInitial} />

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[
                    s.noMediaCategory,
                    { color: feedHeadlineColor }
                  ]}
                  numberOfLines={1}
                >
                  {feedHeadline}
                </Text>

                {!!feedSubline ? (
                <Text
                  style={s.noMediaAuthor}
                  numberOfLines={1}
                >
                  {feedSubline}
                </Text>
                ) : null}
              </View>
            </View>

            {!!title ? (
              <Text style={[s.noMediaTitle, { backgroundColor: noMediaSoftBg, borderColor: feedHeadlineColor }]} numberOfLines={2}>
                {titleUpper}
              </Text>
            ) : null}

            {!!body ? (
              <>
                <Text style={s.noMediaCaption} numberOfLines={bodyExpanded ? 10 : 4}>
                  {bodyExpanded ? body : noMediaPreviewBody}
                </Text>

                {body.length > 260 ? (
                  <Pressable onPress={() => setBodyExpanded((v) => !v)} style={s.noMediaViewMoreBtn}>
                    <Text style={[s.noMediaViewMoreText, { color: feedHeadlineColor }]}>
                      {bodyExpanded ? "Show less" : "View more"}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            <View style={s.noMediaActionsRow}>

              <Pressable
                style={s.noMediaActionBtn}
                hitSlop={12}
                onPress={() => {
                  if (isBackendFeedPost) {
                    const nextLiked = !displayLiked;
                    const nextCount = Math.max(0, Number(likeCount || 0) + (nextLiked ? 1 : -1));
                    onOptimisticBackendLike?.(feedActionId, nextLiked, nextCount);
                    syncBackendLike(feedActionId, nextLiked);
                  } else {
                    recordForYouSignal(item.id, { likedCount: 1, lastActionAt: Date.now() });
              feedToggleLike(item.id);
                  }
                }}
              >
                <Ionicons
                  name={displayLiked ? "heart" : "heart-outline"}
                  size={23}
                  color={displayLiked ? "#FF4D6D" : "#FFFFFF"}
                />
                <Text style={s.noMediaActionText}>
                  {likeCount}
                </Text>
              </Pressable>

              <Pressable style={s.noMediaActionBtn} hitSlop={12} onPress={openComments}>
                <Ionicons
                  name="chatbubble-outline"
                  size={22}
                  color="#FFFFFF"
                />
                <Text style={s.noMediaActionText}>
                  {Number((item as any)?.commentCount || 0)}
                </Text>
              </Pressable>

              <Pressable style={s.noMediaActionBtn} hitSlop={12} onPress={onShare}>
                <Ionicons
                  name="arrow-redo-outline"
                  size={24}
                  color="#FFFFFF"
                />
                <Text style={s.noMediaActionText}>
                  {Number((item as any)?.shareCount || 0)}
                </Text>
              </Pressable>

              <Pressable
                style={s.noMediaActionBtn}
                hitSlop={12}
                onPress={() => {
                  setLocalSaved((v) => !v);
                  feedToggleSave(item.id);
                }}
              >
                <Ionicons
                  name={localSaved ? "bookmark" : "bookmark-outline"}
                  size={23}
                  color="#FFFFFF"
                />
              </Pressable>

            </View>
          </View>
        </View>
      )}

      {showVideoMetaChrome ? (
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFillObject, { opacity: videoMetaFade }]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={[
              "rgba(0,0,0,0.18)",
              "rgba(0,0,0,0.0)",
              "rgba(0,0,0,0.20)",
              "rgba(0,0,0,0.58)",
            ]}
            locations={[0, 0.45, 0.78, 1]}
            style={s.overlay}
          />

          <View style={[s.bottom, s.bottomVideoMeta]}>
            <View
              key={`video-meta-${item.id}`}
              style={s.videoMetaPanel}
              onLayout={logVideoMetaLayout}
            >
              <View style={[s.identityRow, s.videoIdentityRow]}>
                <FeedMediaAvatar
                  key={`video-meta-avatar-${item.id}`}
                  uri={actorAvatarUri}
                  initial={mediaInitial}
                  live={Boolean(isLiveNow || (item as any)?.isLiveNow)}
                />

                <View style={s.videoIdentityTextWrap}>
                  <Text
                    style={[s.videoChurchPrimary, s.videoMetaText]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                  >
                    {feedHeadline}
                  </Text>
                  {isMediaPost && hasDisplayMediaName ? (
                    <Text style={[s.videoDepartmentLabel, s.videoMetaText]} numberOfLines={1}>
                      {displayMediaName}
                    </Text>
                  ) : !isMediaPost && !!feedSubline ? (
                    <Text style={[s.videoMediaSecondary, s.videoMetaText]} numberOfLines={1}>
                      {feedSubline}
                    </Text>
                  ) : null}
                </View>
              </View>

              {showTitle ? (
                <View style={s.videoTitleSlot}>
                  <Text
                    style={[s.title, s.videoMetaText, s.videoTitleText]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {animatedTitle}
                  </Text>
                </View>
              ) : null}

              {showCaption ? (
                <View
                  style={[
                    s.videoCaptionSlot,
                    bodyExpanded ? s.videoCaptionSlotExpanded : null,
                  ]}
                >
                  <Text
                    style={[s.videoCaption, s.videoMetaText]}
                    numberOfLines={bodyExpanded ? 3 : 2}
                    ellipsizeMode="tail"
                  >
                    {previewBody}
                  </Text>
                </View>
              ) : null}

              {showCaption && showBodyReadMore && !isLiveNow ? (
                <Pressable onPress={() => setBodyExpanded((v) => !v)} style={s.readMoreBtn}>
                  <Text style={s.readMoreText}>
                    {bodyExpanded ? "Show less" : "Read more"}
                  </Text>
                </Pressable>
              ) : null}

              {isLiveNow ? (
                <Pressable onPress={openLiveRoom} style={s.watchLiveBtn}>
                  <Ionicons name="radio-outline" size={19} color="#06101E" />
                  <Text style={s.watchLiveText}>WATCH LIVE</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Animated.View>
      ) : null}

      {!isStrictVideoPost || activeSlot ? (
        <>
      <LinearGradient
        pointerEvents="none"
        colors={
          isStrictVideoPost
            ? ["rgba(0,0,0,0.0)", "rgba(0,0,0,0.0)", "rgba(0,0,0,0.20)", "rgba(0,0,0,0.50)"]
            : ["rgba(0,0,0,0.08)", "rgba(0,0,0,0.18)", "rgba(0,0,0,0.55)", "rgba(0,0,0,0.82)"]
        }
        locations={isStrictVideoPost ? [0, 0.55, 0.82, 1] : [0, 0.45, 0.72, 1]}
        style={s.overlay}
      />

      <View
        style={[
          s.bottom,
          isStrictVideoPost && !activeSlot ? s.bottomVideoMeta : null,
        ]}
      >
        {showBottomMeta ? (
          <>
            {!activeSlot && !isStrictVideoPost ? (
                <View style={s.identityRow}>
                  <FeedMediaAvatar
                    uri={actorAvatarUri}
                    initial={mediaInitial}
                    live={Boolean(isLiveNow || (item as any)?.isLiveNow)}
                  />

                  <View style={s.identityTextWrap}>
                    <Text style={[s.identityRole, { color: feedHeadlineColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                      {feedHeadline}
                    </Text>
                    <Text style={s.identityChurch} numberOfLines={1}>
                      {feedSubline}
                    </Text>
                  </View>
                </View>
            ) : null}

            {!activeSlot && !isStrictVideoPost && !!title && !titleFullyHidden ? (
              <View style={s.titleRow}>
                <Text
                  style={s.title}
                  numberOfLines={1}
                  ellipsizeMode="clip"
                >
                  {animatedTitle}
                </Text>
              </View>
            ) : null}

            {!activeSlot && !isStrictVideoPost && !!body && titleFullyHidden ? (
              <Text
                style={s.body}
                numberOfLines={bodyExpanded ? undefined : 3}
                ellipsizeMode="tail"
              >
                {previewBody}
              </Text>
            ) : null}

            {!activeSlot && !isStrictVideoPost && titleFullyHidden && showBodyReadMore && !isLiveNow ? (
              <Pressable onPress={() => setBodyExpanded((v) => !v)} style={s.readMoreBtn}>
                <Text style={s.readMoreText}>
                  {bodyExpanded ? "Show less" : "Read more"}
                </Text>
              </Pressable>
            ) : null}

            {!activeSlot && !isStrictVideoPost && isLiveNow ? (
              <Pressable onPress={openLiveRoom} style={s.watchLiveBtn}>
                <Ionicons name="radio-outline" size={19} color="#06101E" />
                <Text style={s.watchLiveText}>WATCH LIVE</Text>
              </Pressable>
            ) : null}

            {activeSlot && !isLiveNow ? (
              <View style={s.liveFullFrame}>
                <HomeLiveScheduleCard
                  item={item}
                  activeSlot={activeSlot}
                  slotFeedIndex={slotFeedIndex}
                  slotFeedTotal={slotFeedTotal}
                  nowMs={nowMs}
                  isActive={isActive}
                  profileName={profileName}
                  profileAvatarUri={profileAvatarUri}
                  onSkipSlots={onSkipSlots}
                  onOpenLiveRoom={openLiveRoom}
                  onOptimisticClaim={onOptimisticSlotClaim}
                  displayLiked={displayLiked}
                  likeCount={likeCount}
                  localSaved={localSaved}
                  onLike={() => {
                    if (isBackendFeedPost) {
                      const nextLiked = !displayLiked;
                      const nextCount = Math.max(0, Number(likeCount || 0) + (nextLiked ? 1 : -1));
                      onOptimisticBackendLike?.(feedActionId, nextLiked, nextCount);
                      syncBackendLike(feedActionId, nextLiked);
                    } else {
                      feedToggleLike(item.id);
                    }
                  }}
                  onComment={openComments}
                  onShare={onShare}
                  onToggleSave={() => {
                    setLocalSaved((v) => !v);
                    feedToggleSave(item.id);
                  }}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </View>
        </>
      ) : null}
      {activeSlot && isLiveNow ? (
        <View pointerEvents="box-none" style={s.slotActions}>
          <Pressable
            hitSlop={16}
            onPress={() => {
            if ((item as any)?.isBackendPost) {
              const nextLiked = !displayLiked;
              const nextCount = Math.max(0, Number(likeCount || 0) + (nextLiked ? 1 : -1));
              onOptimisticBackendLike?.(feedActionId, nextLiked, nextCount);
              recordForYouSignal(feedActionId, { likedCount: nextLiked ? 1 : 0, lastActionAt: Date.now() });
              syncBackendLike(feedActionId, nextLiked);
            } else {
              recordForYouSignal(feedActionId, { likedCount: 1, lastActionAt: Date.now() });
              feedToggleLike(feedActionId);
            }
          }}
            style={({ pressed }) => [s.slotActionBtn, displayLiked ? s.slotActionBtnWatch : null, pressed ? s.pressed : null]}
          >
            <View pointerEvents="none" style={[s.slotActionCircle, displayLiked ? s.slotActionCircleWatch : null]}>
              <Ionicons name={displayLiked ? "heart" : "heart-outline"} size={27} color={displayLiked ? "#FF5A7A" : "#FFFFFF"} />
            </View>
            <Text style={[s.slotActionText, displayLiked ? s.slotActionTextActive : null]}>
              {formatSocialCount(Math.max(likeCount, displayLiked ? 1 : 0))}
            </Text>
          </Pressable>

          <Pressable
            hitSlop={16}
            onPress={openComments}
            style={({ pressed }) => [s.slotActionBtn, pressed ? s.pressed : null]}
          >
            <View pointerEvents="none" style={s.slotActionCircle}>
              <Ionicons name="chatbubble-ellipses-outline" size={27} color="#FFFFFF" />
            </View>
            <Text style={s.slotActionText}>
              {comments.length > 0 ? formatSocialCount(comments.length) : "Chat"}
            </Text>
          </Pressable>

          <Pressable hitSlop={16} onPress={onShare} style={({ pressed }) => [s.slotActionBtn, pressed ? s.pressed : null]}>
            <View pointerEvents="none" style={s.slotActionCircle}>
              <Ionicons name="arrow-redo-outline" size={27} color="#FFFFFF" />
            </View>
            <Text style={s.slotActionText}>Share</Text>
          </Pressable>

          <Pressable
            hitSlop={16}
            onPress={() => {
            if (activeSlot) {
              joinSlotQueue(true);
            } else {
              recordForYouSignal(feedActionId, { savedCount: 1, lastActionAt: Date.now() });
              feedToggleSave(feedActionId);
            }
          }}
            style={({ pressed }) => [s.slotActionBtn, currentUserQueued ? s.slotActionBtnNext : item.saved ? s.slotActionBtnNext : null, pressed ? s.pressed : null]}
          >
            <View pointerEvents="none" style={[s.slotActionCircle, item.saved ? s.slotActionCircleNext : null]}>
              <Ionicons name={currentUserQueued ? "shield-checkmark" : item.saved ? "bookmark" : "bookmark-outline"} size={26} color={currentUserQueued || item.saved ? "#F3D28F" : "#FFFFFF"} />
            </View>
            <Text style={[s.slotActionText, item.saved ? s.slotActionTextNext : null]}>
              {currentUserQueued ? "Queued" : item.saved ? "Next" : "Standby"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!activeSlot && !noMediaPost && !isScheduleCard && isActivePost ? (
      <Animated.View
        pointerEvents="box-none"
        style={[s.actions, isStrictVideoPost ? { opacity: videoMetaFade } : null]}
      >
        <Pressable
          pointerEvents="box-only"
          hitSlop={24}
          style={[s.actionBtn, displayLiked ? s.actionBtnActive : null]}
          onPress={() => {
            if ((item as any)?.isBackendPost) {
              const nextLiked = !displayLiked;
              const nextCount = Math.max(0, Number(likeCount || 0) + (nextLiked ? 1 : -1));
              onOptimisticBackendLike?.(feedActionId, nextLiked, nextCount);
              recordForYouSignal(feedActionId, { likedCount: nextLiked ? 1 : 0, lastActionAt: Date.now() });
              syncBackendLike(feedActionId, nextLiked);
            } else {
              feedToggleLike(item.id);
            }
          }}
        >
          <BlurView pointerEvents="none" intensity={35} tint="dark" style={[s.actionIconWrap, displayLiked ? s.actionIconWrapLiked : null]}>
            <Animated.View
              pointerEvents="none"
              style={[
                s.likeRipple,
                {
                  opacity: likeRipple.interpolate({
                    inputRange: [0, 0.2, 1],
                    outputRange: [0, 0.42, 0],
                  }),
                  transform: [
                    {
                      scale: likeRipple.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.76, 1.82],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Animated.View style={{ transform: [{ scale: likeScale }] }}>
              <Ionicons
                name={displayLiked ? "heart" : "heart-outline"}
                size={28}
                color={displayLiked ? "#FF5A7A" : "#FFFFFF"}
              />
            </Animated.View>
          </BlurView>
          <Text style={[s.actionText, displayLiked ? s.actionTextActive : null]}>
            {likeCount}
          </Text>
        </Pressable>

        <Pressable style={s.actionBtn} onPress={openComments}>
          <BlurView pointerEvents="none" intensity={35} tint="dark" style={s.actionIconWrap}>
            <Ionicons name="chatbubble-ellipses-outline" size={28} color="#FFFFFF" />
          </BlurView>
          <Text style={s.actionText}>{comments.length || ((item as any)?.commentCount ?? 0)}</Text>
        </Pressable>

        <Pressable style={s.actionBtn} onPress={onShare}>
          <BlurView pointerEvents="none" intensity={35} tint="dark" style={s.actionIconWrap}>
            <Ionicons name="arrow-redo-outline" size={28} color="#FFFFFF" />
          </BlurView>
          <Text style={s.actionText}>{(item as any)?.shareCount ?? 0}</Text>
        </Pressable>

        <Pressable
          pointerEvents="box-only"
          hitSlop={24}
          style={[s.actionBtn, item.saved ? s.actionBtnActive : null]}
          onPress={() => feedToggleSave(item.id)}
        >
          <View pointerEvents="none" style={[s.actionIconWrap, item.saved ? s.actionIconWrapSaved : null]}>
            <Ionicons
              name={item.saved ? "bookmark" : "bookmark-outline"}
              size={27}
              color={item.saved ? "#F3D28F" : "#FFFFFF"}
            />
          </View>
          <Text style={[s.actionText, item.saved ? s.actionTextActive : null]}>
            {(item as any)?.saveCount ?? 0}
          </Text>
        </Pressable>
      </Animated.View>
      ) : null}

      </Pressable>
      )}

      <Modal
        visible={commentsOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentsOpen(false)}
      >
        <View style={{
          flex: 1,
          backgroundColor: "#050507",
          paddingTop: Math.max(insets.top + 10, 54),
        }}>
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-around",
            paddingHorizontal: 34,
            marginBottom: 16,
          }}>
            <Text style={{
              color: "#fff",
              fontSize: 20,
              fontWeight: "700",
            }}>
              Comments
            </Text>

            <Pressable onPress={() => setCommentsOpen(false)}>
              <Ionicons name="close" size={30} color="#fff" />
            </Pressable>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
          >
            {commentsLoading ? (
              <ActivityIndicator color="#fff" />
            ) : comments.length ? (
              comments.map((c: any, i: number) => {
                const avatar = mediaUrl(c.authorAvatarUri || c.avatarUri);
                const name = String(c.authorName || c.createdBy || "User");
                const initial = String(c.authorInitial || name.charAt(0) || "U").toUpperCase();
                const replies = Array.isArray(c.replies) ? c.replies : [];

                return (
                  <View
                    key={String(c.id || i)}
                    style={{
                      marginBottom: 8,
                      backgroundColor: "#151518",
                      borderRadius: 33,
                      padding: 12,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                      {avatar ? (
                        <Image
                          source={{ uri: avatar }}
                          style={{ width: 42, height: 42, borderRadius: 21, marginRight: 12 }}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={{
                          width: 42,
                          height: 42,
                          borderRadius: 21,
                          marginRight: 12,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(231,196,111,0.18)",
                          borderWidth: 1,
                          borderColor: "rgba(231,196,111,0.55)",
                        }}>
                          <Text style={{ color: "#E7C46F", fontWeight: "900", fontSize: 18 }}>
                            {initial}
                          </Text>
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 5 }}>
                          <Text style={{ color: "#E7C46F", fontWeight: "900", flex: 1 }} numberOfLines={1}>
                            {name}
                          </Text>
                          <Text style={{ color: "rgba(255,255,255,0.45)", fontWeight: "700", fontSize: 12, marginLeft: 8 }}>
                            {formatFeedCommentTime(c.createdAt)}
                          </Text>
                        </View>

                        <Text style={{ color: "rgba(255,255,255,0.88)", lineHeight: 31, fontSize: 15 }}>
                          {String(c.text || "")}
                        </Text>

                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 20, gap: 18 }}>
                          <Pressable onPress={() => toggleCommentLike(String(c.id || ""))}>
                            <Text style={{ color: c.likedByMe ? "#FF5A7A" : "rgba(255,255,255,0.62)", fontWeight: "800" }}>
                              ♥ {Number(c.likeCount || 0)}
                            </Text>
                          </Pressable>

                          <Pressable onPress={() => setReplyTo(c)}>
                            <Text style={{ color: "#E7C46F", fontWeight: "800" }}>
                              Reply
                            </Text>
                          </Pressable>
                        </View>

                        {replies.map((r: any, ri: number) => {
                          const rName = String(r.authorName || r.createdBy || "User");
                          const rInitial = String(r.authorInitial || rName.charAt(0) || "U").toUpperCase();
                          const rAvatar = mediaUrl(r.authorAvatarUri || r.avatarUri);

                          return (
                            <View
                              key={String(r.id || ri)}
                              style={{
                                flexDirection: "row",
                                marginTop: 14,
                                paddingTop: 12,
                                borderTopWidth: 1,
                                borderTopColor: "rgba(255,255,255,0.14)",
                              }}
                            >
                              {rAvatar ? (
                                <Image
                                  source={{ uri: rAvatar }}
                                  style={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 17,
                                    marginRight: 10,
                                  }}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: 17,
                                  marginRight: 10,
                                  alignItems: "center",
                                  justifyContent: "center",
                                  backgroundColor: "rgba(231,196,111,0.16)",
                                  borderWidth: 1,
                                  borderColor: "rgba(231,196,111,0.45)",
                                }}>
                                  <Text style={{ color: "#E7C46F", fontWeight: "900", fontSize: 12 }}>
                                    {rInitial}
                                  </Text>
                                </View>
                              )}

                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
                                  <Text style={{ color: "#E7C46F", fontWeight: "800", flex: 1 }} numberOfLines={1}>
                                    {rName}
                                  </Text>
                                  <Text style={{ color: "rgba(255,255,255,0.45)", fontWeight: "700", fontSize: 11, marginLeft: 8 }}>
                                    {formatFeedCommentTime(r.createdAt)}
                                  </Text>
                                </View>
                                <Text style={{ color: "rgba(255,255,255,0.74)", lineHeight: 20 }}>
                                  {String(r.text || "")}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={{
                color: "rgba(255,255,255,0.7)",
                textAlign: "center",
                marginTop: 40,
              }}>
                No comments yet
              </Text>
            )}
          </ScrollView>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 14,
                borderTopWidth: 1,
                borderTopColor: "rgba(255,255,255,0.14)",
                backgroundColor: "#0B0B0F",
              }}
              onStartShouldSetResponder={() => true}
            >
              {replyTo ? (
                <View style={{
                  position: "absolute",
                  left: 14,
                  right: 14,
                  top: -42,
                  height: 34,
                  borderRadius: 999,
                  paddingHorizontal: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "rgba(231,196,111,0.16)",
                }}>
                  <Text style={{ color: "#E7C46F", fontWeight: "800" }} numberOfLines={1}>
                    Replying to {String(replyTo.authorName || "User")}
                  </Text>
                  <Pressable onPress={() => setReplyTo(null)}>
                    <Ionicons name="close" size={18} color="#E7C46F" />
                  </Pressable>
                </View>
              ) : null}

              <TextInput
                ref={commentInputRef}
                value={commentText}
                onChangeText={setCommentText}
                onSubmitEditing={() => {
                  void sendComment();
                }}
                blurOnSubmit={false}
                returnKeyType="send"
                placeholder={replyTo ? "Write reply..." : "Write comment..."}
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={{
                  flex: 1,
                  color: "#fff",
                  fontSize: 17,
                  fontWeight: "600",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  borderRadius: 999,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  marginRight: 10,
                }}
              />

              <Pressable
                onPress={() => {
                  void sendComment();
                }}
                hitSlop={14}
                pressRetentionOffset={24}
                disabled={!String(commentText || "").trim()}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#E7C46F",
                }}
              >
                {sendingComment ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Ionicons name="send" size={22} color="#000" />
                )}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
});

const formatFeedCommentTime = (value?: any) => {
  const ts = new Date(String(value || "")).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return "now";

  const diffMs = Math.max(0, Date.now() - ts);
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;

  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatSlotDateLabel = (iso?: string, fallback?: string) => {
  if (!iso) return fallback || "Today";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback || "Today";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatSocialCount = (value?: number) => {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
};

export default function FeedScreen() {
  const [tick, setTick] = useState(0);
  const [profileName, setProfileName] = useState("Prince Fariji");
  const [profileAvatarUri, setProfileAvatarUri] = useState("");
  const [skippedScheduleIds, setSkippedScheduleIds] = useState<Record<string, true>>({});
  const [backendFeed, setBackendFeed] = useState<any[]>([]);
  const [optimisticLikes, setOptimisticLikes] = useState<Record<string, { liked: boolean; likeCount: number }>>({});
  const optimisticLikesRef = useRef(optimisticLikes);
  const [forYouSignals, setForYouSignals] = useState<Record<string, ForYouSignal>>({});
  const forYouSignalsRef = useRef<Record<string, ForYouSignal>>({});
  const activeWatchRef = useRef<{ id: string; startedAt: number } | null>(null);
  const [feedNowMs, setFeedNowMs] = useState(() => Date.now());

  useEffect(() => {
    optimisticLikesRef.current = optimisticLikes;
  }, [optimisticLikes]);

  useEffect(() => {
    const t = setInterval(() => {
      if (
        (globalThis as any).__KRISTO_LIVE_ACTIVE__ ||
        Number((globalThis as any).__KRISTO_LIVE_ACTIVE_COUNT__ || 0) > 0
      ) {
        return;
      }
      setFeedNowMs(Date.now());
    }, 10000);

    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = subscribe(() => setTick((x) => x + 1));
    return () => {
      try {
        (unsub as any)?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    let alive = true;

    AsyncStorage.getItem(FOR_YOU_SIGNALS_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          forYouSignalsRef.current = parsed;
          setForYouSignals(parsed);
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  function recordForYouSignalLocal(rawId: any, patch: Partial<ForYouSignal>) {
    const id = baseFeedId(rawId);
    if (!id) return;

    const prev = forYouSignalsRef.current || {};
    const old = prev[id] || {};

    const nextItem: ForYouSignal = {
      ...old,
      watchedCount: Number(old.watchedCount || 0) + Number(patch.watchedCount || 0),
      skippedCount: Number(old.skippedCount || 0) + Number(patch.skippedCount || 0),
      likedCount: Number(old.likedCount || 0) + Number(patch.likedCount || 0),
      commentedCount: Number(old.commentedCount || 0) + Number(patch.commentedCount || 0),
      savedCount: Number(old.savedCount || 0) + Number(patch.savedCount || 0),
      watchDurationMs: Number(old.watchDurationMs || 0) + Number(patch.watchDurationMs || 0),
      lastWatchedAt: patch.lastWatchedAt || old.lastWatchedAt,
      lastActionAt: patch.lastActionAt || old.lastActionAt,
      languageScores: {
        ...(old.languageScores || {}),
        ...(patch.languageScores || {}),
      },
      mediaScores: {
        ...(old.mediaScores || {}),
        ...(patch.mediaScores || {}),
      },
      geoScores: {
        ...(old.geoScores || {}),
        ...(patch.geoScores || {}),
      },
    };

    const next = { ...prev, [id]: nextItem };
    forYouSignalsRef.current = next;

    AsyncStorage.setItem(FOR_YOU_SIGNALS_KEY, JSON.stringify(next)).catch(() => {});
  }

  useEffect(() => {
    recordForYouSignalGlobal = recordForYouSignalLocal;
    return () => {
      if (recordForYouSignalGlobal === recordForYouSignalLocal) {
        recordForYouSignalGlobal = null;
      }
    };
  }, []);


  const feedSessionSeedRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const tabFocused = useIsFocused();
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const feedScreenFocused = tabFocused && appActive;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const active = nextState === "active";
      setAppActive(active);
      if (!active) {
        pauseAllHomeFeedVideos({
          appState: nextState,
          reason: "app-state-background",
        });
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (tabFocused) return;
    pauseAllHomeFeedVideos({
      screenFocused: false,
      reason: "home-tab-blur",
    });
  }, [tabFocused]);

  const loadBackendFeed = useCallback(async (reason = "poll") => {
    if ((globalThis as any).__KRISTO_LIVE_ACTIVE__) return;

    const scheduleCreateCooldownUntil = Number(
      (globalThis as any).__KRISTO_SCHEDULE_CREATE_COOLDOWN_UNTIL__ || 0
    );
    if (reason !== "poll" && Date.now() < scheduleCreateCooldownUntil) {
      console.log("[ScheduleCreatePerf] skip home feed refetch cooldown", { reason });
      return;
    }

    const session = getSessionSync() as any;
    const viewerChurchId = String(session?.churchId || "").trim();
    const viewerUserId = String(session?.userId || "").trim();

    try {
      const res: any = await apiGet(
        `/api/church/feed?_=${Date.now()}`,
        {
          headers: getKristoHeaders({
            userId: viewerUserId,
            role: (session?.role || "Member") as any,
            churchId: viewerChurchId,
          }),
          cache: "no-store" as RequestCache,
        },
        { screen: "HomeFeed", throttleMs: reason === "focus" ? 0 : 8000 }
      );

      const rows = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.items)
          ? res.data.items
          : Array.isArray(res?.items)
            ? res.items
            : [];

      const total = Number(
        res?.total ??
          res?.data?.total ??
          res?.count ??
          rows.length
      );
      const isBackendEmpty = total === 0 || rows.length === 0;

      if (isBackendEmpty) {
        const localCount = feedList().length;
        const cacheResult = await clearHomeFeedRuntimeCaches();
        setBackendFeed([]);
        setActiveFeedItemId(null);
        setActiveFeedIndex(0);
        pauseAllHomeFeedVideos({ reason: "backend-feed-empty" });
        feedVideoPosterCache.clear();
        feedImageDimensionCache.clear();
        if (__DEV__) {
          console.log("KRISTO_HOME_FEED_BACKEND_EMPTY_CLEAR", {
            backendCount: 0,
            localCount,
            removedCount: cacheResult.removedCount,
            removedMediaVideo: cacheResult.removedMediaVideo,
            reason,
            total,
          });
        }
        return;
      }

      const scheduleRows = rows.filter((item: any) => isHomeMediaScheduleItem(item));
      console.log("[HomeFeed] scheduleCount", {
        reason,
        userId: viewerUserId,
        churchId: viewerChurchId,
        total: rows.length,
        scheduleCount: scheduleRows.length,
        scheduleIds: scheduleRows.map((x: any) => String(x?.id || "")),
      });

      const mapped = rows.map((item: any) => {
          const id = String(item.id || "");
          const optimistic = optimisticLikesRef.current[id];

          const normalizedMediaType =
            item.type === "video"
              ? "video"
              : item.mediaUri
                ? "image"
                : "none";

          const mediaUri =
            normalizedMediaType === "image"
              ? mediaUrl(item.mediaUri)
              : undefined;

          const videoUrl =
            normalizedMediaType === "video"
              ? mediaUrl(item.videoUrl || item.mediaUri)
              : undefined;

          console.log("KRISTO_FEED_MEDIA", {
            id,
            type: item.type,
            mediaType: normalizedMediaType,
            mediaUri,
            videoUrl,
          });

          const isScheduleFeedItem =
            String(item.scheduleType || "").includes("media-live-slots") ||
            String(item.source || "").includes("media-schedule");

          const scheduleAvatarRaw =
            item.actorAvatar ||
            item.mediaAvatarUri ||
            item.churchAvatarUri ||
            item.churchAvatarUrl ||
            item.avatarUri ||
            item.avatarUrl ||
            item.actorAvatarUri ||
            item.profileImage ||
            item.photoURL ||
            item.image ||
            "";

          const mappedAvatar = resolveFeedItemAvatar(item, mediaUrl);

          return {
            id,
            kind: "post",
            title: String(item.title || ""),
            body: String(item.text || ""),
            mediaType: normalizedMediaType,
            mediaUri,
            videoUrl,
            ...(normalizedMediaType === "video"
              ? {
                  posterUri: mediaUrl(
                    item.thumbnailUri ||
                      item.posterUri ||
                      item.thumbnailUrl ||
                      ""
                  ),
                }
              : {}),
            createdAt: String(item.createdAt || ""),
            source: String(item.source || ""),
            scheduleType: String((item as any).scheduleType || ""),
            scheduleSlots: normalizeLiveScheduleSlots(
              Array.isArray(item.scheduleSlots) ? item.scheduleSlots : []
            ),
            sourceScheduleId: String(item.sourceScheduleId || item.id || ""),
            mediaName: String(item.mediaName || item.actorLabel || "Church Media"),
            churchName: String(item.churchName || item.churchLabel || "MY CHURCH"),
            churchId: String(item.churchId || session?.churchId || ""),
            createdBy: String(item.createdBy || ""),
            ...buildLiveRoomAuthorityParams(item as any),
            mediaOwnerPastorUserId: buildLiveRoomAuthorityParams(item as any).actualChurchPastorUserId,
            mediaHostIds: String(item.mediaHostIds || item.hostIds || buildLiveRoomAuthorityParams(item as any).mediaHostIds || ""),
            actorLabel: String(
              item.type === "video" || isScheduleFeedItem
                ? (item.mediaName || item.actorLabel || "Church Media")
                : (item.authorName || item.actorLabel || "Church Member")
            ),
            churchLabel: String(
              item.churchName ||
              item.churchLabel ||
              "MY CHURCH"
            ),
            mediaAvatarUri: mappedAvatar.mediaAvatarUri || mediaUrl(scheduleAvatarRaw),
            churchAvatarUri: mappedAvatar.churchAvatarUri || mediaUrl(item.churchAvatarUri || item.churchAvatarUrl || ""),
            churchAvatarUrl: mediaUrl(item.churchAvatarUrl || item.churchAvatarUri || ""),
            actorAvatarUri: mappedAvatar.actorAvatarUri || mediaUrl(
              isScheduleFeedItem
                ? scheduleAvatarRaw
                : item.type === "video"
                  ? scheduleAvatarRaw
                  : (
                      item.authorAvatarUri ||
                      item.churchAvatarUrl ||
                      item.avatarUri ||
                      item.avatarUrl ||
                      ""
                    )
            ),
            isBackendPost: true,
            liked: optimistic ? optimistic.liked : Boolean(item.likedByMe),
            saved: false,
            likeCount: optimistic ? optimistic.likeCount : Number(item.likeCount || 0),
            commentCount: Number(item.commentCount || 0),
            shareCount: 0,
            visibility: item.visibility || "public",
            audience: item.audience || "public",
            sourceChurchId: item.churchId,
            churchCountry: String(item.churchCountry || ""),
            churchProvince: String(item.churchProvince || ""),
            churchCity: String(item.churchCity || ""),
            churchNormalizedCountry: String(item.churchNormalizedCountry || ""),
            churchNormalizedProvince: String(item.churchNormalizedProvince || ""),
            churchNormalizedCity: String(item.churchNormalizedCity || ""),
            churchPrimaryLanguage: String(item.churchPrimaryLanguage || ""),
            churchPhoneCountryCode: String(item.churchPhoneCountryCode || ""),
          };
        });

        setBackendFeed(mapped);
      } catch (e) {
        console.log("KRISTO_BACKEND_FEED_ERROR", e);
      }
  }, []);

  useEffect(() => {
    clearLocalMediaVideoPosts();
    void loadBackendFeed("mount");
    if (__DEV__) {
      (globalThis as any).clearHomeFeedLocalCaches = clearHomeFeedLocalCaches;
      (globalThis as any).clearLocalMediaVideoPosts = clearLocalMediaVideoPosts;
      (globalThis as any).clearHomeFeedRuntimeCaches = clearHomeFeedRuntimeCaches;
      (globalThis as any).clearHomeFeedPostsOnly = clearHomeFeedPostsOnly;
    }
    const t = setInterval(() => {
      if ((globalThis as any).__KRISTO_LIVE_ACTIVE__) return;
      void loadBackendFeed("poll");
    }, 15000);
    return () => clearInterval(t);
  }, [loadBackendFeed]);

  useEffect(() => {
    if (!feedScreenFocused) return;
    void loadBackendFeed("focus");
  }, [feedScreenFocused, loadBackendFeed]);

  useEffect(() => {
    let alive = true;
    loadProfileDraft()
      .then((profile) => {
        if (!alive || !profile) return;
        const name = String(profile.displayName || profile.username || "").trim();
        const avatar = String(profile.avatarUri || "").trim();
        if (name) setProfileName(name);
        if (avatar) setProfileAvatarUri(avatar);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const data = useMemo(() => {
    const session = getSessionSync() as any;
    const memberUser = userHasActiveChurchMembership(session);
    const myChurchId = String(session?.churchId || "").trim();

    const backendKeys = new Set(
      backendFeed.map((x: any) =>
        `${String(x.title || "").trim()}|${String(x.body || "").trim()}`
      )
    );

    const localFeed: any[] = feedList().filter((item: any) => {
      // V1 safety: video posts must render from backend only.
      // Local media-video optimistic rows can create black duplicate slides.
      if (isLocalMediaVideoPost(item)) {
        return false;
      }

      const isStaleInstantLive =
        item?.isLiveNow ||
        item?.kind === "live" ||
        String(item?.id || "").startsWith("church-live-now-") ||
        String(item?.id || "").startsWith("media-live-now-");

      if (isStaleInstantLive) return false;

      const hasLocalSlots =
        Array.isArray(item?.scheduleSlots) &&
        item.scheduleSlots.length > 0;

      const isLocalSchedule =
        hasLocalSlots || String(item?.scheduleType || "").includes("media-live-slots");

      if (isLocalSchedule) {
        if (!memberUser) return false;
        const itemCid = String(item?.churchId || "").trim();
        if (myChurchId && itemCid && itemCid !== myChurchId) return false;
        return true;
      }

      const key = `${String(item.title || "").trim()}|${String(item.body || item.text || "").trim()}`;
      return !backendKeys.has(key);
    })
      .map(normalizeFeedItemMedia)
      .filter((item) => keepRealHomeFeedRow(item, "localFeed"));

    const safeBackendFeed = backendFeed.filter((item: any) => {
      const hasBackendSlots =
        Array.isArray(item?.scheduleSlots) &&
        item.scheduleSlots.length > 0;

      const isMediaSlot =
        hasBackendSlots ||
        String(item?.scheduleType || "").includes("media-live-slots");

      const isLiveCard =
        item?.isLiveNow ||
        item?.kind === "live" ||
        String(item?.id || "").includes("live-now");

      if (isMediaSlot) {
        const itemCid = String(item?.churchId || "").trim();
        if (myChurchId && itemCid && itemCid !== myChurchId) return false;
      }

      // Non-members see public posts only — not live cards or claimable schedule slots.
      if (isLiveCard && !memberUser) return false;
      if (isMediaSlot && !memberUser) return false;

      return true;
    })
      .filter((item) => {
        if (!isStandaloneAvatarFeedPost(item)) return true;
        if (__DEV__) {
          console.log("KRISTO_HOME_FEED_FILTERED_AVATAR_POST", {
            source: "safeBackendFeed",
            id: item?.id,
            mediaUri: item?.mediaUri,
            actorAvatarUri: item?.actorAvatarUri,
            mediaAvatarUri: item?.mediaAvatarUri,
            churchAvatarUri: item?.churchAvatarUri,
          });
        }
        return false;
      });

    const liveNowItems: any[] = [];

    function parseAutoLiveSlotWindow(slot: any) {
      const baseDateRaw = String(slot?.meetingDate || slot?.meetingDay || "").trim();
      const startRaw = String(slot?.startTime || "").trim();
      const endRaw = String(slot?.endTime || "").trim();

      const base = new Date(baseDateRaw);
      const today = new Date();

      const y = Number.isFinite(base.getTime()) ? base.getFullYear() : today.getFullYear();
      const m = Number.isFinite(base.getTime()) ? base.getMonth() : today.getMonth();
      const d = Number.isFinite(base.getTime()) ? base.getDate() : today.getDate();

      function timeToParts(t: string) {
        const mm = t.match(/(\\d{1,2})(?::(\\d{2}))?\\s*(AM|PM)?/i);
        if (!mm) return null;

        let h = Number(mm[1] || 0);
        const min = Number(mm[2] || 0);
        const ap = String(mm[3] || "").toUpperCase();

        if (ap === "PM" && h < 12) h += 12;
        if (ap === "AM" && h === 12) h = 0;

        return { h, min };
      }

      const sp = timeToParts(startRaw);
      if (!sp) {
        const direct = new Date(String(slot?.meetingDate || "")).getTime();
        const durationMs = Math.max(1, Number(slot?.durationMin || 1)) * 60000;

        return {
          startMs: Number.isFinite(direct) ? direct : 0,
          endMs: Number.isFinite(direct) ? direct + durationMs : 0,
        };
      }

      const start = new Date(y, m, d, sp.h, sp.min, 0, 0).getTime();

      const ep = timeToParts(endRaw);
      let end = ep
        ? new Date(y, m, d, ep.h, ep.min, 0, 0).getTime()
        : start + Math.max(1, Number(slot?.durationMin || 1)) * 60000;

      if (end <= start) end += 24 * 60 * 60000;

      return { startMs: start, endMs: end };
    }

    function isScheduleFeedRow(item: any): boolean {
      const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
      return (
        isHomeMediaScheduleItem(item) ||
        String(item?.scheduleType || "").includes("media-live-slots") ||
        String(item?.source || "").includes("media-schedule") ||
        slots.length > 0
      );
    }

    const mergedScheduleRows = mergeFeedRowsForScheduleScan([
      ...safeBackendFeed.filter(isScheduleFeedRow),
      ...localFeed.filter(isScheduleFeedRow),
    ]);
    const nonScheduleRows = [
      ...safeBackendFeed.filter((item) => !isScheduleFeedRow(item)),
      ...localFeed.filter((item) => !isScheduleFeedRow(item)),
    ];

    const expanded = [...nonScheduleRows, ...mergedScheduleRows].flatMap((item) => {
      const slots = Array.isArray((item as any)?.scheduleSlots) ? ((item as any).scheduleSlots as any[]) : [];
      const isLiveSchedule =
        String((item as any)?.scheduleType || "").includes("live") ||
        String((item as any)?.source || "").includes("media-schedule") ||
        String(item.title || "").toLowerCase().includes("live time card") ||
        slots.length > 0;

      if (isLiveSchedule && slots.length && !memberUser) {
        return [];
      }

      if (isLiveSchedule && slots.length) {
        const now = Date.now();

        slots.forEach((slot, index) => {
          const claimedUserIdForLive = String(
            slot?.claimedByUserId ||
            (slot?.claimedBy &&
            typeof slot?.claimedBy === "object"
              ? slot?.claimedBy.userId
              : "") ||
            ""
          ).trim();

          const claimed = !!claimedUserIdForLive;

          if (!claimed) return;

          const { startMs, endMs } = parseAutoLiveSlotWindow(slot);
          if (!startMs || !endMs) return;

          if (now < startMs || now > endMs) return;

          const liveId = String((item as any)?.sourceScheduleId || item.id || "media-live-default");
          const mediaName = String((item as any)?.mediaName || (item as any)?.actorLabel || "Church Media");
          const churchName = String((item as any)?.churchName || (item as any)?.churchLabel || "MY CHURCH");
          if (!memberUser) return;

          const churchId = String((item as any)?.churchId || "").trim();

          const remainingMin = Math.max(0, Math.ceil((endMs - now) / 60000));
          const claimedRaw = slot?.claimedBy;
          const claimedUserId = String(
            slot?.claimedByUserId ||
            (claimedRaw && typeof claimedRaw === "object" ? claimedRaw.userId : "") ||
            ""
          ).trim();

          const isSlotClaimed = !!claimedUserId;

          const claimedName = isSlotClaimed
            ? String(
                slot?.claimedByName ||
                slot?.claimedByDisplayName ||
                slot?.claimedByUserName ||
                (claimedRaw && typeof claimedRaw === "object"
                  ? (claimedRaw.name || claimedRaw.displayName || claimedRaw.username || claimedRaw.fullName)
                  : claimedRaw) ||
                "Live Speaker"
              ).trim()
            : "";

          const realLiveTopic = String(
            slot?.script ||
            slot?.task ||
            slot?.role ||
            slot?.topic ||
            slot?.notes ||
            (item as any)?.topic ||
            (item as any)?.body ||
            (item as any)?.text ||
            "Live media topic"
          ).split("\n").join(" ").trim();

          liveNowItems.push({
            id: `live-now-${liveId}-${slot?.id || index}`,
            kind: "live",
            title: isSlotClaimed ? `${claimedName} is LIVE` : `${String(slot?.name || slot?.slotLabel || "Live Slot")} is open`,
            body: realLiveTopic,
            topic: realLiveTopic,
            liveClaimName: claimedName,
            liveMediaName: mediaName,
            liveTopic: realLiveTopic,
            liveRemainingMin: remainingMin,
            liveTimeLabel: `${String(slot?.startTime || "")} - ${String(slot?.endTime || "")}`,
            liveSlotNumber: index + 1,
            liveSlotTotal: slots.length,
            liveSlotsRemaining: Math.max(0, slots.length - (index + 1)),
            scheduleSlots: [{
              ...slot,
              slot: index + 1,
              slotNumber: index + 1,
              claimedByUserId: claimedUserId,
              claimedByName: isSlotClaimed ? claimedName : "",
            }],
            liveAllScheduleSlots: slots.map((rawSlot: any, rawIndex: number) => ({
              ...rawSlot,
              slot: rawIndex + 1,
              slotNumber: rawIndex + 1,
            })),
            slotFeedIndex: index,
            slotFeedTotal: slots.length,
            createdAt: new Date(startMs).toISOString(),
            actorLabel: mediaName,
            churchLabel: churchName,
            churchName,
            churchId,
            ...buildLiveRoomAuthorityParams(item as any),
            mediaOwnerPastorUserId: buildLiveRoomAuthorityParams(item as any).actualChurchPastorUserId,
            mediaHostIds: String((item as any)?.mediaHostIds || (item as any)?.hostIds || buildLiveRoomAuthorityParams(item as any).mediaHostIds || ""),
            isLiveNow: true,
            isChurchLive: true,
            sourceScheduleId: liveId,
            liveId,
            liveRoomPath: "/more/my-church-room/messages/live-room",
            liveRoomParams: {
              source: "media",
              liveMode: "schedule",
              layout: "grid6",
              role: "Viewer",
              mode: "viewer",
              entryMode: "live",
              room: "media",
              mediaName,
              churchName,
              churchLabel: churchName,
              churchId,
              liveId,
              visibility: "public",
              audience: "global",
              isGlobalMediaSlot: "1",
              ...buildLiveRoomAuthorityParams(item as any),
              mediaOwnerPastorUserId: buildLiveRoomAuthorityParams(item as any).actualChurchPastorUserId,
              mediaHostIds: String((item as any)?.mediaHostIds || (item as any)?.hostIds || buildLiveRoomAuthorityParams(item as any).mediaHostIds || ""),

              title: String(slot?.name || slot?.slotLabel || "Church Live"),

              watchScheduledPublisher: "0",

              liveAllScheduleSlotsJson: JSON.stringify(slots.map((s: any, i: number) => ({
                ...s,
                slot: i + 1,
                slotNumber: i + 1,
                order: i + 1,
              }))),

              preferredSlotNumber: String(index + 1),
              currentSlotNumber: String(index + 1),
              scheduleStartMs: String(startMs),
              scheduleEndMs: String(endMs),

              claimedByName: isSlotClaimed ? claimedName : "",

              claimedByAvatar:
                String(
                  slot?.claimedByAvatar ||
                  slot?.claimedByAvatarUrl ||
                  (claimedRaw && typeof claimedRaw === "object"
                    ? (claimedRaw.avatarUri || claimedRaw.avatarUrl)
                    : "") ||
                  ""
                ),

              claimedByUserId: claimedUserId,

              liveClaimName: isSlotClaimed ? claimedName : "",
            },
          });
        });
      }

      if (skippedScheduleIds[item.id]) return [];

      if (!isLiveSchedule) return [item];

      const remainingSlots = slots.filter((slot: any) => {
        const { endMs } = parseAutoLiveSlotWindow(slot);
        return !endMs || Date.now() <= endMs;
      });

      // Schedule cards with no remaining slots should disappear from Home feed completely.
      if (!remainingSlots.length) return [];

      // Never return the original schedule post itself to Home feed.
      // Only return per-slot cards so no black/blank duplicate post remains.
      return remainingSlots.map((slot, index) => ({
        ...item,
        id: `${item.id}__slot_${slot?.id || index}`,
        sourceScheduleId: item.id,
        allScheduleSlotsForLive: normalizeLiveScheduleSlots(slots),
        scheduleSlots: [slot],
        slotFeedIndex: index,
        slotFeedTotal: remainingSlots.length,
        mediaAvatarUri: (item as any)?.mediaAvatarUri || (item as any)?.actorAvatarUri || "",
        churchAvatarUri: (item as any)?.churchAvatarUri || (item as any)?.avatarUri || "",
        churchAvatarUrl: (item as any)?.churchAvatarUrl || "",
        actorAvatarUri:
          (item as any)?.mediaAvatarUri ||
          (item as any)?.churchAvatarUri ||
          (item as any)?.churchAvatarUrl ||
          (item as any)?.avatarUri ||
          (item as any)?.actorAvatarUri ||
          "",
        avatarUri:
          (item as any)?.mediaAvatarUri ||
          (item as any)?.churchAvatarUri ||
          (item as any)?.churchAvatarUrl ||
          (item as any)?.avatarUri ||
          "",
      }));
    });

    // Do not auto-insert live-now preview item into Home feed.
    // It can steal activeIndex/audio from normal video posts.
    // Users can still enter live from the schedule slot card.
    // if (liveNowItems.length) {
    //   expanded.unshift(...liveNowItems);
    // }

    const seenIds = new Set<string>();
    const unique = expanded.filter((item: any) => {
      const id = String(item?.id || "");
      if (!id) return true;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    const userSeed = `${String(session?.userId || session?.email || "guest")}|session:${feedSessionSeedRef.current}`;

    function geoNorm(input: any) {
      return String(input || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "");
    }

    function textSimilarity(a: any, b: any) {
      const x = geoNorm(a);
      const y = geoNorm(b);
      if (!x || !y) return 0;
      if (x === y) return 1;
      if (x.includes(y) || y.includes(x)) return 0.82;

      const bigrams = (v: string) => {
        const out: string[] = [];
        for (let i = 0; i < Math.max(0, v.length - 1); i += 1) out.push(v.slice(i, i + 2));
        return out;
      };

      const bx = bigrams(x);
      const by = bigrams(y);
      if (!bx.length || !by.length) return 0;

      const setY = new Set(by);
      const shared = bx.filter((v) => setY.has(v)).length;
      return shared / Math.max(bx.length, by.length);
    }

    function stableRand(input: string) {
      let h = 2166136261;
      for (let i = 0; i < input.length; i += 1) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return ((h >>> 0) % 10000) / 10000;
    }

    function ageHours(createdAt: any) {
      const t = new Date(String(createdAt || "")).getTime();
      if (!Number.isFinite(t)) return 9999;
      return Math.max(0, (Date.now() - t) / 3600000);
    }

    function forYouScore(item: any, index: number) {
      const id = String(item?.id || index);
      const sourceChurchId = String(item?.sourceChurchId || "");
      const myChurchId = String(session?.churchId || "");

      const myCountry = geoNorm((session as any)?.churchCountry || (session as any)?.country || "");
      const myProvince = geoNorm((session as any)?.churchProvince || (session as any)?.province || "");
      const myCity = geoNorm((session as any)?.churchCity || (session as any)?.city || "");

      const postCountry = geoNorm(item?.churchNormalizedCountry || item?.churchCountry || "");
      const postProvince = geoNorm(item?.churchNormalizedProvince || item?.churchProvince || "");
      const postCity = geoNorm(item?.churchNormalizedCity || item?.churchCity || "");

      const myPhoneCode = String((session as any)?.churchPhone || (session as any)?.phone || "").match(/^\+\d{1,4}/)?.[0] || "";
      const postPhoneCode = String(item?.churchPhoneCountryCode || "").trim();

      const combinedSignals = Object.values(forYouSignals).slice(-120);

      let score = 0;

      const hours = ageHours(item?.createdAt);
      if (hours <= 48) {
        score += Math.max(0, 155 - hours * 2.75);
      } else {
        score += Math.max(0, 24 - (hours - 48) * 0.75);
      }

      if (item?.isLiveNow) score += 180;
      if (item?.kind === "live") score += 110;
      if (item?.mediaType === "video" || item?.videoUrl) score += 75;
      if (item?.mediaType === "image" || item?.mediaUri) score += 35;
      if (item?.kind === "testimony") score += 45;
      if (item?.kind === "announcement") score += 25;
      if (item?.kind === "prayer_request") score += 20;
      if (
        (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) ||
        String(item?.scheduleType || "").includes("media-live-slots") ||
        String(item?.source || "").includes("media-schedule")
      ) {
        score += 120;
      }

      if (Number(item?.commentCount || 0) > 0) score += Math.min(28, Number(item.commentCount) * 6);
      if (Number(item?.likeCount || 0) > 0) score += Math.min(20, Number(item.likeCount) * 3);

      if (sourceChurchId && myChurchId && sourceChurchId === myChurchId) score += 85;

      // GEO / REGION AFFINITY
      if (myCountry && postCountry) score += textSimilarity(myCountry, postCountry) * 120;
      if (myProvince && postProvince) score += textSimilarity(myProvince, postProvince) * 95;
      if (myCity && postCity) score += textSimilarity(myCity, postCity) * 150;

      // Same phone country code usually means same country/community.
      if (myPhoneCode && postPhoneCode && myPhoneCode === postPhoneCode) score += 55;

      // Church profile language hint.
      const postLang = String(item?.churchPrimaryLanguage || "").toLowerCase();
      const myLang =
        String((session as any)?.churchPrimaryLanguage || (session as any)?.primaryLanguage || "").toLowerCase();

      if (myLang && postLang && myLang === postLang) score += 36;

      // Per-user stable randomness: small tie-breaker only.
      score += stableRand(`${userSeed}|${id}`) * 18;

      const signalId = baseFeedId(item?.sourceScheduleId || item?.id || index);
      const sig = forYouSignals[signalId] || {};

      let swScore = 0;
      let rnScore = 0;
      let frScore = 0;
      let enScore = 0;

      combinedSignals.forEach((sig: any) => {
        swScore += Number(sig?.languageScores?.sw || 0);
        rnScore += Number(sig?.languageScores?.rn || 0);
        frScore += Number(sig?.languageScores?.fr || 0);
        enScore += Number(sig?.languageScores?.en || 0);
      });

      const dominantLanguage =
        swScore >= rnScore && swScore >= frScore && swScore >= enScore
          ? "sw"
          : rnScore >= frScore && rnScore >= enScore
            ? "rn"
            : frScore >= enScore
              ? "fr"
              : "en";

      const postLanguage = detectLanguage(`${item?.title || ""} ${item?.body || ""}`);
      if (dominantLanguage === postLanguage) score += 95;

      const mediaKey = String(
        item?.actorLabel ||
        item?.churchLabel ||
        item?.scheduleType ||
        "general"
      ).toLowerCase();

      combinedSignals.forEach((sig: any) => {
        if (sig?.mediaScores?.[mediaKey]) score += 55;
      });

      const interestTokens = tokenizeInterest(`${item?.title || ""} ${item?.body || ""}`);
      combinedSignals.forEach((sig: any) => {
        interestTokens.forEach((t) => {
          if (sig?.languageScores?.[`kw:${t}`]) score += 12;
        });
      });

      // Learn from this device behavior (capped so live/fresh posts stay ahead).
      score += Math.min(70, Number(sig.watchDurationMs || 0) / 1000);
      score += Math.min(45, Number(sig.watchedCount || 0) * 8);
      score += Math.min(50, Number(sig.likedCount || 0) * 18);
      score += Math.min(55, Number(sig.commentedCount || 0) * 22);
      score += Math.min(30, Number(sig.savedCount || 0) * 14);

      // Skipped posts can still return later, but lower.
      score -= Math.min(80, Number(sig.skippedCount || 0) * 18);

      // Avoid over-repeating already liked/saved posts in same session.
      if (item?.liked) score -= 18;
      if (item?.saved) score -= 10;

      return score;
    }

    function rankScore(item: any, index: number) {
      const originalId = String(item?.sourceScheduleId || item?.id || index);
      const cycleNoise = stableRand(`${userSeed}|cycle:0|${originalId}`) * 8;
      const shuffleNoise = stableRand(`${userSeed}|top-shuffle:0|${originalId}`) * 12;
      return forYouScore(item, index) + cycleNoise + shuffleNoise;
    }

    function classifyMixBucket(item: any): "live" | "freshMedia" | "video" | "image" | "text" | "older" {
      if (item?.isLiveNow || item?.kind === "live") return "live";
      const hours = ageHours(item?.createdAt);
      const video = isStrictVideoFeedItem(item);
      const image = isImageFeedItem(item);
      if (hours <= 48 && (video || image)) return "freshMedia";
      if (video) return "video";
      if (image) return "image";
      const kind = String(item?.kind || "").toLowerCase();
      if (
        kind === "testimony" ||
        kind === "announcement" ||
        kind === "prayer_request" ||
        kind === "counsel" ||
        kind === "post"
      ) {
        return hours > 48 ? "older" : "text";
      }
      return hours > 48 ? "older" : "text";
    }

    function interleaveHomeFeedItems(items: any[], seed: string) {
      type ScoredRow = { item: any; score: number };
      const buckets: Record<string, ScoredRow[]> = {
        live: [],
        freshMedia: [],
        video: [],
        image: [],
        text: [],
        older: [],
      };

      items.forEach((item, index) => {
        const bucket = classifyMixBucket(item);
        buckets[bucket].push({ item, score: rankScore(item, index) });
      });

      for (const key of Object.keys(buckets)) {
        buckets[key].sort((a, b) => b.score - a.score);
      }

      const liveItems = buckets.live.map((row) => row.item);
      const olderAll = buckets.older;
      const olderPromoteCount = Math.max(0, Math.ceil(olderAll.length * 0.12));
      const olderPromoted = olderAll.slice(0, olderPromoteCount);
      const olderRest = olderAll.slice(olderPromoteCount).map((row) => row.item);

      const queues: Record<string, ScoredRow[]> = {
        freshMedia: [...buckets.freshMedia],
        video: [...buckets.video],
        image: [...buckets.image],
        text: [...buckets.text],
        older: [...olderPromoted],
      };

      const pattern = ["freshMedia", "video", "image", "text", "older", "freshMedia", "video", "image", "text"];
      const start = Math.floor(stableRand(`${seed}|mix-start`) * pattern.length);
      const mixed: any[] = [];
      let patternIdx = 0;
      let guard = 0;

      const totalRemaining = () =>
        Object.values(queues).reduce((count, queue) => count + queue.length, 0);

      while (totalRemaining() > 0 && guard++ < 5000) {
        let picked = false;
        for (let attempt = 0; attempt < pattern.length; attempt += 1) {
          const bucketKey = pattern[(start + patternIdx + attempt) % pattern.length];
          const queue = queues[bucketKey];
          if (queue.length > 0) {
            mixed.push(queue.shift()!.item);
            patternIdx += attempt + 1;
            picked = true;
            break;
          }
        }
        if (!picked) break;
      }

      return [...liveItems, ...mixed, ...olderRest];
    }

    const schedulePriorityItems = unique.filter((item: any) =>
      (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) ||
      String(item?.scheduleType || "").includes("media-live-slots") ||
      String(item?.source || "").includes("media-schedule")
    );

    const nonScheduleItems = unique.filter((item: any) =>
      !(
        (Array.isArray(item?.scheduleSlots) && item.scheduleSlots.length > 0) ||
        String(item?.scheduleType || "").includes("media-live-slots") ||
        String(item?.source || "").includes("media-schedule")
      )
    );

    const scheduleScored = schedulePriorityItems
      .map((item: any, index: number) => ({
        item,
        score: rankScore(item, index),
        createdAtMs: new Date(String(item?.createdAt || "")).getTime() || 0,
      }))
      .sort((a, b) => {
        if (b.createdAtMs !== a.createdAtMs) return b.createdAtMs - a.createdAtMs;
        return b.score - a.score;
      });

    const sortedScheduleItems = scheduleScored.map((x) => x.item);

    const sortedRemainingItems = interleaveHomeFeedItems(nonScheduleItems, userSeed);

    const remainingScored = nonScheduleItems
      .map((item: any, index: number) => ({
        item,
        score: rankScore(item, index),
      }))
      .sort((a, b) => b.score - a.score);

    const finalFeed = [...sortedScheduleItems, ...sortedRemainingItems];
    const seenFinal = new Set<string>();

    const visibleData = finalFeed.filter((item: any, index: number) => {
      const id = String(item?.id || "");
      if (id.startsWith("media-video-") || id.includes("__fy_") && id.split("__fy_")[0].startsWith("media-video-")) {
        return false;
      }

      const key = String(item?.id || `feed-item-${index}`);
      if (seenFinal.has(key)) return false;
      if (!keepRealHomeFeedRow(item, "finalVisibleData")) return false;
      seenFinal.add(key);
      return true;
    });

    if (__DEV__) {
      const rankingSample = [...scheduleScored, ...remainingScored]
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map((row, index) => ({
          rank: index + 1,
          id: String(row.item?.id || ""),
          kind: String(row.item?.kind || ""),
          mediaType: String(row.item?.mediaType || ""),
          score: Math.round(row.score * 10) / 10,
          createdAt: String(row.item?.createdAt || ""),
        }));
      console.log("KRISTO_HOME_FEED_RANKING", rankingSample);

      const mixSample = sortedRemainingItems.slice(0, 8).map((item, index) => ({
        rank: index + 1,
        id: String(item?.id || ""),
        kind: String(item?.kind || ""),
        mediaType: String(item?.mediaType || ""),
        bucket: classifyMixBucket(item),
        createdAt: String(item?.createdAt || ""),
      }));
      console.log("KRISTO_HOME_FEED_MIX", mixSample);

      console.log("KRISTO_HOME_FEED_VISIBLE_SOURCE", {
        backendCount: backendFeed.length,
        localCount: localFeed.length,
        visibleCount: visibleData.length,
        removedCount: feedList().length - localFeed.length,
      });
    }

    return visibleData;
  }, [tick, skippedScheduleIds, backendFeed, optimisticLikes]);
  const [activeFeedItemId, setActiveFeedItemId] = useState<string | null>(() => String(data[0]?.id || ""));
  const [activeFeedIndex, setActiveFeedIndex] = useState(0);
  const [feedVisibleCount, setFeedVisibleCount] = useState(FEED_INITIAL_VISIBLE_COUNT);

  const visibleData = useMemo(() => {
    return data.slice(0, Math.min(feedVisibleCount, data.length));
  }, [data, feedVisibleCount]);

  const activeItemIsStrictVideo = useMemo(() => {
    if (activeFeedIndex < 0) return false;
    return isStrictVideoFeedItem(visibleData[activeFeedIndex]);
  }, [visibleData, activeFeedIndex]);

  const feedVisibleCountRef = useRef(feedVisibleCount);
  const feedTotalCountRef = useRef(data.length);
  const feedAppendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedAppendLoadingRef = useRef(false);

  useEffect(() => {
    feedVisibleCountRef.current = feedVisibleCount;
    feedTotalCountRef.current = data.length;
    feedAppendLoadingRef.current = false;
  }, [feedVisibleCount, data.length]);

  useEffect(() => {
    if (backendFeed.length > 0) return;
    setActiveFeedItemId(null);
    setActiveFeedIndex(-1);
    setFeedVisibleCount(FEED_INITIAL_VISIBLE_COUNT);
    pauseAllHomeFeedVideos({ reason: "backend-feed-empty" });
  }, [backendFeed.length]);

  useEffect(() => {
    if (!visibleData.length) {
      return;
    }
    if (
      activeFeedItemId &&
      visibleData.some((it) => it.id === activeFeedItemId)
    ) {
      return;
    }
    const fallbackIndex = 0;
    const fallbackItem = visibleData[fallbackIndex];
    setActiveFeedItemId(fallbackItem?.id ?? null);
    setActiveFeedIndex(fallbackIndex);
    if (!isStrictVideoFeedItem(fallbackItem)) {
      logNonVideoActivePause({
        postId: String(fallbackItem?.id || ""),
        activeFeedIndex: fallbackIndex,
        activeFeedItemId: String(fallbackItem?.id || ""),
        reason: "fallback-non-video-active",
      });
    }
  }, [visibleData, activeFeedItemId]);

  const visibleDataRef = useRef(visibleData);
  useEffect(() => {
    visibleDataRef.current = visibleData;
  }, [visibleData]);

  useEffect(() => {
    const meta = {
      activeFeedIndex,
      activeFeedItemId,
      screenFocused: feedScreenFocused,
      appState: appActive ? "active" : "inactive",
    };

    if (!feedScreenFocused || !appActive) {
      pauseAllHomeFeedVideos({
        ...meta,
        reason: "screen-or-app-unfocused",
      });
      return;
    }

    const activeItem = visibleData[activeFeedIndex];
    const activeId = String(activeFeedItemId || "");
    const itemId = String(activeItem?.id || "");

    if (
      !activeItem ||
      !isStrictVideoFeedItem(activeItem) ||
      !activeId ||
      activeId !== itemId
    ) {
      logNonVideoActivePause({
        ...meta,
        postId: activeId || itemId,
        reason: "active-not-strict-video",
      });
      return;
    }

    syncHomeFeedVideoOwnership({
      ...meta,
      postId: activeId,
      feedIndex: activeFeedIndex,
      isStrictVideoPost: true,
      shouldPlay: true,
      reason: "feed-screen-active",
    });
  }, [
    feedScreenFocused,
    appActive,
    activeFeedIndex,
    activeFeedItemId,
    visibleData,
    activeItemIsStrictVideo,
  ]);

  useEffect(() => {
    return () => {
      pauseAllHomeFeedVideos({ reason: "home-feed-unmount" });
    };
  }, []);

  const { height: windowHeight } = useWindowDimensions();
  const feedViewportHeight = Math.max(520, windowHeight - HOME_FEED_BOTTOM_OFFSET);
  const itemH = Math.floor(feedViewportHeight);

  const listRef = useRef<FlatList<any> | null>(null);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 82,
    minimumViewTime: 220,
    waitForInteraction: true,
  }).current;

  const skipSlotsFrom = useCallback((item: any) => {
    const sourceId = String(item.sourceScheduleId || item.id).split("__slot_")[0];
    setSkippedScheduleIds((prev) => ({ ...prev, [sourceId]: true }));
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: 0, animated: true });
    }, 50);
  }, []);

  const handleOptimisticBackendLike = useCallback((id: string, liked: boolean, likeCount: number) => {
    setOptimisticLikes((prev) => {
      const next = {
        ...prev,
        [id]: { liked, likeCount },
      };

      (globalThis as any).__KRISTO_OPTIMISTIC_LIKES__ = next;

      return next;
    });
  }, []);

  const keyExtractor = useCallback((it: any) => String(it.id), []);

  const getItemLayout = useCallback(
    (_: any, i: number) => ({ length: itemH, offset: itemH * i, index: i }),
    [itemH]
  );

  const handleOptimisticSlotClaim = useCallback(
    (params: {
      postId: string;
      slotId: string;
      claim: { userId: string; name: string; role: string; avatarUri: string };
    }) => {
      const { postId, slotId, claim } = params;
      setBackendFeed((prev) => {
        const aliasSet = new Set(
          collectScheduleAliasIds(postId, prev).flatMap((id) => [id, baseFeedId(id)].filter(Boolean))
        );
        return prev.map((row: any) => {
          const rowBase = baseFeedId(String(row?.sourceScheduleId || row?.id || ""));
          const rowId = String(row?.id || "").trim();
          if (!aliasSet.has(rowBase) && !aliasSet.has(rowId)) return row;
          const scheduleSlots = Array.isArray(row.scheduleSlots)
            ? row.scheduleSlots.map((slot: any) => {
                const slotCandidates = [
                  String(slot?.id || ""),
                  String(slot?.slotId || ""),
                  String(slot?.slot || ""),
                ].filter(Boolean);
                if (!slotCandidates.includes(slotId)) return slot;
                return patchMediaSlotClaimAvatarFields(
                  {
                    ...slot,
                    claimed: true,
                    isClaimed: true,
                    status: "claimed",
                    claimedByUserId: claim.userId,
                    claimedByName: claim.name,
                    claimedBy: claim,
                  },
                  claim.avatarUri
                );
              })
            : row.scheduleSlots;
          const claimedCount = Array.isArray(scheduleSlots)
            ? scheduleSlots.filter((slot: any) =>
                String(slot?.claimedByUserId || slot?.claimedBy?.userId || "").trim()
              ).length
            : 0;
          return { ...row, scheduleSlots, claimedCount, updatedAt: Date.now() };
        });
      });
    },
    []
  );

  const renderItem = useCallback(
    ({ item, index }: { item: any; index: number }) => (
      <FeedSlide
        item={item}
        height={itemH}
        feedIndex={index}
        activeFeedIndex={activeFeedIndex}
        activeFeedItemId={activeFeedItemId}
        activeItemIsStrictVideo={activeItemIsStrictVideo}
        isActive={String(item?.id || "") === String(activeFeedItemId || "")}
        screenFocused={feedScreenFocused}
        appActive={appActive}
        nowMs={feedNowMs}
        onSkipSlots={() => skipSlotsFrom(item)}
        profileName={profileName}
        profileAvatarUri={profileAvatarUri}
        onOptimisticBackendLike={handleOptimisticBackendLike}
        onOptimisticSlotClaim={handleOptimisticSlotClaim}
      />
    ),
    [
      itemH,
      activeFeedItemId,
      activeFeedIndex,
      activeItemIsStrictVideo,
      feedScreenFocused,
      appActive,
      feedNowMs,
      skipSlotsFrom,
      profileName,
      profileAvatarUri,
      handleOptimisticBackendLike,
      handleOptimisticSlotClaim,
    ]
  );

  const activateFeedIndex = useCallback((nextIndex: number, reason: string) => {
    const nextItem = visibleDataRef.current[nextIndex];
    const nextId = nextItem?.id ? String(nextItem.id) : "";

    if (!nextId) {
      setActiveFeedItemId(null);
      setActiveFeedIndex(-1);
      pauseAllHomeFeedVideos({ reason: `${reason}-empty` });
      return;
    }

    setActiveFeedItemId(nextId);
    setActiveFeedIndex(nextIndex);

    const isStrictVideo = isStrictVideoFeedItem(nextItem);

    if (isStrictVideo) {
      pauseAllHomeFeedVideos({
        postId: nextId,
        activeFeedIndex: nextIndex,
        activeFeedItemId: nextId,
        feedIndex: nextIndex,
        exceptPostId: nextId,
        reason,
      });
    } else {
      logNonVideoActivePause({
        postId: nextId,
        activeFeedIndex: nextIndex,
        activeFeedItemId: nextId,
        feedIndex: nextIndex,
        reason: `${reason}-non-video`,
      });
    }
  }, []);

  const handleMomentumScrollEnd = useCallback((event: any) => {
    const y = Number(event?.nativeEvent?.contentOffset?.y || 0);
    const nextIndex = Math.max(0, Math.round(y / Math.max(1, itemH)));
    activateFeedIndex(nextIndex, "momentum-scroll-end");
  }, [activateFeedIndex, itemH]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const topView = pickPrimaryViewableItem(viewableItems);
    const top = topView?.item;
    const topIndex = Number(topView?.index ?? 0);
    const nextId = top?.id ? String(top.id) : "";

    const visibleCount = feedVisibleCountRef.current;
    const totalCount = feedTotalCountRef.current;
    const prefetchThreshold = Math.max(0, visibleCount - FEED_APPEND_PREFETCH_AHEAD);
    const nearEndThreshold = Math.max(0, visibleCount - 2);

    const canAppendMore = visibleCount < totalCount && !!nextId && !feedAppendLoadingRef.current;

    if (canAppendMore && topIndex >= prefetchThreshold) {
      feedAppendLoadingRef.current = true;

      if (feedAppendTimerRef.current) clearTimeout(feedAppendTimerRef.current);

      const delay =
        topIndex >= nearEndThreshold || topIndex >= visibleCount - 1
          ? 0
          : FEED_APPEND_DELAY_MS;

      feedAppendTimerRef.current = setTimeout(() => {
        feedAppendTimerRef.current = null;

        setFeedVisibleCount((prev) => {
          if (prev >= feedTotalCountRef.current) {
            feedAppendLoadingRef.current = false;
            return prev;
          }
          return Math.min(feedTotalCountRef.current, prev + FEED_APPEND_BATCH_SIZE);
        });
      }, delay);
    } else if (
      topIndex < Math.max(0, prefetchThreshold - 2) &&
      feedAppendTimerRef.current
    ) {
      clearTimeout(feedAppendTimerRef.current);
      feedAppendTimerRef.current = null;
      feedAppendLoadingRef.current = false;
    }

    const previous = activeWatchRef.current;
    const now = Date.now();

    if (previous?.id && previous.id !== nextId) {
      const durationMs = Math.max(0, now - previous.startedAt);
      recordForYouSignalLocal(previous.id, {
        watchedCount: durationMs >= 1200 ? 1 : 0,
        skippedCount: durationMs < 1200 ? 1 : 0,
        watchDurationMs: durationMs,
        lastWatchedAt: now,
      });
    }

    if (nextId && previous?.id !== nextId) {
      const nextItem = visibleDataRef.current[topIndex];
      const scrollMeta = {
        postId: nextId,
        activeFeedIndex: topIndex,
        activeFeedItemId: nextId,
        feedIndex: topIndex,
      };
      if (!isStrictVideoFeedItem(nextItem)) {
        logNonVideoActivePause({
          ...scrollMeta,
          reason: "scroll-to-non-video",
        });
      } else {
        pauseAllHomeFeedVideos({
          ...scrollMeta,
          exceptPostId: nextId,
          reason: "scroll-switch",
        });
      }

      activeWatchRef.current = { id: nextId, startedAt: now };
      setActiveFeedItemId(nextId);
      setActiveFeedIndex(topIndex);
      if (__DEV__) {
        console.log("KRISTO_FEED_ACTIVE_ITEM_CHANGED", {
          postId: nextId,
          index: topIndex,
          activeIndex: topIndex,
          previousPostId: previous?.id ?? null,
        });
      }
    } else if (!nextId && previous?.id) {
      activeWatchRef.current = null;
      setActiveFeedItemId(null);
      setActiveFeedIndex(-1);
      pauseAllHomeFeedVideos({ reason: "no-viewable-item" });
    }
  }).current;

  if (!visibleData.length) {
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyTitle}>Global Feed</Text>
        <Text style={s.emptyText}>Hakuna post bado.</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <FlatList
        ref={listRef}
        pagingEnabled={false}
        data={visibleData}
        extraData={`${activeFeedItemId}|${activeFeedIndex}|${feedScreenFocused ? 1 : 0}`}
        removeClippedSubviews={false}
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={2}
        updateCellsBatchingPeriod={16}
        keyExtractor={keyExtractor}
        snapToInterval={itemH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum={true}
        bounces={false}
        showsVerticalScrollIndicator={false}
        getItemLayout={getItemLayout}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        renderItem={renderItem}
      />
    </View>
  );
}

const s: any = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#070B14",
  },


  slotFrame: {
    marginTop: 0,
    width: "100%",
    alignSelf: "stretch",
    overflow: "visible",
    marginLeft: -10,
  },
  slotPostHeader: {
    display: "none",
  },
  slotPostKicker: {
    color: "#F4C95D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  slotPostTitle: {
    marginTop: 3,
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    maxWidth: 225,
  },
  slotPostBadge: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.50)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    marginRight: 0,
  },
  slotPostBadgeText: {
    color: "#F4C95D",
    fontSize: 13,
    fontWeight: "900",
  },
  slotPostBody: {
    display: "none",
  },
  slotStageRow: {
    paddingRight: 20,
    gap: 14,
  },
  slotCard: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 22,
    minHeight: 0,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  slotGlassShine: {
    display: "none",
  },
  slotBottomGlow: {
    position: "absolute",
    left: -40,
    right: -40,
    bottom: -58,
    height: 150,
    backgroundColor: "rgba(244,201,93,0.13)",
    borderRadius: 90,
  },
  slotGlow: {
    display: "none",
  },
  slotCountPill: {
    minWidth: 58,
    height: 54,
    borderRadius: 29,
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.48)",
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  slotCountText: {
    color: "#F4C95D",
    fontSize: 16,
    fontWeight: "900",
  },
  slotHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  slotTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "flex-start",
  },
  slotKicker: {
    color: "#FFD76A",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2.4,
  },
  slotTime: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
    textAlign: "right",
    maxWidth: 145,
  },
  slotTitle: {
    color: "#FFFFFF",
    fontSize: 33,
    lineHeight: 31,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 42,
  },
  slotMeta: {
    marginTop: 16,
    color: "rgba(255,255,255,0.86)",
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
    marginBottom: 112,
  },
  slotNavRow: {
    marginTop: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  slotNavBtn: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.40)",
    backgroundColor: "rgba(0,0,0,0.28)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
  },
  slotNavBtnDisabled: {
    opacity: 0.35,
  },
  slotNavText: {
    color: "#F4C95D",
    fontSize: 18,
    fontWeight: "900",
  },
  nextSlotBigCard: {
    width: 214,
    minHeight: 500,
    borderRadius: 38,
    overflow: "hidden",
    backgroundColor: "rgba(9,10,4,0.72)",
    borderWidth: 1.4,
    borderColor: "rgba(244,201,93,0.42)",
    padding: 22,
    opacity: 0.86,
  },
  nextSlotBigKicker: {
    color: "#F4C95D",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  nextSlotBigTitle: {
    marginTop: 72,
    color: "rgba(255,255,255,0.92)",
    fontSize: 20,
    lineHeight: 29,
    fontWeight: "900",
  },
  nextSlotBigMeta: {
    marginTop: 118,
    color: "rgba(255,255,255,0.62)",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
  },
  nextSlotPeek: {
    position: "absolute",
    right: -46,
    top: 250,
    width: 58,
    height: 210,
    borderRadius: 26,
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.36)",
    backgroundColor: "rgba(8,8,3,0.70)",
    paddingVertical: 14,
    paddingHorizontal: 8,
    justifyContent: "center",
    opacity: 0.82,
  },
  nextSlotPeekKicker: {
    color: "#F4C95D",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    transform: [{ rotate: "90deg" }],
  },
  nextSlotPeekTitle: {
    marginTop: 34,
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "900",
    transform: [{ rotate: "90deg" }],
  },

  emptyWrap: {
    flex: 1,
    backgroundColor: "#070B14",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },

  emptyTitle: {
    color: "#F3D28F",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 2,
  },

  emptyText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },

  slide: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#070B14",
  },

  scheduleOnlySlide: {
    backgroundColor: "#030508",
    justifyContent: "center",
    paddingVertical: 20,
  },

  page: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    backgroundColor: "#070B14",
  },

  media: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  feedVideoTouchLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },

  feedVideoCenterPlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },

  feedVideoCenterFlash: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },

  feedVideoCenterPlayCircle: {
    width: FEED_VIDEO_CENTER_BTN_SIZE,
    height: FEED_VIDEO_CENTER_BTN_SIZE,
    borderRadius: FEED_VIDEO_CENTER_BTN_SIZE / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },

  feedVideoCenterPlayCircleSoft: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.24)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  feedVideoPlayIconOffset: {
    marginLeft: 3,
  },

  feedVideoHeartBurst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 7,
  },

  feedVideoControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 2,
    paddingHorizontal: 14,
    paddingBottom: 8,
    paddingTop: 6,
    zIndex: 8,
  },

  feedVideoControlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  feedVideoTimeText: {
    minWidth: 36,
    color: "rgba(255,255,255,0.84)",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.2,
  },

  feedVideoSliderWrap: {
    flex: 1,
    height: 18,
    justifyContent: "center",
  },

  feedVideoSlider: {
    width: "100%",
    height: 18,
    transform: [{ scaleY: 0.72 }],
  },

  mediaImage: {
    width: "100%",
    height: "100%",
  },

  smartImageBackdrop: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    transform: [{ scale: 1.14 }],
  },

  smartImageBackdropSoft: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    opacity: 0.28,
    transform: [{ scale: 1.28 }],
  },

  smartImageBackdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.34)",
  },

  smartImageForeground: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },

  noMediaBg: {
    flex: 1,
    backgroundColor: "#07101D",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
  },

  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: HOME_FEED_OVERLAY_BOTTOM,
    paddingHorizontal: 34,
  },

  bottomVideoMeta: {
    bottom: HOME_FEED_VIDEO_OVERLAY_BOTTOM,
    paddingBottom: 6,
  },

  meta: {
    color: "#F3D28F",
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 2,
    letterSpacing: 0.3,
  },

  scheduleBottomProfile: {
    marginTop: 8,
    minHeight: 50,
    borderRadius: 22,
    backgroundColor: "#151518",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.28)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    shadowColor: "#F4C95D",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },

  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    overflow: "visible",
  },

  videoMetaPanel: {
    alignSelf: "flex-start",
    maxWidth: "78%",
    maxHeight: VIDEO_META_PANEL_MAX_HEIGHT + 36,
    overflow: "hidden",
  },

  videoIdentityRow: {
    minHeight: VIDEO_IDENTITY_ROW_HEIGHT,
    marginBottom: 14,
    alignItems: "flex-end",
  },

  videoIdentityTextWrap: {
    flexShrink: 1,
    minWidth: 0,
    justifyContent: "flex-end",
    gap: 3,
  },

  videoChurchPrimary: {
    color: "#FFFFFF",
    fontSize: 19,
    lineHeight: 23,
    fontWeight: "900",
    letterSpacing: 0.25,
  },

  videoMediaSecondary: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    letterSpacing: 0.12,
  },

  videoDepartmentLabel: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
    letterSpacing: 0.12,
    marginTop: 2,
  },

  videoTitleSlot: {
    height: VIDEO_TITLE_SLOT_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
    marginTop: 4,
    marginBottom: 6,
  },

  videoCaptionSlot: {
    height: VIDEO_CAPTION_SLOT_HEIGHT,
    overflow: "hidden",
    marginBottom: 2,
  },

  videoCaptionSlotExpanded: {
    height: 66,
  },

  videoCaption: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "500",
  },

  videoTitleText: {
    fontSize: 18,
    lineHeight: 22,
  },

  videoMetaText: {
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  feedMediaAvatarWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  feedMediaAvatarGlow: {
    position: "absolute",
    backgroundColor: "rgba(247,211,106,0.20)",
    shadowColor: "#F7D36A",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  feedMediaAvatarRing: {
    borderWidth: 2.5,
    borderColor: "rgba(247,211,106,0.82)",
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },

  feedMediaAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },

  feedMediaAvatarInitial: {
    color: "#1A1205",
    fontSize: 22,
    fontWeight: "900",
  },

  feedMediaAvatarLiveDot: {
    position: "absolute",
    bottom: 3,
    right: 3,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#FF375F",
    borderWidth: 2,
    borderColor: "#0B0F17",
  },

  identityAvatar: {
    borderWidth: 2.5,
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 10,
    borderColor: "rgba(243,210,143,0.72)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  identityAvatarFallback: {
    borderWidth: 2.5,
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "rgba(243,210,143,0.72)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  identityAvatarFallbackText: {
    color: "#F3D28F",
    fontSize: 20,
    fontWeight: "900",
  },

  identityTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },

  identityRole: {
    color: "#F3D28F",
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 0.35,
  },

  identityChurch: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "700",
    marginTop: 2,
    letterSpacing: 0.1,
  },


  noMediaGlow: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    opacity: 0.09,
    top: "20%",
    alignSelf: "center",
  },

  noMediaCard: {
    width: "88%",
    alignSelf: "center",
    borderRadius: 28,
    borderWidth: 1.7,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
    shadowColor: "#1D9BFF",
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
    overflow: "hidden",
  },

  noMediaCardCompact: {
    minHeight: 0,
  },

  noMediaCardLarge: {
    minHeight: 0,
  },

  noMediaCategory: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "900",
    letterSpacing: 2.8,
    textTransform: "uppercase",
  },

  noMediaTitle: {
    color: "#F8FAFC",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0.1,
    marginTop: 18,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1.2,
    borderColor: "rgba(80,150,255,0.16)",
    shadowColor: "#1D9BFF",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    overflow: "hidden",
  },

  noMediaCaption: {
    color: "rgba(255,255,255,0.80)",
    fontSize: 16,
    lineHeight: 28,
    fontWeight: "700",
    marginTop: 22,
  },

  noMediaTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },

  noMediaAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    marginRight: 12,
  },

  noMediaAvatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  noMediaAvatarText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },

  noMediaAuthor: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },

  noMediaActionsRow: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    paddingTop: 18,
  },

  noMediaActionBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  noMediaActionText: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 15,
    fontWeight: "800",
  },

  title: {
    color: "#FFF",
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "900",
    letterSpacing: 0.1,
    textTransform: "uppercase",
    flexShrink: 1,
    marginBottom: 0,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },

  

  

  

  

  body: {
    color: "rgba(255,255,255,0.90)",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "500",
  },

  readMoreBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },

  readMoreText: {
    color: "#F3D28F",
    fontSize: 12,
    fontWeight: "800",
  },

  claimBtn: {
    marginTop: 10,
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: "#F4C95D",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    shadowColor: "#F4C95D",
    shadowOpacity: 0.30,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },

  claimBtnDone: {
    backgroundColor: "rgba(16,185,129,0.24)",
    borderWidth: 1.5,
    borderColor: "rgba(52,211,153,0.72)",
    shadowColor: "#34D399",
    shadowOpacity: 0.58,
    shadowRadius: 22,
    transform: [{ scale: 1.015 }],
  },

  claimBtnText: {
    color: "#07111F",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.35,
  },

  claimBtnTextDone: {
    color: "#34D399",
  },

  claimCountText: {
    color: "#07111F",
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 4,
  },


  slotCardNew: {
    width: 282,
    borderRadius: 30,
    padding: 13,
    backgroundColor: "rgba(17,20,28,0.98)",
    borderWidth: 1.2,
    borderColor: "rgba(244,201,93,0.62)",
    shadowColor: "#F4C95D",
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },

  slotHeaderNew: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  slotKickerNew: {
    color: "#FFD76A",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 3,
  },

  slotCountdownNew: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(247,211,106,0.10)",
    borderWidth: 1,
    borderColor: "rgba(247,211,106,0.30)",
  },

  slotCountdownTextNew: {
    color: "#F7D36A",
    fontSize: 12,
    fontWeight: "900",
  },

  slotMainNew: {
    borderRadius: 24,
    padding: 13,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  slotTitleNew: {
    color: "#FFFFFF",
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.9,
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },

  slotSubNew: {
    marginTop: 5,
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontWeight: "800",
  },

  slotStatsRowNew: {
    flexDirection: "row",
    gap: 9,
    marginTop: 13,
  },

  slotStatNew: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },

  slotStatTextNew: {
    color: "#FFFFFF",
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: "900",
    textAlign: "center",
  },

  slotTimeNew: {
    marginTop: 12,
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  slotProgressNew: {
    marginTop: 10,
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.10)",
  },

  slotProgressFillNew: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#F4C95D",
  },

  slotClaimNew: {
    marginTop: 11,
    minHeight: 54,
    borderRadius: 999,
    backgroundColor: "#F4C95D",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    shadowColor: "#F4C95D",
    shadowOpacity: 0.30,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 12,
  },

  slotClaimNewDone: {
    backgroundColor: "rgba(16,185,129,0.22)",
    borderWidth: 1.4,
    borderColor: "rgba(52,211,153,0.70)",
    shadowColor: "#34D399",
  },

  slotClaimTextNew: {
    color: "#07111F",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  slotClaimTextNewDone: {
    color: "#34D399",
  },

  slotMediaHostNew: {
    marginTop: 9,
    minHeight: 52,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.26)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
  },

  slotHostAvatarNew: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    borderColor: "rgba(244,201,93,0.75)",
  },

  slotHostAvatarFallbackNew: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(244,201,93,0.16)",
    borderWidth: 1.5,
    borderColor: "rgba(244,201,93,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },

  slotHostAvatarTextNew: {
    color: "#F7D36A",
    fontSize: 16,
    fontWeight: "900",
  },

  slotHostTextNew: {
    flex: 1,
  },

  slotHostLabelNew: {
    color: "#F7D36A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
  },

  slotHostNameNew: {
    marginTop: 2,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },

  slotActions: {
    position: "absolute",
    top: 58,
    alignSelf: "center",
    width: "76%",
    zIndex: 10050,
    elevation: 10050,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  slotActionBtn: {
    width: 54,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  slotActionCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,10,16,0.72)",
    borderWidth: 2,
    borderColor: "rgba(56,189,248,0.88)",
    shadowColor: "#38BDF8",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  slotActionCircleWatch: {
    borderColor: "rgba(255,90,122,0.95)",
    backgroundColor: "rgba(255,90,122,0.26)",
  },
  slotActionCircleNext: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderColor: "rgba(243,210,143,0.95)",
    backgroundColor: "rgba(243,210,143,0.28)",
  },
  slotActionText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
    lineHeight: 14,
    marginTop: 3,
    textAlign: "center",
    width: 70,
  },
  slotActionTextActive: {
    color: "#FF5A7A",
    fontSize: 14,
  },
  slotActionTextNext: {
    color: "#F3D28F",
    fontSize: 10,
    lineHeight: 12,
  },
  slotActionBtnWatch: {
    transform: [{ scale: 1.02 }],
  },
  slotActionBtnNext: {
    transform: [{ scale: 1.02 }],
  },

  actions: {
    position: "absolute",
    right: 2,
    bottom: HOME_FEED_ACTIONS_BOTTOM,
    zIndex: 9999,
    elevation: 9999,
    alignItems: "center",
    gap: 16,
  },

  actionBtn: {
    width: 70,
    minHeight: 76,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    elevation: 10000,
  },

  actionBtnActive: {
    transform: [{ scale: 1.03 }],
  },

  actionIconWrap: {
    width: 47,
    height: 47,
    borderRadius: 23.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(7,10,16,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
    transform: [{ translateY: -8 }],
  },

  actionIconWrapLiked: {
    backgroundColor: "rgba(255,90,122,0.22)",
    borderColor: "rgba(255,90,122,0.85)",
  },

  likeRipple: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,90,122,0.75)",
  },

  actionIconWrapSaved: {
    backgroundColor: "rgba(243,210,143,0.14)",
    borderColor: "rgba(243,210,143,0.58)",
  },

  actionText: {
    color: "#FFF",
    fontWeight: "900",
    fontSize: 17,
    lineHeight: 18,
    position: "absolute",
    top: 58,
    left: 0,
    right: 0,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  actionTextActive: {
    color: "#FFFFFF",
  },
  slotLivePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(247,211,106,0.10)",
    borderWidth: 1,
    borderColor: "rgba(247,211,106,0.28)",
  },
  slotLivePillText: {
    color: "#F7D36A",
    fontSize: 11,
    fontWeight: "900",
  },

  slotLivePillUrgent: {
    backgroundColor: "rgba(239,68,68,0.13)",
    borderColor: "rgba(239,68,68,0.44)",
  },

  slotLivePillLive: {
    backgroundColor: "rgba(239,68,68,0.22)",
    borderColor: "rgba(255,107,107,0.72)",
  },

  slotLivePillTextUrgent: {
    color: "#FF6B6B",
  },


  slotMainPanel: {
    borderRadius: 28,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  slotHeroWrap: {
    borderRadius: 28,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  slotTitlePremium: {
    color: "#FFFFFF",
    fontSize: 27,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 8,
    textShadowColor: "rgba(0,0,0,0.70)",
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 8,
  },

  slotMetaPremium: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "800",
    marginTop: 6,
    marginBottom: 10,
  },

  slotDataGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },

  slotDataChip: {
    flex: 1,
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
  },

  slotDataText: {
    color: "#F3F4F6",
    fontSize: 18,
    lineHeight: 20,
    fontWeight: "800",
    textAlign: "center",
  },

  slotTimeBar: {
    marginTop: 2,
  },

  slotTimePremium: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 8,
    marginTop: 0,
  },

  slotProgressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.10)",
  },

  slotProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#F4C95D",
  },


  slotMediaFooter: {
    marginTop: 18,
    minHeight: 58,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.20)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 12,
  },

  slotMediaRow: {
    display: "none",
  },

  slotMiniAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: "rgba(244,201,93,0.75)",
  },

  slotMiniAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(244,201,93,0.18)",
    borderWidth: 1.5,
    borderColor: "rgba(244,201,93,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },

  slotMiniAvatarText: {
    color: "#F7D36A",
    fontSize: 16,
    fontWeight: "900",
  },

  slotMediaTextWrap: {
    flex: 1,
  },

  slotMediaLabel: {
    color: "#F7D36A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
  },

  slotMediaName: {
    marginTop: 2,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },

  slotClaimedBox: {
    marginTop: 12,
    borderRadius: 20,
    backgroundColor: "rgba(52,211,153,0.11)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.30)",
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    gap: 10,
  },


  slotClaimedAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(52,211,153,0.18)",
    borderWidth: 1,
    borderColor: "rgba(52,211,153,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },



  slotClaimedLabel: {
    color: "#6EE7B7",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },


  slotLiveWithCard: {
    marginTop: 18,
    minHeight: 76,
    borderRadius: 26,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.065)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  slotMediaAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.13)",
    borderWidth: 1.5,
    borderColor: "rgba(244,201,93,0.82)",
  },

  slotMediaAvatarText: {
    color: "#F7D36A",
    fontSize: 19,
    fontWeight: "900",
  },

  slotLiveWithTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  slotLiveWithKicker: {
    color: "#F7D36A",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
  },

  slotLiveWithName: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    marginTop: 2,
  },

  slotClaimedPanel: {
    marginTop: 18,
    minHeight: 76,
    borderRadius: 24,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(16,185,129,0.18)",
    borderWidth: 1.4,
    borderColor: "rgba(52,211,153,0.55)",
  },

  slotClaimedAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(52,211,153,0.18)",
    borderWidth: 1.4,
    borderColor: "rgba(52,211,153,0.70)",
  },

  slotClaimedAvatarText: {
    color: "#86EFAC",
    fontSize: 23,
    fontWeight: "900",
  },

  slotClaimedTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  slotClaimedKicker: {
    color: "#86EFAC",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
  },

  slotClaimedName: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
  },

  slotClaimedSub: {
    color: "rgba(255,255,255,0.70)",
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "800",
    marginTop: 2,
  },

  liveFullFrame: {
    marginTop: 250,
    marginHorizontal: 0,
    borderRadius: 38,
    padding: 0,
    transform: [{ translateY: 8 }],
  },
  liveFullCard: {
    width: "98%",
    alignSelf: "flex-start",
    marginLeft: -8,
    borderRadius: 40,
    overflow: "hidden",
    backgroundColor: "#0B111D",
    borderWidth: 1.6,
    borderColor: "#D9B85F",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 18,
  },
  liveFullTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  liveFullBadge: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "#F7D36A",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.38)",
  },
  liveFullBadgeText: {
    color: "#F7D36A",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 8,
  },
  liveFullMini: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
  },
  liveFullHero: {
    paddingTop: 8,
    width: "100%",
    gap: 8,
    marginBottom: 10,
  },
  liveFullTitle: {
    color: "#FFFFFF",
    fontSize: 46,
    lineHeight: 48,
    fontWeight: "900",
    letterSpacing: -1.7,
    marginBottom: 2,
    width: "100%",
    textShadowColor: "rgba(247,211,106,0.24)",
    textShadowRadius: 14,
  },
  liveFullSub: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: -2,
    marginBottom: 8,
  },
  liveFullInfoGrid: {
    gap: 7,
  },
  liveFullInfoBox: {
    minHeight: 50,
    borderRadius: 999,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1.1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  liveFullInfoText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 15.5,
    lineHeight: 18,
    fontWeight: "800",
  },
  liveFullDuration: {
    marginTop: 8,
    minHeight: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#F7D36A",
    borderWidth: 1.25,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#F7D36A",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 14,
  },
  liveFullDurationLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  liveFullDurationSkip: {
    width: 82,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderLeftWidth: 1,
    borderLeftColor: "rgba(6,16,30,0.10)",
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
    overflow: "hidden",
  },

  liveFullDurationSkipCount: {
    color: "#06101E",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 1,
  },
  liveFullDurationSkipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  liveFullDurationSkipText: {
    color: "#06101E",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  liveFullDurationText: {
    color: "#06101E",
    fontSize: 13,
    fontWeight: "900",
  },
  liveFullClaim: {
    marginTop: 10,
    minHeight: 64,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 14,
    backgroundColor: "#F7D36A",
    borderWidth: 1.3,
    borderColor: "rgba(255,255,255,0.78)",
    shadowColor: "#F7D36A",
    shadowOpacity: 0.32,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 11 },
    elevation: 16,
  },
  liveFullClaimText: {
    color: "#06101E",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.1,
  },
  liveSlotStateText: {
    marginTop: 8,
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  liveFullTaken: {
    borderColor: "rgba(251,113,133,0.55)",
    backgroundColor: "rgba(72,18,30,0.72)",
  },

  liveFullClaimed: {
    marginTop: 10,
    minHeight: 70,
    borderRadius: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(16,185,129,0.18)",
    borderWidth: 1.3,
    borderColor: "rgba(52,211,153,0.70)",
  },
  liveFullClaimedText: {
    color: "rgba(255,255,255,0.96)",
    fontSize: 20,
    fontWeight: "900",
    maxWidth: "100%",
  },
  liveClaimGlossLine: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.14)",
  },

  liveClaimUserAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: "rgba(53,229,154,0.95)",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  liveClaimUserAvatarFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderColor: "rgba(53,229,154,0.95)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,95,70,0.92)",
    shadowColor: "#35E59A",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  liveClaimUserAvatarText: {
    color: "#35E59A",
    fontSize: 21,
    fontWeight: "900",
  },
  liveClaimUserTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  liveClaimUserStatus: {
    color: "#F7D36A",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.4,
    marginBottom: 2,
  },

  liveFullHost: {
    marginTop: 12,
    minHeight: 58,
    borderRadius: 28,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1.15,
    borderColor: "rgba(255,255,255,0.15)",
  },
  liveFullAvatar: {
    width: 72,
    height: 58,
    borderRadius: 36,
  },
  liveFullAvatarFallback: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(247,211,106,0.16)",
    borderWidth: 2,
    borderColor: "rgba(247,211,106,0.72)",
  },
  liveFullAvatarText: {
    color: "#F7D36A",
    fontSize: 22,
    fontWeight: "900",
  },
  liveFullHostText: {
    flex: 1,
    marginLeft: 14,
    minWidth: 0,
  },
  liveFullHostLabel: {
    color: "#F7D36A",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 4,
  },
  liveFullHostName: {
    marginTop: 4,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },


  liveFullTopicPill: {
    marginTop: 0,
    marginBottom: 10,
    width: "100%",
    minHeight: 52,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.085)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.22)",
  },
  liveFullTopicText: {
    color: "#FFFFFF",
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "800",
    letterSpacing: -0.4,
  },

  liveFullMiniStats: {
    marginTop: 10,
    flexDirection: "row",
    gap: 10,
  },
  liveFullMiniStat: {
    flex: 1,
    minHeight: 34,
    borderRadius: 16,
    paddingHorizontal: 13,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  liveFullMiniStatLabel: {
    color: "rgba(247,211,106,0.88)",
    fontSize: 8.5,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  liveFullMiniStatValue: {
    marginTop: 1,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },

  liveLuxuryGlowTop: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -105,
    right: -85,
    opacity: 1,
  },
  worldGlassLine: {
    position: "absolute",
    top: 0,
    left: 18,
    right: 18,
    height: 1.2,
    backgroundColor: "rgba(255,255,255,0.18)",
  },

  liveLuxuryGlowBottom: {
    position: "absolute",
    width: 340,
    height: 220,
    borderRadius: 170,
    bottom: -105,
    left: -105,
    opacity: 0.9,
  },


  liveSlotPickerWrap: {
    position: "absolute",
    top: 12,
    right: 22,
    zIndex: 999,
    alignItems: "flex-end",
  },
  liveSlotPickerBtn: {
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E11D48",
    borderWidth: 1.4,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#E11D48",
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 10 },
    elevation: 22,
  },
  liveSlotPickerBtnText: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontWeight: "900",
  },
  liveSlotPickerMenu: {
    marginTop: 8,
    width: 280,
    maxHeight: 260,
    borderRadius: 24,
    padding: 10,
    backgroundColor: "rgba(12,15,24,0.98)",
    borderWidth: 1.2,
    borderColor: "rgba(247,211,106,0.42)",
  },
  liveSlotPickerItem: {
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 10,
    marginBottom: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#151518",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  liveSlotPickerItemActive: {
    backgroundColor: "rgba(247,211,106,0.16)",
    borderColor: "rgba(247,211,106,0.55)",
  },
  liveSlotPickerItemNo: {
    color: "#F7D36A",
    fontSize: 14,
    fontWeight: "900",
    width: 18,
  },
  liveSlotPickerItemText: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
  },
  liveSlotPickerStatus: {
    color: "#34D399",
    fontSize: 9,
    fontWeight: "900",
  },
  liveSlotPickerStatusClaimed: {
    color: "#FB7185",
  },

  watchLiveBtn: {
    marginTop: 18,
    alignSelf: "flex-start",
    minHeight: 52,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: "#F3D28F",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  liveNowPremiumOuter: {
    marginTop: 92,
    marginHorizontal: 24,
    padding: 14,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: "#FF474D",
    backgroundColor: "rgba(7, 8, 22, 0.97)",
    shadowColor: "#FF474D",
    shadowOpacity: 0.52,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    overflow: "hidden",
  },
  liveNowPremiumGlowLeft: {
    position: "absolute",
    left: -80,
    bottom: 90,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(255,71,77,0.18)",
  },
  liveNowPremiumGlowRight: {
    position: "absolute",
    right: -70,
    top: 245,
    width: 180,
    height: 260,
    borderRadius: 100,
    backgroundColor: "rgba(255,71,77,0.22)",
  },
  liveNowPremiumHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 18,
  },
  liveNowPremiumIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: "#FF5A62",
    backgroundColor: "rgba(255,71,77,0.12)",
  },
  liveNowPremiumKicker: {
    color: "#FF474D",
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 6,
  },
  liveNowPremiumName: {
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -1,
  },
  liveNowPremiumTopic: {
    marginTop: 4,
    color: "rgba(255,255,255,0.62)",
    fontSize: 18,
    fontWeight: "800",
  },
  liveNowPremiumBadge: {
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  liveNowPremiumDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FF474D",
  },
  liveNowPremiumBadgeText: {
    color: "#FF777C",
    fontSize: 18,
    fontWeight: "900",
  },
  liveNowPremiumPreview: {
    height: 215,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderWidth: 2,
    borderColor: "rgba(255,220,220,0.62)",
    shadowColor: "#FF474D",
    shadowOpacity: 0.34,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
  },
  liveNowPremiumPreviewImg: {
    width: "100%",
    height: "100%",
  },
  liveNowVideoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,71,77,0.08)",
  },
  liveNowVideoPlaceholderText: {
    marginTop: 12,
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 3,
  },
  liveNowPremiumLivePill: {
    position: "absolute",
    left: 18,
    top: 18,
    paddingHorizontal: 20,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF3F46",
  },
  liveNowPremiumLivePillText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 2,
  },
  liveNowPremiumWatchers: {
    position: "absolute",
    left: 16,
    bottom: 16,
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.50)",
  },
  liveNowPremiumWatchersText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  liveNowPremiumStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 12,
  },
  liveNowPremiumStatBox: {
    flex: 1,
    minHeight: 82,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  liveNowPremiumStatLabel: {
    marginTop: 8,
    color: "rgba(255,255,255,0.48)",
    fontSize: 13,
    fontWeight: "900",
  },
  liveNowPremiumStatValue: {
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "900",
  },
  liveNowPremiumTimeBox: {
    marginTop: 16,
    minHeight: 74,
    borderRadius: 22,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  liveNowPremiumTimeLabel: {
    color: "#FF676D",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  liveNowPremiumTimeValue: {
    marginTop: 4,
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
  },
  liveNowPremiumEnds: {
    color: "#FF676D",
    fontSize: 16,
    fontWeight: "900",
  },
  liveNowPremiumBtn: {
    marginTop: 18,
    height: 66,
    borderRadius: 33,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FF3F46",
    shadowColor: "#FF3F46",
    shadowOpacity: 0.36,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
  },
  liveNowPremiumBtnText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
  },



  liveNowHero: {
    marginTop: 10,
    marginBottom: 16,
    minHeight: 250,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.10)",
  },

  liveNowHeroGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 999,
    backgroundColor: "rgba(255,70,80,0.18)",
  },

  liveNowCenterBadge: {
    width: 112,
    height: 112,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 2,
    borderColor: "rgba(255,90,90,0.45)",
    shadowColor: "#FF4D57",
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 16,
  },

  liveNowLiveRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  liveNowPulse: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#FF4D57",
  },

  liveNowLiveText: {
    color: "#FF7A80",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 4,
  },

  liveNowHeroName: {
    marginTop: 16,
    color: "#FFFFFF",
    fontSize: 34,
    fontWeight: "900",
  },

  liveNowHeroTopic: {
    marginTop: 8,
    paddingHorizontal: 26,
    textAlign: "center",
    color: "rgba(255,255,255,0.66)",
    fontSize: 16,
    fontWeight: "700",
  },

  watchLiveText: {
    color: "#06101E",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },

  slotTopRightActions: {
    display: "none",
  },

  slotTopRightActionBtn: {
    alignItems: "center",
    justifyContent: "center",
  },

  slotTopRightIconWrap: {
    width: 66,
    height: 66,
    borderRadius: 999,
    borderWidth: 1.6,
    borderColor: "rgba(56,189,248,0.95)",
    backgroundColor: "rgba(5,10,25,0.82)",
    alignItems: "center",
    justifyContent: "center",

    shadowColor: "#38BDF8",
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },

    elevation: 16,
  },

  slotTopRightCount: {
    marginTop: 7,
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },

  slotTopRightLabel: {
    marginTop: 7,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },

});

