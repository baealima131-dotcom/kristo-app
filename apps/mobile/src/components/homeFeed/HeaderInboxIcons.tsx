import React, { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";

import { refreshHeaderInboxCounts, useHeaderInboxCounts } from "@/src/lib/headerInboxCounts";
import { formatProfileCommunicationBadgeCount } from "@/src/lib/profileCommunicationInbox";

export const HEADER_INBOX_ICON_SIZE = 36;
export const HEADER_INBOX_ICON_GAP = 6;
/** Width the two icons take at the right of a header. */
export const HEADER_INBOX_ICONS_WIDTH = HEADER_INBOX_ICON_SIZE * 2 + HEADER_INBOX_ICON_GAP;

export type HeaderInboxTarget = "messages" | "calls";

/**
 * Messages (unread count) and missed calls (count) for the Home and Watch headers.
 * useFocus: refresh when the screen gets focus (Home); Watch is a modal and refreshes on mount.
 */
export const HeaderInboxIcons = memo(function HeaderInboxIcons({
  onOpen,
  useFocus = false,
}: {
  onOpen: (target: HeaderInboxTarget) => void;
  useFocus?: boolean;
}) {
  const { unreadMessages, missedCalls } = useHeaderInboxCounts();
  return (
    <View style={styles.row}>
      {useFocus ? <RefreshOnFocus /> : null}
      <InboxIcon
        icon="chatbubble-ellipses-outline"
        count={unreadMessages}
        label="Messages"
        onPress={() => onOpen("messages")}
      />
      <InboxIcon
        icon="call-outline"
        count={missedCalls}
        label="Missed calls"
        onPress={() => onOpen("calls")}
      />
    </View>
  );
});

function RefreshOnFocus() {
  useFocusEffect(
    useCallback(() => {
      void refreshHeaderInboxCounts();
    }, [])
  );
  return null;
}

function InboxIcon({
  icon,
  count,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  count: number;
  label: string;
  onPress: () => void;
}) {
  const badge = formatProfileCommunicationBadgeCount(count);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${count} new` : label}
      style={({ pressed }) => [styles.icon, pressed ? styles.iconPressed : null]}
    >
      <Ionicons name={icon} size={19} color="#F6E5B5" />
      {badge ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} numberOfLines={1}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: HEADER_INBOX_ICON_GAP,
  },
  icon: {
    width: HEADER_INBOX_ICON_SIZE,
    height: HEADER_INBOX_ICON_SIZE,
    borderRadius: HEADER_INBOX_ICON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(5,4,9,0.52)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(232,200,114,0.55)",
  },
  iconPressed: {
    opacity: 0.75,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: "#E5484D",
    borderWidth: 1.5,
    borderColor: "#120318",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },
});

/** Where the header icons lead: the Messages list, or the call list (missed calls). */
export const HEADER_INBOX_ROUTES: Record<HeaderInboxTarget, string> = {
  messages: "/(tabs)/profile/messages",
  calls: "/(tabs)/more/my-church-room/messages/calls",
};
