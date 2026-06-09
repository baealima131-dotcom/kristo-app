import React, { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from "react";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
  Image,
  ScrollView,
  Modal,
  Linking,
  useWindowDimensions,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";
import { apiPost } from "@/src/lib/kristoApi";
import { buildKristoRequestHeaders } from "@/src/lib/kristoHeaders";
import {
  CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE,
  compressChurchRoomFeedImage,
} from "@/src/lib/churchRoomFeedImageCompress";

const BG = "#0B0F17";
const CARD = "rgba(255,255,255,0.03)";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "rgba(255,255,255,0.94)";
const SUB = "rgba(255,255,255,0.66)";
const GOLD = "rgba(217,179,95,0.92)";
const BLUE = "rgba(0,145,255,0.92)";
const PAD = 16;
const MAX_COMPOSER_IMAGES = 5;
const MAX_ANNOUNCEMENT_IMAGES = 3;
const MAX_TESTIMONY_IMAGES = 3;
const COMPOSER_THREE_SLOT_COUNT = 3;
const CARD_HORIZONTAL_PADDING = 18;
const SLOT_GAP = 10;
const TESTIMONY_CROP_MIN = 72;
const TESTIMONY_CROP_HANDLE = 28;
const TESTIMONY_CROP_MAX_SCALE = 5;

type ComposerCropExport = {
  originX: number;
  originY: number;
  width: number;
  height: number;
};

type ComposerTouchCropEditorRef = {
  getCropExport: () => ComposerCropExport | null;
};

function composerImageLimit(kind: "announcement" | "post" | "testimony" | "counsel") {
  if (kind === "testimony") return MAX_TESTIMONY_IMAGES;
  if (kind === "announcement") return MAX_ANNOUNCEMENT_IMAGES;
  return MAX_COMPOSER_IMAGES;
}

function composerUsesThreeSlotLayout(kind: "announcement" | "post" | "testimony" | "counsel") {
  return kind === "testimony" || kind === "announcement";
}

function composerUsesTouchCropEditor(kind: "announcement" | "post" | "testimony" | "counsel") {
  return kind === "testimony" || kind === "announcement";
}

function composerImageHint(kind: "announcement" | "post" | "testimony" | "counsel") {
  const limit = composerImageLimit(kind);
  return `Add up to ${limit} photo${limit === 1 ? "" : "s"} • Optional`;
}

function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

function computeComposerCropExport(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  baseScale: number,
  scale: number,
  translateX: number,
  translateY: number,
  cropX: number,
  cropY: number,
  cropWidth: number,
  cropHeight: number
): ComposerCropExport {
  const factor = baseScale * scale;
  const displayWidth = imageWidth * factor;
  const displayHeight = imageHeight * factor;
  const imageLeft = (viewportWidth - displayWidth) / 2 + translateX;
  const imageTop = (viewportHeight - displayHeight) / 2 + translateY;

  const originX = (cropX - imageLeft) / factor;
  const originY = (cropY - imageTop) / factor;
  const width = cropWidth / factor;
  const height = cropHeight / factor;

  const clampedOriginX = Math.max(0, Math.min(originX, imageWidth - 1));
  const clampedOriginY = Math.max(0, Math.min(originY, imageHeight - 1));
  const maxWidth = imageWidth - clampedOriginX;
  const maxHeight = imageHeight - clampedOriginY;

  return {
    originX: clampedOriginX,
    originY: clampedOriginY,
    width: Math.max(1, Math.min(width, maxWidth)),
    height: Math.max(1, Math.min(height, maxHeight)),
  };
}

async function applyComposerVisualCrop(
  sourceUri: string,
  crop: ComposerCropExport
): Promise<string> {
  const edited = await ImageManipulator.manipulateAsync(
    sourceUri,
    [
      {
        crop: {
          originX: Math.max(0, Math.round(crop.originX)),
          originY: Math.max(0, Math.round(crop.originY)),
          width: Math.max(1, Math.round(crop.width)),
          height: Math.max(1, Math.round(crop.height)),
        },
      },
    ],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  const compressed = await compressChurchRoomFeedImage(edited.uri, edited.width, edited.height);
  return compressed.uri;
}

type ComposerTouchCropEditorProps = {
  uri: string;
  viewportWidth: number;
  viewportHeight: number;
  accent: string;
  accentBorder: string;
};

const ComposerTouchCropEditor = forwardRef<
  ComposerTouchCropEditorRef,
  ComposerTouchCropEditorProps
>(function ComposerTouchCropEditor(
  { uri, viewportWidth, viewportHeight, accent, accentBorder },
  ref
) {
  const exportRef = useRef<ComposerCropExport | null>(null);
  const imageWidthRef = useRef(0);
  const imageHeightRef = useRef(0);
  const baseScaleRef = useRef(1);

  const viewportW = useSharedValue(viewportWidth);
  const viewportH = useSharedValue(viewportHeight);
  const imageW = useSharedValue(0);
  const imageH = useSharedValue(0);
  const baseScale = useSharedValue(1);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const cropX = useSharedValue(0);
  const cropY = useSharedValue(0);
  const cropW = useSharedValue(0);
  const cropH = useSharedValue(0);
  const savedCropX = useSharedValue(0);
  const savedCropY = useSharedValue(0);
  const savedCropW = useSharedValue(0);
  const savedCropH = useSharedValue(0);

  function syncExportRef(
    nextScale = scale.value,
    nextTranslateX = translateX.value,
    nextTranslateY = translateY.value,
    nextCropX = cropX.value,
    nextCropY = cropY.value,
    nextCropW = cropW.value,
    nextCropH = cropH.value
  ) {
    if (!imageWidthRef.current || !imageHeightRef.current || !nextCropW) {
      exportRef.current = null;
      return;
    }
    exportRef.current = computeComposerCropExport(
      imageWidthRef.current,
      imageHeightRef.current,
      viewportWidth,
      viewportHeight,
      baseScaleRef.current,
      nextScale,
      nextTranslateX,
      nextTranslateY,
      nextCropX,
      nextCropY,
      nextCropW,
      nextCropH
    );
  }

  function pushExportRef() {
    "worklet";
    runOnJS(syncExportRef)(
      scale.value,
      translateX.value,
      translateY.value,
      cropX.value,
      cropY.value,
      cropW.value,
      cropH.value
    );
  }

  function clampImageToCrop() {
    "worklet";
    if (!imageW.value || !imageH.value || !cropW.value || !cropH.value) return;

    const minScaleX = cropW.value / (imageW.value * baseScale.value);
    const minScaleY = cropH.value / (imageH.value * baseScale.value);
    const minScale = Math.max(minScaleX, minScaleY, 1);
    if (scale.value < minScale) scale.value = minScale;

    const factor = baseScale.value * scale.value;
    const displayWidth = imageW.value * factor;
    const displayHeight = imageH.value * factor;
    const minTx =
      cropX.value + cropW.value - displayWidth - (viewportW.value - displayWidth) / 2;
    const maxTx = cropX.value - (viewportW.value - displayWidth) / 2;
    const minTy =
      cropY.value + cropH.value - displayHeight - (viewportH.value - displayHeight) / 2;
    const maxTy = cropY.value - (viewportH.value - displayHeight) / 2;

    translateX.value = Math.max(minTx, Math.min(maxTx, translateX.value));
    translateY.value = Math.max(minTy, Math.min(maxTy, translateY.value));
  }

  useEffect(() => {
    viewportW.value = viewportWidth;
    viewportH.value = viewportHeight;
  }, [viewportHeight, viewportWidth, viewportH, viewportW]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { width, height } = await getImageDimensions(uri);
        if (cancelled || !width || !height) return;

        imageWidthRef.current = width;
        imageHeightRef.current = height;

        const fitScale = Math.min(viewportWidth / width, viewportHeight / height);
        baseScaleRef.current = fitScale;

        const initialCropSize = Math.min(viewportWidth, viewportHeight) * 0.78;
        const initialCropW = initialCropSize;
        const initialCropH = initialCropSize;

        imageW.value = width;
        imageH.value = height;
        baseScale.value = fitScale;
        scale.value = 1;
        savedScale.value = 1;
        translateX.value = 0;
        translateY.value = 0;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        cropW.value = initialCropW;
        cropH.value = initialCropH;
        cropX.value = (viewportWidth - initialCropW) / 2;
        cropY.value = (viewportHeight - initialCropH) / 2;

        clampImageToCrop();
        syncExportRef();
      } catch {
        exportRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    uri,
    viewportHeight,
    viewportWidth,
    baseScale,
    cropH,
    cropW,
    cropX,
    cropY,
    imageH,
    imageW,
    savedScale,
    savedTranslateX,
    savedTranslateY,
    scale,
    translateX,
    translateY,
  ]);

  useImperativeHandle(ref, () => ({
    getCropExport: () => {
      syncExportRef();
      return exportRef.current;
    },
  }));

  const imageAnimatedStyle = useAnimatedStyle(() => {
    const factor = baseScale.value * scale.value;
    const displayWidth = imageW.value * factor;
    const displayHeight = imageH.value * factor;

    return {
      width: displayWidth,
      height: displayHeight,
      left: (viewportW.value - displayWidth) / 2 + translateX.value,
      top: (viewportH.value - displayHeight) / 2 + translateY.value,
    };
  });

  const topMaskStyle = useAnimatedStyle(() => ({
    top: 0,
    left: 0,
    width: viewportW.value,
    height: Math.max(0, cropY.value),
  }));

  const bottomMaskStyle = useAnimatedStyle(() => ({
    top: cropY.value + cropH.value,
    left: 0,
    width: viewportW.value,
    height: Math.max(0, viewportH.value - (cropY.value + cropH.value)),
  }));

  const leftMaskStyle = useAnimatedStyle(() => ({
    top: cropY.value,
    left: 0,
    width: Math.max(0, cropX.value),
    height: cropH.value,
  }));

  const rightMaskStyle = useAnimatedStyle(() => ({
    top: cropY.value,
    left: cropX.value + cropW.value,
    width: Math.max(0, viewportW.value - (cropX.value + cropW.value)),
    height: cropH.value,
  }));

  const frameTouchStyle = useAnimatedStyle(() => ({
    left: cropX.value - 16,
    top: cropY.value - 16,
    width: cropW.value + 32,
    height: cropH.value + 32,
  }));

  const frameStyle = useAnimatedStyle(() => ({
    left: 16,
    top: 16,
    width: cropW.value,
    height: cropH.value,
  }));

  function makeCornerGesture(
    corner: "tl" | "tr" | "bl" | "br"
  ) {
    return Gesture.Pan()
      .onBegin(() => {
        savedCropX.value = cropX.value;
        savedCropY.value = cropY.value;
        savedCropW.value = cropW.value;
        savedCropH.value = cropH.value;
      })
      .onUpdate((event) => {
        if (corner === "br") {
          cropW.value = Math.max(
            TESTIMONY_CROP_MIN,
            Math.min(savedCropW.value + event.translationX, viewportW.value - cropX.value)
          );
          cropH.value = Math.max(
            TESTIMONY_CROP_MIN,
            Math.min(savedCropH.value + event.translationY, viewportH.value - cropY.value)
          );
        } else if (corner === "bl") {
          const nextX = Math.max(
            0,
            Math.min(savedCropX.value + event.translationX, savedCropX.value + savedCropW.value - TESTIMONY_CROP_MIN)
          );
          cropW.value = savedCropW.value + (savedCropX.value - nextX);
          cropX.value = nextX;
          cropH.value = Math.max(
            TESTIMONY_CROP_MIN,
            Math.min(savedCropH.value + event.translationY, viewportH.value - cropY.value)
          );
        } else if (corner === "tr") {
          cropW.value = Math.max(
            TESTIMONY_CROP_MIN,
            Math.min(savedCropW.value + event.translationX, viewportW.value - cropX.value)
          );
          const nextY = Math.max(
            0,
            Math.min(savedCropY.value + event.translationY, savedCropY.value + savedCropH.value - TESTIMONY_CROP_MIN)
          );
          cropH.value = savedCropH.value + (savedCropY.value - nextY);
          cropY.value = nextY;
        } else {
          const nextX = Math.max(
            0,
            Math.min(savedCropX.value + event.translationX, savedCropX.value + savedCropW.value - TESTIMONY_CROP_MIN)
          );
          const nextY = Math.max(
            0,
            Math.min(savedCropY.value + event.translationY, savedCropY.value + savedCropH.value - TESTIMONY_CROP_MIN)
          );
          cropW.value = savedCropW.value + (savedCropX.value - nextX);
          cropH.value = savedCropH.value + (savedCropY.value - nextY);
          cropX.value = nextX;
          cropY.value = nextY;
        }
      })
      .onEnd(() => {
        clampImageToCrop();
        pushExportRef();
      });
  }

  const frameMoveGesture = Gesture.Pan()
    .onBegin(() => {
      savedCropX.value = cropX.value;
      savedCropY.value = cropY.value;
    })
    .onUpdate((event) => {
      cropX.value = Math.max(
        0,
        Math.min(savedCropX.value + event.translationX, viewportW.value - cropW.value)
      );
      cropY.value = Math.max(
        0,
        Math.min(savedCropY.value + event.translationY, viewportH.value - cropH.value)
      );
    })
    .onEnd(() => {
      clampImageToCrop();
      pushExportRef();
    });

  const imagePanGesture = Gesture.Pan()
    .onBegin(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      clampImageToCrop();
      pushExportRef();
    });

  const imagePinchGesture = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.max(
        1,
        Math.min(savedScale.value * event.scale, TESTIMONY_CROP_MAX_SCALE)
      );
    })
    .onEnd(() => {
      clampImageToCrop();
      pushExportRef();
    });

  const imageGestures = Gesture.Simultaneous(imagePanGesture, imagePinchGesture);

  const tlHandleStyle = useAnimatedStyle(() => ({
    left: cropX.value - TESTIMONY_CROP_HANDLE / 2,
    top: cropY.value - TESTIMONY_CROP_HANDLE / 2,
  }));
  const trHandleStyle = useAnimatedStyle(() => ({
    left: cropX.value + cropW.value - TESTIMONY_CROP_HANDLE / 2,
    top: cropY.value - TESTIMONY_CROP_HANDLE / 2,
  }));
  const blHandleStyle = useAnimatedStyle(() => ({
    left: cropX.value - TESTIMONY_CROP_HANDLE / 2,
    top: cropY.value + cropH.value - TESTIMONY_CROP_HANDLE / 2,
  }));
  const brHandleStyle = useAnimatedStyle(() => ({
    left: cropX.value + cropW.value - TESTIMONY_CROP_HANDLE / 2,
    top: cropY.value + cropH.value - TESTIMONY_CROP_HANDLE / 2,
  }));

  return (
    <View style={[cropStyles.viewport, { width: viewportWidth, height: viewportHeight }]}>
      <GestureDetector gesture={imageGestures}>
        <Animated.View style={cropStyles.imageLayer}>
          <Animated.Image
            source={{ uri }}
            style={[cropStyles.image, imageAnimatedStyle]}
            resizeMode="cover"
          />
        </Animated.View>
      </GestureDetector>

      <View style={cropStyles.overlay} pointerEvents="box-none">
        <Animated.View style={[cropStyles.mask, topMaskStyle]} pointerEvents="none" />
        <Animated.View style={[cropStyles.mask, bottomMaskStyle]} pointerEvents="none" />
        <Animated.View style={[cropStyles.mask, leftMaskStyle]} pointerEvents="none" />
        <Animated.View style={[cropStyles.mask, rightMaskStyle]} pointerEvents="none" />

        <GestureDetector gesture={frameMoveGesture}>
          <Animated.View style={[cropStyles.frameTouch, frameTouchStyle]}>
            <Animated.View style={[cropStyles.frame, frameStyle, { borderColor: accent }]}>
              <View style={[cropStyles.gridLineH, cropStyles.gridLineTop]} />
              <View style={[cropStyles.gridLineH, cropStyles.gridLineBottom]} />
              <View style={[cropStyles.gridLineV, cropStyles.gridLineLeft]} />
              <View style={[cropStyles.gridLineV, cropStyles.gridLineRight]} />
            </Animated.View>
          </Animated.View>
        </GestureDetector>

        <GestureDetector gesture={makeCornerGesture("tl")}>
          <Animated.View style={[cropStyles.handleHit, tlHandleStyle]}>
            <View style={[cropStyles.handleDot, { backgroundColor: accent, borderColor: accentBorder }]} />
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={makeCornerGesture("tr")}>
          <Animated.View style={[cropStyles.handleHit, trHandleStyle]}>
            <View style={[cropStyles.handleDot, { backgroundColor: accent, borderColor: accentBorder }]} />
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={makeCornerGesture("bl")}>
          <Animated.View style={[cropStyles.handleHit, blHandleStyle]}>
            <View style={[cropStyles.handleDot, { backgroundColor: accent, borderColor: accentBorder }]} />
          </Animated.View>
        </GestureDetector>
        <GestureDetector gesture={makeCornerGesture("br")}>
          <Animated.View style={[cropStyles.handleHit, brHandleStyle]}>
            <View style={[cropStyles.handleDot, { backgroundColor: accent, borderColor: accentBorder }]} />
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
});

