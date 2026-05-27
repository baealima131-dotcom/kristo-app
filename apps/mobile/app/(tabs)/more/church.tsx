import React, { useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Alert, ImageBackground, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeChurchId } from "@/src/lib/kristoSession";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { clearChurchDraft, saveChurchDraft } from "@/src/lib/churchStore";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

const VIP_BG = "#0B0F17";
const GOLD = "rgba(217,179,95,0.95)";
const PAD = 16;

const COUNTRIES = [
  "United States",
  "Canada",
  "Tanzania",
  "Kenya",
  "Uganda",
  "Rwanda",
  "Burundi",
  "DR Congo",
  "South Africa",
  "Nigeria",
  "Ghana",
  "Other",
];

function cleanPhone(s: string) {
  return s.replace(/[^\d+]/g, "");
}

function tapFeel() {
  try {
    const Haptics = require("expo-haptics");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  } catch {}
}

export default function MoreChurch() {
  const router = useRouter();
  const params = useLocalSearchParams() as any;
  const insets = useSafeAreaInsets();
  const { session, setSession, logout } = useKristoSession();

  // CREATE
  const [createName, setCreateName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<string>("DR Congo");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);

  // JOIN
  const [joinId, setJoinId] = useState("");
  const [requestSent, setRequestSent] = useState(false);

  React.useEffect(() => {
    const jid = params?.joinId;
    if (typeof jid === "string" && jid.trim()) setJoinId(jid.trim());
  }, [params?.joinId]);

  // UI
  const [err, setErr] = useState<string | null>(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = useMemo(() => {
    const cid = session?.churchId || "";
    const role = session?.role || "Member";
    return { cid, role };
  }, [session]);

  const showVovotoLanding = !current.cid && String(current.role || "Member").toLowerCase() !== "pastor";

  const canCreate = useMemo(() => {
    const n = createName.trim();
    const p = cleanPhone(phone).trim();
    return !current.cid && n.length >= 2 && p.length >= 7 && !saving;
  }, [createName, phone, saving, current.cid]);

  async function onPickLocation() {
    setLocErr(null);
    try {
      // Optional dependency: expo-location
      const Location = require("expo-location");
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocErr("Location permission denied.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    } catch (e: any) {
      setLocErr("Location not available (expo-location not installed).");
    }
  }

  async function onCreate() {
    if (current.cid) {
      setErr("You already have a church. One pastor account can create only one church in V1.");
      return;
    }

    if (!canCreate) {
      setErr("Tafadhali jaza Church name na Phone number (sahihi).");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      const cid = makeChurchId();

      const churchProfile = {
        name: createName.trim(),
        phone: cleanPhone(phone).trim(),
        country: country.trim(),
        province: province.trim() || undefined,
        city: city.trim() || undefined,
        location: loc || undefined,
        createdAt: new Date().toISOString(),
      };

      const churchDraft = {
        churchId: cid,
        role: "Pastor",
        churchProfile,
        churchName: churchProfile.name,
        churchPhone: churchProfile.phone,
        churchCountry: churchProfile.country,
        churchCity: churchProfile.city || "",
      };

      await saveChurchDraft(churchDraft, session?.userId);

      await setSession({
        ...(session as any),
        userId: String(session?.userId || ""),
        ...churchDraft,
      } as any);

      router.replace("/(tabs)/church/overview" as any);
    } finally {
      setSaving(false);
    }
  }

  async function onJoin() {
    setErr(null);
    setRequestSent(false);

    const cid = joinId.trim();
    if (!cid) {
      setErr("Enter Church ID to send request.");
      return;
    }

    // V1: do not join automatically.
    // User sends request; pastor/admin will approve later.
    setRequestSent(true);
    setErr("Request sent. Wait for pastor approval.");
  }

  async function onCopyChurchId() {
    const cid = String(current.cid || "").trim();
    if (!cid) {
      Alert.alert("No Church ID", "Church ID is not available yet.");
      return;
    }

    tapFeel();

    try {
      const Clipboard = require("expo-clipboard");
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(cid);
        Alert.alert("Copied", `${cid} copied.`);
        return;
      }
    } catch {}

    await Share.share({ message: cid });
  }

  async function leaveChurchBackend() {
    const base = String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/+$/, "");
    const churchId = String(session?.churchId || "").trim();
    const role = String(session?.role || "Member");
    const url = `${base}/api/church/membership/leave`;
    const method = "POST";

    if (!base || !session?.userId) {
      console.log("[church-delete] skip leave — missing api base or userId", {
        url,
        method,
        churchId,
        role,
        hasBase: Boolean(base),
        userId: String(session?.userId || ""),
      });
      return;
    }

    try {
      const res = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...getKristoHeaders({ userId: session.userId, role: role as any, churchId }),
        },
      });
      const rawText = await res.text();
      let body: any = null;
      try {
        body = rawText ? JSON.parse(rawText) : null;
      } catch {
        body = rawText;
      }
      console.log("[church-delete] leave response", {
        url,
        method,
        churchId,
        role,
        status: res.status,
        ok: res.ok,
        body,
      });
    } catch (error: any) {
      console.log("[church-delete] leave request failed", {
        url,
        method,
        churchId,
        role,
        error: String(error?.message || error || "unknown"),
      });
    }
  }

  async function clearChurchLocal() {
    await leaveChurchBackend();
    await clearChurchDraft(session?.userId);
    await setSession({
      ...(session as any),
      role: "Member",
      churchRole: "Member",
      churchId: "",
      activeChurchId: "",
      churchProfile: undefined,
      churchName: "",
      churchPhone: "",
      churchCountry: "",
      churchCity: "",
    } as any);

    tapFeel();
    router.replace("/more/church" as any);
  }

  function onQuitChurch() {
    Alert.alert(
      "Quit church",
      "You will leave this church and return to church setup.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Quit", style: "destructive", onPress: clearChurchLocal },
      ]
    );
  }

  function onDeleteChurch() {
    Alert.alert(
      "Delete your church",
      "This will remove this church from your local V1 account.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: clearChurchLocal },
      ]
    );
  }

  return (
    <View style={[s.screen, { paddingTop: showVovotoLanding ? 0 : insets.top }]}>
      {!showVovotoLanding && (<View style={s.nav}>
        <View style={s.iconPill}>
          <MaterialCommunityIcons name="church" size={18} color={GOLD} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.navTitle}>Church</Text>
          <Text style={s.navSub}>
  {current.cid
    ? "Manage your church account."
    : "Find church, enter Church ID, or create church mpya."}
</Text>
        </View>
      </View>)}

      {!!err && !showVovotoLanding && (
        <View style={s.errCard}>
          <Ionicons name="alert-circle-outline" size={16} color="rgba(255,255,255,0.85)" />
          <Text style={s.errText}>{err}</Text>
        </View>
      )}

      {showVovotoLanding ? (
        <View style={s.vovotoStatic}>
        {!current.cid ? (
          showVovotoLanding ? (
            <View style={s.vovotoWrap}>
              <ImageBackground
                source={require("@/assets/images/vovoto.png")}
                resizeMode="contain"
                style={s.vovotoImage}
              >
                <Pressable
                  onPress={() => {
                    router.push("/more/church/create" as any);
                  }}
                  onPressIn={tapFeel}
                  style={({ pressed }) => [s.hotspot, s.hotCreate, pressed && s.hotspotPressed]}
                />
                <Pressable
                  onPress={() => {
                    router.push("/more/church/find" as any);
                  }}
                  onPressIn={tapFeel}
                  style={({ pressed }) => [s.hotspot, s.hotFind, pressed && s.hotspotPressed]}
                />
                <Pressable
                  onPress={() => {
                    router.push("/more/church/add-id" as any);
                  }}
                  onPressIn={tapFeel}
                  style={({ pressed }) => [s.hotspot, s.hotId, pressed && s.hotspotPressed]}
                />
                <Pressable
                  onPress={() => {
                    Alert.alert("QR Code", "QR scan will open here in V2.");
                  }}
                  onPressIn={tapFeel}
                  style={({ pressed }) => [s.hotspot, s.hotQr, pressed && s.hotspotPressed]}
                />
              </ImageBackground>
            </View>
          ) : (
            <View style={s.grid2}>
              <Pressable onPress={onCreate} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                <View style={s.tileIcon}>
                  <MaterialCommunityIcons name="church" size={24} color={GOLD} />
                </View>
                <Text style={s.tileTitle}>Create Church</Text>
                <Text style={s.tileSub}>For pastors. Create new church ID.</Text>
              </Pressable>

              <Pressable onPress={() => router.push("/more/church/find" as any)} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                <View style={s.tileIcon}>
                  <Ionicons name="search-outline" size={24} color={GOLD} />
                </View>
                <Text style={s.tileTitle}>Find a Church</Text>
                <Text style={s.tileSub}>See nearby churches and request.</Text>
              </Pressable>

              <Pressable onPress={onJoin} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                <View style={s.tileIcon}>
                  <Ionicons name="keypad-outline" size={24} color={GOLD} />
                </View>
                <Text style={s.tileTitle}>Add Church ID</Text>
                <Text style={s.tileSub}>Enter ID, view profile, request.</Text>
              </Pressable>

              <Pressable onPress={() => Alert.alert("QR Code", "QR scan will open here in V2.")} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                <View style={s.tileIcon}>
                  <Ionicons name="qr-code-outline" size={24} color={GOLD} />
                </View>
                <Text style={s.tileTitle}>Scan QR Code</Text>
                <Text style={s.tileSub}>Scan church QR to request fast.</Text>
              </Pressable>
            </View>
          )
        ) : (
          <View style={s.statusCard}>
            <Text style={s.statusTitle}>{current.role === "Pastor" ? "Pastor Church Control" : "Church Membership"}</Text>
            <View style={s.statusChurchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.statusRow}>Church ID</Text>
                <Text style={s.statusStrong}>{current.cid}</Text>
              </View>
              <Pressable onPress={async () => {
                Alert.alert("Church ID", current.cid);
                Alert.alert("Copied", current.cid);
              }} style={s.copyChurchBtn}>
                <Ionicons name="copy-outline" size={15} color="#0B0F17" />
                <Text style={s.copyChurchText}>Copy</Text>
              </Pressable>
            </View>

            <Pressable onPress={current.role === "Pastor" ? onDeleteChurch : onQuitChurch} style={s.dangerBtn}>
              <Ionicons name={current.role === "Pastor" ? "trash-outline" : "exit-outline"} size={18} color="#FFD6D6" />
              <Text style={s.dangerText}>{current.role === "Pastor" ? "Delete your church" : "Quit Church"}</Text>
            </Pressable>
          </View>
        )}
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 34 }}>
          {!current.cid ? (
            showVovotoLanding ? null : (
              <View style={s.grid2}>
                <Pressable onPress={onCreate} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                  <View style={s.tileIcon}>
                    <MaterialCommunityIcons name="church" size={24} color={GOLD} />
                  </View>
                  <Text style={s.tileTitle}>Create Church</Text>
                  <Text style={s.tileSub}>For pastors. Create new church ID.</Text>
                </Pressable>

                <Pressable onPress={() => router.push("/more/church/find" as any)} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                  <View style={s.tileIcon}>
                    <Ionicons name="search-outline" size={24} color={GOLD} />
                  </View>
                  <Text style={s.tileTitle}>Find a Church</Text>
                  <Text style={s.tileSub}>See nearby churches and request.</Text>
                </Pressable>

                <Pressable onPress={onJoin} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                  <View style={s.tileIcon}>
                    <Ionicons name="keypad-outline" size={24} color={GOLD} />
                  </View>
                  <Text style={s.tileTitle}>Add Church ID</Text>
                  <Text style={s.tileSub}>Enter ID, view profile, request.</Text>
                </Pressable>

                <Pressable onPress={() => Alert.alert("QR Code", "QR scan will open here in V2.")} style={({ pressed }) => [s.vipTile, pressed && { opacity: 0.9 }]}>
                  <View style={s.tileIcon}>
                    <Ionicons name="qr-code-outline" size={24} color={GOLD} />
                  </View>
                  <Text style={s.tileTitle}>Scan QR Code</Text>
                  <Text style={s.tileSub}>Scan church QR to request fast.</Text>
                </Pressable>
              </View>
            )
          ) : (
            <View style={s.statusCard}>
              <Text style={s.statusTitle}>{current.role === "Pastor" ? "Pastor Church Control" : "Church Membership"}</Text>
              <View style={s.statusChurchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.statusRow}>Church ID</Text>
                  <Text style={s.statusStrong}>{current.cid}</Text>
                </View>
                <Pressable onPress={async () => {
                  Alert.alert("Church ID", current.cid);
                  Alert.alert("Copied", current.cid);
                }} style={s.copyChurchBtn}>
                  <Ionicons name="copy-outline" size={15} color="#0B0F17" />
                  <Text style={s.copyChurchText}>Copy</Text>
                </Pressable>
              </View>

              <Pressable onPress={current.role === "Pastor" ? onDeleteChurch : onQuitChurch} style={s.dangerBtn}>
                <Ionicons name={current.role === "Pastor" ? "trash-outline" : "exit-outline"} size={18} color="#FFD6D6" />
                <Text style={s.dangerText}>{current.role === "Pastor" ? "Delete your church" : "Quit Church"}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}

      {/* Country modal */}
      <Modal visible={countryOpen} animationType="fade" transparent onRequestClose={() => setCountryOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setCountryOpen(false)}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Select Country</Text>
            {COUNTRIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  setCountry(c);
                  setCountryOpen(false);
                }}
                style={({ pressed }) => [s.modalRow, pressed && { opacity: 0.85 }]}
              >
                <Text style={s.modalText}>{c}</Text>
                {c === country ? <Ionicons name="checkmark" size={18} color={GOLD} /> : <View style={{ width: 18 }} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create<any>({
  joinSub: { color: "rgba(255,255,255,0.62)", marginTop: 2, lineHeight: 18 },
  joinTitle: { color: "rgba(255,255,255,0.96)", fontWeight: "950", fontSize: 20, letterSpacing: 0.2 },
  cardDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 12 },
  badgeText: { color: "rgba(255,255,255,0.78)", fontWeight: "950", fontSize: 11, letterSpacing: 0.6 },
  badgePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  cardHeadIcon: { width: 36, height: 36, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.12)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  cardHeadLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  halfBtn: { flex: 1 },
  screen: { flex: 1, backgroundColor: VIP_BG, paddingBottom: 22 },
  nav: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAD, paddingBottom: 12, paddingTop: 6 },
  iconPill: { width: 34, height: 34, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.12)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  navTitle: { color: "white", fontWeight: "950", fontSize: 18 },
  navSub: { marginTop: 2, color: "rgba(255,255,255,0.65)", fontWeight: "700" },

  errCard: { marginHorizontal: PAD, marginTop: 6, borderRadius: 16, padding: 12, flexDirection: "row", gap: 10, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.04)" },
  errText: { color: "rgba(255,255,255,0.85)", fontWeight: "800" },
  requestOk: { marginTop: 12, borderRadius: 14, padding: 11, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(80,220,140,0.08)", borderWidth: 1, borderColor: "rgba(80,220,140,0.22)" },
  requestOkText: { color: "rgba(210,255,225,0.92)", fontWeight: "850" },

  statusCard: { margin: PAD, marginTop: 12, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)" },
  statusTitle: { color: "white", fontWeight: "950", fontSize: 14, opacity: 0.95 },
  statusRow: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "800" },
  statusStrong: { color: "rgba(255,255,255,0.92)", fontWeight: "950" },
  statusChurchRow: { marginTop: 8, borderRadius: 16, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(217,179,95,0.07)", borderWidth: 1, borderColor: "rgba(217,179,95,0.18)" },
  copyChurchBtn: { borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: GOLD },
  copyChurchText: { color: "#0B0F17", fontWeight: "950", fontSize: 12 },

  ghostBtn: { marginTop: 12, borderRadius: 16, paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "rgba(255,255,255,0.03)" },
  ghostBtnText: { color: "rgba(255,255,255,0.85)", fontWeight: "950" },

  card: { marginHorizontal: PAD, marginTop: 12, borderRadius: 24, padding: 16, borderWidth: 1, borderColor: "rgba(217,179,95,0.18)", backgroundColor: "rgba(255,255,255,0.03)", overflow: "hidden" },
  cardEdge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 2, backgroundColor: "rgba(217,179,95,0.45)" },
  cardGlow: { position: "absolute", right: -40, top: -40, width: 120, height: 120, borderRadius: 60, backgroundColor: "rgba(217,179,95,0.10)" },
  cardTitle: { color: "white", fontWeight: "950", fontSize: 16 },
  cardSub: { marginTop: 6, color: "rgba(255,255,255,0.65)", fontWeight: "750" },

  input: { marginTop: 12, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(0,0,0,0.20)", color: "white", fontWeight: "800" },

  select: { marginTop: 12, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(0,0,0,0.20)" },
  selectLabel: { color: "rgba(255,255,255,0.55)", fontWeight: "800", fontSize: 12 },
  selectValue: { color: "rgba(255,255,255,0.92)", fontWeight: "950" },

  primaryBtn: { marginTop: 12, borderRadius: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: GOLD },
  primaryText: { color: "#0B0F17", fontWeight: "950" },

  secondaryBtn: { marginTop: 12, borderRadius: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "rgba(217,179,95,0.14)", borderWidth: 1, borderColor: "rgba(217,179,95,0.40)" },
  secondaryText: { color: GOLD, fontWeight: "950" },

  actionRow: { flexDirection: "row", gap: 12, marginTop: 12, alignItems: "stretch" },
  actionBtn: { flex: 1, height: 52, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  actionPrimary: { backgroundColor: GOLD, borderWidth: 1, borderColor: "transparent" },
  actionPrimaryText: { color: VIP_BG, fontWeight: "950" },
  actionGhost: { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  actionGhostText: { color: "rgba(255,255,255,0.92)", fontWeight: "950" },

  smallErr: { marginTop: 8, color: "rgba(255,255,255,0.70)", fontWeight: "750" },
  smallMuted: { marginTop: 6, color: "rgba(255,255,255,0.55)", fontWeight: "750" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", padding: PAD, justifyContent: "center" },
  modalCard: { borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "#0A0E16", padding: 14 },
  modalTitle: { color: "white", fontWeight: "950", fontSize: 16, marginBottom: 10 },
  modalRow: { paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)", marginBottom: 8 },
  modalText: { color: "rgba(255,255,255,0.90)", fontWeight: "850" },
  joinActions: { flexDirection: "row", gap: 12, marginTop: 12, alignItems: "stretch" },
  joinBtn: { flex: 1, height: 52, borderRadius: 18, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  joinBtnPrimary: { backgroundColor: GOLD, borderWidth: 1, borderColor: "transparent" },
  joinPrimaryText: { color: "#0B0F17", fontWeight: "950" },
  joinBtnGhost: { backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  joinGhostText: { color: "rgba(255,255,255,0.92)", fontWeight: "950" },
  vovotoStatic: { flex: 1 },
  vovotoWrap: {
    flex: 1,
    paddingBottom: 18,
  },
  vovotoImage: {
    width: "100%",
    height: "100%",
  },
  hotspot: {
    position: "absolute",
    borderRadius: 28,
    zIndex: 50,
    elevation: 50,
  },
  hotspotPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.992 }],
  },
  hotCreate: { left: "5.8%", top: "28.0%", width: "43.7%", height: "28.2%" },
  hotFind: { right: "5.8%", top: "28.0%", width: "43.7%", height: "28.2%" },
  hotId: { left: "5.8%", top: "58.5%", width: "43.7%", height: "28.2%" },
  hotQr: { right: "5.8%", top: "58.5%", width: "43.7%", height: "28.2%" },
  grid2: { marginHorizontal: PAD, marginTop: 16, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  vipTile: { width: "48%", minHeight: 156, borderRadius: 24, padding: 14, borderWidth: 1, borderColor: "rgba(217,179,95,0.20)", backgroundColor: "rgba(255,255,255,0.035)", overflow: "hidden" },
  tileIcon: { width: 50, height: 50, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.12)", borderWidth: 1, borderColor: "rgba(217,179,95,0.26)", marginBottom: 14 },
  tileTitle: { color: "white", fontWeight: "950", fontSize: 17 },
  tileSub: { marginTop: 7, color: "rgba(255,255,255,0.62)", fontWeight: "750", lineHeight: 18 },
  cleanOption: { flexDirection: "row", alignItems: "center", gap: 14 },
  optionIcon: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(217,179,95,0.12)", borderWidth: 1, borderColor: "rgba(217,179,95,0.25)" },
  optionTitle: { color: "white", fontWeight: "950", fontSize: 18 },
  optionSub: { marginTop: 4, color: "rgba(255,255,255,0.62)", fontWeight: "750", lineHeight: 19 },
  dangerBtn: { marginTop: 14, borderRadius: 18, paddingVertical: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "rgba(255,80,80,0.10)", borderWidth: 1, borderColor: "rgba(255,120,120,0.24)" },
  dangerText: { color: "#FFD6D6", fontWeight: "950" },
});
