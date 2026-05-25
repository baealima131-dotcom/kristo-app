import React, { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeChurchId } from "@/src/lib/kristoSession";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { saveChurchDraft } from "@/src/lib/churchStore";
import { publishChurchDirectory } from "@/src/lib/churchDirectoryStore";
import { fetchMyActiveChurchMembership } from "@/src/lib/churchMembersApi";

const GOLD = "rgba(217,179,95,0.96)";
const BG = "#070B14";

const PHONE_CODES: [string, string, string][] = [
  ["🇦🇴", "Angola", "+244"],
  ["🇦🇷", "Argentina", "+54"],
  ["🇦🇺", "Australia", "+61"],
  ["🇧🇪", "Belgium", "+32"],
  ["🇧🇯", "Benin", "+229"],
  ["🇧🇼", "Botswana", "+267"],
  ["🇧🇷", "Brazil", "+55"],
  ["🇧🇮", "Burundi", "+257"],
  ["🇨🇲", "Cameroon", "+237"],
  ["🇨🇦", "Canada", "+1"],
  ["🇨🇫", "Central African Republic", "+236"],
  ["🇹🇩", "Chad", "+235"],
  ["🇨🇱", "Chile", "+56"],
  ["🇨🇳", "China", "+86"],
  ["🇨🇴", "Colombia", "+57"],
  ["🇨🇬", "Congo", "+242"],
  ["🇨🇩", "DR Congo", "+243"],
  ["🇨🇮", "Côte d’Ivoire", "+225"],
  ["🇪🇬", "Egypt", "+20"],
  ["🇬🇶", "Equatorial Guinea", "+240"],
  ["🇪🇹", "Ethiopia", "+251"],
  ["🇫🇷", "France", "+33"],
  ["🇬🇦", "Gabon", "+241"],
  ["🇬🇲", "Gambia", "+220"],
  ["🇩🇪", "Germany", "+49"],
  ["🇬🇭", "Ghana", "+233"],
  ["🇬🇳", "Guinea", "+224"],
  ["🇮🇳", "India", "+91"],
  ["🇮🇩", "Indonesia", "+62"],
  ["🇮🇹", "Italy", "+39"],
  ["🇯🇵", "Japan", "+81"],
  ["🇰🇪", "Kenya", "+254"],
  ["🇱🇸", "Lesotho", "+266"],
  ["🇱🇷", "Liberia", "+231"],
  ["🇲🇬", "Madagascar", "+261"],
  ["🇲🇼", "Malawi", "+265"],
  ["🇲🇾", "Malaysia", "+60"],
  ["🇲🇱", "Mali", "+223"],
  ["🇲🇽", "Mexico", "+52"],
  ["🇲🇦", "Morocco", "+212"],
  ["🇲🇿", "Mozambique", "+258"],
  ["🇳🇦", "Namibia", "+264"],
  ["🇳🇱", "Netherlands", "+31"],
  ["🇳🇿", "New Zealand", "+64"],
  ["🇳🇪", "Niger", "+227"],
  ["🇳🇬", "Nigeria", "+234"],
  ["🇳🇴", "Norway", "+47"],
  ["🇵🇪", "Peru", "+51"],
  ["🇵🇭", "Philippines", "+63"],
  ["🇷🇼", "Rwanda", "+250"],
  ["🇸🇦", "Saudi Arabia", "+966"],
  ["🇸🇳", "Senegal", "+221"],
  ["🇸🇱", "Sierra Leone", "+232"],
  ["🇸🇴", "Somalia", "+252"],
  ["🇿🇦", "South Africa", "+27"],
  ["🇸🇸", "South Sudan", "+211"],
  ["🇪🇸", "Spain", "+34"],
  ["🇸🇩", "Sudan", "+249"],
  ["🇸🇪", "Sweden", "+46"],
  ["🇨🇭", "Switzerland", "+41"],
  ["🇹🇿", "Tanzania", "+255"],
  ["🇹🇬", "Togo", "+228"],
  ["🇹🇷", "Turkey", "+90"],
  ["🇺🇬", "Uganda", "+256"],
  ["🇬🇧", "United Kingdom", "+44"],
  ["🇺🇸", "United States", "+1"],
  ["🇿🇲", "Zambia", "+260"],
  ["🇿🇼", "Zimbabwe", "+263"],
];

