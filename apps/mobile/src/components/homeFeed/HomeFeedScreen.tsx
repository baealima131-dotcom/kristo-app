import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Share,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import {
  feedList,
  feedToggleLike,
  feedToggleSave,
  subscribe as subscribeHomeFeed,
} from "@/src/lib/homeFeedStore";
import { FeedList } from "./FeedList";
import { FeedReportSheet } from "./FeedReportSheet";
import { FeedCommentsSheet } from "./FeedCommentsSheet";
import {
  normalizeCommentPostId,
  userHasActiveChurchMembership,
} from "@/src/lib/homeFeedComments";
import { getSessionSync } from "@/src/lib/kristoSession";
import { fetchHomeFeedFromApi, syncHomeFeedLike } from "./homeFeedApi";
import {
  feedRenderKey,
  hydrateFeedRowLikes,
  buildHomeFeedDisplayRows,
  homeFeedScheduleEngagementId,
  isHomeFeedScheduleCardRow,
  readFeedItemLikedByMe,
} from "./homeFeedUtils";
import { HOME_FEED_BG, homeFeedSlideHeight } from "./theme";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";
import {
  getLocallyReportedPostIds,
  markPostReportedLocally,
  syncReportedPostIdsFromApi,
} from "@/src/lib/homeFeedReport";
import { isHomeFeedRenderPaused } from "@/src/lib/liveRoomStartup";
import { pauseAllHomeFeedVideos } from "@/src/lib/homeFeedVideoController";
import {
  consumeHomeFeedScheduleDirty,
  peekHomeFeedScheduleDirty,
  subscribeHomeFeedScheduleDirty,
} from "@/src/lib/homeFeedScheduleDirty";

