import * as WebBrowser from "expo-web-browser";
import React from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

export const SUBSCRIPTION_TERMS_URL = "https://kristo-app.vercel.app/terms";
export const SUBSCRIPTION_PRIVACY_URL = "https://kristo-app.vercel.app/privacy";
export const SUBSCRIPTION_SUPPORT_URL = "https://kristo-app.vercel.app/support";

async function openLegalUrl(url: string) {
  try {
    if (Platform.OS === "web") {
      await Linking.openURL(url);
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // Ignore browser open failures.
  }
}

type SubscriptionLegalDisclosureProps = {
  showAgreement?: boolean;
};

export function SubscriptionLegalDisclosure({
  showAgreement = true,
}: SubscriptionLegalDisclosureProps) {
  return (
    <View style={styles.wrap}>
      {showAgreement ? (
        <Text style={styles.agreement}>
          By continuing, you agree to our{" "}
          <Text style={styles.link} onPress={() => void openLegalUrl(SUBSCRIPTION_TERMS_URL)}>
            Terms of Use
          </Text>{" "}
          and{" "}
          <Text style={styles.link} onPress={() => void openLegalUrl(SUBSCRIPTION_PRIVACY_URL)}>
            Privacy Policy
          </Text>
          .
        </Text>
      ) : null}

      <Text style={styles.disclosure}>
        Subscriptions renew automatically unless canceled at least 24 hours before the end of the
        current billing period. You can manage or cancel your subscription anytime in Apple ID
        Subscription Settings.
      </Text>

      <View style={styles.linksRow}>
        <Pressable
          accessibilityRole="link"
          onPress={() => void openLegalUrl(SUBSCRIPTION_TERMS_URL)}
          style={({ pressed }) => [styles.linkButton, pressed ? styles.linkPressed : null]}
        >
          <Text style={styles.linkButtonText}>Terms of Use</Text>
        </Pressable>
        <Text style={styles.linkDivider}>·</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => void openLegalUrl(SUBSCRIPTION_PRIVACY_URL)}
          style={({ pressed }) => [styles.linkButton, pressed ? styles.linkPressed : null]}
        >
          <Text style={styles.linkButtonText}>Privacy Policy</Text>
        </Pressable>
        <Text style={styles.linkDivider}>·</Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => void openLegalUrl(SUBSCRIPTION_SUPPORT_URL)}
          style={({ pressed }) => [styles.linkButton, pressed ? styles.linkPressed : null]}
        >
          <Text style={styles.linkButtonText}>Support</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    gap: 10,
    alignItems: "center",
  },
  agreement: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  disclosure: {
    color: "rgba(255,255,255,0.32)",
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
    textAlign: "center",
  },
  linksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  link: {
    color: "rgba(212, 175, 55, 0.95)",
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  linkButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 6,
  },
  linkPressed: {
    opacity: 0.72,
  },
  linkButtonText: {
    color: "rgba(212, 175, 55, 0.95)",
    fontSize: 12,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  linkDivider: {
    color: "rgba(255,255,255,0.24)",
    fontSize: 12,
    fontWeight: "700",
  },
});
