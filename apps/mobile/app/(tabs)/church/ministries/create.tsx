import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { extractApiErrorMessage } from "@/src/lib/messageAttachmentUpload";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";
import { vipAvatarBg, vipInitials } from "@/src/ui/vipUtil";

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  mediaAccess?: boolean;
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId: string;
  createdAt: string;
  updatedAt?: string;
};

const PAD = 16;
const GOLD = "#D9B35F";
const GOLD_SOFT = "rgba(217,179,95,0.55)";
const VIP_BG = "#05070D";
const TEXT_PRIMARY = "rgba(255,255,255,0.96)";
const TEXT_SECONDARY = "rgba(255,255,255,0.62)";
const LABEL_GOLD = "rgba(217,179,95,0.78)";

const MEMBER_API_BASE = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");

type PickerMember = {
  userId: string;
  name?: string;
  kristoId?: string;
  coreId?: string;
  publicId?: string;
  publicKristoId?: string;
  userCode?: string;
  username?: string;
  handle?: string;
  memberCode?: string;
  profileCode?: string;
  role?: string;
  avatarUri?: string;
  avatarUrl?: string;
  profileImage?: string;
  profilePhoto?: string;
  photoURL?: string;
  photo?: string;
  image?: string;
};

type DisplayCodeSource = "kristoId" | "coreId" | "publicId" | "username" | "pending";

function isRawBackendId(value?: string) {
  const s = String(value || "").trim();
  if (!s) return true;
  if (/^u_[a-f0-9-]+$/i.test(s)) return true;
  if (/^[a-f0-9-]{24,}$/i.test(s)) return true;
  if (s.includes("@") && !s.includes(" ")) return true;
  return false;
}

function isVisibleCode(value?: string) {
  const s = String(value || "").trim();
  return Boolean(s) && !isRawBackendId(s);
}

function memberMediaUrl(v?: string) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("file://") || raw.startsWith("data:image/")) return raw;
  return MEMBER_API_BASE ? `${MEMBER_API_BASE}${raw.startsWith("/") ? "" : "/"}${raw}` : raw;
}

function resolvePickerMemberAvatar(m: PickerMember) {
  return memberMediaUrl(
    m.avatarUri || m.avatarUrl || m.profileImage || m.profilePhoto || m.photoURL || m.photo || m.image || ""
  );
}

function resolvePickerDisplayName(m: PickerMember) {
  const name = String(m.name || "").trim();
  if (name && !isRawBackendId(name)) return name;
  return "Member";
}

function resolveKristoDisplayCode(m: PickerMember): { label: string; source: DisplayCodeSource } {
  if (isVisibleCode(m.kristoId)) return { label: String(m.kristoId).trim(), source: "kristoId" };
  if (isVisibleCode(m.userCode)) return { label: String(m.userCode).trim(), source: "kristoId" };
  if (isVisibleCode(m.coreId)) return { label: String(m.coreId).trim(), source: "coreId" };
  if (isVisibleCode(m.publicId)) return { label: String(m.publicId).trim(), source: "publicId" };
  if (isVisibleCode(m.publicKristoId)) return { label: String(m.publicKristoId).trim(), source: "publicId" };
  if (isVisibleCode(m.username)) return { label: String(m.username).trim(), source: "username" };
  if (isVisibleCode(m.handle)) return { label: String(m.handle).trim(), source: "username" };
  if (isVisibleCode(m.memberCode)) return { label: String(m.memberCode).trim(), source: "username" };
  if (isVisibleCode(m.profileCode)) return { label: String(m.profileCode).trim(), source: "username" };
  return { label: "Kristo ID pending", source: "pending" };
}

function logPickerMemberDisplay(list: PickerMember[]) {
  if (!__DEV__) return;
  for (const m of list) {
    const name = resolvePickerDisplayName(m);
    const hasAvatar = Boolean(resolvePickerMemberAvatar(m));
    const { source: displayCodeSource } = resolveKristoDisplayCode(m);
    console.log("KRISTO_MINISTRY_PICKER_MEMBER_DISPLAY", { name, hasAvatar, displayCodeSource });
  }
}

function isPastorRole(role?: string) {
  const r = String(role || "").trim().toLowerCase();
  return r === "pastor" || r === "church_pastor";
}

function resolvePastorUserId(
  list: PickerMember[],
  hints?: { pastorUserId?: string; currentPastorId?: string }
) {
  const hinted = [hints?.pastorUserId, hints?.currentPastorId]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  for (const id of hinted) {
    if (list.some((m) => m.userId === id)) return id;
  }
  const byRole = list.find((m) => isPastorRole(m.role));
  return byRole?.userId || "";
}

