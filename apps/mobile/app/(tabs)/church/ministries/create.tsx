import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
ActivityIndicator,
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
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { isSubscriptionBypassEnabled } from "@/src/lib/subscriptionBypass";

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
const GOLD = "rgba(217,179,95,0.95)";
const VIP_BG = "#0B0F17";

async function apiCreateMinistry(body: { name: string; description?: string; status?: MinistryStatus; mediaAccess?: boolean }) {
  const res = await apiPost<any>("/api/church/ministries", body, { headers: getKristoHeaders() });
  if (!res) throw new Error("Network error");
  if (!res.ok) throw new Error(res.error || "Create failed");
  return res.data as Ministry;
}

function humanErr(e: any) {
  const msg = String(e?.message ?? e ?? "Error");
  const t = msg.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const j = JSON.parse(t);
      if (j?.error) return String(j.error);
    } catch {}
  }
  return msg;
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

  const [members, setMembers] = useState<Array<{ userId: string; name?: string }>>([]);
  const [picker, setPicker] = useState<null | PickerKind>(null);
  const [pickedMemberIds, setPickedMemberIds] = useState<string[]>([]);
  const [pickedLeaderIds, setPickedLeaderIds] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<Ministry | null>(null);

  // Load church members for pickers
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiGet<any>("/api/church/members?all=1", { headers: getKristoHeaders() });
        if (!alive) return;
        if (res?.ok && Array.isArray(res.data)) {
          const list = res.data
            .map((m: any) => ({
              userId: m.userId || m.id || m.memberId,
              name: m.name || m.fullName || m.displayName || m.email,
            }))
            .filter((x: any) => Boolean(x.userId));
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
      const uniqueLeaders = Array.from(new Set(pickedLeaderIds));
      const uniqueMembers = Array.from(new Set(pickedMemberIds.filter((x) => !uniqueLeaders.includes(x))));

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
      setErr(humanErr(e));
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
    setPickedMemberIds([]);
    setPickedLeaderIds([]);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function togglePick(kind: PickerKind, userId: string) {
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
    <Pressable style={s.screen} onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={{ flex: 1, paddingTop: insets.top }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
      >
        <View style={s.topBar} />
        <View style={s.navGlow} />

        {/* NAV */}
        <View style={s.nav}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.88)" />
          </Pressable>

          <View style={s.navMid}>
            <Text style={s.navTitle}>Create Ministry</Text>
            <Text style={s.navSub}>Build a ministry room with leaders, members, and media access.</Text>
          </View>

          <Pressable
            disabled={!canSave}
            onPress={onSave}
            style={({ pressed }) => [s.saveBtn, !canSave && { opacity: 0.4 }, pressed && canSave && { transform: [{ scale: 0.99 }] }]}
          >
            {saving ? <ActivityIndicator /> : <Text style={s.saveText}>Save</Text>}
          </Pressable>
        </View>

        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 28 }}
          showsVerticalScrollIndicator={false}
        >
          {/* SUCCESS */}
          {created ? (
            <View style={s.successCard}>
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
                <Pressable onPress={resetForm} style={({ pressed }) => [s.btnGhost, pressed && { opacity: 0.85 }]}>
                  <Text style={s.btnGhostText}>Create another</Text>
                </Pressable>

                <Pressable
                  onPress={() => router.push("/church/ministries" as any)}
                  style={({ pressed }) => [s.btnGold, pressed && { transform: [{ scale: 0.99 }] }]}
                >
                  <Text style={s.btnGoldText}>Open list</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <View style={s.form}>
                {err ? <Text style={s.errText}>{err}</Text> : null}

                <View style={s.builderCard}>
                  <View style={s.builderIcon}>
                    <Ionicons name="sparkles" size={22} color="#0B0F17" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.builderTitle}>Ministry Builder</Text>
                    <Text style={s.builderSub}>Create the room, choose leaders, add members, then turn on media if this ministry will host live schedules.</Text>
                  </View>
                </View>

                <Text style={s.label}>Name</Text>
                <TextInput
                  ref={nameRef}
                  value={name}
                  onChangeText={setName}
                  placeholder="Example: Choir, Youth, Ushauri"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.input}
                  returnKeyType="next"
                  onSubmitEditing={() => Keyboard.dismiss()}
                />

                <View style={{ height: 14 }} />

                <Text style={s.label}>Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Short purpose or description"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.input}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                />

                <View style={{ height: 16 }} />

                <Text style={s.label}>Status</Text>
                <View style={s.row}>
                  <Pressable onPress={() => setStatus("Active")} style={({ pressed }) => [s.pill, status === "Active" && s.pillOn, pressed && { opacity: 0.9 }]}>
                    <Text style={[s.pillText, status === "Active" && s.pillTextOn]}>Active</Text>
                  </Pressable>

                  <Pressable onPress={() => setStatus("Paused")} style={({ pressed }) => [s.pill, status === "Paused" && s.pillOn, pressed && { opacity: 0.9 }]}>
                    <Text style={[s.pillText, status === "Paused" && s.pillTextOn]}>Paused</Text>
                  </Pressable>
                </View>

                <View style={{ height: 16 }} />

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
                    pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                  ]}
                >
                  <View style={[s.mediaAccessIcon, mediaAccess && s.mediaAccessIconOn]}>
                    <Ionicons
                      name={mediaAccess ? "videocam" : "videocam-outline"}
                      size={18}
                      color={mediaAccess ? "#0B0F17" : GOLD}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.mediaAccessTitle}>Media Access</Text>
                    <Text style={s.mediaAccessSub}>
                      Allow this ministry to create media schedules, hosts, and live planning cards.
                    </Text>
                  </View>
                  <View style={[s.mediaAccessCheck, mediaAccess && s.mediaAccessCheckOn]}>
                    {mediaAccess ? <Ionicons name="checkmark" size={14} color="#0B0F17" /> : null}
                  </View>
                </Pressable>

                <View style={{ height: 16 }} />

                {/* Admin pickers */}
                <View style={s.pickRow}>
                  <Pressable onPress={() => setPicker("leaders")} style={({ pressed }) => [s.pickBtn, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="star" size={16} color={GOLD} />
                    <Text style={s.pickBtnText}>Leaders ({pickedLeaderIds.length})</Text>
                  </Pressable>

                  <Pressable onPress={() => setPicker("members")} style={({ pressed }) => [s.pickBtn, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="people" size={16} color={GOLD} />
                    <Text style={s.pickBtnText}>Members ({pickedMemberIds.length})</Text>
                  </Pressable>
                </View>

                {members.length === 0 ? (
                  <Text style={s.hint}>No church members loaded yet (optional).</Text>
                ) : (
                  <Text style={s.hint}>Leaders automatically become members too.</Text>
                )}
              </View>

              {/* Picker modal */}
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
                      {members.map((m) => {
                        const checked = picker === "leaders" ? pickedLeaderIds.includes(m.userId) : pickedMemberIds.includes(m.userId);
                        return (
                          <Pressable
                            key={m.userId}
                            onPress={() => togglePick(picker, m.userId)}
                            style={({ pressed }) => [s.memberRow, pressed && { opacity: 0.88 }]}
                          >
                            <View style={[s.check, checked && s.checkOn]}>
                              {checked ? <Ionicons name="checkmark" size={14} color="#0B0F17" /> : null}
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={s.memberName} numberOfLines={1}>
                                {m.name || m.userId}
                              </Text>
                              <Text style={s.memberId} numberOfLines={1}>
                                {m.userId}
                              </Text>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },

  mediaAccessCard: {
    minHeight: 84,
    borderRadius: 24,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.3,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.095)",
  },
  mediaAccessCardOn: {
    borderColor: "rgba(217,179,95,0.70)",
    backgroundColor: "rgba(217,179,95,0.18)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 10 },
  },
  mediaAccessIcon: {
    width: 36,
    height: 36,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  mediaAccessIconOn: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },
  mediaAccessTitle: {
    color: "white",
    fontSize: 13,
    fontWeight: "950",
  },
  mediaAccessSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.66)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "750",
  },
  mediaAccessCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  mediaAccessCheckOn: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 36,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  navGlow: {
    position: "absolute",
    left: PAD,
    right: PAD,
    top: 6,
    height: 110,
    borderRadius: 26,
    backgroundColor: "rgba(217,179,95,0.06)",
  },

  nav: {
    marginHorizontal: PAD,
    marginTop: 8,
    marginBottom: 13,
    padding: 14,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.065)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  navMid: { flex: 1, marginLeft: 10 },
  navTitle: { color: "white", fontWeight: "900", fontSize: 15, letterSpacing: 0.2 },
  navSub: { marginTop: 4, color: "rgba(255,255,255,0.66)", fontWeight: "750", fontSize: 11, lineHeight: 15 },

  saveBtn: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.22)",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.55)",
  },
  saveText: { color: "#0B0F17", fontWeight: "950", fontSize: 14 },

  form: {
    marginHorizontal: PAD,
    borderRadius: 26,
    padding: 15,
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },

  errText: { marginBottom: 10, color: "rgba(255,120,120,0.95)", fontWeight: "900" },
  label: { marginTop: 6, marginLeft: 2, color: "rgba(255,255,255,0.86)", fontWeight: "950", fontSize: 14 },

  input: {
    marginTop: 8,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(255,255,255,0.06)",
    color: "white",
    fontWeight: "900",
    fontSize: 13,
  },

  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  pill: {
    flex: 1,
    borderRadius: 15,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  pillOn: {
    borderColor: "rgba(217,179,95,0.75)",
    backgroundColor: "rgba(217,179,95,0.18)",
  },
  pillText: { color: "rgba(255,255,255,0.80)", fontWeight: "800" },
  pillTextOn: { color: GOLD, fontWeight: "900" },

  pickRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  pickBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 20,
    paddingVertical: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.56)",
    backgroundColor: "rgba(217,179,95,0.16)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
  },
  pickBtnText: { color: "rgba(255,255,255,0.94)", fontWeight: "950", fontSize: 13 },
  hint: {
    marginTop: 12,
    color: "rgba(255,255,255,0.58)",
    fontWeight: "800",
    fontSize: 11,
    letterSpacing: 0.2,
  },


  builderCard: {
    marginBottom: 18,
    minHeight: 110,
    borderRadius: 26,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.65)",
    backgroundColor: "rgba(217,179,95,0.10)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
  },
  builderIcon: {
    width: 48,
    height: 48,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  builderTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "950",
  },
  builderSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "750",
  },

  // modal
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
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#0A0E16",
  },
  modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  modalTitle: { color: "white", fontWeight: "900", fontSize: 16 },
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
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.02)",
    marginBottom: 8,
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
  checkOn: { backgroundColor: GOLD, borderColor: "rgba(217,179,95,0.55)" },
  memberName: { color: "rgba(255,255,255,0.92)", fontWeight: "900" },
  memberId: { marginTop: 2, color: "rgba(255,255,255,0.55)", fontWeight: "750", fontSize: 12 },

  doneBtn: { marginTop: 6, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: GOLD },
  doneText: { color: "#0B0F17", fontWeight: "900" },

  // success
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
  successTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  successSub: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "800" },
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
  btnGhostText: { color: "rgba(255,255,255,0.85)", fontWeight: "900" },
  btnGold: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
  },
  btnGoldText: { color: GOLD, fontWeight: "900" },
});
