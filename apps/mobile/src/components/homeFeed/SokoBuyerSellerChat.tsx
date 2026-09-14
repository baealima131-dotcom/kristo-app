import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  sokoListBuyerSellerMessages,
  sokoOpenBuyerSellerConversation,
  sokoSendBuyerSellerMessage,
  type SokoBuyerSellerMessage,
  type SokoBuyerSellerThread,
} from "@/src/lib/sokoCheckoutApi";

export default function SokoBuyerSellerChat({
  visible,
  productId,
  sellerName,
  productTitle,
  onClose,
}: {
  visible: boolean;
  productId: string;
  sellerName?: string;
  productTitle?: string;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<SokoBuyerSellerThread | null>(null);
  const [messages, setMessages] = useState<SokoBuyerSellerMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError("");
      setThread(null);
      setMessages([]);
      try {
        const opened = await sokoOpenBuyerSellerConversation(productId);
        if (cancelled) return;
        setThread(opened);
        setMessages(await sokoListBuyerSellerMessages(opened.conversationId));
      } catch (err) {
        if (!cancelled) {
          setError(
            String((err as Error)?.message || err || "Chat could not open.")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, productId]);

  const send = async () => {
    if (!thread || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    try {
      await sokoSendBuyerSellerMessage(thread.conversationId, text);
      setMessages((current) => [
        ...current,
        { id: `local-${Date.now()}`, text, mine: true, time: "Now" },
      ]);
    } catch (err) {
      setError(String((err as Error)?.message || err || "Message was not sent."));
      setDraft(text);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#1F6B46" />
            <Pressable onPress={onClose} style={styles.backLink}>
              <Text style={styles.backText}>Close</Text>
            </Pressable>
          </View>
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.flex}
          >
            <View style={styles.header}>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={styles.backText}>‹</Text>
              </Pressable>
              <View style={styles.headerTitles}>
                <Text style={styles.title}>
                  {thread?.title || sellerName || "Seller"}
                </Text>
                {!!(productTitle || thread?.subtitle) && (
                  <Text style={styles.sub}>
                    {productTitle || thread?.subtitle}
                  </Text>
                )}
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.messages}>
              {!!error && <Text style={styles.error}>{error}</Text>}
              {messages.map((message) => (
                <View
                  key={message.id}
                  style={[
                    styles.bubble,
                    message.mine ? styles.mine : styles.other,
                  ]}
                >
                  <Text
                    style={[styles.bubbleText, message.mine && styles.mineText]}
                  >
                    {message.text}
                  </Text>
                  {!!message.time && (
                    <Text style={styles.time}>{message.time}</Text>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => void send()}
                placeholder="Write a message…"
                placeholderTextColor="#8A8F86"
                style={styles.input}
                editable={Boolean(thread)}
              />
              <Pressable
                onPress={() => void send()}
                style={styles.send}
                disabled={!thread}
              >
                <Text style={styles.sendText}>↑</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F7F8F3" },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitles: { flex: 1 },
  backLink: { marginTop: 12 },
  backText: { fontSize: 28, color: "#171A16", fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "900", color: "#171A16" },
  sub: { color: "#74796F", fontSize: 12 },
  error: { color: "#8A4B16", paddingHorizontal: 16, marginBottom: 8 },
  messages: { padding: 16, gap: 8, flexGrow: 1 },
  bubble: {
    maxWidth: "80%",
    borderRadius: 16,
    padding: 10,
    backgroundColor: "#FFF",
  },
  mine: { alignSelf: "flex-end", backgroundColor: "#1F6B46" },
  other: { alignSelf: "flex-start" },
  bubbleText: { color: "#171A16" },
  mineText: { color: "#FFF" },
  time: { fontSize: 10, color: "#9AA39A", marginTop: 4 },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    backgroundColor: "#FFF",
    paddingHorizontal: 14,
    color: "#171A16",
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1F6B46",
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#FFF", fontSize: 18, fontWeight: "900" },
});
