import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchMyChurchApplication } from "@/src/lib/churchApplicationsApi";

/**
 * Church features (posts, ministries, media) stay closed while the viewer's church comes from a
 * church application and is not active yet. The server refuses them as well (church_not_active);
 * this shows why and points to the requirements.
 */
export type ChurchActivationState = { checked: boolean; locked: boolean; churchName?: string };

const CACHE_MS = 30_000;
let cached: { at: number; state: ChurchActivationState } | null = null;

export async function loadChurchActivationState(force = false): Promise<ChurchActivationState> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.state;
  const res = await fetchMyChurchApplication();
  if (!res.ok) return { checked: true, locked: false }; // offline: the server still decides
  const { application, pendingChurch } = res.data;
  const ownLocked = !!application?.churchId && application.status !== "active" && application.status !== "rejected";
  const state: ChurchActivationState = {
    checked: true,
    locked: ownLocked || !!pendingChurch,
    churchName: application?.church.name || pendingChurch?.churchName,
  };
  cached = { at: Date.now(), state };
  return state;
}

/** The application screen already has fresh data: keep the gate in step with it. */
export function rememberChurchActivationState(state: Omit<ChurchActivationState, "checked">) {
  cached = { at: Date.now(), state: { checked: true, ...state } };
}

export function useChurchActivationState() {
  const [state, setState] = useState<ChurchActivationState>(cached?.state || { checked: false, locked: false });
  useEffect(() => {
    let alive = true;
    void loadChurchActivationState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export function openChurchRequirements() {
  router.push({ pathname: "/(tabs)/church/application", params: { focus: "requirements" } } as any);
}

/** True when an API result is the server's "church not active yet" refusal. */
export function isChurchNotActiveError(res: any) {
  return String(res?.error || "") === "church_not_active";
}

export function ChurchLockedNotice({ feature }: { feature: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/church/application" as any))} style={s.back} hitSlop={10} accessibilityLabel="Go back">
        <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.94)" />
      </Pressable>
      <View style={s.card}>
        <View style={s.icon}>
          <Ionicons name="lock-closed" size={24} color="#D9B35F" />
        </View>
        <Text style={s.title}>{feature} is not available yet</Text>
        <Text style={s.body}>
          Your church is waiting for activation. Posting and creating ministries open when every requirement is complete
          and Kristo App activates the church.
        </Text>
        <Pressable onPress={openChurchRequirements} style={s.btn} accessibilityRole="button">
          <Text style={s.btnText}>View church requirements</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Renders `children` for open churches, the locked notice for a church that is not active. */
export function ChurchActivationGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const state = useChurchActivationState();
  if (!state.checked) {
    return (
      <View style={[s.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color="#D9B35F" />
      </View>
    );
  }
  if (state.locked) return <ChurchLockedNotice feature={feature} />;
  return <>{children}</>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#05070D", paddingHorizontal: 18 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.28)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  card: {
    marginTop: 80,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 26,
    borderRadius: 26,
    borderWidth: 1.3,
    borderColor: "rgba(217,179,95,0.4)",
    backgroundColor: "rgba(14,19,30,0.98)",
  },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(217,179,95,0.45)",
    backgroundColor: "rgba(217,179,95,0.1)",
    marginBottom: 14,
  },
  title: { color: "rgba(255,255,255,0.96)", fontSize: 19, fontWeight: "900", textAlign: "center" },
  body: { color: "rgba(255,255,255,0.68)", fontSize: 14, lineHeight: 20, fontWeight: "600", textAlign: "center", marginTop: 8 },
  btn: {
    alignSelf: "stretch",
    minHeight: 48,
    marginTop: 20,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9C46A",
  },
  btnText: { color: "#07101A", fontSize: 15, fontWeight: "900" },
});
