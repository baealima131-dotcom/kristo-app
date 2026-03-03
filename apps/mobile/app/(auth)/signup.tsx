import React, { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.65)";
const BORDER = "rgba(255,255,255,0.10)";

function makeUserId() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function SignupScreen() {
  const router = useRouter();
  const { setSession } = useKristoSession();

  const [name, setName] = useState("");
  const [userId, setUserId] = useState(makeUserId());
  const [saving, setSaving] = useState(false);

  const can = useMemo(() => userId.trim().length >= 3 && !saving, [userId, saving]);

  async function onCreate() {
    if (!can) return;
    setSaving(true);
    try {
      await setSession({
        userId: userId.trim(),
        role: "Member",
        churchId: "",
      });
      router.replace("/(tabs)");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Sign up</Text>
      <Text style={s.sub}>Create account (dev)</Text>

      <View style={s.card}>
        <Text style={s.label}>Display name (optional)</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Prince Fariji"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <Text style={[s.label, { marginTop: 12 }]}>User ID</Text>
        <TextInput
          value={userId}
          onChangeText={setUserId}
          autoCapitalize="none"
          placeholder="u_..."
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <Pressable onPress={() => setUserId(makeUserId())} style={s.ghost}>
          <Text style={s.ghostText}>Generate new ID</Text>
        </Pressable>

        <Pressable onPress={onCreate} disabled={!can} style={[s.btn, !can && { opacity: 0.5 }]}>
          <Text style={s.btnText}>{saving ? "..." : "Create & Continue"}</Text>
        </Pressable>

        <Pressable onPress={() => router.replace("/(auth)/login")} style={s.linkBtn}>
          <Text style={s.linkText}>Back to Login</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, padding: 16, paddingTop: 52 },
  title: { color: "white", fontSize: 26, fontWeight: "900" },
  sub: { color: MUTED, marginTop: 6, fontWeight: "700" },
  card: { marginTop: 18, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 14, backgroundColor: "rgba(255,255,255,0.03)" },
  label: { color: MUTED, fontWeight: "800", fontSize: 12, letterSpacing: 0.4 },
  input: { marginTop: 8, borderWidth: 1, borderColor: BORDER, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, color: "white", fontWeight: "800" },

  ghost: { marginTop: 10, alignItems: "center", paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: "rgba(255,255,255,0.02)" },
  ghostText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  btn: { marginTop: 14, borderRadius: 16, paddingVertical: 12, alignItems: "center", backgroundColor: "rgba(217,179,95,0.18)", borderWidth: 1, borderColor: "rgba(217,179,95,0.35)" },
  btnText: { color: GOLD, fontWeight: "900" },

  linkBtn: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  linkText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },
});
