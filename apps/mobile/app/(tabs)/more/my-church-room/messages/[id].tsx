import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { ensureThread, sendMessage, deleteMessage, useThread, type MsgAttachment, type MsgItem } from "@/src/lib/messagesStore";

const BG = "#0B0F17";
const TEXT = "rgba(255,255,255,0.94)";
const GOLD = "rgba(217,179,95,0.92)";
const PAD = 16;
function initials(name: string) {
  const s = (name || "?").trim();
  return (s[0] || "?").toUpperCase();
}

function formatTime(ts: number) {
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch {
    return "";
  }
}

function Bubble({ m, onLongPress }: { m: MsgItem; onLongPress: () => void }) {
  const mine = m.sender === "me";
  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={280}
      style={[
        s.bubbleWrap,
        mine ? ({ alignSelf: "flex-end" } as ViewStyle) : ({ alignSelf: "flex-start" } as ViewStyle),
      ]}
    >
      <View style={[s.bubble, mine ? s.bubbleMine : s.bubbleOther]}>
        {!mine ? (
          <View style={s.bubbleTop}>
            <View style={s.avatarMini}>
              <Text style={t.avatarMiniText}>{initials(m.displayName || "U")}</Text>
            </View>
            <Text style={t.senderName} numberOfLines={1}>
              {m.displayName || "User"}
            </Text>
          </View>
        ) : null}

        {m.text ? <Text style={t.msgText}>{m.text}</Text> : null}

        {m.attachments?.length ? (
          <View style={s.attachBlock}>
            {m.attachments.map((a) => (
              <View key={a.id} style={s.attachRow}>
                <Ionicons name={a.kind === "image" ? "image" : "document"} size={16} color="rgba(255,255,255,0.70)" />
                <Text style={t.attachName} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={t.attachMeta} numberOfLines={1}>
                  {a.kind.toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={t.msgTime}>{formatTime(m.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

export default function MessageThreadScreen() {
  const insets = useSafeAreaInsets();
  const tabBarH = useBottomTabBarHeight();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; title?: string; sub?: string }>();

  const threadId = String(params.id || "");
  const title = String(params.title || "Messages");
  const sub = String(params.sub || "Chat");

  useEffect(() => {
    if (!threadId) return;
    ensureThread(threadId, { title, sub });
  }, [threadId, title, sub]);

  const { messages } = useThread(threadId);

  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<MsgAttachment[]>([]);
  const listRef = useRef<FlatList<MsgItem> | null>(null);

  const canSend = draft.trim().length > 0 || pending.length > 0;
  const headerTitle = useMemo(() => title || "Messages", [title]);

  async function pickImage() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow Photos access to attach images.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        allowsMultipleSelection: false,
      });
      if (res.canceled) return;
      const a = res.assets?.[0];
      if (!a?.uri) return;

      const name = a.fileName || `image_${Date.now()}.jpg`;
      setPending((p) => [
        ...p,
        { id: `att_${Date.now()}_${Math.random().toString(16).slice(2)}`, kind: "image", uri: a.uri, name, mime: a.mimeType || "image/jpeg" },
      ]);
    } catch (e: any) {
      Alert.alert("Failed", e?.message ? String(e.message) : "Could not pick image");
    }
  }

  async function pickFile() {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (res.canceled) return;
      const f = res.assets?.[0];
      if (!f?.uri) return;

      setPending((p) => [
        ...p,
        {
          id: `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          kind: "file",
          uri: f.uri,
          name: f.name || `file_${Date.now()}`,
          mime: f.mimeType || "application/octet-stream",
          size: typeof f.size === "number" ? f.size : undefined,
        },
      ]);
    } catch (e: any) {
      Alert.alert("Failed", e?.message ? String(e.message) : "Could not pick file");
    }
  }

  function removePending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
  }

  function onSend() {
    if (!threadId) return;
    if (!canSend) return;

    sendMessage(threadId, { text: draft.trim(), attachments: pending });

    setDraft("");
    setPending([]);

    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 10);
  }

  function confirmDelete(m: MsgItem) {
    Alert.alert("Delete message?", "This will remove it from this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMessage(threadId, m.id) },
    ]);
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10, paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
          <Ionicons name="chevron-back" size={18} color={TEXT} />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={t.hTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
          <Text style={t.hSub} numberOfLines={1}>
            {sub}
          </Text>
        </View>

        <Pressable onPress={() => {}} style={({ pressed }) => [s.hBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
          <Ionicons name="ellipsis-horizontal" size={18} color={GOLD} />
        </Pressable>
      </View>

      {/* Frame */}
      <View style={s.frame}>
        <FlatList
          ref={(r) => { listRef.current = r; }}
          data={messages}
          inverted
          keyExtractor={(m) => m.id}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: 10 }}
          renderItem={({ item }) => <Bubble m={item} onLongPress={() => confirmDelete(item)} />}
          ListEmptyComponent={
            <View style={{ padding: 18 }}>
              <Text style={t.emptyTitle}>No messages</Text>
              <Text style={t.emptySub}>Send the first message.</Text>
            </View>
          }
        />
      </View>

      {/* Composer */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
        {pending.length ? (
          <View style={s.pendingBar}>
            <Text style={t.pendingTitle}>Attachments</Text>
            <View style={s.pendingList}>
              {pending.map((a) => (
                <Pressable key={a.id} onPress={() => removePending(a.id)} style={({ pressed }) => [s.pendingPill, pressed ? ({ opacity: 0.9 } as ViewStyle) : null]}>
                  <Ionicons name={a.kind === "image" ? "image" : "document"} size={14} color="rgba(255,255,255,0.75)" />
                  <Text style={t.pendingName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Ionicons name="close" size={14} color="rgba(255,255,255,0.55)" />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={[s.composer, { marginBottom: tabBarH + 8 }]}>
          <Pressable onPress={pickImage} style={({ pressed }) => [s.cBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
            <Ionicons name="image" size={18} color={GOLD} />
          </Pressable>

          <Pressable onPress={pickFile} style={({ pressed }) => [s.cBtn, pressed ? ({ opacity: 0.85 } as ViewStyle) : null]}>
            <Ionicons name="attach" size={18} color={GOLD} />
          </Pressable>

          <View style={s.inputWrap}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a message..."
              placeholderTextColor="rgba(255,255,255,0.45)"
              style={t.input}
              multiline
              autoCorrect
            />
          </View>

          <Pressable
            onPress={onSend}
            disabled={!canSend}
            style={({ pressed }) => [
              s.sendBtn,
              !canSend ? s.sendBtnDisabled : null,
              pressed && canSend ? ({ transform: [{ scale: 0.99 }], opacity: 0.95 } as ViewStyle) : null,
            ]}
          >
            <Ionicons name="send" size={16} color={canSend ? "#0B0F17" : "rgba(255,255,255,0.30)"} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG, paddingHorizontal: PAD } as ViewStyle,

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 2,
    paddingBottom: 10,
  } as ViewStyle,
  hBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginRight: 10,
  } as ViewStyle,

  frame: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  } as ViewStyle,

  bubbleWrap: { marginBottom: 10, maxWidth: "86%" } as ViewStyle,
  bubble: { borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 } as ViewStyle,
  bubbleMine: { backgroundColor: "rgba(217,179,95,0.10)", borderColor: "rgba(217,179,95,0.22)" } as ViewStyle,
  bubbleOther: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.10)" } as ViewStyle,

  bubbleTop: { flexDirection: "row", alignItems: "center", marginBottom: 8 } as ViewStyle,
  avatarMini: {
    width: 22,
    height: 22,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    marginRight: 8,
  } as ViewStyle,

  attachBlock: { marginTop: 8 } as ViewStyle,
  attachRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,

  composer: { marginTop: 10, marginBottom: 8, flexDirection: "row", alignItems: "flex-end" } as ViewStyle,
  cBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    marginRight: 10,
  } as ViewStyle,

  inputWrap: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,

  sendBtn: {
    marginLeft: 10,
    width: 46,
    height: 46,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  } as ViewStyle,
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.10)" } as ViewStyle,

  pendingBar: {
    marginTop: 8,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  pendingList: { marginTop: 10, flexDirection: "row", flexWrap: "wrap" } as ViewStyle,
  pendingPill: {
    marginRight: 8,
    marginBottom: 8,
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
});

const t = StyleSheet.create({
  hTitle: { color: "white", fontWeight: "900", fontSize: 22, letterSpacing: 0.2 } as TextStyle,
  hSub: { marginTop: 2, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,

  senderName: { color: "rgba(255,255,255,0.85)", fontWeight: "900", fontSize: 12 } as TextStyle,
  msgText: { marginTop: 2, color: TEXT, fontWeight: "700", fontSize: 14, lineHeight: 20 } as TextStyle,
  msgTime: { marginTop: 8, color: "rgba(255,255,255,0.45)", fontWeight: "800", fontSize: 10, alignSelf: "flex-end" } as TextStyle,

  avatarMiniText: { color: "rgba(217,179,95,0.95)", fontWeight: "900", fontSize: 11 } as TextStyle,

  attachName: { flex: 1, marginLeft: 8, color: "rgba(255,255,255,0.88)", fontWeight: "800", fontSize: 12 } as TextStyle,
  attachMeta: { marginLeft: 10, color: "rgba(255,255,255,0.50)", fontWeight: "800", fontSize: 10 } as TextStyle,

  input: { color: "white", fontWeight: "800", fontSize: 14, lineHeight: 20 } as TextStyle,

  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 } as TextStyle,
  emptySub: { marginTop: 6, color: "rgba(255,255,255,0.62)", fontWeight: "700", fontSize: 12 } as TextStyle,

  pendingTitle: { color: "white", fontWeight: "900", fontSize: 12, letterSpacing: 0.2 } as TextStyle,
  pendingName: { marginLeft: 8, marginRight: 8, maxWidth: 180, color: "rgba(255,255,255,0.80)", fontWeight: "800", fontSize: 12 } as TextStyle,
});
