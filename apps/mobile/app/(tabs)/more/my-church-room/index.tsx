import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import ChurchActivityGrid from "@/src/components/ChurchActivityGrid";
import { ChurchActivityDetailModal } from "@/src/components/ChurchActivityDetailModal";
import {
  isChurchActivityPost,
  sortActivityPostsNewestFirst,
  type ActivityGridItem,
} from "@/src/lib/churchActivityPosts";

const BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const BLUE = "rgba(0,145,255,0.92)";
const CARD = "rgba(255,255,255,0.03)";
const CARD2 = "rgba(255,255,255,0.035)";
const BORDER = "rgba(255,255,255,0.10)";
const BORDER_SOFT = "rgba(255,255,255,0.08)";
const PAD = 16;
const ACTIVITY_PAGE_SIZE = 24;
const ACTIVITY_SCROLL_THRESHOLD = 520;
const ACTIVITY_MIN_ROWS_PER_LOAD = 10;
const ACTIVITY_MAX_BACKEND_PAGES_PER_LOAD = 5;

function mergeActivityPages(
  current: ActivityGridItem[],
  incoming: ActivityGridItem[]
) {
  const byId = new Map<string, ActivityGridItem>();

  for (const item of [...current, ...incoming]) {
    const id = String(item?.id || "").trim();
    if (!id) continue;
    byId.set(id, item);
  }

  return sortActivityPostsNewestFirst(
    [...byId.values()]
  );
}

