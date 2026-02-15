import React, { useMemo, useState } from "react";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeChurchId } from "@/src/lib/kristoSession";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";

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

  const canCreate = useMemo(() => {
    const n = createName.trim();
    const p = cleanPhone(phone).trim();
    return n.length >= 2 && p.length >= 7 && !saving;
  }, [createName, phone, saving]);

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

      await setSession({
        userId: session?.userId || "u-demo-1",
        role: "Pastor",
        churchId: cid,
        churchProfile,
      } as any);
    } finally {
      setSaving(false);
    }
  }

  async function onJoin() {
    setErr(null);
    const cid = joinId.trim();
    if (!cid) {
      setErr("Ingiza churchId ili u-join.");
      return;
    }
    await setSession({
      userId: session?.userId || "u-demo-1",
      role: "Member",
      churchId: cid,
    } as any);
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.nav}>
        <View style={s.iconPill}>
          <MaterialCommunityIcons name="church" size={18} color={GOLD} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.navTitle}>Church</Text>
          <Text style={s.navSub}>Join kwanza, au create church mpya.</Text>
        </View>
      </View>

      {!!err && (
        <View style={s.errCard}>
          <Ionicons name="alert-circle-outline" size={16} color="rgba(255,255,255,0.85)" />
          <Text style={s.errText}>{err}</Text>
        </View>
      )}

      {/* ✅ TOP: JOIN */}
      <View style={s.card}>
        <View style={s.cardEdge} />
        <View style={s.cardGlow} />
        <View style={s.cardHead}>
          <View style={s.cardHeadLeft}>
            <View style={s.cardHeadIcon}>
              <Ionicons name="log-in-outline" size={18} color={GOLD} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.joinTitle}>Join Church</Text>
              <Text style={s.joinSub}>Ingiza churchId, utaingia kama Member.</Text>
            </View>
          </View>
          <View style={s.badgePill}>
            <Text style={s.badgeText}>CHURCH ID</Text>
          </View>
        <View style={s.cardDivider} />
        </View>

        <TextInput
          value={joinId}
          onChangeText={setJoinId}
          autoCapitalize="none"
          placeholder="c-demo-1"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <View style={s.joinActions}>
          <Pressable onPress={onJoin} style={({ pressed }) => [s.halfBtn, s.joinBtn, s.joinBtnPrimary, pressed && { opacity: 0.92 }]}>
            <Ionicons name="log-in-outline" size={18} color={GOLD} />
            <Text style={s.joinPrimaryText}>Join</Text>
          </Pressable>

          <Pressable onPress={() => router.push("/more/church/find" as any)} style={({ pressed }) => [s.halfBtn, s.joinBtn, s.joinBtnGhost, pressed && { opacity: 0.92 }]}>
            <Ionicons name="search-outline" size={18} color="rgba(255,255,255,0.85)" />
            <Text style={s.joinGhostText}>Find a church</Text>
          </Pressable>
        </View>
      </View>

      {/* ✅ MIDDLE: CREATE */}
      <View style={s.card}>
        <View style={s.cardEdge} />
        <View style={s.cardGlow} />
        <Text style={s.cardTitle}>Create Church</Text>
        <Text style={s.cardSub}>Kristo App itatengeneza Church ID automatically.</Text>

        <TextInput
          value={createName}
          onChangeText={setCreateName}
          placeholder="Church name"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        <TextInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="Phone number"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={s.input}
        />

        {/* Country select */}
        <Pressable onPress={() => setCountryOpen(true)} style={({ pressed }) => [s.select, pressed && { opacity: 0.92 }]}>
          <Text style={s.selectLabel}>Country</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={s.selectValue}>{country}</Text>
            <Ionicons name="chevron-down" size={18} color="rgba(255,255,255,0.80)" />
          </View>
        </Pressable>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <TextInput
            value={province}
            onChangeText={setProvince}
            placeholder="Province / State (optional)"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[s.input, { flex: 1 }]}
          />
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="City (optional)"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[s.input, { flex: 1 }]}
          />
        </View>

        {/* Location */}
        <Pressable onPress={onPickLocation} style={({ pressed }) => [s.secondaryBtn, pressed && { opacity: 0.92 }]}>
          <Ionicons name="location-outline" size={18} color={GOLD} />
          <Text style={s.secondaryText}>{loc ? "Location saved ✓" : "Share location (optional)"}</Text>
        </Pressable>
        {!!locErr && <Text style={s.smallErr}>{locErr}</Text>}
        {!!loc && (
          <Text style={s.smallMuted}>
            Lat: {loc.lat.toFixed(5)}  •  Lng: {loc.lng.toFixed(5)}
          </Text>
        )}

        <Pressable
          onPress={onCreate}
          disabled={!canCreate}
          style={({ pressed }) => [s.primaryBtn, (!canCreate || saving) && { opacity: 0.5 }, pressed && { opacity: 0.92 }]}
        >
          <Ionicons name="add" size={18} color="#0B0F17" />
          <Text style={s.primaryText}>{saving ? "Creating…" : "Create"}</Text>
        </Pressable>
      </View>

      {/* ✅ BOTTOM: CURRENT + LOGOUT */}
      <View style={s.statusCard}>
        <Text style={s.statusTitle}>Current</Text>
        <Text style={s.statusRow}>
          Role: <Text style={s.statusStrong}>{current.role}</Text>
        </Text>
        <Text style={s.statusRow}>
          ChurchId: <Text style={s.statusStrong}>{current.cid || "— (not joined)"}</Text>
        </Text>

        <Pressable onPress={() => logout()} style={({ pressed }) => [s.ghostBtn, pressed && { opacity: 0.9 }]}>
          <Ionicons name="log-out-outline" size={16} color="rgba(255,255,255,0.75)" />
          <Text style={s.ghostBtnText}>Clear / Logout</Text>
        </Pressable>
      </View>

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

  statusCard: { margin: PAD, marginTop: 12, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "rgba(255,255,255,0.04)" },
  statusTitle: { color: "white", fontWeight: "950", fontSize: 14, opacity: 0.95 },
  statusRow: { marginTop: 6, color: "rgba(255,255,255,0.70)", fontWeight: "800" },
  statusStrong: { color: "rgba(255,255,255,0.92)", fontWeight: "950" },

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
});
