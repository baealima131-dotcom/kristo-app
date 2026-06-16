import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";
const CARD = "rgba(255,255,255,0.05)";
const COMMAND_STORAGE_KEY = "kristo.kingdom.command-sequence.v1";

type SecurityTool = {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "gold" | "green" | "red" | "blue";
};

const TOOLS: SecurityTool[] = [
  {
    id: "approvals",
    title: "Access Approvals",
    desc: "Approve or deny people, requests, and gate access.",
    icon: "shield-checkmark-outline",
    tone: "green",
  },
  {
    id: "devices",
    title: "Trusted Devices",
    desc: "Manage approved phones, tablets, and secure endpoints.",
    icon: "phone-portrait-outline",
    tone: "blue",
  },
  {
    id: "alerts",
    title: "Alerts Center",
    desc: "See security warnings, suspicious activity, and incidents.",
    icon: "alert-circle-outline",
    tone: "red",
  },
  {
    id: "sessions",
    title: "Active Sessions",
    desc: "Track who is active now and remove risky sessions fast.",
    icon: "pulse-outline",
    tone: "blue",
  },
  {
    id: "lockdown",
    title: "Lockdown",
    desc: "Trigger emergency restriction for sensitive rooms and flows.",
    icon: "lock-closed-outline",
    tone: "red",
  },
  {
    id: "logs",
    title: "Security Logs",
    desc: "Audit movements, approvals, commands, and access history.",
    icon: "document-text-outline",
    tone: "gold",
  },
];

