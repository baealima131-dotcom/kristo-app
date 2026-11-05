import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import {
  CHURCH_APPLICATION_STATUS_COLORS,
  CHURCH_APPLICATION_STATUS_LABELS,
  fetchAdminChurchApplications,
  formatShortDate,
  type AdminApplication,
  type ChurchApplicationStatus,
} from "@/src/lib/churchApplicationsApi";

const GOLD = "#F4D06F";
const MUTED = "rgba(255,255,255,0.62)";
const TEXT = "rgba(255,255,255,0.94)";

const STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "needs_review", label: "Needs review" },
  { key: "all", label: "All" },
  ...(Object.keys(CHURCH_APPLICATION_STATUS_LABELS) as ChurchApplicationStatus[]).map((key) => ({
    key,
    label: CHURCH_APPLICATION_STATUS_LABELS[key],
  })),
];

const SOURCE_FILTERS = [
  { key: "all", label: "All sources" },
  { key: "direct", label: "Direct" },
  { key: "agent", label: "Agent" },
];

/** System Admin Report Center > Churches: church applications list. */
export function ChurchApplicationsPanel({ onNeedsReviewCount }: { onNeedsReviewCount?: (count: number) => void }) {
  const router = useRouter();
  const [status, setStatus] = useState("needs_review");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<AdminApplication[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchAdminChurchApplications({ status, source, q: debounced });
    if (res.ok) {
      setRows(res.data.applications);
      setCounts(res.data.counts);
      setError("");
      onNeedsReviewCount?.(Number(res.data.counts.needs_review || 0));
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, [status, source, debounced, onNeedsReviewCount]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View>
      <View style={s.search}>
        <Ionicons name="search" size={16} color={MUTED} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search church, city, applicant, agent or code"
          placeholderTextColor="rgba(255,255,255,0.38)"
          style={s.searchInput}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={MUTED} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {STATUS_FILTERS.map((f) => {
          const active = status === f.key;
          const count = counts[f.key];
          return (
            <Pressable key={f.key} onPress={() => setStatus(f.key)} style={[s.chip, active && s.chipActive]}>
              <Text style={[s.chipText, active && s.chipTextActive]}>{f.label}</Text>
              {typeof count === "number" ? (
                <View style={[s.chipCount, active && s.chipCountActive]}>
                  <Text style={[s.chipCountText, active && { color: "#FFF3C4" }]}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.sourceRow}>
        {SOURCE_FILTERS.map((f) => {
          const active = source === f.key;
          return (
            <Pressable key={f.key} onPress={() => setSource(f.key)} style={[s.sourceBtn, active && s.sourceBtnActive]}>
              <Text style={[s.sourceText, active && { color: GOLD }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && !rows.length ? (
        <ActivityIndicator color={GOLD} style={{ marginTop: 30 }} />
      ) : error ? (
        <Pressable onPress={() => void load()} style={s.empty}>
          <Text style={s.emptyTitle}>{error}</Text>
          <Text style={s.muted}>Tap to try again</Text>
        </Pressable>
      ) : !rows.length ? (
        <View style={s.empty}>
          <MaterialCommunityIcons name="church" size={26} color={GOLD} />
          <Text style={s.emptyTitle}>No church applications</Text>
          <Text style={s.muted}>Nothing matches this filter.</Text>
        </View>
      ) : (
        rows.map((app) => {
          const color = CHURCH_APPLICATION_STATUS_COLORS[app.status] || GOLD;
          return (
            <Pressable
              key={app.id}
              onPress={() => router.push(`/more/system-admin/report-center/church-applications/${app.id}` as any)}
              style={({ pressed }) => [s.card, app.needsReview && s.cardReview, pressed && { opacity: 0.86 }]}
            >
              <View style={s.cardTop}>
                <View style={s.icon}>
                  <MaterialCommunityIcons name="church" size={20} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>
                    {app.church.name}
                  </Text>
                  <Text style={s.muted} numberOfLines={1}>
                    {[app.church.city, app.church.country].filter(Boolean).join(", ")}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={MUTED} />
              </View>
              <View style={s.badges}>
                <View style={[s.status, { borderColor: color, backgroundColor: `${color}1F` }]}>
                  <Text style={[s.statusText, { color }]}>{app.statusLabel}</Text>
                </View>
                <View style={[s.status, app.source === "agent" ? s.agentBadge : s.directBadge]}>
                  <Ionicons
                    name={app.source === "agent" ? "id-card-outline" : "person-outline"}
                    size={12}
                    color={app.source === "agent" ? "#C4B5FD" : "#93C5FD"}
                  />
                  <Text style={[s.statusText, { color: app.source === "agent" ? "#C4B5FD" : "#93C5FD" }]}>
                    {app.source === "agent" ? "Agent" : "Direct"}
                  </Text>
                </View>
              </View>
              <Text style={s.meta} numberOfLines={1}>
                {app.applicantName}
                {app.applicantKristoId ? ` • ${app.applicantKristoId}` : ""} • {formatShortDate(app.submittedAt)}
              </Text>
              {app.agent ? (
                <Text style={s.meta} numberOfLines={1}>
                  Agent {app.agent.agentName || app.agent.agentKristoId} • code {app.agent.agentCode}
                </Text>
              ) : null}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const s = StyleSheet.create({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.28)",
    backgroundColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  searchInput: { flex: 1, color: TEXT, fontSize: 14, fontWeight: "700", paddingVertical: 8 },
  chips: { gap: 8, paddingBottom: 10 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: { borderColor: "rgba(244,208,111,0.5)", backgroundColor: "rgba(244,208,111,0.15)" },
  chipText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  chipTextActive: { color: GOLD },
  chipCount: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5, backgroundColor: "rgba(255,255,255,0.08)" },
  chipCountActive: { backgroundColor: "rgba(244,208,111,0.22)" },
  chipCountText: { color: MUTED, fontSize: 10, fontWeight: "900" },
  sourceRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  sourceBtn: {
    flex: 1,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  sourceBtnActive: { borderColor: "rgba(244,208,111,0.5)", backgroundColor: "rgba(244,208,111,0.1)" },
  sourceText: { color: MUTED, fontSize: 12, fontWeight: "900" },
  card: {
    borderRadius: 20,
    borderWidth: 1.3,
    borderColor: "rgba(167,139,250,0.26)",
    backgroundColor: "rgba(255,255,255,0.045)",
    padding: 14,
    marginBottom: 10,
  },
  cardReview: { borderColor: "rgba(244,208,111,0.55)", boxShadow: "0 0 14px rgba(244,208,111,0.18)" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.4)",
    backgroundColor: "rgba(244,208,111,0.1)",
  },
  name: { color: TEXT, fontSize: 15.5, fontWeight: "900" },
  muted: { color: MUTED, fontSize: 12, fontWeight: "700" },
  badges: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  status: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 11.5, fontWeight: "900" },
  agentBadge: { borderColor: "rgba(196,181,253,0.5)", backgroundColor: "rgba(196,181,253,0.1)" },
  directBadge: { borderColor: "rgba(147,197,253,0.45)", backgroundColor: "rgba(147,197,253,0.08)" },
  meta: { color: MUTED, fontSize: 12, fontWeight: "700", marginTop: 6 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 30 },
  emptyTitle: { color: TEXT, fontSize: 15, fontWeight: "900", textAlign: "center" },
});
