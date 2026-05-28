import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { loadSession, saveSession, setSessionSync } from "@/src/lib/kristoSession";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import {
  loadChurchMediaProfileCache,
  saveChurchMediaProfileCache,
  clearChurchMediaProfileCache,
} from "@/src/lib/churchMediaProfileStore";
import { MAX_CHURCH_MEDIA_HOSTS } from "@/src/lib/churchMediaAccess";

type HostDraft = {
  userId: string;
  name: string;
  role: string;
  avatarUrl?: string;
  avatarUri?: string;
  kristoId?: string;
};

type Member = {
  id?: string;
  membershipId?: string;
  userId: string;
  name?: string;
  displayName?: string;
  role?: string;
  roleLabel?: string;
  avatarUrl?: string;
  avatarUri?: string;
  kristoId?: string;
  userCode?: string;
};

const API_BASE = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
const GOLD = "#D9B35F";
const GOLD_SOFT = "rgba(217,179,95,0.55)";
const TAB_BAR_HEIGHT = 72;
const LIVE_FAB_CLEARANCE = 84;
const FOOTER_HEIGHT = 92;

function imgUrl(u?: string) {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return API_BASE ? `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}` : u;
}

function normalizeMembersResponse(res: any): Member[] {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.items)) return res.items;
  if (Array.isArray(res?.members)) return res.members;
  return [];
}

function slotsFromHosts(savedHosts: HostDraft[]) {
  return [
    savedHosts[0] || null,
    savedHosts[1] || null,
    savedHosts[2] || null,
  ] as Array<HostDraft | null>;
}

function serializeHostsForSave(hosts: Array<HostDraft | null>) {
  return hosts
    .filter(Boolean)
    .slice(0, MAX_CHURCH_MEDIA_HOSTS)
    .map((host) => ({
      userId: String(host!.userId || "").trim(),
      name: String(host!.name || "Church member").trim(),
      role: String(host!.role || "Member").trim(),
      avatarUri: String(host!.avatarUri || host!.avatarUrl || "").trim(),
      avatarUrl: String(host!.avatarUrl || host!.avatarUri || "").trim(),
      kristoId: String(host!.kristoId || "").trim(),
    }))
    .filter((host) => host.userId);
}

