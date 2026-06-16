import React, { memo } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SharedContentPayload } from "@/src/lib/messagesStore";

type Props = {
  shared: SharedContentPayload;
  senderLabel?: string;
  mine?: boolean;
  onOpenPost?: (shared: SharedContentPayload) => void;
};

export const SharedContentCard = memo(function SharedContentCard({
  shared,
  senderLabel,
  mine = false,
  onOpenPost,
}: Props) {
  const posterUri = String(shared.posterUri || "").trim();
  const title = String(shared.title || shared.caption || "Shared post").trim();
  const churchName = String(shared.churchName || "").trim();
  const authorName = String(shared.authorName || "").trim();
  const metaLine = [churchName, authorName].filter(Boolean).join(" • ");

  const handleOpenPost = () => {
    onOpenPost?.(shared);
  };

  return (
    <View style={[styles.card, mine ? styles.cardMine : null]}>
      <View style={styles.labelRow}>
        <Ionicons name="home-outline" size={13} color="#F4D06F" />
        <Text style={styles.labelText}>Shared from Home Feed</Text>
      </View>

      {posterUri ? (
        <Image source={{ uri: posterUri }} style={styles.poster} resizeMode="cover" />
      ) : (
        <View style={styles.posterFallback}>
          <Ionicons name="play-circle-outline" size={34} color="rgba(255,255,255,0.55)" />
        </View>
      )}

      {title ? (
        <Text style={styles.title} numberOfLines={3}>
          {title}
        </Text>
      ) : null}

      {metaLine ? (
        <Text style={styles.meta} numberOfLines={2}>
          {metaLine}
        </Text>
      ) : null}

      {senderLabel ? (
        <Text style={styles.sender} numberOfLines={1}>
          {senderLabel}
        </Text>
      ) : null}

      <Pressable style={styles.openBtn} onPress={handleOpenPost}>
        <Text style={styles.openBtnText}>Open post</Text>
        <Ionicons name="arrow-forward" size={14} color="#0B0F17" />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 248,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
    padding: 10,
    gap: 8,
  },
  cardMine: {
    alignSelf: "flex-end",
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  labelText: {
    color: "#F4D06F",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  poster: {
    width: "100%",
    height: 132,
    borderRadius: 12,
    backgroundColor: "#111827",
  },
  posterFallback: {
    width: "100%",
    height: 132,
    borderRadius: 12,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "700",
  },
  meta: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    lineHeight: 16,
  },
  sender: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    lineHeight: 14,
  },
  openBtn: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#F4D06F",
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  openBtnText: {
    color: "#0B0F17",
    fontSize: 13,
    fontWeight: "800",
  },
});
