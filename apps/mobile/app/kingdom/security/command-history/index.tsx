import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  DEFAULT_SECURITY_LOGS,
  getSecurityLogs,
  type AuditLogEntry,
} from "@/src/lib/kingdomSecurityStore";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.05)";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";
const GOLD = "#D9B35F";

function formatLogTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function isCommandLog(item: AuditLogEntry) {
  const action = String(item.action || "").toLowerCase();
  const target = String(item.targetType || "").toLowerCase();
  const msg = String(item.message || "").toLowerCase();

  return (
    action.includes("command") ||
    target.includes("command") ||
    msg.includes("command")
  );
}

function buildCommandTitle(item: AuditLogEntry) {
  return item.message || item.action || "Command event";
}

export default function CommandHistoryScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AuditLogEntry[]>(DEFAULT_SECURITY_LOGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const next = await getSecurityLogs({ limit: 100 });
        if (alive) setItems(next);
      } catch {
        if (alive) setItems(DEFAULT_SECURITY_LOGS);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const commandItems = useMemo(() => {
    const filtered = items.filter(isCommandLog);

    if (filtered.length > 0) {
      return [...filtered].sort((a, b) => {
        const at = new Date(a.createdAt).getTime();
        const bt = new Date(b.createdAt).getTime();
        return bt - at;
      });
    }

    return [...DEFAULT_SECURITY_LOGS].sort((a, b) => {
      const at = new Date(a.createdAt).getTime();
      const bt = new Date(b.createdAt).getTime();
      return bt - at;
    });
  }, [items]);

  return (
    <View style={s.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.headerWrap}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>Command History</Text>
          <Text style={s.subtitle}>All executed commands and attempts.</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.scrollContent}
      >
        {loading ? (
          <Text style={s.emptyText}>Loading command history...</Text>
        ) : commandItems.length === 0 ? (
          <Text style={s.emptyText}>No command history found.</Text>
        ) : (
          commandItems.map((item) => (
            <View key={item.id} style={s.card}>
              <View style={s.row}>
                <View style={s.icon}>
                  <Ionicons name="terminal-outline" size={18} color="#fff" />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{buildCommandTitle(item)}</Text>

                  <Text style={s.meta}>
                    {(item.actorName || item.actorUserId) +
                      (item.actorRole ? ` • ${item.actorRole}` : "")}
                  </Text>

                  {!!item.targetType ? (
                    <Text style={s.target}>
                      {item.targetType}
                      {item.targetId ? ` • ${item.targetId}` : ""}
                    </Text>
                  ) : null}

                  <Text style={s.time}>{formatLogTime(item.createdAt)}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 42,
  },

  headerWrap: {
    paddingHorizontal: 18,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },

  backBtn: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "white",
    fontSize: 26,
    fontWeight: "900",
    marginBottom: 4,
  },

  subtitle: {
    color: SOFT,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 56,
  },

  emptyText: {
    color: SOFT,
    fontSize: 15,
    fontWeight: "700",
    paddingTop: 12,
  },

  card: {
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    marginBottom: 16,
  },

  row: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
  },

  icon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#3A2D5F",
    alignItems: "center",
    justifyContent: "center",
  },

  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 24,
  },

  meta: {
    color: SOFT,
    fontSize: 14,
    marginTop: 4,
    fontWeight: "700",
  },

  target: {
    color: GOLD,
    fontSize: 12,
    marginTop: 6,
    fontWeight: "800",
  },

  time: {
    color: "rgba(255,255,255,0.56)",
    fontSize: 13,
    marginTop: 6,
    fontWeight: "600",
  },
});
