import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";

const CONTINENTS = [
  { id: "africa", title: "Africa", meta: "54 countries • 1,240 churches" },
  { id: "europe", title: "Europe", meta: "44 countries • 320 churches" },
  { id: "asia", title: "Asia", meta: "48 countries • 410 churches" },
  { id: "north-america", title: "North America", meta: "23 countries • 210 churches" },
  { id: "south-america", title: "South America", meta: "12 countries • 150 churches" },
  { id: "oceania", title: "Oceania", meta: "14 countries • 60 churches" },
] as const;

const COUNTRIES: Record<string, { id: string; title: string; churches: number }[]> = {
  africa: [
    { id: "tanzania", title: "Tanzania", churches: 140 },
    { id: "kenya", title: "Kenya", churches: 120 },
    { id: "uganda", title: "Uganda", churches: 96 },
    { id: "burundi", title: "Burundi", churches: 58 },
    { id: "drc", title: "DR Congo", churches: 188 },
  ],
  europe: [
    { id: "uk", title: "United Kingdom", churches: 42 },
    { id: "germany", title: "Germany", churches: 36 },
    { id: "france", title: "France", churches: 28 },
  ],
  asia: [
    { id: "india", title: "India", churches: 84 },
    { id: "philippines", title: "Philippines", churches: 56 },
    { id: "south-korea", title: "South Korea", churches: 32 },
  ],
  "north-america": [
    { id: "usa", title: "USA", churches: 104 },
    { id: "canada", title: "Canada", churches: 39 },
    { id: "mexico", title: "Mexico", churches: 27 },
  ],
  "south-america": [
    { id: "brazil", title: "Brazil", churches: 62 },
    { id: "argentina", title: "Argentina", churches: 21 },
    { id: "colombia", title: "Colombia", churches: 25 },
  ],
  oceania: [
    { id: "australia", title: "Australia", churches: 24 },
    { id: "new-zealand", title: "New Zealand", churches: 12 },
  ],
};

const CHURCHES_BY_COUNTRY: Record<string, { id: string; title: string; meta: string }[]> = {
  tanzania: [
    { id: "tlmc-dar", title: "TLMC Dar", meta: "Church target" },
    { id: "tlmc-mwanza", title: "TLMC Mwanza", meta: "Church target" },
    { id: "demo-tz", title: "Demo Church TZ", meta: "Church target" },
  ],
  kenya: [
    { id: "tlmc-nairobi", title: "TLMC Nairobi", meta: "Church target" },
    { id: "demo-ke", title: "Demo Church Kenya", meta: "Church target" },
  ],
  uganda: [
    { id: "tlmc-kampala", title: "TLMC Kampala", meta: "Church target" },
    { id: "demo-ug", title: "Demo Church Uganda", meta: "Church target" },
  ],
  burundi: [
    { id: "tlmc-bujumbura", title: "TLMC Bujumbura", meta: "Church target" },
    { id: "demo-bi", title: "Demo Church Burundi", meta: "Church target" },
  ],
  drc: [
    { id: "tlmc-goma", title: "TLMC Goma", meta: "Church target" },
    { id: "tlmc-bukavu", title: "TLMC Bukavu", meta: "Church target" },
  ],
  usa: [
    { id: "tlmc-dallas", title: "TLMC Dallas", meta: "Church target" },
    { id: "tlmc-fort-worth", title: "TLMC Fort Worth", meta: "Church target" },
    { id: "demo-us", title: "Demo Church", meta: "Church target" },
  ],
};

const MINISTRIES = [
  { id: "maombi", title: "Maombi", meta: "Ministry target" },
  { id: "youth", title: "Youth", meta: "Ministry target" },
  { id: "worship", title: "Worship", meta: "Ministry target" },
  { id: "evangelism", title: "Evangelism", meta: "Ministry target" },
] as const;

const TARGETS = [
  { id: "members", title: "Members", meta: "People target" },
  { id: "pastors", title: "Pastors", meta: "People target" },
  { id: "leaders", title: "Leaders", meta: "People target" },
  { id: "ministry-leaders", title: "Ministry Leaders", meta: "People target" },
] as const;

