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
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

export function SettingsChoiceRow({
  label,
  valueLabel,
  description,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  valueLabel: string;
  description?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        disabled ? s.rowDisabled : null,
        pressed && !disabled ? s.rowPressed : null,
      ]}
    >
      <View style={s.copy}>
        <Text style={s.label}>{label}</Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
      </View>
      <View style={s.valueWrap}>
        <Text style={s.value} numberOfLines={1}>
          {valueLabel}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={MS_GOLD} />
      </View>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: MS_BORDER,
  },
  rowPressed: {
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  rowDisabled: {
    opacity: 0.45,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: MS_TEXT,
    fontSize: 15,
    fontWeight: "600",
  },
  description: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 16,
  },
  valueWrap: {
    maxWidth: "42%",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  value: {
    color: MS_GOLD,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "right",
  },
});
