import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import {
  loadBoxes,
  normalizeCode,
  getInnerRoomOfficeBoxId,
  fetchMyWaySettings,
  patchMyWaySettings,
  DEFAULT_AGENT_COMMAND,
} from "@/src/lib/kingdomSettings";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const SOFT = "rgba(255,255,255,0.72)";
const CARD = "rgba(255,255,255,0.05)";

type CommandItem = {
  id: string;
  label: string;
  expected: string;
  entered: string;
  unlocked: boolean;
};

function makeInitialCommands(expectedList: string[]) {
  return expectedList.map((value, index) => ({
    id: `command-${index + 1}`,
    label: `Command ${index + 1}`,
    expected: normalizeCode(value) || DEFAULT_AGENT_COMMAND,
    entered: "",
    unlocked: false,
  }));
}

function emptyDraftCommands() {
  return ["", "", "", ""];
}

export default function SecurityCommandSequenceScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<"setup" | "unlock">("setup");

  const [draftCount, setDraftCount] = useState(1);
  const [draftCommands, setDraftCommands] = useState<string[]>(emptyDraftCommands());
  const [saving, setSaving] = useState(false);

  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    let alive = true;

    async function loadSequence() {
      try {
        const [settings, boxes] = await Promise.all([
          fetchMyWaySettings().catch(() => null),
          loadBoxes().catch(() => []),
        ]);

        const securityBoxId = getInnerRoomOfficeBoxId("security");
        const securityBox = Array.isArray(boxes)
          ? boxes.find((b: any) => b?.id === securityBoxId)
          : null;

        const rawCommands =
          Array.isArray(settings?.agentCommands) && settings.agentCommands.length
            ? settings.agentCommands
            : [settings?.agentCommand || securityBox?.code || DEFAULT_AGENT_COMMAND];

        const normalized = rawCommands
          .map((v: any) => normalizeCode(String(v || "")))
          .filter(Boolean)
          .slice(0, 4);

        const finalCommands = normalized.length
          ? normalized
          : [normalizeCode(String(securityBox?.code || DEFAULT_AGENT_COMMAND)) || DEFAULT_AGENT_COMMAND];

        const paddedDraft = [...finalCommands];
        while (paddedDraft.length < 4) paddedDraft.push("");

        if (alive) {
          setDraftCommands(paddedDraft.slice(0, 4));
          setDraftCount(Math.max(1, Math.min(4, finalCommands.length || settings?.commandCount || 1)));
          setCommands(makeInitialCommands(finalCommands));
          setCurrentStep(0);
          setMode("setup");
        }
      } catch {
        if (alive) {
          const fallback = [DEFAULT_AGENT_COMMAND];
          const paddedDraft = [...fallback, "", "", ""];
          setDraftCommands(paddedDraft.slice(0, 4));
          setDraftCount(1);
          setCommands(makeInitialCommands(fallback));
          setCurrentStep(0);
          setMode("setup");
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadSequence();

    return () => {
      alive = false;
    };
  }, []);

  const allDone = useMemo(
    () => commands.length > 0 && commands.every((item) => item.unlocked),
    [commands]
  );

  function updateDraftAt(index: number, value: string) {
    const nextValue = normalizeCode(value);
    setDraftCommands((prev) => {
      const next = [...prev];
      next[index] = nextValue;
      return next;
    });
  }

  function loadUnlockFromSavedSequence(nextCommands: string[]) {
    setCommands(makeInitialCommands(nextCommands));
    setCurrentStep(0);
    setMode("unlock");
  }

  async function handleSaveSequence() {
    const next = draftCommands
      .slice(0, draftCount)
      .map((v) => normalizeCode(v))
      .filter(Boolean);

    if (next.length !== draftCount) {
      Alert.alert("Command missing", "Jaza command zote ulizochagua kwanza.");
      return;
    }

    try {
      setSaving(true);

      const data = await patchMyWaySettings({
        agentCommand: next[0],
        agentCommands: next,
        commandCount: next.length,
      });

      const savedCommands =
        Array.isArray(data?.agentCommands) && data.agentCommands.length
          ? data.agentCommands.map((v) => normalizeCode(String(v || ""))).filter(Boolean).slice(0, 4)
          : next;

      const paddedDraft = [...savedCommands];
      while (paddedDraft.length < 4) paddedDraft.push("");

      setDraftCommands(paddedDraft.slice(0, 4));
      setDraftCount(Math.max(1, Math.min(4, savedCommands.length)));
      loadUnlockFromSavedSequence(savedCommands);

      Alert.alert("Saved", `Sequence saved: ${savedCommands.join(" → ")}`);
    } catch (e: any) {
      Alert.alert("Error", String(e?.message || e || "Imeshindikana kusave sequence."));
    } finally {
      setSaving(false);
    }
  }

  function updateEntered(id: string, value: string) {
    const nextValue = normalizeCode(value);

    setCommands((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              entered: nextValue,
            }
          : item
      )
    );
  }

  async function handleUnlockStep(index: number) {
    if (loading || submitting) return;
    if (index !== currentStep) return;

    const item = commands[index];
    if (!item) return;

    const entered = normalizeCode(item.entered);
    const expected = normalizeCode(item.expected);

    if (!entered) {
      Alert.alert("Missing command", `Weka ${item.label} kwanza.`);
      return;
    }

    if (entered !== expected) {
      Alert.alert("Wrong command", `${item.label} si sahihi.`);
      return;
    }

    setSubmitting(true);

    try {
      const isLast = index >= commands.length - 1;

      const next = commands.map((cmd, i) =>
        i === index ? { ...cmd, entered, unlocked: true } : cmd
      );

      setCommands(next);

      if (isLast) {
        Alert.alert("Unlocked", "KINGDOM imefunguka.");
        router.push("/more/kingdom" as any);
        return;
      }

      setCurrentStep(index + 1);
    } finally {
      setSubmitting(false);
    }
  }

  function getMeta(item: CommandItem, index: number) {
    if (item.unlocked) return "Opened";
    if (index === currentStep) return "Ready";
    return "Locked";
  }

  function getLockIcon(item: CommandItem, index: number) {
    if (item.unlocked) return "lock-open-outline";
    if (index === currentStep) return "key-outline";
    return "lock-closed-outline";
  }

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={s.topRow}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="chevron-back" size={20} color="white" />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={s.title}>KINGDOM Commands</Text>
          <Text style={s.sub}>
            {mode === "setup" ? "Setup saved sequence for KINGDOM gate" : "Enter saved sequence to unlock KINGDOM gate"}
          </Text>
        </View>
      </View>

      <View style={s.modeRow}>
        <Pressable
          onPress={() => setMode("setup")}
          style={[s.modeBtn, mode === "setup" ? s.modeBtnActive : null]}
        >
          <Text style={[s.modeBtnText, mode === "setup" ? s.modeBtnTextActive : null]}>Setup</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            const saved = draftCommands
              .slice(0, draftCount)
              .map((v) => normalizeCode(v))
              .filter(Boolean);

            if (!saved.length) {
              Alert.alert("No saved commands", "Save angalau command moja kwanza.");
              return;
            }

            loadUnlockFromSavedSequence(saved);
          }}
          style={[s.modeBtn, mode === "unlock" ? s.modeBtnActive : null]}
        >
          <Text style={[s.modeBtnText, mode === "unlock" ? s.modeBtnTextActive : null]}>Unlock</Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={s.sectionCard}>
            <Text style={s.loadingText}>Loading sequence...</Text>
          </View>
        ) : mode === "setup" ? (
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>Setup Sequence</Text>

            <View style={s.counterRow}>
              <Text style={s.counterLabel}>Idadi ya commands</Text>

              <View style={s.counterRight}>
                <Pressable
                  onPress={() => setDraftCount((p) => Math.max(1, p - 1))}
                  style={s.counterBtn}
                >
                  <Ionicons name="remove" size={16} color="white" />
                </Pressable>

                <Text style={s.counterValue}>{draftCount}</Text>

                <Pressable
                  onPress={() => setDraftCount((p) => Math.min(4, p + 1))}
                  style={s.counterBtn}
                >
                  <Ionicons name="add" size={16} color="white" />
                </Pressable>
              </View>
            </View>

            {Array.from({ length: draftCount }).map((_, index) => (
              <View key={index} style={s.commandCard}>
                <View style={s.commandTop}>
                  <View>
                    <Text style={s.commandLabel}>{`Command ${index + 1}`}</Text>
                    <Text style={s.commandMeta}>
                      {index === 0 ? "Hii ndio command ya kwanza ya kufungua" : "Optional step ya sequence"}
                    </Text>
                  </View>
                </View>

                <TextInput
                  value={draftCommands[index] || ""}
                  onChangeText={(v) => updateDraftAt(index, v)}
                  placeholder={index === 0 ? "Mfano: B" : `Mfano: CMD${index + 1}`}
                  placeholderTextColor="rgba(255,255,255,0.35)"
                  style={s.input}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={16}
                />
              </View>
            ))}

            <Pressable
              onPress={handleSaveSequence}
              disabled={saving}
              style={({ pressed }) => [
                s.saveBtn,
                saving ? { opacity: 0.7 } : null,
                pressed ? { opacity: 0.94 } : null,
              ]}
            >
              <Text style={s.saveBtnText}>
                {saving ? "Saving..." : "Save Sequence"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.sectionCard}>
            <Text style={s.sectionTitle}>Unlock Sequence</Text>

            {commands.map((item, index) => {
              const isActiveStep = index === currentStep;
              const isDisabled = !isActiveStep || item.unlocked;

              return (
                <View key={item.id} style={s.commandCard}>
                  <View style={s.commandTop}>
                    <View>
                      <Text style={s.commandLabel}>{item.label}</Text>
                      <Text style={s.commandMeta}>{getMeta(item, index)}</Text>
                    </View>

                    <Pressable
                      onPress={() => handleUnlockStep(index)}
                      disabled={isDisabled || submitting}
                      style={({ pressed }) => [
                        s.lockBtn,
                        item.unlocked
                          ? s.lockBtnOpen
                          : isActiveStep
                          ? s.lockBtnReady
                          : s.lockBtnLocked,
                        (pressed || isDisabled || submitting) ? { opacity: 0.94 } : null,
                      ]}
                    >
                      <Ionicons
                        name={getLockIcon(item, index) as any}
                        size={18}
                        color={item.unlocked ? "#08111F" : "white"}
                      />
                    </Pressable>
                  </View>

                  <TextInput
                    value={item.entered}
                    onChangeText={(v) => updateEntered(item.id, v)}
                    placeholder={item.unlocked ? "Opened" : isActiveStep ? "Enter command" : "Locked"}
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    style={[
                      s.input,
                      isDisabled ? s.inputDisabled : null,
                      item.unlocked ? s.inputUnlocked : null,
                    ]}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!isDisabled && !submitting}
                    maxLength={16}
                    returnKeyType="done"
                    onSubmitEditing={() => handleUnlockStep(index)}
                  />
                </View>
              );
            })}

            <Pressable
              onPress={() => handleUnlockStep(currentStep)}
              disabled={loading || submitting || allDone || !commands[currentStep]}
              style={({ pressed }) => [
                s.saveBtn,
                loading || submitting || allDone ? { opacity: 0.7 } : null,
                pressed ? { opacity: 0.94 } : null,
              ]}
            >
              <Text style={s.saveBtnText}>
                {allDone
                  ? "KINGDOM Opened"
                  : submitting
                  ? "Checking..."
                  : `Open ${commands[currentStep]?.label || "Sequence"}`}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: BG,
    paddingHorizontal: 16,
    paddingTop: 54,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 18,
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
  modeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  modeBtnActive: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderColor: "rgba(217,179,95,0.42)",
  },
  modeBtnText: {
    color: "white",
    fontSize: 14,
    fontWeight: "800",
  },
  modeBtnTextActive: {
    color: GOLD,
  },
  sectionCard: {
    borderRadius: 34,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  sectionTitle: {
    color: GOLD,
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 18,
  },
  loadingText: {
    color: SOFT,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 14,
  },
  counterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  counterLabel: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
  },
  counterRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  counterBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  counterValue: {
    color: GOLD,
    fontSize: 18,
    fontWeight: "900",
    minWidth: 22,
    textAlign: "center",
  },
  commandCard: {
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
  },
  commandTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  commandLabel: {
    color: "white",
    fontSize: 17,
    fontWeight: "900",
  },
  commandMeta: {
    marginTop: 4,
    color: SOFT,
    fontSize: 12,
    fontWeight: "800",
  },
  lockBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  lockBtnLocked: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: BORDER,
  },
  lockBtnReady: {
    backgroundColor: "rgba(217,179,95,0.18)",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.42)",
  },
  lockBtnOpen: {
    backgroundColor: GOLD,
  },
  input: {
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 14,
    color: "white",
    fontSize: 16,
    fontWeight: "800",
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  inputDisabled: {
    opacity: 0.58,
  },
  inputUnlocked: {
    borderColor: "rgba(217,179,95,0.42)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },
  saveBtn: {
    marginTop: 8,
    minHeight: 64,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },
  saveBtnText: {
    color: "#08111F",
    fontSize: 17,
    fontWeight: "900",
  },
});
