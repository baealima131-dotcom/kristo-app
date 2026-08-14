import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  fetchMessagesInboxConversations,
  type MessagesInboxConversation,
} from "@/src/lib/messagesInbox";
import { StartNewChatSheet } from "@/src/components/messages/StartNewChatSheet";
import type { DirectMessageThread } from "@/src/lib/directMessagesApi";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { clearLegacyMessageLockPrefs } from "@/src/lib/clearLegacyMessageLockPrefs";

const BG = "#0A1220";
const TEXT = "rgba(255,255,255,0.94)";
const GOLD = "rgba(217,179,95,0.92)";
const PAD = 16;

const MESSAGE_GLASS = [
  {
    colors: [
      "rgba(5,55,44,0.95)",
      "rgba(7,62,51,0.93)",
      "rgba(12,57,60,0.91)",
      "rgba(20,48,65,0.89)",
    ] as const,
    border: "rgba(94,225,177,0.28)",
  },
  {
    colors: [
      "rgba(5,49,53,0.95)",
      "rgba(7,56,65,0.93)",
      "rgba(10,51,75,0.91)",
      "rgba(16,43,68,0.89)",
    ] as const,
    border: "rgba(78,205,232,0.30)",
  },
  {
    colors: [
      "rgba(12,51,45,0.95)",
      "rgba(19,53,57,0.93)",
      "rgba(34,46,72,0.91)",
      "rgba(47,39,73,0.89)",
    ] as const,
    border: "rgba(169,126,238,0.29)",
  },
  {
    colors: [
      "rgba(9,54,42,0.95)",
      "rgba(18,58,46,0.93)",
      "rgba(38,54,48,0.91)",
      "rgba(52,47,40,0.89)",
    ] as const,
    border: "rgba(225,184,98,0.28)",
  },
  {
    colors: [
      "rgba(8,55,43,0.95)",
      "rgba(17,58,48,0.93)",
      "rgba(40,51,51,0.91)",
      "rgba(57,43,52,0.89)",
    ] as const,
    border: "rgba(224,160,121,0.28)",
  },
  {
    colors: [
      "rgba(7,49,48,0.95)",
      "rgba(13,52,61,0.93)",
      "rgba(26,46,73,0.91)",
      "rgba(39,39,72,0.89)",
    ] as const,
    border: "rgba(125,152,244,0.28)",
  },
];

function getConversationGlass(item: MessagesInboxConversation) {
  const source = String(item.id || item.title || "conversation");
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = (Math.imul(hash, 31) + source.charCodeAt(index)) | 0;
  }

  return MESSAGE_GLASS[Math.abs(hash) % MESSAGE_GLASS.length];
}

