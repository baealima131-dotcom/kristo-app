import { Image } from "react-native";
import { useFonts, Cinzel_700Bold } from "@expo-google-fonts/cinzel";
import MyWayVoice from "@/components/MyWayVoice";
import MyWayWorkspace from "@/components/MyWayWorkspace";
import MyWayAppCommands from "@/components/MyWayAppCommands";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  View,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getSessionSync } from "@/src/lib/kristoSession";

const BG = "#031936";
const GOLD = "#77D5FF";
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
  const [royalReady] = useFonts({ Cinzel_700Bold });
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [agentCommand, setAgentCommand] = useState(DEFAULT_AGENT_COMMAND);
  const [draftCommand, setDraftCommand] = useState(DEFAULT_AGENT_COMMAND);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
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
    <LinearGradient colors={["#1769AE", "#0B417C", "#051D40"]} style={{flex:1}}>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
<Image
        source={require("../../../assets/images/kokolo.png")}
        resizeMode="stretch"

        accessible={false}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%"
        }}
      />
</View>
      <Stack.Screen options={{headerShown:false}}/>
      <View style={{paddingTop:insets.top+8,paddingHorizontal:20,flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}>
        <Pressable accessibilityLabel="Rudi" accessibilityRole="button" onPress={()=>router.back()} style={{padding:12}}><Ionicons name="chevron-back" size={25} color="#BFEAFF"/></Pressable>
        <Text style={{color:"#E0F5FF",letterSpacing:3,fontSize:19,fontWeight:royalReady?"normal":"900",fontFamily:royalReady?"Cinzel_700Bold":undefined}}>MY WAY</Text>
        <Pressable accessibilityLabel="Mipangilio" accessibilityRole="button" onPress={()=>setSettingsOpen(true)} style={{padding:12}}><Ionicons name="ellipsis-horizontal" size={25} color="#BFEAFF"/></Pressable>
      </View>
      <ScrollView removeClippedSubviews={false} contentContainerStyle={{flexGrow:1}}>
        {!settingsOpen && !workspaceOpen && <MyWayVoice/>}
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={()=>setWorkspaceOpen(true)} style={{alignSelf:"center",flexDirection:"row",gap:8,alignItems:"center",padding:14,marginBottom:16}}>
        <Ionicons name="albums-outline" size={18} color="#8EBEF0"/><Text style={{color:"#8EBEF0",fontSize:12}}>Fungua screen ya kazi</Text>
      </Pressable>
      <Modal visible={settingsOpen||workspaceOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>{setSettingsOpen(false);setWorkspaceOpen(false);}}>
        <KeyboardAvoidingView style={{flex:1,backgroundColor:BG}} behavior={Platform.OS==="ios"?"padding":undefined}>
          <ScrollView contentContainerStyle={{padding:22,paddingTop:24,paddingBottom:insets.bottom+24}} keyboardShouldPersistTaps="handled">
            <Pressable accessibilityRole="button" onPress={()=>{setSettingsOpen(false);setWorkspaceOpen(false);}} style={{alignSelf:"flex-end",padding:12}}><Text style={{color:GOLD}}>Funga</Text></Pressable>
            {workspaceOpen ? <>
              <MyWayAppCommands onOpen={(route) => {
                setWorkspaceOpen(false);
                setSettingsOpen(false);
                router.push(route);
              }}/>
              <MyWayWorkspace/>
            </> : <>
            <Text style={{color:"#A6D2FF",fontSize:13,lineHeight:21,marginBottom:16}}>Hali ya sauti: rekodi ya simu tu. Majibu ya AI kwa sauti bado hayajaunganishwa.</Text>
      <View style={[s.card, { marginTop: 0 }]}>
        <Text style={s.cardTitle}>Badilisha command</Text>
        <Text style={s.label}>Command mpya</Text>

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
          <Text style={s.saveText}>{saving ? "Inahifadhi…" : "Hifadhi command"}</Text>
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
          <Text style={s.resetText}>Rudisha</Text>
        </Pressable>
      </View>

            </>}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
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

  title: { color: "#F1F2F5", fontSize: 29, fontWeight: "800", letterSpacing: -0.7 },

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
    borderColor: "rgba(80,170,255,0.24)",
    backgroundColor: "rgba(80,170,255,0.08)",
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
