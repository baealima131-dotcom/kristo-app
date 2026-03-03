import React, { useMemo, useState } from "react";
import { useRouter, Href } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import type { KristoRole } from "@/src/lib/kristoSession";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.65)";
const BORDER = "rgba(255,255,255,0.10)";

const ROLES: KristoRole[] = ["Member", "Leader", "Ministry_Leader", "Pastor", "Church_Admin", "System_Admin"];

export default function LoginScreen() {
  const router = useRouter();
  const { setSession } = useKristoSession();

  const [userId, setUserId] = useState("u-demo-1");
  const [churchId, setChurchId] = useState("c-demo-1");
  const [role, setRole] = useState<KristoRole>("Member");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const can = useMemo(() => {
    return userId.trim().length >= 3 && !saving;
  }, [userId, saving]);

  async function onLogin() {
    if (!can) return;
    setErr(null);
    setSaving(true);
    try {
      await setSession({
        userId: userId.trim(),
        role,
        churchId: churchId.trim(), // can be ""
      });
      router.replace("/(tabs)");
    } catch (e: any) {
      setErr("Login failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Kristo</Text>
      <Text style={s.sub}>Login (dev)</Text>

      {!!err && <Text style={s.err}>{err}</Text>}

      <View style={s.card}>
        <Text style={s.label}>User ID</Text>
        <TextInput
          value={userId}
          onChangeText={setUserId}
          autoCapitalize="none"
          placeholder="u-demo-1"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <Text style={[s.label, { marginTop: 12 }]}>Church ID (optional)</Text>
        <TextInput
          value={churchId}
          onChangeText={setChurchId}
          autoCapitalize="none"
          placeholder="c-demo-1"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <Text style={[s.label, { marginTop: 12 }]}>Role</Text>
        <View style={s.rolesRow}>
          {ROLES.map((r) => {
            const active = r === role;
            return (
              <Pressable key={r} onPress={() => setRole(r)} style={[s.pill, active && s.pillOn]}>
                <Text style={[s.pillText, active && s.pillTextOn]}>{r}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable onPress={onLogin} disabled={!can} style={[s.btn, !can && { opacity: 0.5 }]}>
          <Text style={s.btnText}>{saving ? "..." : "Login"}</Text>
        </Pressable>

        <Pressable onPress={() => router.push("/(auth)/signup" as Href)} style={s.linkBtn}>
          <Text style={s.linkText}>Create account (Sign up)</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, padding: 16, paddingTop: 52 },
  title: { color: "white", fontSize: 28, fontWeight: "900", letterSpacing: 0.5 },
  sub: { color: MUTED, marginTop: 6, fontWeight: "700" },
  err: { color: "#ff7b7b", marginTop: 14, fontWeight: "800" },

  card: { marginTop: 18, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.03)" },
  label: { color: MUTED, fontWeight: "800", fontSize: 12, letterSpacing: 0.4 },
  input: { marginTop: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: "white", fontWeight: "800" },

  rolesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  pill: { borderWidth: 1, borderColor: BORDER, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.02)" },
  pillOn: { borderColor: "rgba(217,179,95,0.55)", backgroundColor: "rgba(217,179,95,0.12)" },
  pillText: { color: MUTED, fontWeight: "800", fontSize: 12 },
  pillTextOn: { color: GOLD },

  btn: { marginTop: 14, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(217,179,95,0.18)", borderWidth: 1, borderColor: "rgba(217,179,95,0.35)" },
  btnText: { color: GOLD, fontWeight: "900", letterSpacing: 0.2 },

  linkBtn: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  linkText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },
});
