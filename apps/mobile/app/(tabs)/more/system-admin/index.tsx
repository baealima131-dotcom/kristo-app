import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";
import {
  hasOfflineActivationRole,
  logOfflineCodesRouteOpened,
} from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";

const ACCENT = "#9C76FF";
const BG = "#070C14";
const CARD = "rgba(16,20,29,0.92)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.72)";

type SectionLink = {
  key: string;
  title: string;
  subtitle: string;
  href?: string;
  disabled?: boolean;
};

const SECTIONS: SectionLink[] = [
  {
    key: "subscription_codes",
    title: "Subscription Activation Codes",
    subtitle: "Generate batches and view platform codes.",
    href: "/more/system-admin/subscription-codes",
  },
  {
    key: "supervisors",
    title: "Supervisors",
    subtitle: "Coming soon in this workspace.",
    disabled: true,
  },
  {
    key: "agents",
    title: "Agents",
    subtitle: "Coming soon in this workspace.",
    disabled: true,
  },
  {
    key: "activity",
    title: "Code Activity",
    subtitle: "Coming soon in this workspace.",
    disabled: true,
  },
];

export default function SystemAdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const userId = String(session?.userId || "").trim();
  const allowed = hasOfflineActivationRole(platformRole || "", "System_Admin");

  React.useEffect(() => {
    if (allowed) {
      logOfflineCodesRouteOpened("system-admin", platformRole || "", userId);
    }
  }, [allowed, platformRole, userId]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[`${ACCENT}22`, "rgba(7,12,20,0.98)", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>System Admin</Text>
          <Text style={styles.subtitle}>Full platform control • activation codes</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <View style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={ACCENT} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              This screen is available only for the System Admin platform role.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.heroCard}>
              <View style={[styles.heroIconWrap, { borderColor: `${ACCENT}55` }]}>
                <Ionicons name="shield-checkmark" size={22} color={ACCENT} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Platform admin workspace</Text>
                <Text style={styles.heroText}>
                  Manage offline subscription activation codes and platform distribution roles.
                </Text>
              </View>
            </View>

            {SECTIONS.map((section) => (
              <Pressable
                key={section.key}
                style={[styles.sectionCard, section.disabled && styles.sectionCardDisabled]}
                disabled={section.disabled || !section.href}
                onPress={() => {
                  if (section.href) router.push(section.href as any);
                }}
              >
                <View style={styles.sectionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionSub}>{section.subtitle}</Text>
                  </View>
                  <Ionicons
                    name={section.disabled ? "time-outline" : "chevron-forward"}
                    size={18}
                    color="rgba(255,255,255,0.45)"
                  />
                </View>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  title: { color: TEXT, fontSize: 22, fontWeight: "800" },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 2 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  heroCard: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
  },
  heroTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  heroText: { color: MUTED, fontSize: 13, lineHeight: 19, marginTop: 4 },
  sectionCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  sectionCardDisabled: { opacity: 0.72 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionTitle: { color: TEXT, fontSize: 15, fontWeight: "700" },
  sectionSub: { color: MUTED, fontSize: 12, marginTop: 3 },
  noticeCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    gap: 8,
  },
  noticeTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  noticeText: { color: MUTED, fontSize: 13, textAlign: "center", lineHeight: 19 },
});
