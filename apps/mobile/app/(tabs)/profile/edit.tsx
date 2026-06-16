import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Image, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { loadProfileDraft, saveProfileDraft, ProfileDraft } from "@/src/lib/profileStore";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { apiPost, apiGet } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { buildAvatarDataUrl, compressAvatarFile } from "@/src/lib/avatarCompress";
import { emitUserProfileUpdated } from "@/src/lib/kristoProfileEvents";
import { pickFresherAvatar } from "@/src/lib/avatarFreshness";

const BG = "#050914";
const GOLD = "#F4D06F";
const MUTED = "rgba(255,255,255,0.66)";
const BORDER = "rgba(244,208,111,0.24)";
const CARD = "rgba(255,255,255,0.055)";

function cleanName(v?: string | null) {
  const t = String(v || "").trim();
  if (!t) return "";
  if (/^u[_-]/i.test(t)) return "";
  if (/^KR\d/i.test(t)) return "";
  if (t.length > 32 && !t.includes(" ")) return "";
  return t;
}

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, setSession } = useKristoSession();

  const signupName = useMemo(
    () => cleanName((session as any)?.displayName) || cleanName((session as any)?.name),
    [session]
  );

  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);
  const [avatarDirty, setAvatarDirty] = useState(false);
  const [focused, setFocused] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [phonePublic, setPhonePublic] = useState(false);
  const [addressPublic, setAddressPublic] = useState(false);
  const [churchPublic, setChurchPublic] = useState(true);
  const [phoneValue, setPhoneValue] = useState("");
  const [addressValue, setAddressValue] = useState("");

  // HYDRATE_FROM_SESSION
  useEffect(() => {
    if (!session) return;

    setPhoneValue(String((session as any)?.phone || ""));
    setAddressValue(String((session as any)?.address || ""));
    setCityValue(String((session as any)?.city || ""));
    setCountryValue(String((session as any)?.country || ""));
  }, [session]);

  const [cityValue, setCityValue] = useState("");
  const [countryValue, setCountryValue] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      const saved = await loadProfileDraft(session?.userId);
      const apiRes = await apiGet<any>("/api/auth/profile", { headers: getKristoHeaders() }).catch(() => null);
      const apiProfile = apiRes?.ok ? apiRes?.profile : null;

      if (!alive) return;

      const savedName = cleanName(saved?.displayName);
      const apiName = cleanName(apiProfile?.fullName);
      const sessionName = cleanName(session?.displayName || session?.name);

      setDisplayName(apiName || savedName || signupName || sessionName || "");
      setBio(String((apiProfile as any)?.bio || saved?.bio || ""));
      setAvatarUri(apiProfile?.avatarUrl ? String(apiProfile.avatarUrl) : saved?.avatarUri);
      setAvatarDirty(false);

      setPhoneValue(String(apiProfile?.phone || (saved as any)?.phone || (session as any)?.phone || ""));
      setAddressValue(String((saved as any)?.address || (session as any)?.address || ""));
      setCityValue(String(apiProfile?.city || (saved as any)?.city || (session as any)?.city || ""));
      setCountryValue(String(apiProfile?.country || (saved as any)?.country || (session as any)?.country || ""));

      setPhonePublic(Boolean((saved as any)?.phonePublic ?? (session as any)?.phonePublic ?? false));
      setAddressPublic(Boolean((saved as any)?.addressPublic ?? (session as any)?.addressPublic ?? false));
      setChurchPublic(Boolean((saved as any)?.churchPublic ?? (session as any)?.churchPublic ?? true));
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [session?.userId, signupName]);

  const pickAvatar = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (res.canceled) return;

    const pickedUri = String(res.assets?.[0]?.uri || "").trim();
    if (!pickedUri) return;

    try {
      const dir = `${FileSystem.documentDirectory}profile-avatar/`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const nextUri = `${dir}${String(session?.userId || "me")}-${Date.now()}.jpg`;

      const compressedUri = await compressAvatarFile(pickedUri, nextUri);
      setAvatarUri(compressedUri);
      setAvatarDirty(true);
    } catch {
      setAvatarUri(pickedUri);
      setAvatarDirty(true);
    }
  };

  const openBioCard = () => {
    setBioDraft(bio || "");
    setBioOpen(true);
  };

  const saveBioCard = () => {
    setBio(bioDraft.trim());
    setBioOpen(false);
  };

  const onSave = async () => {
    if (!session?.userId) return;

    const nextProfile: ProfileDraft = {
      userId: session.userId,
      kristoId: (session as any)?.kristoId || "",
      displayName: displayName.trim(),
      bio: bio.trim(),
      avatarUri,
      phone: phoneValue || session?.phone || "",
      email: session?.email || "",
      address: addressValue || session?.address || "",
      city: cityValue || session?.city || "",
      country: countryValue || session?.country || "",
      gender: session?.gender || "",
      phonePublic,
      addressPublic,
      churchPublic,
    } as any;

    await saveProfileDraft(nextProfile, session.userId);

    const now = Date.now();
    const optimisticAvatarAt =
      avatarDirty && String(nextProfile.avatarUri || "").trim() ? now : (nextProfile as any).avatarUpdatedAt;

    if (optimisticAvatarAt) {
      await saveProfileDraft(
        { ...nextProfile, avatarUpdatedAt: optimisticAvatarAt } as any,
        session.userId
      );
      console.log("[ProfileEdit] optimistic avatar saved", {
        userId: session.userId,
        avatarUpdatedAt: optimisticAvatarAt,
      });
    }

    await setSession({
      ...session,
      name: nextProfile.displayName,
      displayName: nextProfile.displayName,
      avatarUri: nextProfile.avatarUri,
      avatarUrl: nextProfile.avatarUri,
      phone: nextProfile.phone,
      address: nextProfile.address,
      city: nextProfile.city,
      country: nextProfile.country,
      phonePublic,
      addressPublic,
      churchPublic,
    } as any);

    if (__DEV__) {
      console.log("[ProfileEdit] save tap local update", {
        userId: session.userId,
        displayName: nextProfile.displayName,
      });
    }

    emitUserProfileUpdated({
      userId: session.userId,
      avatarUri: nextProfile.avatarUri,
      avatarUrl: nextProfile.avatarUri,
      updatedAt: now,
      avatarUpdatedAt: optimisticAvatarAt,
    });

    router.back();

    void (async () => {
      const cleanAvatar = String(avatarUri || "").trim();
      const backendAvatar =
        !avatarDirty
          ? cleanAvatar && !cleanAvatar.startsWith("file:")
            ? cleanAvatar
            : ""
          : cleanAvatar && !cleanAvatar.startsWith("file:")
            ? cleanAvatar
            : "";

      let avatarData = "";
      if (avatarDirty && cleanAvatar.startsWith("file:")) {
        try {
          avatarData = await buildAvatarDataUrl(cleanAvatar);
        } catch {}
      }

      try {
        const savedRes: any = await apiPost(
          "/api/auth/profile",
          {
            fullName: nextProfile.displayName,
            bio: nextProfile.bio,
            phone: nextProfile.phone,
            country: nextProfile.country,
            city: nextProfile.city,
            gender: nextProfile.gender,
            userCode: (session as any).kristoId || session.userId,
            backendUserId: session.userId,
            avatarUrl: backendAvatar,
            avatarData,
            privacy: {
              showPhone: phonePublic,
              showChurch: churchPublic,
              showAddress: addressPublic,
            },
          },
          { headers: getKristoHeaders() }
        );

        if (savedRes?.ok === false) {
          throw new Error(String(savedRes?.error || savedRes?.reason || "Profile save failed"));
        }

        const serverProfile = savedRes?.profile || {};
        const serverAvatarRaw = String(serverProfile?.avatarUrl || backendAvatar || "").trim();
        const mergedAvatar = pickFresherAvatar({
          localUri: String(nextProfile.avatarUri || "").trim(),
          localUpdatedAt: optimisticAvatarAt,
          serverUri: serverAvatarRaw,
          serverUpdatedAt: Number(serverProfile?.updatedAt || serverProfile?.avatarUpdatedAt || Date.now()),
        });
        const serverAvatar = mergedAvatar.uri;
        const avatarUpdatedAt =
          mergedAvatar.source === "local"
            ? optimisticAvatarAt || Date.now()
            : avatarDirty || serverAvatar
              ? Date.now()
              : undefined;
        const syncedChurchId = String(
          savedRes?.churchId || savedRes?.activeMembership?.churchId || session.churchId || ""
        ).trim();
        const syncedChurchName = String(savedRes?.churchName || (session as any)?.churchName || "").trim();

        const syncedProfile: ProfileDraft = {
          ...nextProfile,
          displayName: String(serverProfile?.fullName || nextProfile.displayName || "").trim(),
          bio: String(serverProfile?.bio || nextProfile.bio || "").trim(),
          avatarUri: serverAvatar || nextProfile.avatarUri,
          phone: String(serverProfile?.phone || nextProfile.phone || ""),
          city: String(serverProfile?.city || nextProfile.city || ""),
          country: String(serverProfile?.country || nextProfile.country || ""),
          avatarUpdatedAt,
        } as any;

        await saveProfileDraft(syncedProfile, session.userId);
        setAvatarDirty(false);

        await setSession({
          ...session,
          name: syncedProfile.displayName,
          displayName: syncedProfile.displayName,
          kristoId: (session as any).kristoId,
          avatarUri: serverAvatar || syncedProfile.avatarUri,
          avatarUrl: serverAvatar || syncedProfile.avatarUri,
          phone: syncedProfile.phone,
          address: syncedProfile.address,
          city: syncedProfile.city,
          country: syncedProfile.country,
          churchId: syncedChurchId || session.churchId,
          activeChurchId: syncedChurchId || (session as any).activeChurchId,
          churchName: syncedChurchName || (session as any).churchName || "",
          role: String(
            syncedChurchId
              ? savedRes?.role || savedRes?.churchRole || savedRes?.activeMembership?.churchRole || session.role
              : session.role
          ) as any,
          phonePublic,
          addressPublic,
          churchPublic,
        } as any);

        emitUserProfileUpdated({
          userId: session.userId,
          avatarUri: syncedProfile.avatarUri,
          avatarUrl: syncedProfile.avatarUri,
          updatedAt: Date.now(),
          avatarUpdatedAt,
        });

        console.log("[ProfileEdit] patch success updated cache", {
          userId: session.userId,
          avatarUpdatedAt: avatarUpdatedAt || null,
        });
      } catch (e: any) {
        const msg = String(e?.message || e || "Profile save failed");
        if (__DEV__) {
          console.warn("[ProfileEdit] patch fail", { userId: session.userId, error: msg });
        }
        Alert.alert(
          "Profile sync failed",
          `${msg}\n\nYour edits are saved on this device. Open Edit Profile again to retry syncing.`
        );
      }
    })();
  };

  const fullAddress = [addressValue, cityValue, countryValue].filter(Boolean).join(", ");
  const churchLabel = String(
    (session as any)?.churchName ||
      (session as any)?.churchTitle ||
      ""
  ).trim();

  const infoRows = [
    {
      icon: "call-outline",
      label: "Phone",
      value: phoneValue || "No phone yet",
      on: phonePublic,
      toggle: () => setPhonePublic((v) => !v),
    },
    {
      icon: "location-outline",
      label: "Address",
      value: fullAddress || "No address yet",
      on: addressPublic,
      toggle: () => setAddressPublic((v) => !v),
    },
    {
      icon: "business-outline",
      label: "Church",
      value: churchLabel || "No Church Yet",
      on: churchPublic,
      toggle: () => setChurchPublic((v) => !v),
    },
  ];

  if (loading) {
    return (
      <View style={s.shell} />
    );
  }


  return (
    <KeyboardAvoidingView
      style={s.shell}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 14 : 0}
    >
      <View style={s.shell}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: Math.max(26, insets.top + 22),
          paddingBottom: 240,
        }}
      >
        <View style={s.top}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={s.title}>Edit Profile</Text>
            <Text style={s.subtitle}>Profile details</Text>
          </View>

          <Pressable onPress={onSave} style={s.topSaveBtn}>
            <Ionicons name="checkmark" size={22} color="#06101D" />
          </Pressable>
        </View>

        <View style={s.heroCard}>
          <Pressable onPress={pickAvatar} style={s.avatarFloatingBtn}>
            <Ionicons name="create-outline" size={22} color="#07111F" />
          </Pressable>

          <View style={s.heroRowNew}>
            <Pressable onPress={pickAvatar} style={s.heroAvatarLeft}>
              <View style={s.avatarInner}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={s.avatarImage} />
                ) : (
                  <Ionicons name="person" size={34} color={GOLD} />
                )}
              </View>

              <View style={s.avatarEditBadge}>
                <Ionicons name="create-outline" size={12} color="#07111F" />
              </View>
            </Pressable>

            <View style={s.heroTextWrap}>
              <Text style={s.heroTitle} numberOfLines={1}>
                {displayName || signupName || "Your name"}
              </Text>
              <Text style={s.heroSub}>Kristo ID protected</Text>
            </View>
          </View>

          <Text style={[s.h, { marginTop: 10 }]}>Kristo ID / Username</Text>
          <View style={s.lockedV2Box}>
            <View style={s.lockedV2Icon}>
              <Ionicons name="lock-closed-outline" size={18} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.lockedV2Title}>Username in V2</Text>
              <Text style={s.lockedV2Sub}>Kristo ID remains unchanged.</Text>
            </View>
          </View>

          <View style={s.heroInfoBox}>
            {infoRows.map((row) => (
              <View key={row.label} style={s.heroInfoRow}>
                <Ionicons name={row.icon as any} size={18} color={GOLD} />
                <View style={s.heroInfoText}>
                  <Text style={s.heroInfoLabel}>{row.label}</Text>
                  <Text style={s.heroInfoValue} numberOfLines={1}>{row.value}</Text>
                </View>
                <Pressable onPress={row.toggle} style={[s.privacyPill, row.on && s.privacyPillOn]}>
                  <Text style={[s.privacyText, row.on && s.privacyTextOn]}>
                    {row.on ? "ON" : "OFF"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>

          
        </View>

        <View style={s.card}>
          <Text style={s.h}>Name</Text>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={signupName || "Enter your name"}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[
              s.input,
              focused && {
                borderColor: "#F4D06F",
                shadowColor: "#F4D06F",
                shadowOpacity: 0.25,
                shadowRadius: 12,
              },
            ]}
          />

          <Text style={[s.h, { marginTop: 16 }]}>Bio</Text>
          <Pressable onPress={openBioCard} style={[s.input, s.bioInput, s.bioPreview]}>
            <Text style={bio ? s.bioPreviewText : s.bioPreviewPlaceholder} numberOfLines={4}>
              {bio || "Write something about yourself..."}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={bioOpen} transparent animationType="fade" onRequestClose={() => setBioOpen(false)}>
        <KeyboardAvoidingView
          style={s.bioOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}
        >
          <Pressable style={s.bioBackdrop} onPress={() => setBioOpen(false)} />
          <View style={s.bioSheet}>
            <View style={s.bioSheetTop}>
              <View>
                <Text style={s.bioSheetTitle}>Edit Bio</Text>
                <Text style={s.bioSheetSub}>Write a short profile message.</Text>
              </View>

              <Pressable onPress={() => setBioOpen(false)} style={s.bioCloseBtn}>
                <Ionicons name="close" size={18} color="white" />
              </Pressable>
            </View>

            <TextInput
              value={bioDraft}
              onChangeText={setBioDraft}
              placeholder="Write something about yourself..."
              placeholderTextColor="rgba(255,255,255,0.35)"
              autoFocus
              multiline
              style={s.bioSheetInput}
            />

            <Pressable onPress={saveBioCard} style={s.bioSheetSave}>
              <Text style={s.bioSheetSaveText}>Done</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  );

}


const s: any = StyleSheet.create({
  shell: { flex: 1, backgroundColor: BG },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 120 },

  top: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18 },
  backBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },

  topSaveBtn: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },

  titleBlock: { flex: 1 },
  title: { color: "white", fontWeight: "900", fontSize: 24 },
  subtitle: { color: MUTED, fontWeight: "800", fontSize: 14, marginTop: 2 },


  heroCenter: {
    alignItems: "center",
    justifyContent: "center",
  },
  heroAvatarBig: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.14)",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.42)",
    marginBottom: 7,
  },


  heroRowNew: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  heroAvatarLeft: {
    position: "relative",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    overflow: "hidden",
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.14)",
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.42)",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
  },

  avatarInner: {
    width: "100%",
    height: "100%",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#F4D06F",
  },

  avatarEditBadge: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F4D06F",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#050914",
    elevation: 6,
    shadowColor: "#F4D06F",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },

  heroTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  heroInfoBox: {
    width: "100%",
    marginTop: 10,
    gap: 8,
  },
  heroInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.14)",
    backgroundColor: "rgba(0,0,0,0.18)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  heroInfoText: {
    flex: 1,
    minWidth: 0,
  },
  heroInfoLabel: {
    color: "rgba(255,255,255,0.46)",
    fontWeight: "800",
    fontSize: 11,
  },
  heroInfoValue: {
    color: "white",
    fontWeight: "900",
    fontSize: 12,
    marginTop: 1,
  },
  privacyPill: {
    minWidth: 44,
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  privacyPillOn: {
    backgroundColor: "rgba(244,208,111,0.18)",
    borderColor: "rgba(244,208,111,0.38)",
  },
  privacyText: {
    color: "rgba(255,255,255,0.50)",
    fontWeight: "900",
    fontSize: 10,
  },
  privacyTextOn: {
    color: GOLD,
  },

  heroEditBtn: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    backgroundColor: "rgba(244,208,111,0.08)",
  },
  heroEditText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 12,
  },
  smallCard: {
    marginTop: 18,
  },

  heroCard: {
    position: "relative",
    marginTop: 12,
    borderWidth: 1.2,
    borderColor: "rgba(244,208,111,0.34)",
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: "rgba(244,208,111,0.06)",
    shadowColor: "#F4D06F",
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },
  heroTextSide: {
    flex: 1,
    minWidth: 0,
  },
  heroAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.28)",
    backgroundColor: "rgba(244,208,111,0.10)",
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  heroActionText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 12,
  },

  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.34)",
  },
  heroName: { color: "white", fontWeight: "900", fontSize: 22 },
  heroSub: { color: MUTED, fontWeight: "700", fontSize: 14, lineHeight: 20, marginTop: 6 },

  card: {
    marginTop: 18,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
    padding: 11,
    backgroundColor: CARD,
  },
  h: { color: "white", fontWeight: "900", fontSize: 14, marginBottom: 9 },
  hint: { color: MUTED, marginTop: 8, fontWeight: "700", lineHeight: 18 },

  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.24)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "white",
    fontWeight: "800",
    fontSize: 14,
  },
  bioInput: { height: 96, textAlignVertical: "top", paddingTop: 14, lineHeight: 20 },

  lockedV2Box: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.18)",
    backgroundColor: "rgba(244,208,111,0.055)",
    borderRadius: 16,
    padding: 12,
  },
  lockedV2Icon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.13)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.32)",
  },
  lockedV2Title: { color: "white", fontWeight: "900", fontSize: 15 },
  lockedV2Sub: { color: MUTED, fontWeight: "700", lineHeight: 17, marginTop: 3 },


  bioPreview: {
    justifyContent: "flex-start",
  },
  bioPreviewText: {
    color: "white",
    fontWeight: "800",
    fontSize: 15,
    lineHeight: 21,
  },
  bioPreviewPlaceholder: {
    color: "rgba(255,255,255,0.35)",
    fontWeight: "900",
    fontSize: 15,
  },
  bioOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  bioBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  bioSheet: {
    borderRadius: 30,
    padding: 18,
    paddingBottom: 18,
    maxHeight: "62%",
    backgroundColor: "#10151F",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.32)",
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 },
  },
  bioSheetTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  bioSheetTitle: {
    color: "white",
    fontWeight: "900",
    fontSize: 22,
  },
  bioSheetSub: {
    color: MUTED,
    fontWeight: "800",
    marginTop: 3,
  },
  bioCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  bioSheetInput: {
    minHeight: 130,
    maxHeight: 210,
    borderRadius: 24,
    padding: 16,
    color: "white",
    fontWeight: "800",
    fontSize: 16,
    lineHeight: 23,
    textAlignVertical: "top",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  bioSheetSave: {
    marginTop: 14,
    borderRadius: 22,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: GOLD,
  },
  bioSheetSaveText: {
    color: "#07111F",
    fontWeight: "900",
    fontSize: 16,
  },

  avatarBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "rgba(244,208,111,0.13)",
    borderWidth: 1,
    borderColor: "rgba(244,208,111,0.32)",
  },
  avatarBtnText: { color: GOLD, fontWeight: "900", marginLeft: 10, fontSize: 16 },

  saveBtn: {
    marginTop: 10,
    marginBottom: 110,
    borderRadius: 24,
    paddingVertical: 7,
    alignItems: "center",
    backgroundColor: GOLD,
  },




  floatingGroup: {
    
    top: 20,
    right: 18,
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  saveFloatingBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,208,111,0.92)",
    shadowColor: GOLD,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },

  avatarFloatingBtn: {
    position: "absolute",
    top: 18,
    right: 18,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 99,
  },

  heroTitle: { color: "white", fontWeight: "900", fontSize: 17 },

  saveText: { color: "#07111F", fontWeight: "900", fontSize: 16 },
});
