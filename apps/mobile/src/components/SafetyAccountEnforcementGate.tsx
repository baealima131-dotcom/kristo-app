import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Ionicons,
} from "@expo/vector-icons";
import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useKristoSession } from "@/src/lib/KristoSessionProvider";
import {
  clearSafetyAccountEnforcement,
  formatSafetyExpiresAt,
  subscribeSafetyAccountEnforcement,
  type SafetyAccountEnforcementState,
} from "@/src/lib/safetyAccountEnforcement";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.62)";

/**
 * Single global Safety enforcement surface.
 * Restriction → dismissible modal (stay signed in).
 * Suspension / permanent ban → blocking full-screen (Sign Out only).
 */
export function SafetyAccountEnforcementGate() {
  const insets = useSafeAreaInsets();
  const { logout } = useKristoSession();

  const [
    state,
    setState,
  ] =
    React.useState<
      SafetyAccountEnforcementState | null
    >(null);

  const [
    signingOut,
    setSigningOut,
  ] =
    React.useState(false);

  React.useEffect(() => {
    return subscribeSafetyAccountEnforcement(
      setState
    );
  }, []);

  if (!state) {
    return null;
  }

  const expiresLabel =
    formatSafetyExpiresAt(
      state.expiresAt
    );

  const isRestriction =
    state.code ===
    "SAFETY_ACCOUNT_RESTRICTED";

  const isBan =
    state.code ===
    "SAFETY_PERMANENT_BAN";

  const title =
    isRestriction
      ? "Your account is temporarily restricted."
      : isBan
        ? "Account permanently banned"
        : "Account temporarily suspended";

  const body =
    isRestriction
      ? "You can still sign in and browse, but posting, messaging, uploads, calls/live, and other write actions may be unavailable until the restriction ends."
      : isBan
        ? "This Kristo account can no longer access the app. If you believe this was a mistake, contact Kristo support through an approved channel."
        : "This Kristo account is temporarily suspended and cannot use the app until the suspension ends.";

  const onDismissRestriction =
    () => {
      clearSafetyAccountEnforcement();
    };

  const onSignOut = () => {
    if (signingOut) return;
    setSigningOut(true);
    clearSafetyAccountEnforcement();
    logout();
  };

  if (isRestriction) {
    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={
          onDismissRestriction
        }
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.iconWrapAmber}>
              <Ionicons
                name="lock-closed-outline"
                size={28}
                color={GOLD}
              />
            </View>

            <Text style={styles.title}>
              {title}
            </Text>

            <Text style={styles.body}>
              {body}
            </Text>

            {expiresLabel ? (
              <Text style={styles.expires}>
                Restriction ends{" "}
                {expiresLabel}
              </Text>
            ) : null}

            <Pressable
              onPress={
                onDismissRestriction
              }
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>
                Understood
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <View
      style={[
        styles.blockingScreen,
        {
          paddingTop:
            insets.top + 28,
          paddingBottom:
            insets.bottom + 28,
        },
      ]}
      pointerEvents="auto"
    >
      <View style={styles.blockingCard}>
        <View
          style={
            isBan
              ? styles.iconWrapRed
              : styles.iconWrapAmber
          }
        >
          <Ionicons
            name={
              isBan
                ? "ban-outline"
                : "pause-circle-outline"
            }
            size={34}
            color={
              isBan
                ? "#FB7185"
                : GOLD
            }
          />
        </View>

        <Text style={styles.title}>
          {title}
        </Text>

        <Text style={styles.body}>
          {body}
        </Text>

        {expiresLabel && !isBan ? (
          <Text style={styles.expires}>
            Access restores{" "}
            {expiresLabel}
          </Text>
        ) : null}

        <Pressable
          onPress={onSignOut}
          disabled={signingOut}
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>
            {signingOut
              ? "Signing out…"
              : "Sign Out"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor:
      "rgba(0,0,0,0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  modalCard: {
    width: "100%",
    maxWidth: 420,
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.28)",
    backgroundColor: "#111927",
  },

  blockingScreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: BG,
    paddingHorizontal: 24,
    justifyContent: "center",
  },

  blockingCard: {
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.12)",
    backgroundColor:
      "rgba(255,255,255,0.04)",
  },

  iconWrapAmber: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.12)",
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.3)",
    marginBottom: 16,
  },

  iconWrapRed: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(251,113,133,0.12)",
    borderWidth: 1,
    borderColor:
      "rgba(251,113,133,0.32)",
    marginBottom: 16,
  },

  title: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28,
  },

  body: {
    marginTop: 12,
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },

  expires: {
    marginTop: 14,
    color: GOLD,
    fontSize: 13,
    fontWeight: "800",
  },

  primaryButton: {
    marginTop: 22,
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: GOLD,
  },

  primaryButtonText: {
    color: "#07111F",
    fontSize: 15,
    fontWeight: "900",
  },
});
