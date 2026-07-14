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
  fetchMySafetyReports,
  type SafetyReportSummary,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.60)";

function statusLabel(
  status: SafetyReportSummary["status"]
) {
  if (status === "open") {
    return "Submitted";
  }

  if (status === "assigned") {
    return "Assigned";
  }

  if (status === "in_review") {
    return "In Review";
  }

  if (status === "resolved") {
    return "Resolved";
  }

  if (status === "escalated") {
    return "Escalated";
  }

  return "Closed";
}

export default function MyReportsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [reports, setReports] =
    React.useState<
      SafetyReportSummary[]
    >([]);

  const [loading, setLoading] =
    React.useState(true);

  const [error, setError] =
    React.useState("");

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      setLoading(true);
      setError("");

      void fetchMySafetyReports()
        .then((rows) => {
          if (!cancelled) {
            setReports(rows);
          }
        })
        .catch((reason: any) => {
          if (!cancelled) {
            setError(
              String(
                reason?.message ||
                  "Could not load your reports."
              )
            );
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
        style=
          {StyleSheet.absoluteFillObject}
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
            size={28}
            color={TEXT}
          />
        </Pressable>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            My Reports
          </Text>

          <Text style={styles.subtitle}>
            Track reports connected to your
            KRISTO account
          </Text>
        </View>

        <View style={styles.iconButton}>
          <Ionicons
            name="receipt-outline"
            size={26}
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
            Loading reports...
          </Text>
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
        >
          {error ? (
            <Text style={styles.error}>
              {error}
            </Text>
          ) : null}

          {!reports.length ? (
            <View style={styles.empty}>
              <Ionicons
                name="document-text-outline"
                size={40}
                color={GOLD}
              />

              <Text style={styles.emptyTitle}>
                No reports yet
              </Text>

              <Text style={styles.emptyText}>
                Reports you submit will
                appear here automatically.
              </Text>
            </View>
          ) : (
            reports.map((report) => (
              <Pressable
                key={report.id}
                onPress={() => {
                  router.push({
                    pathname:
                      "/more/my-reports/[reportCode]",
                    params: {
                      reportCode:
                        report.reportCode,
                    },
                  } as any);
                }}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.code}>
                    {report.reportCode}
                  </Text>

                  <Text style={styles.status}>
                    {statusLabel(
                      report.status
                    )}
                  </Text>
                </View>

                <Text style={styles.reason}>
                  {report.reason}
                </Text>

                <Text style={styles.meta}>
                  Submitted{" "}
                  {new Date(
                    report.createdAt
                  ).toLocaleDateString()}
                </Text>

                <View style={styles.cardBottom}>
                  <Text style={styles.updated}>
                    Updated{" "}
                    {new Date(
                      report.updatedAt
                    ).toLocaleString()}
                  </Text>

                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={GOLD}
                  />
                </View>
              </Pressable>
            ))
          )}
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
    paddingHorizontal: 17,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  backButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.13)",
    backgroundColor:
      "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },

  iconButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.30)",
    backgroundColor:
      "rgba(244,208,111,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    color: TEXT,
    fontSize: 27,
    fontWeight: "900",
  },

  subtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginTop: 13,
    color: MUTED,
    fontWeight: "700",
  },

  content: {
    padding: 17,
    gap: 13,
  },

  error: {
    color: "#FB7185",
    fontWeight: "800",
    textAlign: "center",
  },

  empty: {
    marginTop: 70,
    padding: 28,
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.18)",
    backgroundColor:
      "rgba(255,255,255,0.045)",
  },

  emptyTitle: {
    marginTop: 14,
    color: TEXT,
    fontSize: 21,
    fontWeight: "900",
  },

  emptyText: {
    marginTop: 8,
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    fontWeight: "600",
  },

  card: {
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.18)",
    backgroundColor:
      "rgba(255,255,255,0.052)",
  },

  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },

  code: {
    flex: 1,
    color: GOLD,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  status: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "900",
  },

  reason: {
    marginTop: 13,
    color: TEXT,
    fontSize: 17,
    fontWeight: "900",
    textTransform: "capitalize",
  },

  meta: {
    marginTop: 7,
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },

  cardBottom: {
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  updated: {
    flex: 1,
    color:
      "rgba(255,255,255,0.42)",
    fontSize: 10,
    fontWeight: "700",
  },
});
