import React from "react";
import {
  Switch,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  MS_BORDER,
  MS_GOLD,
  MS_SUB,
  MS_TEXT,
} from "./messageSettingsTheme";

export function SettingsToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[s.row, disabled ? s.rowDisabled : null]}>
      <View style={s.copy}>
        <Text style={s.label}>{label}</Text>
        {description ? <Text style={s.description}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{
          false: "rgba(255,255,255,0.18)",
          true: "rgba(217,179,95,0.55)",
        }}
        thumbColor={value ? MS_GOLD : "rgba(255,255,255,0.85)"}
        accessibilityLabel={accessibilityLabel || label}
        style={s.switch}
      />
    </View>
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
  switch: {
    transform: [{ scaleX: 0.92 }, { scaleY: 0.92 }],
  },
});
