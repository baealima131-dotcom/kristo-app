import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { loadProfileDraft, saveProfileDraft, ProfileDraft } from "@/src/lib/profileStore";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const MUTED = "rgba(255,255,255,0.65)";
const BORDER = "rgba(255,255,255,0.10)";
const CARD = "rgba(255,255,255,0.03)";

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();

  const fallbackName = useMemo(() => {
    const uid = session?.userId || "user";
    return uid.startsWith("u-") ? uid.replace(/^u-/, "") : uid;
  }, [session?.userId]);

  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    (async () => {
      const saved = await loadProfileDraft();
      setDisplayName(saved?.displayName || fallbackName);
      setUsername(saved?.username || "");
      setBio(saved?.bio || "");
      setAvatarUri(saved?.avatarUri);
      setLoading(false);
    })();
  }, [fallbackName]);

  async function pickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (res.canceled) return;
    const uri = res.assets?.[0]?.uri;
    if (uri) setAvatarUri(uri);
  }

  async function onSave() {
    const d: ProfileDraft = {
      displayName: displayName.trim() || fallbackName,
      username: username.trim() || undefined,
      bio: bio.trim() || undefined,
      avatarUri,
    };
    await saveProfileDraft(d);
    router.back();
  }

  if (loading) {
    return <View style={[s.shell, { paddingTop: Math.max(18, insets.top + 12) }]} />;
  }

  return (
    <View style={s.shell}>
      <View style={[s.top, { paddingTop: Math.max(18, insets.top + 12) }]}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.85)" />
        </Pressable>
        <Text style={s.title}>Edit profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.card}>
        <Text style={s.h}>Avatar</Text>
        <Pressable onPress={pickAvatar} style={({ pressed }) => [s.avatarBtn, pressed && { opacity: 0.9 }]}>
          <Ionicons name="image-outline" size={18} color={GOLD} />
          <Text style={s.avatarBtnText}>{avatarUri ? "Change avatar" : "Pick avatar"}</Text>
        </Pressable>
        {!!avatarUri && <Text style={s.hint}>Saved locally (V1). Later tuta-upload.</Text>}
      </View>

      <View style={s.card}>
        <Text style={s.h}>Name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <Text style={[s.h, { marginTop: 12 }]}>Username</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="e.g. princefariji"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="none"
          style={s.input}
        />

        <Text style={[s.h, { marginTop: 12 }]}>Bio</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Write something..."
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          style={[s.input, { height: 110, textAlignVertical: "top" }]}
        />
      </View>

      <Pressable onPress={onSave} style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.92 }]}>
        <Text style={s.saveText}>Save</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: BG, paddingHorizontal: 16 },
  top: { flexDirection: "row", alignItems: "center", paddingBottom: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "white", fontWeight: "900", fontSize: 18, flex: 1, textAlign: "center" },

  card: { marginTop: 14, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 14, backgroundColor: CARD },
  h: { color: "white", fontWeight: "900", letterSpacing: 0.2, marginBottom: 8 },
  hint: { color: MUTED, marginTop: 8, fontWeight: "700" },

  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(0,0,0,0.20)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "white",
    fontWeight: "800",
  },

  avatarBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: "rgba(217,179,95,0.14)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.30)",
  },
  avatarBtnText: { color: GOLD, fontWeight: "900", marginLeft: 10 },

  saveBtn: {
    marginTop: 14,
    marginBottom: 22,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.35)",
  },
  saveText: { color: GOLD, fontWeight: "900", fontSize: 16 },
});
