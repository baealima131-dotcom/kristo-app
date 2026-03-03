import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { vipAvatarBg, vipInitials } from "@/src/ui/vipUtil";

type Member = {
  userId: string;
  role?: string;
  displayName?: string;
  email?: string;
};

const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,1)";

function dedupeByUserId<T extends { userId: string }>(arr: T[]) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr || []) {
    if (!x?.userId) continue;
    if (seen.has(x.userId)) continue;
    seen.add(x.userId);
    out.push(x);
  }
  return out;
}

export function MembersListPanel({
  ministryId,
  visible,
  onClose,
  onOpenMember,
}: {
  ministryId: string;
  visible: boolean;
  onClose: () => void;
  onOpenMember: (userId: string) => void;
}) {
  const [items, setItems] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      // NOTE: endpoint inaweza kuwa tofauti kwako; hii inafuata pattern ya web store yako
      const r = await apiGet(`/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}&all=1`, {
        headers: getKristoHeaders(),
      });
      const data = (r as any)?.data ?? (r as any);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      setItems(dedupeByUserId(arr));
    } catch (e: any) {
      setErr(e?.message || "Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (visible) load();
     
  }, [visible, ministryId]);

  const count = useMemo(() => items?.length ?? 0, [items]);

  if (!visible) return null;

  return (
    <View style={s.panel}>
      <View style={s.panelTop}>
        <Pressable onPress={onClose} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="close" size={18} color="rgba(255,255,255,0.9)" />
        </Pressable>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.panelTitle} numberOfLines={1}>Members</Text>
          <Text style={s.panelSub} numberOfLines={1}>{`${count} members`}</Text>
        </View>

        <Pressable onPress={load} style={({ pressed }) => [s.iconBtn, pressed && { opacity: 0.85 }]}>
          <Ionicons name="refresh" size={18} color="rgba(255,255,255,0.9)" />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.centerText}>Loading members...</Text>
        </View>
      ) : err ? (
        <View style={s.center}>
          <Text style={[s.centerText, { color: "rgba(255,120,120,0.95)" }]}>{err}</Text>
          <Pressable onPress={load} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.userId}
          contentContainerStyle={{ padding: 14, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="people" size={22} color="rgba(255,255,255,0.55)" />
              <Text style={s.emptyTitle}>No members</Text>
              <Text style={s.emptySub}>Use ADD to include someone.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => onOpenMember(item.userId)}
              style={({ pressed }) => [s.card, pressed && { opacity: 0.96, transform: [{ scale: 0.995 }] }]}
            >
              <View style={s.row}>
                <View style={[s.avatar, { backgroundColor: vipAvatarBg(item.userId) }]}>
                  <Text style={s.avatarText}>{vipInitials(item.displayName || item.userId)}</Text>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={1}>{item.displayName || "Member"}</Text>
                  <Text style={s.sub} numberOfLines={1}>{`User: ${item.userId}`}</Text>
                </View>

                <View style={[s.badge, item.role === "Leader" ? s.badgeLeader : null]}>
                  <Text style={s.badgeText}>{item.role || "Member"}</Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
              </View>
            </Pressable>
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
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    borderRightWidth: 1,
    borderRightColor: "rgba(217,179,95,0.18)",
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

  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 18 },
  centerText: { marginTop: 10, color: "rgba(255,255,255,0.70)", fontWeight: "750" },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  retryText: { color: "white", fontWeight: "850" },

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

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
  },
  badgeLeader: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.40)",
  },
  badgeText: { color: "rgba(255,255,255,0.82)", fontWeight: "850", fontSize: 11 },
});