const COUNTRIES: [string, string][] = PHONE_CODES.map(([flag, name]) => [flag, name] as [string, string]);

function cleanPhone(s: string) {
  let v = s.replace(/[^\d+]/g, "");
  v = v.replace(/(?!^)\+/g, "");
  return v;
}

function phoneCodeForCountry(name: string) {
  const found = PHONE_CODES.find((x) => String(x[1]) === name);
  return found ? String(found[2]) : "";
}

function phoneCodeFromValue(v: string) {
  const cleaned = cleanPhone(v);
  const found = PHONE_CODES
    .map((x) => String(x[2]))
    .sort((a, b) => b.length - a.length)
    .find((code) => cleaned.startsWith(code));
  return found || "";
}

function phoneLocalValue(v: string) {
  const code = phoneCodeFromValue(v);
  return code ? cleanPhone(v).slice(code.length) : "";
}

function isValidIntlPhone(v: string) {
  const p = cleanPhone(v);
  const digits = p.replace(/\D/g, "");
  return p.startsWith("+") && digits.length >= 9 && digits.length <= 15;
}

export default function CreateChurch() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, setSession } = useKristoSession();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [saving, setSaving] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [draftCountry, setDraftCountry] = useState("");
  const [draftProvince, setDraftProvince] = useState("");
  const [draftCity, setDraftCity] = useState("");
  const [locationStep, setLocationStep] = useState<"country" | "details">("country");

  const canSave = useMemo(
    () =>
      name.trim().length >= 2 &&
      isValidIntlPhone(phone) &&
      Boolean(country.trim()) &&
      Boolean(province.trim()) &&
      Boolean(city.trim()) &&
      !saving,
    [name, phone, country, province, city, saving]
  );

  async function onSave() {
    if (!canSave) {
      Alert.alert("Missing details", "Enter church name, select country/location, and use a valid phone number with country code.");
      return;
    }

    const userId = session?.userId;
    if (!userId) {
      Alert.alert("Session missing", "Please log in again.");
      return;
    }

    setSaving(true);

    try {
      const churchId = makeChurchId();

      const churchProfile = {
        name: name.trim(),
        phone: cleanPhone(phone).trim(),
        country: country.trim(),
        province: province.trim(),
        city: city.trim(),
        createdAt: new Date().toISOString(),
      };

      const pastorName = String(session?.displayName || session?.name || "Pastor").trim();

      const draft = {
        churchId,
        userId,
        createdBy: userId,
        role: "Pastor",
        pastorName,
        churchProfile,
        churchName: churchProfile.name,
        churchPhone: churchProfile.phone,
        churchCountry: churchProfile.country,
        churchProvince: churchProfile.province,
        churchCity: churchProfile.city,
      };

      await saveChurchDraft(draft, userId);

      const published = await publishChurchDirectory(draft as any);
      if (!published.ok) {
        Alert.alert(
          "Server registration failed",
          published.error || "Church was saved locally but could not be registered on the server. Try again."
        );
        return;
      }

      const nextSession = {
        ...session,
        ...draft,
        churchId,
        activeChurchId: churchId,
        role: "Pastor" as const,
        churchRole: "Pastor" as const,
      };

      await setSession(nextSession as any);

      try {
        const mine = await fetchMyActiveChurchMembership();
        const syncedChurchId = String(mine.churchId || churchId);
        await setSession({
          ...nextSession,
          churchId: syncedChurchId,
          activeChurchId: syncedChurchId,
          role: (mine.role || "Pastor") as any,
          churchRole: (mine.role || "Pastor") as any,
        } as any);

        if (__DEV__) {
          console.log("[CreateChurch] session synced", {
            userId,
            churchId: syncedChurchId,
            role: mine.role || "Pastor",
            membership: mine.membership?.id || null,
          });
        }
      } catch (refreshErr) {
        if (__DEV__) {
          console.warn("[CreateChurch] membership refresh failed; using local session", refreshErr);
        }
      }

      router.replace({
        pathname: "/(tabs)/church/overview",
        params: { churchId, refreshAt: String(Date.now()) },
      } as any);
    } catch {
      Alert.alert("Create failed", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.topGlow} />

      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={21} color="white" />
        </Pressable>

        <View style={s.titleWrap}>
          <Text style={s.title}>Create Church</Text>
          <Text style={s.sub}>Create a trusted church profile</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 18, paddingTop: 16, paddingBottom: 72 }}>
        <View style={s.card}>
          <Text style={s.label}>Church Name</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Church name" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />

          <Text style={s.label}>Country</Text>
          <Pressable
            onPress={() => {
              setDraftCountry(country);
              setDraftProvince(province);
              setDraftCity(city);
              setLocationStep("country");
              setCountryOpen(true);
            }}
            style={s.selectInput}
          >
            <Text style={s.selectText}>
              {country ? (COUNTRIES.find((c) => c[1] === country)?.[0] || "🌍") : "🌍"} {country || "Select Country"}
            </Text>
            <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.62)" />
          </Pressable>

          <Text style={s.label}>Phone Number</Text>
          <View style={s.phoneOneRow}>
            <Pressable onPress={() => setPhoneOpen(true)} style={s.phoneCodeBtn}>
              <Text style={s.phoneCodeBtnText}>{phoneCodeFromValue(phone) || "+ Code"}</Text>
              <Ionicons name="chevron-down" size={19} color="rgba(255,255,255,0.62)" />
            </Pressable>

            <TextInput
              value={phoneLocalValue(phone)}
              onFocus={() => {
                if (!phoneCodeFromValue(phone)) setPhoneOpen(true);
              }}
              onChangeText={(v) => {
                const code = phoneCodeFromValue(phone);
                const digits = v.replace(/\D/g, "");
                setPhone(code ? `${code}${digits}` : "");
              }}
              keyboardType="phone-pad"
              placeholder="Phone number"
              placeholderTextColor="rgba(255,255,255,0.38)"
              style={s.phoneNumberInput}
            />
          </View>

          <Text style={s.label}>Location</Text>
          <Pressable
            onPress={() => {
              if (country && province && city) return;
              setDraftCountry(country);
              setDraftProvince(province);
              setDraftCity(city);
              setLocationStep("country");
              setCountryOpen(true);
            }}
            style={[s.locationSummary, country && province && city && s.locationSummaryDone]}
          >
            <Ionicons
              name={country && province && city ? "checkmark-circle" : "location-outline"}
              size={18}
              color={country && province && city ? "#30D158" : GOLD}
            />
            <Text style={[s.locationSummaryText, country && province && city && s.locationSummaryTextDone]} numberOfLines={1}>
              {country && province && city ? `${country}, ${province}, ${city}` : "Add city and province"}
            </Text>
            {country && province && city ? null : (
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.55)" />
            )}
          </Pressable>

          <View style={s.notice}>
            <Ionicons name="sparkles-outline" size={17} color={GOLD} />
            <Text style={s.noticeText}>Your Church ID will be generated after saving.</Text>
          </View>

          <Pressable
            disabled={!canSave}
            onPress={onSave}
            style={({ pressed }) => [s.saveBtn, !canSave && { opacity: 0.45 }, pressed && canSave && { transform: [{ scale: 0.99 }] }]}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#080B12" />
            <Text style={s.saveText}>{saving ? "Creating..." : "Create Church"}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={phoneOpen} transparent animationType="fade" onRequestClose={() => setPhoneOpen(false)}>
        <KeyboardAvoidingView
          style={s.modalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={s.modalBackdrop} onPress={() => setPhoneOpen(false)}>
            <Pressable style={s.countrySheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.sheetTitle}>Phone Country Code</Text>
              <Text style={s.sheetSub}>Choose a country code, then enter the church phone number.</Text>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
                {PHONE_CODES.map(([flag, label, code]) => (
                  <Pressable
                    key={`${label}-${code}`}
                    onPress={() => {
                      setPhone(code);
                      setPhoneOpen(false);
                    }}
                    style={s.countryRowVertical}
                  >
                    <Text style={s.countryFlag}>{flag}</Text>
                    <Text style={s.countryName}>{label}</Text>
                    <Text style={[s.phoneCodeText, { color: "#F4D06F", opacity: 1 }]}>{code}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={countryOpen} transparent animationType="fade" onRequestClose={() => setCountryOpen(false)}>
        <KeyboardAvoidingView
          style={s.modalKeyboard}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={s.modalBackdrop} onPress={() => setCountryOpen(false)}>
            <Pressable style={s.countrySheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>
                  {locationStep === "country" ? "Select Country" : "Location Details"}
                </Text>
                <Text style={s.sheetSub}>
                  {locationStep === "country"
                    ? "Choose the church country first."
                    : `${COUNTRIES.find((c) => c[1] === draftCountry)?.[0] || "🌍"} ${draftCountry}`}
                </Text>
              </View>

              {locationStep === "details" ? (
                <Pressable onPress={() => setLocationStep("country")} style={s.sheetBackMini}>
                  <Ionicons name="chevron-back" size={18} color="white" />
                </Pressable>
              ) : null}
            </View>

            {locationStep === "country" ? (
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 14 }}>
                {COUNTRIES.map(([flag, label]) => {
                  const active = draftCountry === label;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => {
                        setDraftCountry(label);
                        setLocationStep("details");
                      }}
                      style={[s.countryRowVertical, active && s.countryRowVerticalOn]}
                    >
                      <Text style={s.countryFlag}>{flag}</Text>
                      <Text style={s.countryName}>{label}</Text>
                      <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.52)" />
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={s.smartLocationCard}>
                <View style={s.selectedCountryPill}>
                  <Text style={s.countryFlag}>{COUNTRIES.find((c) => c[1] === draftCountry)?.[0] || "🌍"}</Text>
                  <Text style={s.selectedCountryText}>{draftCountry}</Text>
                </View>

                <Text style={s.label}>Province / State</Text>
                <TextInput
                  value={draftProvince}
                  onChangeText={(v) => setDraftProvince(v.slice(0, 15))}
                  placeholder="Province / State"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.input}
                />

                <Text style={s.label}>City</Text>
                <TextInput
                  value={draftCity}
                  onChangeText={(v) => setDraftCity(v.slice(0, 15))}
                  placeholder="City"
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.input}
                />

                <Pressable
                  disabled={!draftProvince.trim() || !draftCity.trim()}
                  onPress={() => {
                    if (!draftProvince.trim() || !draftCity.trim()) return;
                    setCountry(draftCountry);
                    setProvince(draftProvince.trim());
                    setCity(draftCity.trim());
                    setCountryOpen(false);
                  }}
                  style={[
                    s.sheetSaveBtn,
                    (!draftProvince.trim() || !draftCity.trim()) && { opacity: 0.42 },
                  ]}
                >
                  <Ionicons name="checkmark-circle-outline" size={20} color="#080B12" />
                  <Text numberOfLines={1} ellipsizeMode="tail" style={s.sheetSaveText}>
                    {draftCity.trim() && draftProvince.trim() ? `${draftCity.trim().slice(0, 12)}, ${draftProvince.trim().slice(0, 12)}` : "Complete Location"}
                  </Text>
                </Pressable>
              </View>
            )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create<any>({
  screen: { flex: 1, backgroundColor: BG },
  topGlow: {
    position: "absolute",
    top: -150,
    alignSelf: "center",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(217,179,95,0.035)",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginRight: 12,
  },
  titleWrap: { flex: 1 },
  title: { color: "white", fontWeight: "900", fontSize: 26 },
  sub: { color: "rgba(255,255,255,0.58)", fontWeight: "700", marginTop: 2 },
  hero: {
    borderRadius: 32,
    padding: 18,
    alignItems: "center",
    backgroundColor: "rgba(217,179,95,0.055)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    marginBottom: 10,
  },
  heroIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    marginBottom: 10,
  },
  heroTitle: { color: "white", fontWeight: "900", fontSize: 18 },
  heroSub: { color: "rgba(255,255,255,0.62)", fontWeight: "700", textAlign: "center", marginTop: 6, lineHeight: 19 },
  card: {
    borderRadius: 32,
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  label: { color: "rgba(255,255,255,0.76)", fontWeight: "900", marginTop: 8, marginBottom: 5, fontSize: 14 },
  selectInput: {
    minHeight: 52,
    borderRadius: 20,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  selectText: { color: "white", fontWeight: "800", fontSize: 15 },
  phoneOneRow: {
    marginTop: 8,
    height: 58,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  phoneCodeBtn: {
    width: 112,
    height: 58,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.08)",
  },
  phoneCodeBtnText: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
  },
  phoneNumberInput: {
    flex: 1,
    height: 58,
    paddingHorizontal: 14,
    color: "white",
    fontWeight: "900",
    fontSize: 16,
  },

  locationSummary: {
    minHeight: 52,
    borderRadius: 20,
    paddingHorizontal: 14,
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(217,179,95,0.09)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
  },
  locationSummaryDone: {
    backgroundColor: "rgba(48,209,88,0.16)",
    borderColor: "rgba(48,209,88,0.85)",
    shadowColor: "#30D158",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  locationSummaryTextDone: {
    color: "#D8FFE3",
  },
  locationSummaryText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontWeight: "800",
  },
  input: {
    minHeight: 52,
    borderRadius: 20,
    paddingHorizontal: 14,
    color: "white",
    fontWeight: "800",
    backgroundColor: "rgba(0,0,0,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  inputAddress: {
    minHeight: 70,
    paddingTop: 14,
    paddingBottom: 14,
  },
  notice: {
    marginTop: 10,
    borderRadius: 20,
    padding: 12,
    flexDirection: "row",
    gap: 9,
    backgroundColor: "rgba(217,179,95,0.08)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
  },
  noticeText: { flex: 1, color: "rgba(255,255,255,0.72)", fontWeight: "700", lineHeight: 18 },
  saveBtn: {
    marginTop: 10,
    minHeight: 52,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: GOLD,
  },
  saveText: { color: "#080B12", fontWeight: "900", fontSize: 16 },
  modalKeyboard: {
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 22,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  countrySheet: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "82%",
    borderRadius: 28,
    padding: 16,
    backgroundColor: "rgba(8,11,18,0.96)",
    borderWidth: 1.2,
    borderColor: "rgba(217,179,95,0.35)",
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  sheetBackMini: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  countryRowVertical: {
    minHeight: 58,
    borderRadius: 20,
    paddingHorizontal: 14,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  countryRowVerticalOn: {
    backgroundColor: "rgba(217,179,95,0.13)",
    borderColor: "rgba(217,179,95,0.30)",
  },
  selectedCountryPill: {
    minHeight: 50,
    borderRadius: 18,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(217,179,95,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.26)",
    marginBottom: 10,
  },
  selectedCountryText: {
    color: "white",
    fontWeight: "900",
    fontSize: 15,
  },

  sheetTitle: { color: "white", fontWeight: "900", fontSize: 24, marginBottom: 4 },
  sheetSub: {
    color: "rgba(255,255,255,0.58)",
    fontWeight: "700",
    marginBottom: 18,
    lineHeight: 19,
  },
  countryChips: { gap: 10, paddingBottom: 14 },
  countryChip: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  countryChipOn: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderColor: "rgba(217,179,95,0.42)",
  },
  countryChipText: { color: "rgba(255,255,255,0.78)", fontWeight: "800" },
  countryChipTextOn: { color: "white" },
  smartLocationCard: {
  borderRadius: 26,
  padding: 16,
  backgroundColor: "rgba(10,14,22,0.95)",
  borderWidth: 1,
  borderColor: "rgba(217,179,95,0.28)",

  shadowColor: "#F4C95D",
  shadowOpacity: 0.45,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 0 },

  elevation: 18,
},
  sheetSaveBtn: {
    marginTop: 14,
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: GOLD,
  },
  sheetSaveText: { color: "#080B12", fontWeight: "900", fontSize: 15 },
  countryRow: {
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  countryFlag: { fontSize: 24 },
  countryName: { flex: 1, color: "rgba(255,255,255,0.9)", fontWeight: "800" },
});