export default function SecurityCommandsScreen() {
  const router = useRouter();
  const [activeCommands, setActiveCommands] = useState<string[]>([]);
  const [loadingCommands, setLoadingCommands] = useState(true);
  const [gateLocked, setGateLocked] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadCommandState() {
      try {
        const raw = await AsyncStorage.getItem(COMMAND_STORAGE_KEY);
        if (!raw) {
          if (alive) {
            setActiveCommands([]);
            setLoadingCommands(false);
          }
          return;
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          if (alive) {
            setActiveCommands([]);
            setLoadingCommands(false);
          }
          return;
        }

        const active = parsed
          .filter((item: any) => item && item.locked === false)
          .map((item: any) => String(item.value || "").trim().toUpperCase())
          .filter(Boolean);

        if (alive) setActiveCommands(active);
      } catch {
        if (alive) setActiveCommands([]);
      } finally {
        if (alive) setLoadingCommands(false);
      }
    }

    loadCommandState();

    return () => {
      alive = false;
    };
  }, []);

  const commandSummary = useMemo(() => {
    if (loadingCommands) return "Loading active gate keys...";
    if (!activeCommands.length) return "No active gate keys yet.";
    return `Active gate keys: ${activeCommands.join(" • ")}`;
  }, [activeCommands, loadingCommands]);

  function openTool(tool: SecurityTool) {
    router.push(`/kingdom/security/${tool.id}` as any);
  }

  function toggleGateLock() {
    setGateLocked((prev) => {
      const next = !prev;
      setTimeout(() => {
        Alert.alert(
          next ? "Gate locked" : "Gate unlocked",
          next
            ? "KINGDOM gate is now locked for tighter protection."
            : "KINGDOM gate is now open for normal access."
        );
      }, 80);
      return next;
    });
  }

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>Gate Control</Text>
          <Text style={s.sub}>Security center • approvals • trust • lockdown</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Security Center</Text>

          <View style={s.heroCard}>
            <View style={s.heroTop}>
              <View style={s.heroIconWrap}>
                <Ionicons name="shield-half-outline" size={28} color="white" />
              </View>

              <View style={s.heroBadge}>
                <Text style={s.heroBadgeText}>KINGDOM</Text>
              </View>
            </View>

            <Text style={s.heroTitle}>Central Gate Protection</Text>
            <Text style={s.heroDesc}>
              Linda kingdom kupitia approvals, devices, alerts, sessions, lockdown, na security logs.
            </Text>

            <View style={s.gateStatusRow}>
              <View style={[s.gatePill, gateLocked ? s.gatePillLocked : s.gatePillOpen]}>
                <Ionicons
                  name={gateLocked ? "lock-closed-outline" : "lock-open-outline"}
                  size={16}
                  color="white"
                />
                <Text style={s.gatePillText}>
                  {gateLocked ? "Gate Locked" : "Gate Open"}
                </Text>
              </View>

              <Pressable
                onPress={toggleGateLock}
                style={({ pressed }) => [s.gateActionBtn, pressed ? { opacity: 0.92 } : null]}
              >
                <Text style={s.gateActionBtnText}>
                  {gateLocked ? "Unlock" : "Lock"}
                </Text>
              </Pressable>
            </View>

            <View style={s.commandStateRow}>
              <View style={s.commandStateBadge}>
                <Text style={s.commandStateBadgeText}>
                  {loadingCommands ? "..." : activeCommands.length}
                </Text>
              </View>

              <Text style={s.commandStateText}>
                {commandSummary}
              </Text>
            </View>

          </View>

          <View style={s.grid}>
            {TOOLS.map((tool) => (
              <Pressable
                key={tool.id}
                onPress={() => openTool(tool)}
                style={({ pressed }) => [
                  s.card,
                  tool.tone === "gold" ? s.cardGold : null,
                  tool.tone === "green" ? s.cardGreen : null,
                  tool.tone === "red" ? s.cardRed : null,
                  tool.tone === "blue" ? s.cardBlue : null,
                  pressed ? { opacity: 0.94, transform: [{ scale: 0.992 }] } : null,
                ]}
              >
                <View style={s.iconWrap}>
                  <Ionicons name={tool.icon} size={22} color="rgba(230,220,255,0.92)" />
                </View>

                <Text style={s.cardTitle} numberOfLines={2}>
                  {tool.title}
                </Text>

                <Text style={s.cardDesc} numberOfLines={4}>
                  {tool.desc}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => router.push("/kingdom/security-command-sequence" as any)}
            style={({ pressed }) => [s.commandBtn, pressed ? { opacity: 0.94 } : null]}
          >
            <Text style={s.commandBtnText}>
              {loadingCommands
                ? "Open KINGDOM Commands"
                : `Open KINGDOM Commands${activeCommands.length ? ` (${activeCommands.length} active)` : ""}`}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingTop: 54,
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
  },

  backBtn: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
  },

  sub: {
    marginTop: 4,
    color: SOFT,
    fontSize: 13,
    fontWeight: "800",
  },

  sectionCard: {
    borderRadius: 34,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  sectionTitle: {
    color: GOLD,
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 18,
  },

  heroCard: {
    borderRadius: 28,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.07)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },

  heroIconWrap: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(97,64,190,0.28)",
    borderWidth: 1,
    borderColor: "rgba(124,92,255,0.50)",
  },

  heroBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },

  heroBadgeText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  heroTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
  },

  heroDesc: {
    color: SOFT,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },

  commandStateRow__old: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  commandStateBadge__old: {
    minWidth: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },

  commandStateBadgeText__old: {
    color: GOLD,
    fontSize: 18,
    fontWeight: "900",
  },

  commandStateText__old: {
    flex: 1,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },

  commandStateRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  commandStateBadge: {
    minWidth: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },

  commandStateBadgeText: {
    color: GOLD,
    fontSize: 18,
    fontWeight: "900",
  },

  commandStateText: {
    flex: 1,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  card: {
    width: "47%",
    minHeight: 170,
    borderRadius: 28,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },

  cardGold: {
    borderColor: "rgba(217,179,95,0.30)",
  },

  cardGreen: {
    borderColor: "rgba(104,227,170,0.30)",
  },

  cardRed: {
    borderColor: "rgba(255,107,107,0.26)",
  },

  cardBlue: {
    borderColor: "rgba(90,150,255,0.24)",
  },

  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(97,64,190,0.28)",
    borderWidth: 1,
    borderColor: "rgba(124,92,255,0.50)",
    marginBottom: 14,
  },

  cardTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 8,
  },

  cardDesc: {
    color: SOFT,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },

  gateStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 14,
    marginBottom: 12,
  },

  gatePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },

  gatePillOpen: {
    backgroundColor: "rgba(40,167,69,0.16)",
    borderColor: "rgba(40,167,69,0.38)",
  },

  gatePillLocked: {
    backgroundColor: "rgba(220,53,69,0.16)",
    borderColor: "rgba(220,53,69,0.38)",
  },

  gatePillText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },

  gateActionBtn: {
    minWidth: 108,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  gateActionBtnText: {
    color: "white",
    fontSize: 13,
    fontWeight: "900",
  },

  commandBtn: {
    marginTop: 18,
    minHeight: 76,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    paddingHorizontal: 18,
  },

  commandBtnText: {
    color: "#08111F",
    fontSize: 17,
    fontWeight: "900",
  },
});
