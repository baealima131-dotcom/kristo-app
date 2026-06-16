import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";
const CARD = "rgba(255,255,255,0.05)";

type ToolAction = {
  id: string;
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  route?: string;
};

type ToolMeta = {
  title: string;
  desc: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "gold" | "green" | "red" | "blue";
  actions: ToolAction[];
};

const TOOL_META: Record<string, ToolMeta> = {
  approvals: {
    title: "Access Approvals",
    desc: "Approve or deny people, requests, and gate access.",
    icon: "shield-checkmark-outline",
    tone: "green",
    actions: [
      { id: "approve_user", title: "Approve User", desc: "Kubali request mpya ya kuingia.", icon: "person-add-outline" },
      { id: "deny_user", title: "Deny User", desc: "Kataa request isiyo salama.", icon: "person-remove-outline" },
      { id: "review_roles", title: "Review Roles", desc: "Kagua role kabla ya approval.", icon: "id-card-outline" },
      { id: "priority_queue", title: "Priority Queue", desc: "Shughulikia approvals za haraka.", icon: "flash-outline" },
    ],
  },
  devices: {
    title: "Trusted Devices",
    desc: "Manage approved phones, tablets, and secure endpoints.",
    icon: "phone-portrait-outline",
    tone: "blue",
    actions: [
      { id: "revoke_device", title: "Revoke Device", desc: "Ondoa kifaa kisichoaminika.", icon: "trash-outline" },
      { id: "add_device", title: "Add Device", desc: "Sajili kifaa kipya cha kuaminika.", icon: "add-circle-outline" },
      { id: "device_scan", title: "Device Scan", desc: "Pitia hali ya devices zote.", icon: "scan-outline" },
      { id: "trust_policy", title: "Trust Policy", desc: "Weka sheria za trust level.", icon: "options-outline" },
    ],
  },
  alerts: {
    title: "Alerts Center",
    desc: "See security warnings, suspicious activity, and incidents.",
    icon: "alert-circle-outline",
    tone: "red",
    actions: [
      { id: "trigger_alert", title: "Trigger Alert", desc: "Anzisha alert ya security.", icon: "notifications-outline" },
      { id: "incident_review", title: "Incident Review", desc: "Kagua tukio la hatari.", icon: "search-outline" },
      { id: "severity_level", title: "Severity Level", desc: "Panga kiwango cha alert.", icon: "stats-chart-outline" },
      { id: "notify_team", title: "Notify Team", desc: "Tuma alert kwa security team.", icon: "people-outline" },
    ],
  },
  sessions: {
    title: "Active Sessions",
    desc: "Track who is active now and remove risky sessions fast.",
    icon: "pulse-outline",
    tone: "blue",
    actions: [
      { id: "kill_session", title: "Kill Session", desc: "Funga risky session sasa.", icon: "close-circle-outline" },
      { id: "session_map", title: "Session Map", desc: "Ona sessions zilipo active.", icon: "map-outline" },
      { id: "force_relogin", title: "Force Re-Login", desc: "Lazimisha user aingie tena.", icon: "log-in-outline" },
      { id: "token_reset", title: "Token Reset", desc: "Badilisha access token.", icon: "key-outline" },
    ],
  },
  lockdown: {
    title: "Lockdown",
    desc: "Trigger emergency restriction for sensitive rooms and flows.",
    icon: "lock-closed-outline",
    tone: "red",
    actions: [
      { id: "lockdown_now", title: "Lockdown Now", desc: "Funga access ya emergency.", icon: "lock-closed-outline" },
      { id: "freeze_approvals", title: "Freeze Approvals", desc: "Sitisha approvals zote.", icon: "pause-circle-outline" },
      { id: "restrict_entries", title: "Restrict Entries", desc: "Zuia entries mpya.", icon: "ban-outline" },
      { id: "broadcast_notice", title: "Broadcast Notice", desc: "Tuma taarifa ya lockdown.", icon: "megaphone-outline" },
    ],
  },
  logs: {
    title: "Security Logs",
    desc: "Audit movements, approvals, commands, and access history.",
    icon: "document-text-outline",
    tone: "gold",
    actions: [
      { id: "view_logs", title: "View Logs", desc: "Angalia history ya security.", icon: "document-text-outline" },
      { id: "export_logs", title: "Export Logs", desc: "Toa logs kwa report.",
      route: "/kingdom/security/export-logs", icon: "download-outline" },
      { id: "command_history", title: "Command History", desc: "Ona command zilizotumika.", route: "/kingdom/security/command-history", icon: "time-outline" },
      { id: "audit_trail", title: "Audit Trail", desc: "Pitia mnyororo wa actions.",
      route: "/kingdom/security/audit-trail", icon: "trail-sign-outline" },
    ],
  },
};

