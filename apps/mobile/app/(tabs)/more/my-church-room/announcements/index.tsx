import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, Image, KeyboardAvoidingView, Platform, StyleSheet, TouchableWithoutFeedback, Keyboard } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
const C = {
  bg: "#0B0F17",
  glass: "rgba(255,255,255,0.06)",
  glass2: "rgba(255,255,255,0.04)",
  border: "rgba(255,255,255,0.14)",
  borderSoft: "rgba(255,255,255,0.10)",
  gold: "rgba(217,179,95,0.95)",
  text: {
    primary: "rgba(255,255,255,0.96)",
    secondary: "rgba(255,255,255,0.72)",
    muted: "rgba(255,255,255,0.52)",
  },
  bad: "rgba(255,120,120,0.95)",
};
import { feedAdd as churchFeedAdd } from "@/src/lib/churchFeedStore";
import { feedAdd as homeFeedAdd } from "@/src/lib/homeFeedStore";
export default function AnnouncementsCreateOnly() {
  const HSpace = ({ w = 10 }: { w?: number }) => <View style={{ width: w }} />;
  const router = useRouter();
  // Post destination (HOME vs CHURCH)
  let postTarget = "church";
  async function onPostHome() {
    postTarget = "home";
    return post();
  }
  async function onPostChurch() {
    postTarget = "church";
    return post();
  }
  const [draftTitle, setDraftTitle] = useState("");

  // TITLE box: max 3 lines, then internal scroll (no layout push)
  const TITLE_LINE_H = 20; // approx for fontSize 14
  const TITLE_MAX_LINES = 3;
  const TITLE_PAD_V = 8; // keep in sync with styles.input paddingVertical
  const TITLE_MAX_H = TITLE_LINE_H * TITLE_MAX_LINES + TITLE_PAD_V * 2;
  const TITLE_MIN_H = TITLE_LINE_H * 1 + TITLE_PAD_V * 2;
  const [titleInputH, setTitleInputH] = useState(TITLE_MIN_H);

  const [draftBody, setDraftBody] = useState("");
  // MESSAGE box: max 5 lines, then internal scroll (no card growth)
  const BODY_LINE_H = 30;
  const BODY_MAX_LINES = 5;
  const BODY_PAD_V = 8; // keep in sync with styles.textArea paddingVertical
  const BODY_MAX_H = BODY_LINE_H * BODY_MAX_LINES + BODY_PAD_V * 2;
  const BODY_MIN_H = BODY_LINE_H * 2 + BODY_PAD_V * 2;
  const [bodyInputH, setBodyInputH] = useState(BODY_MIN_H);

  const [mediaUri, setMediaUri] = useState<string | undefined>(undefined);
  const [posting, setPosting] = useState(false);

  const MIN_BODY = 6;
  const MAX_BODY = 1000;
  const MAX_TITLE = 75;
  const bodyLen = draftBody.trim().length;
  const tooShort = bodyLen < MIN_BODY;
  const tooLong = bodyLen > MAX_BODY;
  const titleLen = draftTitle.trim().length;
  const titleTooLong = titleLen > MAX_TITLE;
  const titleOk = titleLen > 0 && !titleTooLong;

    const canPost = useMemo(() => {
    return titleOk && !tooShort && !tooLong && !posting;
  }, [titleOk, tooShort, tooLong, posting]);
  function addDemoImage() {
    setMediaUri("https://picsum.photos/900/700");
  }
  function clearMedia() {
    setMediaUri(undefined);
  }
  async function post() {
    if (!canPost) return;
    setPosting(true);
    const title = draftTitle.trim().toUpperCase();
    const body = draftBody.trim();
    (postTarget === "home" ? homeFeedAdd : churchFeedAdd)({
      id: `ann_${Date.now()}`,
      kind: "announcement",
      title,
      body,
      mediaUri,
      createdAt: new Date().toISOString(),
      actorLabel: "ADMIN",
      churchLabel: "TLMC",
    });
    setDraftTitle("");
    setDraftBody("");
    setMediaUri(undefined);
    router.replace(postTarget === "home" ? "/(tabs)" : "/(tabs)/church");
    setPosting(false);
  }
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: "Announcements", headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.wrap}>
            <View style={styles.hero}>
              <Text style={styles.hTitle}>ANNOUNCEMENTS</Text>
              <Text style={styles.hSub}>Admin Composer • Posts to Feed</Text>
            </View>
            <View style={styles.card}>
              <View style={styles.topRow}>
                <Text style={styles.topLeft}>ADMIN</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.topRight}>
                  {posting ? "POSTING…" : (titleTooLong || tooLong) ? "BLOCKED" : canPost ? "READY" : "DRAFT"}
                </Text>
              </View>
              <View style={styles.fieldShell}>
                <Text style={styles.fieldLabel}>TITLE</Text>
                <TextInput
                  value={draftTitle}
                  onChangeText={setDraftTitle}
                  placeholder="Mfano: Sunday Service"
                  placeholderTextColor={C.text.muted}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  onContentSizeChange={(e) => {
                    const h = e.nativeEvent.contentSize.height;
                    setTitleInputH(Math.max(TITLE_MIN_H, Math.min(h, TITLE_MAX_H)));
                  }}
                  style={[styles.input, { height: titleInputH, maxHeight: TITLE_MAX_H }]}
                  autoCapitalize="words"
                  returnKeyType="next"
                />

                <View style={styles.counterRow}>
                  <Text style={styles.maxText}>Max {MAX_TITLE}</Text>
                  <Text style={[styles.countText, titleTooLong ? styles.counterBad : styles.counterOk]}>
                    {titleLen}/{MAX_TITLE}
                  </Text>
                </View>
