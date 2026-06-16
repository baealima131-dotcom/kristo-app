import React, { useEffect, useMemo, useState } from "react";
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ChurchDraft } from "@/src/lib/churchStore";
import { findChurchById } from "@/src/lib/churchDirectoryStore";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { requestJoinChurch } from "@/src/lib/churchMembersApi";

const PAD = 16;
const VIP_BG = "#05070D";
const GOLD = "rgba(244,201,93,0.98)";

function cleanSuffix(v: string) {
  return v.trim().replace(/^CH7-/i, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function cleanId(v: string) {
  return v.trim().replace(/\s+/g, "").toUpperCase();
}

export default function AddChurchIdScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useKristoSession();
  const [rawId, setRawId] = useState("");
  const [sent, setSent] = useState(false);
  const [localChurch, setLocalChurch] = useState<ChurchDraft | null>(null);

  const suffix = useMemo(() => cleanSuffix(rawId), [rawId]);
  const normalized = useMemo(() => cleanId(rawId), [rawId]);
  const canSearch = suffix.length >= 4;

  useEffect(() => {
    let alive = true;
    if (!normalized) {
      setLocalChurch(null);
      return () => {
        alive = false;
      };
    }

    findChurchById(normalized).then((d) => {
      if (alive) setLocalChurch(d as any);
    });

    return () => {
      alive = false;
    };
  }, [normalized]);


  const matchedChurch = useMemo(() => {
    if (!canSearch || !localChurch?.churchId) return null;
    return cleanId(localChurch.churchId) === normalized ? localChurch : null;
  }, [canSearch, localChurch, normalized]);

  const foundChurch = canSearch ? matchedChurch : null;
  const searchedButNotFound = canSearch && !matchedChurch;

  const churchName = foundChurch?.churchName || foundChurch?.churchProfile?.name || "Church";
  const province = foundChurch?.churchProfile?.province || "";
  const location = [foundChurch?.churchCity, province, foundChurch?.churchCountry].filter(Boolean).join(" • ");
  const canRequest = !!matchedChurch;

  async function sendRequest() {
    if (!matchedChurch) {
      Alert.alert("Church not found", "Cannot send request.");
      return;
    }

    const userId = session?.userId;
    if (!userId) {
      Alert.alert("Session missing", "Please log in again.");
      return;
    }

    await requestJoinChurch(
      matchedChurch.churchId,
      session?.displayName || session?.name || userId
    );

    setSent(true);
    Alert.alert("Request sent", "Waiting for pastor approval.");
  }

  return (
    <Pressable style={s.screen} onPress={() => Keyboard.dismiss()} accessible={false}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [s.backBtn, pressed && { opacity: 0.72 }]}>
          <Ionicons name="chevron-back" size={20} color="rgba(255,255,255,0.92)" />
        </Pressable>

        <Text style={s.title}>Add Church</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: PAD, paddingTop: 6, paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.topIcon}>
            <MaterialCommunityIcons name="church" size={30} color={GOLD} />
          </View>

          <Text style={s.label}>CHURCH ID</Text>

          <View style={s.inputWrap}>
            <TextInput
              value={rawId}
              onChangeText={(v) => {
                setRawId(v);
                setSent(false);
              }}
              placeholder="Paste Church ID"
              placeholderTextColor="rgba(255,255,255,0.28)"
              autoCapitalize="characters"
              autoCorrect={false}
              style={s.input}
            />
            {!!suffix ? (
              <Pressable onPress={() => setRawId("")} style={s.iconBtn}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.82)" />
              </Pressable>
            ) : (
              <View style={s.iconBtn}>
                <Ionicons name="search" size={18} color={GOLD} />
              </View>
            )}
          </View>

          <View style={s.resultCard}>
            {!canSearch ? (
              <>
                <View style={s.resultIcon}>
                  <Ionicons name="search-outline" size={24} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultTitle}>Type Church ID</Text>
                  <Text style={s.resultSub}>Search church profile.</Text>
                </View>
              </>
            ) : foundChurch ? (
              <>
                <View style={s.resultIcon}>
                  <MaterialCommunityIcons name="church" size={25} color={GOLD} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultTitle} numberOfLines={1}>{churchName}</Text>
                  <Text style={s.resultSub} numberOfLines={1}>{location || normalized}</Text>

                  <Pressable style={s.viewProfile} onPress={() => Alert.alert("Church profile", `${churchName}\n${location || normalized}`)}>
                    <Text style={s.viewText}>View Profile</Text>
                    <Ionicons name="arrow-forward" size={14} color={GOLD} />
                  </Pressable>
                </View>
              </>
            ) : searchedButNotFound ? (
              <>
                <View style={s.resultIconBad}>
                  <Ionicons name="close" size={24} color="rgba(255,120,120,0.95)" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.resultTitle}>Church not found</Text>
                  <Text style={s.resultSub}>Check the ID or ask pastor/admin.</Text>
                </View>
              </>
            ) : null}
          </View>

          <Pressable
            disabled={!canRequest}
            onPress={sendRequest}
            style={({ pressed }) => [s.sendBtn, !canRequest ? s.sendBtnOff : s.sendBtnOn, pressed && canRequest && { transform: [{ scale: 0.99 }] }]}
          >
            <Text style={[s.sendText, canRequest && s.sendTextOn]}>{sent ? "REQUEST SENT" : "SEND REQUEST"}</Text>
            <Ionicons name={sent ? "checkmark-circle" : "arrow-forward"} size={20} color={canRequest ? "#07101A" : "rgba(255,255,255,0.42)"} />
          </Pressable>
        </View>
      </ScrollView>
    </Pressable>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: VIP_BG },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAD, paddingBottom: 16 },
  backBtn: {
    width: 42, height: 42, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(244,201,93,0.22)",
  },
  title: { color: "#fff", fontSize: 28, fontWeight: "950", letterSpacing: 0.2 },

  card: {
    borderRadius: 30, padding: 18, backgroundColor: "rgba(255,255,255,0.032)",
    borderWidth: 1.2, borderColor: "rgba(244,201,93,0.22)",
  },
  topIcon: {
    alignSelf: "center", width: 86, height: 86, borderRadius: 43, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.36)", borderWidth: 2, borderColor: "rgba(244,201,93,0.68)",
    marginBottom: 18,
  },
  label: { color: GOLD, fontSize: 12, fontWeight: "950", letterSpacing: 1.4, marginBottom: 10 },
  inputWrap: {
    height: 62, borderRadius: 22, paddingHorizontal: 14, flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.36)", borderWidth: 1, borderColor: "rgba(244,201,93,0.34)",
  },
  input: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "950", letterSpacing: 0.5 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
  },

  resultCard: {
    marginTop: 16, minHeight: 104, borderRadius: 24, padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(0,0,0,0.28)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
  },
  resultIcon: {
    width: 58, height: 58, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(244,201,93,0.10)", borderWidth: 1, borderColor: "rgba(244,201,93,0.25)",
  },
  resultIconBad: {
    width: 58, height: 58, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,80,80,0.10)", borderWidth: 1, borderColor: "rgba(255,80,80,0.22)",
  },
  resultTitle: { color: "#fff", fontWeight: "950", fontSize: 18 },
  resultSub: { color: "rgba(255,255,255,0.55)", marginTop: 3, fontWeight: "750" },
  viewProfile: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  viewText: { color: GOLD, fontWeight: "950", fontSize: 12, letterSpacing: 0.6 },

  sendBtn: {
    marginTop: 16, height: 58, borderRadius: 22, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  sendBtnOn: { backgroundColor: "rgba(244,201,93,0.95)", borderColor: "rgba(244,201,93,0.70)" },
  sendBtnOff: { opacity: 0.78 },
  sendText: { color: "rgba(255,255,255,0.42)", fontWeight: "950", letterSpacing: 1 },
  sendTextOn: { color: "#07101A" },
});