export default function SelectHosts() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [hosts, setHosts] = useState<Array<HostDraft | null>>([null, null, null]);
  const [members, setMembers] = useState<Member[]>([]);
  const [session, setLocalSession] = useState<any>(null);
  const [media, setMedia] = useState<any>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [canManageHosts, setCanManageHosts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Save Trusted Hosts");
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  const selectedCount = useMemo(
    () => hosts.filter(Boolean).length,
    [hosts]
  );

  const selectedIds = useMemo(
    () => hosts.filter(Boolean).map((h) => String(h!.userId)),
    [hosts]
  );

  const scrollBottomPad =
    insets.bottom + TAB_BAR_HEIGHT + LIVE_FAB_CLEARANCE + FOOTER_HEIGHT + 12;

  const applySavedHosts = useCallback((savedHosts: HostDraft[]) => {
    setHosts(slotsFromHosts(savedHosts.slice(0, MAX_CHURCH_MEDIA_HOSTS)));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setSaveError("");

    try {
      const sess: any = await loadSession();
      setLocalSession(sess);

      if (!sess?.userId || !sess?.churchId) {
        setCanManageHosts(false);
        return;
      }

      const headers = getKristoHeaders({
        userId: sess.userId,
        role: sess.role || "Member",
        churchId: sess.churchId || "",
      });

      const cachedMedia = await loadChurchMediaProfileCache(String(sess.churchId || ""));

      const [membersRes, mediaRes, hostsRes]: any[] = await Promise.all([
        apiGet("/api/church/members?all=1", { headers }),
        apiGet("/api/church/media", { headers }),
        apiGet("/api/church/media-hosts", { headers }),
      ]);

      setMembers(normalizeMembersResponse(membersRes));
      setCanManageHosts(Boolean(hostsRes?.canManageMediaHosts));

      if (cachedMedia?.mediaName && mediaRes?.profileMissing) {
        console.warn("[SelectHosts] stale media cache invalidated", {
          churchId: sess.churchId,
          cachedName: cachedMedia.mediaName,
        });
        await clearChurchMediaProfileCache(String(sess.churchId || ""));
      }

      const resolvedMedia =
        mediaRes?.ok && mediaRes?.media?.mediaName ? mediaRes.media : null;
      setMedia(resolvedMedia);

      const savedHosts = Array.isArray(hostsRes?.hosts) ? hostsRes.hosts : [];

      applySavedHosts(
        savedHosts.map((host: any) => ({
          userId: String(host?.userId || host?.id || "").trim(),
          name: String(host?.name || host?.displayName || "Church member").trim(),
          role: String(host?.role || host?.roleLabel || "Member").trim(),
          avatarUrl: String(host?.avatarUrl || host?.avatarUri || "").trim(),
          avatarUri: String(host?.avatarUri || host?.avatarUrl || "").trim(),
          kristoId: String(host?.kristoId || host?.userCode || "").trim(),
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [applySavedHosts]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function addHost(member: Member) {
    if (!canManageHosts || activeSlot === null) return;

    const userId = String(member.userId || "").trim();
    if (!userId) return;

    if (selectedIds.includes(userId)) {
      Alert.alert("Already selected", "This member is already assigned to another host slot.");
      return;
    }

    if (selectedCount >= MAX_CHURCH_MEDIA_HOSTS) {
      Alert.alert("Limit reached", `You can only select up to ${MAX_CHURCH_MEDIA_HOSTS} trusted hosts.`);
      return;
    }

    setHosts((prev) => {
      const next = [...prev];
      next[activeSlot] = {
        userId,
        name: member.name || member.displayName || "Church member",
        role: member.role || member.roleLabel || "Member",
        avatarUrl: member.avatarUrl || member.avatarUri || "",
        avatarUri: member.avatarUri || member.avatarUrl || "",
        kristoId: member.kristoId || member.userCode || "",
      };
      return next;
    });
    setActiveSlot(null);
    setSaveSuccess("");
    setSaveError("");
  }

  function removeHost(index: number) {
    if (!canManageHosts) return;
    setHosts((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    setSaveSuccess("");
    setSaveError("");
  }

  async function saveHosts() {
    if (!canManageHosts) {
      Alert.alert(
        "Pastor access required",
        "Only the actual church Pastor can add or remove trusted media hosts."
      );
      return;
    }

    if (!session?.userId || !session?.churchId) {
      Alert.alert("Session missing", "Please sign in again and retry.");
      return;
    }

    const headers = getKristoHeaders({
      userId: session.userId,
      role: session.role || "Pastor",
      churchId: session.churchId || "",
    });

    const payload = serializeHostsForSave(hosts);
    const needsAutoCreate = !String(media?.mediaName || "").trim();

    setSaving(true);
    setSaveLabel(needsAutoCreate ? "Preparing Church Media..." : "Saving...");
    setSaveError("");
    setSaveSuccess("");

    try {
      const res: any = await apiPost("/api/church/media-hosts", { hosts: payload }, { headers });

      if (!res?.ok) {
        const message = String(res?.error || "Could not save trusted hosts.");
        setSaveError(message);
        Alert.alert("Save failed", message);
        return;
      }

      const confirmRes: any = await apiGet("/api/church/media-hosts", { headers });
      const confirmedHosts = Array.isArray(confirmRes?.hosts)
        ? confirmRes.hosts
        : Array.isArray(res?.hosts)
          ? res.hosts
          : payload;

      if (confirmedHosts.length !== payload.length) {
        const message = "Hosts did not persist on the server. Please try again.";
        setSaveError(message);
        Alert.alert("Save failed", message);
        return;
      }

      applySavedHosts(
        confirmedHosts.map((host: any) => ({
          userId: String(host?.userId || "").trim(),
          name: String(host?.name || "Church member").trim(),
          role: String(host?.role || "Member").trim(),
          avatarUrl: String(host?.avatarUrl || host?.avatarUri || "").trim(),
          avatarUri: String(host?.avatarUri || host?.avatarUrl || "").trim(),
          kristoId: String(host?.kristoId || "").trim(),
        }))
      );

      const mediaConfirmRes: any = await apiGet("/api/church/media", { headers });
      const savedMedia =
        mediaConfirmRes?.ok && mediaConfirmRes?.media?.mediaName
          ? mediaConfirmRes.media
          : res?.media?.mediaName
            ? res.media
            : null;

      if (savedMedia?.mediaName) {
        setMedia(savedMedia);
        await saveChurchMediaProfileCache({
          ...savedMedia,
          churchId: String(savedMedia.churchId || session.churchId || ""),
        });

        const nextSession = {
          ...session,
          mediaProfile: savedMedia,
          churchMediaProfile: savedMedia,
        } as any;

        await saveSession(nextSession);
        setSessionSync(nextSession);
        setLocalSession(nextSession);

        console.log("[SelectHosts] backend media confirmed after save", {
          churchId: session.churchId,
          mediaName: savedMedia.mediaName,
          hostCount: confirmedHosts.length,
        });
      } else if (res?.mediaAutoCreated) {
        const message = "Church Media was not confirmed by the server. Please try again.";
        setSaveError(message);
        Alert.alert("Save failed", message);
        return;
      }

      setSaveSuccess(
        res?.mediaAutoCreated
          ? "Church Media created and trusted hosts saved."
          : "Trusted hosts saved successfully."
      );
      setTimeout(() => setSaveSuccess(""), 2800);
    } catch (error: any) {
      const message = String(error?.message || error || "Could not save trusted hosts.");
      setSaveError(message);
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
      setSaveLabel("Save Trusted Hosts");
    }
  }

  return (
    <View style={s.root}>
      <LinearGradient
        colors={["#05070D", "#0A101C", "#050810"]}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.10)", "transparent", "transparent"]}
        style={s.topGlow}
      />

      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={22} color={GOLD} />
        </Pressable>

        <View style={s.headerTextWrap}>
          <View style={s.titleRow}>
            <Text style={s.title}>Trusted Hosts</Text>
            <View style={s.countPill}>
              <Text style={s.countPillText}>
                {selectedCount}/{MAX_CHURCH_MEDIA_HOSTS} selected
              </Text>
            </View>
          </View>
          <Text style={s.subtitle}>
            Pastor can assign up to {MAX_CHURCH_MEDIA_HOSTS} active church members to help manage Media Studio.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="small" color={GOLD} />
          <Text style={s.loadingText}>Loading trusted hosts…</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scrollContent, { paddingBottom: scrollBottomPad }]}
        >
          {hosts.map((host, index) => {
            const filled = Boolean(host);
            const avatar = imgUrl(host?.avatarUrl || host?.avatarUri);

            return (
              <View
                key={`slot-${index}`}
                style={[s.slotCard, filled ? s.slotCardFilled : s.slotCardEmpty]}
              >
                <View style={s.slotTopRow}>
                  <Text style={[s.slotLabel, filled ? s.slotLabelFilled : s.slotLabelEmpty]}>
                    Host slot {index + 1}
                  </Text>
                  {filled ? (
                    <Pressable
                      disabled={!canManageHosts || saving}
                      onPress={() => removeHost(index)}
                      hitSlop={8}
                      style={({ pressed }) => [s.removeBtn, pressed ? s.pressed : null]}
                    >
                      <Ionicons name="close-circle-outline" size={18} color="#FCA5A5" />
                      <Text style={s.removeBtnText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>

                {filled ? (
                  <View style={s.hostRow}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={s.hostAvatar} />
                    ) : (
                      <View style={s.hostAvatarFallback}>
                        <Text style={s.hostAvatarInitial}>
                          {String(host!.name || "H").slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                    )}

                    <View style={s.hostMeta}>
                      <Text style={s.hostName} numberOfLines={1}>
                        {host!.name}
                      </Text>
                      <Text style={s.hostRole} numberOfLines={1}>
                        {host!.role}
                      </Text>
                      {host!.kristoId ? (
                        <View style={s.coreIdPill}>
                          <Text style={s.coreIdText}>{host!.kristoId}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <Pressable
                    disabled={!canManageHosts || saving || selectedCount >= MAX_CHURCH_MEDIA_HOSTS}
                    onPress={() => setActiveSlot(index)}
                    style={({ pressed }) => [s.emptySlotBody, pressed ? s.pressed : null]}
                  >
                    <View style={s.emptyIconRing}>
                      <Ionicons name="person-add-outline" size={18} color={GOLD} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.emptyTitle}>Empty slot</Text>
                      <Text style={s.emptySub}>
                        {canManageHosts ? "Tap to choose a church member" : "Pastor access required"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.35)" />
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <View
        style={[
          s.footer,
          {
            paddingBottom: insets.bottom + TAB_BAR_HEIGHT + 12,
          },
        ]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "rgba(5,7,13,0.92)", "rgba(5,7,13,0.98)"]}
          style={s.footerFade}
        />

        {saveSuccess ? (
          <View style={s.bannerSuccess}>
            <Ionicons name="checkmark-circle" size={16} color="#86EFAC" />
            <Text style={s.bannerSuccessText}>{saveSuccess}</Text>
          </View>
        ) : null}

        {saveError ? (
          <View style={s.bannerError}>
            <Ionicons name="alert-circle" size={16} color="#FCA5A5" />
            <Text style={s.bannerErrorText}>{saveError}</Text>
          </View>
        ) : null}

        <Pressable
          disabled={!canManageHosts || saving || loading}
          onPress={saveHosts}
          style={({ pressed }) => [
            s.saveBtn,
            !canManageHosts ? s.saveBtnDisabled : null,
            saving ? s.saveBtnSaving : null,
            pressed && canManageHosts && !saving ? s.pressed : null,
          ]}
        >
          <LinearGradient
            colors={
              !canManageHosts
                ? ["rgba(217,179,95,0.18)", "rgba(217,179,95,0.10)"]
                : saving
                  ? ["rgba(217,179,95,0.55)", "rgba(167,124,46,0.72)"]
                  : ["#F2D792", GOLD, "#A67C2E"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={s.saveBtnGradient}
          >
            {saving ? (
              <>
                <ActivityIndicator size="small" color="#0B0F17" />
                <Text style={s.saveBtnTextDark}>{saveLabel}</Text>
              </>
            ) : (
              <>
                <Ionicons
                  name={canManageHosts ? "save-outline" : "lock-closed-outline"}
                  size={18}
                  color={canManageHosts ? "#0B0F17" : GOLD}
                />
                <Text style={[s.saveBtnTextDark, !canManageHosts && s.saveBtnTextMuted]}>
                  {canManageHosts ? "Save Trusted Hosts" : "Pastor access required"}
                </Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </View>

      <Modal visible={activeSlot !== null} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <Pressable style={s.modalBackdrop} onPress={() => setActiveSlot(null)} />
          <View style={[s.modalSheet, { paddingBottom: insets.bottom + 18 }]}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>Choose church member</Text>
            <Text style={s.modalSub}>Only active members of your church can be added.</Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {members.map((member) => {
                const id = String(member.userId || "");
                const used = selectedIds.includes(id);
                const avatar = imgUrl(member.avatarUrl || member.avatarUri);
                const isPastorMember = String(member.role || member.roleLabel || "")
                  .toLowerCase()
                  .includes("pastor");

                return (
                  <Pressable
                    key={member.id || member.membershipId || id}
                    disabled={used || isPastorMember}
                    onPress={() => addHost(member)}
                    style={({ pressed }) => [
                      s.memberRow,
                      used || isPastorMember ? s.memberRowDisabled : null,
                      pressed && !used && !isPastorMember ? s.pressed : null,
                    ]}
                  >
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={s.memberAvatar} />
                    ) : (
                      <View style={s.memberAvatarFallback}>
                        <Text style={s.memberAvatarInitial}>
                          {String(member.name || member.displayName || "M")
                            .slice(0, 1)
                            .toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.memberName} numberOfLines={1}>
                        {member.name || member.displayName || "Church member"}
                      </Text>
                      <Text style={s.memberRole} numberOfLines={1}>
                        {isPastorMember
                          ? "Pastor already has access"
                          : used
                            ? "Already selected"
                            : member.role || member.roleLabel || "Member"}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable onPress={() => setActiveSlot(null)} style={s.modalCancelBtn}>
              <Text style={s.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#05070D",
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    marginBottom: 12,
  },
  headerTextWrap: {
    gap: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  title: {
    color: GOLD,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  countPill: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  countPillText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  subtitle: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: "rgba(255,255,255,0.62)",
    fontWeight: "800",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 10,
  },
  slotCard: {
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  slotCardEmpty: {
    backgroundColor: "rgba(255,255,255,0.025)",
    borderColor: "rgba(255,255,255,0.08)",
  },
  slotCardFilled: {
    backgroundColor: "rgba(217,179,95,0.07)",
    borderColor: GOLD_SOFT,
  },
  slotTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  slotLabel: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  slotLabelEmpty: {
    color: "rgba(255,255,255,0.42)",
  },
  slotLabelFilled: {
    color: "rgba(217,179,95,0.92)",
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  hostAvatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: GOLD,
  },
  hostAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1.5,
    borderColor: "rgba(217,179,95,0.35)",
  },
  hostAvatarInitial: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 16,
  },
  hostMeta: {
    flex: 1,
    gap: 2,
  },
  hostName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
  },
  hostRole: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "800",
  },
  coreIdPill: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  coreIdText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  emptySlotBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
  },
  emptyIconRing: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  emptyTitle: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "900",
  },
  emptySub: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(248,113,113,0.08)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.18)",
  },
  removeBtnText: {
    color: "#FCA5A5",
    fontSize: 11,
    fontWeight: "900",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  footerFade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -28,
    height: 28,
  },
  bannerSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(34,197,94,0.10)",
    borderWidth: 1,
    borderColor: "rgba(134,239,172,0.22)",
  },
  bannerSuccessText: {
    color: "#86EFAC",
    fontWeight: "800",
    fontSize: 12,
    flex: 1,
  },
  bannerError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(248,113,113,0.10)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.22)",
  },
  bannerErrorText: {
    color: "#FCA5A5",
    fontWeight: "800",
    fontSize: 12,
    flex: 1,
  },
  saveBtn: {
    borderRadius: 18,
    overflow: "hidden",
  },
  saveBtnDisabled: {
    opacity: 0.92,
  },
  saveBtnSaving: {
    opacity: 0.96,
  },
  saveBtnGradient: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveBtnTextDark: {
    color: "#0B0F17",
    fontSize: 15,
    fontWeight: "900",
  },
  saveBtnTextMuted: {
    color: GOLD,
  },
  pressed: {
    opacity: 0.88,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    maxHeight: "78%",
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: "#0A101C",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
  },
  modalHandle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 12,
  },
  modalTitle: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
  },
  modalSub: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    marginBottom: 10,
  },
  memberRow: {
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.16)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  memberRowDisabled: {
    opacity: 0.45,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
  },
  memberAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  memberAvatarInitial: {
    color: GOLD,
    fontWeight: "900",
  },
  memberName: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  memberRole: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  modalCancelBtn: {
    marginTop: 12,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  modalCancelText: {
    color: "#fff",
    fontWeight: "900",
  },
});