export default function SecurityToolScreen() {
  const router = useRouter();
  const { tool } = useLocalSearchParams<{ tool?: string }>();

  const meta = useMemo(() => {
    const key = String(tool || "");
    return (
      TOOL_META[key] || {
        title: "Security Tool",
        desc: "Security control detail page.",
        icon: "shield-outline" as keyof typeof Ionicons.glyphMap,
        tone: "gold" as const,
        actions: [
          { id: "view_logs", title: "View Logs", desc: "Open security detail flow.", icon: "open-outline" },
        ],
      }
    );
  }, [tool]);

  function openAction(actionId: string, title: string, route?: string) {
    if (route) {
      router.push(route as any);
      return;
    }
    router.push(`/kingdom/security/action/${actionId}` as any);
  }

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>{meta.title}</Text>
          <Text style={s.sub}>Security tool • inner actions</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View
          style={[
            s.heroCard,
            meta.tone === "gold" ? s.heroGold : null,
            meta.tone === "green" ? s.heroGreen : null,
            meta.tone === "red" ? s.heroRed : null,
            meta.tone === "blue" ? s.heroBlue : null,
          ]}
        >
          <View style={s.heroTop}>
            <View style={s.heroIconWrap}>
              <Ionicons name={meta.icon} size={28} color="white" />
            </View>

            <View style={s.heroBadge}>
              <Text style={s.heroBadgeText}>SECURITY</Text>
            </View>
          </View>

          <Text style={s.heroTitle}>{meta.title}</Text>
          <Text style={s.heroDesc}>{meta.desc}</Text>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Actions</Text>

          <View style={s.grid}>
            {meta.actions.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => openAction(item.id, item.title, item.route)}
                style={({ pressed }) => [
                  s.card,
                  pressed ? { opacity: 0.94, transform: [{ scale: 0.992 }] } : null,
                ]}
              >
                <View style={s.iconWrap}>
                  <Ionicons name={item.icon} size={22} color="rgba(230,220,255,0.92)" />
                </View>

                <Text style={s.cardTitle} numberOfLines={2}>
                  {item.title}
                </Text>

                <Text style={s.cardDesc} numberOfLines={4}>
                  {item.desc}
                </Text>
              </Pressable>
            ))}
          </View>
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

  heroCard: {
    borderRadius: 28,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  heroGold: {
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.07)",
  },

  heroGreen: {
    borderColor: "rgba(104,227,170,0.34)",
    backgroundColor: "rgba(104,227,170,0.08)",
  },

  heroRed: {
    borderColor: "rgba(255,107,107,0.34)",
    backgroundColor: "rgba(255,107,107,0.08)",
  },

  heroBlue: {
    borderColor: "rgba(90,150,255,0.34)",
    backgroundColor: "rgba(90,150,255,0.08)",
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
    borderColor: "rgba(255,255,255,0.10)",
  },

  heroBadgeText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  heroTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
  },

  heroDesc: {
    color: SOFT,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
  },

  sectionCard: {
    borderRadius: 30,
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
});
