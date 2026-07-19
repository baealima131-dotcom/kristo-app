import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  MS_BORDER,
  MS_CARD,
  MS_GOLD,
  MS_SUB,
} from "./messageSettingsTheme";

export function SettingsSectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
      <View style={s.card}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginBottom: 22,
    gap: 8,
  },
  title: {
    color: MS_GOLD,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
    paddingHorizontal: 4,
  },
  subtitle: {
    color: MS_SUB,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  card: {
    borderRadius: 16,
    backgroundColor: MS_CARD,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MS_BORDER,
    overflow: "hidden",
  },
});
