import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  "rgba(255,255,255,0.60)";

export default function SafetySupervisorScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [
    access,
    setAccess,
  ] = React.useState<
    SafetyAccessResponse | null
  >(null);

  const [loading, setLoading] =
    React.useState(true);

  const [error, setError] =
    React.useState("");

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      setLoading(true);
      setError("");

      void fetchSafetyAccess()
        .then((result) => {
          if (cancelled) return;
          setAccess(result);
        })
        .catch((reason: any) => {
          if (cancelled) return;

          setError(
            String(
              reason?.message ||
                "Could not load Safety access."
            )
          );
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

  const allowed =
    access?.isSafetySupervisor === true;

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[
          "#28194B",
          "#111927",
          BG,
        ]}
        style={StyleSheet.absoluteFillObject}
      />

      <View
        style={[
          styles.header,
          {
            paddingTop:
              insets.top + 12,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons
            name="chevron-back"
            size={29}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            Safety Supervisor
          </Text>

          <Text style={styles.headerSub}>
            Report Center workspace
          </Text>
        </View>

        <View style={styles.shield}>
          <Ionicons
            name="shield-checkmark-outline"
            size={27}
            color={GOLD}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={GOLD}
          />

          <Text style={styles.loadingText}>
            Loading Safety workspace...
          </Text>
        </View>
      ) : !allowed ? (
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={42}
            color={GOLD}
          />

          <Text style={styles.restrictedTitle}>
            Access restricted
          </Text>

          <Text style={styles.restrictedText}>
            Accept a Safety Supervisor
            invitation before opening this
            workspace.
          </Text>

          {error ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingBottom:
                insets.bottom + 30,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons
                name="shield-checkmark"
                size={34}
                color={GOLD}
              />
            </View>

            <Text style={styles.heroTitle}>
              Safety Workspace
            </Text>

            <Text style={styles.heroText}>
              Review assigned reports,
              manage Safety Agents and
              escalate serious cases to the
              System Admin.
            </Text>
          </View>

          <View style={styles.grid}>
            <Pressable style={styles.card}>
              <Ionicons
                name="flag-outline"
                size={27}
                color={GOLD}
              />

              <Text style={styles.cardTitle}>
                Assigned Reports
              </Text>

              <Text style={styles.cardText}>
                Reports assigned to your
                Safety team.
              </Text>
            </Pressable>

            <Pressable style={styles.card}>
              <Ionicons
                name="people-outline"
                size={27}
                color="#93C5FD"
              />

              <Text style={styles.cardTitle}>
                Safety Agents
              </Text>

              <Text style={styles.cardText}>
                Add and manage your agents.
              </Text>
            </Pressable>
          </View>

          <View style={styles.infoCard}>
            <Ionicons
              name="git-network-outline"
              size={25}
              color="#6EE7B7"
            />

            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>
                Automatic distribution
              </Text>

              <Text style={styles.infoText}>
                New reports will be routed
                to eligible agents with the
                lowest open workload.
              </Text>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  header: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },

  backButton: {
    width: 53,
    height: 53,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.13)",
    backgroundColor:
      "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: TEXT,
    fontSize: 27,
    fontWeight: "900",
  },

  headerSub: {
    marginTop: 3,
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },

  shield: {
    width: 54,
    height: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.30)",
    backgroundColor:
      "rgba(244,208,111,0.11)",
    alignItems: "center",
    justifyContent: "center",
  },

  center: {
    flex: 1,
    paddingHorizontal: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginTop: 14,
    color: MUTED,
    fontSize: 14,
    fontWeight: "700",
  },

  restrictedTitle: {
    marginTop: 16,
    color: TEXT,
    fontSize: 23,
    fontWeight: "900",
  },

  restrictedText: {
    marginTop: 10,
    color: MUTED,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
    textAlign: "center",
  },

  error: {
    marginTop: 12,
    color: "#FB7185",
    textAlign: "center",
  },

  content: {
    padding: 18,
    gap: 17,
  },

  hero: {
    padding: 23,
    borderRadius: 25,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.26)",
    backgroundColor:
      "rgba(255,255,255,0.065)",
  },

  heroIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.13)",
  },

  heroTitle: {
    marginTop: 17,
    color: TEXT,
    fontSize: 25,
    fontWeight: "900",
  },

  heroText: {
    marginTop: 8,
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },

  grid: {
    flexDirection: "row",
    gap: 13,
  },

  card: {
    flex: 1,
    minHeight: 170,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.12)",
    backgroundColor:
      "rgba(255,255,255,0.055)",
  },

  cardTitle: {
    marginTop: 25,
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
  },

  cardText: {
    marginTop: 7,
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  infoCard: {
    padding: 19,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(110,231,183,0.22)",
    backgroundColor:
      "rgba(110,231,183,0.065)",
    flexDirection: "row",
    gap: 13,
  },

  infoTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },

  infoText: {
    marginTop: 6,
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
});
