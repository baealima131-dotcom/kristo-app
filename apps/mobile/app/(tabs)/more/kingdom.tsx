import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  DEFAULT_BOXES,
  DEFAULT_AGENT_COMMAND,
  type KeyVisibility,
  type MyWaySettings,
  type OfficeBox,
  fetchMyWaySettings,
  patchMyWaySettings,
  normalizeCode,
  loadBoxes,
  saveBoxes,
} from "@/src/lib/kingdomSettings";

const BG = "#071224";
const CARD = "rgba(20,28,48,0.92)";
const CARD_2 = "rgba(16,22,40,0.96)";
const GOLD = "#D9B35F";
const PURPLE = "#6E59CF";
const BLUE = "#5DA9FF";
const RED = "#D46A6A";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.70)";
const MUTED = "rgba(255,255,255,0.50)";
export default function KingdomScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<MyWaySettings | null>(null);

  const [boxes, setBoxes] = useState<OfficeBox[]>(DEFAULT_BOXES);
  const [selectedId, setSelectedId] = useState<string>(DEFAULT_BOXES[0].id);
  const [draftCode, setDraftCode] = useState<string>(DEFAULT_BOXES[0].code);
  const [savingBox, setSavingBox] = useState(false);

  const [draftCommands, setDraftCommands] = useState<string[]>(["A", "", "", ""]);
  const [commandCount, setCommandCount] = useState(1);
  const [savingCommands, setSavingCommands] = useState(false);

  const selectedBox = useMemo(
    () => boxes.find((b) => b.id === selectedId) || boxes[0] || DEFAULT_BOXES[0],
    [boxes, selectedId]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const [data, savedBoxes] = await Promise.all([
          fetchMyWaySettings(),
          loadBoxes(),
        ]);
        if (!alive) return;

        const nextCommands = [...(data.agentCommands || [data.agentCommand || "A"])];
        while (nextCommands.length < 4) nextCommands.push("");

        setSettings(data);
        setDraftCommands(nextCommands);
        setCommandCount(data.commandCount || 1);

        const mergedBoxes = DEFAULT_BOXES.map((def) => {
          const found = savedBoxes.find((b) => String(b.id).toLowerCase() === String(def.id).toLowerCase());
          return found ? { ...def, ...found } : def;
        });

        setBoxes(mergedBoxes);
        setSelectedId(mergedBoxes[0]?.id || DEFAULT_BOXES[0].id);
        setDraftCode(mergedBoxes[0]?.code || DEFAULT_BOXES[0].code);
      } catch (e: any) {
        if (!alive) return;
        Alert.alert("Error", String(e?.message || "KINGDOM imeshindikana kufunguka."));
      } finally {
        if (alive) setLoading(false);
      }
    })();

  return () => {
      alive = false;
    };
  }, []);


  function openKingdomBox(box: OfficeBox) {
    const rawId = String(box?.id || "").trim().toLowerCase();
    const rawTitle = String(box?.title || "").trim().toLowerCase();

    const normalizedId =
      rawId === "office-core" ||
      rawId === "office_core" ||
      rawId === "officecore" ||
      rawId === "core1" ||
      rawId === "core" ||
      rawTitle === "office core"
        ? "office-core"
        : rawId;

    router.push({
      pathname: "/kingdom/[id]",
      params: { id: normalizedId },
    } as any);
  }

  function selectBox(id: string) {
    const found = boxes.find((b) => b.id === id);
    if (!found) return;
    setSelectedId(found.id);
    setDraftCode(found.code);
  }

  async function saveSelectedBox() {
    const nextCode = normalizeCode(draftCode);
    if (!selectedBox) return;

    if (!nextCode) {
      Alert.alert("Code required", "Weka command code ya box.");
      return;
    }

    try {
      setSavingBox(true);
      const next = boxes.map((b) =>
        b.id === selectedBox.id ? { ...b, code: nextCode } : b
      );
      await saveBoxes(next);
      setBoxes(next);
      setDraftCode(nextCode);
      Alert.alert("Saved", `${selectedBox.title} sasa ina code ${nextCode}.`);
    } catch {
      Alert.alert("Error", "Imeshindikana kuhifadhi box code.");
    } finally {
      setSavingBox(false);
    }
  }

  async function resetBoxes() {
    try {
      setSavingBox(true);
      await saveBoxes(DEFAULT_BOXES);
      setBoxes(DEFAULT_BOXES);
      setSelectedId(DEFAULT_BOXES[0].id);
      setDraftCode(DEFAULT_BOXES[0].code);
      Alert.alert("Reset", "Boxes zimerudi default.");
    } catch {
      Alert.alert("Error", "Imeshindikana kufanya reset.");
    } finally {
      setSavingBox(false);
    }
  }

  function updateDraftAt(index: number, value: string) {
    setDraftCommands((prev) => {
      const next = [...prev];
      next[index] = normalizeCode(value);
      return next;
    });
  }

  async function saveKingdomCommands() {
    const next = draftCommands
      .slice(0, commandCount)
      .map(normalizeCode)
      .filter(Boolean);

    if (next.length !== commandCount) {
      Alert.alert("Command missing", "Jaza command zote kwanza.");
      return;
    }

    try {
      setSavingCommands(true);
      const data = await patchMyWaySettings({
        agentCommands: next,
        commandCount,
      });
      setSettings(data);
      const saved = [...data.agentCommands];
      while (saved.length < 4) saved.push("");
      setDraftCommands(saved);
      setCommandCount(data.commandCount);
      Alert.alert("Saved", "KINGDOM commands zimehifadhiwa.");
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || "Imeshindikana kuhifadhi command."));
    } finally {
      setSavingCommands(false);
    }
  }

  function accentStyles(accent: OfficeBox["accent"]) {
    if (accent === "red") {
      return {
        borderColor: "rgba(212,106,106,0.28)",
        avatarBg: "rgba(110,70,110,0.36)",
        badgeBorder: "rgba(217,179,95,0.34)",
      };
    }
    if (accent === "blue") {
      return {
        borderColor: "rgba(93,169,255,0.28)",
        avatarBg: "rgba(80,75,150,0.34)",
        badgeBorder: "rgba(217,179,95,0.34)",
      };
    }
    return {
      borderColor: "rgba(217,179,95,0.28)",
      avatarBg: "rgba(90,76,150,0.34)",
      badgeBorder: "rgba(217,179,95,0.34)",
    };
  }

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator color={GOLD} />
          <Text style={s.loadingText}>Loading KINGDOM...</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>
          <View style={s.headerRow}>
            <Pressable onPress={() => router.back()} style={s.iconBtn}>
              <Ionicons name="chevron-back" size={24} color="white" />
            </Pressable>

            <View style={s.headerCenter}>
              <Text style={s.title}>KINGDOM</Text>
              <Text style={s.subtitle}>control center • inner rooms • command office</Text>
            </View>

            <Pressable
              onPress={() => {
                Alert.alert("KINGDOM", "Dashboard ya KINGDOM ipo tayari. Sasa tunaweza kuunganisha kila box hatua inayofuata.");
              }}
              style={s.iconBtn}
            >
              <Ionicons name="create-outline" size={22} color={GOLD} />
            </Pressable>
          </View>

          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={22} color="rgba(255,255,255,0.42)" />
            <Text style={s.searchText}>Search KINGDOM office</Text>
          </View>

          <View style={s.grid}>
            {boxes.map((box, index) => {
              const selected = selectedId === box.id;
              const accent = accentStyles(box.accent);

              return (
                <Pressable
                  key={box.id}
                  onPress={() => openKingdomBox(box)}
                  style={({ pressed }) => [
                    s.officeCard,
                    { borderColor: selected ? GOLD : accent.borderColor },
                    pressed ? { opacity: 0.92, transform: [{ scale: 0.992 }] } : null,
                  ]}
                >
                  <View style={s.officeTopRow}>
                    <View style={[s.officeAvatar, { backgroundColor: accent.avatarBg }]}>
                      <Ionicons name={box.icon} size={26} color="#DCD0FF" />
                    </View>

                    <View style={s.officeMetaRight}>
                      <Text style={s.officeTime}>{index === 0 ? "Now" : `${index * 4 + 1}m`}</Text>
                      <View style={[s.officeBadge, { borderColor: accent.badgeBorder }]}>
                        <Text style={s.officeBadgeText}>{box.badge}</Text>
                      </View>
                    </View>
                  </View>

                  <Text style={s.officeName}>{box.title}</Text>
                  <Text style={s.officeDesc}>{box.desc}</Text>
                  <Text style={s.officeCode}>Command: {box.code}</Text>
                </Pressable>
              );
            })}
          </View>


        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BG,
  },

  content: {
    padding: 16,
    paddingTop: 48,
    paddingBottom: 40,
  },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: BG,
  },

  loadingText: {
    color: SOFT,
    fontWeight: "800",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  headerCenter: {
    flex: 1,
  },

  iconBtn: {
    width: 58,
    height: 58,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  title: {
    color: "rgba(255,250,235,0.98)",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  subtitle: {
    marginTop: 2,
    color: "rgba(206,222,220,0.74)",
    fontWeight: "800",
    fontSize: 12,
  },

  searchWrap: {
    marginTop: 18,
    minHeight: 64,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.05)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
  },

  searchText: {
    color: "rgba(255,255,255,0.40)",
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.4,
  },

  grid: {
    marginTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 16,
  },

  officeCard: {
    width: "48.2%",
    minHeight: 216,
    borderRadius: 28,
    padding: 14,
    borderWidth: 1,
    backgroundColor: "rgba(16,22,48,0.72)",
    overflow: "hidden",
  },

  officeTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },

  officeAvatar: {
    width: 74,
    height: 74,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(120,100,255,0.35)",
  },

  officeMetaRight: {
    alignItems: "flex-end",
    gap: 10,
  },

  officeTime: {
    color: "rgba(255,255,255,0.86)",
    fontWeight: "900",
    fontSize: 12,
  },

  officeBadge: {
    minWidth: 44,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    backgroundColor: "rgba(255,214,120,0.10)",
  },

  officeBadgeText: {
    color: GOLD,
    fontWeight: "900",
    fontSize: 18,
  },

  officeName: {
    marginTop: 18,
    color: "rgba(245,240,255,0.98)",
    fontSize: 20,
    fontWeight: "900",
    lineHeight: 24,
  },

  officeDesc: {
    marginTop: 10,
    color: "#B7AADF",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 20,
  },

  officeCode: {
    marginTop: 12,
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
  },

  detailCard: {
    marginTop: 18,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.22)",
    backgroundColor: CARD_2,
  },

  detailTitle: {
    color: GOLD,
    fontSize: 20,
    fontWeight: "900",
  },

  detailSub: {
    marginTop: 8,
    color: SOFT,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
  },

  label: {
    marginTop: 14,
    color: "rgba(255,255,255,0.84)",
    fontSize: 13,
    fontWeight: "800",
  },

  input: {
    marginTop: 10,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 14,
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  actionRow: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10,
  },

  primaryBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
    paddingHorizontal: 14,
  },

  primaryBtnText: {
    color: BG,
    fontSize: 14,
    fontWeight: "900",
  },

  ghostBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
  },

  ghostBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },

  counterRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  counterLabel: {
    color: SOFT,
    fontWeight: "800",
    fontSize: 13,
  },

  counterRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  counterBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.05)",
  },

  counterValue: {
    minWidth: 24,
    textAlign: "center",
    color: "white",
    fontWeight: "900",
    fontSize: 18,
  },

  disabled: {
    opacity: 0.5,
  },
});
