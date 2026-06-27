import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { approveRequest, fetchChurchMembers, fetchJoinRequests, rejectRequest, removeChurchMember, sendChurchInvite } from "@/src/lib/churchMembersApi";
import { useFocusedPolling } from "@/src/lib/useFocusedPolling";
import {
  churchMembersRowsSignature,
  getChurchMembersCache,
  peekChurchMembersCache,
  saveChurchMembersCache,
} from "@/src/lib/churchTabCache";
import {
  CHURCH_TAB_REFRESH_MS,
  logChurchFeatureBackgroundRefresh,
  logChurchFeatureFirstPaint,
  markChurchFeatureRefreshDone,
  shouldSkipChurchFeatureRefresh,
} from "@/src/lib/churchTabPreload";
import {
  hasScreenFirstPainted,
  markScreenBackgroundRefresh,
  markScreenFirstPainted,
  shouldBlockVisibleLoading,
  shouldSkipFocusRefresh,
} from "@/src/lib/screenOpenState";

const CHURCH_MEMBERS_SCREEN = "ChurchMembers";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.68)";

type Tab = "requests" | "active" | "inactive";


const MEMBER_API_BASE = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

function memberMediaUrl(v: any) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("file://") || raw.startsWith("data:image/")) return raw;
  return MEMBER_API_BASE ? `${MEMBER_API_BASE}${raw.startsWith("/") ? "" : "/"}${raw}` : raw;
}

function resolveMemberAvatar(row: any) {
  return memberMediaUrl(
    row?.avatarUrl ||
    row?.avatarUri ||
    row?.profileImage ||
    row?.photoURL ||
    row?.image ||
    row?.profileAvatarUri ||
    ""
  );
}