</View>
              <View style={styles.textAreaShell}>
                <Text style={styles.fieldLabel}>MESSAGE</Text>
                <TextInput
                  value={draftBody}
                  onChangeText={setDraftBody}
                  placeholder="Andika tangazo hapa..."
                  placeholderTextColor={C.text.muted}
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  onContentSizeChange={(e) => {
                    const h = e.nativeEvent.contentSize.height;
                    setBodyInputH(Math.max(BODY_MIN_H, Math.min(h, BODY_MAX_H)));
                  }}
                  style={[styles.textArea, { height: bodyInputH, maxHeight: BODY_MAX_H }]}
                />
                <View style={styles.counterRow}>
                  <Text style={styles.maxText}>Min {MIN_BODY}</Text>
                  <Text style={[styles.countText, (tooShort || tooLong) ? styles.counterBad : styles.counterOk]}>
                    {bodyLen}/{MAX_BODY}
                  </Text>
                </View>
              </View>
              {/* Media row (compact). Preview ONLY when image exists */}
              <View style={styles.imageRow}>
                <View style={styles.imageRowLeft}>
                  <Text style={styles.imageRowIcon}>📷</Text>
                  <Text numberOfLines={1} style={styles.imageRowText}>
                    {mediaUri ? "Image selected" : "Add image"}
                  </Text>
                </View>
                <Text style={[styles.imageRowCount, (tooShort || tooLong) ? styles.counterBad : styles.counterOk]}>{mediaUri ? "1" : "0"}</Text>
              </View>
              <View style={styles.btnRow}>
                <Pressable onPress={addDemoImage} style={styles.addImgBtn}>
                  <Text style={styles.addImgPlus}>＋</Text>
                  <Text style={styles.addImgText}>Add image</Text>
                </Pressable>
                <HSpace w={10} />
                <View style={styles.postPair}>
                  <Pressable
                    disabled={!canPost}
                    onPress={onPostHome}
                    style={[styles.postAction, !canPost ? styles.postActionDisabled : null]}
                  >
                    <Text style={styles.postGlyph}>◀</Text>
                    <Text style={styles.postLabel}>Post</Text>
                    <Text style={styles.postDest}>🌍</Text>
                  </Pressable>
                  <HSpace w={10} />
                  <Pressable
                    disabled={!canPost}
                    onPress={onPostChurch}
                    style={[styles.postAction, !canPost ? styles.postActionDisabled : null]}
                  >
                    <Text style={styles.postDest}>⛪</Text>
                    <Text style={styles.postLabel}>Post</Text>
                    <Text style={styles.postGlyph}>▶</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {/* Spacer kuhakikisha tab bar haifichi content */}
            <View style={{ height: 96 }} />
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  // paddingBottom kubwa kidogo ili tab bar isifiche buttons
  wrap: { flex: 1, paddingHorizontal: 14, paddingTop: 10 },
  hero: { paddingVertical: 2, paddingHorizontal: 2 },
  hTitle: { color: C.gold, letterSpacing: 6, fontWeight: "900", fontSize: 15 },
  hSub: { marginTop: 6, color: C.text.secondary, fontWeight: "800" },
  card: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glass2,
    padding: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  topLeft: { color: C.gold, fontWeight: "900", letterSpacing: 3 },
  topRight: { color: C.text.secondary, fontWeight: "900", letterSpacing: 2 },
  fieldShell: {
    marginTop: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glass,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fieldLabel: { color: C.text.muted, fontWeight: "900", letterSpacing: 2, fontSize: 12, marginBottom: 8 },
  input: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "900",
    color: C.text.primary,
    paddingVertical: 8,
    paddingHorizontal: 2,
    textAlignVertical: "top",
  },
  textAreaShell: {
    marginTop: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.glass2,
    padding: 12,
  },
  textArea: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "900",
    color: C.text.primary,
    paddingVertical: 8,
    paddingHorizontal: 2,
    textAlignVertical: "top",
  },
  counterRow: { marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  maxText: { color: C.text.muted, fontWeight: "800", fontSize: 15 },
  countText: { color: C.text.muted, fontWeight: "900", fontSize: 15 },
  countBad: { color: C.bad },
  imageRow: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: "rgba(255,255,255,0.02)",
    paddingHorizontal: 14,
    height: 42,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  imageRowLeft: { flexDirection: "row", alignItems: "center", minWidth: 0, flex: 1 },
  imageRowIcon: { marginRight: 10, fontSize: 16, color: C.text.secondary },
  thumb: { width: 28, height: 28, borderRadius: 8, marginRight: 10, opacity: 0.95 },
imageRowText: { color: C.text.secondary, fontWeight: "800", fontSize: 16, flex: 1 },
  imageRowCount: { color: C.text.muted, fontWeight: "900", fontSize: 16, marginLeft: 10 },
  counterOk: { color: "rgba(255,255,255,0.40)", fontWeight: "900" },
  counterBad: { color: "rgba(255,90,90,0.95)", fontWeight: "900" },
  mediaWrap: {
    marginTop: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    overflow: "hidden",
    backgroundColor: C.glass,
  },
  media: { width: "100%", height: 180 },
btnRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",

  },
