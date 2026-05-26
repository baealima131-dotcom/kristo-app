import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMinistryById, fetchMinistryMembers, type MinistryItem } from "@/src/lib/ministriesApi";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { apiGet, apiPost, apiDelete } from "@/src/lib/kristoApi";

const VIP_BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.72)";

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  avatarUri?: string;
  mediaAccess?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export default function ChurchMinistryDetailsScreen() {


  async function loadMinistryLive(ministryId: string) {
    try {
      if (!ministryId) return;

      setLoading(true);
      setRefreshing(false);
      setErr(null);
      setLoadingLive(true);
      setLiveErr(null);

      if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
      if (!churchId) throw new Error("churchId missing");
      if (!effectiveAuthUserId) throw new Error("userId missing");

      const r = await fetch(`${base}/api/church/ministries`, {
        headers: getHeaders(),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `Fetch failed (${r.status})`));
      }

      const list = Array.isArray(j?.data) ? j.data : [];
      const one = list.find((m: any) => String(m?.id || "") === ministryId) || null;

      setMinistryLive(one);

      try {
        const membersRes = await apiGet<any>(
          `/api/church/ministry-members?ministryId=${encodeURIComponent(ministryId)}&all=1`,
          { headers: getKristoHeaders() }
        );

        if (membersRes?.ok && Array.isArray(membersRes.data)) {
          setMembersLive(membersRes.data);
        } else {
          setMembersLive([]);
        }
      } catch {
        setMembersLive([]);
      }

      if (!one) {
        setItem(null);
        throw new Error("Ministry not found.");
      }

      setItem({
        id: String((one as any)?.id || ""),
        name: String((one as any)?.name || "Ministry"),
        description: String((one as any)?.description || ""),
        status: String((one as any)?.status || "Active") as MinistryStatus,
        churchId: String((one as any)?.churchId || ""),
        mediaAccess: Boolean((one as any)?.mediaAccess),
        avatarUri: String(
          (one as any)?.avatarUri ||
          (one as any)?.profileImage ||
          (one as any)?.profilePhoto ||
          (one as any)?.photo ||
          (one as any)?.image ||
          (one as any)?.avatar ||
          ""
        ),
        createdAt: String((one as any)?.createdAt || ""),
        updatedAt: String((one as any)?.updatedAt || ""),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Failed to load ministry");
      setLiveErr(msg);
      setErr(msg);
      setItem(null);
    } finally {
      setLoadingLive(false);
      setLoading(false);
      setRefreshing(false);
    }
  }


  const [ministryLive, setMinistryLive] = useState<MinistryItem | null>(null);
  const [membersLive, setMembersLive] = useState<any[]>([]);
  const [churchMembers, setChurchMembers] = useState<any[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);


  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ministryId: string }>();

  const ministryId = useMemo(() => String(params?.ministryId || ""), [params?.ministryId]);

  function ministryInitial(name?: string) {
    return String(name || "M").trim().charAt(0).toUpperCase() || "M";
  }

  const auth = getKristoAuth();
  const churchId = String(
    auth?.churchId
  );
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

  const realAuthUserId = String(auth?.userId || "");
  const realAuthRole = String(auth?.role || "Member");
  const effectiveAuthUserId = realAuthUserId;
  const effectiveAuthRole = realAuthRole;

  const canEditMinistry =
    effectiveAuthRole === "Church_Admin" ||
    effectiveAuthRole === "Pastor" ||
    effectiveAuthRole === "Ministry_Leader";

  const getHeaders = () => ({
    accept: "application/json",
    "x-kristo-user-id": effectiveAuthUserId,
    "x-kristo-role": "Church_Admin",
    "x-kristo-church-id": churchId,
  });

  const [item, setItem] = useState<Ministry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load(opts?: { silent?: boolean }) {
    const silent = !!opts?.silent;
    if (silent) setRefreshing(true);
    else setLoading(true);

    setErr(null);

    try {
      if (!base) throw new Error("EXPO_PUBLIC_API_BASE missing");
      if (!churchId) throw new Error("churchId missing");
      if (!effectiveAuthUserId) throw new Error("userId missing");
      if (!ministryId) throw new Error("ministryId missing");

      const r = await fetch(`${base}/api/church/ministries`, {
        headers: getHeaders(),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) {
        throw new Error(String(j?.error || `Fetch failed (${r.status})`));
      }

      const list = Array.isArray(j?.data) ? j.data : [];
      const found =
        list.find((m: any) => String(m?.id || "") === ministryId) || null;

      if (!found) {
        setItem(null);
        throw new Error("Ministry not found.");
      }

      setItem({
        id: String(found.id || ""),
        name: String(found.name || "Ministry"),
        description: found.description ? String(found.description) : "",
        avatarUri: String(
          (found as any)?.avatarUri ||
          (found as any)?.profileImage ||
          (found as any)?.profilePhoto ||
          (found as any)?.photo ||
          (found as any)?.image ||
          (found as any)?.avatar ||
          ""
        ),
        status: String(found.status || "Active") as MinistryStatus,
        churchId: String(found.churchId || ""),
        mediaAccess: Boolean((found as any)?.mediaAccess),
        createdAt: String(found.createdAt || ""),
        updatedAt: found.updatedAt ? String(found.updatedAt) : "",
      });
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Error"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!ministryId) return;
    loadMinistryLive(ministryId);
  }, [ministryId]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const res = await apiGet<any>(
          "/api/church/members?all=1",
          { headers: getKristoHeaders() }
        );

        if (!alive) return;

        if (res?.ok && Array.isArray(res.data)) {
          setChurchMembers(res.data);
        }
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function addPersonToMinistry(role: "Leader" | "Member") {
    if (!canEditMinistry) {
      Alert.alert("Access denied", "Only church leadership can manage ministry members.");
      return;
    }

    const existingIds = new Set(
      membersLive.map((m: any) => String(m?.userId || m?.id || ""))
    );

    const available = churchMembers.filter(
      (m: any) => !existingIds.has(String(m?.userId || m?.id || ""))
    );

    if (!available.length) {
      Alert.alert("No available members", "All church members are already added.");
      return;
    }

    Alert.alert(
      `Add ${role}`,
      "Choose a church member",
      [
        ...available.slice(0, 8).map((m: any) => ({
          text: String(m?.name || m?.displayName || m?.email || "Member"),
          onPress: async () => {
            try {
              const uid = String(m?.userId || m?.id || "");

              const res = await apiPost(
                "/api/church/ministry-members",
                {
                  ministryId,
                  userId: uid,
                  role,
                },
                {
                  headers: getKristoHeaders(),
                }
              );

              if (!res?.ok) {
                throw new Error(res?.error || "Failed");
              }

              await loadMinistryLive(ministryId);

              Alert.alert("Success", `${role} added successfully.`);
            } catch (e: any) {
              Alert.alert("Failed", String(e?.message || e || "Error"));
            }
          }
        })),
        {
          text: "Cancel",
          style: "cancel"
        }
      ]
    );
  }


  async function removeMemberFromMinistry(mm: any) {
    if (!canEditMinistry) {
      Alert.alert("Access denied");
      return;
    }

    const mmid = String(mm?.id || "").trim();
    const displayName = String(
      mm?.displayName ||
      mm?.name ||
      mm?.email ||
      "Member"
    );

    if (!mmid) {
      Alert.alert("Missing member id");
      return;
    }

    Alert.alert(
      "Remove Member",
      `Remove ${displayName} from this ministry?`,
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await apiDelete(
                `/api/church/ministry-members?id=${encodeURIComponent(mmid)}`,
                {
                  headers: getKristoHeaders(),
                }
              );

              if (!res?.ok) {
                throw new Error(res?.error || "Remove failed");
              }

              await loadMinistryLive(ministryId);

              Alert.alert("Removed", `${displayName} removed successfully.`);
            } catch (e: any) {
              Alert.alert("Remove failed", String(e?.message || e || "Error"));
            }
          }
        }
      ]
    );
  }

  async function deleteMinistryNow() {
    if (!canEditMinistry) {
      Alert.alert("Access denied");
      return;
    }

    Alert.alert(
      "Delete Ministry",
      "This ministry will be permanently deleted.",
      [
        {
          text: "Cancel",
          style: "cancel"
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await apiDelete(
                `/api/church/ministries?id=${encodeURIComponent(ministryId)}`,
                {
                  headers: getKristoHeaders(),
                }
              );

              if (!res?.ok) {
                throw new Error(res?.error || "Delete failed");
              }

              Alert.alert("Deleted", "Ministry deleted successfully.");

              router.replace("/church/ministries");
            } catch (e: any) {
              Alert.alert("Delete failed", String(e?.message || e || "Error"));
            }
          }
        }
      ]
    );
  }

  const leadersCount = membersLive.filter((x: any) => {
  const role = String(x?.role || x?.ministryRole || "").toLowerCase().trim();

  return (
    role === "leader" ||
    role === "ministry_leader" ||
    role === "pastor"
  );
}).length;
  const membersCount = membersLive.length;
  function openEditMinistryScreen() {
    if (!canEditMinistry) {
      Alert.alert("Admin access", "Only pastor, church admin, or ministry leader can edit this ministry.");
      return;
    }
    router.push(({
      pathname: "/church/ministries/[ministryId]/edit",
      params: { ministryId },
    } as any));
  }

