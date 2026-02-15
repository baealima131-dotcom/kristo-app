import type { ViewStyle } from "react-native";

export const VIP_SPACING = {
  base: 4,
  outer: 16,
  gap: {
    large: 16,
    medium: 12,
    small: 8,
  },
  cardPadding: 16,
  commentPadding: 12,
  composerMinHeight: 56,
  composerInputHeight: 40,
  buttonHeight: 44,
} as const;

export const VIP_RADIUS = {
  card: 16,
  inner: 12,
  pill: 24,
} as const;

export const VIP_COLORS = {
  bg: "#0B0F17",
  glassBg: "rgba(18, 22, 30, 0.8)",
  glassBorder: "rgba(255, 255, 255, 0.08)",
  gold: "rgba(217, 179, 95, 0.95)",
  goldMuted: "rgba(217, 179, 95, 0.6)",
  text: {
    primary: "#FFFFFF",
    secondary: "rgba(255, 255, 255, 0.7)",
    muted: "rgba(255, 255, 255, 0.45)",
  },
} as const;

export const VIP_TYPOGRAPHY = {
  title: { fontSize: 20, fontWeight: "700" as const, lineHeight: 28 },
  headline: { fontSize: 16, fontWeight: "600" as const, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: "400" as const, lineHeight: 22 },
  meta: { fontSize: 13, fontWeight: "400" as const, lineHeight: 18 },
  counter: { fontSize: 14, fontWeight: "500" as const, lineHeight: 20 },
} as const;

export const vipShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 4,
  elevation: 4,
} satisfies ViewStyle;


export const VIP = {
  spacing: VIP_SPACING,
  radius: VIP_RADIUS,
  colors: VIP_COLORS,
  typography: VIP_TYPOGRAPHY,
  shadow: vipShadow,
} as const;
