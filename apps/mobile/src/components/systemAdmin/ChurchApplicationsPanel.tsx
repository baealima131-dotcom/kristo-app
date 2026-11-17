import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CHURCH_APPLICATION_STATUS_LABELS,
  fetchAdminChurchApplications,
  formatShortDate,
  type AdminApplication,
  type ChurchApplicationStatus,
} from "@/src/lib/churchApplicationsApi";
import { GlassCard, RC, StatusPill } from "@/src/components/systemAdmin/reportCenterTheme";

const ALL_STATUSES = Object.keys(CHURCH_APPLICATION_STATUS_LABELS) as ChurchApplicationStatus[];
const SOURCES = [
  { key: "all", label: "All" },
  { key: "direct", label: "Direct" },
  { key: "agent", label: "Agent" },
];

function statusFilterLabel(key: string) {
  if (key === "needs_review") return "Needs review";
  if (key === "all") return "All";
  return CHURCH_APPLICATION_STATUS_LABELS[key as ChurchApplicationStatus] || key;
}

/** System Admin Report Center > Churches: church applications list. */
export function ChurchApplicationsPanel({ onNeedsReviewCount }: { onNeedsReviewCount?: (count: number) => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState("needs_review");
  const [source, setSource] = useState("all");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<AdminApplication[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  // Quick filters cover the daily case; everything else is in the Filter sheet.
  const quick = ["needs_review", "all"];
  const extraFilter = !quick.includes(status) || source !== "all";

  return (
    <View>
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons name="search" size={15} color={RC.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search churches, people, codes"
            placeholderTextColor={RC.faint}
            style={s.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={RC.faint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={s.filterRow}>
        {quick.map((key) => {
          const active = status === key && source === "all";
          return (
            <Pressable
              key={key}
              onPress={() => {
                setStatus(key);
                setSource("all");
              }}
              style={[s.quick, active && s.quickActive]}
            >
              <Text style={[s.quickText, active && { color: RC.gold }]}>{statusFilterLabel(key)}</Text>
              <Text style={[s.quickCount, active && { color: RC.gold }]}>{counts[key] ?? 0}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setFiltersOpen(true)} style={[s.quick, s.filterBtn, extraFilter && s.quickActive]}>
          <Ionicons name="options-outline" size={15} color={extraFilter ? RC.gold : RC.muted} />
          <Text style={[s.quickText, extraFilter && { color: RC.gold }]} numberOfLines={1}>
            {extraFilter ? [!quick.includes(status) ? statusFilterLabel(status) : "", source !== "all" ? source === "agent" ? "Agent" : "Direct" : ""].filter(Boolean).join(" · ") : "Filter"}
          </Text>
        </Pressable>
      </View>

      {loading && !rows.length ? (
        <ActivityIndicator color={RC.gold} style={{ marginTop: 28 }} />
      ) : error ? (
        <Pressable onPress={() => void load()} style={s.empty}>
          <Text style={s.emptyTitle}>{error}</Text>
          <Text style={s.muted}>Tap to try again</Text>
        </Pressable>
      ) : !rows.length ? (
        <View style={s.empty}>
          <MaterialCommunityIcons name="church" size={24} color={RC.gold} />
          <Text style={s.emptyTitle}>{status === "needs_review" ? "Nothing to review" : "No applications"}</Text>
          <Text style={s.muted}>{status === "needs_review" ? "New applications will appear here." : "Nothing matches this filter."}</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map((app) => (
            <Pressable
              key={app.id}
              onPress={() => router.push(`/more/system-admin/report-center/church-applications/${app.id}` as any)}
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`${app.church.name}, ${app.statusLabel}`}
            >
              <GlassCard style={s.card} borderColor={app.needsReview ? "rgba(244,208,111,0.42)" : RC.line}>
                {app.needsReview ? <View style={s.accent} /> : null}
                <View style={s.cardRow}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.name} numberOfLines={1}>
                      {app.church.name}
                    </Text>
                    <View style={s.metaRow}>
                      <Text style={s.muted} numberOfLines={1}>
                        {app.church.city}
                        {app.church.country ? `, ${app.church.country}` : ""} · {formatShortDate(app.submittedAt)}
                      </Text>
                      {app.source === "agent" ? (
                        <View style={s.agentTag}>
                          <Ionicons name="id-card-outline" size={11} color={RC.purple} />
                          <Text style={s.agentTagText}>Agent</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={RC.faint} />
                </View>
                <View style={{ marginTop: 10 }}>
                  <StatusPill status={app.status} label={app.statusLabel} small />
                </View>
              </GlassCard>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={filtersOpen} transparent animationType="fade" onRequestClose={() => setFiltersOpen(false)}>
        <View style={s.modalWrap}>
          <Pressable style={s.backdrop} onPress={() => setFiltersOpen(false)} />
          <View style={[s.sheet, { paddingBottom: 18 + insets.bottom }]}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Filter applications</Text>

            <Text style={s.sheetLabel}>Status</Text>
            <View style={s.wrap}>
              {["needs_review", "all", ...ALL_STATUSES].map((key) => {
                const active = status === key;
                return (
                  <Pressable key={key} onPress={() => setStatus(key)} style={[s.option, active && s.optionActive]}>
                    <Text style={[s.optionText, active && { color: RC.gold }]}>{statusFilterLabel(key)}</Text>
                    <Text style={[s.optionCount, active && { color: RC.gold }]}>{counts[key] ?? 0}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.sheetLabel}>Source</Text>
            <View style={s.segment}>
              {SOURCES.map((x) => {
                const active = source === x.key;
                return (
                  <Pressable key={x.key} onPress={() => setSource(x.key)} style={[s.seg, active && s.segActive]}>
                    <Text style={[s.segText, active && { color: RC.gold }]}>{x.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={s.sheetBtns}>
              <Pressable
                onPress={() => {
                  setStatus("needs_review");
                  setSource("all");
                }}
                style={[s.sheetBtn, { flex: 1 }]}
              >
                <Text style={s.sheetBtnText}>Reset</Text>
              </Pressable>
              <Pressable onPress={() => setFiltersOpen(false)} style={[s.sheetBtn, s.sheetBtnPrimary, { flex: 1 }]}>
                <Text style={[s.sheetBtnText, { color: "#0B0F17" }]}>Show results</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  searchRow: { marginBottom: 10 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: RC.line,
    backgroundColor: "rgba(255,255,255,0.045)",
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: RC.text, fontSize: 14, fontWeight: "700", paddingVertical: 0 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  quick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RC.line,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  quickActive: { borderColor: "rgba(244,208,111,0.48)", backgroundColor: "rgba(244,208,111,0.13)" },
  quickText: { color: RC.muted, fontSize: 12.5, fontWeight: "900" },
  quickCount: { color: RC.faint, fontSize: 12, fontWeight: "900" },
  filterBtn: { flex: 1, justifyContent: "center", minWidth: 0 },
  card: { paddingHorizontal: 16, paddingVertical: 14 },
  accent: { position: "absolute", left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2, backgroundColor: RC.gold },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: RC.text, fontSize: 16, fontWeight: "900" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  muted: { color: RC.muted, fontSize: 12.5, fontWeight: "700", flexShrink: 1 },
  agentTag: { flexDirection: "row", alignItems: "center", gap: 3 },
  agentTagText: { color: RC.purple, fontSize: 11.5, fontWeight: "900" },
  empty: { alignItems: "center", gap: 6, paddingVertical: 34 },
  emptyTitle: { color: RC.text, fontSize: 15, fontWeight: "900", textAlign: "center" },
  modalWrap: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
    backgroundColor: "#111321",
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 12 },
  sheetTitle: { color: RC.text, fontSize: 17, fontWeight: "900", marginBottom: 6 },
  sheetLabel: { color: RC.gold, fontSize: 12, fontWeight: "900", letterSpacing: 0.6, marginTop: 14, marginBottom: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: RC.line,
  },
  optionActive: { borderColor: "rgba(244,208,111,0.48)", backgroundColor: "rgba(244,208,111,0.13)" },
  optionText: { color: RC.muted, fontSize: 12.5, fontWeight: "800" },
  optionCount: { color: RC.faint, fontSize: 11.5, fontWeight: "900" },
  segment: { flexDirection: "row", gap: 8 },
  seg: { flex: 1, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: RC.line },
  segActive: { borderColor: "rgba(244,208,111,0.48)", backgroundColor: "rgba(244,208,111,0.13)" },
  segText: { color: RC.muted, fontSize: 13, fontWeight: "900" },
  sheetBtns: { flexDirection: "row", gap: 10, marginTop: 20 },
  sheetBtn: { height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: RC.line },
  sheetBtnPrimary: { backgroundColor: RC.gold, borderColor: RC.gold },
  sheetBtnText: { color: RC.text, fontSize: 14, fontWeight: "900" },
});
