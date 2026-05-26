import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getKristoAuth } from "@/src/lib/kristoHeaders";
import { apiPatch, apiPost } from "@/src/lib/kristoApi";
import { fetchMinistryById } from "@/src/lib/ministriesApi";
import * as ImagePicker from "expo-image-picker";

type MinistryStatus = "Active" | "Paused";
type Ministry = {
  id: string;
  name: string;
  description?: string;
  status: MinistryStatus;
  churchId?: string;
  avatarUri?: string;
  createdAt?: string;
  updatedAt?: string;
};

const PAD = 16;
const VIP_BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.72)";
const SCREEN_W = Dimensions.get("window").width;
const DECK_CARD_W = SCREEN_W - 32;

export default function ChurchMinistryEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ ministryId: string; returnTo?: string; threadId?: string }>();
  const nameRef = useRef<TextInput>(null);
  const scrollRef = useRef<any>(null);

  const ministryId = useMemo(() => String(params?.ministryId || ""), [params?.ministryId]);
  const returnTo = useMemo(() => String(params?.returnTo || ""), [params?.returnTo]);
  const returnThreadId = useMemo(() => String(params?.threadId || ""), [params?.threadId]);

  function goBackTarget() {
    if (returnTo === "messages-thread" && returnThreadId) {
      router.replace({
        pathname: "/more/my-church-room/messages/[id]",
        params: { id: returnThreadId },
      } as any);
      return;
    }
    router.back();
  }


  const auth = getKristoAuth();
  const churchId = String(
    auth?.churchId
  );

  const effectiveAuthUserId = String(auth?.userId || "");
  const effectiveAuthRole = String(auth?.role || "Member");

  const canEdit =
    effectiveAuthRole === "Church_Admin" ||
    effectiveAuthRole === "Pastor" ||
    effectiveAuthRole === "Ministry_Leader";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [item, setItem] = useState<Ministry | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editingBio, setEditingBio] = useState(false);
