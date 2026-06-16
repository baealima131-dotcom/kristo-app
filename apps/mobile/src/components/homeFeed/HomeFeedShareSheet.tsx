import React, { memo, useCallback, useEffect } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  copyHomeFeedPostShareLink,
  shareHomeFeedPostExternally,
  type HomeFeedSharePayload,
} from "@/src/lib/homeFeedShare";
import { HOME_FEED_GOLD_SOFT, HOME_FEED_MUTED } from "./theme";

type Props = {
  visible: boolean;
  payload: HomeFeedSharePayload | null;
  onClose: () => void;
  onOpenShareToChat: () => void;
};

export const HomeFeedShareSheet = memo(function HomeFeedShareSheet({
  visible,
  payload,
  onClose,
  onOpenShareToChat,
}: Props) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    console.log("KRISTO_SHARE_SHEET_VISIBLE", {
      visible,
      postId: payload?.postId || "",
      shareUrl: payload?.shareUrl || "",
    });
  }, [visible, payload?.postId, payload?.shareUrl]);

  const handleExternalShare = useCallback(async () => {
    if (!payload) return;
    onClose();
    try {
      onClose();
      await new Promise((resolve) => setTimeout(resolve, 450));
      await shareHomeFeedPostExternally(payload);
    } catch {
      // User dismissed share sheet.
    }
  }, [payload, onClose]);

  const handleCopyLink = useCallback(async () => {
    if (!payload) return;
    try {
      const copied = await copyHomeFeedPostShareLink(payload);
      onClose();
      if (copied) {
        Alert.alert("Link copied", "Post link copied to clipboard.");
      }
    } catch {
      Alert.alert("Copy failed", "Could not copy the link. Please try again.");
    }
  }, [payload, onClose]);

  const handleInternalShare = useCallback(() => {
    onClose();
    onOpenShareToChat();
  }, [onClose, onOpenShareToChat]);

  if (!payload) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          <Text style={styles.title}>Share post</Text>
          {payload.title ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {payload.title}
            </Text>
          ) : null}

          <ShareOption
            icon="share-outline"
            label="Share outside Kristo"
            sub="Messages, Mail, and other apps"
            onPress={() => void handleExternalShare()}
          />
          <ShareOption
            icon="chatbubbles-outline"
            label="Send to ministry/chat"
            sub="Share inside Kristo"
            onPress={handleInternalShare}
          />
          <ShareOption
            icon="link-outline"
            label="Copy link"
            sub={payload.shareUrl}
            onPress={() => void handleCopyLink()}
            monoSub
          />

          <Pressable style={styles.cancelBtn} onPress={onClose} hitSlop={10}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

function ShareOption({
  icon,
  label,
  sub,
  onPress,
  monoSub = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
  monoSub?: boolean;
}) {
  return (
    <Pressable style={styles.optionRow} onPress={onPress}>
      <View style={styles.optionIconWrap}>
        <Ionicons name={icon} size={20} color={HOME_FEED_GOLD_SOFT} />
      </View>
      <View style={styles.optionTextCol}>
        <Text style={styles.optionLabel}>{label}</Text>
        {sub ? (
          <Text style={[styles.optionSub, monoSub ? styles.optionSubMono : null]} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.35)" />
    </Pressable>
  );
}

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
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  optionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  optionTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  optionLabel: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  optionSub: {
    color: HOME_FEED_MUTED,
    fontSize: 12,
    lineHeight: 16,
  },
  optionSubMono: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined }),
    fontSize: 11,
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
