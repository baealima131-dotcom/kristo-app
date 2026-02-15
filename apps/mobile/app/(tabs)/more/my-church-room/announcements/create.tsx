import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.03)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const PAD = 16;

export default function CreateAnnouncement() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const t = title.trim();
    if (!t) {
      setErr("Title is required");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      await apiPost(
        "/api/church/announcements",
        { title: t, body: body.trim() },
        { headers: getKristoHeaders() }
      );
      router.replace("/more/my-church-room/announcements" as any);
    } catch (e: any) {
      setErr(e?.message ? String(e.message) : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[s.screen, { paddingTop: insets.top + 10 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <Ionicons name="chevron-back" size={20} color={TEXT} />
        </Pressable>
        <Text style={t.title}>Create Announcement</Text>
      </View>

      <View style={{ padding: PAD, gap: 12 }}>
        <View style={s.card}>
          <Text style={t.label}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Example: Sunday Service"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={s.input}
          />
        </View>

        <View style={s.card}>
          <Text style={t.label}>Message</Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="Write announcement…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[s.input, { height: 120, textAlignVertical: "top" }]}
            multiline
          />
        </View>

        {err ? <Text style={t.err}>{err}</Text> : null}

        <Pressable onPress={submit} disabled={saving} style={[s.btn, saving ? { opacity: 0.7 } : null]}>
          <Text style={t.btnText}>{saving ? "Saving…" : "Publish"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG } as ViewStyle,
  header: { paddingHorizontal: PAD, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 10 } as ViewStyle,
  back: { width: 40, height: 40, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: BORDER } as ViewStyle,
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 22, padding: 14 } as ViewStyle,
  input: { marginTop: 8, color: TEXT, fontWeight: "800", fontSize: 14 } as any,
  btn: { marginTop: 6, height: 50, borderRadius: 20, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" } as ViewStyle,
});

const t = StyleSheet.create({
  title: { color: "white", fontWeight: "900", fontSize: 18, letterSpacing: 0.2 } as TextStyle,
  label: { color: SUB, fontWeight: "900", fontSize: 12, letterSpacing: 0.2 } as TextStyle,
  err: { marginTop: 6, color: "rgba(255,120,120,0.92)", fontWeight: "800", fontSize: 12 } as TextStyle,
  btnText: { color: "#0B0F17", fontWeight: "900", fontSize: 15, letterSpacing: 0.2 } as TextStyle,
});
