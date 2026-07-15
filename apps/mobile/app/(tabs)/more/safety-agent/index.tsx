import React from "react";

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  useFocusEffect,
  useRouter,
} from "expo-router";

import {
  Ionicons,
} from "@expo/vector-icons";

import {
  LinearGradient,
} from "expo-linear-gradient";

import {
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import {
  fetchSafetyAccess,
  type SafetyAccessResponse,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.58)";

export default function
SafetyAgentWorkspaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [
    access,
    setAccess,
  ] = React.useState<
    SafetyAccessResponse | null
  >(null);

  const [
    loading,
    setLoading,
  ] = React.useState(true);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      setLoading(true);

      void fetchSafetyAccess()
        .then((result) => {
          if (!cancelled) {
            setAccess(result);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setAccess(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [])
  );

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[
          "#28194B",
          "#111927",
          BG,
        ]}
        style={
          StyleSheet.absoluteFillObject
        }
      />

      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 10,
          },
        ]}
      >
        <Pressable
          onPress={() =>
            router.back()
          }
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={27}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            Safety Agent
          </Text>

          <Text style={styles.subtitle}>
            Report Center workspace
          </Text>
        </View>

        <View style={styles.icon}>
          <Ionicons
            name="shield-half-outline"
            size={26}
            color={GOLD}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            color={GOLD}
          />

          <Text style={styles.message}>
            Loading Safety Agent access…
          </Text>
        </View>
      ) : !access?.isSafetyAgent ? (
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={40}
            color={GOLD}
          />

          <Text style={styles.centerTitle}>
            Access restricted
          </Text>

          <Text style={styles.message}>
            Accept your Safety Agent invitation before opening this workspace.
          </Text>
        </View>
      ) : (
        <View style={styles.workspace}>
          <View style={styles.heroIcon}>
            <Ionicons
              name="shield-checkmark"
              size={36}
              color={GOLD}
            />
          </View>

          <Text style={styles.workspaceTitle}>
            Safety Agent Workspace
          </Text>

          <Text style={styles.workspaceText}>
            Your assigned reports and investigation tools will appear here.
          </Text>

          <View style={styles.activeBadge}>
            <View style={styles.activeDot} />

            <Text style={styles.activeText}>
              ACTIVE SAFETY AGENT
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles =
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: BG,
    },

    header: {
      paddingHorizontal: 17,
      paddingBottom: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },

    backButton: {
      width: 50,
      height: 50,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(255,255,255,0.11)",
    },

    title: {
      color: TEXT,
      fontSize: 23,
      fontWeight: "900",
    },

    subtitle: {
      marginTop: 2,
      color: MUTED,
      fontSize: 11,
      fontWeight: "700",
    },

    icon: {
      width: 50,
      height: 50,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.10)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.28)",
    },

    center: {
      flex: 1,
      paddingHorizontal: 30,
      alignItems: "center",
      justifyContent: "center",
    },

    centerTitle: {
      marginTop: 14,
      color: TEXT,
      fontSize: 21,
      fontWeight: "900",
    },

    message: {
      marginTop: 9,
      maxWidth: 290,
      color: MUTED,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      fontWeight: "700",
    },

    workspace: {
      margin: 18,
      padding: 26,
      borderRadius: 26,
      alignItems: "center",
      backgroundColor:
        "rgba(255,255,255,0.055)",
      borderWidth: 1,
      borderColor:
        "rgba(244,208,111,0.24)",
    },

    heroIcon: {
      width: 70,
      height: 70,
      borderRadius: 23,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor:
        "rgba(244,208,111,0.11)",
    },

    workspaceTitle: {
      marginTop: 17,
      color: TEXT,
      fontSize: 23,
      fontWeight: "900",
    },

    workspaceText: {
      marginTop: 9,
      color: MUTED,
      fontSize: 12,
      lineHeight: 19,
      textAlign: "center",
      fontWeight: "700",
    },

    activeBadge: {
      marginTop: 20,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: 999,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      backgroundColor:
        "rgba(110,231,183,0.10)",
    },

    activeDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: "#6EE7B7",
    },

    activeText: {
      color: "#6EE7B7",
      fontSize: 9,
      fontWeight: "900",
    },
  });
