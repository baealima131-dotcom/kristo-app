import React, { useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { apiGet, apiPatch } from "@/src/lib/kristoApi";
import { getKristoAuth, getKristoHeaders } from "@/src/lib/kristoHeaders";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  loadChurchDraft,
  loadChurchProfileCache,
  saveChurchDraft,
  saveChurchProfileCache,
} from "@/src/lib/churchStore";
import { invalidateChurchProfileCaches } from "@/src/lib/screenDataCache";
import { buildAvatarDataUrl, compressAvatarFile } from "@/src/lib/avatarCompress";
import {
  mergeChurchAvatarForDisplay,
  normalizeAvatarUpdatedAt,
} from "@/src/lib/avatarFreshness";
import { emitChurchProfileUpdated } from "@/src/lib/kristoProfileEvents";

const GOLD = "rgba(217,179,95,0.96)";
const BG = "#070B14";
const CHURCH_PICTURE_ASPECT = 5 / 8;

function ChurchPictureCropModal({
  visible,
  uri,
  onCancel,
  onUse,
}: {
  visible: boolean;
  uri: string;
  onCancel: () => void;
  onUse: (uri: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [rotation, setRotation] = useState(0);
  const [saving, setSaving] = useState(false);
  const zoom = useSharedValue(1);
  const zoomStart = useSharedValue(1);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);

  const frameWidth = Math.min(screenWidth * 0.59, screenHeight * 0.265, 300);
  const frameHeight = frameWidth / CHURCH_PICTURE_ASPECT;
  const thumbWidth = Math.min(frameWidth * 0.66, 126);
  const thumbHeight = thumbWidth / CHURCH_PICTURE_ASPECT;
  const orientedWidth = rotation % 180 === 0 ? imageSize.width : imageSize.height;
  const orientedHeight = rotation % 180 === 0 ? imageSize.height : imageSize.width;
  const coverScale = imageSize.width && imageSize.height
    ? Math.max(frameWidth / orientedWidth, frameHeight / orientedHeight)
    : 1;
  const renderedWidth = imageSize.width * coverScale;
  const renderedHeight = imageSize.height * coverScale;

  useEffect(() => {
    if (!visible || !uri) return;
    setImageSize({ width: 0, height: 0 });
    setRotation(0);
    setSaving(false);
    zoom.value = 1;
    zoomStart.value = 1;
    panX.value = 0;
    panY.value = 0;
    Image.getSize(uri, (width, height) => setImageSize({ width, height }), () => {});
  }, [visible, uri, zoom, zoomStart, panX, panY]);

  const pinch = Gesture.Pinch()
    .onBegin(() => { zoomStart.value = zoom.value; })
    .onUpdate((event) => {
      zoom.value = Math.max(1, Math.min(4, zoomStart.value * event.scale));
      const maxX = Math.max(0, (orientedWidth * coverScale * zoom.value - frameWidth) / 2);
      const maxY = Math.max(0, (orientedHeight * coverScale * zoom.value - frameHeight) / 2);
      panX.value = Math.max(-maxX, Math.min(maxX, panX.value));
      panY.value = Math.max(-maxY, Math.min(maxY, panY.value));
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .onBegin(() => {
      panStartX.value = panX.value;
      panStartY.value = panY.value;
    })
    .onUpdate((event) => {
      const maxX = Math.max(0, (orientedWidth * coverScale * zoom.value - frameWidth) / 2);
      const maxY = Math.max(0, (orientedHeight * coverScale * zoom.value - frameHeight) / 2);
      panX.value = Math.max(-maxX, Math.min(maxX, panStartX.value + event.translationX));
      panY.value = Math.max(-maxY, Math.min(maxY, panStartY.value + event.translationY));
    });

  const imageMotion = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value },
      { translateY: panY.value },
      { rotate: `${rotation}deg` },
      { scale: zoom.value },
    ],
  }));
  const thumbMotion = useAnimatedStyle(() => ({
    transform: [
      { translateX: panX.value * thumbWidth / frameWidth },
      { translateY: panY.value * thumbHeight / frameHeight },
      { rotate: `${rotation}deg` },
      { scale: zoom.value },
    ],
  }));

  function changeZoom(amount: number) {
    const nextZoom = Math.max(1, Math.min(4, zoom.value + amount));
    zoom.value = nextZoom;
    zoomStart.value = zoom.value;
    const maxX = Math.max(0, (orientedWidth * coverScale * nextZoom - frameWidth) / 2);
    const maxY = Math.max(0, (orientedHeight * coverScale * nextZoom - frameHeight) / 2);
    panX.value = Math.max(-maxX, Math.min(maxX, panX.value));
    panY.value = Math.max(-maxY, Math.min(maxY, panY.value));
  }

  function rotateImage() {
    setRotation((value) => (value + 90) % 360);
    zoom.value = 1;
    zoomStart.value = 1;
    panX.value = 0;
    panY.value = 0;
  }

  async function usePicture() {
    if (!uri || !imageSize.width || saving) return;
    setSaving(true);
    try {
      let sourceUri = uri;
      let sourceSize = imageSize;
      if (rotation) {
        const rotated = await ImageManipulator.manipulateAsync(
          sourceUri,
          [{ rotate: rotation }],
          { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
        );
        sourceUri = rotated.uri;
        sourceSize = await new Promise<{ width: number; height: number }>((resolve, reject) =>
          Image.getSize(sourceUri, (width, height) => resolve({ width, height }), reject)
        );
      }
      const scale = Math.max(frameWidth / sourceSize.width, frameHeight / sourceSize.height);
      const cropWidth = Math.min(sourceSize.width, frameWidth / (scale * zoom.value));
      const cropHeight = Math.min(sourceSize.height, frameHeight / (scale * zoom.value));
      const centerX = sourceSize.width / 2 - panX.value / (scale * zoom.value);
      const centerY = sourceSize.height / 2 - panY.value / (scale * zoom.value);
      const originX = Math.max(0, Math.min(sourceSize.width - cropWidth, centerX - cropWidth / 2));
      const originY = Math.max(0, Math.min(sourceSize.height - cropHeight, centerY - cropHeight / 2));
      const cropped = await ImageManipulator.manipulateAsync(
        sourceUri,
        [
          { crop: { originX, originY, width: cropWidth, height: cropHeight } },
          { resize: { width: 750, height: 1200 } },
        ],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      onUse(cropped.uri);
    } catch (error: any) {
      Alert.alert("Picture could not be prepared", String(error?.message || "Please choose the picture again."));
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={[s.cropScreen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={s.cropHeader}>
          <Pressable onPress={onCancel} hitSlop={10} style={s.cropCancel}>
            <Text style={s.cropCancelText}>Cancel</Text>
          </Pressable>
          <Text style={s.cropTitle}>Church picture</Text>
          <View style={s.cropHeaderSpacer} />
        </View>

        <Text style={s.cropHint}>Kuza au punguza kwa vidole viwili, kisha sogeza picha mpaka ipende.</Text>

        <View style={s.cropMainArea}>
          {imageSize.width > 0 ? (
            <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
              <View style={[s.cropFrame, { width: frameWidth, height: frameHeight }]}>
                <Animated.Image
                  source={{ uri }}
                  resizeMode="cover"
                  style={[
                    s.cropImage,
                    {
                      width: renderedWidth,
                      height: renderedHeight,
                      left: (frameWidth - renderedWidth) / 2,
                      top: (frameHeight - renderedHeight) / 2,
                    },
                    imageMotion,
                  ]}
                />
              </View>
            </GestureDetector>
          ) : <ActivityIndicator color={GOLD} size="large" />}
        </View>

        <View style={s.cropPreviewRow}>
          <View style={[s.cropThumbFrame, { width: thumbWidth, height: thumbHeight }]}>
            {imageSize.width > 0 ? (
              <Animated.Image
                source={{ uri }}
                resizeMode="cover"
                style={[
                  s.cropImage,
                  {
                    width: imageSize.width * coverScale * thumbWidth / frameWidth,
                    height: imageSize.height * coverScale * thumbHeight / frameHeight,
                    left: (thumbWidth - imageSize.width * coverScale * thumbWidth / frameWidth) / 2,
                    top: (thumbHeight - imageSize.height * coverScale * thumbHeight / frameHeight) / 2,
                  },
                  thumbMotion,
                ]}
              />
            ) : null}
          </View>
          <View style={s.cropPreviewDetails}>
            <Text style={s.cropPreviewEyebrow}>CHURCH OVERVIEW</Text>
            <Text style={s.cropPreviewText}>Picha itaonekana hivi baada ya kuhifadhi.</Text>
            <View style={s.cropControls}>
              <Pressable onPress={() => changeZoom(-0.25)} style={s.cropControl} accessibilityLabel="Zoom out">
                <Ionicons name="remove" size={25} color={GOLD} />
              </Pressable>
              <Pressable onPress={rotateImage} style={s.cropControl} accessibilityLabel="Rotate picture">
                <Ionicons name="refresh" size={23} color={GOLD} />
              </Pressable>
              <Pressable onPress={() => changeZoom(0.25)} style={s.cropControl} accessibilityLabel="Zoom in">
                <Ionicons name="add" size={25} color={GOLD} />
              </Pressable>
            </View>
          </View>
        </View>

        <Pressable disabled={!imageSize.width || saving} onPress={usePicture} style={[s.cropUseButton, saving && { opacity: 0.7 }]}>
          {saving ? <ActivityIndicator color="#070B14" /> : <Text style={s.cropUseText}>Use picture</Text>}
        </Pressable>
      </View>
    </Modal>
  );
}

function mediaUrl(u: any) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s) || s.startsWith("file:")) return s;
  const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
  return `${base}${s.startsWith("/") ? "" : "/"}${s}`;
}

export default function EditChurchProfile() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, setSession } = useKristoSession();
  const saveInFlight = useRef(false);
  const params = useLocalSearchParams<{
    returnTo?: string;
    threadId?: string;
    returnParams?: string;
    roomId?: string;
    assignmentId?: string;
    churchId?: string;
    roomKind?: string;
    source?: string;
  }>();
  const returnTo = useMemo(() => String(params?.returnTo || ""), [params?.returnTo]);
  const returnThreadId = useMemo(() => String(params?.threadId || ""), [params?.threadId]);
  const returnParamsRaw = useMemo(() => String(params?.returnParams || ""), [params?.returnParams]);

  function parseReturnParams(): Record<string, string> {
    if (!returnParamsRaw) return {};
    try {
      const parsed = JSON.parse(returnParamsRaw);
      if (!parsed || typeof parsed !== "object") return {};
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [String(k), String(v ?? "")])
      );
    } catch {
      return {};
    }
  }

  function goBackToMessagesThread() {
    const restored = parseReturnParams();
    const id = String(restored.id || returnThreadId || "church-media-room").trim();
    router.replace({
      pathname: "/(tabs)/more/my-church-room/messages/[id]",
      params: {
        ...restored,
        id,
        refreshAt: String(Date.now()),
      },
    } as any);
  }

  function goBackTarget() {
    if (returnTo === "messages-thread") {
      goBackToMessagesThread();
      return;
    }
    router.back();
  }

  const [name, setName] = useState("");
  const [pastorName, setPastorName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [avatarUri, setAvatarUri] = useState("");
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [cropUri, setCropUri] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      const auth = getKristoAuth();
      const churchId = String(session?.churchId || auth.churchId || "").trim();
      const cached = churchId ? await loadChurchProfileCache(churchId) : null;

      if (cached && alive) {
        setName(String(cached.name || ""));
        setPastorName(String(cached.pastorName || ""));
        setPhone(String(cached.phone || ""));
        setAddress(String(cached.address || ""));
        setAvatarUri(mediaUrl(cached.avatarUri || cached.avatarUrl || ""));
        setAvatarDirty(false);
      }

      const j = await apiGet<any>("/api/church/profile", { headers: getKristoHeaders() }).catch(() => null);
      const p = j?.data || j?.profile || {};
      if (!alive) return;

      setName(String(p.name || cached?.name || ""));
      setPastorName(String(p.pastorName || cached?.pastorName || ""));
      setPhone(String(p.phone || cached?.phone || ""));
      setAddress(String(p.address || cached?.address || ""));

      const serverAvatar = mediaUrl(p.avatarUri || p.avatarUrl || "");
      const mergedAvatar = mergeChurchAvatarForDisplay({
        churchId: churchId || "",
        localUri: mediaUrl(cached?.avatarUri || cached?.avatarUrl || ""),
        localUpdatedAt: cached?.avatarUpdatedAt,
        serverUri: serverAvatar,
        serverUpdatedAt: normalizeAvatarUpdatedAt(p?.avatarUpdatedAt || p?.updatedAt),
      });
      setAvatarUri(mergedAvatar.uri);
      setAvatarDirty(false);

      if (churchId && p?.name) {
        await saveChurchProfileCache({
          churchId,
          name: String(p.name || ""),
          pastorName: String(p.pastorName || ""),
          phone: String(p.phone || ""),
          address: String(p.address || ""),
          avatarUri: mergedAvatar.uri,
          avatarUrl: mergedAvatar.uri,
          avatarUpdatedAt: mergedAvatar.skippedStale ? cached?.avatarUpdatedAt : cached?.avatarUpdatedAt,
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, [session?.churchId]);

  async function pickAvatar() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      allowsEditing: false,
    });

    if (res.canceled) return;
    const picked = String(res.assets?.[0]?.uri || "").trim();
    if (!picked) return;
    setCropUri(picked);
  }

  async function acceptChurchPicture(uri: string) {
    try {
      const auth = getKristoAuth();
      const churchId = String(session?.churchId || auth.churchId || "").trim();
      const dir = `${FileSystem.documentDirectory}church-avatar/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const nextUri = `${dir}${churchId || "church"}-${Date.now()}.jpg`;
      const compressedUri = await compressAvatarFile(uri, nextUri);
      setAvatarUri(compressedUri);
    } catch {
      setAvatarUri(uri);
    }
    setAvatarDirty(true);
    setCropUri("");
  }

  async function save() {
    if (saveInFlight.current) return;

    if (!name.trim()) {
      Alert.alert("Church name required", "Weka jina la kanisa.");
      return;
    }

    saveInFlight.current = true;

    const auth = getKristoAuth();
    const churchId = String(session?.churchId || auth.churchId || "").trim();
    const trimmedName = name.trim();
    const trimmedPastor = pastorName.trim();
    const trimmedPhone = phone.trim();
    const trimmedAddress = address.trim();
    const displayAvatar = avatarUri.startsWith("file:") ? avatarUri : mediaUrl(avatarUri);
    const now = Date.now();
    const optimisticAvatarAt = avatarDirty && displayAvatar ? now : undefined;

    const localProfile = {
      churchId,
      name: trimmedName,
      pastorName: trimmedPastor,
      phone: trimmedPhone,
      address: trimmedAddress,
      avatarUri: displayAvatar,
      avatarUrl: displayAvatar,
      avatarUpdatedAt: optimisticAvatarAt,
    };

    await saveChurchProfileCache(localProfile);

    if (optimisticAvatarAt) {
      console.log("[EditChurch] optimistic avatar saved", {
        churchId,
        avatarUpdatedAt: optimisticAvatarAt,
      });
    }

    if (session?.userId && churchId) {
      const draft = (await loadChurchDraft(session.userId)) || { churchId };
      await saveChurchDraft(
        {
          ...draft,
          churchId,
          churchName: trimmedName,
          pastorName: trimmedPastor,
          churchPhone: trimmedPhone,
          address: trimmedAddress,
          avatarUri: displayAvatar,
          avatarUrl: displayAvatar,
          churchProfile: {
            ...(draft.churchProfile || {}),
            name: trimmedName,
            phone: trimmedPhone,
            address: trimmedAddress,
          },
        },
        session.userId
      );
    }

    if (session) {
      await setSession({
        ...session,
        churchId: churchId || session.churchId,
        activeChurchId: churchId || session.activeChurchId,
        churchName: trimmedName,
      } as any);
    }

    if (__DEV__) {
      console.log("[EditChurch] save tap local update", {
        churchId,
        name: trimmedName,
        pastorName: trimmedPastor,
      });
    }

    emitChurchProfileUpdated({
      churchId,
      name: trimmedName,
      avatarUri: displayAvatar,
      avatarUrl: displayAvatar,
      updatedAt: now,
      avatarUpdatedAt: optimisticAvatarAt,
    });

    if (returnTo === "messages-thread") {
      goBackToMessagesThread();
    } else {
      router.replace({
        pathname: "/(tabs)/church/overview",
        params: {
          saved: "1",
          savedName: trimmedName,
          refreshAt: String(Date.now()),
        },
      } as any);
    }

    void (async () => {
      try {
        let avatarData = "";
        let patchAvatarUri = "";
        let patchAvatarUrl = "";
        let targetField = "none";

        if (avatarDirty) {
          if (avatarUri.startsWith("file:")) {
            targetField = "avatarData";
            console.log("KRISTO_CHURCH_AVATAR_SAVE_START", {
              churchId,
              hasLocalUri: true,
              targetField,
            });
            avatarData = await buildAvatarDataUrl(avatarUri);
          } else {
            targetField = "avatarUri";
            console.log("KRISTO_CHURCH_AVATAR_SAVE_START", {
              churchId,
              hasLocalUri: false,
              targetField,
            });
            patchAvatarUri = displayAvatar;
            patchAvatarUrl = displayAvatar;
          }
        } else if (
          avatarUri &&
          !avatarUri.startsWith("file:") &&
          (/^data:image\//i.test(avatarUri) || /^https?:\/\//i.test(avatarUri) || avatarUri.startsWith("/"))
        ) {
          patchAvatarUri = displayAvatar;
          patchAvatarUrl = displayAvatar;
        }

        const res = await apiPatch<any>(
          "/api/church/profile",
          {
            name: trimmedName,
            pastorName: trimmedPastor,
            phone: trimmedPhone,
            address: trimmedAddress,
            avatarUri: patchAvatarUri,
            avatarUrl: patchAvatarUrl,
            avatarData,
          },
          { headers: getKristoHeaders() }
        );

        if (res?.ok !== true) {
          throw new Error(String(res?.error || res?.reason || "Save failed"));
        }

        const p = res?.data || {};
        const serverAvatar = mediaUrl(p.avatarUri || p.avatarUrl || "");
        const serverUpdatedAt = normalizeAvatarUpdatedAt(p?.avatarUpdatedAt || p?.updatedAt);
        console.log("KRISTO_CHURCH_AVATAR_SAVE_DONE", {
          churchId,
          avatarUri: serverAvatar,
          logoUri: "",
          persisted: Boolean(serverAvatar),
        });
        const existingCache = await loadChurchProfileCache(churchId);
        await invalidateChurchProfileCaches(churchId, {
          userId: session?.userId,
          source: "church-profile-patch",
        });

        const mergedAvatar = mergeChurchAvatarForDisplay({
          churchId,
          localUri: displayAvatar,
          localUpdatedAt: optimisticAvatarAt || existingCache?.avatarUpdatedAt,
          serverUri: serverAvatar,
          serverUpdatedAt: serverUpdatedAt || Date.now(),
          preferServer: true,
        });
        const avatarUpdatedAt =
          mergedAvatar.source === "server"
            ? serverUpdatedAt || Date.now()
            : optimisticAvatarAt || existingCache?.avatarUpdatedAt || Date.now();
        const synced = {
          churchId,
          name: String(p.name || trimmedName),
          pastorName: String(p.pastorName || trimmedPastor),
          phone: String(p.phone || trimmedPhone),
          address: String(p.address || trimmedAddress),
          avatarUri: mergedAvatar.uri || displayAvatar,
          avatarUrl: mergedAvatar.uri || displayAvatar,
          avatarUpdatedAt,
        };
        await saveChurchProfileCache(synced);
        setAvatarDirty(false);

        if (session) {
          await setSession({
            ...session,
            churchId: churchId || session.churchId,
            activeChurchId: churchId || session.activeChurchId,
            churchName: synced.name,
            churchAvatarUri: synced.avatarUri,
            churchAvatarUrl: synced.avatarUri,
          } as any);
        }

        emitChurchProfileUpdated({
          churchId,
          name: synced.name,
          avatarUri: synced.avatarUri,
          avatarUrl: synced.avatarUrl,
          updatedAt: Date.now(),
          avatarUpdatedAt,
        });

        console.log("[EditChurch] patch success updated cache", {
          churchId,
          name: synced.name,
          avatarUpdatedAt: avatarUpdatedAt || null,
        });
      } catch (e: any) {
        const msg = String(e?.message || e || "Save failed");
        if (__DEV__) {
          console.warn("[EditChurch] patch fail", { churchId, error: msg });
        }
        Alert.alert("Church sync failed", `${msg}\n\nYour changes are saved on this device and will retry when you open Edit Church again.`);
      } finally {
        saveInFlight.current = false;
      }
    })();
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={goBackTarget} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color="white" />
        </Pressable>
        <View>
          <Text style={s.title}>Edit Church</Text>
          <Text style={s.sub}>Church profile, not pastor profile</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Pressable onPress={pickAvatar} style={s.avatarBox}>
          <View style={s.avatarFrame}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={s.avatar} resizeMode="cover" />
            ) : (
              <View style={s.avatarPlaceholder}>
                <Ionicons name="business-outline" size={42} color={GOLD} />
              </View>
            )}

            <View style={s.avatarEditBadge}>
              <Ionicons name="camera-outline" size={18} color="#070B14" />
            </View>
          </View>

          <Text style={s.avatarText}>Change church avatar</Text>
          <Text style={s.avatarHint}>This image belongs to the church profile</Text>
        </Pressable>

        <Text style={s.label}>Church Name</Text>
        <TextInput value={name} onChangeText={setName} style={s.input} placeholder="Church name" placeholderTextColor="rgba(255,255,255,0.35)" />

        <Text style={s.label}>Pastor Name</Text>
        <TextInput value={pastorName} onChangeText={setPastorName} style={s.input} placeholder="Pastor name" placeholderTextColor="rgba(255,255,255,0.35)" />

        <Text style={s.label}>Phone</Text>
        <TextInput value={phone} onChangeText={setPhone} style={s.input} placeholder="Phone" placeholderTextColor="rgba(255,255,255,0.35)" />

        <Text style={s.label}>Address</Text>
        <TextInput value={address} onChangeText={setAddress} style={s.input} placeholder="Address" placeholderTextColor="rgba(255,255,255,0.35)" />

        <Pressable onPress={save} style={s.saveBtn}>
          <Text style={s.saveText}>Save Church Profile</Text>
        </Pressable>
      </ScrollView>
      <ChurchPictureCropModal
        visible={Boolean(cropUri)}
        uri={cropUri}
        onCancel={() => setCropUri("")}
        onUse={acceptChurchPicture}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG },
  header: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18 },
  backBtn: { width: 42, height: 42, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.07)" },
  title: { color: "white", fontSize: 24, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.58)", fontWeight: "700", marginTop: 3 },
  content: { padding: 18, paddingBottom: 80 },
  avatarBox: { alignSelf: "center", alignItems: "center", marginBottom: 30 },
  avatarFrame: {
    width: 128,
    height: 205,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.10)",
    borderWidth: 2,
    borderColor: "rgba(217,179,95,0.70)",
    overflow: "visible",
  },
  avatarPlaceholder: {
    width: 118,
    height: 195,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  avatar: { width: 118, height: 195, borderRadius: 30 },
  avatarEditBadge: {
    position: "absolute",
    right: -8,
    bottom: -8,
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    borderWidth: 3,
    borderColor: BG,
  },
  avatarText: { color: GOLD, fontWeight: "900", marginTop: 16, fontSize: 16 },
  avatarHint: { color: "rgba(255,255,255,0.50)", fontWeight: "700", marginTop: 5 },
  label: { color: GOLD, fontWeight: "900", marginBottom: 8, marginTop: 14 },
  input: { color: "white", backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(217,179,95,0.20)", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, fontWeight: "800" },
  saveBtn: { marginTop: 26, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: GOLD },
  saveText: { color: "#070B14", fontWeight: "900", fontSize: 16 },
  cropScreen: { flex: 1, backgroundColor: BG, paddingHorizontal: 18 },
  cropHeader: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cropCancel: { minWidth: 70, minHeight: 44, justifyContent: "center" },
  cropCancelText: { color: "rgba(255,255,255,0.78)", fontSize: 16, fontWeight: "700" },
  cropTitle: { color: "white", fontSize: 19, fontWeight: "900", textAlign: "center" },
  cropHeaderSpacer: { width: 70 },
  cropHint: { color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 5, marginBottom: 10, paddingHorizontal: 10 },
  cropMainArea: { flex: 1, minHeight: 180, alignItems: "center", justifyContent: "center" },
  cropFrame: { overflow: "hidden", borderRadius: 24, borderWidth: 2, borderColor: GOLD, backgroundColor: "#121722" },
  cropImage: { position: "absolute" },
  cropPreviewRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 154, marginTop: 10, marginBottom: 14 },
  cropThumbFrame: { overflow: "hidden", borderRadius: 20, borderWidth: 2, borderColor: GOLD, backgroundColor: "#121722" },
  cropPreviewDetails: { flex: 1, minWidth: 0, justifyContent: "center" },
  cropPreviewEyebrow: { color: GOLD, fontSize: 13, fontWeight: "900", letterSpacing: 1 },
  cropPreviewText: { color: "rgba(255,255,255,0.68)", fontSize: 13, lineHeight: 18, marginTop: 6 },
  cropControls: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  cropControl: { width: 43, height: 43, borderRadius: 22, borderWidth: 1.5, borderColor: "rgba(217,179,95,0.62)", backgroundColor: "rgba(217,179,95,0.08)", alignItems: "center", justifyContent: "center" },
  cropUseButton: { height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: GOLD },
  cropUseText: { color: "#070B14", fontWeight: "900", fontSize: 17 },
});
