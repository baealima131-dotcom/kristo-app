import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BackgroundScene,
  GlassSurface,
  OfflineActivationHeroHeader,
} from "@/src/components/offlineActivationAdminDashboardUi";
import {
  OFFLINE_ADMIN_BG as BG,
  OFFLINE_ADMIN_MUTED as MUTED,
  OFFLINE_ADMIN_TEXT as TEXT,
} from "@/src/lib/offlineActivationAdminTheme";
import type { OnboardingStatus } from "@/src/lib/offlineActivationProgramApi";
import {
  ONBOARDING_STATUS_COLOR,
  ONBOARDING_STATUS_LABEL,
} from "@/src/lib/offlineActivationProgramLabels";

export const PROGRAM_GOLD = "#F4D06F";
export { MUTED as PROGRAM_MUTED, TEXT as PROGRAM_TEXT };

export function ProgramScreen({
  title,
  subtitle,
  icon,
  loading,
  error,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof OfflineActivationHeroHeader>["badgeIcon"];
  loading: boolean;
  error?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: BG }]}>
      <BackgroundScene />
      <OfflineActivationHeroHeader
        title={title}
        subtitle={subtitle}
        badgeIcon={icon}
        onBack={() => router.back()}
        topInset={insets.top}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={PROGRAM_GOLD} />
          ) : undefined
        }
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={PROGRAM_GOLD} />
          </View>
        ) : error ? (
          <GlassSurface style={styles.card}>
            <Text style={styles.error}>{error}</Text>
          </GlassSurface>
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

export function ProgramCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <GlassSurface style={styles.card}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </GlassSurface>
  );
}

export function StatusPill({ status }: { status: OnboardingStatus }) {
  const color = ONBOARDING_STATUS_COLOR[status];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{ONBOARDING_STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function MetaRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{String(value)}</Text>
    </View>
  );
}

export function ProgramField({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.metaLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(255,255,255,0.35)"
        autoCorrect={false}
        {...input}
        style={[styles.input, input.multiline && styles.inputMulti, input.style]}
      />
    </View>
  );
}

export function ChoiceRow<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <View style={styles.choices}>
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="radio"
          accessibilityState={{ selected: option === value }}
          onPress={() => onChange(option)}
          style={[styles.choice, option === value && styles.choiceOn]}
        >
          <Text style={[styles.choiceText, option === value && styles.choiceTextOn]}>{labels[option]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function LinkRow({ label, sub, onPress }: { label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.linkLabel}>{label}</Text>
        {sub ? <Text style={styles.linkSub}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={MUTED} />
    </Pressable>
  );
}

export const programStyles = StyleSheet.create({
  helper: { color: MUTED, fontSize: 13, lineHeight: 19 },
  strong: { color: TEXT, fontSize: 15, fontWeight: "700" },
  code: { color: PROGRAM_GOLD, fontSize: 26, fontWeight: "800", letterSpacing: 2, textAlign: "center" },
  row: { flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
  center: { paddingVertical: 48, alignItems: "center" },
  card: { padding: 14, gap: 12 },
  cardTitle: { color: TEXT, fontSize: 16, fontWeight: "800" },
  error: { color: "#FF8A80", fontSize: 14, lineHeight: 20 },
  pill: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 12, fontWeight: "700" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  metaLabel: { color: MUTED, fontSize: 13 },
  metaValue: { color: TEXT, fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  field: { gap: 6 },
  input: {
    color: TEXT,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  inputMulti: { minHeight: 84, textAlignVertical: "top" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  choiceOn: { borderColor: PROGRAM_GOLD, backgroundColor: "rgba(244,208,111,0.12)" },
  choiceText: { color: MUTED, fontSize: 13, fontWeight: "600" },
  choiceTextOn: { color: PROGRAM_GOLD },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  linkLabel: { color: TEXT, fontSize: 15, fontWeight: "700" },
  linkSub: { color: MUTED, fontSize: 12, marginTop: 2 },
});
