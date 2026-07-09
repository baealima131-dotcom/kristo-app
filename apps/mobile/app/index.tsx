import React from "react";
import { Redirect, Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import { hasAcceptedTermsConsent, TERMS_VERSION } from "@/src/lib/termsConsent";

const BG = "#0B0F17";
const GOLD = "#D9B35F";

export default function AppGate() {
  const { session, loading } = useKristoSession();
  const [termsLoading, setTermsLoading] = React.useState(true);
  const [termsAccepted, setTermsAccepted] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void hasAcceptedTermsConsent(TERMS_VERSION).then((ok: boolean) => {
      if (!alive) return;
      setTermsAccepted(ok);
      setTermsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (loading || termsLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }

  if (!termsAccepted) return <Redirect href={"/terms" as Href} />;
  if (!session) return <Redirect href={"/(auth)/login" as Href} />;
  return <Redirect href={"/(tabs)" as Href} />;
}