const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUri, setAvatarUri] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [activeDeckIndex, setActiveDeckIndex] = useState(0);

  const ministryAvatarUri = useMemo(
    () =>
      String(
        normalizeImageUri(avatarUri) ||
        normalizeImageUri((item as any)?.avatarUri) ||
        normalizeImageUri((item as any)?.profileImage) ||
        normalizeImageUri((item as any)?.profilePhoto) ||
        normalizeImageUri((item as any)?.photo) ||
        normalizeImageUri((item as any)?.image) ||
        normalizeImageUri((item as any)?.avatar) ||
        ""
      ).trim(),
    [avatarUri, item]
  );


  function normalizeImageUri(uri: string) {
    const v = String(uri || "").trim();
    if (!v) return "";
    if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("file://")) return v;
    const base = String(
      process.env.EXPO_PUBLIC_API_BASE ||
      process.env.EXPO_PUBLIC_API_URL ||
      process.env.EXPO_PUBLIC_KRISTO_API_URL ||
      ""
    ).replace(/\/$/, "");
    if (base && v.startsWith("/")) return `${base}${v}`;
    return v;
  }

  const profileInitial = useMemo(() => {
    const source = String(name || item?.name || "M").trim();
    return (source.charAt(0) || "M").toUpperCase();
  }, [name, item?.name]);

  async function onChangeProfilePhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow Photos access to choose a ministry profile image.");
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.9,
        allowsMultipleSelection: false,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      const localUri = String(asset?.uri || "").trim();
      if (!localUri) return;

      setAvatarUri(localUri);
      setUploadingPhoto(true);
      setErr(null);

      const fileName = String(asset?.fileName || `ministry_${Date.now()}.jpg`);
      const mimeType = String(asset?.mimeType || "image/jpeg");

      const form = new FormData();
      form.append("file", {
        uri: localUri,
        name: fileName,
        type: mimeType,
      } as any);

      const uploaded = await apiPost<{ ok?: boolean; data?: { url?: string }; error?: string }>(
        "/api/church/ministries/upload",
        form,
        {
          headers: {
            accept: "application/json",
            "x-kristo-user-id": effectiveAuthUserId,
            "x-kristo-role": effectiveAuthRole,
            "x-kristo-church-id": churchId,
          },
        }
      );

      if (!uploaded?.ok || !uploaded?.data?.url) {
        throw new Error(String(uploaded?.error || "Failed to upload photo"));
      }

      const next = normalizeImageUri(String(uploaded.data.url || "").trim());
      if (!next) throw new Error("Upload returned empty image URL");

      setItem((prev) => (prev ? { ...prev, avatarUri: next } : prev));
    } catch (e: any) {
      Alert.alert("Upload failed", String(e?.message ?? e ?? "Could not upload image"));
    } finally {
      setUploadingPhoto(false);
    }
  }

  function onRemoveProfilePhoto() {
    setAvatarUri("");
    setItem((prev) => (prev ? { ...prev, avatarUri: "" } : prev));
  }

  function headers() {
    return {
      accept: "application/json",
      "content-type": "application/json",
      "x-kristo-user-id": effectiveAuthUserId,
      "x-kristo-role": effectiveAuthRole,
      "x-kristo-church-id": churchId,
    };
  }

  function openDescriptionEditor() {
    Keyboard.dismiss();
    setTimeout(() => {
      nameRef.current?.blur?.();
    }, 40);
  }

  function onDeckScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const x = Number(e?.nativeEvent?.contentOffset?.x || 0);
    const cardWidth = 248;
    const next = Math.max(0, Math.min(1, Math.round(x / cardWidth)));
    setActiveDeckIndex(next);
  }

  async function load() {
    try {
      if (!ministryId) throw new Error("ministryId missing");

      setLoading(true);
      setErr(null);

      const one = await fetchMinistryById(ministryId);
      if (!one) throw new Error("Ministry not found.");

      const mapped: Ministry = {
        id: String((one as any)?.id || ""),
        name: String((one as any)?.name || "Ministry"),
        description: String((one as any)?.description || ""),
        status: String((one as any)?.status || "Active") as MinistryStatus,
        churchId: String((one as any)?.churchId || ""),
        avatarUri: String(
          (one as any)?.avatarUri ||
          (one as any)?.profileImage ||
          (one as any)?.profilePhoto ||
          (one as any)?.photo ||
          (one as any)?.image ||
          (one as any)?.avatar ||
          ""
        ),
        createdAt: String((one as any)?.createdAt || ""),
        updatedAt: String((one as any)?.updatedAt || ""),
      };

      setItem(mapped);
      setName(mapped.name);
      setDescription(mapped.description || "");
      setAvatarUri(String(mapped.avatarUri || ""));
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Failed to load ministry"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canEdit) {
      Alert.alert(
        "Not allowed",
        "Only church admins, pastors, and ministry leaders can edit this ministry.",
        [{ text: "OK", onPress: () => goBackTarget() }]
      );
      return;
    }

    void load();
  }, [ministryId, canEdit]);

  async function onSave() {
    if (!canEdit || !item || saving) return;
    if (!name.trim()) {
      setErr("Ministry name is required.");
      return;
    }

    try {
      Keyboard.dismiss();
      setSaving(true);
      setErr(null);

      const cleanAvatarUri = normalizeImageUri(String((item as any)?.avatarUri || ministryAvatarUri || avatarUri || "").trim());

      const res = await apiPatch<{ ok?: boolean; data?: any; error?: string }>(
        `/api/church/ministries?id=${encodeURIComponent(ministryId)}`,
        {
          name: name.trim(),
          description: description.trim(),

          // send all common backend field names so image persists
          avatarUri: cleanAvatarUri,
          avatarUrl: cleanAvatarUri,
          profileImage: cleanAvatarUri,
          profilePhoto: cleanAvatarUri,
          photo: cleanAvatarUri,
          image: cleanAvatarUri,
          avatar: cleanAvatarUri,
        },
        { headers: headers() }
      );

      if (!res?.ok) {
        throw new Error(String(res?.error || "Failed to update ministry"));
      }

      const savedAvatar =
        String(res?.data?.avatarUri || res?.data?.avatarUrl || res?.data?.profileImage || res?.data?.profilePhoto || res?.data?.photo || res?.data?.image || cleanAvatarUri || "").trim();

      setAvatarUri(savedAvatar);
      setItem((prev) => prev ? { ...prev, name: name.trim(), description: description.trim(), avatarUri: savedAvatar } : prev);

      Alert.alert("Saved", "Ministry profile updated successfully.", [
        {
          text: "OK",
          onPress: () => {
            if (returnTo === "messages-thread" && returnThreadId) {
              router.replace({
                pathname: "/more/my-church-room/messages/[id]",
                params: { id: returnThreadId },
              } as any);
              return;
            }
            router.replace({
              pathname: "/church/ministries/[ministryId]",
              params: { ministryId },
            } as any);
          },
        },
      ]);
    } catch (e: any) {
      setErr(String(e?.message ?? e ?? "Failed to update ministry"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Pressable style={s.screen} onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={{ flex: 1, paddingTop: insets.top }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
      >
        <View style={s.topBar} />
        <View style={s.navGlow} />

        <View style={s.nav}>
          <Pressable onPress={goBackTarget} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.7 }]}>
            <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.88)" />
          </Pressable>

          <View style={s.navMid}>
            <Text style={s.navTitle}>Edit Ministry</Text>
            <Text style={s.navSub} numberOfLines={1}>
              {item?.name || "Update ministry profile"}
            </Text>
          </View>

          <Pressable
            disabled={saving || loading || uploadingPhoto}
            onPress={onSave}
            style={({ pressed }) => [
              s.saveBtn,
              (saving || loading || uploadingPhoto) && { opacity: 0.55 },
              pressed && !saving && !loading && !uploadingPhoto && { transform: [{ scale: 0.99 }] },
            ]}
          >
            {saving ? <ActivityIndicator /> : <Text style={s.saveText}>{uploadingPhoto ? "Uploading..." : "Save"}</Text>}
          </Pressable>
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator />
            <Text style={s.centerText}>Loading ministry...</Text>
          </View>
        ) : (
          <ScrollView
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 360 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={s.form}>
              {err ? <Text style={s.errText}>{err}</Text> : null}

              <View style={s.profileCard}>
                <View style={s.profileAura} />

                <View style={s.profileTopRow}>
                  <View style={s.avatarShell}>
                    <View style={s.avatarGlow} />
                    <View style={s.avatarCircle}>
                      {ministryAvatarUri ? (
                        <Image key={ministryAvatarUri} source={{ uri: ministryAvatarUri }} style={s.avatarImage} resizeMode="cover" />
                      ) : (
                        <Text style={s.avatarText}>{profileInitial}</Text>
                      )}
                    </View>
                  </View>

                  <View style={s.profileTextWrap}>
                    <Text style={s.profileEyebrow}>MINISTRY PROFILE</Text>
                    <Text style={s.profileTitle} numberOfLines={2}>
                      {name.trim() || item?.name || "Ministry"}
                    </Text>
                    <Text style={s.profileSub} numberOfLines={3}>
                      {description.trim() || "Add a clear ministry profile, purpose, and identity."}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ height: 16 }} />

              