postPair: {
    flex: 1,
    flexDirection: "row",

  },
postAction: {
    flex: 1,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",

  },
postActionDisabled: {
    opacity: 0.45,
    borderColor: C.borderSoft,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
postGlyph: {
    color: C.text.secondary,
    fontWeight: "900",
  },
postDest: {
    color: C.gold,
    fontWeight: "900",
  },
postLabel: {
    color: C.text.primary,
    fontWeight: "900",
    letterSpacing: 1,
  },
addImgBtn: {
    height: 54,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",

  },
addImgPlus: {
    color: C.gold,
    fontWeight: "900",
    fontSize: 18,
    marginTop: -1,
  },
addImgText: {
    color: C.text.secondary,
    fontWeight: "900",
    letterSpacing: 1,
  },
  ghostBtn: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: "rgba(255,255,255,0.02)",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBtnDisabled: { opacity: 0.5 },
  ghostBtnText: { color: C.text.secondary, fontWeight: "900", fontSize: 15 },
  ghostBtnTextDisabled: { color: C.text.muted },
  postBtn: {
    marginLeft: "auto",
    height: 46,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.60)",
    backgroundColor: "rgba(217,179,95,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  postBtnDisabled: { opacity: 0.45 },
  postBtnText: { color: C.gold, fontWeight: "900", letterSpacing: 3, fontSize: 15 },
});