import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
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
const TEXT_SECONDARY = "rgba(255,255,255,0.62)";
const TEXT_MUTED = "rgba(255,255,255,0.44)";
const TAB_BAR_HEIGHT = 70;
const LIVE_FAB_CLEARANCE = 84;
const FOOTER_ABOVE_TAB_GAP = 16;
const LIVE_FAB_VERTICAL_PAD = 14;
const SAVE_BUTTON_HEIGHT = 56;
const SAVE_BUTTON_RADIUS = 23;
const SCROLL_BOTTOM_EXTRA = 56;
const FOOTER_BANNER_RESERVE = 34;
const FOOTER_GLOW_RESERVE = 12;
const HOST_AVATAR_SIZE = 66;
const EMPTY_PLACEHOLDER_SIZE = 52;

function LuxuryPressable({
  style,
  children,
  disabled,
  onPress,
}: {
  style?: any;
  children: React.ReactNode;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={style}
      onPressIn={() => {
        if (disabled) return;
        Animated.spring(scale, { toValue: 0.978, useNativeDriver: true, speed: 52, bounciness: 2 }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 52, bounciness: 2 }).start();
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

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

  const bottomContentClearance = useMemo(
    () =>
      SAVE_BUTTON_HEIGHT +
      TAB_BAR_HEIGHT +
      LIVE_FAB_CLEARANCE +
      insets.bottom +
      SCROLL_BOTTOM_EXTRA +
      FOOTER_BANNER_RESERVE +
      FOOTER_GLOW_RESERVE,
    [insets.bottom]
  );

  const footerBottomOffset = useMemo(
    () => TAB_BAR_HEIGHT + FOOTER_ABOVE_TAB_GAP + LIVE_FAB_VERTICAL_PAD,
    []
  );

  const saveGlowPulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(saveGlowPulse, { toValue: 0.72, duration: 1800, useNativeDriver: true }),
        Animated.timing(saveGlowPulse, { toValue: 0.35, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [saveGlowPulse]);

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
        colors={["#04060B", "#080E18", "#050810"]}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(217,179,95,0.14)", "rgba(217,179,95,0.04)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={s.topGlow}
      />
      <View pointerEvents="none" style={s.bgRadialGold} />
      <View pointerEvents="none" style={s.bgRadialBlue} />
      <LinearGradient
        pointerEvents="none"
        colors={["transparent", "rgba(8,14,24,0.35)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.bgMidBand}
      />

      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed && s.backBtnPressed]}>
          <Ionicons name="chevron-back" size={20} color={GOLD} />
        </Pressable>

        <View style={s.headerTextWrap}>
          <View style={s.titleBlock}>
            <View pointerEvents="none" style={s.titleGlow} />
            <View style={s.titleRow}>
              <Text style={s.title}>Trusted Hosts</Text>
              <View style={s.countPillOuter}>
                {Platform.OS === "ios" ? (
                  <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFillObject} />
                ) : null}
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(255,255,255,0.10)", "rgba(217,179,95,0.06)", "transparent"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <Text style={s.countPillText}>
                  {selectedCount}/{MAX_CHURCH_MEDIA_HOSTS}
                </Text>
              </View>
            </View>
          </View>
          <Text style={s.subtitle}>
            Assign up to {MAX_CHURCH_MEDIA_HOSTS} trusted members to help manage your church broadcast studio.
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
          contentContainerStyle={[s.scrollContent, { paddingBottom: bottomContentClearance }]}
          scrollIndicatorInsets={{ bottom: bottomContentClearance * 0.35 }}
        >
          <Text style={s.sectionEyebrow}>Broadcast control</Text>

          {hosts.map((host, index) => {
            const filled = Boolean(host);
            const avatar = imgUrl(host?.avatarUrl || host?.avatarUri);

            return (
              <View
                key={`slot-${index}`}
                style={[s.slotCard, filled ? s.slotCardFilled : s.slotCardEmpty]}
              >
                {filled ? (
                  <>
                    <View pointerEvents="none" style={s.cardAmbientGlow} />
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.16)", "rgba(217,179,95,0.08)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={s.cardSheen}
                    />
                    <View pointerEvents="none" style={s.cardInnerGlow} />
                  </>
                ) : (
                  <>
                    <View pointerEvents="none" style={s.emptyCardAmbientGlow} />
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.05)", "rgba(217,179,95,0.03)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={s.cardSheenEmpty}
                    />
                    <View pointerEvents="none" style={s.emptyCardInnerGlow} />
                  </>
                )}

                <View style={s.slotTopRow}>
                  <Text style={[s.slotLabel, filled ? s.slotLabelFilled : s.slotLabelEmpty]}>
                    Host {index + 1}
                  </Text>
                  {filled ? (
                    <Pressable
                      disabled={!canManageHosts || saving}
                      onPress={() => removeHost(index)}
                      hitSlop={8}
                      style={({ pressed }) => [s.removeBtn, pressed && s.removeBtnPressed]}
                    >
                      {Platform.OS === "ios" ? (
                        <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFillObject} />
                      ) : null}
                      <Ionicons name="close" size={11} color="#FCA5A5" />
                      <Text style={s.removeBtnText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>

                {filled ? (
                  <View style={s.hostRow}>
                    <View style={s.avatarStage}>
                      <View pointerEvents="none" style={s.avatarAmbient} />
                      {avatar ? (
                        <Image source={{ uri: avatar }} style={s.hostAvatar} />
                      ) : (
                        <View style={s.hostAvatarFallback}>
                          <Text style={s.hostAvatarInitial}>
                            {String(host!.name || "H").slice(0, 1).toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={s.hostMeta}>
                      <Text style={s.hostName} numberOfLines={1}>
                        {host!.name}
                      </Text>
                      <View style={s.hostSubRow}>
                        <Text style={s.hostRole} numberOfLines={1}>
                          {host!.role}
                        </Text>
                        {host!.kristoId ? (
                          <>
                            <Text style={s.hostDot}>·</Text>
                            <View style={s.coreIdPill}>
                              <Text style={s.coreIdText}>{host!.kristoId}</Text>
                            </View>
                          </>
                        ) : null}
                      </View>
                    </View>
                  </View>
                ) : (
                  <LuxuryPressable
                    disabled={!canManageHosts || saving || selectedCount >= MAX_CHURCH_MEDIA_HOSTS}
                    onPress={() => setActiveSlot(index)}
                    style={s.emptySlotPressable}
                  >
                    <View style={s.emptyAvatarStage}>
                      <View pointerEvents="none" style={s.emptyAmbientGlow} />
                      <View style={s.emptyDashedFrame}>
                        <Ionicons name="person-add-outline" size={18} color={GOLD_SOFT} />
                      </View>
                    </View>

                    <View style={s.emptyTextCol}>
                      <Text style={s.emptyTitle}>Available slot</Text>
                      <Text style={s.emptyMicro}>
                        {canManageHosts ? "Tap to assign" : "Pastor access required"}
                      </Text>
                    </View>

                    <View style={s.emptyChevronWrap}>
                      {Platform.OS === "ios" ? (
                        <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFillObject} />
                      ) : null}
                      <Ionicons name="chevron-forward" size={14} color="rgba(217,179,95,0.65)" />
                    </View>
                  </LuxuryPressable>
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
            bottom: footerBottomOffset,
          },
        ]}
        pointerEvents="box-none"
      >
        <LinearGradient
          pointerEvents="none"
          colors={["transparent", "rgba(5,8,14,0.04)", "rgba(5,8,14,0.08)"]}
          style={s.footerFade}
        />

        {saveSuccess ? (
          <View style={s.bannerSuccess}>
            <Ionicons name="checkmark-circle" size={14} color="#86EFAC" />
            <Text style={s.bannerSuccessText}>{saveSuccess}</Text>
          </View>
        ) : null}

        {saveError ? (
          <View style={s.bannerError}>
            <Ionicons name="alert-circle" size={14} color="#FCA5A5" />
            <Text style={s.bannerErrorText}>{saveError}</Text>
          </View>
        ) : null}

        <View style={s.saveBtnWrap}>
          {!saving && canManageHosts ? (
            <Animated.View
              pointerEvents="none"
              style={[s.saveBtnGlow, { opacity: saveGlowPulse }]}
            />
          ) : null}

          <Pressable
            disabled={!canManageHosts || saving || loading}
            onPress={saveHosts}
            style={({ pressed }) => [
              s.saveBtn,
              !canManageHosts ? s.saveBtnDisabled : null,
              saving ? s.saveBtnSaving : null,
              pressed && canManageHosts && !saving ? s.saveBtnPressed : null,
            ]}
          >
            <LinearGradient
              colors={
                !canManageHosts
                  ? ["rgba(217,179,95,0.14)", "rgba(217,179,95,0.08)"]
                  : saving
                    ? ["rgba(217,179,95,0.62)", "rgba(167,124,46,0.78)"]
                    : ["#F5E2A8", "#E8C872", GOLD, "#9A7330"]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.saveBtnGradient}
            >
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(255,255,255,0.38)", "rgba(255,255,255,0.06)", "transparent"]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 0.55 }}
                style={s.saveBtnSheen}
              />
              {saving ? (
                <>
                  <ActivityIndicator size="small" color="#0B0F17" />
                  <Text style={s.saveBtnTextDark}>{saveLabel}</Text>
                </>
              ) : (
                <>
                  <Ionicons
                    name={canManageHosts ? "shield-checkmark-outline" : "lock-closed-outline"}
                    size={15}
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
                      pressed && !used && !isPastorMember ? s.memberRowPressed : null,
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
    backgroundColor: "#04060B",
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  bgRadialGold: {
    position: "absolute",
    top: 80,
    left: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(217,179,95,0.07)",
  },
  bgRadialBlue: {
    position: "absolute",
    top: 280,
    right: -70,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(72,120,210,0.06)",
  },
  bgMidBand: {
    position: "absolute",
    top: "38%",
    left: 0,
    right: 0,
    height: 280,
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    marginBottom: 14,
  },
  backBtnPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
  headerTextWrap: {
    gap: 8,
  },
  titleBlock: {
    position: "relative",
  },
  titleGlow: {
    position: "absolute",
    left: -8,
    top: -6,
    width: 180,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: GOLD,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  countPillOuter: {
    minWidth: 52,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
  },
  countPillText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  subtitle: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    letterSpacing: 0.12,
    maxWidth: "96%",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  loadingText: {
    color: TEXT_SECONDARY,
    fontWeight: "700",
    fontSize: 13,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 2,
    gap: 14,
  },
  sectionEyebrow: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 2,
    marginLeft: 2,
  },
  slotCard: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 12,
    borderWidth: 1,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 3 },
    }),
  },
  slotCardEmpty: {
    backgroundColor: "rgba(8,14,24,0.46)",
    borderColor: "rgba(217,179,95,0.16)",
    paddingBottom: 10,
  },
  slotCardFilled: {
    backgroundColor: "rgba(10,16,28,0.72)",
    borderColor: "rgba(217,179,95,0.32)",
  },
  cardAmbientGlow: {
    position: "absolute",
    left: 12,
    top: 34,
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  cardSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 40,
  },
  cardSheenEmpty: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 32,
  },
  emptyCardAmbientGlow: {
    position: "absolute",
    left: 12,
    top: 34,
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  emptyCardInnerGlow: {
    position: "absolute",
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.10)",
  },
  cardInnerGlow: {
    position: "absolute",
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.14)",
  },
  slotTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    minHeight: 22,
  },
  slotLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  slotLabelEmpty: {
    color: TEXT_MUTED,
  },
  slotLabelFilled: {
    color: "rgba(217,179,95,0.88)",
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: HOST_AVATAR_SIZE,
  },
  avatarStage: {
    width: HOST_AVATAR_SIZE + 6,
    height: HOST_AVATAR_SIZE + 6,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarAmbient: {
    position: "absolute",
    width: HOST_AVATAR_SIZE + 10,
    height: HOST_AVATAR_SIZE + 10,
    borderRadius: 20,
    backgroundColor: "rgba(217,179,95,0.14)",
  },
  hostAvatar: {
    width: HOST_AVATAR_SIZE,
    height: HOST_AVATAR_SIZE,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(247,210,112,0.88)",
  },
  hostAvatarFallback: {
    width: HOST_AVATAR_SIZE,
    height: HOST_AVATAR_SIZE,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1.5,
    borderColor: "rgba(247,210,112,0.38)",
  },
  hostAvatarInitial: {
    color: GOLD,
    fontWeight: "800",
    fontSize: 22,
  },
  hostMeta: {
    flex: 1,
    gap: 4,
    justifyContent: "center",
    minWidth: 0,
  },
  hostName: {
    color: "#F8FAFC",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.04,
  },
  hostSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  hostRole: {
    color: TEXT_SECONDARY,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  hostDot: {
    color: "rgba(255,255,255,0.28)",
    fontSize: 12,
    fontWeight: "700",
  },
  coreIdPill: {
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  coreIdText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.35,
  },
  emptySlotPressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: EMPTY_PLACEHOLDER_SIZE + 4,
  },
  emptyAvatarStage: {
    width: EMPTY_PLACEHOLDER_SIZE + 4,
    height: EMPTY_PLACEHOLDER_SIZE + 4,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  emptyAmbientGlow: {
    position: "absolute",
    width: EMPTY_PLACEHOLDER_SIZE + 8,
    height: EMPTY_PLACEHOLDER_SIZE + 8,
    borderRadius: 16,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  emptyDashedFrame: {
    width: EMPTY_PLACEHOLDER_SIZE,
    height: EMPTY_PLACEHOLDER_SIZE,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217,179,95,0.32)",
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  emptyTextCol: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    gap: 4,
  },
  emptyTitle: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.08,
  },
  emptyMicro: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
    lineHeight: 16,
  },
  emptyChevronWrap: {
    width: 32,
    height: 32,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    flexShrink: 0,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(248,113,113,0.08)",
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.18)",
    flexShrink: 0,
  },
  removeBtnPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.97 }],
  },
  removeBtnText: {
    color: "#FCA5A5",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 0,
    gap: 6,
    backgroundColor: "transparent",
  },
  footerFade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -14,
    height: 14,
  },
  bannerSuccess: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(34,197,94,0.08)",
    borderWidth: 1,
    borderColor: "rgba(134,239,172,0.18)",
  },
  bannerSuccessText: {
    color: "#86EFAC",
    fontWeight: "700",
    fontSize: 11,
    flex: 1,
  },
  bannerError: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(248,113,113,0.08)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.18)",
  },
  bannerErrorText: {
    color: "#FCA5A5",
    fontWeight: "700",
    fontSize: 11,
    flex: 1,
  },
  saveBtnWrap: {
    position: "relative",
  },
  saveBtnGlow: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 4,
    bottom: 0,
    borderRadius: SAVE_BUTTON_RADIUS,
    backgroundColor: "rgba(217,179,95,0.32)",
    ...Platform.select({
      ios: {
        shadowColor: GOLD,
        shadowOpacity: 0.38,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 5 },
    }),
  },
  saveBtn: {
    borderRadius: SAVE_BUTTON_RADIUS,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.24,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 4 },
    }),
  },
  saveBtnDisabled: {
    opacity: 0.9,
  },
  saveBtnSaving: {
    opacity: 0.96,
  },
  saveBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  saveBtnGradient: {
    height: SAVE_BUTTON_HEIGHT,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  saveBtnSheen: {
    ...StyleSheet.absoluteFillObject,
  },
  saveBtnTextDark: {
    color: "#0B0F17",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  saveBtnTextMuted: {
    color: GOLD,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.58)",
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
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: "600",
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
    gap: 18,
  },
  memberRowDisabled: {
    opacity: 0.45,
  },
  memberRowPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.985 }],
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
    color: TEXT_SECONDARY,
    fontSize: 12,
    fontWeight: "700",
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
