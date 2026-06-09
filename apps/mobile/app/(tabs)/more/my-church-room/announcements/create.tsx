import React, { useMemo, useState } from "react";
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
const MAX_TESTIMONY_IMAGES = 3;
const TESTIMONY_SLOT_COUNT = 3;
const CARD_HORIZONTAL_PADDING = 18;
const SLOT_GAP = 10;

type TestimonyCropPreset = "original" | "1:1" | "4:3" | "3:4";
type TestimonySizePreset = "compact" | "standard" | "full";

const TESTIMONY_CROP_PRESETS: { id: TestimonyCropPreset; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "1:1", label: "Square" },
  { id: "4:3", label: "Landscape" },
  { id: "3:4", label: "Portrait" },
];

const TESTIMONY_SIZE_PRESETS: { id: TestimonySizePreset; label: string; maxSide: number }[] = [
  { id: "compact", label: "Compact", maxSide: 1280 },
  { id: "standard", label: "Balanced", maxSide: 1600 },
  { id: "full", label: "Detail", maxSide: 2048 },
];

function composerImageLimit(kind: "announcement" | "post" | "testimony" | "counsel") {
  return kind === "testimony" ? MAX_TESTIMONY_IMAGES : MAX_COMPOSER_IMAGES;
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

function testimonyCropRatio(preset: TestimonyCropPreset): number | null {
  if (preset === "1:1") return 1;
  if (preset === "4:3") return 4 / 3;
  if (preset === "3:4") return 3 / 4;
  return null;
}

function centerCropRect(
  imageWidth: number,
  imageHeight: number,
  aspectRatio: number
) {
  let cropWidth = imageWidth;
  let cropHeight = imageHeight;

  if (imageWidth / imageHeight > aspectRatio) {
    cropHeight = imageHeight;
    cropWidth = cropHeight * aspectRatio;
  } else {
    cropWidth = imageWidth;
    cropHeight = cropWidth / aspectRatio;
  }

  return {
    originX: Math.max(0, Math.round((imageWidth - cropWidth) / 2)),
    originY: Math.max(0, Math.round((imageHeight - cropHeight) / 2)),
    width: Math.max(1, Math.round(cropWidth)),
    height: Math.max(1, Math.round(cropHeight)),
  };
}

function resizeActionsForMaxSide(
  maxSide: number,
  width?: number,
  height?: number
): ImageManipulator.Action[] {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!w || !h) return [{ resize: { width: maxSide } }];
  if (w <= maxSide && h <= maxSide) return [];
  return w >= h ? [{ resize: { width: maxSide } }] : [{ resize: { height: maxSide } }];
}