function ShareControlAction({
  label,
  icon,
  color,
  backgroundColor,
  borderColor,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  backgroundColor: string;
  borderColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.shareControlAction,
        {
          backgroundColor,
          borderColor,
        },
        pressed
          ? ({
              opacity: 0.9,
              transform: [{ scale: 0.96 }],
            } as ViewStyle)
          : null,
      ]}
    >
      <View
        style={[
          s.shareControlActionIcon,
          {
            borderColor,
            backgroundColor,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={17}
          color={color}
        />
      </View>

      <Text
        style={[
          t.shareControlActionText,
          {
            color: "#FFFFFF",
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ChurchShareControl({
  onAnnouncement,
  onStatus,
  onTestimony,
}: {
  onAnnouncement: () => void;
  onStatus: () => void;
  onTestimony: () => void;
}) {
  return (
    <View style={s.shareControlCard}>
      <View
        pointerEvents="none"
        style={s.shareControlGoldGlow}
      />
      <View
        pointerEvents="none"
        style={s.shareControlBlueGlow}
      />
      <View
        pointerEvents="none"
        style={s.shareControlRedGlow}
      />

      <View style={s.shareControlHeader}>
        <View style={s.shareControlMainIcon}>
          <Ionicons
            name="megaphone"
            size={20}
            color="#0B0F17"
          />
        </View>

        <View style={s.shareControlHeaderText}>
          <Text style={t.shareControlKicker}>
            CHURCH COMMUNICATION
          </Text>
          <Text style={t.shareControlTitle}>
            Share Control
          </Text>
        </View>
      </View>

      <View style={s.shareControlActions}>
        <ShareControlAction
          label="Announcement"
          icon="megaphone"
          color="#E2BD61"
          backgroundColor="rgba(226,189,97,0.12)"
          borderColor="rgba(226,189,97,0.48)"
          onPress={onAnnouncement}
        />

        <ShareControlAction
          label="Status"
          icon="add-circle"
          color="#FF5E7C"
          backgroundColor="rgba(255,55,94,0.12)"
          borderColor="rgba(255,74,108,0.50)"
          onPress={onStatus}
        />

        <ShareControlAction
          label="Testimony"
          icon="sparkles"
          color="#199FFF"
          backgroundColor="rgba(0,145,255,0.12)"
          borderColor="rgba(0,145,255,0.50)"
          onPress={onTestimony}
        />
      </View>
    </View>
  );
}

export default function MyChurchRoom() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [roomFeedItems, setRoomFeedItems] =
    useState<ActivityGridItem[]>([]);
  const [selectedActivity, setSelectedActivity] =
    useState<ActivityGridItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nextActivityCursor, setNextActivityCursor] =
    useState<string | null>("0");
  const [activityHasMore, setActivityHasMore] =
    useState(true);
  const [activityInitialLoading, setActivityInitialLoading] =
    useState(true);
  const [activityLoadingMore, setActivityLoadingMore] =
    useState(false);

  const activityLoadingRef = useRef(false);
  const activityGenerationRef = useRef(0);

  const loadActivityPage = useCallback(
    async (
      startCursor: string,
      replaceItems: boolean,
      generation: number
    ) => {
      if (activityLoadingRef.current) return;

      activityLoadingRef.current = true;

      if (replaceItems) {
        setActivityInitialLoading(true);
      } else {
        setActivityLoadingMore(true);
      }

      try {
        const session = getSessionSync() as any;
        if (!session?.userId) {
          if (
            generation ===
            activityGenerationRef.current
          ) {
            if (replaceItems) {
              setRoomFeedItems([]);
            }
            setNextActivityCursor(null);
            setActivityHasMore(false);
          }
          return;
        }

        const headers = getKristoHeaders({
          userId: session.userId,
          role: (session.role || "Member") as any,
          churchId: session.churchId || "",
        });

        let cursor: string | null =
          String(startCursor || "0");
        let hasMore = true;
        const collected: ActivityGridItem[] = [];

        for (
          let backendPage = 0;
          backendPage <
          ACTIVITY_MAX_BACKEND_PAGES_PER_LOAD;
          backendPage += 1
        ) {
          if (!cursor || !hasMore) break;

          const query = [
            "/api/church/feed?scope=church",
            `limit=${ACTIVITY_PAGE_SIZE}`,
            `cursor=${encodeURIComponent(cursor)}`,
            `_=${Date.now()}`,
          ].join("&");

          const feedRes: any = await apiGet(
            query,
            {
              headers,
              cache: "no-store" as RequestCache,
            }
          );

          if (feedRes?.ok === false) {
            throw new Error(
              String(
                feedRes?.error ||
                  "Failed to load church activity"
              )
            );
          }

          const pageRows = Array.isArray(feedRes?.data)
            ? feedRes.data
            : [];

          for (const row of pageRows) {
            if (!isChurchActivityPost(row)) continue;
            collected.push(row as ActivityGridItem);
          }

          hasMore = Boolean(feedRes?.hasMore);
          cursor = hasMore
            ? String(feedRes?.nextCursor || "").trim() ||
              null
            : null;

          if (
            collected.length >=
            ACTIVITY_MIN_ROWS_PER_LOAD
          ) {
            break;
          }
        }

        if (
          generation !==
          activityGenerationRef.current
        ) {
          return;
        }

        setRoomFeedItems((current) =>
          mergeActivityPages(
            replaceItems ? [] : current,
            collected
          )
        );
        setNextActivityCursor(cursor);
        setActivityHasMore(
          Boolean(hasMore && cursor)
        );
      } catch (error) {
        if (
          generation !==
          activityGenerationRef.current
        ) {
          return;
        }

        console.log(
          "KRISTO_CHURCH_ACTIVITY_PAGE_FAILED",
          {
            cursor: startCursor,
            replaceItems,
            error: String(
              (error as Error)?.message ||
                error ||
                "unknown"
            ),
          }
        );

        if (replaceItems) {
          setRoomFeedItems([]);
        }
      } finally {
        if (
          generation ===
          activityGenerationRef.current
        ) {
          activityLoadingRef.current = false;
          setActivityInitialLoading(false);
          setActivityLoadingMore(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const generation =
      activityGenerationRef.current + 1;

    activityGenerationRef.current = generation;
    activityLoadingRef.current = false;

    setRoomFeedItems([]);
    setNextActivityCursor("0");
    setActivityHasMore(true);

    void loadActivityPage(
      "0",
      true,
      generation
    );

    return () => {
      if (
        activityGenerationRef.current ===
        generation
      ) {
        activityGenerationRef.current =
          generation + 1;
        activityLoadingRef.current = false;
      }
    };
  }, [refreshKey, loadActivityPage]);

  const handleActivityScroll = useCallback(
    (
      event: NativeSyntheticEvent<NativeScrollEvent>
    ) => {
      const {
        contentOffset,
        contentSize,
        layoutMeasurement,
      } = event.nativeEvent;

      const distanceFromBottom =
        contentSize.height -
        (contentOffset.y + layoutMeasurement.height);

      if (
        distanceFromBottom >
        ACTIVITY_SCROLL_THRESHOLD
      ) {
        return;
      }

      if (
        !activityHasMore ||
        !nextActivityCursor ||
        activityLoadingRef.current
      ) {
        return;
      }

      void loadActivityPage(
        nextActivityCursor,
        false,
        activityGenerationRef.current
      );
    },
    [
      activityHasMore,
      nextActivityCursor,
      loadActivityPage,
    ]
  );



  const selectedActivityIndex =
    selectedActivity
      ? roomFeedItems.findIndex(
          (item) =>
            String(item?.id || "") ===
            String(selectedActivity?.id || "")
        )
      : -1;



  useEffect(() => {
    if (
      selectedActivityIndex < 0 ||
      selectedActivityIndex <
        roomFeedItems.length - 3 ||
      !activityHasMore ||
      !nextActivityCursor ||
      activityLoadingRef.current
    ) {
      return;
    }

    void loadActivityPage(
      nextActivityCursor,
      false,
      activityGenerationRef.current
    );
  }, [
    selectedActivityIndex,
    roomFeedItems.length,
    activityHasMore,
    nextActivityCursor,
    loadActivityPage,
  ]);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <View style={s.header}>
        <View style={s.royalHeaderRow}>
          <View style={s.royalHeaderButton}>
            <Text
              style={t.royalHeaderCross}
              accessibilityLabel="Christian cross"
            >
              ✝
            </Text>
          </View>

          <Text
            style={t.royalHeaderTitle}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            MY CHURCH ROOM
          </Text>

          <Pressable
            onPress={() =>
              setRefreshKey((current) => current + 1)
            }
            style={({ pressed }) => [
              s.royalHeaderButton,
              pressed
                ? {
                    opacity: 0.86,
                    transform: [{ scale: 0.95 }],
                  }
                : null,
            ]}
            accessibilityLabel="Refresh church room"
          >
            <Ionicons
              name="refresh"
              size={24}
              color={GOLD}
            />
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: PAD,
          paddingBottom: insets.bottom + 28,
        }}
        onScroll={handleActivityScroll}
        scrollEventThrottle={16}
      >
        <View style={s.sectionBlock}>
          <ChurchShareControl
            onAnnouncement={() =>
              router.push(
                "/more/my-church-room/announcements/create" as any
              )
            }
            onStatus={() =>
              router.push(
                "/more/my-church-room/announcements/create?kind=post" as any
              )
            }
            onTestimony={() =>
              router.push(
                "/more/my-church-room/announcements/create?kind=testimony" as any
              )
            }
          />
        </View>

        <View style={s.sectionBlock}>
          <Text style={t.section}>Church Activity</Text>
          {activityInitialLoading &&
          roomFeedItems.length === 0 ? (
            <View style={s.activityLoadingState}>
              <ActivityIndicator
                size="small"
                color={GOLD}
              />
              <Text style={t.activityLoadingText}>
                Loading church posts...
              </Text>
            </View>
          ) : (
            <ChurchActivityGrid
              items={roomFeedItems}
              emptyTitle="No church activity yet"
              emptyBody="Posts from your church members will appear here."
              onItemPress={setSelectedActivity}
            />
          )}

          {activityLoadingMore ? (
            <View style={s.activityLoadingMore}>
              <ActivityIndicator
                size="small"
                color={GOLD}
              />
              <Text style={t.activityLoadingText}>
                Loading more posts...
              </Text>
            </View>
          ) : null}

          {!activityInitialLoading &&
          !activityLoadingMore &&
          !activityHasMore &&
          roomFeedItems.length > 0 ? (
            <Text style={t.activityEndText}>
              You have reached all church posts
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <ChurchActivityDetailModal
        items={roomFeedItems}
        initialItemId={
          selectedActivity
            ? String(selectedActivity.id)
            : null
        }
        onActiveItemChange={(nextItem) =>
          setSelectedActivity(nextItem)
        }
        onEndReached={() => {
          if (
            !activityHasMore ||
            !nextActivityCursor ||
            activityLoadingRef.current
          ) {
            return;
          }

          void loadActivityPage(
            nextActivityCursor,
            false,
            activityGenerationRef.current
          );
        }}
        onClose={() =>
          setSelectedActivity(null)
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG } as ViewStyle,

  header: {
    paddingHorizontal: PAD,
    paddingBottom: 8,
  } as ViewStyle,
  royalHeaderRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as ViewStyle,
  royalHeaderButton: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(44,13,55,0.92)",
    borderWidth: 1,
    borderColor: "rgba(232,193,91,0.88)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.22,
    shadowRadius: 7,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    elevation: 5,
  } as ViewStyle,

  block: { marginBottom: 22 } as ViewStyle,
  sectionBlock: { marginBottom: 22 } as ViewStyle,

  // VIP glass card (shared)
  card: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: CARD2,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    shadowColor: GOLD,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  } as ViewStyle,

  cardGold: {
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(255,255,255,0.032)",
  } as ViewStyle,

  cardGoldSoft: {
    borderColor: "rgba(217,179,95,0.16)",
    backgroundColor: "rgba(255,255,255,0.028)",
  } as ViewStyle,



  comingChip: { marginTop: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  profileTop: { flexDirection: "row", alignItems: "center", gap: 12 } as ViewStyle,
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  } as ViewStyle,


  heroTop: { flexDirection: "row", alignItems: "center", gap: 10 } as ViewStyle,
  heroBadge: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  } as ViewStyle,
  heroDivider: { marginTop: 8, height: 1, backgroundColor: "rgba(255,255,255,0.08)" } as ViewStyle,

  row: {
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  } as ViewStyle,
  rowIcon: {
    width: 36, height: 36, borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,








  shareControlCard: {
    minHeight: 134,
    borderRadius: 22,
    padding: 12,
    backgroundColor: "rgba(29,25,21,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.46)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.23,
    shadowRadius: 16,
    shadowOffset: {
      width: 0,
      height: 7,
    },
    elevation: 7,
    overflow: "hidden",
  } as ViewStyle,
  shareControlGoldGlow: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    left: -48,
    top: -55,
    backgroundColor: "rgba(217,179,95,0.14)",
  } as ViewStyle,
  shareControlBlueGlow: {
    position: "absolute",
    width: 115,
    height: 115,
    borderRadius: 58,
    right: -38,
    bottom: -42,
    backgroundColor: "rgba(0,145,255,0.12)",
  } as ViewStyle,
  shareControlRedGlow: {
    position: "absolute",
    width: 86,
    height: 86,
    borderRadius: 43,
    left: "42%",
    bottom: -48,
    backgroundColor: "rgba(255,55,94,0.11)",
  } as ViewStyle,
  shareControlHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  } as ViewStyle,
  shareControlMainIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D9B35F",
    borderWidth: 1,
    borderColor: "rgba(255,231,166,0.72)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    elevation: 6,
  } as ViewStyle,
  shareControlHeaderText: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  shareControlActions: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  } as ViewStyle,
  shareControlAction: {
    flex: 1,
    minWidth: 0,
    height: 54,
    borderRadius: 15,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    overflow: "hidden",
  } as ViewStyle,
  shareControlActionIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  } as ViewStyle,

  activityLoadingState: {
    minHeight: 180,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.025)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
  } as ViewStyle,
  activityLoadingMore: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  } as ViewStyle,

});

