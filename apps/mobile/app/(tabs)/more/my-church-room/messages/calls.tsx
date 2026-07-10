import React, {
  useCallback,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  fetchPrivateCallHistory,
  type PrivateCallSession,
} from "@/src/lib/privateCallService";

const BG = "#0A1220";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.58)";
const GOLD = "rgba(217,179,95,0.92)";
const RED = "#FF5A67";

type CallHistoryGroup = {
  key: string;
  peerUserId: string;
  peerName: string;
  peerAvatar?: string;
  direction: "incoming" | "outgoing";
  missed: boolean;
  count: number;
  latest: PrivateCallSession;
};

function sessionUserId(session: any): string {
  return String(
    session?.userId ||
      session?.id ||
      session?.viewer?.userId ||
      session?.profile?.userId ||
      ""
  ).trim();
}

function isMissedCall(
  call: PrivateCallSession,
  currentUserId: string
): boolean {
  const incoming = call.pastorUserId === currentUserId;

  if (!incoming) return false;

  return (
    call.status === "timeout" ||
    call.status === "failed" ||
    call.status === "declined"
  );
}

function peerForCall(
  call: PrivateCallSession,
  currentUserId: string
) {
  const outgoing = call.callerUserId === currentUserId;

  return {
    direction: outgoing ? "outgoing" as const : "incoming" as const,
    peerUserId: outgoing
      ? call.pastorUserId
      : call.callerUserId,
    peerName: outgoing
      ? call.pastorName || "Pastor"
      : call.callerName || "Church member",
    peerAvatar: outgoing
      ? call.pastorAvatarUrl
      : call.callerAvatarUrl,
  };
}

