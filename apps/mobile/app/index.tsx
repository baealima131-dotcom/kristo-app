import React from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";

const BG = "#0B0F17";
const GOLD = "#D9B35F";

export default function AppGate() {
  const { session, loading } = useKristoSession();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)" />;
}