export default function ChurchMembersDirectory() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();
  const canManageMembers = ["Pastor", "Church_Admin"].includes(String(session?.role || ""));

  const churchId = String(session?.churchId || "").trim();
  const userId = String(session?.userId || "").trim();
  const membersCachePeek = useMemo(
    () => (churchId && userId ? peekChurchMembersCache(churchId, userId) : null),
    [churchId, userId]
  );

  const [tab, setTab] = useState<Tab>(() => {
    const initial = String(params.tab || "").trim().toLowerCase();
    return initial === "requests" ? "requests" : "active";
  });
  const [members, setMembers] = useState<any[]>(
    (membersCachePeek?.members as any[]) || []
  );
  const [requests, setRequests] = useState<any[]>(
    (membersCachePeek?.requests as any[]) || []
  );
  const [loading, setLoading] = useState(
    !Boolean(membersCachePeek?.members?.length || membersCachePeek?.requests?.length)
  );
  const [refreshing, setRefreshing] = useState(false);
  const membersSigRef = useRef(
    membersCachePeek
      ? `${churchMembersRowsSignature((membersCachePeek.members || []) as any[])}|${churchMembersRowsSignature((membersCachePeek.requests || []) as any[])}`
      : ""
  );
  const firstPaintLoggedRef = useRef(false);
  const cacheHydratedRef = useRef(Boolean(membersCachePeek));
  const [busyId, setBusyId] = useState("");
  const [err, setErr] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUserId, setInviteUserId] = useState("");
  const [inviteRole, setInviteRole] = useState<"Member" | "Leader">("Member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [smartAlert, setSmartAlert] = useState({
    open: false,
    title: "",
    message: "",
    icon: "alert-circle" as any,
    tone: "red" as "red" | "gold",
  });

  useEffect(() => {
    const nextTab = String(params.tab || "").trim().toLowerCase();
    if (nextTab === "requests") setTab("requests");
  }, [params.tab]);

  function showSmartAlert(title: string, message: string, tone: "red" | "gold" = "red") {
    setSmartAlert({
      open: true,
      title,
      message,
      icon: tone === "red" ? "alert-circle" : "checkmark-circle",
      tone,
    });
  }
  const [inviteSentId, setInviteSentId] = useState("");
  const [inviteSuccessOpen, setInviteSuccessOpen] = useState(false);
  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!inviteSuccessOpen) {
      successAnim.setValue(0);
      return;
    }

    Animated.spring(successAnim, {
      toValue: 1,
      friction: 7,
      tension: 75,
      useNativeDriver: true,
    }).start();
  }, [inviteSuccessOpen, successAnim]);

  const applyMembersCache = useCallback((cached: { members: any[]; requests: any[] }) => {
    const nextMembers = Array.isArray(cached.members) ? cached.members : [];
    const nextRequests = Array.isArray(cached.requests) ? cached.requests : [];
    const sig = `${churchMembersRowsSignature(nextMembers)}|${churchMembersRowsSignature(nextRequests)}`;
    if (sig !== membersSigRef.current) {
      membersSigRef.current = sig;
      setMembers(nextMembers);
      setRequests(nextRequests);
    }
    cacheHydratedRef.current = true;
    if (shouldBlockVisibleLoading(CHURCH_MEMBERS_SCREEN, nextMembers.length > 0 || nextRequests.length > 0)) {
      setLoading(false);
    }
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean; force?: boolean }) => {
      const silent = !!opts?.silent;
      const force = !!opts?.force;
      if (!churchId || !userId) return;

      if (
        silent &&
        !force &&
        (shouldSkipChurchFeatureRefresh(CHURCH_MEMBERS_SCREEN, churchId, userId) ||
          shouldSkipFocusRefresh(CHURCH_MEMBERS_SCREEN, CHURCH_TAB_REFRESH_MS))
      ) {
        return;
      }

      try {
        if (!silent) setErr("");
        const hasVisible = members.length > 0 || requests.length > 0;
        if (!silent && !force && shouldBlockVisibleLoading(CHURCH_MEMBERS_SCREEN, hasVisible)) {
          // keep cached rows visible
        } else if (!silent && !hasVisible) {
          setLoading(true);
        }
        if (silent) {
          setRefreshing(true);
          logChurchFeatureBackgroundRefresh(CHURCH_MEMBERS_SCREEN, "silent-refresh");
        }

        const [m, r] = await Promise.all([
          fetchChurchMembers().catch(() => []),
          fetchJoinRequests().catch((e) => {
            console.log("KRISTO_CHURCH_MEMBERS_REQUESTS_FETCH_EMPTY", {
              membersScreenChurchId: churchId,
              viewerUserId: userId,
              viewerRole: String(session?.role || ""),
              error: String((e as any)?.message || e || ""),
            });
            return [];
          }),
        ]);

        const nextMembers = Array.isArray(m) ? m : [];
        const nextRequests = Array.isArray(r) ? r : [];
        console.log("KRISTO_CHURCH_MEMBERS_REQUESTS_SYNC", {
          membersScreenChurchId: churchId,
          viewerUserId: userId,
          viewerRole: String(session?.role || ""),
          requestCount: nextRequests.length,
          memberCount: nextMembers.length,
        });
        const sig = `${churchMembersRowsSignature(nextMembers)}|${churchMembersRowsSignature(nextRequests)}`;
        if (sig !== membersSigRef.current) {
          membersSigRef.current = sig;
          setMembers(nextMembers);
          setRequests(nextRequests);
        }

        await saveChurchMembersCache({
          churchId,
          userId,
          members: nextMembers,
          requests: nextRequests,
          updatedAt: Date.now(),
        });
        markScreenBackgroundRefresh(CHURCH_MEMBERS_SCREEN);
        markChurchFeatureRefreshDone(CHURCH_MEMBERS_SCREEN, churchId, userId);
      } catch (e: any) {
        const msg = String(e?.message || e || "Try again");
        setErr(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [churchId, userId, members.length, requests.length, session?.role]
  );

  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        if (churchId && userId && !cacheHydratedRef.current) {
          const disk = await getChurchMembersCache(churchId, userId);
          if (disk && alive) applyMembersCache(disk);
        }

        if (!firstPaintLoggedRef.current && alive) {
          firstPaintLoggedRef.current = true;
          markScreenFirstPainted(CHURCH_MEMBERS_SCREEN);
          logChurchFeatureFirstPaint(
            CHURCH_MEMBERS_SCREEN,
            cacheHydratedRef.current,
            members.length + requests.length
          );
        }

        if (
          shouldSkipFocusRefresh(CHURCH_MEMBERS_SCREEN, CHURCH_TAB_REFRESH_MS) ||
          shouldSkipChurchFeatureRefresh(CHURCH_MEMBERS_SCREEN, churchId, userId)
        ) {
          return;
        }

        void load({ silent: true });
      })();

      return () => {
        alive = false;
      };
    }, [churchId, userId, applyMembersCache, load, members.length, requests.length])
  );

  useFocusedPolling(
    "ChurchMembers",
    async () => {
      await load({ silent: true });
    },
    CHURCH_TAB_REFRESH_MS,
    Boolean(churchId && userId)
  );

  async function act(id: string, action: "approve" | "reject") {
    try {
      setBusyId(id);
      if (action === "approve") await approveRequest(id);
      else await rejectRequest(id);
      await load({ force: true });
    } catch (e: any) {
      Alert.alert("Action failed", String(e?.message || e || "Try again"));
    } finally {
      setBusyId("");
    }
  }

  const activeMembers = useMemo(
    () =>
      members
        .filter((x) => String(x?.status || x?.membershipStatus || "active").toLowerCase() === "active")
        .slice()
        .sort((a, b) => {
          const ar = String(a?.role || a?.churchRole || "").toLowerCase();
          const br = String(b?.role || b?.churchRole || "").toLowerCase();
          const ap = ar.includes("pastor") ? 0 : 1;
          const bp = br.includes("pastor") ? 0 : 1;
          if (ap !== bp) return ap - bp;
          return String(a?.name || a?.displayName || "").localeCompare(String(b?.name || b?.displayName || ""));
        }),
    [members]
  );
  const inactiveMembers = useMemo(
    () => members.filter((x) => String(x?.status || x?.membershipStatus || "").toLowerCase() === "inactive"),
    [members]
  );
  const visible = useMemo(() => (tab === "requests" ? requests : tab === "inactive" ? inactiveMembers : activeMembers), [tab, requests, activeMembers, inactiveMembers]);
  const showSpinner =
    loading &&
    !shouldBlockVisibleLoading(
      CHURCH_MEMBERS_SCREEN,
      members.length > 0 || requests.length > 0
    );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>Church Members</Text>
          <Text style={s.sub}>Requests, active members, and control</Text>
        </View>

        <Pressable onPress={() => load({ force: true })} style={s.refreshBtn}>
          <Ionicons name="refresh" size={19} color={GOLD} />
        </Pressable>
      </View>

      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statValue}>{requests.length}</Text>
          <Text style={s.statLabel}>Requests</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statValue}>{members.length}</Text>
          <Text style={s.statLabel}>Members</Text>
        </View>
      </View>

      <View style={s.vipGrid}>
        <Pressable onPress={() => setTab("active")} style={[s.vipAction, tab === "active" && s.vipActionOn]}>
          <Ionicons name="people" size={18} color={tab === "active" ? "#07111F" : GOLD} />
          <Text style={[s.vipActionText, tab === "active" && s.vipActionTextOn]}>Active</Text>
          <Text style={[s.vipActionCount, tab === "active" && s.vipActionTextOn]}>{activeMembers.length}</Text>
        </Pressable>

        <Pressable onPress={() => setTab("inactive")} style={[s.vipAction, tab === "inactive" && s.vipActionOn]}>
          <Ionicons name="person-remove" size={18} color={tab === "inactive" ? "#07111F" : GOLD} />
          <Text style={[s.vipActionText, tab === "inactive" && s.vipActionTextOn]}>Inactive</Text>
          <Text style={[s.vipActionCount, tab === "inactive" && s.vipActionTextOn]}>{inactiveMembers.length}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (!canManageMembers) {
              showSmartAlert("Pastor only", "Only pastor or church admin can review requests.", "red");
              return;
            }
            setTab("requests");
          }}
          style={[s.vipAction, tab === "requests" && s.vipActionOn]}
        >
          <Ionicons name="mail-unread" size={18} color={tab === "requests" ? "#07111F" : GOLD} />
          <Text style={[s.vipActionText, tab === "requests" && s.vipActionTextOn]}>Requests</Text>
          <Text style={[s.vipActionCount, tab === "requests" && s.vipActionTextOn]}>{requests.length}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            if (!canManageMembers) {
              showSmartAlert("Pastor only", "Only pastor or church admin can add members.", "red");
              return;
            }
            setInviteError("");
            setInviteError("");
            setInviteOpen(true);
          }}
          style={[s.vipAction, s.vipAdd]}
        >
          <Ionicons name="person-add" size={18} color="#07111F" />
          <Text style={[s.vipActionText, s.vipActionTextOn]}>Add</Text>
          <Text style={[s.vipActionCount, s.vipActionTextOn]}>+</Text>
        </Pressable>
      </View>

      {err ? <Text style={s.err}>{err}</Text> : null}

      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.inviteCard}>
            <Text style={s.inviteTitle}>Send Church Invite</Text>
            <Text style={s.inviteSub}>Enter the member private Kristo ID. They will become active after accepting the invite.</Text>

            <Text style={s.inviteLabel}>Kristo ID</Text>
            <TextInput
              value={inviteUserId}
              onChangeText={(v) => {
                setInviteUserId(v.toUpperCase());
                setInviteError("");
              }}
              placeholder="KR7-25023WY"
              placeholderTextColor="rgba(255,255,255,0.32)"
              autoCapitalize="characters"
              style={s.inviteInput}
            />

            {inviteError ? (
              <View style={s.inviteErrorCard}>
                <View style={s.inviteErrorIcon}>
                  <Ionicons name="alert-circle" size={19} color="#FF6B6B" />
                </View>
                <Text style={s.inviteErrorText}>{inviteError}</Text>
              </View>
            ) : null}

            <Text style={s.inviteLabel}>Role</Text>
            <View style={s.rolePickRow}>
              {(["Member", "Leader"] as const).map((r) => (
                <Pressable key={r} onPress={() => setInviteRole(r)} style={[s.rolePick, inviteRole === r && s.rolePickOn]}>
                  <Text style={[s.rolePickText, inviteRole === r && s.rolePickTextOn]}>{r}</Text>
                </Pressable>
              ))}
            </View>

            <View style={s.inviteActions}>
              <Pressable onPress={() => setInviteOpen(false)} style={s.cancelInviteBtn}>
                <Text style={s.cancelInviteText}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={inviteBusy}
                onPress={async () => {
                  const id = inviteUserId.trim().toUpperCase();
                  if (!(/^KR7-[A-Z0-9]{6,10}$/.test(id) || /^U-DEMO-\d+$/i.test(id))) {
                    setInviteError("Use a valid Kristo ID like KR7-25023WY.");
                    return;
                  }

                  try {
                    setInviteError("");
                    setInviteBusy(true);
                    await sendChurchInvite(id, inviteRole);
                    setInviteOpen(false);
                    setInviteUserId("");
                    setInviteSentId(id);
                    setInviteSuccessOpen(true);
                    await load({ silent: true, force: true });
                  } catch (e: any) {
                    const rawMsg = String(e?.message || e || "Try again");
                    const cleanMsg =
                      rawMsg.toLowerCase().includes("does not exist")
                        ? "This Kristo ID was not found. Check the ID and try again."
                        : rawMsg.toLowerCase().includes("already")
                          ? rawMsg
                          : rawMsg;

                    setInviteError(cleanMsg);
                  } finally {
                    setInviteBusy(false);
                  }
                }}
                style={[s.sendInviteBtn, inviteBusy && { opacity: 0.55 }]}
              >
                <Text style={s.sendInviteText}>{inviteBusy ? "Sending..." : "Send Invite"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={smartAlert.open} transparent animationType="fade" onRequestClose={() => setSmartAlert((v) => ({ ...v, open: false }))}>
        <View style={s.smartOverlay}>
          <View style={[s.smartCard, smartAlert.tone === "red" ? s.smartCardRed : s.smartCardGold]}>
            <View style={s.smartGlow} />
            <View style={s.smartTop}>
              <View style={[s.smartIcon, smartAlert.tone === "red" ? s.smartIconRed : s.smartIconGold]}>
                <Ionicons name={smartAlert.icon} size={30} color={smartAlert.tone === "red" ? "#FF6B6B" : "#07111F"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.smartTitle}>{smartAlert.title}</Text>
                <Text style={s.smartSub}>{smartAlert.tone === "red" ? "CHECK AND TRY AGAIN" : "SUCCESS"}</Text>
              </View>
            </View>

            <Text style={s.smartBody}>{smartAlert.message}</Text>

            <Pressable onPress={() => setSmartAlert((v) => ({ ...v, open: false }))} style={[s.smartBtn, smartAlert.tone === "red" ? s.smartBtnRed : s.smartBtnGold]}>
              <Text style={s.smartBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={inviteSuccessOpen} transparent animationType="fade" onRequestClose={() => setInviteSuccessOpen(false)}>
        <View style={s.successOverlay}>
          <Animated.View
            style={[
              s.successCard,
              {
                opacity: successAnim,
                transform: [
                  {
                    translateY: successAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [22, 0],
                    }),
                  },
                  {
                    scale: successAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.94, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={s.successGlow} />
            <View style={s.successTop}>
              <View style={s.successIcon}>
                <Ionicons name="paper-plane" size={24} color="#07111F" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.successTitle}>Invite sent</Text>
                <Text style={s.successSub}>Waiting for acceptance</Text>
              </View>
            </View>

            <Text style={s.successBody}>
              {inviteSentId} has received a church invite. They will become an active member after accepting.
            </Text>

            <View style={s.successSteps}>
              <View style={s.successStep}>
                <Ionicons name="checkmark-circle" size={17} color={GOLD} />
                <Text style={s.successStepText}>Invite delivered</Text>
              </View>
              <View style={s.successStep}>
                <Ionicons name="time" size={17} color={GOLD} />
                <Text style={s.successStepText}>Approval happens on accept</Text>
              </View>
            </View>

            <Pressable onPress={() => setInviteSuccessOpen(false)} style={s.successBtn}>
              <Text style={s.successBtnText}>Done</Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      {showSpinner ? (
        <View style={s.center}>
          <ActivityIndicator />
          <Text style={s.muted}>Loading...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load({ force: true })} />
          }
        >
          {visible.length === 0 ? (
            <View style={s.emptyCard}>
              <Ionicons name={tab === "requests" ? "mail-open-outline" : "people-outline"} size={30} color={GOLD} />
              <Text style={s.emptyTitle}>{tab === "requests" ? "No join requests" : tab === "inactive" ? "No inactive members" : "No active members"}</Text>
              <Text style={s.emptyText}>
                {tab === "requests" ? "People who request to join this church will appear here." : tab === "inactive" ? "Removed or paused members will appear here." : "Approved active church members will appear here."}
              </Text>
            </View>
          ) : (
            visible.map((x, i) => {
              const id = String(x?.id || x?.requestId || x?.membershipId || x?.userId || i);
              const membershipId = String(x?.membershipId || x?.id || "").trim();
              const rawUserId = String(x?.userId || "").trim();
              const userCode = String(x?.userCode || x?.kristoId || x?.publicKristoId || "").trim();
              const userId = userCode || "Kristo ID pending";
              const name = String(x?.name || x?.fullName || x?.displayName || x?.email || userId || "Member");
              const role = String(x?.role || x?.churchRole || x?.status || "Member");
              const isBusy = busyId === id;
              const isPastorMember = role.toLowerCase().includes("pastor");
              const selfKeys = [
                session?.userId,
                (session as any)?.kristoId,
                (session as any)?.publicKristoId,
                (session as any)?.secureId,
              ].map((v) => String(v || "").trim().toUpperCase()).filter(Boolean);

              const memberKeys = [
                rawUserId,
                userCode,
                x?.kristoId,
                x?.publicKristoId,
                x?.privateKristoId,
              ].map((v) => String(v || "").trim().toUpperCase()).filter(Boolean);

              const isSelfMember = memberKeys.some((v) => selfKeys.includes(v));

              const avatarUri = resolveMemberAvatar(x);

              return (
                <View key={`${id}-${i}`} style={s.memberCard}>
                  <View style={s.avatar}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={s.avatarImage} />
                    ) : (
                      <Text style={s.avatarText}>{name.trim().charAt(0).toUpperCase() || "M"}</Text>
                    )}
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name} numberOfLines={1}>{name}</Text>
                    <Text style={s.meta} numberOfLines={1}>User ID: {userId}</Text>

                    {tab === "active" && canManageMembers && !isPastorMember && !isSelfMember ? (
                      <Pressable
                        disabled={isBusy}
                        onPress={() => {
                          Alert.alert(
                            "Remove member",
                            `Remove ${name} from active members?`,
                            [
                              { text: "Cancel", style: "cancel" },
                              {
                                text: "Remove",
                                style: "destructive",
                                onPress: async () => {
                                  try {
                                    setBusyId(id);
                                    await removeChurchMember({
                                      userId: rawUserId,
                                      membershipId,
                                    });
                                    await load({ force: true });
                                  } catch (e: any) {
                                    Alert.alert(
                                      "Remove failed",
                                      String(e?.message || e || "Try again")
                                    );
                                  } finally {
                                    setBusyId("");
                                  }
                                },
                              }
                            ]
                          )
                        }}
                        style={{
                          marginTop: 10,
                          alignSelf: "flex-start",
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 999,
                          backgroundColor: "rgba(255,80,80,0.14)",
                          borderWidth: 1,
                          borderColor: "rgba(255,90,90,0.28)"
                        }}
                      >
                        <Text style={{
                          color: "#FF7B7B",
                          fontSize: 12,
                          fontWeight: "800"
                        }}>
                          {isBusy ? "Removing..." : "REMOVE"}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Text style={s.role} numberOfLines={1}>{role}</Text>
                  </View>

                  {tab === "requests" ? (
                    <View style={s.actions}>
                      <Pressable disabled={isBusy} onPress={() => act(id, "approve")} style={[s.roundBtn, s.approve]}>
                        {isBusy ? <ActivityIndicator /> : <Ionicons name="checkmark" size={18} color="#07111F" />}
                      </Pressable>
                      <Pressable disabled={isBusy} onPress={() => act(id, "reject")} style={[s.roundBtn, s.reject]}>
                        <Ionicons name="close" size={18} color="white" />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => {
                        if (!canManageMembers) {
                          Alert.alert("Pastor only", "Only pastor or church admin can manage member controls.");
                          return;
                        }
                        Alert.alert("Member control", "Next: remove member, temporary sanction, and role control.");
                      }}
                      style={s.manageBtn}
                    >
                      <Ionicons name="shield-checkmark-outline" size={16} color={GOLD} />
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingHorizontal: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  backBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  addBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: GOLD, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  refreshBtn: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.10)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  title: { color: "white", fontSize: 25, fontWeight: "900" },
  sub: { color: MUTED, marginTop: 2, fontSize: 13, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 11 },
  statCard: { flex: 1, borderRadius: 22, padding: 14, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  statValue: { color: "white", fontSize: 25, fontWeight: "900" },
  statLabel: { color: MUTED, marginTop: 3, fontWeight: "800" },
  vipGrid: { flexDirection: "row", gap: 8, marginBottom: 12 },
  vipAction: { flex: 1, minHeight: 70, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  vipActionOn: { backgroundColor: GOLD, borderColor: "rgba(255,255,255,0.16)" },
  vipAdd: { backgroundColor: GOLD, borderColor: "rgba(255,255,255,0.16)" },
  vipActionText: { color: MUTED, fontSize: 11, fontWeight: "900" },
  vipActionTextOn: { color: "#07111F" },
  vipActionCount: { color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: "900" },
  err: { color: "rgba(255,120,120,0.95)", fontWeight: "800", marginBottom: 10 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", padding: 18 },
  inviteCard: { borderRadius: 28, padding: 18, backgroundColor: "#111821", borderWidth: 1, borderColor: "rgba(217,179,95,0.22)" },
  inviteTitle: { color: "white", fontSize: 24, fontWeight: "900" },
  inviteSub: { color: MUTED, marginTop: 6, lineHeight: 19, fontWeight: "700" },
  inviteLabel: { color: "rgba(255,255,255,0.55)", marginTop: 16, marginBottom: 8, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  inviteInput: { color: "white", fontSize: 16, fontWeight: "900", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  rolePickRow: { flexDirection: "row", gap: 10 },
  rolePick: { flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  rolePickOn: { backgroundColor: GOLD },
  rolePickText: { color: MUTED, fontWeight: "900" },
  rolePickTextOn: { color: "#07111F" },
  inviteErrorCard: {
    marginTop: 12,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,70,70,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,90,90,0.32)",
  },
  inviteErrorIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,70,70,0.13)",
  },
  inviteErrorText: {
    flex: 1,
    color: "rgba(255,230,230,0.94)",
    fontWeight: "800",
    lineHeight: 18,
  },
  inviteActions: { flexDirection: "row", gap: 10, marginTop: 18 },
  cancelInviteBtn: { flex: 1, height: 46, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)" },
  cancelInviteText: { color: MUTED, fontWeight: "900" },
  sendInviteBtn: { flex: 1.15, height: 46, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: GOLD },
  sendInviteText: { color: "#07111F", fontWeight: "900" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: MUTED, marginTop: 10 },
  content: { paddingBottom: 130 },
  emptyCard: { marginTop: 18, borderRadius: 28, padding: 22, alignItems: "center", backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  emptyTitle: { color: "white", fontSize: 18, fontWeight: "900", marginTop: 10 },
  emptyText: { color: MUTED, textAlign: "center", marginTop: 6, lineHeight: 19 },
  memberCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 21, padding: 11, marginBottom: 10, backgroundColor: "rgba(255,255,255,0.055)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.14)", borderWidth: 1, borderColor: "rgba(217,179,95,0.34)", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%", borderRadius: 22 },
  avatarText: { color: GOLD, fontSize: 21, fontWeight: "900" },
  name: { color: "white", fontSize: 15, fontWeight: "900" },
  meta: { color: "rgba(255,255,255,0.42)", fontSize: 11, marginTop: 3, fontWeight: "700" },
  role: { color: MUTED, marginTop: 3, fontSize: 12, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 8 },
  roundBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  approve: { backgroundColor: GOLD },
  reject: { backgroundColor: "rgba(255,90,90,0.55)" },
  manageBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.10)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  successOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.66)",
    justifyContent: "center",
    padding: 28,
  },
  successCard: {
    borderRadius: 34,
    padding: 22,
    overflow: "hidden",
    backgroundColor: "rgba(15,19,28,0.98)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.24,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  successGlow: {
    position: "absolute",
    right: -82,
    top: -82,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "rgba(217,179,95,0.13)",
  },
  successTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  successIcon: {
    width: 58,
    height: 58,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  successTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  successSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  successBody: {
    marginTop: 18,
    color: "rgba(255,255,255,0.80)",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 24,
  },
  successSteps: {
    marginTop: 16,
    gap: 9,
  },
  successStep: {
    minHeight: 46,
    borderRadius: 17,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(217,179,95,0.075)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  successStepText: {
    color: "rgba(255,255,255,0.82)",
    fontWeight: "800",
  },
  successBtn: {
    marginTop: 18,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
    backgroundColor: GOLD,
  },
  successBtnText: {
    color: "#07111F",
    fontWeight: "900",
    fontSize: 16,
  },

  smartOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.70)",
    justifyContent: "center",
    padding: 28,
  },
  smartCard: {
    borderRadius: 34,
    padding: 24,
    overflow: "hidden",
    backgroundColor: "rgba(14,18,27,0.98)",
    borderWidth: 1,
    shadowOpacity: 0.28,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  smartCardRed: {
    borderColor: "rgba(255,90,90,0.38)",
    shadowColor: "#FF3B30",
  },
  smartCardGold: {
    borderColor: "rgba(217,179,95,0.35)",
    shadowColor: "#D9B35F",
  },
  smartGlow: {
    position: "absolute",
    right: -80,
    top: -90,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: "rgba(255,70,70,0.12)",
  },
  smartTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  smartIcon: {
    width: 62,
    height: 62,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  smartIconRed: {
    backgroundColor: "rgba(255,75,75,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,90,90,0.35)",
  },
  smartIconGold: {
    backgroundColor: GOLD,
  },
  smartTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  smartSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.50)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  smartBody: {
    marginTop: 20,
    color: "rgba(255,255,255,0.82)",
    fontSize: 17,
    lineHeight: 25,
    fontWeight: "700",
  },
  smartBtn: {
    marginTop: 22,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
  },
  smartBtnRed: {
    backgroundColor: "rgba(255,80,80,0.92)",
  },
  smartBtnGold: {
    backgroundColor: GOLD,
  },
  smartBtnText: {
    color: "#07111F",
    fontSize: 16,
    fontWeight: "900",
  },

});
