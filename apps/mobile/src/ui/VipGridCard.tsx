import React from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { VIP } from "./vipTheme";

export function VipGridCard({
  title,
  subtitle,
  right,
  onPress,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderWidth: 1,
          borderColor: VIP.colors.glassBorder,
          backgroundColor: pressed ? "rgba(255,255,255,0.04)" : VIP.colors.glassBg,
          borderRadius: VIP.radius.card,
          padding: 12,
          gap: 6,
          minHeight: 76,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: VIP.colors.text.primary, fontWeight: "900", fontSize: 16 }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ color: VIP.colors.text.muted, opacity: 0.9 }} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {right ? <View>{right}</View> : null}
      </View>
    </Pressable>
  );
}