async function applyTestimonyImageEdit(
  sourceUri: string,
  cropPreset: TestimonyCropPreset,
  sizePreset: TestimonySizePreset
): Promise<string> {
  const { width, height } = await getImageDimensions(sourceUri);
  const actions: ImageManipulator.Action[] = [];
  const ratio = testimonyCropRatio(cropPreset);

  if (ratio) {
    actions.push({ crop: centerCropRect(width, height, ratio) });
  }

  let edited = await ImageManipulator.manipulateAsync(
    sourceUri,
    actions,
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  const maxSide =
    TESTIMONY_SIZE_PRESETS.find((preset) => preset.id === sizePreset)?.maxSide || 1600;
  const resizeActions = resizeActionsForMaxSide(maxSide, edited.width, edited.height);

  if (resizeActions.length) {
    edited = await ImageManipulator.manipulateAsync(
      edited.uri,
      resizeActions,
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );
  }

  const compressed = await compressChurchRoomFeedImage(edited.uri, edited.width, edited.height);
  return compressed.uri;
}


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
  const [testimonyPreviewOpen, setTestimonyPreviewOpen] = useState(false);
  const [testimonyPreviewUri, setTestimonyPreviewUri] = useState<string | null>(null);
  const [testimonyPreviewIndex, setTestimonyPreviewIndex] = useState<number | null>(null);
  const [testimonyCropPreset, setTestimonyCropPreset] = useState<TestimonyCropPreset>("original");
  const [testimonySizePreset, setTestimonySizePreset] = useState<TestimonySizePreset>("standard");
  const [testimonyEditSaving, setTestimonyEditSaving] = useState(false);

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

  function openTestimonyImagePreview(uri: string, slotIndex: number) {
    setTestimonyPreviewUri(uri);
    setTestimonyPreviewIndex(slotIndex);
    setTestimonyCropPreset("original");
    setTestimonySizePreset("standard");
    setTestimonyPreviewOpen(true);
  }

  function closeTestimonyImagePreview() {
    if (testimonyEditSaving) return;
    setTestimonyPreviewOpen(false);
    setTestimonyPreviewUri(null);
    setTestimonyPreviewIndex(null);
  }

  async function saveTestimonyImageEdit() {
    const sourceUri = String(testimonyPreviewUri || "").trim();
    const slotIndex = testimonyPreviewIndex;
    if (!sourceUri || slotIndex == null) return;

    try {
      setTestimonyEditSaving(true);
      setErr(null);
      const editedUri = await applyTestimonyImageEdit(
        sourceUri,
        testimonyCropPreset,
        testimonySizePreset
      );
      setImages((prev) => {
        const next = [...prev];
        next[slotIndex] = editedUri;
        return next.slice(0, MAX_TESTIMONY_IMAGES);
      });
      setTestimonyPreviewOpen(false);
      setTestimonyPreviewUri(null);
      setTestimonyPreviewIndex(null);
    } catch (editErr) {
      const message =
        editErr instanceof Error
          ? editErr.message
          : CHURCH_ROOM_FEED_IMAGE_TOO_LARGE_MESSAGE;
      setErr(message);
    } finally {
      setTestimonyEditSaving(false);
    }
  }

  function removeTestimonyPreviewImage() {
    const sourceUri = String(testimonyPreviewUri || "").trim();
    if (!sourceUri) return;
    removeImage(sourceUri);
    closeTestimonyImagePreview();
  }

  const testimonySlotSize = useMemo(() => {
    const cardInnerWidth = windowWidth - PAD * 2 - CARD_HORIZONTAL_PADDING * 2;
    return Math.floor((cardInnerWidth - SLOT_GAP * (TESTIMONY_SLOT_COUNT - 1)) / TESTIMONY_SLOT_COUNT);
  }, [windowWidth]);

  function renderImageSlot(
    slotIndex: number,
    slotSize: number,
    slotStyle?: ViewStyle
  ) {
    const uri = images[slotIndex];
    const slotRadius = Math.max(18, Math.round(slotSize * 0.24));
    const testimonyFilled = kind === "testimony" && Boolean(uri);

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
              testimonyFilled
                ? () => openTestimonyImagePreview(uri, slotIndex)
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

    if (kind === "testimony" && images.length > MAX_TESTIMONY_IMAGES) {
      setErr("You can add up to 3 images for a testimony.");
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

          
          {kind === "testimony" ? (
            <View style={[s.slotsRow, s.slotsRowTestimony]}>
              {Array.from({ length: TESTIMONY_SLOT_COUNT }, (_, i) => i).map((i) =>
                renderImageSlot(i, testimonySlotSize)
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
        visible={kind === "testimony" && testimonyPreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={closeTestimonyImagePreview}
      >
        <View style={s.editOverlay}>
          <View style={[s.editHeader, { paddingTop: insets.top + 10 }]}>
            <Pressable
              onPress={closeTestimonyImagePreview}
              disabled={testimonyEditSaving}
              style={s.editHeaderBtn}
            >
              <Ionicons name="close" size={22} color={TEXT} />
            </Pressable>
            <Text style={s.editTitle}>Edit image</Text>
            <Pressable
              onPress={() => void saveTestimonyImageEdit()}
              disabled={testimonyEditSaving}
              style={({ pressed }) => [
                s.editSaveBtn,
                { backgroundColor: accent },
                testimonyEditSaving || pressed ? { opacity: 0.88 } : null,
              ]}
            >
              {testimonyEditSaving ? (
                <ActivityIndicator size="small" color="#08111D" />
              ) : (
                <Text style={s.editSaveText}>Save</Text>
              )}
            </Pressable>
          </View>

          <View style={s.editPreviewWrap}>
            {testimonyPreviewUri ? (
              <Image
                source={{ uri: testimonyPreviewUri }}
                style={s.editPreviewImage}
                resizeMode="contain"
              />
            ) : null}
          </View>

          <View style={[s.editPanel, { paddingBottom: Math.max(insets.bottom + 16, 24) }]}>
            <Text style={s.editSectionLabel}>Crop</Text>
            <View style={s.editChipRow}>
              {TESTIMONY_CROP_PRESETS.map((preset) => {
                const active = testimonyCropPreset === preset.id;
                return (
                  <Pressable
                    key={preset.id}
                    onPress={() => setTestimonyCropPreset(preset.id)}
                    style={[
                      s.editChip,
                      { borderColor: accentBorder },
                      active ? { backgroundColor: accentSoft, borderColor: accent } : null,
                    ]}
                  >
                    <Text style={[s.editChipText, active ? { color: accent } : null]}>
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[s.editSectionLabel, { marginTop: 14 }]}>Size</Text>
            <View style={s.editChipRow}>
              {TESTIMONY_SIZE_PRESETS.map((preset) => {
                const active = testimonySizePreset === preset.id;
                return (
                  <Pressable
                    key={preset.id}
                    onPress={() => setTestimonySizePreset(preset.id)}
                    style={[
                      s.editChip,
                      { borderColor: accentBorder },
                      active ? { backgroundColor: accentSoft, borderColor: accent } : null,
                    ]}
                  >
                    <Text style={[s.editChipText, active ? { color: accent } : null]}>
                      {preset.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={removeTestimonyPreviewImage}
              disabled={testimonyEditSaving}
              style={({ pressed }) => [
                s.editRemoveBtn,
                { borderColor: accentBorder },
                pressed ? { opacity: 0.9 } : null,
              ]}
            >
              <Ionicons name="trash-outline" size={16} color="rgba(255,120,120,0.92)" />
              <Text style={s.editRemoveText}>Remove image</Text>
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
  editTitle: {
    flex: 1,
    textAlign: "center",
    color: TEXT,
    fontWeight: "900",
    fontSize: 17,
    letterSpacing: -0.1,
  } as TextStyle,
  editSaveBtn: {
    minWidth: 74,
    height: 42,
    borderRadius: 18,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
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
  editPreviewImage: {
    width: "100%",
    height: "100%",
  } as any,
  editPanel: {
    paddingHorizontal: PAD,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(11,15,23,0.98)",
  } as ViewStyle,
  editSectionLabel: {
    color: "rgba(255,255,255,0.72)",
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.18,
    marginBottom: 10,
  } as TextStyle,
  editChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  } as ViewStyle,
  editChip: {
    minWidth: 72,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  } as ViewStyle,
  editChipText: {
    color: SUB,
    fontWeight: "800",
    fontSize: 13,
  } as TextStyle,
  editRemoveBtn: {
    marginTop: 16,
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
