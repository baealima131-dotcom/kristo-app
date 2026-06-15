import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeLiveScheduleCard } from "@/src/components/HomeLiveScheduleCard";
import { getSessionSync } from "@/src/lib/kristoSession";
import { enterLiveRoomFromScheduleCard } from "@/src/lib/enterLiveRoomNavigation";
import { homeFeedLiveCardHeight } from "@/src/lib/homeFeedYouTubeLayout";
import { HOME_FEED_BG, HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  rows: any[];
  cardHeight: number;
  onClose: () => void;
};

function LiveStreamListItem({
  item,
  cardHeight,
  onClose,
}: {
  item: any;
  cardHeight: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const session = getSessionSync() as any;
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const activeSlot = useMemo(() => {
    const slots = Array.isArray(item?.scheduleSlots) ? item.scheduleSlots : [];
    return slots[0] || null;
  }, [item?.scheduleSlots]);

  const slotNumber = Math.max(1, Number(item?.slotNumber || 1));
  const slotFeedTotal = Math.max(
    1,
    Number(item?.parentScheduleSlotCount || item?.scheduleSlots?.length || 1)
  );

  const handleEnterLiveRoom = useCallback(() => {
    onClose();
    enterLiveRoomFromScheduleCard({
      router,
      item,
      activeSlot,
      viewerUserId: String(session?.userId || "").trim(),
      viewerChurchId: String(session?.churchId || "").trim(),
      nowMs,
      source: "home-feed-live-section",
    });
  }, [activeSlot, item, nowMs, onClose, router, session?.churchId, session?.userId]);

  const profileName = String(
    session?.displayName || session?.name || session?.fullName || "You"
  ).trim();
  const profileAvatarUri = String(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  ).trim();

  return (
    <View style={[styles.liveItem, { height: cardHeight }]}>
      <LinearGradient colors={["#030508", "#0A0F18", "#050810"]} style={StyleSheet.absoluteFillObject} />
      <HomeLiveScheduleCard
        item={item}
        activeSlot={activeSlot}
        slotFeedIndex={slotNumber - 1}
        slotFeedTotal={slotFeedTotal}
        nowMs={nowMs}
        isActive
        fullBleed
        disableSlotCarousel={item?.homeFeedSlotExpanded === true}
        profileName={profileName}
        profileAvatarUri={profileAvatarUri}
        onOpenLiveRoom={handleEnterLiveRoom}
      />
    </View>
  );
}

export const HomeFeedLiveStreamsSheet = memo(function HomeFeedLiveStreamsSheet({
  visible,
  rows,
  cardHeight,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();

  if (!rows.length) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Live Streams</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {rows.map((row, index) => (
            <LiveStreamListItem
              key={String(row?.id || index)}
              item={row}
              cardHeight={cardHeight}
              onClose={onClose}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
});

export function HomeFeedLiveHeader({
  primaryLive,
  extraLiveCount,
  cardHeight,
  onViewMoreLive,
  likedByMe,
  liked,
  likeCount,
  saved,
  onLike,
  onComment,
  onShare,
  onSave,
}: {
  primaryLive: any;
  extraLiveCount: number;
  cardHeight: number;
  onViewMoreLive: () => void;
  likedByMe: boolean;
  liked: boolean;
  likeCount: number;
  saved: boolean;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
}) {
  const router = useRouter();
  const session = getSessionSync() as any;
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);

  const activeSlot = useMemo(() => {
    const slots = Array.isArray(primaryLive?.scheduleSlots) ? primaryLive.scheduleSlots : [];
    return slots[0] || null;
  }, [primaryLive?.scheduleSlots]);

  const slotNumber = Math.max(1, Number(primaryLive?.slotNumber || 1));
  const slotFeedTotal = Math.max(
    1,
    Number(primaryLive?.parentScheduleSlotCount || primaryLive?.scheduleSlots?.length || 1)
  );

  const handleEnterLiveRoom = useCallback(() => {
    enterLiveRoomFromScheduleCard({
      router,
      item: primaryLive,
      activeSlot,
      viewerUserId: String(session?.userId || "").trim(),
      viewerChurchId: String(session?.churchId || "").trim(),
      nowMs,
      source: "home-feed-live-section",
    });
  }, [activeSlot, nowMs, primaryLive, router, session?.churchId, session?.userId]);

  const profileName = String(
    session?.displayName || session?.name || session?.fullName || "You"
  ).trim();
  const profileAvatarUri = String(
    session?.avatarUri || session?.avatarUrl || session?.profileImage || ""
  ).trim();

  return (
    <View style={styles.headerWrap}>
      <View style={[styles.liveCard, { height: cardHeight }]}>
        <LinearGradient colors={["#030508", "#0A0F18", "#050810"]} style={StyleSheet.absoluteFillObject} />
        <HomeLiveScheduleCard
          item={primaryLive}
          activeSlot={activeSlot}
          slotFeedIndex={slotNumber - 1}
          slotFeedTotal={slotFeedTotal}
          nowMs={nowMs}
          isActive
          fullBleed
          disableSlotCarousel={primaryLive?.homeFeedSlotExpanded === true}
          profileName={profileName}
          profileAvatarUri={profileAvatarUri}
          onOpenLiveRoom={handleEnterLiveRoom}
          displayLiked={likedByMe || liked}
          likeCount={likeCount}
          localSaved={saved}
          onLike={onLike}
          onComment={onComment}
          onShare={onShare}
          onToggleSave={onSave}
        />
      </View>
      {extraLiveCount > 0 ? (
        <Pressable style={styles.viewMoreBtn} onPress={onViewMoreLive}>
          <Text style={styles.viewMoreText}>View More Live Streams</Text>
          <Text style={styles.viewMoreSub}>{extraLiveCount} more live</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Default live card height for callers without window dimensions. */
export function defaultHomeFeedLiveCardHeight(windowHeight: number) {
  return homeFeedLiveCardHeight(windowHeight);
}

const styles = StyleSheet.create({
  headerWrap: {
    backgroundColor: HOME_FEED_BG,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  liveCard: {
    width: "100%",
    overflow: "hidden",
  },
  viewMoreBtn: {
    marginHorizontal: 12,
    marginVertical: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,55,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,55,95,0.35)",
    alignItems: "center",
    gap: 2,
  },
  viewMoreText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  viewMoreSub: {
    color: HOME_FEED_MUTED,
    fontSize: 12,
    fontWeight: "600",
  },
  sheet: {
    flex: 1,
    backgroundColor: HOME_FEED_BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  closeText: {
    color: HOME_FEED_GOLD_SOFT,
    fontSize: 15,
    fontWeight: "700",
  },
  liveItem: {
    width: "100%",
    marginBottom: 16,
    overflow: "hidden",
  },
});
