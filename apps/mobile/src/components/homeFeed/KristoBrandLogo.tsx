import React, { memo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";

const LOGO_FONT_SIZE = 25;
const CROSS_SIZE = 32;
const LETTER_GAP = 5.2;

const GRADIENT_COLORS = ["#FFF8E7", "#F3DE8A", "#D4AF37", "#9A7428"] as const;

const logoLetterStyle = {
  fontSize: LOGO_FONT_SIZE,
  fontWeight: "900" as const,
  color: "#000",
  includeFontPadding: false,
  ...(Platform.OS === "ios"
    ? {}
    : { fontFamily: "sans-serif-black" as const }),
};

function KristoCrossMark({ size, color }: { size: number; color: string }) {
  const stemWidth = Math.max(2.6, size * 0.105);
  const barWidth = size * 0.86;
  const stemHeight = size * 1.02;
  const barTop = size * 0.11;

  return (
    <View style={[styles.crossHost, { width: size * 0.46, height: size }]}>
      <View
        style={{
          position: "absolute",
          top: barTop,
          width: barWidth,
          height: stemWidth,
          borderRadius: stemWidth / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: stemWidth,
          height: stemHeight,
          borderRadius: stemWidth / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function KristoLogoMaskRow() {
  return (
    <View style={styles.logoRow}>
      <Text style={[logoLetterStyle, styles.letterK]}>K</Text>
      <Text style={[logoLetterStyle, styles.letterGap]}>R</Text>
      <Text style={[logoLetterStyle, styles.letterGap]}>I</Text>
      <Text style={[logoLetterStyle, styles.letterGap]}>S</Text>
      <View style={styles.crossSlot}>
        <KristoCrossMark size={CROSS_SIZE} color="#000" />
      </View>
      <Text style={[logoLetterStyle, styles.letterO]}>O</Text>
    </View>
  );
}

function KristoLogoFillRow() {
  return (
    <View style={styles.logoRow}>
      <Text style={[logoLetterStyle, styles.letterK, styles.invisibleFill]}>K</Text>
      <Text style={[logoLetterStyle, styles.letterGap, styles.invisibleFill]}>R</Text>
      <Text style={[logoLetterStyle, styles.letterGap, styles.invisibleFill]}>I</Text>
      <Text style={[logoLetterStyle, styles.letterGap, styles.invisibleFill]}>S</Text>
      <View style={[styles.crossSlot, styles.invisibleFill]}>
        <KristoCrossMark size={CROSS_SIZE} color="#000" />
      </View>
      <Text style={[logoLetterStyle, styles.letterO, styles.invisibleFill]}>O</Text>
    </View>
  );
}

export const KristoBrandLogo = memo(function KristoBrandLogo() {
  return (
    <View style={styles.logoRoot} accessibilityLabel="KRISTO">
      <View style={styles.logoBloom} pointerEvents="none">
        <MaskedView style={styles.maskHost} maskElement={<KristoLogoMaskRow />}>
          <LinearGradient
            colors={["#F5D76E", "#E8C872"]}
            start={{ x: 0.5, y: 0.5 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.gradientFill}
          >
            <KristoLogoFillRow />
          </LinearGradient>
        </MaskedView>
      </View>
      <View style={styles.logoMark}>
        <MaskedView style={styles.maskHost} maskElement={<KristoLogoMaskRow />}>
          <LinearGradient
            colors={[...GRADIENT_COLORS]}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.95, y: 1 }}
            style={styles.gradientFill}
          >
            <KristoLogoFillRow />
          </LinearGradient>
        </MaskedView>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  logoRoot: {
    alignItems: "center",
    justifyContent: "center",
  },
  logoBloom: {
    position: "absolute",
    opacity: 0.22,
    transform: [{ scale: 1.05 }],
    ...Platform.select({
      ios: {
        shadowColor: "#F5D76E",
        shadowOpacity: 0.5,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 0 },
      },
    }),
  },
  logoMark: {
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#E8C872",
        shadowOpacity: 0.28,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
      },
    }),
  },
  maskHost: {
    flexDirection: "row",
    alignItems: "center",
  },
  gradientFill: {
    flexDirection: "row",
    alignItems: "center",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  letterK: {
    marginRight: LETTER_GAP,
  },
  letterGap: {
    marginRight: LETTER_GAP,
  },
  letterO: {
    marginLeft: LETTER_GAP - 0.5,
  },
  crossSlot: {
    marginHorizontal: LETTER_GAP - 1.5,
    marginTop: Platform.OS === "ios" ? -1 : -2,
    alignItems: "center",
    justifyContent: "center",
  },
  crossHost: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  invisibleFill: {
    opacity: 0,
  },
});