export default function HomeFeedScreen() {
  const { height: windowHeight } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const screenFocused = useIsFocused();
  const { focusPostId } = useLocalSearchParams<{ focusPostId?: string }>();

  const [backendRows, setBackendRows] = useState<any[]>([]);
  const [localTick, setLocalTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [appActive, setAppActive] = useState(() => AppState.currentState === "active");
  const [optimisticLikes, setOptimisticLikes] = useState<
    Record<string, { likedByMe: boolean; likeCount: number }>
  >({});
  const [likeUiEpoch, setLikeUiEpoch] = useState(0);
  const [optimisticSaved, setOptimisticSaved] = useState<Record<string, boolean>>({});
  const [reportedPostIds, setReportedPostIds] = useState<Record<string, true>>({});
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [reportTargetPostId, setReportTargetPostId] = useState("");
  const [commentsSheetOpen, setCommentsSheetOpen] = useState(false);
  const [commentTargetPostId, setCommentTargetPostId] = useState("");
  const [commentRailCount, setCommentRailCount] = useState(0);
  const [commentCountOverrides, setCommentCountOverrides] = useState<Record<string, number>>({});
  const [successBanner, setSuccessBanner] = useState("");

  const focusHandledRef = useRef("");
  const successBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScheduleFeedIdRef = useRef<string | null>(null);

  const contentHeight = homeFeedSlideHeight(windowHeight, tabBarHeight);
  const homeFeedRenderPaused = isHomeFeedRenderPaused();
  const feedFocused = screenFocused && appActive && !homeFeedRenderPaused;

  useEffect(() => {
    if (!homeFeedRenderPaused) return;
    pauseAllHomeFeedVideos({ reason: "live-room-open" });
  }, [homeFeedRenderPaused]);

  useEffect(() => {
    const unsub = subscribeHomeFeed(() => {
      if (isHomeFeedRenderPaused()) return;
      setLocalTick((n) => n + 1);
    });
    return () => {
      try {
        (unsub as any)?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  const loadFeed = useCallback(async (reason = "load", opts?: { force?: boolean }) => {
    if (isHomeFeedRenderPaused()) return;

    const force = opts?.force === true;
    const hasLocalSchedule = feedList().some(isHomeFeedScheduleCardRow);
    if (!force || !hasLocalSchedule) {
      setLoading(true);
    }
    try {
      const rows = await fetchHomeFeedFromApi(reason, { force });
      setBackendRows(rows);
      setOptimisticLikes((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const row of rows) {
          const postId = homeFeedScheduleEngagementId(row);
          if (!postId || !(postId in next)) continue;
          const serverLikedByMe = readFeedItemLikedByMe(row);
          if (serverLikedByMe || next[postId].likedByMe === serverLikedByMe) {
            delete next[postId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setLikeUiEpoch((n) => n + 1);
    } catch {
      setBackendRows((prev) => prev);
    } finally {
      setLoading(false);
    }
  }, []);

  const forceReloadAfterSchedule = useCallback(
    (source: string, backendFeedId?: string | null) => {
      if (backendFeedId) {
        pendingScheduleFeedIdRef.current = String(backendFeedId).trim();
      }
      console.log("KRISTO_HOME_FEED_FORCE_RELOAD_AFTER_SCHEDULE", {
        source,
        backendFeedId: pendingScheduleFeedIdRef.current,
      });
      setLocalTick((n) => n + 1);
      void loadFeed("schedule-dirty", { force: true });
    },
    [loadFeed]
  );

  useEffect(() => {
    const reload = (source: string) => {
      const dirty = peekHomeFeedScheduleDirty();
      forceReloadAfterSchedule(source, dirty?.backendFeedId || null);
    };
    (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__ = reload;
    return () => {
      if ((globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__ === reload) {
        delete (globalThis as any).__KRISTO_HOME_FEED_FORCE_RELOAD__;
      }
    };
  }, [forceReloadAfterSchedule]);

  useEffect(() => {
    const unsub = subscribeHomeFeedScheduleDirty(() => {
      if (isHomeFeedRenderPaused()) return;

      const session = getSessionSync() as any;
      const churchId = String(session?.churchId || "").trim();
      const dirty = peekHomeFeedScheduleDirty(churchId);
      if (dirty?.backendFeedId) {
        pendingScheduleFeedIdRef.current = dirty.backendFeedId;
      }
      setLocalTick((n) => n + 1);

      if (!screenFocused) return;

      const consumed = consumeHomeFeedScheduleDirty(churchId);
      if (consumed) {
        forceReloadAfterSchedule("schedule-dirty-subscribe", consumed.backendFeedId);
      }
    });
    return unsub;
  }, [forceReloadAfterSchedule, screenFocused]);

  useEffect(() => {
    const session = getSessionSync() as any;
    const churchId = String(session?.churchId || "").trim();

    if (screenFocused) {
      const dirty = consumeHomeFeedScheduleDirty(churchId);
      if (dirty) {
        forceReloadAfterSchedule("schedule-dirty-focus", dirty.backendFeedId);
        return;
      }
      void loadFeed("focus");
      return;
    }

    void loadFeed("load");
  }, [loadFeed, screenFocused, forceReloadAfterSchedule]);

  useEffect(() => {
    if (!feedFocused) return;
    const timer = setInterval(() => {
      void loadFeed("poll");
    }, 45000);
    return () => clearInterval(timer);
  }, [feedFocused, loadFeed]);

  useEffect(() => {
    if (!feedFocused || homeFeedRenderPaused) return;
    const timer = setInterval(() => {
      setLocalTick((n) => n + 1);
    }, 20_000);
    return () => clearInterval(timer);
  }, [feedFocused, homeFeedRenderPaused]);

  const serverLikeByPostId = useMemo(() => {
    const map: Record<string, { likedByMe: boolean; likeCount: number }> = {};
    for (const row of backendRows) {
      const postId = homeFeedScheduleEngagementId(row);
      if (!postId) continue;
      map[postId] = {
        likedByMe: readFeedItemLikedByMe(row),
        likeCount: Number(row?.likeCount || 0),
      };
    }
    return map;
  }, [backendRows]);

  const localFeedSnapshot = useMemo(() => {
    void localTick;
    return feedList();
  }, [localTick]);

  const feedRows = useMemo(() => {
    if (homeFeedRenderPaused && backendRows.length) {
      return backendRows;
    }
    const merged = buildHomeFeedDisplayRows(backendRows, localFeedSnapshot);
    return hydrateFeedRowLikes(merged, serverLikeByPostId);
  }, [backendRows, localFeedSnapshot, serverLikeByPostId, homeFeedRenderPaused]);

  useEffect(() => {
    const targetId = String(pendingScheduleFeedIdRef.current || "").trim();
    if (!targetId) return;

    const visible = feedRows.some((row) => {
      if (!isHomeFeedScheduleCardRow(row)) return false;
      const rowId = String(row?.id || "").trim();
      const parentId = String(row?.parentScheduleId || row?.sourceScheduleId || "").trim();
      return (
        rowId === targetId ||
        parentId === targetId ||
        baseFeedId(rowId) === baseFeedId(targetId)
      );
    });

    if (!visible) return;

    console.log("KRISTO_HOME_FEED_SCHEDULE_VISIBLE_AFTER_CREATE", {
      backendFeedId: targetId,
      feedCount: feedRows.length,
      scheduleSlotCount: feedRows.filter(isHomeFeedScheduleCardRow).length,
    });
    pendingScheduleFeedIdRef.current = null;
  }, [feedRows]);

  useEffect(() => {
    let alive = true;

    void getLocallyReportedPostIds().then((ids) => {
      if (!alive || !ids.length) return;
      setReportedPostIds((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = true;
        return next;
      });
    });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!feedRows.length) return;

    const ids = feedRows
      .map((item) => baseFeedId(String(item?.id || "")))
      .filter(Boolean);

    let alive = true;
    void syncReportedPostIdsFromApi(ids).then((reported) => {
      if (!alive || !reported.length) return;
      setReportedPostIds((prev) => {
        const next = { ...prev };
        for (const id of reported) next[id] = true;
        return next;
      });
    });

    return () => {
      alive = false;
    };
  }, [feedRows]);

  useEffect(() => {
    return () => {
      if (successBannerTimerRef.current) {
        clearTimeout(successBannerTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const rawFocusId = String(focusPostId || "").trim();
    if (!rawFocusId || !feedRows.length) return;
    if (focusHandledRef.current === rawFocusId) return;

    const matchIndex = feedRows.findIndex((item) => String(item?.id || "") === rawFocusId);
    if (matchIndex < 0) return;

    focusHandledRef.current = rawFocusId;
    setActiveIndex(matchIndex);
  }, [focusPostId, feedRows]);

  useEffect(() => {
    if (activeIndex >= feedRows.length && feedRows.length > 0) {
      setActiveIndex(Math.max(0, feedRows.length - 1));
    }
  }, [activeIndex, feedRows.length]);

  const getLikeState = useCallback(
    (item: any, logContext?: { index?: number }) => {
      const postId = homeFeedScheduleEngagementId(item);
      if (!postId) {
        return { likedByMe: false, liked: false, likeCount: 0 };
      }

      const itemLikedByMe = readFeedItemLikedByMe(item);
      const hydrated = serverLikeByPostId[postId];
      const serverLikedByMe = hydrated?.likedByMe === true || itemLikedByMe;
      const serverLikeCount = Math.max(
        Number(item?.likeCount || 0),
        Number(hydrated?.likeCount || 0)
      );

      const override = Object.prototype.hasOwnProperty.call(optimisticLikes, postId)
        ? optimisticLikes[postId]
        : undefined;
      const overrideLikedByMe = override?.likedByMe;

      let finalLikedByMe = serverLikedByMe;
      if (override) {
        if (serverLikedByMe) {
          finalLikedByMe = true;
        } else if (overrideLikedByMe === true) {
          finalLikedByMe = true;
        } else {
          finalLikedByMe = false;
        }
      }

      const likeCount = Math.max(
        serverLikeCount,
        override ? Number(override.likeCount || 0) : 0
      );

      if (logContext?.index === activeIndex) {
        console.log("KRISTO_LIKE_UI_STATE", {
          postId,
          itemLikedByMe,
          overrideLikedByMe: overrideLikedByMe ?? null,
          finalLikedByMe,
          likeCount,
        });
      }

      return {
        likedByMe: finalLikedByMe,
        liked: finalLikedByMe,
        likeCount,
      };
    },
    [activeIndex, optimisticLikes, serverLikeByPostId]
  );

  const getSavedState = useCallback(
    (item: any) => {
      const postId = String(item?.id || "");
      if (Object.prototype.hasOwnProperty.call(optimisticSaved, postId)) {
        return optimisticSaved[postId];
      }
      return Boolean(item?.saved);
    },
    [optimisticSaved]
  );

  const handleLike = useCallback(
    (item: any) => {
      const postId = homeFeedScheduleEngagementId(item);
      if (!postId) return;

      const current = getLikeState(item);
      const nextLikedByMe = !current.likedByMe;
      const nextCount = Math.max(0, current.likeCount + (nextLikedByMe ? 1 : -1));

      setOptimisticLikes((prev) => ({
        ...prev,
        [postId]: { likedByMe: nextLikedByMe, likeCount: nextCount },
      }));
      setLikeUiEpoch((n) => n + 1);

      feedToggleLike(postId);
      syncHomeFeedLike(postId, nextLikedByMe);
    },
    [getLikeState]
  );

  const handleSave = useCallback(
    (item: any) => {
      const postId = String(item?.id || "").trim();
      if (!postId) return;

      const nextSaved = !getSavedState(item);
      setOptimisticSaved((prev) => ({ ...prev, [postId]: nextSaved }));
      feedToggleSave(postId);
    },
    [getSavedState]
  );

  const discussionCountFromItem = useCallback((item: any) => {
    const total = Number(item?.totalDiscussionCount || 0);
    if (total > 0) return total;
    return Number(item?.commentCount || 0) + Number(item?.replyCount || 0);
  }, []);

  const getVisibleDiscussionCount = useCallback(
    (item: any) => {
      const postId = normalizeCommentPostId(String(item?.id || ""));
      const serverCount = discussionCountFromItem(item);
      const hasOverride =
        Boolean(postId) && Object.prototype.hasOwnProperty.call(commentCountOverrides, postId);
      const overrideCount = hasOverride ? commentCountOverrides[postId] : undefined;
      const visibleCount = hasOverride
        ? Math.max(serverCount, overrideCount ?? 0)
        : serverCount;

      if (hasOverride && serverCount < (overrideCount ?? 0)) {
        console.log("KRISTO_COMMENT_COUNT_STALE_FEED_IGNORED", {
          postId,
          serverCount,
          overrideCount,
          visibleCount,
        });
      }

      console.log("KRISTO_COMMENT_COUNT_SOURCE", {
        postId,
        serverCount,
        overrideCount: hasOverride ? overrideCount : null,
        visibleCount,
      });

      return visibleCount;
    },
    [commentCountOverrides, discussionCountFromItem]
  );

  const handleComment = useCallback((item: any) => {
    const postId = normalizeCommentPostId(String(item?.id || "").trim());
    if (!postId) return;

    const session = getSessionSync();
    if (!userHasActiveChurchMembership(session)) {
      Alert.alert("Join a church", "Join a church to comment on posts.");
      return;
    }

    setCommentTargetPostId(postId);
    setCommentRailCount(getVisibleDiscussionCount(item));
    setCommentsSheetOpen(true);
  }, [getVisibleDiscussionCount]);

  const handleDiscussionCountChange = useCallback((postId: string, count: number) => {
    const cleanId = normalizeCommentPostId(postId);
    if (!cleanId || !Number.isFinite(count)) return;
    const nextCount = Math.max(0, count);
    console.log("KRISTO_COMMENT_COUNT_OVERRIDE_SET", {
      postId: cleanId,
      count: nextCount,
      source: "comments_confirmed",
    });
    setCommentCountOverrides((prev) => ({ ...prev, [cleanId]: nextCount }));
  }, []);

  const handleDiscussionCountBump = useCallback(
    (postId: string, delta: number) => {
      const cleanId = normalizeCommentPostId(postId);
      if (!cleanId || !Number.isFinite(delta) || delta === 0) return;

      setCommentCountOverrides((prev) => {
        const item = feedRows.find(
          (row) => normalizeCommentPostId(String(row?.id || "")) === cleanId
        );
        const serverCount = discussionCountFromItem(item || {});
        const prevOverride = Object.prototype.hasOwnProperty.call(prev, cleanId)
          ? prev[cleanId]
          : undefined;
        const visibleBase =
          prevOverride !== undefined ? Math.max(serverCount, prevOverride) : serverCount;
        const nextCount = Math.max(0, visibleBase + delta);
        console.log("KRISTO_COMMENT_COUNT_OVERRIDE_SET", {
          postId: cleanId,
          count: nextCount,
          source: delta > 0 ? "optimistic_bump" : "optimistic_rollback",
          delta,
        });
        return { ...prev, [cleanId]: nextCount };
      });
    },
    [feedRows, discussionCountFromItem]
  );

  const handleShare = useCallback(async (item: any) => {
    const title = String(item?.title || "").trim();
    const body = String(item?.body || item?.text || "").trim();
    const church = String(item?.churchName || item?.churchLabel || "").trim();
    const message = [title, body, church].filter(Boolean).join("\n\n");
    try {
      await Share.share({ message: message || "Shared from Kristo", title: title || "Kristo" });
    } catch {}
  }, []);

  const isPostReported = useCallback(
    (item: any) => {
      const postId = baseFeedId(String(item?.id || ""));
      return Boolean(postId && reportedPostIds[postId]);
    },
    [reportedPostIds]
  );

  const handleReport = useCallback((item: any) => {
    const postId = normalizeCommentPostId(String(item?.id || "").trim());
    if (!postId) return;
    setReportTargetPostId(postId);
    setReportSheetOpen(true);
  }, []);

  const handleReported = useCallback((postId: string) => {
    const cleanId = baseFeedId(postId);
    if (!cleanId) return;

    void markPostReportedLocally(cleanId);
    setReportedPostIds((prev) => ({ ...prev, [cleanId]: true }));
    setSuccessBanner("Report submitted. Thank you for helping keep Kristo safe.");

    if (successBannerTimerRef.current) {
      clearTimeout(successBannerTimerRef.current);
    }
    successBannerTimerRef.current = setTimeout(() => {
      setSuccessBanner("");
    }, 3200);
  }, []);

  return (
    <View style={[styles.screen, { height: contentHeight }]}>
      {successBanner ? (
        <View style={styles.successBanner} pointerEvents="none">
          <Text style={styles.successBannerText}>{successBanner}</Text>
        </View>
      ) : null}

      <FeedList
        rows={feedRows}
        contentHeight={contentHeight}
        activeIndex={activeIndex}
        screenFocused={feedFocused}
        loading={loading}
        likeUiEpoch={likeUiEpoch}
        getLikeState={getLikeState}
        getSavedState={getSavedState}
        getVisibleDiscussionCount={getVisibleDiscussionCount}
        isPostReported={isPostReported}
        onActiveIndexChange={setActiveIndex}
        onLike={handleLike}
        onComment={handleComment}
        onShare={handleShare}
        onSave={handleSave}
        onReport={handleReport}
      />

      <FeedReportSheet
        visible={reportSheetOpen}
        postId={reportTargetPostId}
        onClose={() => setReportSheetOpen(false)}
        onReported={handleReported}
      />

      <FeedCommentsSheet
        visible={commentsSheetOpen}
        postId={commentTargetPostId}
        railDiscussionCount={commentRailCount}
        onClose={() => setCommentsSheetOpen(false)}
        onDiscussionCountChange={handleDiscussionCountChange}
        onDiscussionCountBump={handleDiscussionCountBump}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignSelf: "stretch",
    backgroundColor: HOME_FEED_BG,
    overflow: "hidden",
  },
  successBanner: {
    position: "absolute",
    top: 12,
    left: 14,
    right: 14,
    zIndex: 40,
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  successBannerText: {
    color: "#F4D06F",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
});