function withPastor(ids: string[], pastorUserId: string) {
  const pid = String(pastorUserId || "").trim();
  if (!pid) return ids;
  return ids.includes(pid) ? ids : [...ids, pid];
}

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
        Animated.spring(scale, { toValue: 0.982, useNativeDriver: true, speed: 52, bounciness: 2 }).start();
      }}
      onPressOut={() => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 52, bounciness: 2 }).start();
      }}
    >
      <Animated.View style={{ flex: 1, transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

function BuilderGoldSweep() {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 4800, useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-140, 320],
  });

  return (
    <View pointerEvents="none" style={s.builderSweepClip}>
      <Animated.View style={[s.builderSweepTrack, { transform: [{ translateX }] }]}>
        <LinearGradient
          colors={["transparent", "rgba(217,179,95,0.16)", "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={s.builderSweepBand}
        />
      </Animated.View>
    </View>
  );
}

async function apiCreateMinistry(body: { name: string; description?: string; status?: MinistryStatus; mediaAccess?: boolean }) {
  const res = await apiPost<any>("/api/church/ministries", body, { headers: getKristoHeaders() });
  if (!res) throw new Error("Network error");
  if (!res.ok) throw new Error(extractApiErrorMessage(res, "Create failed"));
  return res.data as Ministry;
}

type PickerKind = "members" | "leaders";

export default function ChurchMinistryCreateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const nameRef = useRef<TextInput>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<MinistryStatus>("Active");
  const [mediaAccess, setMediaAccess] = useState(false);

  // TEMP premium gate for ministry media access
  const hasSubscription = isSubscriptionBypassEnabled();

  const [members, setMembers] = useState<PickerMember[]>([]);
  const [pastorHints, setPastorHints] = useState<{ pastorUserId?: string; currentPastorId?: string }>({});
  const [picker, setPicker] = useState<null | PickerKind>(null);
  const [pickedMemberIds, setPickedMemberIds] = useState<string[]>([]);
  const [pickedLeaderIds, setPickedLeaderIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Ministry | null>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const nameGlow = useRef(new Animated.Value(0)).current;
  const descGlow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [contentOpacity]);

  useEffect(() => {
    Animated.timing(nameGlow, {
      toValue: nameFocused ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [nameFocused, nameGlow]);

  useEffect(() => {
    Animated.timing(descGlow, {
      toValue: descFocused ? 1 : 0,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [descFocused, descGlow]);

  const autoPastorUserId = useMemo(
    () => resolvePastorUserId(members, pastorHints),
    [members, pastorHints]
  );

  const pickerMembers = useMemo(() => {
    if (!autoPastorUserId) return members;
    const pastor = members.find((m) => m.userId === autoPastorUserId);
    const rest = members.filter((m) => m.userId !== autoPastorUserId);
    return pastor ? [pastor, ...rest] : members;
  }, [members, autoPastorUserId]);

  useEffect(() => {
    if (!autoPastorUserId) return;
    setPickedLeaderIds((prev) => withPastor(prev, autoPastorUserId));
    setPickedMemberIds((prev) => withPastor(prev, autoPastorUserId));
    if (__DEV__) {
      console.log("KRISTO_CREATE_MINISTRY_AUTO_PASTOR_SELECTED", { pastorUserId: autoPastorUserId });
    }
  }, [autoPastorUserId]);

  // Load church members for pickers
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiGet<any>("/api/church/members?all=1", { headers: getKristoHeaders() });
        if (!alive) return;
        if (res?.ok && Array.isArray(res.data)) {
          const list: PickerMember[] = res.data
            .map((m: any) => ({
              userId: m.userId || m.id || m.memberId,
              name: m.name || m.fullName || m.displayName || m.email,
              kristoId: m.kristoId || m.userCode,
              coreId: m.coreId,
              publicId: m.publicId || m.publicKristoId,
              publicKristoId: m.publicKristoId,
              userCode: m.userCode,
              username: m.username,
              handle: m.handle,
              memberCode: m.memberCode,
              profileCode: m.profileCode,
              role: m.roleLabel || m.role || m.churchRole,
              avatarUri: m.avatarUri,
              avatarUrl: m.avatarUrl,
              profileImage: m.profileImage,
              profilePhoto: m.profilePhoto,
              photoURL: m.photoURL,
              photo: m.photo,
              image: m.image,
            }))
            .filter((x: PickerMember) => Boolean(x.userId));
          logPickerMemberDisplay(list);
          setPastorHints({
            pastorUserId: String(res?.pastorUserId || res?.data?.pastorUserId || "").trim() || undefined,
            currentPastorId: String(res?.currentPastorId || res?.data?.currentPastorId || "").trim() || undefined,
          });
          setMembers(list);
        }
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);

  const canSave = useMemo(() => name.trim().length > 0 && !saving && !created, [name, saving, created]);

  async function onSave() {
    if (!canSave) return;
    Keyboard.dismiss();
    setErr(null);
    setSaving(true);
    try {
      const data = await apiCreateMinistry({
        name: name.trim(),
        description: description.trim() ? description.trim() : undefined,
        status,
        mediaAccess: hasSubscription ? mediaAccess : false,
      });
      const uniqueLeaders = Array.from(new Set(withPastor(pickedLeaderIds, autoPastorUserId)));
      const uniqueMembers = Array.from(new Set(pickedMemberIds.filter((x) => !uniqueLeaders.includes(x))));

      if (__DEV__) {
        console.log("KRISTO_CREATE_MINISTRY_SAVE_LEADERS", {
          leaders: uniqueLeaders,
          members: withPastor(pickedMemberIds, autoPastorUserId),
          autoPastorUserId,
        });
      }

      const failed: string[] = [];

      for (const uid of uniqueLeaders) {
        try {
          const r = await apiPost(
            "/api/church/ministry-members",
            { ministryId: data.id, userId: uid, role: "Leader" },
            { headers: getKristoHeaders() }
          );
          if (!r?.ok) failed.push(uid);
        } catch {
          failed.push(uid);
        }
      }

      for (const uid of uniqueMembers) {
        try {
          const r = await apiPost(
            "/api/church/ministry-members",
            { ministryId: data.id, userId: uid, role: "Member" },
            { headers: getKristoHeaders() }
          );
          if (!r?.ok) failed.push(uid);
        } catch {
          failed.push(uid);
        }
      }

      setCreated(data);

      if (failed.length) {
        setErr(`Ministry created, but ${failed.length} member assignment(s) failed.`);
      }
    } catch (e: any) {
      setErr(extractApiErrorMessage(e, "Could not create ministry. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setCreated(null);
    setErr(null);
    setName("");
    setDescription("");
    setStatus("Active");
    setMediaAccess(false);
    setPickedMemberIds(autoPastorUserId ? [autoPastorUserId] : []);
    setPickedLeaderIds(autoPastorUserId ? [autoPastorUserId] : []);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function togglePick(kind: PickerKind, userId: string) {
    if (userId === autoPastorUserId) return;
    if (kind === "leaders") {
      setPickedLeaderIds((prev) => (prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]));
      // If leader is selected, also make sure they are in members list (optional)
      setPickedMemberIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    } else {
      setPickedMemberIds((prev) => (prev.includes(userId) ? prev.filter((x) => x !== userId) : [...prev, userId]));
      // If removed from members, also remove from leaders
      setPickedLeaderIds((prev) => (prev.includes(userId) ? prev.filter((x) => x !== userId) : prev));
    }
  }

  return (
    <View style={s.screen}>
      <LinearGradient
        pointerEvents="none"
        colors={["#03050A", VIP_BG, "#0A101C", "#070C16"]}
        locations={[0, 0.35, 0.72, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(72,100,180,0.04)", "transparent", "rgba(8,12,22,0.06)"]}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View pointerEvents="none" style={s.ambientBlueOrb} />
      <View pointerEvents="none" style={s.ambientGoldOrb} />

      <Pressable style={s.screenPress} onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={{ flex: 1, paddingTop: insets.top + 4 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
        >
          <View style={s.nav}>
            <LuxuryPressable onPress={() => router.back()} style={s.backBtn}>
              <Ionicons name="chevron-back" size={20} color={TEXT_PRIMARY} />
            </LuxuryPressable>

            <View style={s.navMid}>
              <Text style={s.navTitle}>Create Ministry</Text>
              <Text style={s.navSub}>Build a ministry room for leaders, members, and media.</Text>
            </View>

            <Pressable disabled={!canSave} onPress={onSave} style={s.saveBtn}>
              {canSave ? (
                <LinearGradient colors={["#F4DC8E", GOLD, "#9A7228"]} style={s.saveBtnFill}>
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(255,255,255,0.32)", "transparent"]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 0.65 }}
                    style={s.saveBtnInnerGlow}
                  />
                  {saving ? (
                    <ActivityIndicator color="#0B0F17" size="small" />
                  ) : (
                    <Text style={s.saveText}>Save</Text>
                  )}
                </LinearGradient>
              ) : (
                <View style={s.saveBtnOffFill}>
                  {saving ? (
                    <ActivityIndicator color="rgba(255,255,255,0.45)" size="small" />
                  ) : (
                    <Text style={s.saveTextOff}>Save</Text>
                  )}
                </View>
              )}
            </Pressable>
          </View>

          <Animated.ScrollView
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
            showsVerticalScrollIndicator={false}
            style={{ opacity: contentOpacity }}
          >
            {created ? (
              <View style={s.successCard}>
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(217,179,95,0.12)", "rgba(8,14,24,0.95)"]}
                  style={StyleSheet.absoluteFillObject}
                />
                <View style={s.edge} />
                <View style={s.successRow}>
                  <View style={s.successIcon}>
                    <Ionicons name="checkmark" size={18} color="#0B0F17" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.successTitle}>Successful</Text>
                    <Text style={s.successSub} numberOfLines={2}>
                      Ministry “{created.name}” created.
                    </Text>
                  </View>
                </View>

                <View style={s.divider} />

                <View style={s.actions}>
                  <LuxuryPressable onPress={resetForm} style={s.btnGhost}>
                    <Text style={s.btnGhostText}>Create another</Text>
                  </LuxuryPressable>

                  <LuxuryPressable onPress={() => router.push("/church/ministries" as any)} style={s.btnGold}>
                    <LinearGradient colors={["#F2D792", GOLD, "#A67C2E"]} style={s.btnGoldFill}>
                      <Text style={s.btnGoldTextDark}>Open list</Text>
                    </LinearGradient>
                  </LuxuryPressable>
                </View>
              </View>
            ) : (
              <>
                <View style={s.form}>
                  {err ? <Text style={s.errText}>{err}</Text> : null}

                  <View style={s.builderCardOuter}>
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(217,179,95,0.14)", "rgba(8,14,26,0.92)", "rgba(5,8,14,0.96)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <BuilderGoldSweep />
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.08)", "transparent"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 0.4 }}
                      style={s.builderSheen}
                    />
                    <View pointerEvents="none" style={s.builderGlow} />

                    <View style={s.builderRow}>
                      <View style={s.builderIconRing}>
                        <View style={s.builderIconHaloOuter} pointerEvents="none" />
                        <View style={s.builderIconHalo} pointerEvents="none" />
                        <LinearGradient colors={["#F0D48A", GOLD, "#B8893A"]} style={s.builderIcon}>
                          <Ionicons name="sparkles" size={22} color="#0B0F17" />
                        </LinearGradient>
                      </View>
                      <View style={s.builderTextCol}>
                        <Text style={s.builderTitle}>Ministry Builder</Text>
                        <Text style={s.builderSub}>
                          Create the room, assign leaders, add members, and enable media when needed.
                        </Text>
                      </View>
                    </View>
                  </View>

                  <Text style={s.label}>Name</Text>
                  <View style={s.inputOuter}>
                    <Animated.View
                      pointerEvents="none"
                      style={[s.inputFocusGlow, { opacity: nameGlow }]}
                    />
                    <View style={[s.inputWrap, nameFocused && s.inputWrapFocused]}>
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(0,0,0,0.08)", "transparent", "rgba(0,0,0,0.12)"]}
                        locations={[0, 0.42, 1]}
                        style={s.inputInnerShadow}
                      />
                      <View style={s.inputIconSlot}>
                        <Ionicons name="people-outline" size={17} color={nameFocused ? GOLD : "rgba(217,179,95,0.78)"} />
                      </View>
                      <TextInput
                        ref={nameRef}
                        value={name}
                        onChangeText={setName}
                        placeholder="Example: Choir, Youth, Ushauri"
                        placeholderTextColor="rgba(255,255,255,0.22)"
                        style={s.input}
                        returnKeyType="next"
                        onFocus={() => setNameFocused(true)}
                        onBlur={() => setNameFocused(false)}
                        onSubmitEditing={() => Keyboard.dismiss()}
                      />
                    </View>
                  </View>

                  <Text style={s.label}>Description</Text>
                  <View style={s.inputOuter}>
                    <Animated.View
                      pointerEvents="none"
                      style={[s.inputFocusGlow, { opacity: descGlow }]}
                    />
                    <View style={[s.inputWrap, descFocused && s.inputWrapFocused]}>
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(0,0,0,0.08)", "transparent", "rgba(0,0,0,0.12)"]}
                        locations={[0, 0.42, 1]}
                        style={s.inputInnerShadow}
                      />
                      <View style={s.inputIconSlot}>
                        <Ionicons name="document-text-outline" size={17} color={descFocused ? GOLD : "rgba(217,179,95,0.78)"} />
                      </View>
                      <TextInput
                        value={description}
                        onChangeText={setDescription}
                        placeholder="Short purpose or description"
                        placeholderTextColor="rgba(255,255,255,0.22)"
                        style={s.input}
                        returnKeyType="done"
                        onFocus={() => setDescFocused(true)}
                        onBlur={() => setDescFocused(false)}
                        onSubmitEditing={() => Keyboard.dismiss()}
                      />
                    </View>
                  </View>

                  <Text style={s.label}>Status</Text>
                  <View style={s.row}>
                    <LuxuryPressable onPress={() => setStatus("Active")} style={s.pill}>
                      {status === "Active" ? (
                        <LinearGradient colors={["#FAEDB4", "#E2C05E", "#7A5A18"]} style={s.pillFill}>
                          <LinearGradient
                            pointerEvents="none"
                            colors={["rgba(255,255,255,0.30)", "transparent"]}
                            style={s.pillSheen}
                          />
                          <Text style={s.pillTextOnDark}>Active</Text>
                        </LinearGradient>
                      ) : (
                        <View style={s.pillFillMuted}>
                          <Text style={s.pillText}>Active</Text>
                        </View>
                      )}
                    </LuxuryPressable>

                    <LuxuryPressable onPress={() => setStatus("Paused")} style={s.pill}>
                      {status === "Paused" ? (
                        <LinearGradient colors={["#FAEDB4", "#E2C05E", "#7A5A18"]} style={s.pillFill}>
                          <LinearGradient
                            pointerEvents="none"
                            colors={["rgba(255,255,255,0.30)", "transparent"]}
                            style={s.pillSheen}
                          />
                          <Text style={s.pillTextOnDark}>Paused</Text>
                        </LinearGradient>
                      ) : (
                        <View style={s.pillFillMuted}>
                          <Text style={s.pillText}>Paused</Text>
                        </View>
                      )}
                    </LuxuryPressable>
                  </View>

                  <Pressable
                    onPress={() => {
                      if (!hasSubscription) {
                        Alert.alert(
                          "Subscription required",
                          "Subscribe first before enabling ministry media access."
                        );
                        return;
                      }
                      setMediaAccess((v) => !v);
                    }}
                    style={({ pressed }) => [
                      s.mediaAccessCard,
                      mediaAccess && s.mediaAccessCardOn,
                      pressed && { opacity: 0.94 },
                    ]}
                  >
                    {mediaAccess ? <View pointerEvents="none" style={s.mediaAccessGlow} /> : null}
                    <LinearGradient
                      pointerEvents="none"
                      colors={
                        mediaAccess
                          ? ["rgba(217,179,95,0.14)", "rgba(8,12,22,0.97)"]
                          : ["rgba(255,255,255,0.02)", "rgba(4,8,16,0.94)"]
                      }
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View style={[s.mediaAccessIcon, mediaAccess && s.mediaAccessIconOn]}>
                      {mediaAccess ? <View pointerEvents="none" style={s.mediaIconPulse} /> : null}
                      <Ionicons
                        name={mediaAccess ? "videocam" : "videocam-outline"}
                        size={18}
                        color={mediaAccess ? "#0B0F17" : GOLD}
                      />
                    </View>
                    <View style={s.mediaAccessBody}>
                      <Text style={[s.mediaAccessTitle, mediaAccess && s.mediaAccessTitleOn]}>Media Access</Text>
                      <Text style={s.mediaAccessSub}>
                        {mediaAccess ? "Live schedules and media planning enabled" : "Enable live schedules and media planning"}
                      </Text>
                    </View>
                    <View style={s.mediaAccessRight}>
                      <Text style={mediaAccess ? s.mediaStatusOn : s.mediaStatusOff}>
                        {mediaAccess ? "ON AIR" : "OFF"}
                      </Text>
                      <View style={[s.mediaToggle, mediaAccess && s.mediaToggleOn]}>
                        <View style={[s.mediaToggleKnob, mediaAccess && s.mediaToggleKnobOn]} />
                      </View>
                    </View>
                  </Pressable>

                  <View style={s.pickRow}>
                    <LuxuryPressable onPress={() => setPicker("leaders")} style={s.pickBtn}>
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "transparent"]}
                        style={s.pickBtnSheen}
                      />
                      <LinearGradient
                        pointerEvents="none"
                        colors={["transparent", "rgba(0,0,0,0.18)"]}
                        style={s.pickBtnInnerShadow}
                      />
                      <View style={s.pickBtnInner}>
                        <View style={s.pickBtnIconWrap}>
                          <Ionicons name="star" size={18} color={GOLD} />
                        </View>
                        <View style={s.pickBtnTextWrap}>
                          <Text style={s.pickBtnText}>Leaders</Text>
                          <Text style={s.pickBtnCount}>{pickedLeaderIds.length} selected</Text>
                        </View>
                      </View>
                    </LuxuryPressable>

                    <LuxuryPressable onPress={() => setPicker("members")} style={s.pickBtn}>
                      <LinearGradient
                        pointerEvents="none"
                        colors={["rgba(255,255,255,0.10)", "rgba(255,255,255,0.02)", "transparent"]}
                        style={s.pickBtnSheen}
                      />
                      <LinearGradient
                        pointerEvents="none"
                        colors={["transparent", "rgba(0,0,0,0.18)"]}
                        style={s.pickBtnInnerShadow}
                      />
                      <View style={s.pickBtnInner}>
                        <View style={s.pickBtnIconWrap}>
                          <Ionicons name="people" size={18} color={GOLD} />
                        </View>
                        <View style={s.pickBtnTextWrap}>
                          <Text style={s.pickBtnText}>Members</Text>
                          <Text style={s.pickBtnCount}>{pickedMemberIds.length} selected</Text>
                        </View>
                      </View>
                    </LuxuryPressable>
                  </View>

                  {members.length === 0 ? (
                    <Text style={s.hintMuted}>No church members loaded yet (optional).</Text>
                  ) : (
                    <View style={s.infoPill}>
                      <Ionicons name="information-circle-outline" size={12} color="rgba(217,179,95,0.55)" />
                      <Text style={s.infoPillText}>Leaders automatically become members too.</Text>
                    </View>
                  )}
                </View>

                {picker ? (
                  <View style={s.modalWrap}>
                    <View style={s.modalCard}>
                      <View style={s.modalTop}>
                        <Text style={s.modalTitle}>{picker === "leaders" ? "Select Leaders" : "Select Members"}</Text>
                        <Pressable onPress={() => setPicker(null)} style={({ pressed }) => [s.xBtn, pressed && { opacity: 0.7 }]}>
                          <Ionicons name="close" size={18} color="rgba(255,255,255,0.85)" />
                        </Pressable>
                      </View>

                      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingBottom: 10 }}>
                        {pickerMembers.map((m) => {
                          const checked = picker === "leaders" ? pickedLeaderIds.includes(m.userId) : pickedMemberIds.includes(m.userId);
                          const isLockedPastor = m.userId === autoPastorUserId;
                          const displayName = resolvePickerDisplayName(m);
                          const avatarUri = resolvePickerMemberAvatar(m);
                          const { label: kristoLabel } = resolveKristoDisplayCode(m);
                          const roleLabel = String(m.role || "").trim();
                          return (
                            <Pressable
                              key={m.userId}
                              disabled={isLockedPastor}
                              onPress={() => togglePick(picker, m.userId)}
                              style={({ pressed }) => [
                                s.memberRow,
                                checked && s.memberRowSelected,
                                isLockedPastor && s.memberRowLocked,
                                pressed && !isLockedPastor && { opacity: 0.88 },
                              ]}
                            >
                              {avatarUri ? (
                                <Image source={{ uri: avatarUri }} style={s.memberAvatar} />
                              ) : (
                                <View style={[s.memberAvatar, s.memberAvatarFallback, { backgroundColor: vipAvatarBg(m.userId) }]}>
                                  <Text style={s.memberAvatarInitials}>{vipInitials(displayName)}</Text>
                                </View>
                              )}
                              <View style={s.memberMeta}>
                                <Text style={s.memberName} numberOfLines={1}>
                                  {displayName}
                                </Text>
                                <Text style={s.memberId} numberOfLines={1}>
                                  {kristoLabel}
                                </Text>
                                {isLockedPastor ? (
                                  <View style={s.pastorBadge}>
                                    <Text style={s.pastorBadgeText} numberOfLines={1}>
                                      Church Pastor
                                    </Text>
                                  </View>
                                ) : roleLabel ? (
                                  <View style={s.roleBadge}>
                                    <Text style={s.roleBadgeText} numberOfLines={1}>
                                      {roleLabel}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                              <View style={[s.check, checked && s.checkOn, isLockedPastor && s.checkLocked]}>
                                {checked ? <Ionicons name="checkmark" size={14} color="#0B0F17" /> : null}
                              </View>
                            </Pressable>
                          );
                        })}
                      </ScrollView>

                      <Pressable onPress={() => setPicker(null)} style={({ pressed }) => [s.doneBtn, pressed && { opacity: 0.9 }]}>
                        <Text style={s.doneText}>Done</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </Animated.ScrollView>
        </KeyboardAvoidingView>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },
  screenPress: { flex: 1 },
  ambientGoldOrb: {
    position: "absolute",
    top: -30,
    right: -20,
    width: 160,
    height: 160,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.045)",
  },
  ambientBlueOrb: {
    position: "absolute",
    top: 220,
    left: -70,
    width: 170,
    height: 170,
    borderRadius: 999,
    backgroundColor: "rgba(72,120,255,0.045)",
  },

  nav: {
    marginHorizontal: PAD,
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(8,14,24,0.72)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    overflow: "hidden",
  },

  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },

  navMid: { flex: 1 },
  navTitle: { color: "#FFFFFF", fontWeight: "800", fontSize: 16, letterSpacing: 0.1, lineHeight: 20 },
  navSub: { marginTop: 1, color: "rgba(255,255,255,0.40)", fontWeight: "500", fontSize: 10, lineHeight: 14 },

  saveBtn: {
    height: 36,
    borderRadius: 13,
    overflow: "hidden",
    minWidth: 62,
  },
  saveBtnFill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    shadowColor: GOLD,
    shadowOpacity: 0.32,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  saveBtnInnerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 13,
  },
  saveBtnOffFill: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(4,8,16,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  saveText: { color: "#0B0F17", fontWeight: "900", fontSize: 12 },
  saveTextOff: { color: "rgba(255,255,255,0.38)", fontWeight: "800", fontSize: 12 },

  form: {
    marginHorizontal: PAD,
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(8,14,24,0.55)",
    overflow: "hidden",
  },

  errText: { marginBottom: 8, color: "rgba(255,120,120,0.95)", fontWeight: "800", fontSize: 12 },
  label: {
    marginTop: 8,
    marginBottom: 5,
    color: LABEL_GOLD,
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  inputOuter: {
    position: "relative",
  },
  inputFocusGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
    shadowColor: GOLD,
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 18,
    paddingHorizontal: 13,
    minHeight: 52,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(4,10,20,0.72)",
    overflow: "hidden",
  },
  inputIconSlot: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  inputInnerShadow: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  inputWrapFocused: {
    borderColor: "rgba(217,179,95,0.48)",
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  input: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontWeight: "700",
    fontSize: 14,
    paddingVertical: 0,
  },

  row: { flexDirection: "row", gap: 10, marginTop: 2 },
  pill: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    overflow: "hidden",
  },
  pillFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    overflow: "hidden",
  },
  pillSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  pillFillMuted: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
    backgroundColor: "rgba(2,6,14,0.92)",
    borderRadius: 16,
  },
  pillText: { color: "rgba(255,255,255,0.52)", fontWeight: "800", fontSize: 13 },
  pillTextOnDark: { color: "#120D04", fontWeight: "900", fontSize: 13, letterSpacing: 0.2 },

  mediaAccessCard: {
    marginTop: 10,
    minHeight: 74,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  mediaAccessCardOn: {
    borderColor: "rgba(217,179,95,0.46)",
    shadowColor: GOLD,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  mediaAccessGlow: {
    position: "absolute",
    top: -12,
    left: 8,
    width: 72,
    height: 72,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  mediaAccessIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  mediaIconPulse: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "rgba(217,179,95,0.18)",
  },
  mediaAccessIconOn: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  mediaAccessBody: {
    flex: 1,
    paddingRight: 4,
    justifyContent: "center",
  },
  mediaAccessTitle: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "900",
  },
  mediaAccessTitleOn: {
    color: GOLD,
  },
  mediaAccessSub: {
    marginTop: 2,
    color: "rgba(255,255,255,0.48)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "500",
  },
  mediaAccessRight: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 5,
    paddingLeft: 4,
  },
  mediaStatusOff: {
    color: "rgba(255,255,255,0.32)",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.7,
  },
  mediaStatusOn: {
    color: GOLD,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  mediaToggle: {
    width: 50,
    height: 30,
    borderRadius: 999,
    padding: 2,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  mediaToggleOn: {
    backgroundColor: "rgba(217,179,95,0.42)",
    borderColor: "rgba(217,179,95,0.62)",
    alignItems: "flex-end",
  },
  mediaToggleKnob: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.82)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  mediaToggleKnobOn: {
    backgroundColor: "#FFF6DC",
  },

  pickRow: { flexDirection: "row", gap: 10, marginTop: 8 },
  pickBtn: {
    flex: 1,
    minHeight: 80,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "rgba(4,10,20,0.78)",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  pickBtnSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 32,
  },
  pickBtnInnerShadow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 24,
  },
  pickBtnInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  pickBtnIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.34)",
    marginBottom: 7,
  },
  pickBtnTextWrap: {
    alignItems: "center",
  },
  pickBtnText: { color: TEXT_PRIMARY, fontWeight: "900", fontSize: 13 },
  pickBtnCount: { marginTop: 3, color: "rgba(217,179,95,0.55)", fontWeight: "600", fontSize: 8, letterSpacing: 0.55 },

  hintMuted: {
    marginTop: 6,
    color: TEXT_SECONDARY,
    fontWeight: "700",
    fontSize: 10,
  },
  infoPill: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.04)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.06)",
  },
  infoPillText: {
    color: "rgba(255,255,255,0.38)",
    fontWeight: "500",
    fontSize: 8,
    letterSpacing: 0.12,
    lineHeight: 12,
  },

  builderCardOuter: {
    marginBottom: 10,
    borderRadius: 22,
    padding: 13,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    overflow: "hidden",
    shadowColor: GOLD,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  builderSweepClip: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    overflow: "hidden",
  },
  builderSweepTrack: {
    width: 120,
    height: 3,
  },
  builderSweepBand: {
    flex: 1,
  },
  builderSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 44,
  },
  builderGlow: {
    position: "absolute",
    top: -24,
    left: -8,
    width: 100,
    height: 100,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  builderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  builderTextCol: {
    flex: 1,
    paddingRight: 10,
  },
  builderIconRing: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  builderIconHaloOuter: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  builderIconHalo: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: "rgba(217,179,95,0.20)",
  },
  builderIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  builderTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.12,
  },
  builderSub: {
    marginTop: 3,
    color: TEXT_SECONDARY,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "500",
  },

  modalWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 22,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "#0A0E16",
  },
  modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  modalTitle: { color: TEXT_PRIMARY, fontWeight: "900", fontSize: 16 },
  xBtn: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 10,
  },
  memberRowSelected: {
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  memberRowLocked: {
    borderColor: "rgba(217,179,95,0.38)",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  memberAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarInitials: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 15,
  },
  memberMeta: { flex: 1, minWidth: 0 },
  roleBadge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
  },
  roleBadgeText: {
    color: "rgba(217,179,95,0.88)",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.2,
  },
  pastorBadge: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  },
  pastorBadgeText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 11,
    letterSpacing: 0.3,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(0,0,0,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: GOLD, borderColor: "rgba(217,179,95,0.72)" },
  checkLocked: { backgroundColor: GOLD, borderColor: "rgba(217,179,95,0.85)" },
  memberName: { color: TEXT_PRIMARY, fontWeight: "900", fontSize: 15 },
  memberId: { marginTop: 3, color: "rgba(217,179,95,0.62)", fontWeight: "700", fontSize: 12 },

  doneBtn: { marginTop: 6, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: GOLD },
  doneText: { color: "#0B0F17", fontWeight: "900" },

  successCard: {
    marginHorizontal: PAD,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
    backgroundColor: "#0A0E16",
    overflow: "hidden",
  },
  edge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: "rgba(217,179,95,0.55)" },
  successRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  successIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  successTitle: { color: TEXT_PRIMARY, fontWeight: "900", fontSize: 16 },
  successSub: { marginTop: 6, color: TEXT_SECONDARY, fontWeight: "700" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.10)", marginTop: 14, marginBottom: 14 },
  actions: { flexDirection: "row", gap: 10 },
  btnGhost: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  btnGhostText: { color: TEXT_PRIMARY, fontWeight: "900" },
  btnGold: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  btnGoldFill: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGoldTextDark: { color: "#0B0F17", fontWeight: "900" },
});
