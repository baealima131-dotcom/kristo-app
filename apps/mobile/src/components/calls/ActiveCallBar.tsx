import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";

import { endActiveCall, useActiveCall } from "@/src/lib/activeCallStore";

const BAR_HEIGHT = 44;

function formatElapsed(totalSec: number) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Wraps the app. While a call runs with its screen closed, a compact bar sits in the status-bar
 * area: tap it to return to the call, or hang up. The screens below get a zero top inset so
 * nothing hides under the bar. The tree is identical with or without the bar (no remounts).
 */
export function ActiveCallBarFrame({ children }: { children: React.ReactNode }) {
  const call = useActiveCall();
  const insets = useSafeAreaInsets();
  const show = Boolean(call?.showBar);
  const contentInsets = useMemo(() => (show ? { ...insets, top: 0 } : insets), [show, insets]);

  return (
    <View style={styles.frame}>
      {show && call ? <ActiveCallBar topInset={insets.top} /> : null}
      <SafeAreaInsetsContext.Provider value={contentInsets}>{children}</SafeAreaInsetsContext.Provider>
    </View>
  );
}

/**
 * The bar itself. Full-screen modals (Watch) render it too, since they cover the app layout;
 * `onBeforeReturn` closes such a modal before the call screen opens.
 */
export function ActiveCallBar({
  topInset,
  onBeforeReturn,
}: {
  topInset: number;
  onBeforeReturn?: () => void;
}) {
  const call = useActiveCall();
  const router = useRouter();
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!call) return null;
  const elapsed = formatElapsed((now - call.connectedAt) / 1000);

  return (
    <View style={[styles.bar, { paddingTop: topInset }]}>
      <Pressable
        style={({ pressed }) => [styles.returnArea, pressed ? styles.pressed : null]}
        onPress={() => {
          onBeforeReturn?.();
          // navigate (not push): an open call screen further back is reused, never duplicated.
          router.navigate({
            pathname: "/(tabs)/more/private-call/[callId]",
            params: { callId: call.callId },
          } as any);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Return to call with ${call.peerName}, ${elapsed}`}
      >
        <View style={styles.liveDot} />
        <Ionicons name="call" size={16} color="#FFFFFF" />
        <Text style={styles.label} numberOfLines={1}>
          Return to call · {call.peerName}
        </Text>
        <Text style={styles.time}>{elapsed}</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.hangUp, pressed || ending ? styles.pressed : null]}
        onPress={() => {
          if (ending) return;
          setEnding(true);
          void endActiveCall("call-bar").finally(() => setEnding(false));
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Hang up"
      >
        <Ionicons name="call" size={18} color="#FFFFFF" style={styles.hangUpIcon} />
        <Text style={styles.hangUpText}>Hang up</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F6B45",
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.25)",
    zIndex: 1000,
    elevation: 30,
  },
  returnArea: {
    flex: 1,
    height: BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pressed: {
    opacity: 0.7,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#7CFFB2",
  },
  label: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  time: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  hangUp: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    marginLeft: 10,
    borderRadius: 17,
    backgroundColor: "#E5484D",
  },
  hangUpIcon: {
    transform: [{ rotate: "135deg" }],
  },
  hangUpText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
});