const t = StyleSheet.create({
  royalHeaderTitle: {
    flex: 1,
    color: "#E8C15B",
    fontFamily: "Georgia",
    fontSize: 21,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: 1.65,
    textAlign: "center",
    textShadowColor: "rgba(232,193,91,0.28)",
    textShadowRadius: 8,
  } as TextStyle,
  royalHeaderCross: {
    color: "#E8C15B",
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "900",
    textAlign: "center",
    textShadowColor: "rgba(232,193,91,0.55)",
    textShadowRadius: 9,
  } as TextStyle,

  feedHint: { marginTop: 2, color: "rgba(255,255,255,0.58)", fontWeight: "800", fontSize: 12, lineHeight: 16 } as any,
  title: { color: "white", fontWeight: "900", fontSize: 28, letterSpacing: 0.3 } as TextStyle,
  sub: { marginTop: 6, color: SUB, fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,

  section: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as TextStyle,
  sectionSub: { marginTop: 5, color: "rgba(255,255,255,0.52)", fontWeight: "700", fontSize: 12, lineHeight: 17 } as TextStyle,


  profileName: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  profileHandle: { marginTop: 2, color: "rgba(255,255,255,0.6)", fontWeight: "800", fontSize: 12 } as TextStyle,
  profileHint: { marginTop: 10, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,



  comingText: { color: GOLD, fontWeight: "900", letterSpacing: 0.2, fontSize: 12 } as TextStyle,

  heroTitle: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 } as TextStyle,
  heroHint: { marginTop: 6, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13, lineHeight: 18 } as TextStyle,

  shareControlKicker: {
    color: "rgba(217,179,95,0.90)",
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "900",
    letterSpacing: 1.25,
  } as TextStyle,
  shareControlTitle: {
    marginTop: 2,
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: 0.15,
  } as TextStyle,
  shareControlActionText: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 0.05,
    textAlign: "center",
  } as TextStyle,

  activityLoadingText: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  } as TextStyle,
  activityEndText: {
    marginTop: 12,
    color: "rgba(217,179,95,0.54)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    textAlign: "center",
  } as TextStyle,

});
