import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  MS_BORDER,
  MS_DANGER,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

export function SettingsNavRow({
  label,
  description,
  icon,
  onPress,
  danger,
  last,
  accessibilityLabel,
}: {
  label: string;
  description?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        !last ? s.rowBorder : null,
        pressed ? s.rowPressed : null,
      ]}
    >
      <View
        style={[
          s.iconWrap,
          danger ? s.iconWrapDanger : null,
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={danger ? MS_DANGER : MS_GOLD}
        />
      </View>
      <View style={s.copy}>
        <Text style={[s.label, danger ? s.labelDanger : null]}>{label}</Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={MS_SUB} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MS_BORDER,
  },
  rowPressed: {
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
  },
  iconWrapDanger: {
    backgroundColor: "rgba(255,107,107,0.12)",
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  label: {
    color: MS_TEXT,
    fontSize: 15,
    fontWeight: "600",
  },
  labelDanger: {
    color: MS_DANGER,
  },
  description: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 16,
  },
});