const STREAM_GROUPS = {
  Agenda: [
    { id: "leaders-room", title: "Leaders Room", desc: "Ongea na pastors, elders, na church admins.", icon: "people-outline" },
    { id: "church-updates", title: "Church Updates", desc: "Tuma na fuatilia taarifa za church kwenye room kuu.", icon: "notifications-outline" },
    { id: "church-operations", title: "Church Operations", desc: "Huduma, logistics, na weekly planning ya church.", icon: "settings-outline" },
    { id: "tlmc-church", title: "TLMC & Church", desc: "Shared direction kati ya TLMC na local church.", icon: "git-network-outline" },
  ],
  Mission: [
    { id: "my-church", title: "My Church", desc: "Wasiliana na church members kwa updates na announcements.", icon: "chatbubbles-outline" },
    { id: "members", title: "Members", desc: "Ona members list na church assignment zao.", icon: "person-outline" },
    { id: "ministries-admin", title: "Ministries Admin", desc: "Ongea na ministry admins wote kwa coordination.", icon: "grid-outline" },
    { id: "prayer-desk", title: "Prayer Desk", desc: "Prayer requests, follow-up, na counsel kwa V1.", icon: "heart-outline" },
  ],
} as const;

function toggleItem(list: string[], value: string) {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function slugPart(v: string) {
  return String(v || "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0]?.toUpperCase() || "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export default function GlobalControlScreen() {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  const [selectedContinents, setSelectedContinents] = useState<string[]>(["africa"]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(["tanzania"]);
  const [selectedChurches, setSelectedChurches] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  const [selectedStream, setSelectedStream] = useState<"Agenda" | "Mission">("Agenda");
  const [selectedFunction, setSelectedFunction] = useState("leaders-room");

  const availableCountries = useMemo(() => {
    const out: { id: string; title: string; churches: number }[] = [];
    const seen = new Set<string>();
    selectedContinents.forEach((continentId) => {
      (COUNTRIES[continentId] || []).forEach((country) => {
        if (!seen.has(country.id)) {
          seen.add(country.id);
          out.push(country);
        }
      });
    });
    return out;
  }, [selectedContinents]);

  const availableChurches = useMemo(() => {
    const out: { id: string; title: string; meta: string }[] = [];
    const seen = new Set<string>();
    selectedCountries.forEach((countryId) => {
      (CHURCHES_BY_COUNTRY[countryId] || []).forEach((church) => {
        if (!seen.has(church.id)) {
          seen.add(church.id);
          out.push(church);
        }
      });
    });
    return out;
  }, [selectedCountries]);

  const selectedContinentTitles = useMemo(
    () => CONTINENTS.filter((x) => selectedContinents.includes(x.id)).map((x) => x.title),
    [selectedContinents]
  );

  const selectedCountryTitles = useMemo(
    () => availableCountries.filter((x) => selectedCountries.includes(x.id)).map((x) => x.title),
    [availableCountries, selectedCountries]
  );

  const selectedChurchTitles = useMemo(
    () => availableChurches.filter((x) => selectedChurches.includes(x.id)).map((x) => x.title),
    [availableChurches, selectedChurches]
  );

  const selectedTargetTitles = useMemo(
    () => TARGETS.filter((x) => selectedTargets.includes(x.id)).map((x) => x.title),
    [selectedTargets]
  );

  const selectedMinistryTitles = useMemo(
    () => MINISTRIES.filter((x) => selectedMinistries.includes(x.id)).map((x) => x.title),
    [selectedMinistries]
  );

  const selectedFunctionItem = useMemo(() => {
    return STREAM_GROUPS[selectedStream].find((x) => x.id === selectedFunction) || STREAM_GROUPS[selectedStream][0];
  }, [selectedStream, selectedFunction]);

  const roomName = useMemo(() => {
    const continent = selectedContinentTitles[0] || "Global";
    const target = selectedTargetTitles[0] || "Members";
    const fn = selectedFunctionItem?.title || "Room";
    return `${continent} ${target} ${fn}`;
  }, [selectedContinentTitles, selectedTargetTitles, selectedFunctionItem]);

  const generatedCommandCode = useMemo(() => {
    const continentCode = slugPart(selectedContinentTitles[0] || "GLB");
    const streamCode = selectedStream === "Agenda" ? "AGD" : "MSN";
    const fnCode = slugPart(selectedFunctionItem?.title || "ROOM");
    return `${continentCode}-${streamCode}-${fnCode}`;
  }, [selectedContinentTitles, selectedStream, selectedFunctionItem]);

  const summary = useMemo(() => {
    return [
      `Continents: ${selectedContinentTitles.join(", ") || "Global"}`,
      `Countries: ${selectedCountryTitles.join(", ") || "None"}`,
      `Churches: ${selectedChurchTitles.join(", ") || "None"}`,
      `Targets: ${selectedTargetTitles.join(", ") || "None"}`,
      `Ministries: ${selectedMinistryTitles.join(", ") || "None"}`,
      `Stream: ${selectedStream}`,
      `Function: ${selectedFunctionItem?.title || "—"}`,
    ].join(" • ");
  }, [
    selectedContinentTitles,
    selectedCountryTitles,
    selectedChurchTitles,
    selectedTargetTitles,
    selectedMinistryTitles,
    selectedStream,
    selectedFunctionItem,
  ]);

  function toggleContinent(id: string) {
    setSelectedContinents((prev) => {
      const next = toggleItem(prev, id);
      return next.length ? next : [id];
    });
  }

  function toggleCountry(id: string) {
    setSelectedCountries((prev) => {
      const next = toggleItem(prev, id);
      return next.length ? next : [id];
    });
  }

  function toggleChurch(id: string) {
    setSelectedChurches((prev) => {
      const next = toggleItem(prev, id);
      return next.length ? next : [id];
    });
  }

  function toggleTarget(id: string) {
    setSelectedTargets((prev) => {
      const next = toggleItem(prev, id);
      return next.length ? next : [id];
    });
  }

  function toggleMinistry(id: string) {
    setSelectedMinistries((prev) => {
      const next = toggleItem(prev, id);
      return next.length ? next : [id];
    });
  }

  function chooseStream(stream: "Agenda" | "Mission") {
    setSelectedStream(stream);
    const first = STREAM_GROUPS[stream][0]?.id;
    if (first) setSelectedFunction(first);
  }

  function chooseFunction(id: string) {
    setSelectedFunction(id);
  }

  function goBack() {
    if (step === 1) {
      router.back();
      return;
    }
    setStep((prev) => (prev - 1) as 1 | 2 | 3 | 4 | 5 | 6);
  }

  function goNext() {
    if (step < 6) {
      setStep((prev) => (prev + 1) as 1 | 2 | 3 | 4 | 5 | 6);
      return;
    }

    router.push({
      pathname: "/kingdom/global-compose" as any,
      params: {
        continents: selectedContinentTitles.join(", ") || "Global",
        countries: selectedCountryTitles.join(", ") || "None",
        roles: selectedTargetTitles.join(", ") || "None",
        streams: selectedStream,
        roomName,
        commandCode: generatedCommandCode,
        summary,
      },
    });
  }

  const stepTitle =
    step === 1
      ? "Continents"
      : step === 2
      ? "Countries"
      : step === 3
      ? "Churches"
      : step === 4
      ? "Targets"
      : step === 5
      ? "Ministries"
      : "Stream • Function • Summary";

  const stepSub =
    step === 1
      ? "Chagua bara moja au mengi kwanza."
      : step === 2
      ? "Chagua nchi kutoka kwenye bara ulilochagua."
      : step === 3
      ? "Chagua church unazotaka kufikia."
      : step === 4
      ? "Chagua watu wa kulengwa kwanza."
      : step === 5
      ? "Chagua ministry zinazohusika."
      : "Chagua Agenda au Mission, function moja, kisha endelea compose.";

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topRow}>
        <Pressable onPress={goBack} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>GLOBAL CONTROL</Text>
          <Text style={s.sub}>Step {step}/6 • {stepTitle}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        {step !== 6 ? (
        <View style={s.heroCard}>
          <View style={s.heroTop}>
            <View style={s.heroIcon}>
              <Ionicons name="earth-outline" size={30} color="rgba(245,238,255,0.96)" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>Kingdom Outer Control</Text>
              <Text style={s.heroMeta}>{stepSub}</Text>
            </View>

            <View style={s.livePill}>
              <View style={s.liveDot} />
              <Text style={s.liveText}>LIVE</Text>
            </View>
          </View>
        </View>
        ) : null}

        {step === 1 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Continents</Text>
            <View style={s.grid}>
              {CONTINENTS.map((item) => {
                const active = selectedContinents.includes(item.id);
                return (
                  <Pressable key={item.id} onPress={() => toggleContinent(item.id)} style={[s.card, active ? s.cardActive : null]}>
                    <View style={s.checkRow}>
                      <View style={[s.check, active ? s.checkActive : null]}>
                        {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                      </View>
                    </View>
                    <Text style={[s.cardTitle, active ? s.cardTitleActive : null]}>{item.title}</Text>
                    <Text style={s.meta}>{item.meta}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 2 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Countries</Text>
            <Text style={s.sectionSub}>Kutoka: {selectedContinentTitles.join(", ") || "Global"}</Text>
            <View style={s.grid}>
              {availableCountries.map((item) => {
                const active = selectedCountries.includes(item.id);
                return (
                  <Pressable key={item.id} onPress={() => toggleCountry(item.id)} style={[s.card, active ? s.cardActive : null]}>
                    <View style={s.checkRow}>
                      <View style={[s.check, active ? s.checkActive : null]}>
                        {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                      </View>
                    </View>
                    <Text style={[s.cardTitle, active ? s.cardTitleActive : null]}>{item.title}</Text>
                    <Text style={s.meta}>{item.churches} churches</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 3 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Churches</Text>
            <Text style={s.sectionSub}>Kutoka: {selectedCountryTitles.join(", ") || "None"}</Text>
            <View style={s.grid}>
              {availableChurches.map((item) => {
                const active = selectedChurches.includes(item.id);
                return (
                  <Pressable key={item.id} onPress={() => toggleChurch(item.id)} style={[s.card, active ? s.cardActive : null]}>
                    <View style={s.checkRow}>
                      <View style={[s.check, active ? s.checkActive : null]}>
                        {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                      </View>
                    </View>
                    <Text style={[s.cardTitle, active ? s.cardTitleActive : null]}>{item.title}</Text>
                    <Text style={s.meta}>{item.meta}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 4 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Targets</Text>
            <Text style={s.sectionSub}>Chagua watu wa kufikiwa kwanza.</Text>
            <View style={s.grid}>
              {TARGETS.map((item) => {
                const active = selectedTargets.includes(item.id);
                return (
                  <Pressable key={item.id} onPress={() => toggleTarget(item.id)} style={[s.card, active ? s.cardActive : null]}>
                    <View style={s.checkRow}>
                      <View style={[s.check, active ? s.checkActive : null]}>
                        {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                      </View>
                    </View>
                    <Text style={[s.cardTitle, active ? s.cardTitleActive : null]}>{item.title}</Text>
                    <Text style={s.meta}>{item.meta}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 5 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Ministries</Text>
            <Text style={s.sectionSub}>Chagua ministry zinazohusika.</Text>
            <View style={s.grid}>
              {MINISTRIES.map((item) => {
                const active = selectedMinistries.includes(item.id);
                return (
                  <Pressable key={item.id} onPress={() => toggleMinistry(item.id)} style={[s.card, active ? s.cardActive : null]}>
                    <View style={s.checkRow}>
                      <View style={[s.check, active ? s.checkActive : null]}>
                        {active ? <Ionicons name="checkmark" size={14} color="#08111F" /> : null}
                      </View>
                    </View>
                    <Text style={[s.cardTitle, active ? s.cardTitleActive : null]}>{item.title}</Text>
                    <Text style={s.meta}>{item.meta}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {step === 6 ? (
          <>
            <View style={s.section}>
              <Text style={s.sectionTitle}>Stream</Text>
              <View style={s.streamTabs}>
                {(["Agenda", "Mission"] as const).map((item) => {
                  const active = selectedStream === item;
                  return (
                    <Pressable key={item} onPress={() => chooseStream(item)} style={[s.streamTab, active ? s.streamTabActive : null]}>
                      <Text style={[s.streamTabText, active ? s.streamTabTextActive : null]}>{item}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.section}>
              <Text style={s.sectionTitle}>{selectedStream} Functions</Text>
              <Text style={s.sectionSub}>Chagua function moja tu ambayo room ya invitation itatumia.</Text>
              <View style={s.functionGrid}>
                {STREAM_GROUPS[selectedStream].map((item) => {
                  const active = selectedFunction === item.id;
                  return (
                    <Pressable key={item.id} onPress={() => chooseFunction(item.id)} style={[s.functionCard, active ? s.functionCardActive : null]}>
                      <View style={s.functionIconWrap}>
                        <Ionicons name={item.icon as any} size={26} color="white" />
                      </View>
                      <Text style={[s.functionTitle, active ? s.cardTitleActive : null]}>{item.title}</Text>
                      <Text style={s.functionDesc}>{item.desc}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={s.summaryBox}>
              <Text style={s.summaryLabel}>Current Selection</Text>
              <Text style={s.summaryText}>{summary}</Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      <View style={s.bottomBar}>
        <Pressable style={s.button} onPress={goNext}>
          <Text style={s.buttonText}>{step === 6 ? "Continue to Compose" : "Continue"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BG,
    paddingTop: 54,
    paddingHorizontal: 16,
  },

  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 12,
  },

  backBtn: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "white",
    fontSize: 28,
    fontWeight: "900",
  },

  sub: {
    marginTop: 4,
    color: SOFT,
    fontSize: 13,
    fontWeight: "800",
  },

  heroCard: {
    borderRadius: 30,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.20)",
    backgroundColor: "rgba(255,255,255,0.035)",
    marginBottom: 12,
  },

  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  heroIcon: {
    width: 66,
    height: 66,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(70,50,120,0.22)",
    borderWidth: 1,
    borderColor: "rgba(120,90,255,0.18)",
  },

  heroTitle: {
    color: "white",
    fontSize: 20,
    fontWeight: "900",
  },

  heroMeta: {
    marginTop: 6,
    color: "rgba(255,255,255,0.70)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },

  livePill: {
    minWidth: 74,
    height: 34,
    borderRadius: 999,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.26)",
    backgroundColor: "rgba(120,35,35,0.24)",
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: "#FF6B6B",
  },

  liveText: {
    color: "#F3C86B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },

  section: {
    marginTop: 8,
    marginBottom: 10,
  },

  sectionTitle: {
    color: GOLD,
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 12,
  },

  sectionSub: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: -2,
    marginBottom: 12,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },

  card: {
    width: "48%",
    minHeight: 122,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "space-between",
  },

  smallCard: {
    width: "48%",
    minHeight: 62,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    justifyContent: "center",
  },

  cardActive: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "rgba(217,179,95,0.14)",
  },

  checkRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },

  check: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.045)",
    alignItems: "center",
    justifyContent: "center",
  },

  checkActive: {
    borderColor: "rgba(217,179,95,0.34)",
    backgroundColor: "#F3C86B",
  },

  cardTitle: {
    color: "white",
    fontSize: 19,
    fontWeight: "800",
  },

  cardTitleActive: {
    color: "#FFE3A3",
  },

  smallCardText: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
  },

  meta: {
    color: "rgba(255,255,255,0.62)",
    marginTop: 8,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },

  summaryBox: {
    marginTop: 22,
    padding: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.18)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },

  summaryLabel: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  summaryText: {
    color: "white",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "800",
  },

  bottomBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    paddingTop: 10,
    backgroundColor: "rgba(11,15,23,0.96)",
  },

  streamTabs: {
    flexDirection: "row",
    gap: 12,
  },

  streamTab: {
    flex: 1,
    minHeight: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  streamTabActive: {
    backgroundColor: "rgba(217,179,95,0.14)",
    borderColor: "rgba(217,179,95,0.34)",
  },

  streamTabText: {
    color: "white",
    fontSize: 16,
    fontWeight: "900",
  },

  streamTabTextActive: {
    color: "#FFE3A3",
  },

  functionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },

  functionCard: {
    width: "48%",
    minHeight: 168,
    padding: 14,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  functionCardActive: {
    borderColor: "rgba(217,179,95,0.48)",
    backgroundColor: "rgba(217,179,95,0.16)",
    shadowColor: "#D9B35F",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  functionIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(86,64,160,0.28)",
    borderWidth: 1,
    borderColor: "rgba(110,80,255,0.38)",
    marginBottom: 12,
  },

  functionTitle: {
    color: "white",
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 26,
  },

  functionDesc: {
    marginTop: 8,
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },

  button: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.32)",
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },

  buttonText: {
    color: "white",
    fontWeight: "900",
    fontSize: 16,
  },
});
