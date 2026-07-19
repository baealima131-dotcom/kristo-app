import React, { useCallback, useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  fetchMessagesInboxConversations,
  type MessagesInboxConversation,
} from "@/src/lib/messagesInbox";
import { StartNewChatSheet } from "@/src/components/messages/StartNewChatSheet";
import { MessagesSecurityGate } from "@/src/components/messageSettings/MessagesSecurityGate";
import type { DirectMessageThread } from "@/src/lib/directMessagesApi";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const BG = "#0A1220";
const TEXT = "rgba(255,255,255,0.94)";
const GOLD = "rgba(217,179,95,0.92)";
const PAD = 16;

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

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed ? s.rowPressed : null]}
    >
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
          <Text style={s.rowPreview} numberOfLines={2}>
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
    <MessagesSecurityGate>
    <View style={[s.screen, { paddingTop: insets.top + 10 }]}>
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
              <Ionicons name={action.icon} size={24} color={GOLD} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search conversations"
          placeholderTextColor="rgba(255,255,255,0.45)"
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
    </MessagesSecurityGate>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: PAD,
  } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 12,
  } as ViewStyle,

  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  headerBtnPressed: {
    opacity: 0.85,
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
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  headerTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 22,
    letterSpacing: 0.2,
  } as TextStyle,

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 46,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  } as ViewStyle,

  searchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 15,
    fontWeight: "700",
    paddingVertical: 10,
  } as TextStyle,

  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
  } as ViewStyle,

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
  } as ViewStyle,

  rowPressed: {
    opacity: 0.9,
  } as ViewStyle,

  avatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  avatarImage: {
    width: "100%",
    height: "100%",
  } as ImageStyle,

  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  } as ViewStyle,

  avatarFallbackText: {
    color: GOLD,
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
    gap: 8,
  } as ViewStyle,

  rowTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  } as ViewStyle,

  rowTitle: {
    flexShrink: 1,
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
  } as TextStyle,

  requestBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  } as ViewStyle,

  requestBadgeText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  } as TextStyle,

  rowTime: {
    color: "rgba(255,255,255,0.48)",
    fontWeight: "700",
    fontSize: 11,
  } as TextStyle,

  rowSubtitle: {
    marginTop: 2,
    color: "rgba(255,255,255,0.55)",
    fontWeight: "700",
    fontSize: 12,
  } as TextStyle,

  rowBottom: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  } as ViewStyle,

  rowPreview: {
    flex: 1,
    color: "rgba(255,255,255,0.62)",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 18,
  } as TextStyle,

  unreadBadge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF3B30",
  } as ViewStyle,

  unreadBadgeText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 11,
  } as TextStyle,

  unreadBadgeGhost: {
    width: 22,
    height: 22,
  } as ViewStyle,

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginLeft: 64,
  } as ViewStyle,

  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingTop: 72,
  } as ViewStyle,

  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  emptyTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 16,
    textAlign: "center",
  } as TextStyle,

  emptySub: {
    marginTop: 8,
    color: "rgba(255,255,255,0.58)",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  } as TextStyle,
});
