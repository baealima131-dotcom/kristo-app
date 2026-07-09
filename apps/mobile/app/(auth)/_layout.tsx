import React from "react";
import { ActivityIndicator, View } from "react-native";
import { Href, Redirect, Stack } from "expo-router";
import { hasAcceptedTermsConsent, TERMS_VERSION } from "@/src/lib/termsConsent";

export default function AuthLayout() {
  const [loading, setLoading] = React.useState(true);
  const [accepted, setAccepted] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void hasAcceptedTermsConsent(TERMS_VERSION).then((ok: boolean) => {
      if (!alive) return;
      setAccepted(ok);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0B0F17" }}>
        <ActivityIndicator color="#D9B35F" />
      </View>
    );
  }

  if (!accepted) return <Redirect href={"/terms" as Href} />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
