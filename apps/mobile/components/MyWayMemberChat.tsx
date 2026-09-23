import React, { useCallback, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { useFocusEffect } from "expo-router";
import { getSessionSync } from "@/src/lib/kristoSession";

import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";

import MyWayVoice from "./MyWayVoice";
import MyWayWorkspace from "./MyWayWorkspace";

const MYWAY_DESIGN_PREVIEW = false;

type Message = { role: "user" | "assistant"; content: string };

export default function MyWayMemberChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const active = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const conversationUser = useRef("");

  useFocusEffect(useCallback(() => {
    active.current = true;
    conversationUser.current = getSessionSync()?.userId || "";
    setMessages([]);
    setDraft("");
    setError("");
    setBusy(false);
    return () => {
      active.current = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, []));

  async function send() {
    const text = draft.trim();
    if (!text || pending.current) return;
    if (MYWAY_DESIGN_PREVIEW) {
      setError("Muonekano uko tayari. Chat ya AI itawezeshwa baadaye; ujumbe wako haujatumwa.");
      return;
    }

    const session = getSessionSync();
    if (!session?.userId || !session.sessionToken) {
      setMessages([]);
      setError("Ingia tena kwenye Kristo App ili kuanza chat.");
      return;
    }

    const sameUser = conversationUser.current === session.userId;
    const history = sameUser ? messages : [];
    if (!sameUser) setMessages([]);
    conversationUser.current = session.userId;

    const base = (process.env.EXPO_PUBLIC_MYWAY_API_BASE || "").trim().replace(/\/+$/, "");
    if (!base) {
      setError("Muunganisho wa MY WAY bado haujawekwa.");
      return;
    }

    const next: Message[] = [
      ...history.slice(-10),
      { role: "user", content: text },
    ];
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");

    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(base + "/api/member/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-kristo-user-id": session.userId,
          "x-kristo-session-token": session.sessionToken,
        },
        body: JSON.stringify({ messages: next }),
        signal: controller.signal,
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || typeof result?.reply !== "string" || !result.reply.trim()) {
        throw new Error(result?.error || "MY WAY haijarudisha jibu.");
      }
      const current = getSessionSync();
      if (
        !active.current ||
        pending.current !== controller ||
        current?.userId !== session.userId ||
        current?.sessionToken !== session.sessionToken
      ) return;

      setMessages([...next, { role: "assistant", content: result.reply }]);
      setDraft("");
    } catch (e) {
      if (
        active.current &&
        pending.current === controller &&
        getSessionSync()?.userId === session.userId
      ) {
        setError(controller.signal.aborted
          ? "Muunganisho umechukua muda mrefu. Jaribu tena."
          : e instanceof Error ? e.message : "Muunganisho haujakamilika.");
      }
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null;
        if (active.current) setBusy(false);
      }
    }
  }

  return (
    <View style={s.shell}>
      <View style={s.modeRow}>
        <View style={s.modeBadge}>
          <Ionicons name="color-palette-outline" size={13} color="#CFB477" />
          <Text style={s.modeText}>MUONEKANO WA MAJARIBIO</Text>
        </View>
        <Text style={s.privateText}>MY WAY</Text>
      </View>

      {!messages.length && (
        <View style={s.welcome}>
          <LinearGradient colors={["#DCC48C", "#B8944C"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.emblem}>
            <Ionicons name="sparkles" size={29} color="#161A20" />
          </LinearGradient>
          <Text style={s.eyebrow}>NAFASI YAKO YA MAWAZO</Text>
          <Text style={s.hero}>Unataka tufanye</Text>
          <Text style={s.heroGold}>nini leo?</Text>
          <Text style={s.intro}>Wazo dogo linaweza kuwa mwanzo mkubwa.</Text>

          <View style={s.suggestions}>
            {([
              { icon: "calendar-outline", title: "Panga siku yangu", detail: "Tuanzie na mambo muhimu.", prompt: "Nisaidie kupanga siku yangu." },
              { icon: "create-outline", title: "Nisaidie kuandika", detail: "Geuza wazo kuwa maneno.", prompt: "Nisaidie kuandika ujumbe." },
              { icon: "bulb-outline", title: "Tujifunze kitu", detail: "Elewa jambo hatua kwa hatua.", prompt: "Nataka kujifunza jambo jipya." },
            ] as const).map((item) => (
              <Pressable key={item.title} accessibilityRole="button"
                accessibilityLabel={item.title} disabled={busy}
                onPress={() => { setDraft(item.prompt); setError(""); inputRef.current?.focus(); }}
                style={({ pressed }) => [s.suggestion, pressed && s.pressed]}>
                <View style={s.suggestionIcon}>
                  <Ionicons name={item.icon} size={21} color="#CFB477" />
                </View>
                <View style={s.suggestionCopy}>
                  <Text style={s.suggestionTitle}>{item.title}</Text>
                  <Text style={s.suggestionDetail}>{item.detail}</Text>
                </View>
                <Ionicons name="arrow-up-outline" size={16} color="#717A88"
                  style={{ transform: [{ rotate: "45deg" }] }} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {messages.map((message, index) => (
        <View key={index} style={[s.bubble, message.role === "user" ? s.user : s.assistant]}>
          <Text style={s.name}>{message.role === "user" ? "WEWE" : "MY WAY"}</Text>
          <Text selectable style={s.message}>{message.content}</Text>
        </View>
      ))}

      {error ? (
        <View accessibilityRole="alert" style={s.notice}>
          <Ionicons name="information-circle-outline" size={20} color="#CFB477" />
          <Text style={s.noticeText}>{error}</Text>
        </View>
      ) : null}

      <MyWayWorkspace />
      <MyWayVoice />
      <View style={s.composer}>
        <TextInput ref={inputRef} value={draft} onChangeText={setDraft}
          placeholder="Wazo lako linaanzia hapa…" placeholderTextColor="#838B99"
          accessibilityLabel="Ujumbe kwa MY WAY" multiline maxLength={4000}
          editable={!busy} style={s.input} />
        <View style={s.composerBottom}>
          <Text style={s.counter}>{draft.length ? `${draft.length}/4000` : "Andika kwa lugha yako"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Tuma ujumbe"
            accessibilityState={{ disabled: busy || !draft.trim() }}
            onPress={send} disabled={busy || !draft.trim()}
            style={({ pressed }) => [s.send, (busy || !draft.trim()) && s.disabled, pressed && s.pressed]}>
            <Text style={s.sendText}>{busy ? "Inasubiri…" : "Tuma"}</Text>
            <Ionicons name="arrow-up" size={19} color="#111720" />
          </Pressable>
        </View>
      </View>
      <View style={s.footnoteRow}>
        <Ionicons name="information-circle-outline" size={13} color="#737D8E" />
        <Text style={s.footnote}>Chat ya AI itawezeshwa baadaye. Hakuna ujumbe unaotumwa sasa.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  shell: { marginTop: 28 },
  modeRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  modeBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20, backgroundColor: "#202025", flexShrink: 1 },
  modeText: { color: "#CFB477", fontSize: 9, letterSpacing: 0.9, fontWeight: "700", flexShrink: 1 },
  privateText: { color: "#737D8E", fontSize: 10, letterSpacing: 1.4, fontWeight: "700" },
  welcome: { paddingTop: 30 },
  emblem: { width: 60, height: 60, borderRadius: 21, justifyContent: "center", alignItems: "center", marginBottom: 23 },
  eyebrow: { color: "#929BAB", fontSize: 10, letterSpacing: 1.5, fontWeight: "700", marginBottom: 12 },
  hero: { color: "#F1F2F5", fontSize: 31, lineHeight: 39, fontWeight: "700", letterSpacing: -0.9 },
  heroGold: { color: "#DCC48C", fontSize: 34, lineHeight: 42, fontWeight: "700", letterSpacing: -0.9 },
  intro: { color: "#939DAD", fontSize: 14, lineHeight: 22, marginTop: 10, maxWidth: 300 },
  suggestions: { gap: 9, marginTop: 25, marginBottom: 23 },
  suggestion: { flexDirection: "row", alignItems: "center", padding: 13, gap: 12, borderRadius: 17, borderWidth: 1, borderColor: "#232B39", backgroundColor: "#131B28", minHeight: 70 },
  suggestionIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: "#242629", alignItems: "center", justifyContent: "center" },
  suggestionCopy: { flex: 1 },
  suggestionTitle: { color: "#E9ECF2", fontSize: 14, fontWeight: "600" },
  suggestionDetail: { color: "#919BAC", fontSize: 12, lineHeight: 18, marginTop: 3 },
  bubble: { padding: 16, borderRadius: 19, marginBottom: 12, marginTop: 12 },
  user: { backgroundColor: "#292B30", marginLeft: 24 },
  assistant: { backgroundColor: "#141D2B", marginRight: 12 },
  name: { color: "#CFB477", fontSize: 10, letterSpacing: 1.2, fontWeight: "700", marginBottom: 9 },
  message: { color: "#E7EBF3", fontSize: 15, lineHeight: 24 },
  notice: { padding: 14, borderRadius: 15, backgroundColor: "#232322", flexDirection: "row", gap: 9, alignItems: "flex-start", marginBottom: 14 },
  noticeText: { color: "#D8D0BC", fontSize: 13, lineHeight: 21, flex: 1 },
  composer: { borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "#554B37", backgroundColor: "#141B27" },
  input: { color: "#F2F3F7", fontSize: 15, lineHeight: 23, minHeight: 75, maxHeight: 170, textAlignVertical: "top", padding: 3 },
  composerBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10 },
  counter: { color: "#929BAB", fontSize: 11, flexShrink: 1 },
  send: { flexDirection: "row", gap: 8, backgroundColor: "#DCC48C", paddingHorizontal: 16, minHeight: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#111720", fontWeight: "800", fontSize: 13 },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.72 },
  footnoteRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 13, paddingHorizontal: 5 },
  footnote: { color: "#8791A2", fontSize: 11, lineHeight: 17, flex: 1 },
});
