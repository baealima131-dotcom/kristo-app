import React, { useMemo, useState, useEffect } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View, Keyboard, ScrollView, TouchableWithoutFeedback } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { counselList, subscribe, counselAdd, counselToggleSave, type CounselItem } from "../../../../../src/lib/counselStore";

function dateKey(iso?: string) {
  if (!iso) return "Unknown";
  return String(iso).slice(0, 10);
}

function groupByDate<T extends { __date?: string }>(items: T[]) {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = dateKey(it.__date);
    const arr = map.get(k) || [];
    arr.push(it);
    map.set(k, arr);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export default function CounselScreen() {
  const [items, setItems] = useState(() => counselList());
  const KAV_OFFSET = 80;
  const [previewTab, setPreviewTab] = useState<"list" | "saved">("list");

  const minePreview = useMemo(() => items.filter((x: any) => x?.mine).slice(0, 6), [items]);
const savedPreview = useMemo(() => items.filter((x: any) => x?.saved).slice(0, 6), [items]);
const router = useRouter();

  useEffect(() => {
    const unsub = subscribe(() => setItems(counselList()));
    return unsub;
  }, []);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [posting, setPosting] = useState(false);

  const title = draftTitle.trim();
  const body = draftBody.trim();

  const canPost = useMemo(() => {
    return title.length >= 3 && body.length >= 40 && !posting;
  }, [title, body, posting]);

  async function post() {
    if (!canPost) return;
    setPosting(true);

    const item = {
      id: `csl_${Date.now()}`,
      kind: "counsel" as const,
      mine: true,
      saved: false,
      title: title.toUpperCase(),
      body,
      createdAt: new Date().toISOString(),
      actorLabel: "ANONYMOUS",
      churchLabel: "ANONYMOUS",
    };


    counselAdd(item as any);
    // ✅ post to BOTH feeds

    setDraftTitle("");
    setDraftBody("");
    router.replace("/(tabs)/more/my-church-room");
    setPosting(false);
  }

  const _all = items || [];
  const myAll = _all.filter((x) => x.mine);
  const savedAll = _all.filter((x) => x.saved);

  const previewMy = minePreview.map((x: any) => ({ ...x, __date: x.createdAt }));
  const previewSaved = savedPreview.map((x: any) => ({ ...x, __date: x.savedAt || x.createdAt }));

  const previewGroups = previewTab === "list" ? groupByDate(previewMy) : groupByDate(previewSaved);
return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={KAV_OFFSET}
          style={{ flex: 1 }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: 180 }}
          >
      <Stack.Screen options={{ title: "I Need Counsel", headerShown: false }} />
        <View style={styles.wrap}>
          <Text style={styles.h1}>I NEED COUNSEL</Text>
          <Text style={styles.sub}>Anonymous • A safe place to ask for counsel.</Text>

          <View style={styles.card}>
            <Text style={styles.label}>TITLE</Text>
            <TextInput
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="Example: I need counsel about my marriage..."
              placeholderTextColor="rgba(255,255,255,0.40)"
              style={styles.input}
              maxLength={75}
            />
            <View style={styles.row}>
              <Text style={styles.hint}>Max 75</Text>
              <Text style={styles.hint}>{title.length}/75</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>MESSAGE</Text>
            <TextInput
              value={draftBody}
              onChangeText={setDraftBody}
              placeholder="Write your message here (anonymous)..."
              placeholderTextColor="rgba(255,255,255,0.40)"
              style={[styles.input, styles.textarea]}
              multiline
              textAlignVertical="top"
              maxLength={3000}
            />
            <View style={styles.row}>
              <Text style={styles.hint}>Min 40</Text>
              <Text style={[styles.hint, body.length < 40 ? styles.danger : null]}>{body.length}/3000</Text>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={() => router.back()} style={styles.btnGhost}>
              <Text style={styles.btnGhostText}>Back</Text>
            </Pressable>

            <Pressable onPress={post} disabled={!canPost} style={[styles.btn, !canPost ? styles.btnDisabled : null]}>
              <Text style={styles.btnText}>{posting ? "Sharing..." : "Share"}</Text>
            </Pressable>
          </View>
          {/* Preview: List / Saved */}
          <View style={styles.previewCard}>
            <View style={styles.previewTop}>
              <Text style={styles.previewTitle}>Your Counsel</Text>
              <Pressable onPress={() => router.push("/more/my-church-room/counsel/library" as any)} style={styles.previewMoreBtn}>
                <Text style={styles.previewMoreText}>View more</Text>
              </Pressable>
            </View>

            <View style={styles.previewTabs}>
              <Pressable onPress={() => setPreviewTab("list")} style={[styles.previewTab, previewTab === "list" ? styles.previewTabOn : null]}>
                <Text style={[styles.previewTabText, previewTab === "list" ? styles.previewTabTextOn : null]}>List</Text>
              </Pressable>
              <Pressable onPress={() => setPreviewTab("saved")} style={[styles.previewTab, previewTab === "saved" ? styles.previewTabOn : null]}>
                <Text style={[styles.previewTabText, previewTab === "saved" ? styles.previewTabTextOn : null]}>Saved</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 10 }}>
              {previewGroups.length === 0 ? (
                <Text style={styles.previewEmpty}>No items yet.</Text>
              ) : (
                previewGroups.map(([d, arr]) => (
                  <View key={d} style={{ marginBottom: 12 }}>
                    <Text style={styles.previewDate}>{d}</Text>

                    <View style={styles.previewGrid}>
                      {arr.map((x) => (
                        <Pressable key={x.id} style={styles.previewCell} onPress={() => counselToggleSave(String(x.id))}>
                          <View style={styles.previewTile}>
                            <Text numberOfLines={2} style={styles.previewTileTitle}>
                              {x.title}
                            </Text>
                            <Text numberOfLines={3} style={styles.previewTileSub}>
                              {x.body}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* preview grid end */}</View>

          <View style={{ height: 24 }} />
        </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F17" },
  wrap: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  h1: { color: "rgba(217,179,95,0.95)", fontSize: 24, fontWeight: "800", letterSpacing: 2 },
  sub: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontSize: 14 },

  card: {
    marginTop: 14,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  label: { color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: "700", letterSpacing: 3 },
  input: {
    marginTop: 10,
    color: "rgba(255,255,255,0.92)",
    fontSize: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  textarea: { minHeight: 140 },

  row: { marginTop: 10, flexDirection: "row", justifyContent: "space-between" },
  hint: { color: "rgba(255,255,255,0.50)", fontSize: 12 },
  danger: { color: "rgba(255,90,90,0.95)", fontWeight: "700" },

  actions: { marginTop: 14, flexDirection: "row", gap: 10 },
  btn: {
    flex: 1,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "rgba(217,179,95,0.95)",
  },
  btnDisabled: { opacity: 0.35 },
  btnText: { color: "#0B0F17", fontSize: 16, fontWeight: "900" },

  btnGhost: {
    width: 110,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  btnGhostText: { color: "rgba(255,255,255,0.85)", fontSize: 14, fontWeight: "800" },

  previewCard: {
    marginTop: 12,
borderRadius: 18,
padding: 12,
backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  previewTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  previewTitle: { color: "rgba(255,255,255,0.90)", fontSize: 14, fontWeight: "900" },
  previewMoreBtn: {
    borderRadius: 12,
paddingVertical: 5,
paddingHorizontal: 10,
backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  previewMoreText: {
    color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 },

  previewTabs: { marginTop: 12, flexDirection: "row", gap: 10 },
  previewTab: {
    flex: 1,
    borderRadius: 14,
paddingVertical: 7,
alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  previewTabOn: { backgroundColor: "rgba(217,179,95,0.95)", borderColor: "rgba(0,0,0,0)" },
  previewTabText: {
    color: "rgba(255,255,255,0.85)", fontWeight: "900" },
  previewTabTextOn: { color: "#0B0F17" },

  previewGrid: { marginTop: 12, flexDirection: "row", flexWrap: "wrap" },
  previewCell: { width: "33.33%", paddingRight: 10, paddingBottom: 10 },
  previewTile: {
    borderRadius: 18,
    padding: 12,
    minHeight: 170,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  previewTileTitle: { color: "rgba(255,255,255,0.92)", fontWeight: "900", fontSize: 12 },
  previewTileSub: { marginTop: 8, color: "rgba(255,255,255,0.62)", fontSize: 10,
lineHeight: 15 },

  previewEmpty: { marginTop: 6, color: "rgba(255,255,255,0.55)" },

  previewDate: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 8,
  },
});
