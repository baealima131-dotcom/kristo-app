import React, { useEffect, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { buildAvatarDataUrl } from "@/src/lib/avatarCompress";

const GOLD = "rgba(217,179,95,0.96)";
const BG = "#070B14";

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

  const [name, setName] = useState("");
  const [pastorName, setPastorName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [avatarUri, setAvatarUri] = useState("");
  const [avatarDirty, setAvatarDirty] = useState(false);

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
      setAvatarUri(mediaUrl(p.avatarUri || p.avatarUrl || cached?.avatarUri || cached?.avatarUrl || ""));
      setAvatarDirty(false);

      if (churchId && p?.name) {
        await saveChurchProfileCache({
          churchId,
          name: String(p.name || ""),
          pastorName: String(p.pastorName || ""),
          phone: String(p.phone || ""),
          address: String(p.address || ""),
          avatarUri: mediaUrl(p.avatarUri || p.avatarUrl || ""),
          avatarUrl: mediaUrl(p.avatarUrl || p.avatarUri || ""),
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
      quality: 0.85,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (res.canceled) return;
    const picked = String(res.assets?.[0]?.uri || "").trim();
    if (picked) {
      setAvatarUri(picked);
      setAvatarDirty(true);
    }
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

    const localProfile = {
      churchId,
      name: trimmedName,
      pastorName: trimmedPastor,
      phone: trimmedPhone,
      address: trimmedAddress,
      avatarUri: displayAvatar,
      avatarUrl: displayAvatar,
    };

    await saveChurchProfileCache(localProfile);

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

    router.replace({
      pathname: "/(tabs)/church/overview",
      params: {
        saved: "1",
        savedName: trimmedName,
        refreshAt: String(Date.now()),
      },
    } as any);

    void (async () => {
      try {
        let avatarData = "";
        let patchAvatarUri = "";
        let patchAvatarUrl = "";

        if (avatarDirty) {
          if (avatarUri.startsWith("file:")) {
            avatarData = await buildAvatarDataUrl(avatarUri);
          } else {
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
        const synced = {
          churchId,
          name: String(p.name || trimmedName),
          pastorName: String(p.pastorName || trimmedPastor),
          phone: String(p.phone || trimmedPhone),
          address: String(p.address || trimmedAddress),
          avatarUri: mediaUrl(p.avatarUri || p.avatarUrl || displayAvatar),
          avatarUrl: mediaUrl(p.avatarUrl || p.avatarUri || displayAvatar),
        };
        await saveChurchProfileCache(synced);
        setAvatarDirty(false);

        if (session) {
          await setSession({
            ...session,
            churchId: churchId || session.churchId,
            activeChurchId: churchId || session.activeChurchId,
            churchName: synced.name,
          } as any);
        }

        if (__DEV__) {
          console.log("[EditChurch] patch success", { churchId, name: synced.name });
        }
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
        <Pressable onPress={() => router.back()} style={s.backBtn}>
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
    height: 128,
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
    height: 118,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  avatar: { width: 118, height: 118, borderRadius: 30 },
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
});
