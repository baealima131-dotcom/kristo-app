import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { vipAvatarBg, vipInitials } from "@/src/ui/vipUtil";
type User = {
  userId: string;
  displayName?: string;
  email?: string;
};
const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,1)";
export function AddMemberPanel({
  ministryId,
  visible,
  onClose,
  onAdded,
}: {
  ministryId: string;
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function loadPeople() {
    setErr(null);
    setLoading(true);
    try {
      // NOTE: endpoint inaweza kuwa tofauti; hii ni safe pattern.
      const r = await apiGet(`/api/church/members?all=1`, { headers: getKristoHeaders() });
      const data = (r as any)?.data ?? (r as any);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setAll(arr);
    } catch (e: any) {
      setErr(e?.message || "Failed to load church members");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (visible) loadPeople();
  }, [visible]);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return all.slice(0, 50);
    return all.filter((u) => {
      return (
        (u.userId || "").toLowerCase().includes(s) ||
        (u.displayName || "").toLowerCase().includes(s) ||
        (u.email || "").toLowerCase().includes(s)
      );
    });
  }, [q, all]);
  async function add(userId: string) {
    setAddingId(userId);
    setErr(null);
    try {
      // NOTE: adjust payload if backend differs
      await apiPost(`/api/church/ministry-members`, {
        ministryId,
        userId,
        role: "Member",
      }, { headers: getKristoHeaders() });
      // auto close + refresh
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Add failed");
    } finally {
      setAddingId(null);
    }
  }
  if (!visible) return null;
  return (
    <View style={s.panel}>
      <View style={s.panelTop}>
        <Pressable onPress={onClose} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.9)" />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.panelTitle} numberOfLines={1}>Add Member</Text>
          <Text style={s.panelSub} numberOfLines={1}>{`${results?.length ?? 0} results`}</Text>
        </View>
        <Pressable onPress={loadPeople} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="refresh" size={18} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </View>
      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color="rgba(255,255,255,0.55)" />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search name / email / id"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.searchInput}
          autoCapitalize="none"
        />
      </View>
      {err ? (
        <View style={s.center}>
          <Text style={[s.centerText, { color: "rgba(255,120,120,0.95)" }]}>{err}</Text>
        </View>
      ) : loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading people...</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(x) => x.userId}
          contentContainerStyle={{ padding: 14, paddingBottom: 90 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="person-add" size={22} color="rgba(255,255,255,0.55)" />
              <Text style={s.emptyTitle}>No matches</Text>
              <Text style={s.emptySub}>Try a different search.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.row}>
                <View style={[s.avatar, { backgroundColor: vipAvatarBg(item.userId) }]}>
                  <Text style={s.avatarText}>{vipInitials(item.displayName || item.userId)}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={1}>{item.displayName || "Member"}</Text>
                  <Text style={s.sub} numberOfLines={1}>{item.email ? item.email : `User: ${item.userId}`}</Text>
                </View>
                <Pressable
                  onPress={() => add(item.userId)}
                  disabled={addingId === item.userId}
                  style={({ pressed }) => [
                    s.addBtn,
                    addingId === item.userId && { opacity: 0.6 },
                    pressed && addingId !== item.userId && { opacity: 0.92 },
                  ]}
                >
                  {addingId === item.userId ? (
                    <ActivityIndicator />
                  ) : (
                    <>
                      <Ionicons name="add" size={16} color="#0B0F17" />
                      <Text style={s.addText}>Add</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
const s = StyleSheet.create<any>({
  panel: {
    flex: 1,
    backgroundColor: VIP_BG,
    borderTopLeftRadius: 22,
    borderBottomLeftRadius: 22,
    borderLeftWidth: 1,
    borderLeftColor: "rgba(217,179,95,0.18)",
  },
  panelTop: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  panelTitle: { color: "white", fontWeight: "950", fontSize: 18 },
  panelSub: { marginTop: 2, color: "rgba(255,255,255,0.62)", fontWeight: "750", fontSize: 12 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  searchWrap: {
    marginTop: 12,
    marginHorizontal: 14,
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.028)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, color: "white", fontWeight: "750" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  centerText: { marginTop: 10, color: "rgba(255,255,255,0.70)", fontWeight: "750" },
  empty: { padding: 18, alignItems: "center" },
  emptyTitle: { marginTop: 8, color: "white", fontWeight: "900", fontSize: 16 },
  emptySub: { marginTop: 6, color: "rgba(255,255,255,0.62)", fontWeight: "750", textAlign: "center" },
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.028)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  avatarText: { color: "white", fontWeight: "950" },
  title: { color: "white", fontWeight: "950", fontSize: 16 },
  sub: { marginTop: 4, color: "rgba(255,255,255,0.62)", fontWeight: "750", fontSize: 12 },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  },
  addText: { color: "#0B0F17", fontWeight: "950" },
});
