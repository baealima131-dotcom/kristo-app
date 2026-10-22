import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LabPeople, LabProposalStatus, LabRole, LabTaskStatus } from "@/src/lib/uvumbuziLabApi";

export const UV = {
  bg: "#061418",
  teal: "#2DD4BF",
  tealSoft: "rgba(45,212,191,0.16)",
  amber: "#FBBF24",
  amberSoft: "rgba(251,191,36,0.16)",
  red: "#F87171",
  redSoft: "rgba(248,113,113,0.16)",
  card: "rgba(255,255,255,0.05)",
  border: "rgba(255,255,255,0.09)",
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.62)",
  faint: "rgba(255,255,255,0.4)",
};

export function UvScreen({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.screen}>
      <LinearGradient colors={["rgba(45,212,191,0.12)", "rgba(6,20,24,0.98)", UV.bg]} style={StyleSheet.absoluteFillObject} />
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={UV.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Chip({ label, tone = "teal" }: { label: string; tone?: "teal" | "amber" | "red" | "grey" }) {
  const bg = tone === "teal" ? UV.tealSoft : tone === "amber" ? UV.amberSoft : tone === "red" ? UV.redSoft : "rgba(255,255,255,0.08)";
  const fg = tone === "teal" ? UV.teal : tone === "amber" ? UV.amber : tone === "red" ? UV.red : UV.muted;
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export const ROLE_LABEL: Record<LabRole, string> = { owner: "Owner", leader: "Leader", member: "Member" };

export function TaskStatusChip({ status }: { status: LabTaskStatus }) {
  if (status === "approved") return <Chip label="Approved" tone="teal" />;
  if (status === "submitted") return <Chip label="Awaiting review" tone="amber" />;
  if (status === "changes_requested") return <Chip label="Correction requested" tone="red" />;
  return <Chip label="To do" tone="grey" />;
}

export function ProposalStatusChip({ status }: { status: LabProposalStatus }) {
  if (status === "approved") return <Chip label="Approved" tone="teal" />;
  if (status === "rejected") return <Chip label="Rejected" tone="red" />;
  if (status === "withdrawn") return <Chip label="Withdrawn" tone="grey" />;
  return <Chip label="Pending" tone="amber" />;
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={UV.faint} style={[s.input, rest.multiline ? s.inputMulti : null, style]} {...rest} />
    </View>
  );
}

export function Button({ label, onPress, kind = "primary", busy, disabled, icon }: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "ghost" | "danger";
  busy?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const off = disabled || busy;
  const color = kind === "primary" ? UV.bg : kind === "danger" ? UV.red : UV.teal;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[s.btn, kind === "primary" ? s.btnPrimary : kind === "danger" ? s.btnDanger : s.btnGhost, off ? { opacity: 0.5 } : null]}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Ionicons name={icon} size={16} color={color} /> : null}
      <Text style={[s.btnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function Notice({ icon, title, text, action }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string; action?: React.ReactNode }) {
  return (
    <Card style={{ alignItems: "center", gap: 10, paddingVertical: 28 }}>
      <Ionicons name={icon} size={30} color={UV.teal} />
      <Text style={s.noticeTitle}>{title}</Text>
      <Text style={s.noticeText}>{text}</Text>
      {action}
    </Card>
  );
}

export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View style={s.errorRow} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" size={16} color={UV.red} />
      <Text style={s.errorText}>{text}</Text>
    </View>
  );
}

/** "You" for the viewer, otherwise the person's public Kristo ID; a short internal id only as a fallback. */
export function who(subject: string, me: string, people?: LabPeople): string {
  if (subject === me) return "You";
  const kristoId = people?.[subject]?.kristoId;
  if (kristoId) return kristoId;
  return subject.length > 14 ? `${subject.slice(0, 6)}…${subject.slice(-4)}` : subject;
}

/** Public Kristo ID format, e.g. KR7-12345AB (same rule the Kristo server enforces). */
export const KRISTO_ID_PATTERN = /^KR[0-9A-Z]?-[0-9A-Z]{3,20}$/i;

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: UV.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: "rgba(255,255,255,0.06)" },
  title: { color: UV.text, fontSize: 20, fontWeight: "800" },
  subtitle: { color: UV.muted, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: UV.card, borderColor: UV.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  chip: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 12, fontWeight: "700" },
  label: { color: UV.muted, fontSize: 13, fontWeight: "600" },
  input: { color: UV.text, fontSize: 15, borderColor: UV.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "rgba(0,0,0,0.25)" },
  inputMulti: { minHeight: 84, textAlignVertical: "top" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: UV.teal },
  btnGhost: { backgroundColor: UV.tealSoft },
  btnDanger: { backgroundColor: UV.redSoft },
  btnText: { fontSize: 14, fontWeight: "800" },
  noticeTitle: { color: UV.text, fontSize: 17, fontWeight: "800", textAlign: "center" },
  noticeText: { color: UV.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { color: UV.red, fontSize: 13, flex: 1 },
  h2: { color: UV.text, fontSize: 16, fontWeight: "800" },
  body: { color: UV.text, fontSize: 14, lineHeight: 20 },
  meta: { color: UV.faint, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
