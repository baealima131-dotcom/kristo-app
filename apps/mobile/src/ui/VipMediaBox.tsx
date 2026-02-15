import * as React from "react";
import { Image, View, StyleSheet } from "react-native";

type Props = {
  uri: string;
  width: number;
  minH?: number;
  maxH?: number;
  radius?: number;
  mode?: "auto" | "tiktok";
  height?: number;
};

// Shows image without black bars: blurred cover background + contain foreground.
// Height adapts to image ratio, clamped between minH/maxH.
export function VipMediaBox({ uri, width, minH = 220, maxH = 520, radius = 20, mode = "auto", height }: Props) {
  const [ratio, setRatio] = React.useState<number>(1); // W/H

  React.useEffect(() => {
    let alive = true;
    if (!uri) return;

    Image.getSize(
      uri,
      (W, H) => {
        if (!alive) return;
        const r = W && H ? W / H : 1;
        setRatio(r || 1);
      },
      () => {
        if (!alive) return;
        setRatio(1);
      }
    );

    return () => {
      alive = false;
    };
  }, [uri]);

  const rawH = width / Math.max(0.2, ratio);

  const tiktokH = Math.round(width * (16 / 9));


// SMART CLAMP:
// ratio = W/H
// - very tall portrait => smaller max to keep feed compact
// - landscape => slightly smaller max (avoid huge short banner)
// - normal => use provided maxH
let smartMax = maxH;
if (ratio < 0.72) smartMax = Math.min(maxH, 380); // tall portrait
else if (ratio < 0.9) smartMax = Math.min(maxH, 420); // portrait
else if (ratio > 1.35) smartMax = Math.min(maxH, 340); // landscape
else smartMax = Math.min(maxH, 420); // square-ish / normal

const desired = mode === "tiktok" ? tiktokH : Math.round(rawH);
  const computedHeight = Math.max(minH, Math.min(smartMax, desired));
  const finalH = typeof height === "number" && height > 0 ? height : computedHeight;

  return (
    <View style={[s.box, { width, height: finalH, borderRadius: radius }]}>
      {/* Blurred background fill (removes side black bars) */}
      <Image source={{ uri }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} resizeMode="cover" blurRadius={14} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.20)", borderRadius: radius }]} />

      {/* Foreground: full image visible */}
      <Image source={{ uri }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} resizeMode="contain" />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
});
