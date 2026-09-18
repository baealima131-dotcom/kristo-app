import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { getSessionSync } from "@/src/lib/kristoSession";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

type Notice = {
  id: string;
  decision: string;
  businessName: string;
  createdAt?: string;
  commandCode: string | null;
  codeStatus: string | null;
  codeExpiresAt?: string;
};

function dateLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function noticeText(decision: string) {
  if (decision === "approve") return "Ombi lako la kuuza SOKO limekubaliwa.";
  if (decision === "regenerate_code") return "System Admin amekutengenezea seller code mpya. Code ya zamani haitumiki.";
  if (decision === "reject") return "Ombi lako la kuuza SOKO halijakubaliwa. Angalia maelezo kwenye Sell on SOKO.";
  if (decision === "revoke") return "Ruhusa yako ya kuuza SOKO imeondolewa. Angalia hali ya maombi yako.";
  return "Kuna taarifa kuhusu maombi yako ya SOKO.";
}

/** Official read-only conversation. Never shares codes with a church room or DM peer. */
export default function SokoSystemMessages() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Notice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loadedAtMs, setLoadedAtMs] = useState(0);
  const focused = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const identity = useRef("");
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissedStorageKey = useCallback((userId: string) =>
    `@kristo:soko-system-messages:opened:${userId}`, []);

  const readDismissedIds = useCallback(async (userId: string) => {
    try {
      const raw = await AsyncStorage.getItem(dismissedStorageKey(userId));
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [dismissedStorageKey]);

  const load = useCallback(async () => {
    pending.current?.abort();
    const session = getSessionSync();
    const key = session?.userId && session?.sessionToken
      ? `${session.userId}:${session.sessionToken}` : "";
    if (identity.current !== key) {
      identity.current = key;
      setMessages([]);
      setError("");
      setVisible(false);
    }
    if (!key) { setBusy(false); return; }
    const base = String(process.env.EXPO_PUBLIC_API_BASE || "").trim().replace(/\/+$/, "");
    if (!base) {
      setMessages([]);
      setError("Anwani ya Kristo server haijawekwa.");
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const stillCurrent = () => {
      const now = getSessionSync();
      return focused.current && pending.current === controller &&
        now?.userId === session?.userId && now?.sessionToken === session?.sessionToken;
    };
    setBusy(true);
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${base}/api/soko/seller/system-messages`, {
        headers: getKristoHeaders() as Record<string, string>,
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true || !Array.isArray(result.messages)) {
        throw new Error("Ujumbe haujapatikana. Jaribu tena.");
      }
      if (!stillCurrent()) return;
      const dismissed = await readDismissedIds(String(session.userId));
      if (!stillCurrent()) return;
      setMessages(result.messages.filter((m: Notice) =>
        m && typeof m.id === "string" && !dismissed.has(m.id)
      ));
      setLoadedAtMs(Date.now());
      setError("");
    } catch {
      if (stillCurrent()) {
        // Hide potentially expired/revoked codes when refreshing fails.
        setMessages([]);
        setError("Ujumbe haujapatikana. Angalia muunganisho, kisha jaribu tena.");
      }
    } finally {
      clearTimeout(timer);
      if (stillCurrent()) setBusy(false);
      if (pending.current === controller) pending.current = null;
    }
  }, [readDismissedIds]);

  const openMessages = useCallback(() => {
    if (!messages.length) return;
    setVisible(true);
    void load();
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    const openedIds = messages.map((message) => message.id);
    dismissTimer.current = setTimeout(() => {
      const session = getSessionSync();
      if (session?.userId) {
        void readDismissedIds(String(session.userId)).then((dismissed) => {
          openedIds.forEach((id) => dismissed.add(id));
          return AsyncStorage.setItem(
            dismissedStorageKey(String(session.userId)),
            JSON.stringify([...dismissed])
          );
        }).catch(() => null);
      }
      setVisible(false);
      setMessages((current) => current.filter((message) => !openedIds.includes(message.id)));
      dismissTimer.current = null;
    }, 5000);
  }, [dismissedStorageKey, load, messages, readDismissedIds]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    const timer = setInterval(() => void load(), 20000);
    return () => {
      focused.current = false;
      clearInterval(timer);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
      pending.current?.abort();
      pending.current = null;
      identity.current = "";
      setMessages([]);
      setVisible(false);
      setError("");
    };
  }, [load]));

  if (!messages.length) return null;

  const latest = messages[0];

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Open System Admin SOKO messages"
      style={({ pressed }) => [s.entry, pressed ? s.entryPressed : null]} onPress={openMessages}>
      <BlurView intensity={18} tint="dark" style={s.entryGlass} />
      <LinearGradient pointerEvents="none"
        colors={["rgba(8,55,43,0.95)", "rgba(17,58,48,0.93)", "rgba(40,51,51,0.91)", "rgba(57,43,52,0.89)"]}
        locations={[0, 0.42, 0.76, 1]} start={{ x: 0, y: 0.15 }} end={{ x: 1, y: 0.85 }}
        style={s.entryGradient} />
      <View style={s.avatar}>
        <Ionicons name="shield-checkmark-outline" size={25} color="#FFD76A" />
      </View>
      <View style={s.entryBody}>
        <Text style={s.title} numberOfLines={1}>System Admin • SOKO</Text>
        <Text style={s.entrySubtitle} numberOfLines={1}>Seller access</Text>
        <Text style={s.entryPreview} numberOfLines={2}>{noticeText(latest.decision)}</Text>
      </View>
      {busy ? <ActivityIndicator color="#E4C77E" /> : <View style={s.unreadBadge}>
        <Text style={s.unreadBadgeText}>{messages.length > 99 ? "99+" : messages.length}</Text>
      </View>}
    </Pressable>
    <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
      <View style={[s.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom }]}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close messages" onPress={() => setVisible(false)}>
            <Ionicons name="chevron-back" size={28} color="#FFF" />
          </Pressable>
          <View style={{ flex: 1 }}><Text style={s.title}>System Admin • SOKO</Text>
            <Text style={s.subtitle}>Ujumbe rasmi • Kwa akaunti yako pekee</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Refresh messages" disabled={busy} onPress={() => void load()}>
            <Ionicons name="refresh" size={24} color="#E4C77E" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 16 }}>
          {busy ? <ActivityIndicator color="#E4C77E" /> : null}
          {error ? <Text style={s.error}>{error}</Text> : null}
          {!busy && !error && !messages.length ? <View style={s.bubble}>
            <Text style={s.body}>Hakuna ujumbe bado. Tuma maombi kupitia Sell on SOKO ndani ya Kristo App. Baada ya System Admin kuamua, taarifa itaonekana hapa.</Text>
          </View> : null}
          {messages.map((message) => {
            const active = message.codeStatus === "active" && !!message.codeExpiresAt &&
              loadedAtMs > 0 && Date.parse(message.codeExpiresAt) > loadedAtMs;
            return <View key={message.id} style={s.bubble}>
              <Text style={s.sender}>SYSTEM ADMIN</Text>
              <Text style={s.body}>{noticeText(message.decision)}</Text>
              <Text style={s.subtitle}>{message.businessName}</Text>
              {message.commandCode && active ? <>
                <Text style={s.subtitle}>SELLER CODE — bonyeza kwa muda ili kunakili</Text>
                <Text selectable style={s.code}>{message.commandCode}</Text>
                <Text style={s.body}>Weka code hii ndani ya SOKO → Seller access, ukiwa kwenye akaunti hii hii. Ni ya matumizi mara moja. Usiishiriki.</Text>
                <Text style={s.subtitle}>Inaisha: {dateLabel(message.codeExpiresAt)}</Text>
              </> : message.codeStatus ? <Text style={s.subtitle}>
                Code haitumiki sasa ({message.codeStatus === "active" ? "expired" : message.codeStatus}). Angalia seller access yako.
              </Text> : null}
              <Text style={s.date}>{dateLabel(message.createdAt)}</Text>
            </View>;
          })}
          <Text style={s.subtitle}>Sehemu hii ni ya kupokea taarifa; haitumi majibu wala kuchakata malipo.</Text>
        </ScrollView>
      </View>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0A1220" },
  entry: { position: "relative", flexDirection: "row", alignItems: "center", gap: 11, minHeight: 78, paddingVertical: 10, paddingHorizontal: 13, marginBottom: 8, borderRadius: 21, borderCurve: "continuous", backgroundColor: "rgba(4,32,29,0.68)", borderWidth: 1, borderColor: "rgba(224,160,121,0.28)", overflow: "hidden" },
  entryPressed: { opacity: 0.74, transform: [{ scale: 0.99 }] },
  entryGlass: { ...StyleSheet.absoluteFillObject, borderRadius: 21, borderCurve: "continuous", overflow: "hidden" },
  entryGradient: { ...StyleSheet.absoluteFillObject, borderRadius: 21, borderCurve: "continuous", opacity: 0.82 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(55,125,96,0.48)", borderWidth: 1.25, borderColor: "rgba(225,190,103,0.64)" },
  entryBody: { flex: 1, minWidth: 0 },
  entrySubtitle: { marginTop: 2, color: "rgba(109,231,184,0.72)", fontWeight: "700", fontSize: 11 },
  entryPreview: { marginTop: 3, color: "rgba(224,238,235,0.72)", fontWeight: "700", fontSize: 12, lineHeight: 16 },
  unreadBadge: { minWidth: 21, height: 21, paddingHorizontal: 6, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "#4DE0A3" },
  unreadBadgeText: { color: "#032017", fontWeight: "900", fontSize: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 18 },
  title: { color: "#FFF", fontSize: 17, fontWeight: "800" },
  subtitle: { color: "#B7C3D5", fontSize: 12, lineHeight: 19, marginTop: 5 },
  bubble: { padding: 20, borderRadius: 22, backgroundColor: "#182538", borderWidth: 1, borderColor: "#43516A", gap: 10 },
  sender: { color: "#E4C77E", fontSize: 11, letterSpacing: 1.5, fontWeight: "900" },
  body: { color: "#F5F7FA", fontSize: 15, lineHeight: 23 },
  code: { color: "#E4C77E", fontSize: 23, fontWeight: "900", letterSpacing: 1, paddingVertical: 10 },
  date: { color: "#92A1B9", fontSize: 11, textAlign: "right" },
  error: { color: "#FFADBA", fontSize: 14, lineHeight: 21 },
});