return (
    <View style={[s.wrap, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 18 }]}>
      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.h1}>Ministry Details</Text>
          <Text style={s.h2} numberOfLines={1}>
            {item?.name || "Church ministry"}
          </Text>
        </View>

        <Pressable onPress={() => load({ silent: true })} style={s.refreshBtn} hitSlop={10}>
          <Ionicons name="refresh" size={18} color="white" />
        </Pressable>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.p}>Loading ministry...</Text>
        </View>
      ) : err ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>Failed to load</Text>
          <Text style={s.errorText}>{err}</Text>

          <Pressable onPress={() => load()} style={[s.btn, s.btnGold]}>
            <Text style={[s.btnText, s.btnTextGold]}>Retry</Text>
          </Pressable>
        </View>
      ) : !item ? (
        <View style={s.errorCard}>
          <Text style={s.errorTitle}>No data</Text>
          <Text style={s.errorText}>This ministry could not be found.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
          <View style={s.heroCard}>
            <View style={s.heroAvatarWrap}>
              {item.avatarUri ? (
                <Image source={{ uri: item.avatarUri }} style={s.heroAvatar} />
              ) : (
                <View style={s.heroIcon}>
                  <Text style={s.heroAvatarText}>{ministryInitial(item.name)}</Text>
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>{item.name}</Text>
              <Text style={s.heroSub}>
                {item.description ? item.description : "No description yet."}
              </Text>
            </View>
          </View>

          <View style={s.grid}>
            <View style={s.statCard}>
              <View style={s.statIcon}>
                <Ionicons name="radio-button-on-outline" size={18} color={GOLD} />
              </View>
              <Text style={s.statValue}>{item.status}</Text>
              <Text style={s.statLabel}>Status</Text>
            </View>

            <View style={s.statCard}>
              <View style={s.statIcon}>
                <Ionicons name="star" size={18} color={GOLD} />
              </View>
              <Text style={s.statValue}>{leadersCount}</Text>
              <Text style={s.statLabel}>Leaders</Text>
            </View>

            <View style={s.statCard}>
              <View style={s.statIcon}>
                <Ionicons name="people" size={18} color={GOLD} />
              </View>
              <Text style={s.statValue}>{membersCount}</Text>
              <Text style={s.statLabel}>Members</Text>
            </View>

            <View style={[s.statCard, item.mediaAccess && s.mediaStatOn]}>
              <View style={s.statIcon}>
                <Ionicons name={item.mediaAccess ? "videocam" : "videocam-outline"} size={18} color={GOLD} />
              </View>
              <Text style={s.statValue}>{item.mediaAccess ? "On" : "Off"}</Text>
              <Text style={s.statLabel}>Media Access</Text>
            </View>
          </View>


          <Pressable
            onPress={() => setMembersOpen((v) => !v)}
            style={({ pressed }) => [s.card, pressed && { opacity: 0.92 }]}
          >
            <View style={s.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>Members</Text>
                <Text style={s.sectionHint}>{membersLive.length} members • leaders and roles</Text>
              </View>

              <View style={s.openPill}>
                <Text style={s.openPillText}>{membersOpen ? "Close" : "Open"}</Text>
                <Ionicons name={membersOpen ? "chevron-up" : "chevron-down"} size={15} color="#0B0F17" />
              </View>
            </View>

            {membersOpen && (
              <View>
                {membersLive.length === 0 ? (
                  <Text style={s.p}>No members added yet.</Text>
                ) : (
                  membersLive.slice(0, 12).map((m: any, i: number) => {
                    const displayName = String(
                      m?.name || m?.fullName || m?.displayName || m?.email || m?.userId || m?.id || "User"
                    );
                    const role = String(m?.role || m?.ministryRole || "Member");
                    const isLeader = role.toLowerCase().includes("leader");

                    return (
                      <View key={`${m?.userId || m?.id || i}`} style={s.memberPreviewRow}>
                        <View style={s.memberPreviewAvatar}>
                          <Text style={s.memberPreviewInitial}>
                            {displayName.trim().charAt(0).toUpperCase() || "U"}
                          </Text>
                        </View>

                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.memberPreviewName} numberOfLines={1}>{displayName}</Text>
                          <Text style={s.memberPreviewRole} numberOfLines={1}>{role}</Text>
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={isLeader ? s.rolePillLeader : s.rolePill}>
                            <Text style={isLeader ? s.rolePillLeaderText : s.rolePillText}>{role}</Text>
                          </View>

                          {canEditMinistry ? (
                            <Pressable
                              onPress={() => removeMemberFromMinistry(m)}
                              style={s.memberRemoveBtn}
                            >
                              <Ionicons
                                name="close"
                                size={12}
                                color="#FF8A8A"
                              />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            )}
          </Pressable>

          {canEditMinistry ? (
            <View style={s.manageRow}>
              <Pressable
                onPress={() => addPersonToMinistry("Leader")}
                style={[s.manageBtn, s.manageLeaderBtn]}
              >
                <Ionicons name="star" size={16} color="#0B0F17" />
                <Text style={s.manageBtnTextDark}>Add Leader</Text>
              </Pressable>

              <Pressable
                onPress={() => addPersonToMinistry("Member")}
                style={[s.manageBtn, s.manageMemberBtn]}
              >
                <Ionicons name="people" size={16} color="white" />
                <Text style={s.manageBtnText}>Add Member</Text>
              </Pressable>
            </View>
          ) : null}

          {canEditMinistry ? (
            <Pressable
              onPress={deleteMinistryNow}
              style={s.deleteBtn}
            >
              <Ionicons name="trash-outline" size={18} color="#FF8A8A" />
              <Text style={s.deleteBtnText}>Delete Ministry</Text>
            </Pressable>
          ) : null}

          <View style={s.card}>
            <Text style={s.sectionTitle}>Description</Text>
            <Text style={s.p}>
              {item.description ? item.description : "No description yet."}
            </Text>
          </View>

          <View style={s.card}>
            <Text style={s.sectionTitle}>Meta</Text>
            <Text style={s.meta}>Ministry ID: {item.id || "—"}</Text>
            <Text style={s.meta}>Created: {item.createdAt || "—"}</Text>
            <Text style={s.meta}>Updated: {item.updatedAt || "—"}</Text>
          </View>

          <View style={s.actionsWrap}>
            {canEditMinistry ? (
              <Pressable onPress={openEditMinistryScreen} style={[s.btn, s.btnBlue]}>
                <Text style={[s.btnText, s.btnTextBlue]}>Edit Ministry</Text>
              </Pressable>
            ) : null}

            <Pressable onPress={() => router.push("/church/ministries")} style={[s.btn, s.btnGold]}>
              <Text style={[s.btnText, s.btnTextGold]}>Back to Ministries</Text>
            </Pressable>
          </View>

        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create<any>({
  wrap: { flex: 1, backgroundColor: VIP_BG, paddingHorizontal: 16 },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  h1: { color: "white", fontSize: 26, fontWeight: "900", letterSpacing: 0.2 },
  h2: { color: MUTED, marginTop: 2, fontSize: 14, fontWeight: "700" },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  heroCard: {
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1.3,
    borderColor: "rgba(217,179,95,0.42)",
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  heroAvatarWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    overflow: "hidden",
  },
  heroIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  heroAvatar: {
    width: "100%",
    height: "100%",
  },
  heroAvatarText: {
    color: GOLD,
    fontSize: 24,
    fontWeight: "900",
  },
  heroTitle: { color: "white", fontSize: 18, fontWeight: "900" },
  heroSub: { color: MUTED, marginTop: 6, fontSize: 14, lineHeight: 19 },

  errorCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: "rgba(120,20,20,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,90,90,0.22)",
  },
  errorTitle: { color: "white", fontSize: 15, fontWeight: "900" },
  errorText: { color: "rgba(255,255,255,0.78)", marginTop: 6, fontSize: 13, lineHeight: 18 },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 14,
  },
  statCard: {
    width: "48.5%",
    minHeight: 112,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.055)",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.14)",
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    marginBottom: 14,
  },
  statValue: { color: "white", fontSize: 18, fontWeight: "900" },
  statLabel: { color: MUTED, marginTop: 6, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  mediaStatOn: {
    borderColor: "rgba(217,179,95,0.50)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },

  card: {
    borderRadius: 22,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1.1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(255,255,255,0.045)",
  },
  sectionTitle: { color: "white", fontSize: 15, fontWeight: "900", marginBottom: 8 },
  p: { color: MUTED, fontSize: 14, lineHeight: 19 },
  meta: { color: "rgba(255,255,255,0.62)", marginTop: 6, fontSize: 13, fontWeight: "700" },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionHint: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "800",
  },
  memberPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
  },
  memberPreviewAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  memberPreviewInitial: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 14,
  },
  memberPreviewName: {
    color: "rgba(255,255,255,0.94)",
    fontWeight: "800",
    fontSize: 14,
  },
  memberPreviewRole: {
    marginTop: 2,
    color: "rgba(255,255,255,0.54)",
    fontWeight: "700",
    fontSize: 11,
  },

  openPill: {
    height: 34,
    borderRadius: 999,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: GOLD,
  },
  openPillText: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 12,
  },

  memberHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rolePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  rolePillText: {
    color: "rgba(255,255,255,0.66)",
    fontWeight: "800",
    fontSize: 11,
  },
  rolePillLeader: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
  },

  memberRemoveBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,80,80,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.30)",
  },

  rolePillLeaderText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 11,
  },

  manageRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },

  manageBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  manageLeaderBtn: {
    backgroundColor: GOLD,
  },

  manageMemberBtn: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  manageBtnTextDark: {
    color: "#0B0F17",
    fontWeight: "900",
    fontSize: 14,
  },

  manageBtnText: {
    color: "white",
    fontWeight: "800",
    fontSize: 14,
  },

  deleteBtn: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.28)",
    backgroundColor: "rgba(120,0,0,0.18)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },

  deleteBtnText: {
    color: "#FF8A8A",
    fontWeight: "900",
    fontSize: 15,
  },

  actionsWrap: { gap: 10 },
  btn: {
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  btnGold: {
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  btnBlue: {
    borderColor: "rgba(70,130,255,0.34)",
    backgroundColor: "rgba(70,130,255,0.10)",
  },
  btnText: { color: "white", fontSize: 14, fontWeight: "800", letterSpacing: 0.2, textAlign: "center" },
  btnTextGold: { color: GOLD },
  btnTextBlue: { color: "rgba(125,170,255,0.98)" },

  debugCard: {
    marginTop: 14,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  debugText: { color: "rgba(255,255,255,0.58)", fontSize: 12, fontWeight: "700" },
});