<Text style={s.label}>Ministry Name</Text>

{editingName ? (
  <TextInput
    ref={nameRef}
    value={name}
    onChangeText={setName}
    placeholder="Ministry name"
    placeholderTextColor="rgba(255,255,255,0.35)"
    style={s.input}
    autoFocus
    onSubmitEditing={() => {
      Keyboard.dismiss();
      setEditingName(false);
    }}
  />
) : (
  <Pressable
    onPress={() => {
      setEditingName(true);
      setTimeout(() => nameRef.current?.focus(), 100);
    }}
    style={s.simpleProfileCard}
  >
    <View style={s.simpleProfileTop}>
      <Text style={s.simpleProfileTitle}>{name || "Ministry name"}</Text>
      <View style={s.simpleEditBtn}>
        <Text style={s.simpleEditText}>Edit</Text>
      </View>
    </View>
  </Pressable>
)}

              <View style={{ height: 14 }} />

              {editingBio ? (
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Write ministry bio..."
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={[s.input, s.bioInput]}
                  multiline
                  autoFocus
    onFocus={() => {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 180);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 520);
    }}
                  textAlignVertical="top"
                />
              ) : (
                <Pressable onPress={() => {
                    setEditingBio(true);
                    setTimeout(() => {
                      scrollRef.current?.scrollToEnd({ animated: true });
                    }, 180);
                  }} style={s.simpleProfileCard}>
                  <View style={s.simpleProfileTop}>
                    <Text style={s.label}>Bio</Text>
                    <View style={s.simpleEditBtn}><Text style={s.simpleEditText}>Edit</Text></View>
                  </View>
                  <Text style={s.simpleProfileBody} numberOfLines={3}>
                    {description.trim() || "Write ministry profile..."}
                  </Text>
                </Pressable>
              )}

              <View style={{ height: 18 }} />

              <Text style={s.label}>Ministry Photo</Text>
              <View style={s.photoManageCard}>
                <View style={s.photoManageTop}>
                  <View style={s.photoMiniAvatar}>
                    {ministryAvatarUri ? (
                      <Image key={ministryAvatarUri} source={{ uri: ministryAvatarUri }} style={s.avatarImage} resizeMode="cover" />
                    ) : (
                      <Text style={s.photoMiniInitial}>{profileInitial}</Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                  </View>

                  <Pressable
                    onPress={onChangeProfilePhoto}
                    style={({ pressed }) => [s.photoChangeBtn, pressed && { opacity: 0.9 }]}
                  >
                    <Ionicons name="image-outline" size={16} color={GOLD} />
                    <Text style={s.photoChangeText}>{uploadingPhoto ? "Uploading..." : "Change photo"}</Text>
                  </Pressable>
                </View>

                <View style={s.photoDivider} />

                <Pressable
                  onPress={onRemoveProfilePhoto}
                  style={({ pressed }) => [s.photoRemoveBtn, pressed && { opacity: 0.9 }]}
                >
                  <Ionicons name="trash-outline" size={17} color="rgba(255,120,120,0.95)" />
                  <Text style={s.photoRemoveText}>Remove photo</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: VIP_BG },

  simpleProfileCard: {
    borderRadius: 26,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.06)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  simpleProfileTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  simpleProfileTitle: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
  },
  simpleProfileSub: {
    marginTop: 3,
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "800",
  },
  simpleEditBtn: {
    height: 42,
    borderRadius: 999,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  simpleEditText: {
    color: "#0B0F17",
    fontSize: 12,
    fontWeight: "900",
  },
  simpleProfileBody: {
    marginTop: 14,
    color: "rgba(255,255,255,0.82)",
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },

  topBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 36,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  navGlow: {
    position: "absolute",
    left: PAD,
    right: PAD,
    top: 6,
    height: 110,
    borderRadius: 26,
    backgroundColor: "rgba(217,179,95,0.06)",
  },

  nav: {
    marginHorizontal: PAD,
    marginTop: 6,
    marginBottom: 14,
    padding: 16,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.04)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  navMid: { flex: 1, marginLeft: 10 },
  navTitle: { color: "white", fontWeight: "900", fontSize: 16, letterSpacing: 0.2 },
  navSub: { marginTop: 6, color: "rgba(255,255,255,0.66)", fontWeight: "700", fontSize: 13 },

  saveBtn: {
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.16)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.40)",
  },
  saveText: { color: GOLD, fontWeight: "900" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  centerText: { color: MUTED, fontSize: 15, fontWeight: "700" },

  form: {
    marginHorizontal: PAD,
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.024)",
  },

  errText: { marginBottom: 10, color: "rgba(255,120,120,0.95)", fontWeight: "900" },


  photoManageCard: {
    borderRadius: 28,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.055)",
    marginBottom: 120,
  },
  photoManageTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 14,
  },
  photoMiniAvatar: {
    width: 66,
    height: 66,
    borderRadius: 33,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.13)",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.42)",
  },
  photoMiniInitial: {
    color: GOLD,
    fontSize: 24,
    fontWeight: "900",
  },
  photoManageTitle: {
    color: "white",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 12,
  },
  photoManageSub: {
    marginTop: 4,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    fontWeight: "800",
  },
  photoTinyDelete: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,80,80,0.09)",
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.25)",
  },

  photoChangeBtn: {
    minHeight: 50,
    borderRadius: 999,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.10)",
    marginBottom: 12,
  },
  photoChangeText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },
  photoDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginVertical: 6,
  },
  photoRemoveBtn: {
    minHeight: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  photoRemoveText: {
    color: "rgba(255,120,120,0.95)",
    fontSize: 14,
    fontWeight: "900",
  },

  profileCard: {
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(10,16,28,0.92)",
    marginBottom: 2,
    overflow: "hidden",
  },
  profileAura: {
    position: "absolute",
    right: -30,
    top: -26,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  profileTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  profileTextWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  avatarShell: {
    width: 82,
    height: 82,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarGlow: {
    position: "absolute",
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: "rgba(217,179,95,0.10)",
  },
  avatarCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    backgroundColor: "transparent",
  },
  avatarText: {
    color: GOLD,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  profileEyebrow: {
    color: "rgba(217,179,95,0.85)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  profileTitle: {
    marginTop: 6,
    color: "white",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 24,
  },
  profileSub: {
    marginTop: 6,
    color: "rgba(255,255,255,0.64)",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  profileActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  profileBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 15,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  profileBtnPrimary: {
    borderColor: "rgba(217,179,95,0.30)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  profileBtnGhost: {
    borderColor: "rgba(255,120,120,0.22)",
    backgroundColor: "rgba(120,20,20,0.16)",
  },
  profileBtnPrimaryText: {
    color: GOLD,
    fontWeight: "900",
  },
  profileBtnGhostText: {
    color: "rgba(255,120,120,0.98)",
    fontWeight: "900",
  },

  label: { marginTop: 4, color: "rgba(255,255,255,0.86)", fontWeight: "800", fontSize: 15 },
  labelHint: { marginTop: 7, color: "rgba(255,255,255,0.52)", fontWeight: "700", fontSize: 12, lineHeight: 17 },

  swipeDeck: {
    marginTop: 6,
    marginHorizontal: -16,
    borderRadius: 0,
    paddingTop: 10,
    paddingBottom: 14,
    borderWidth: 0,
    backgroundColor: "transparent",
    overflow: "visible",
  },
  swipeDeckAura: {
    position: "absolute",
    right: -28,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(217,179,95,0.04)",
  },
  swipeDeckTop: {
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  swipeDeckTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  swipeHintPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  swipeDeckHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "800",
  },
  swipeTrack: {
    paddingHorizontal: 12,
    gap: 12,
  },
  swipeCard: {
    width: 288,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    minHeight: 210,
    overflow: "hidden",
  },
  swipeCardEditor: {
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  swipeCardMeta: {
    borderColor: "rgba(90,130,255,0.18)",
    backgroundColor: "rgba(18,28,52,0.92)",
  },
  cardGlowGold: {
    position: "absolute",
    right: -18,
    top: -18,
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "rgba(217,179,95,0.05)",
  },
  cardGlowBlue: {
    position: "absolute",
    right: -18,
    top: -18,
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(90,130,255,0.08)",
  },
  editorTopCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  quickTop: {
    marginBottom: 8,
  },
  quickTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  quickRow: {
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  quickRowLast: {
    paddingTop: 7,
  },
  quickKey: {
    color: "rgba(255,255,255,0.50)",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  quickValue: {
    color: "white",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  swipeDots: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 6,
  },
  swipeDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  swipeDotActive: {
    width: 20,
    backgroundColor: "rgba(217,179,95,0.95)",
  },

  editorCard: {
    marginTop: 6,
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(255,255,255,0.025)",
  },
  editorTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  editorBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  editorBadgeText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  editorCount: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 11,
    fontWeight: "700",
  },

  bioInput: {
    minHeight: 150,
    paddingTop: 16,
    paddingBottom: 18,
  },

  input: {
    marginTop: 6,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    color: "white",
    fontWeight: "800",
    fontSize: 15,
  },

  textarea: {
    minHeight: 196,
    paddingTop: 16,
    lineHeight: 21,
  },
  editorInput: {
    marginTop: 0,
    minHeight: 170,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  
  previewTextBox: {
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.045)",
    color: "white",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },

  editorInputCompact: {
    marginTop: 0,
    minHeight: 76,
    maxHeight: 76,
    borderRadius: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    lineHeight: 18,
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  metaCard: {
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(217,179,95,0.06)",
  },
  metaTitle: { color: "white", fontSize: 13, fontWeight: "900", marginBottom: 8 },
  metaRow: {
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  metaRowLast: {
    paddingTop: 5,
  },
  metaKey: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  metaValue: {
    color: "white",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
});
