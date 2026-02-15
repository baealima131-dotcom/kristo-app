import React from "react";
import { ScrollView, View, Text, Pressable, StyleSheet, type ViewStyle, type TextStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { VIP, VIP_TYPE } from "@/src/ui/vipPremium";

export { VIP, VIP_TYPE };

export function VipScreen({
  children,
  style,
  scroll = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  scroll?: boolean;
}) {
  if (scroll) {
    return (
      <SafeAreaView style={[s.shell, style]}>
        <ScrollView contentContainerStyle={s.scroll}>{children}</ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={[s.shell, style]}>
      <View style={s.fill}>{children}</View>
    </SafeAreaView>
  );
}

export function VipText({
  children,
  tone = "body",
  style,
}: {
  children: React.ReactNode;
  tone?: keyof typeof VIP_TYPE;
  style?: TextStyle;
}) {
  return <Text style={[VIP_TYPE[tone], style]}>{children}</Text>;
}

export function VipButton({
  title,
  onPress,
  style,
}: {
  title: string;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={[s.btn, style]}>
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: VIP.colors.bg },
  fill: { flex: 1 },
  scroll: { paddingBottom: 18 },

  btn: {
    borderRadius: VIP.radius.btn,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  btnText: { color: VIP.colors.gold2, fontWeight: "900", textAlign: "center" },
});