function ConversationRow({
  item,
  onPress,
}: {
  item: MessagesInboxConversation;
  onPress: () => void;
}) {
  const initial = String(item.title || "?").trim().charAt(0).toUpperCase() || "?";
  const isRequest = item.isRequestReceiver === true;
  const preview = String(
    item.lastMessagePreview || (isRequest ? "Message request" : "")
  ).trim();

  const previewLower = preview.toLowerCase();
  const previewTone = previewLower.includes("incoming")
    ? "#78D8FF"
    : previewLower.includes("outgoing")
      ? "#6EE7B7"
      : "rgba(224,238,235,0.72)";
  const accentTone = previewLower.includes("incoming")
    ? "#56CCFF"
    : previewLower.includes("outgoing")
      ? "#4DE0A3"
      : "#F4C95D";

  const glass = getConversationGlass(item);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        { borderColor: glass.border },
        pressed ? s.rowPressed : null,
      ]}
    >
      <BlurView intensity={18} tint="dark" style={s.rowGlass} />
      <LinearGradient
        pointerEvents="none"
        colors={glass.colors}
        locations={[0, 0.42, 0.76, 1]}
        start={{ x: 0, y: 0.15 }}
        end={{ x: 1, y: 0.85 }}
        style={s.rowGradient}
      />

      <View style={s.avatarWrap}>
        {item.avatarUri ? (
          <Image source={{ uri: item.avatarUri }} style={s.avatarImage} />
        ) : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarFallbackText}>{initial}</Text>
          </View>
        )}
      </View>

      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <View style={s.rowTitleWrap}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {isRequest ? (
              <View style={s.requestBadge}>
                <Text style={s.requestBadgeText}>REQUEST</Text>
              </View>
            ) : null}
          </View>
          {item.timestampLabel ? (
            <Text style={s.rowTime} numberOfLines={1}>
              {item.timestampLabel}
            </Text>
          ) : null}
        </View>

        <Text style={s.rowSubtitle} numberOfLines={1}>
          {isRequest ? "Message request" : item.subtitle}
        </Text>

        <View style={s.rowBottom}>
          <Text style={[s.rowPreview, { color: previewTone }]} numberOfLines={2}>
            {preview || (isRequest ? "Message request" : "")}
          </Text>
          {item.unreadCount > 0 ? (
            <View style={s.unreadBadge}>
              <Text style={s.unreadBadgeText}>
                {item.unreadCount > 99 ? "99+" : String(item.unreadCount)}
              </Text>
            </View>
          ) : (
            <View style={s.unreadBadgeGhost} />
          )}
        </View>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<MessagesInboxConversation[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    void clearLegacyMessageLockPrefs();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;

    async function heartbeatMessagesList() {
      if (!alive) return;
      await apiGet(
        `/api/auth/presence?heartbeat=1&t=${Date.now()}`,
        { headers: getKristoHeaders() as any },
        { screen: "MessagesListPresenceHeartbeat", throttleMs: 0, dedupe: false } as any
      ).catch(() => null);
    }

    void heartbeatMessagesList();
    const timer = setInterval(heartbeatMessagesList, 5000);

      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [])
  );

  const refreshInbox = useCallback(async () => {
    const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    if (!base) {
      setConversations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = await fetchMessagesInboxConversations({ base });
      setConversations(rows);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshInbox();
    }, [refreshInbox])
  );

  const data = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return conversations;

    return conversations.filter((row) => {
      const haystack = `${row.title} ${row.subtitle} ${row.lastMessagePreview}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [conversations, q]);

  const openConversation = useCallback(
    (item: MessagesInboxConversation) => {
      router.push({
        pathname: "/(tabs)/profile/messages/[id]",
        params: {
          id: item.id,
          title: item.title,
          sub: item.subtitle,
          avatar: item.avatarUri,
          roomKind: "direct",
          peerUserId: item.peerUserId,
          churchId: item.churchId,
        },
      } as any);
    },
    [router]
  );

  const openThread = useCallback(
    (thread: DirectMessageThread) => {
      router.push({
        pathname: "/(tabs)/profile/messages/[id]",
        params: {
          id: thread.roomId,
          title: thread.title,
          sub: thread.subtitle,
          avatar: thread.avatarUri,
          roomKind: "direct",
          peerUserId: thread.peerUserId,
          churchId: thread.churchId,
        },
      } as any);
    },
    [router]
  );

  const onCompose = useCallback(() => {
    setComposeOpen(true);
  }, []);

  const onCalls = useCallback(() => {
    router.push(
      "/(tabs)/more/my-church-room/messages/calls" as any
    );
  }, [router]);

  const onMessageSettings = useCallback(() => {
    router.push(
      "/(tabs)/more/my-church-room/messages/settings" as any
    );
  }, [router]);

  const headerActions = useMemo(
    () => [
      { key: "calls", icon: "call-outline" as const, onPress: onCalls, label: "Calls" },
      { key: "compose", icon: "add" as const, onPress: onCompose, label: "Start new chat" },
      {
        key: "settings",
        icon: "settings-outline" as const,
        onPress: onMessageSettings,
        label: "Message settings",
      },
    ],
    [onCalls, onCompose, onMessageSettings]
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10 }]}>
      <View pointerEvents="none" style={s.goldGlow} />
      <View pointerEvents="none" style={s.blueGlow} />
      <View pointerEvents="none" style={s.greenGlowBottom} />
      <View style={s.header}>
        <Pressable
          onPress={() => router.replace("/(tabs)/profile" as any)}
          style={({ pressed }) => [s.headerBtn, pressed ? s.headerBtnPressed : null]}
        >
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle} numberOfLines={1}>
            Messages
          </Text>
        </View>

        <View style={s.headerActions}>
          {headerActions.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={action.onPress}
              style={({ pressed }) => [
                s.headerIconBtn,
                pressed ? s.headerBtnPressed : null,
              ]}
            >
              <Ionicons
                name={action.icon}
                size={21}
                color={
                  action.key === "calls"
                    ? "#67E8B5"
                    : action.key === "compose"
                      ? "#F4C95D"
                      : "#70D5FF"
                }
              />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.searchWrap}>
        <LinearGradient
          pointerEvents="none"
          colors={[
            "rgba(8,66,53,0.91)",
            "rgba(7,59,55,0.90)",
            "rgba(10,51,65,0.89)",
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.searchGradient}
        />

        <Ionicons name="search" size={17} color="#65DDB0" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search conversations"
          placeholderTextColor="rgba(177,225,207,0.68)"
          style={s.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {q.trim().length > 0 ? (
          <Pressable onPress={() => setQ("")} style={s.clearBtn}>
            <Ionicons name="close" size={16} color="rgba(255,255,255,0.65)" />
          </Pressable>
        ) : null}
      </View>

      <View style={s.sectionBar}>
        <Text style={s.sectionLabel}>CONVERSATIONS</Text>
        <View style={s.sectionLine} />
        <View style={s.countPill}>
          <Text style={s.countText}>{data.length}</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={GOLD} />
        </View>
      ) : (
        <FlatList
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          data={data}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, flexGrow: data.length ? 0 : 1 }}
          renderItem={({ item }) => (
            <ConversationRow item={item} onPress={() => openConversation(item)} />
          )}
          ItemSeparatorComponent={() => <View style={s.divider} />}
          ListEmptyComponent={
            <View style={s.emptyWrap}>
              {!q.trim() ? (
                <View style={s.emptyIconWrap}>
                  <Ionicons name="chatbubble-ellipses-outline" size={28} color={GOLD} />
                </View>
              ) : null}
              <Text style={s.emptyTitle}>
                {q.trim() ? "No matching conversations" : "No messages yet"}
              </Text>
              <Text style={s.emptySub}>
                {q.trim()
                  ? "Try another search term."
                  : "Your conversations will appear here."}
              </Text>
            </View>
          }
        />
      )}

      <StartNewChatSheet
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onStarted={(thread) => {
          void refreshInbox();
          openThread(thread);
        }}
      />
    </View>
  );
}

// MESSAGES_EMERALD_V4
// MESSAGES_AURORA_V5
// MESSAGES_SMOOTH_GLASS_V6
// MESSAGES_CAPSULE_GLASS_V7
// MESSAGES_PREMIUM_COMPACT_V8
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#04110E",
    paddingHorizontal: PAD,
    overflow: "hidden",
  } as ViewStyle,

  goldGlow: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -170,
    right: -105,
    backgroundColor: "rgba(38,218,143,0.13)",
  } as ViewStyle,

  blueGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    top: 315,
    left: -175,
    backgroundColor: "rgba(45,174,220,0.10)",
  } as ViewStyle,

  greenGlowBottom: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    bottom: -210,
    right: -190,
    backgroundColor: "rgba(244,201,93,0.08)",
  } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 13,
    zIndex: 2,
  } as ViewStyle,

  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,40,33,0.82)",
    borderWidth: 1,
    borderColor: "rgba(80,224,165,0.42)",
    shadowColor: "#28D995",
    shadowOpacity: 0.22,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  } as ViewStyle,

  headerBtnPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.96 }],
  } as ViewStyle,

  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    minWidth: 0,
  } as ViewStyle,

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  } as ViewStyle,

  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,40,33,0.82)",
    borderWidth: 1,
    borderColor: "rgba(80,224,165,0.34)",
    shadowColor: "#28D995",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  } as ViewStyle,

  headerTitle: {
    color: "#F7FFFC",
    fontWeight: "900",
    fontSize: 22,
    letterSpacing: 0.1,
    textShadowColor: "rgba(39,215,148,0.22)",
    textShadowRadius: 12,
    textShadowOffset: { width: 0, height: 2 },
  } as TextStyle,

  searchWrap: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    borderRadius: 20,
    borderCurve: "continuous",
    paddingHorizontal: 15,
    marginBottom: 9,
    backgroundColor: "rgba(5,38,34,0.72)",
    borderWidth: 1,
    borderColor: "rgba(106,221,181,0.23)",
    overflow: "hidden",
  } as ViewStyle,

  searchGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderCurve: "continuous",
    opacity: 0.82,
  } as ViewStyle,

  searchShine: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: "rgba(171,255,221,0.50)",
  } as ViewStyle,

  searchGlass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,47,36,0.48)",
  } as ViewStyle,

  sectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 4,
    marginBottom: 8,
  } as ViewStyle,

  sectionLabel: {
    color: "rgba(116,231,187,0.78)",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.25,
  } as TextStyle,

  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(91,225,171,0.18)",
  } as ViewStyle,

  countPill: {
    minWidth: 24,
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.13)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.32)",
  } as ViewStyle,

  countText: {
    color: "#F4C95D",
    fontSize: 10,
    fontWeight: "900",
  } as TextStyle,

  searchInput: {
    flex: 1,
    color: "#EDFFF8",
    fontSize: 14,
    fontWeight: "700",
    paddingVertical: 9,
  } as TextStyle,

  clearBtn: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(73,216,162,0.12)",
  } as ViewStyle,

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
  } as ViewStyle,

  row: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minHeight: 78,
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 21,
    borderCurve: "continuous",
    backgroundColor: "rgba(4,32,29,0.68)",
    borderWidth: 1,
    overflow: "hidden",
  } as ViewStyle,

  rowGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 21,
    borderCurve: "continuous",
    opacity: 0.82,
  } as ViewStyle,

  rowShine: {
    position: "absolute",
    top: 0,
    left: 28,
    right: 28,
    height: 1,
    backgroundColor: "rgba(179,255,224,0.42)",
  } as ViewStyle,

  rowGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 21,
    borderCurve: "continuous",
    overflow: "hidden",
  } as ViewStyle,

  rowPressed: {
    opacity: 0.74,
    transform: [{ scale: 0.99 }],
  } as ViewStyle,

  avatarWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    overflow: "hidden",
    backgroundColor: "rgba(8,44,38,0.90)",
    borderWidth: 1.25,
    borderColor: "rgba(225,190,103,0.64)",
  } as ViewStyle,

  avatarImage: {
    width: "100%",
    height: "100%",
  } as ImageStyle,

  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(55,125,96,0.48)",
  } as ViewStyle,

  avatarFallbackText: {
    color: "#FFD76A",
    fontWeight: "900",
    fontSize: 18,
  } as TextStyle,

  rowBody: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,

  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  } as ViewStyle,

  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  } as ViewStyle,

  rowTitle: {
    flexShrink: 1,
    color: "#F8FFFC",
    fontWeight: "900",
    fontSize: 16,
  } as TextStyle,

  requestBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(244,201,93,0.16)",
    borderWidth: 1,
    borderColor: "rgba(244,201,93,0.54)",
  } as ViewStyle,

  requestBadgeText: {
    color: "#FFD76A",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.55,
  } as TextStyle,

  rowTime: {
    color: "#F4C95D",
    opacity: 0.78,
    fontWeight: "800",
    fontSize: 10,
  } as TextStyle,

  rowSubtitle: {
    marginTop: 2,
    color: "rgba(109,231,184,0.72)",
    fontWeight: "700",
    fontSize: 11,
  } as TextStyle,

  rowBottom: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  } as ViewStyle,

  rowPreview: {
    flex: 1,
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 16,
  } as TextStyle,

  unreadBadge: {
    minWidth: 21,
    height: 21,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4DE0A3",
    shadowColor: "#4DE0A3",
    shadowOpacity: 0.34,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
  } as ViewStyle,

  unreadBadgeText: {
    color: "#032017",
    fontWeight: "900",
    fontSize: 10,
  } as TextStyle,

  unreadBadgeGhost: {
    width: 21,
    height: 21,
  } as ViewStyle,

  divider: {
    height: 6,
    backgroundColor: "transparent",
  } as ViewStyle,

  privacyCard: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    minHeight: 68,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginTop: 10,
    borderRadius: 28,
    borderCurve: "continuous",
    backgroundColor: "rgba(5,39,34,0.68)",
    borderWidth: 1,
    borderColor: "rgba(91,211,169,0.20)",
    overflow: "hidden",
  } as ViewStyle,

  privacyGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
  } as ViewStyle,

  privacyGlass: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,42,33,0.45)",
  } as ViewStyle,

  privacyIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(77,224,163,0.12)",
    borderWidth: 1,
    borderColor: "rgba(77,224,163,0.3)",
  } as ViewStyle,

  privacyTitle: {
    color: "#DFFFF2",
    fontSize: 12,
    fontWeight: "900",
  } as TextStyle,

  privacySub: {
    marginTop: 2,
    color: "rgba(137,213,184,0.66)",
    fontSize: 10,
    fontWeight: "700",
  } as TextStyle,

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 64,
  } as ViewStyle,

  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
    backgroundColor: "rgba(7,40,32,0.82)",
    borderWidth: 1,
    borderColor: "rgba(84,227,169,0.38)",
    shadowColor: "#34DB98",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  } as ViewStyle,

  emptyTitle: {
    color: "#F4FFF9",
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  } as TextStyle,

  emptySub: {
    marginTop: 7,
    color: "rgba(163,220,198,0.68)",
    fontWeight: "700",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  } as TextStyle,
});
