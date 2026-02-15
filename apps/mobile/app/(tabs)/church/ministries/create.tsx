import React, { useEffect, useMemo, useRef, useState } from "react";
import {
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

type MinistryStatus = "Active" | "Paused";
type Ministry = {
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

async function apiCreateMinistry(body: { name: string; description?: string; status?: MinistryStatus }) {
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
      });
      setCreated(data);

      // Assign leaders/members (best effort)
      try {
        for (const uid of pickedLeaderIds) {
          await apiPost(
            "/api/church/ministry-members",
            { ministryId: data.id, userId: uid, role: "Leader" },
            { headers: getKristoHeaders() }
          );
        }
        for (const uid of pickedMemberIds.filter((x) => !pickedLeaderIds.includes(x))) {
          await apiPost(
            "/api/church/ministry-members",
            { ministryId: data.id, userId: uid, role: "Member" },
            { headers: getKristoHeaders() }
          );
        }
      } catch {}
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
            <Text style={s.navSub}>Add a new ministry to your church.</Text>
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

                <Text style={s.label}>Name</Text>
                <TextInput
                  ref={nameRef}
                  value={name}
                  onChangeText={setName}
                  placeholder="Ministry name"
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
                  placeholder="Optional"
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

                {/* Admin pickers */}
                <View style={s.pickRow}>
                  <Pressable onPress={() => setPicker("leaders")} style={({ pressed }) => [s.pickBtn, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="star" size={16} color={GOLD} />
                    <Text style={s.pickBtnText}>Pick leaders ({pickedLeaderIds.length})</Text>
                  </Pressable>

                  <Pressable onPress={() => setPicker("members")} style={({ pressed }) => [s.pickBtn, pressed && { opacity: 0.85 }]}>
                    <Ionicons name="people" size={16} color={GOLD} />
                    <Text style={s.pickBtnText}>Pick members ({pickedMemberIds.length})</Text>
                  </Pressable>
                </View>

                {members.length === 0 ? (
                  <Text style={s.hint}>No church members loaded yet (optional).</Text>
                ) : (
                  <Text style={s.hint}>Tip: Leaders automatically become members too.</Text>
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
    marginTop: 10,
    marginBottom: 14,
    padding: 16,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  navMid: { flex: 1, marginLeft: 10 },
  navTitle: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 },
  navSub: { marginTop: 6, color: "rgba(255,255,255,0.66)", fontWeight: "750", fontSize: 13 },

  saveBtn: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.40)",
  },
  saveText: { color: GOLD, fontWeight: "900" },

  form: {
    marginHorizontal: PAD,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },

  errText: { marginBottom: 10, color: "rgba(255,120,120,0.95)", fontWeight: "900" },
  label: { marginTop: 4, color: "rgba(255,255,255,0.80)", fontWeight: "800" },

  input: {
    marginTop: 10,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
    color: "white",
    fontWeight: "800",
  },

  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  pill: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  pillOn: { borderColor: "rgba(217,179,95,0.45)", backgroundColor: "rgba(217,179,95,0.10)" },
  pillText: { color: "rgba(255,255,255,0.80)", fontWeight: "800" },
  pillTextOn: { color: GOLD, fontWeight: "900" },

  pickRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  pickBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  pickBtnText: { color: "rgba(255,255,255,0.90)", fontWeight: "900" },
  hint: { marginTop: 10, color: "rgba(255,255,255,0.55)", fontWeight: "750" },

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
