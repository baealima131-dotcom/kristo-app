import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getSessionSync } from "@/src/lib/kristoSession";

const BG = "#0B0F17";
const GOLD = "#D9B35F";
const BORDER = "rgba(255,255,255,0.10)";
const STORAGE_AGENT_COMMAND = "tlmc.quickCommand.agent.v1";
const DEFAULT_AGENT_COMMAND = "A";

function apiBase() {
  return String(process.env.EXPO_PUBLIC_API_BASE || "").replace(/\/$/, "");
}

function buildHeaders() {
  const auth = getSessionSync();
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };

  if (auth?.userId) headers["x-kristo-user-id"] = auth.userId;
  if (auth?.role) headers["x-kristo-role"] = auth.role;
  if (auth?.churchId) headers["x-kristo-church-id"] = auth.churchId;
  return headers;
}

async function fetchAgentCommandFromBackend() {
  const base = apiBase();
  if (!base) return null;

  try {
    const r = await fetch(`${base}/api/my-way`, {
      method: "GET",
      headers: buildHeaders(),
    });
    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok || !j?.data) return null;

    const next =
      String(j.data.agentCommand || DEFAULT_AGENT_COMMAND).trim().toUpperCase() ||
      DEFAULT_AGENT_COMMAND;

    return next;
  } catch {
    return null;
  }
}

async function saveAgentCommandToBackend(next: string) {
  const base = apiBase();
  if (!base) {
    return { ok: false as const, error: "EXPO_PUBLIC_API_BASE haijawekwa." };
  }

  try {
    const r = await fetch(`${base}/api/my-way`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify({
        agentCommand: next,
      }),
    });

    const j = await r.json().catch(() => null);

    if (!r.ok || !j?.ok) {
      return {
        ok: false as const,
        error: String(j?.error || "Imeshindikana kuhifadhi command kwenye backend."),
      };
    }

    const saved =
      String(j?.data?.agentCommand || next).trim().toUpperCase() || next;

    return { ok: true as const, value: saved };
  } catch {
    return {
      ok: false as const,
      error: "Network/backend error wakati wa kuhifadhi command.",
    };
  }
}

export default function MyWayAgentScreen() {
  const router = useRouter();
  const [agentCommand, setAgentCommand] = useState(DEFAULT_AGENT_COMMAND);
  const [draftCommand, setDraftCommand] = useState(DEFAULT_AGENT_COMMAND);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const backendValue = await fetchAgentCommandFromBackend();

        if (backendValue) {
          await AsyncStorage.setItem(STORAGE_AGENT_COMMAND, backendValue);
          if (!alive) return;
          setAgentCommand(backendValue);
          setDraftCommand(backendValue);
          return;
        }

        const raw = await AsyncStorage.getItem(STORAGE_AGENT_COMMAND);
        const localValue =
          String(raw || DEFAULT_AGENT_COMMAND).trim().toUpperCase() ||
          DEFAULT_AGENT_COMMAND;

        if (!alive) return;
        setAgentCommand(localValue);
        setDraftCommand(localValue);
      } catch {
        if (!alive) return;
        setAgentCommand(DEFAULT_AGENT_COMMAND);
        setDraftCommand(DEFAULT_AGENT_COMMAND);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  async function saveCommand() {
    const next =
      String(draftCommand || "").replace(/\s+/g, "").trim().toUpperCase();

    if (!next) {
      Alert.alert("Command required", "Ingiza command code kwanza.");
      return;
    }

    if (next.length < 1 || next.length > 16) {
      Alert.alert("Invalid command", "Command iwe kati ya 1 hadi 16.");
      return;
    }

    if (!/^[A-Z0-9]+$/.test(next)) {
      Alert.alert("Invalid command", "Tumia herufi A-Z au number 0-9 tu.");
      return;
    }

    try {
      setSaving(true);

      const res = await saveAgentCommandToBackend(next);
      if (!res.ok) {
        Alert.alert("Error", res.error);
        return;
      }

      await AsyncStorage.setItem(STORAGE_AGENT_COMMAND, res.value);
      setAgentCommand(res.value);
      setDraftCommand(res.value);

      Alert.alert("Saved", `Agent command imebadilishwa kwenda ${res.value}.`);
    } catch {
      Alert.alert("Error", "Imeshindikana kuhifadhi command.");
    } finally {
      setSaving(false);
    }
  }

  function resetDraft() {
    setDraftCommand(agentCommand);
  }

  return (
    <View style={s.wrap}>
      <Stack.Screen options={{ headerShown: false }} />

      <Pressable onPress={() => router.back()} style={s.backBtn}>
        <Ionicons name="chevron-back" size={18} color="white" />
        <Text style={s.backText}>Back</Text>
      </Pressable>

      <Text style={s.title}>Agent Room</Text>
      <Text style={s.sub}>Page hii imefunguliwa na Agent command yako.</Text>

      <View style={s.card}>
        <Text style={s.cardTitle}>Agent Command</Text>
        <Text style={s.cardText}>
          Current command: {loading ? "Loading..." : agentCommand}
        </Text>
        <Text style={s.cardText}>
          Hapa ndio utaweka content ya Agent Room.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Change Agent Command</Text>
        <Text style={s.label}>New command</Text>

        <TextInput
          value={draftCommand}
          onChangeText={(v) =>
            setDraftCommand(v.replace(/\s+/g, "").toUpperCase())
          }
          placeholder="Mfano: R"
          placeholderTextColor="rgba(255,255,255,0.30)"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          style={s.input}
        />

        <Text style={s.hint}>
          Tumia herufi kubwa au namba tu. Mfano: R, X7, AGENT9
        </Text>

        <Pressable
          onPress={saveCommand}
          disabled={saving || loading}
          style={({ pressed }) => [
            s.saveBtn,
            (pressed || saving || loading) ? s.btnDisabled : null,
          ]}
        >
          <Ionicons name="save-outline" size={18} color={BG} />
          <Text style={s.saveText}>{saving ? "Saving..." : "Save Command"}</Text>
        </Pressable>

        <Pressable
          onPress={resetDraft}
          disabled={saving || loading}
          style={({ pressed }) => [
            s.resetBtn,
            (pressed || saving || loading) ? s.btnDisabled : null,
          ]}
        >
          <Ionicons name="refresh-outline" size={18} color="white" />
          <Text style={s.resetText}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: BG, padding: 16, paddingTop: 56 },

  backBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.03)",
    marginBottom: 18,
  },

  backText: { color: "white", fontWeight: "800" },

  title: { color: "white", fontSize: 28, fontWeight: "900" },

  sub: {
    color: "rgba(255,255,255,0.68)",
    marginTop: 8,
    fontWeight: "700",
  },

  card: {
    marginTop: 22,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.24)",
    backgroundColor: "rgba(217,179,95,0.08)",
  },

  cardTitle: { color: GOLD, fontSize: 18, fontWeight: "900" },

  cardText: {
    color: "rgba(255,255,255,0.84)",
    marginTop: 10,
    lineHeight: 22,
    fontWeight: "700",
  },

  label: {
    marginTop: 14,
    color: "rgba(255,255,255,0.82)",
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.2,
  },

  input: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "white",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },

  hint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.52)",
    fontWeight: "700",
    lineHeight: 20,
  },

  saveBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: 16,
    backgroundColor: GOLD,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  saveText: {
    color: BG,
    fontWeight: "900",
    fontSize: 15,
  },

  resetBtn: {
    marginTop: 12,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  resetText: {
    color: "white",
    fontWeight: "800",
    fontSize: 14,
  },

  btnDisabled: {
    opacity: 0.45,
  },
});
