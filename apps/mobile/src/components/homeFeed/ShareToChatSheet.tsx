import React, { memo, useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HomeFeedSharePayload } from "@/src/lib/homeFeedShare";
import {
  loadShareToChatRooms,
  sendSharedContentToRoom,
  type ShareToChatRoom,
} from "@/src/lib/homeFeedShareToChat";
import { HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  payload: HomeFeedSharePayload | null;
  sourceItem?: any;
  onClose: () => void;
  onSent?: (room: ShareToChatRoom) => void;
};

export const ShareToChatSheet = memo(function ShareToChatSheet({
  visible,
  payload,
  sourceItem,
  onClose,
  onSent,
}: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [sendingRoomId, setSendingRoomId] = useState("");
  const [rooms, setRooms] = useState<ShareToChatRoom[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    console.log("KRISTO_SHARE_TO_CHAT_OPEN", {
      postId: payload?.postId || "",
      shareUrl: payload?.shareUrl || "",
    });
  }, [visible, payload?.postId, payload?.shareUrl]);

  useEffect(() => {
    if (!visible) {
      setSendingRoomId("");
      setError("");
      return;
    }

    let alive = true;
    setLoading(true);
    setError("");

    void loadShareToChatRooms()
      .then((items) => {
        if (!alive) return;
        setRooms(items);
        if (!items.length) {
          setError("No ministry chats available.");
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(String((e as any)?.message || e || "Could not load chats"));
        setRooms([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [visible]);

  const handleSelectRoom = useCallback(
    async (room: ShareToChatRoom) => {
      if (!payload || sendingRoomId) return;
      if (!room.isMember || !room.canAccess) {
        setError("You do not have access to this chat room.");
        return;
      }

      const roomId = String(room.roomId || "").trim();
      console.log("KRISTO_SHARE_TO_CHAT_ROOM_SELECTED", {
        roomId,
        postId: payload.postId,
      });

      setSendingRoomId(roomId);
      setError("");

      const result = await sendSharedContentToRoom(room, payload, sourceItem);
      setSendingRoomId("");

      if (!result.ok) {
        setError(result.error || "Failed to send shared post");
        return;
      }

      onClose();
      onSent?.(room);
      Alert.alert(
        "Sent",
        `Shared to ${room.title || "ministry chat"}.`
      );
    },
    [payload, sendingRoomId, onClose, onSent, sourceItem]
  );

  if (!payload) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Send to ministry/chat</Text>
          {payload.title ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {payload.title}
            </Text>
          ) : null}

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={HOME_FEED_GOLD_SOFT} />
              <Text style={styles.loadingText}>Loading chats...</Text>
            </View>
          ) : (
            <FlatList
              data={rooms}
              keyExtractor={(item) => String(item.roomId)}
              style={styles.list}
              contentContainerStyle={rooms.length ? undefined : styles.listEmpty}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const busy = sendingRoomId === item.roomId;
                return (
                  <Pressable
                    style={styles.roomRow}
                    disabled={Boolean(sendingRoomId)}
                    onPress={() => void handleSelectRoom(item)}
                  >
                    <View style={styles.roomIconWrap}>
                      <Ionicons
                        name={item.kind === "church" ? "business-outline" : "people-outline"}
                        size={18}
                        color={HOME_FEED_GOLD_SOFT}
                      />
                    </View>
                    <View style={styles.roomTextCol}>
                      <Text style={styles.roomTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.sub ? (
                        <Text style={styles.roomSub} numberOfLines={2}>
                          {item.sub}
                        </Text>
                      ) : null}
                    </View>
                    {busy ? (
                      <ActivityIndicator color={HOME_FEED_GOLD_SOFT} size="small" />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                error ? <Text style={styles.errorText}>{error}</Text> : null
              }
            />
          )}

          {error && !loading && rooms.length ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

          <Pressable style={styles.cancelBtn} onPress={onClose} hitSlop={10}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    backgroundColor: "#0B0F17",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: "78%",
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    marginBottom: 14,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 4,
  },
  subtitle: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
    lineHeight: 19,
    marginBottom: 10,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 24,
    justifyContent: "center",
  },
  loadingText: {
    color: HOME_FEED_MUTED,
    fontSize: 14,
  },
  list: {
    maxHeight: 360,
  },
  listEmpty: {
    paddingVertical: 12,
  },
  roomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  roomIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  roomTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  roomTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  roomSub: {
    color: HOME_FEED_MUTED,
    fontSize: 12,
    lineHeight: 16,
  },
  errorText: {
    color: "#FF8FA3",
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 8,
  },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 4,
  },
  cancelBtnText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 16,
    fontWeight: "700",
  },
});
