import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CHURCH_PHOTO_ASPECT,
  CHURCH_PHOTO_OUTPUT_HEIGHT,
  CHURCH_PHOTO_OUTPUT_WIDTH,
  computeChurchPhotoCrop,
} from "@/src/lib/churchPhotoFrame";

const GOLD = "#D9B35F";
const BG = "#0B0F17";
const MAX_ZOOM = 4;
/** Longest side of the working copy; keeps memory low with large camera photos. */
const WORK_MAX_SIDE = 1600;

type Props = {
  /** Local file URI picked by the Pastor; null hides the cropper. */
  sourceUri: string | null;
  onCancel: () => void;
  /** Receives a 5:8 JPEG that shows exactly what was inside the frame. */
  onDone: (croppedUri: string) => void;
};

type Work = { uri: string; width: number; height: number };

function clampWorklet(v: number, min: number, max: number) {
  "worklet";
  return Math.max(min, Math.min(max, v));
}

/**
 * Crop screen for the Church Overview picture: the frame has the Overview shape (5:8), the Pastor
 * zooms (pinch or +/-) and drags the picture; a small preview shows it at Overview size.
 */
export function ChurchPhotoCropper({ sourceUri, onCancel, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [work, setWork] = useState<Work | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const frameW = Math.round(Math.min(screenW * 0.62, screenH * 0.42 * CHURCH_PHOTO_ASPECT));
  const frameH = Math.round(frameW / CHURCH_PHOTO_ASPECT);
  // Overview: 42% of the card's content row (screen minus page and card padding).
  const previewW = Math.round((screenW - 60) * 0.42);
  const previewH = Math.round(previewW / CHURCH_PHOTO_ASPECT);
  const previewFactor = previewW / frameW;

  // "Cover" size of the picture in the frame at zoom 1.
  const base = useMemo(() => {
    if (!work) return { w: frameW, h: frameH };
    const s0 = Math.max(frameW / work.width, frameH / work.height);
    return { w: work.width * s0, h: work.height * s0 };
  }, [work, frameW, frameH]);

  const zoom = useSharedValue(1);
  const savedZoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  useEffect(() => {
    let alive = true;
    setWork(null);
    setError("");
    zoom.value = 1;
    tx.value = 0;
    ty.value = 0;
    if (!sourceUri) return;
    (async () => {
      try {
        // Applies the photo's orientation and gives the real pixel size used for cropping.
        let out = await ImageManipulator.manipulateAsync(sourceUri, [], {
          compress: 0.95,
          format: ImageManipulator.SaveFormat.JPEG,
        });
        const longest = Math.max(out.width, out.height);
        if (longest > WORK_MAX_SIDE) {
          const resize = out.width >= out.height ? { width: WORK_MAX_SIDE } : { height: WORK_MAX_SIDE };
          out = await ImageManipulator.manipulateAsync(out.uri, [{ resize }], {
            compress: 0.95,
            format: ImageManipulator.SaveFormat.JPEG,
          });
        }
        if (alive) setWork({ uri: out.uri, width: out.width, height: out.height });
      } catch {
        if (alive) setError("Picha hii haikuweza kufunguliwa. Chagua picha nyingine.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [sourceUri, zoom, tx, ty]);

  const limits = (z: number) => {
    "worklet";
    return {
      x: Math.max(0, (base.w * z - frameW) / 2),
      y: Math.max(0, (base.h * z - frameH) / 2),
    };
  };

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedZoom.value = zoom.value;
    })
    .onUpdate((e) => {
      zoom.value = clampWorklet(savedZoom.value * e.scale, 1, MAX_ZOOM);
      const l = limits(zoom.value);
      tx.value = clampWorklet(tx.value, -l.x, l.x);
      ty.value = clampWorklet(ty.value, -l.y, l.y);
    });

  const pan = Gesture.Pan()
    .onBegin(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    })
    .onUpdate((e) => {
      const l = limits(zoom.value);
      tx.value = clampWorklet(savedTx.value + e.translationX, -l.x, l.x);
      ty.value = clampWorklet(savedTy.value + e.translationY, -l.y, l.y);
    });

  const gesture = Gesture.Simultaneous(pinch, pan);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }],
  }));
  const previewStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value * previewFactor },
      { translateY: ty.value * previewFactor },
      { scale: zoom.value },
    ],
  }));

  function stepZoom(delta: number) {
    const z = Math.max(1, Math.min(MAX_ZOOM, zoom.value + delta));
    const l = limits(z);
    zoom.value = withTiming(z, { duration: 140 });
    tx.value = withTiming(Math.max(-l.x, Math.min(l.x, tx.value)), { duration: 140 });
    ty.value = withTiming(Math.max(-l.y, Math.min(l.y, ty.value)), { duration: 140 });
  }

  function resetPosition() {
    zoom.value = withTiming(1, { duration: 140 });
    tx.value = withTiming(0, { duration: 140 });
    ty.value = withTiming(0, { duration: 140 });
  }

  async function confirm() {
    if (!work || busy) return;
    setBusy(true);
    try {
      // Frame position in the picture's own pixels (the same maths as the on-screen transform).
      const crop = computeChurchPhotoCrop({
        imageWidth: work.width,
        imageHeight: work.height,
        frameWidth: frameW,
        frameHeight: frameH,
        zoom: zoom.value,
        offsetX: tx.value,
        offsetY: ty.value,
      });
      const out = await ImageManipulator.manipulateAsync(
        work.uri,
        [
          { crop },
          { resize: { width: CHURCH_PHOTO_OUTPUT_WIDTH, height: CHURCH_PHOTO_OUTPUT_HEIGHT } },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      onDone(out.uri);
    } catch {
      setError("Picha haikuweza kuhifadhiwa. Jaribu tena.");
    } finally {
      setBusy(false);
    }
  }

  const imageBox = {
    position: "absolute" as const,
    width: base.w,
    height: base.h,
    left: (frameW - base.w) / 2,
    top: (frameH - base.h) / 2,
  };
  const previewBox = {
    position: "absolute" as const,
    width: base.w * previewFactor,
    height: base.h * previewFactor,
    left: (previewW - base.w * previewFactor) / 2,
    top: (previewH - base.h * previewFactor) / 2,
  };

  return (
    <Modal visible={!!sourceUri} animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <GestureHandlerRootView style={[s.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={s.header}>
          <Pressable onPress={onCancel} hitSlop={10} style={s.headerBtn} accessibilityLabel="Cancel">
            <Text style={s.headerCancel}>Cancel</Text>
          </Pressable>
          <Text style={s.title}>Church picture</Text>
          <View style={s.headerBtn} />
        </View>
        <Text style={s.hint}>Kuza au punguza kwa vidole viwili, kisha sogeza picha mpaka uipende.</Text>

        <View style={s.stage}>
          <GestureDetector gesture={gesture}>
            <View style={[s.frame, { width: frameW, height: frameH }]}>
              {work ? (
                <Animated.Image source={{ uri: work.uri }} style={[imageBox, imageStyle]} resizeMode="stretch" />
              ) : error ? null : (
                <ActivityIndicator color={GOLD} style={{ flex: 1 }} />
              )}
            </View>
          </GestureDetector>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <View style={s.previewRow}>
          <View style={[s.previewFrame, { width: previewW, height: previewH }]}>
            {work ? <Animated.Image source={{ uri: work.uri }} style={[previewBox, previewStyle]} resizeMode="stretch" /> : null}
          </View>
          <View style={s.previewText}>
            <Text style={s.previewLabel}>Church Overview</Text>
            <Text style={s.previewSub}>Picha itaonekana hivi baada ya kuhifadhi.</Text>
            <View style={s.controls}>
              <Pressable onPress={() => stepZoom(-0.25)} style={s.roundBtn} accessibilityLabel="Zoom out" disabled={!work}>
                <Ionicons name="remove" size={22} color={GOLD} />
              </Pressable>
              <Pressable onPress={resetPosition} style={s.roundBtn} accessibilityLabel="Reset" disabled={!work}>
                <Ionicons name="refresh" size={20} color={GOLD} />
              </Pressable>
              <Pressable onPress={() => stepZoom(0.25)} style={s.roundBtn} accessibilityLabel="Zoom in" disabled={!work}>
                <Ionicons name="add" size={22} color={GOLD} />
              </Pressable>
            </View>
          </View>
        </View>

        <Pressable onPress={confirm} disabled={!work || busy} style={[s.useBtn, !work || busy ? { opacity: 0.5 } : null]}>
          {busy ? <ActivityIndicator color={BG} /> : <Text style={s.useText}>Use picture</Text>}
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: { minWidth: 64 },
  headerCancel: { color: "rgba(255,255,255,0.8)", fontSize: 15, fontWeight: "700" },
  title: { color: "#FFFFFF", fontSize: 17, fontWeight: "900" },
  hint: { color: "rgba(255,255,255,0.66)", fontSize: 13, textAlign: "center", marginTop: 10 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 10 },
  frame: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.90)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  error: { color: "#FCA5A5", fontSize: 13, textAlign: "center", marginBottom: 8 },
  controls: { flexDirection: "row", gap: 12, marginTop: 14 },
  roundBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.55)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  previewFrame: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(232,196,110,0.90)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  previewText: { flex: 1 },
  previewLabel: { color: GOLD, fontSize: 13, fontWeight: "900", letterSpacing: 0.6, textTransform: "uppercase" },
  previewSub: { color: "rgba(255,255,255,0.66)", fontSize: 12, marginTop: 4 },
  useBtn: { height: 50, borderRadius: 25, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  useText: { color: BG, fontSize: 16, fontWeight: "900" },
});
