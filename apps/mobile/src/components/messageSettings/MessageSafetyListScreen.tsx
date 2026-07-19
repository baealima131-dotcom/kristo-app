import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  MS_BG,
  MS_BORDER,
  MS_CARD,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

export type SafetyListKind = "blocked" | "muted" | "hidden";

type SafetyRow = {
  roomId: string;
  churchId: string;
  peerUserId: string;
  title: string;
  avatarUri: string;
  kind: SafetyListKind;
};

const TITLES: Record<SafetyListKind, string> = {
  blocked: "Blocked users",
  muted: "Muted conversations",
  hidden: "Hidden conversations",
};

const EMPTY: Record<SafetyListKind, string> = {
  blocked: "You have not blocked anyone in Messages.",
  muted: "No muted conversations.",
  hidden: "No hidden conversations.",
};

export function MessageSafetyListScreen({ kind }: { kind: SafetyListKind }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [rows, setRows] = useState<SafetyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res: any = await apiGet(
        `/api/church/direct-messages?action=safety_lists&kind=${encodeURIComponent(kind)}`,
        { headers: getKristoHeaders() }
      );
      if (!res?.ok) {
        throw new Error(String(res?.error || "Could not load list."));
      }
      const data = Array.isArray(res?.data) ? res.data : [];
      setRows(
        data.map((row: any) => ({
          roomId: String(row?.roomId || ""),
          churchId: String(row?.churchId || ""),
          peerUserId: String(row?.peerUserId || ""),
          title: String(row?.title || "Member"),
          avatarUri: String(row?.avatarUri || ""),
          kind,
        }))
      );
    } catch (e: any) {
      setRows([]);
      setError(String(e?.message || "Could not load list."));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={s.backBtn}
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={20} color={MS_TEXT} />
        </Pressable>
        <Text style={s.title}>{TITLES[kind]}</Text>
        <View style={s.backBtnGhost} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={MS_GOLD} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={s.error}>{error}</Text>
          <Pressable onPress={() => void load()} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.roomId || item.peerUserId}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: insets.bottom + 24,
            flexGrow: 1,
          }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>{EMPTY[kind]}</Text>
            </View>
          }
          renderItem={({ item }) => {
            const initial =
              String(item.title || "?").trim().charAt(0).toUpperCase() || "?";
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open conversation with ${item.title}`}
                onPress={() => {
                  if (!item.roomId) return;
                  router.push({
                    pathname: "/(tabs)/profile/messages/[id]",
                    params: {
                      id: item.roomId,
                      title: item.title,
                      avatar: item.avatarUri,
                      roomKind: "direct",
                      peerUserId: item.peerUserId,
                      churchId: item.churchId,
                    },
                  } as any);
                }}
                style={({ pressed }) => [
                  s.row,
                  pressed ? s.rowPressed : null,
                ]}
              >
                <View style={s.avatar}>
                  {item.avatarUri ? (
                    <Image source={{ uri: item.avatarUri }} style={s.avatarImage} />
                  ) : (
                    <Text style={s.avatarText}>{initial}</Text>
                  )}
                </View>
                <View style={s.copy}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={s.rowSub} numberOfLines={1}>
                    {kind === "blocked"
                      ? "Blocked"
                      : kind === "muted"
                        ? "Muted"
                        : "Hidden from inbox"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={MS_SUB} />
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: MS_BG,
  },
  header: {
    paddingHorizontal: 14,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MS_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MS_BORDER,
  },
  backBtnGhost: {
    width: 40,
    height: 40,
  },
  title: {
    flex: 1,
    textAlign: "center",
    color: MS_TEXT,
    fontSize: 17,
    fontWeight: "750" as any,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  error: {
    color: MS_TEXT,
    textAlign: "center",
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: {
    color: MS_GOLD,
    fontWeight: "700",
  },
  empty: {
    paddingTop: 80,
    alignItems: "center",
  },
  emptyText: {
    color: MS_SUB,
    fontSize: 13,
    textAlign: "center",
  },
  row: {
    minHeight: 64,
    borderRadius: 14,
    backgroundColor: MS_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MS_BORDER,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowPressed: {
    opacity: 0.9,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(217,179,95,0.14)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 42,
    height: 42,
  },
  avatarText: {
    color: MS_GOLD,
    fontWeight: "800",
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: MS_TEXT,
    fontSize: 15,
    fontWeight: "700",
  },
  rowSub: {
    color: MS_SUB,
    fontSize: 12,
  },
});
