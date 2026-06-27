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
  type OfflineActivationRole,
  type OfflineActivationRoute,
} from "@/src/lib/offlineActivationCodes";
import { resolveSessionPlatformRole } from "@/src/lib/platformRole";

const GOLD = "#D9B35F";
const BG = "#070C14";
const CARD = "rgba(16,20,29,0.92)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "rgba(255,255,255,0.94)";
const MUTED = "rgba(255,255,255,0.72)";

type Props = {
  route: OfflineActivationRoute;
  requiredRole: OfflineActivationRole;
  title: string;
  subtitle: string;
  sections: string[];
  accent?: string;
};

export function OfflineActivationPlaceholderScreen({
  route,
  requiredRole,
  title,
  subtitle,
  sections,
  accent = GOLD,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = getSessionSync() as any;
  const platformRole = resolveSessionPlatformRole(session);
  const userId = String(session?.userId || "").trim();
  const allowed = hasOfflineActivationRole(platformRole || "", requiredRole);

  React.useEffect(() => {
    if (allowed) {
      logOfflineCodesRouteOpened(route, platformRole || "", userId);
    }
  }, [allowed, route, platformRole, userId]);

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[`${accent}22`, "rgba(7,12,20,0.98)", BG]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
          <View style={styles.noticeCard}>
            <Ionicons name="lock-closed-outline" size={22} color={GOLD} />
            <Text style={styles.noticeTitle}>Access restricted</Text>
            <Text style={styles.noticeText}>
              This screen is available only for the {requiredRole.replace("_", " ")} role.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.heroCard}>
              <View style={[styles.heroIconWrap, { borderColor: `${accent}55` }]}>
                <Ionicons name="key-outline" size={22} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Offline activation codes (V1)</Text>
                <Text style={styles.heroText}>
                  Placeholder workspace for activation-code distribution. Backend wiring comes
                  next.
                </Text>
              </View>
            </View>

            {sections.map((section) => (
              <Pressable key={section} style={styles.sectionCard} disabled>
                <View style={styles.sectionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sectionTitle}>{section}</Text>
                    <Text style={styles.sectionSub}>Coming soon in this workspace.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.45)" />
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