const cropStyles = StyleSheet.create({
  viewport: {
    overflow: "hidden",
    backgroundColor: "#05080E",
  } as ViewStyle,
  imageLayer: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  image: {
    position: "absolute",
  } as ViewStyle,
  overlay: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  mask: {
    position: "absolute",
    backgroundColor: "rgba(0,0,0,0.58)",
  } as ViewStyle,
  frameTouch: {
    position: "absolute",
  } as ViewStyle,
  frame: {
    position: "absolute",
    borderWidth: 2,
  } as ViewStyle,
  gridLineH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.28)",
  } as ViewStyle,
  gridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(255,255,255,0.28)",
  } as ViewStyle,
  gridLineTop: {
    top: "33.33%",
  } as ViewStyle,
  gridLineBottom: {
    top: "66.66%",
  } as ViewStyle,
  gridLineLeft: {
    left: "33.33%",
  } as ViewStyle,
  gridLineRight: {
    left: "66.66%",
  } as ViewStyle,
  handleHit: {
    position: "absolute",
    width: TESTIMONY_CROP_HANDLE,
    height: TESTIMONY_CROP_HANDLE,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  handleDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: "#FFFFFF",
  } as ViewStyle,
});


function stripGarbageLines(input: string) {
  return String(input || "")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;

      // shell / terminal noise
      if (/^.*princefariji@.*%.*$/i.test(t)) return false;
      if (/^>\.{3,}/.test(t)) return false;
      if (/^NODE$/i.test(t)) return false;
      if (/^Patched:/i.test(t)) return false;
      if (/^Found \d+ errors?/i.test(t)) return false;
      if (/^npm run /i.test(t)) return false;
      if (/^npx expo start/i.test(t)) return false;
      if (/^env:/i.test(t)) return false;
      if (/^Starting project at /i.test(t)) return false;
      if (/^Starting Metro Bundler/i.test(t)) return false;
      if (/^warning:/i.test(t)) return false;
      if (/^iOS Bundled /i.test(t)) return false;
      if (/^› /.test(t)) return false;
      if (/^echo "/.test(t)) return false;
      if (/^nl -ba /.test(t)) return false;
      if (/^cd ~?\//.test(t)) return false;
      if (/^F="/.test(t)) return false;
      if (/^fs\.writeFileSync\(/.test(t)) return false;
      if (/^console\.log\(/.test(t)) return false;

      // obvious JS / TS / JSX / patch fragments
      if (/^(const|let|var)\s+/.test(t)) return false;
      if (/^(if|else|return|function)\b/.test(t)) return false;
      if (/^s\s*=\s*s\.replace\(/.test(t)) return false;
      if (/^\.replace\(/.test(t)) return false;
      if (/^renderItem=\{/.test(t)) return false;
      if (/^contentContainerStyle=\{/.test(t)) return false;
      if (/^ItemSeparatorComponent=\{/.test(t)) return false;
      if (/^showsVerticalScrollIndicator=\{false\}/.test(t)) return false;
      if (/^keyExtractor=\{/.test(t)) return false;
      if (/^data=\{data\}/.test(t)) return false;
      if (/^onPress=\{/.test(t)) return false;

      // jsx-ish tags
      if (/^<\/?[A-Za-z]/.test(t)) return false;
      if (/style=\{styles\./.test(t)) return false;

      // style object fragments / code symbols
      if (/^(alignItems|justifyContent|fontWeight|fontSize|lineHeight|textAlign|paddingHorizontal|paddingVertical|borderRadius|minWidth|borderWidth|borderColor|backgroundColor|marginTop|marginBottom)\s*:/.test(t)) return false;
      if (/^[{}()[\];,]+$/.test(t)) return false;

      return true;
    })
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanComposerText(input: string) {
  return stripGarbageLines(input);
}

function cleanSingleLine(input: string) {
  return cleanComposerText(input)
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function photoPermissionAllowsPicker(perm: ImagePicker.MediaLibraryPermissionResponse) {
  if (perm.granted) return true;
  if ((perm as any).accessPrivileges === "limited") return true;
  return false;
}

function photoPermissionDeniedMessage(kind: "announcement" | "post" | "testimony" | "counsel") {
  return kind === "testimony"
    ? "Photo access is required to add testimony images."
    : "Photo access is required to add images.";
}

export default function CreateAnnouncement() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams();
  const kindParam = String((params as any)?.kind || "announcement");
  const kind = (["announcement","post","testimony","counsel"].includes(kindParam) ? kindParam : "announcement") as "announcement" | "post" | "testimony" | "counsel";

  const accent = kind === "testimony" ? BLUE : GOLD;
  const accentSoft = kind === "testimony" ? "rgba(0,145,255,0.12)" : "rgba(217,179,95,0.12)";
  const accentBorder = kind === "testimony" ? "rgba(0,145,255,0.35)" : "rgba(217,179,95,0.35)";
  const accentStrong = kind === "testimony" ? "rgba(0,145,255,0.95)" : "rgba(217,179,95,0.95)";

  // Post destination: home (Global Feed) vs church (Church Feed)
  const [postTarget, setPostTarget] = useState<"home" | "church">("home");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [photoPermissionModalOpen, setPhotoPermissionModalOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imagePreviewUri, setImagePreviewUri] = useState<string | null>(null);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  const [imageEditSaving, setImageEditSaving] = useState(false);
  const [imageCropViewport, setImageCropViewport] = useState({ width: 0, height: 0 });
  const composerCropEditorRef = useRef<ComposerTouchCropEditorRef>(null);

  const maxComposerImages = composerImageLimit(kind);

  const ACCENT = kind === "testimony" ? BLUE : GOLD;
  const ACCENT_BG = kind === "testimony" ? "rgba(0,145,255,0.12)" : "rgba(217,179,95,0.12)";
  const ACCENT_BORDER = kind === "testimony" ? "rgba(0,145,255,0.35)" : "rgba(217,179,95,0.35)";
  const ACCENT_SOFT = kind === "testimony" ? "rgba(0,145,255,0.18)" : "rgba(217,179,95,0.18)";
  const session = getSessionSync() as any;

  const profileName =
    String(
      session?.name ||
      session?.fullName ||
      session?.displayName ||
      session?.email ||
      "Member"
    ).trim();

  const profileAvatar =
    String(
      session?.avatarUri ||
      session?.avatarUrl ||
      session?.photoURL ||
      session?.image ||
      ""
    ).trim();



  async function addPickedAssets(assets: any[]) {
    const compressedUris: string[] = [];

    for (const asset of assets) {
      const uri = String(asset?.uri || "").trim();
      if (!uri) continue;

      try {
        const compressed = await compressChurchRoomFeedImage(
          uri,
          asset?.width,
          asset?.height
        );
        compressedUris.push(compressed.uri);
      } catch (compressErr) {
        const message =
          compressErr instanceof Error
            ? compressErr.message
            : CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE;
        setErr(message);
        return;
      }
    }

    if (!compressedUris.length) return;
    setErr(null);
    setImages((prev) => {
      const next = Array.from(new Set([...prev, ...compressedUris])).slice(0, maxComposerImages);
      console.log("KRISTO_POST_COMPOSER_IMAGES_SELECTED", {
        count: next.length,
        uris: next,
      });
      return next;
    });
  }

  async function launchImagePicker() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ((ImagePicker as any).MediaType?.Images ?? (ImagePicker as any).MediaTypeOptions?.Images),
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: maxComposerImages,
    });

    if ((res as any).canceled) return;

    const assets = (res as any).assets || [];
    if (!assets.length) return;

    await addPickedAssets(assets);
  }

  async function uploadChurchRoomFeedImage(
    localUri: string
  ): Promise<{ mediaUri: string; imageUrl: string } | null> {
    try {
      const fd = new FormData();
      fd.append("file", {
        uri: localUri,
        name: `church-room-${Date.now()}.jpg`,
        type: "image/jpeg",
      } as any);

      const session = getSessionSync();
      const uploadRes: any = await apiPost("/api/church/media/upload", fd, {
        headers: buildKristoRequestHeaders(
          "/api/church/media/upload",
          {
            userId: String(session?.userId || "").trim(),
            role: (session?.role || "Member") as any,
            churchId: String(session?.churchId || "").trim(),
            sessionToken: session?.sessionToken,
          },
          { accept: "application/json" },
          "ChurchRoomImageUpload"
        ),
      });

      const status = Number(uploadRes?.status || 0) || null;
      const mediaUri = String(
        uploadRes?.data?.mediaUri || uploadRes?.data?.url || uploadRes?.data?.imageUrl || ""
      ).trim();
      const imageUrl = String(
        uploadRes?.data?.imageUrl || uploadRes?.data?.url || mediaUri
      ).trim();

      const failed =
        uploadRes?.ok === false ||
        (typeof status === "number" && status >= 400) ||
        !mediaUri ||
        !imageUrl;

      if (failed) {
        console.warn("KRISTO_CHURCH_ROOM_IMAGE_UPLOAD_FAILED", {
          status,
          error: String(uploadRes?.error || "missing mediaUri/imageUrl").trim(),
          detail: String(uploadRes?.detail || uploadRes?.debug || "").trim() || null,
          reason: String(uploadRes?.reason || "").trim() || null,
        });
        return null;
      }

      return { mediaUri, imageUrl };
    } catch (error) {
      console.warn("KRISTO_CHURCH_ROOM_IMAGE_UPLOAD_FAILED", {
        status: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async function uploadAllChurchRoomFeedImages(localUris: string[]): Promise<string[] | null> {
    const uploadedUrls: string[] = [];
    for (const localUri of localUris) {
      const uploaded = await uploadChurchRoomFeedImage(localUri);
      if (!uploaded?.mediaUri || !uploaded?.imageUrl) {
        return null;
      }
      uploadedUrls.push(String(uploaded.imageUrl || uploaded.mediaUri).trim());
    }
    return uploadedUrls;
  }

  async function ensurePhotoPermission() {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();

    if (photoPermissionAllowsPicker(current)) {
      return true;
    }

    if (current.status === ImagePicker.PermissionStatus.UNDETERMINED) {
      const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (photoPermissionAllowsPicker(requested)) {
        return true;
      }

      setErr(photoPermissionDeniedMessage(kind));
      setPhotoPermissionModalOpen(true);
      return false;
    }

    setErr(photoPermissionDeniedMessage(kind));
    setPhotoPermissionModalOpen(true);
    return false;
  }

  async function pickImages() {
    try {
      const allowed = await ensurePhotoPermission();
      if (!allowed) return;

      await launchImagePicker();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to pick images");
    }
  }

  async function retryPhotoPermissionFromModal() {
    setPhotoPermissionModalOpen(false);

    const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (photoPermissionAllowsPicker(requested)) {
      setErr(null);
      await launchImagePicker();
      return;
    }

    setErr(photoPermissionDeniedMessage(kind));
    setPhotoPermissionModalOpen(true);
  }

  async function openPhotoSettings() {
    setPhotoPermissionModalOpen(false);
    try {
      await Linking.openSettings();
    } catch {
      setErr(photoPermissionDeniedMessage(kind));
    }
  }

  function removeImage(uri: string) {
    setImages((prev) => prev.filter((u) => u !== uri));
  }

  function openComposerImagePreview(uri: string, slotIndex: number) {
    setImagePreviewUri(uri);
    setImagePreviewIndex(slotIndex);
    setImagePreviewOpen(true);
  }

  function closeComposerImagePreview() {
    if (imageEditSaving) return;
    setImagePreviewOpen(false);
    setImagePreviewUri(null);
    setImagePreviewIndex(null);
  }

  async function saveComposerImageEdit() {
    const sourceUri = String(imagePreviewUri || "").trim();
    const slotIndex = imagePreviewIndex;
    if (!sourceUri || slotIndex == null) return;

    try {
      setImageEditSaving(true);
      setErr(null);
      const cropExport = composerCropEditorRef.current?.getCropExport();
      if (!cropExport) {
        setErr(CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE);
        return;
      }
      const editedUri = await applyComposerVisualCrop(sourceUri, cropExport);
      setImages((prev) => {
        const next = [...prev];
        next[slotIndex] = editedUri;
        return next.slice(0, maxComposerImages);
      });
      setImagePreviewOpen(false);
      setImagePreviewUri(null);
      setImagePreviewIndex(null);
    } catch (editErr) {
      const message =
        editErr instanceof Error
          ? editErr.message
          : CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE;
      setErr(message);
    } finally {
      setImageEditSaving(false);
    }
  }

  function removeComposerPreviewImage() {
    const sourceUri = String(imagePreviewUri || "").trim();
    if (!sourceUri) return;
    removeImage(sourceUri);
    closeComposerImagePreview();
  }

  const threeSlotSize = useMemo(() => {
    if (!composerUsesThreeSlotLayout(kind)) return 84;
    const cardInnerWidth = windowWidth - PAD * 2 - CARD_HORIZONTAL_PADDING * 2;
    return Math.floor(
      (cardInnerWidth - SLOT_GAP * (COMPOSER_THREE_SLOT_COUNT - 1)) / COMPOSER_THREE_SLOT_COUNT
    );
  }, [kind, windowWidth]);

  function renderImageSlot(
    slotIndex: number,
    slotSize: number,
    slotStyle?: ViewStyle
  ) {
    const uri = images[slotIndex];
    const slotRadius = Math.max(18, Math.round(slotSize * 0.24));
    const usesTouchCropEditor = composerUsesTouchCropEditor(kind) && Boolean(uri);

    if (uri) {
      return (
        <View
          key={`filled-${uri}-${slotIndex}`}
          style={[
            s.slot,
            {
              width: slotSize,
              height: slotSize,
              borderRadius: slotRadius,
              borderColor: accentBorder,
            },
            slotStyle,
          ]}
        >
          <Pressable
            onPress={
              usesTouchCropEditor
                ? () => openComposerImagePreview(uri, slotIndex)
                : () => removeImage(uri)
            }
            style={s.slotTapArea}
          >
            <Image source={{ uri }} style={s.slotImg} />
          </Pressable>
          <Pressable
            onPress={() => removeImage(uri)}
            style={[s.slotX, { backgroundColor: accentStrong }]}
            hitSlop={8}
          >
            <Ionicons name="close" size={14} color="#0B0F17" />
          </Pressable>
        </View>
      );
    }

    return (
      <Pressable
        key={`empty-${slotIndex}`}
        onPress={pickImages}
        style={[
          s.slotEmpty,
          {
            width: slotSize,
            height: slotSize,
            borderRadius: slotRadius,
            borderColor: accentBorder,
            backgroundColor: accentSoft,
          },
          slotStyle,
        ]}
      >
        <Ionicons name="add" size={20} color={accent} />
      </Pressable>
    );
  }

  async function submit() {
    const t0 = cleanSingleLine(title);
    const b0 = cleanComposerText(body);

    if (!t0) {
      setErr("Title is required");
      return;
    }

    if (!b0) {
      setErr(kind === "testimony" ? "Testimony is required" : kind === "counsel" ? "Details are required" : "Message is required");
      return;
    }

    if (images.length > maxComposerImages) {
      setErr(`You can add up to ${maxComposerImages} images.`);
      return;
    }

    try {
      setSaving(true);
      setErr(null);

      const feedType = kind === "announcement" ? "announcement" : "post";

      let mediaUri = "";
      let imageUrl = "";
      let mediaType = "none";
      let uploadedImageUrls: string[] = [];

      if (images.length > 0) {
        console.log("KRISTO_POST_COMPOSER_IMAGES_SELECTED", {
          count: images.length,
          uris: images,
        });
        uploadedImageUrls = (await uploadAllChurchRoomFeedImages(images)) || [];
        if (uploadedImageUrls.length !== images.length) {
          setErr("Image upload failed. Please try again.");
          return;
        }
        console.log("KRISTO_POST_CREATE_IMAGES_UPLOAD_DONE", {
          count: uploadedImageUrls.length,
          urls: uploadedImageUrls,
        });
        mediaUri = uploadedImageUrls[0];
        imageUrl = uploadedImageUrls[0];
        mediaType = "image";
      }

      const imagePayload =
        uploadedImageUrls.length > 0
          ? {
              mediaUri,
              imageUrl,
              mediaType,
              images: uploadedImageUrls,
              mediaUrls: uploadedImageUrls,
              attachments: uploadedImageUrls.map((url) => ({
                url,
                uri: url,
                imageUrl: url,
                type: "image",
                mimeType: "image/jpeg",
              })),
            }
          : { mediaType };

      if (uploadedImageUrls.length > 0) {
        console.log("KRISTO_POST_CREATE_PAYLOAD_IMAGES", {
          imagesCount: uploadedImageUrls.length,
          attachmentsCount: uploadedImageUrls.length,
          hasImageUrl: Boolean(imageUrl),
        });
      }

      const feedRes: any = await apiPost(
        "/api/church/feed",
        {
          action: "create_post",
          type: feedType,
          title: t0,
          text: b0,
          body: b0,
          ...imagePayload,
          postType: kind,
          kind,
          source: kind,
          visibility: postTarget === "home" ? "global" : "church",
          authorName: profileName,
          authorUserId: String(session?.userId || "").trim() || undefined,
          actorLabel: profileName,
          actorAvatarUri: profileAvatar || undefined,
          authorAvatarUri: profileAvatar || undefined,
        },
        {
          headers: buildKristoRequestHeaders(
            "/api/church/feed",
            {
              userId: String(session?.userId || "").trim(),
              role: (session?.role || "Member") as any,
              churchId: String(session?.churchId || "").trim(),
              sessionToken: session?.sessionToken,
            },
            undefined,
            "ChurchRoomFeedPublish"
          ),
        }
      );

      if (feedRes?.ok === false || Number(feedRes?.status || 0) >= 400) {
        setErr("Failed to publish post. Please try again.");
        return;
      }

      router.replace("/(tabs)");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create";
      setErr(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top + 10 }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.back}>
          <Ionicons name="chevron-back" size={20} color={TEXT} />
        </Pressable>
        <Text style={[t.title, { color: kind === "testimony" ? "rgba(235,245,255,0.98)" : "white" }]}>
  Create {kind === "testimony" ? "Testimony" : kind === "counsel" ? "Counsel" : kind === "post" ? "Post" : "Announcement"}
</Text>
      </View>

      
      <View style={{ paddingHorizontal: PAD, paddingBottom: 6 }}>
        <Text style={[t.subTitle, { color: ACCENT }]}>{"Admin Composer • Posts to " + (postTarget === "home" ? "Global Feed" : "Church Feed")}</Text>

        <View style={s.toggleRow}>
          <Pressable
            onPress={() => setPostTarget("church")}
            style={[s.toggleBtn, postTarget === "church" ? { backgroundColor: "rgba(217,179,95,0.18)", borderColor: accentBorder } : null]}
          >
            <Text style={[t.toggleText, postTarget === "church" ? { color: accent } : null]}>Church Feed</Text>
          </Pressable>

          <Pressable
            onPress={() => setPostTarget("home")}
            style={[s.toggleBtn, postTarget === "home" ? { backgroundColor: "rgba(217,179,95,0.18)", borderColor: accentBorder } : null]}
          >
            <Text style={[t.toggleText, postTarget === "home" ? { color: accent } : null]}>Global Feed</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          padding: PAD,
          gap: 12,
          paddingBottom: Math.max(insets.bottom + 24, 48),
        }}
      >
        <View style={[s.card, { borderColor: accentBorder, shadowColor: accent }]} >
          <Text style={t.label}>Title</Text>
          <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.035)", marginTop: 8, marginBottom: 8 }} />
<TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={kind === "testimony" ? "Example: My Testimony" : kind === "counsel" ? "Example: Need Counsel" : kind === "post" ? "Example: Update" : "Example: Sunday Service"}
            placeholderTextColor="rgba(255,255,255,0.28)"
            style={s.input}
          />
        </View>

        <View style={[s.card, { borderColor: accentBorder, shadowColor: accent }]} >
          <Text style={t.label}>{kind === "testimony" ? "Testimony" : kind === "counsel" ? "Details" : "Message"}</Text>
          <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.035)", marginTop: 8, marginBottom: 8 }} />
<TextInput
            value={body}
            onChangeText={setBody}
            placeholder={kind === "testimony" ? "Write your testimony…" : kind === "counsel" ? "Explain what you need…" : kind === "post" ? "Write your update…" : "Write announcement…"}
            placeholderTextColor="rgba(255,255,255,0.28)"
            style={[s.input, { height: 120, textAlignVertical: "top" }]}
            multiline
          />
        </View>

        {err ? <Text style={t.err}>{err}</Text> : null}

        
        {/* Add Images */}
        <View style={[s.card, { borderColor: accentBorder, shadowColor: accent }]} >
          <View style={s.imgRow}>
            <View style={{ flex: 1 }}>
              <Text style={t.label}>Images</Text>
              <Text style={t.imgHint}>{composerImageHint(kind)}</Text>
            </View>

            {images.length < maxComposerImages ? (
            <Pressable onPress={pickImages} style={({ pressed }) => [s.imgBtn, { borderColor: accentBorder, backgroundColor: "rgba(217,179,95,0.18)" }, pressed ? { opacity: 0.9 } : null]}>
              <Ionicons name="image" size={16} color={accent} />
              <Text style={[t.imgBtnText, { color: accent }]}>Add</Text>
            </Pressable>
            ) : null}
          </View>

          
          {composerUsesThreeSlotLayout(kind) ? (
            <View style={[s.slotsRow, s.slotsRowTestimony]}>
              {Array.from({ length: COMPOSER_THREE_SLOT_COUNT }, (_, i) => i).map((i) =>
                renderImageSlot(i, threeSlotSize)
              )}
            </View>
          ) : (
            <View style={s.slotsRow}>
              {Array.from({ length: MAX_COMPOSER_IMAGES }, (_, i) => i).map((i) =>
                renderImageSlot(i, 84)
              )}
            </View>
          )}

        </View>
      </ScrollView>

      <View style={[s.bottomDock, { paddingBottom: Math.max(insets.bottom + 10, 18) }]}>
        <Pressable
          onPress={submit}
          disabled={saving}
          style={[
            s.btn,
            { backgroundColor: accent },
            saving ? { opacity: 0.55 } : null,
          ]}
        >
          <Text style={t.btnText}>{saving ? "Saving…" : "Publish"}</Text>
        </Pressable>
      </View>

      <Modal
        visible={photoPermissionModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoPermissionModalOpen(false)}
      >
        <View style={s.permissionOverlay}>
          <Pressable style={s.permissionBackdrop} onPress={() => setPhotoPermissionModalOpen(false)} />
          <View style={[s.permissionCard, { borderColor: accentBorder }]}>
            <View style={[s.permissionIconWrap, { backgroundColor: accentSoft, borderColor: accentBorder }]}>
              <Ionicons name="images-outline" size={24} color={accent} />
            </View>
            <Text style={s.permissionTitle}>Allow photo access</Text>
            <Text style={s.permissionBody}>{photoPermissionDeniedMessage(kind)}</Text>

            <Pressable
              onPress={() => void retryPhotoPermissionFromModal()}
              style={({ pressed }) => [s.permissionPrimaryBtn, { backgroundColor: accent }, pressed ? { opacity: 0.92 } : null]}
            >
              <Text style={s.permissionPrimaryText}>Allow photo access</Text>
            </Pressable>

            <Pressable
              onPress={() => void openPhotoSettings()}
              style={({ pressed }) => [s.permissionSecondaryBtn, { borderColor: accentBorder }, pressed ? { opacity: 0.92 } : null]}
            >
              <Text style={[s.permissionSecondaryText, { color: accent }]}>Open Settings</Text>
            </Pressable>

            <Pressable
              onPress={() => setPhotoPermissionModalOpen(false)}
              style={({ pressed }) => [s.permissionCancelBtn, pressed ? { opacity: 0.88 } : null]}
            >
              <Text style={s.permissionCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={composerUsesTouchCropEditor(kind) && imagePreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={closeComposerImagePreview}
      >
        <View style={s.editOverlay}>
          <View style={[s.editHeader, { paddingTop: insets.top + 10 }]}>
            <Pressable
              onPress={closeComposerImagePreview}
              disabled={imageEditSaving}
              style={s.editHeaderBtn}
              accessibilityLabel="Cancel"
            >
              <Ionicons name="close" size={22} color={TEXT} />
            </Pressable>
            <View style={s.editHeaderSpacer} />
            <Pressable
              onPress={() => void saveComposerImageEdit()}
              disabled={imageEditSaving}
              style={({ pressed }) => [
                s.editSaveBtn,
                { backgroundColor: accent },
                imageEditSaving || pressed ? { opacity: 0.88 } : null,
              ]}
              accessibilityLabel="Save"
            >
              {imageEditSaving ? (
                <ActivityIndicator size="small" color="#08111D" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={18} color="#08111D" />
                  <Text style={s.editSaveText}>Save</Text>
                </>
              )}
            </Pressable>
          </View>

          <View
            style={s.editPreviewWrap}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              if (width > 0 && height > 0) {
                setImageCropViewport({ width, height });
              }
            }}
          >
            {imagePreviewUri && imageCropViewport.width > 0 ? (
              <ComposerTouchCropEditor
                ref={composerCropEditorRef}
                uri={imagePreviewUri}
                viewportWidth={imageCropViewport.width}
                viewportHeight={imageCropViewport.height}
                accent={accent}
                accentBorder={accentBorder}
              />
            ) : null}
          </View>

          <View style={[s.editPanel, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
            <Pressable
              onPress={removeComposerPreviewImage}
              disabled={imageEditSaving}
              style={({ pressed }) => [
                s.editRemoveBtn,
                { borderColor: accentBorder },
                pressed ? { opacity: 0.9 } : null,
              ]}
              accessibilityLabel="Remove image"
            >
              <Ionicons name="trash-outline" size={18} color="rgba(255,120,120,0.92)" />
              <Text style={s.editRemoveText}>Remove Image</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  bottomDock: {
    paddingHorizontal: PAD,
    paddingTop: 10,
    backgroundColor: "rgba(11,15,23,0.985)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.045)",
  } as ViewStyle,
  screen: { flex: 1, backgroundColor: BG } as ViewStyle,
  header: {
    paddingHorizontal: PAD,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  } as ViewStyle,
  toggleRow: { flexDirection: "row", gap: 10, marginTop: 10 } as ViewStyle,
  toggleBtn: {
    flex: 1,
    height: 46,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.022)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
    back: {
    width: 42,
    height: 42,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  card: {
    backgroundColor: "rgba(255,255,255,0.020)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    borderRadius: 28,
    padding: 18,
    shadowColor: GOLD,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    overflow: "hidden",
  } as ViewStyle,
  imgRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 } as ViewStyle,
  imgBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: BORDER,
  } as ViewStyle,
  imgStrip: { paddingTop: 10, paddingBottom: 2, gap: 10 } as any,
  thumbWrap: { width: 74, height: 74, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" } as ViewStyle,
  thumb: { width: "100%", height: "100%" } as any,
  thumbX: { position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: GOLD } as ViewStyle,
  slotsRow: {
    flexDirection: "row",
    gap: SLOT_GAP,
    justifyContent: "center",
    alignSelf: "stretch",
  } as ViewStyle,
  slotsRowTestimony: {
    marginTop: 12,
  } as ViewStyle,
  slot: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(255,255,255,0.028)",
  } as ViewStyle,
  slotTapArea: {
    flex: 1,
    width: "100%",
    height: "100%",
  } as ViewStyle,
  slotImg: { width: "100%", height: "100%" } as any,
  slotEmpty: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(217,179,95,0.07)",
  } as ViewStyle,
  slotX: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD
  } as ViewStyle,
  input: {
    marginTop: 8,
    paddingVertical: 10,
    color: TEXT,
    fontWeight: "800",
    fontSize: 15,
    lineHeight: 22,
  } as any,
  btn: {
    minHeight: 58,
    borderRadius: 28,
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  permissionOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0,0,0,0.66)",
  } as ViewStyle,
  permissionBackdrop: {
    ...StyleSheet.absoluteFillObject,
  } as ViewStyle,
  permissionCard: {
    width: "100%",
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    backgroundColor: "rgba(11,15,23,0.98)",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  } as ViewStyle,
  permissionIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 14,
  } as ViewStyle,
  permissionTitle: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 20,
    letterSpacing: -0.2,
  } as TextStyle,
  permissionBody: {
    marginTop: 8,
    marginBottom: 18,
    color: SUB,
    fontWeight: "700",
    fontSize: 14,
    lineHeight: 20,
  } as TextStyle,
  permissionPrimaryBtn: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  } as ViewStyle,
  permissionPrimaryText: {
    color: "#08111D",
    fontWeight: "900",
    fontSize: 15,
  } as TextStyle,
  permissionSecondaryBtn: {
    minHeight: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 8,
  } as ViewStyle,
  permissionSecondaryText: {
    fontWeight: "900",
    fontSize: 15,
  } as TextStyle,
  permissionCancelBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  } as ViewStyle,
  permissionCancelText: {
    color: "rgba(255,255,255,0.62)",
    fontWeight: "800",
    fontSize: 14,
  } as TextStyle,
  editOverlay: {
    flex: 1,
    backgroundColor: "rgba(5,8,14,0.98)",
  } as ViewStyle,
  editHeader: {
    paddingHorizontal: PAD,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } as ViewStyle,
  editHeaderSpacer: {
    flex: 1,
  } as ViewStyle,
  editHeaderBtn: {
    width: 42,
    height: 42,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  } as ViewStyle,
  editSaveBtn: {
    minWidth: 92,
    height: 42,
    borderRadius: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  } as ViewStyle,
  editSaveText: {
    color: "#08111D",
    fontWeight: "900",
    fontSize: 14,
  } as TextStyle,
  editPreviewWrap: {
    flex: 1,
    marginHorizontal: PAD,
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  } as ViewStyle,
  editPanel: {
    paddingHorizontal: PAD,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(11,15,23,0.98)",
  } as ViewStyle,
  editRemoveBtn: {
    minHeight: 46,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  } as ViewStyle,
  editRemoveText: {
    color: "rgba(255,120,120,0.92)",
    fontWeight: "800",
    fontSize: 14,
  } as TextStyle,
});

const t = StyleSheet.create({
  title: {
    color: "white",
    fontWeight: "900",
    fontSize: 20,
    letterSpacing: 0.2
  } as TextStyle,
  subTitle: {
    marginTop: 4,
    color: SUB,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.16
  } as TextStyle,
  toggleText: {
    color: SUB,
    fontWeight: "900",
    fontSize: 14
  } as TextStyle,
    label: {
    color: "rgba(255,255,255,0.78)",
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.24
  } as TextStyle,
  imgHint: {
    marginTop: 4,
    color: "rgba(255,255,255,0.52)",
    fontWeight: "700",
    fontSize: 12
  } as TextStyle,
  imgEmpty: { marginTop: 10, color: "rgba(255,255,255,0.45)", fontWeight: "700", fontSize: 12 } as TextStyle,
  imgBtnText: {
    color: TEXT,
    fontWeight: "900",
    fontSize: 14
  } as TextStyle,
  err: { marginTop: 6, color: "rgba(255,120,120,0.92)", fontWeight: "800", fontSize: 12 } as TextStyle,
  btnText: {
    color: "#08111D",
    fontWeight: "900",
    fontSize: 17,
    letterSpacing: 0.18,
  } as TextStyle,
});