function formatCallTime(value: string): string {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "";

  const d = new Date(ms);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  if (isYesterday) {
    return `Yesterday, ${d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function buildGroups(
  calls: PrivateCallSession[],
  currentUserId: string
): CallHistoryGroup[] {
  const sorted = [...calls].sort(
    (a, b) =>
      Date.parse(String(b.createdAt || "")) -
      Date.parse(String(a.createdAt || ""))
  );

  const groups: CallHistoryGroup[] = [];

  for (const call of sorted) {
    const peer = peerForCall(call, currentUserId);
    const missed = isMissedCall(call, currentUserId);

    const previous = groups[groups.length - 1];

    const canMerge =
      previous &&
      previous.peerUserId === peer.peerUserId &&
      previous.direction === peer.direction &&
      previous.missed === missed;

    if (canMerge) {
      previous.count += 1;
      continue;
    }

    groups.push({
      key: call.id,
      peerUserId: peer.peerUserId,
      peerName: peer.peerName,
      peerAvatar: peer.peerAvatar,
      direction: peer.direction,
      missed,
      count: 1,
      latest: call,
    });
  }

  return groups;
}

function CallRow({
  item,
}: {
  item: CallHistoryGroup;
}) {
  const initial =
    String(item.peerName || "?")
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  const statusText = item.missed
    ? "Missed call"
    : item.direction === "outgoing"
      ? "Outgoing call"
      : "Incoming call";

  const statusColor = item.missed ? RED : MUTED;

  return (
    <View style={s.row}>
      <View style={s.avatarWrap}>
        {item.peerAvatar ? (
          <Image
            source={{ uri: item.peerAvatar }}
            style={s.avatar}
          />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarInitial}>
              {initial}
            </Text>
          </View>
        )}

        {item.missed ? (
          <View style={s.missedDot} />
        ) : null}
      </View>

      <View style={s.rowBody}>
        <Text
          numberOfLines={1}
          style={[
            s.peerName,
            item.missed ? s.peerNameMissed : null,
          ]}
        >
          {item.peerName}
          {item.count > 1 ? ` (${item.count})` : ""}
        </Text>

        <View style={s.statusLine}>
          <Ionicons
            name={
              item.direction === "outgoing"
                ? "arrow-up"
                : "arrow-down"
            }
            size={14}
            color={statusColor}
          />

          <Text
            style={[
              s.statusText,
              { color: statusColor },
            ]}
          >
            {statusText}
          </Text>
        </View>
      </View>

      <View style={s.rightSide}>
        <Text style={s.timeText}>
          {formatCallTime(item.latest.createdAt)}
        </Text>

        <View style={s.callIcon}>
          <Ionicons
            name="call-outline"
            size={20}
            color={GOLD}
          />
        </View>
      </View>
    </View>
  );
}

export default function CallsHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const kristoSession = useKristoSession() as any;

  const currentUserId = sessionUserId(
    kristoSession?.session
  );

  const [calls, setCalls] = useState<
    PrivateCallSession[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] =
    useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);

      try {
        const rows = await fetchPrivateCallHistory();
        setCalls(rows);
      } catch (error) {
        console.log(
          "KRISTO_CALL_HISTORY_FETCH_FAILED",
          {
            error: String(
              (error as Error)?.message || error
            ),
          }
        );
        setCalls([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load])
  );

  const data = useMemo(
    () => buildGroups(calls, currentUserId),
    [calls, currentUserId]
  );

  return (
    <View
      style={[
        s.screen,
        { paddingTop: insets.top + 10 },
      ]}
    >
      <View style={s.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            s.headerBtn,
            pressed ? s.headerBtnPressed : null,
          ]}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={TEXT}
          />
        </Pressable>

        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>
            Calls
          </Text>
          <Text style={s.headerSubtitle}>
            Voice call history
          </Text>
        </View>

        <View style={s.headerIcon}>
          <Ionicons
            name="call"
            size={21}
            color={GOLD}
          />
        </View>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={GOLD} />
          <Text style={s.loadingText}>
            Loading calls…
          </Text>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <CallRow item={item} />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            s.listContent,
            data.length === 0
              ? s.listContentEmpty
              : null,
            {
              paddingBottom:
                Math.max(insets.bottom, 18) + 18,
            },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={GOLD}
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons
                  name="call-outline"
                  size={34}
                  color={GOLD}
                />
              </View>

              <Text style={s.emptyTitle}>
                No calls yet
              </Text>

              <Text style={s.emptyText}>
                Your incoming, outgoing and missed
                calls will appear here.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    height: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },

  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
  },

  headerBtnPressed: {
    opacity: 0.65,
  },

  headerTitleWrap: {
    flex: 1,
    paddingHorizontal: 12,
  },

  headerTitle: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "800",
  },

  headerSubtitle: {
    color: MUTED,
    fontSize: 11,
    marginTop: 1,
  },

  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },

  listContent: {
    paddingTop: 8,
  },

  listContentEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },

  row: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
  },

  rowPressed: {
    backgroundColor: "rgba(255,255,255,0.045)",
  },

  avatarWrap: {
    width: 54,
    height: 54,
    marginRight: 12,
  },

  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  avatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
  },

  avatarInitial: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "800",
  },

  missedDot: {
    position: "absolute",
    right: 1,
    bottom: 2,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: RED,
    borderWidth: 2,
    borderColor: BG,
  },

  rowBody: {
    flex: 1,
    minWidth: 0,
  },

  peerName: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "700",
  },

  peerNameMissed: {
    color: "#FFFFFF",
    fontWeight: "800",
  },

  statusLine: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  statusText: {
    fontSize: 12.5,
    fontWeight: "500",
  },

  rightSide: {
    marginLeft: 10,
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 7,
  },

  timeText: {
    color: MUTED,
    fontSize: 11,
  },

  callIcon: {
    width: 32,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  loadingText: {
    color: MUTED,
    fontSize: 13,
  },

  empty: {
    paddingHorizontal: 38,
    alignItems: "center",
  },

  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
  },

  emptyTitle: {
    marginTop: 17,
    color: TEXT,
    fontSize: 18,
    fontWeight: "800",
  },

  emptyText: {
    marginTop: 7,
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
});
