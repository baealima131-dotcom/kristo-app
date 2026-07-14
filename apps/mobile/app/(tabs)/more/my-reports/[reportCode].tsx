import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useLocalSearchParams,
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
  fetchMySafetyReportByCode,
  type SafetyReportSummary,
} from "@/src/lib/safetyAdminApi";

const BG = "#07111F";
const GOLD = "#F4D06F";
const TEXT = "#FFFFFF";
const MUTED =
  "rgba(255,255,255,0.60)";

function targetTypeLabel(
  targetType:
    SafetyReportSummary["targetType"]
) {
  if (targetType === "account") {
    return "Account";
  }

  if (targetType === "post") {
    return "Post";
  }

  if (targetType === "comment") {
    return "Comment";
  }

  if (targetType === "message") {
    return "Message";
  }

  if (targetType === "church") {
    return "Church";
  }

  if (targetType === "live") {
    return "Live broadcast";
  }

  return "Reported item";
}

function targetTypeIcon(
  targetType:
    SafetyReportSummary["targetType"]
): keyof typeof Ionicons.glyphMap {
  if (targetType === "account") {
    return "person-outline";
  }

  if (targetType === "post") {
    return "document-text-outline";
  }

  if (targetType === "comment") {
    return "chatbubble-outline";
  }

  if (targetType === "message") {
    return "mail-outline";
  }

  if (targetType === "church") {
    return "business-outline";
  }

  if (targetType === "live") {
    return "radio-outline";
  }

  return "flag-outline";
}

function readableCategory(
  value: string
) {
  return String(value || "Other")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase()
    );
}

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

export default function MyReportDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params =
    useLocalSearchParams<{
      reportCode?: string | string[];
    }>();

  const reportCode =
    Array.isArray(params.reportCode)
      ? String(
          params.reportCode[0] || ""
        )
      : String(
          params.reportCode || ""
        );

  const [report, setReport] =
    React.useState<
      SafetyReportSummary | null
    >(null);

  const [loading, setLoading] =
    React.useState(true);

  const [error, setError] =
    React.useState("");

  React.useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");

    void fetchMySafetyReportByCode(
      reportCode
    )
      .then((row) => {
        if (!cancelled) {
          setReport(row);
        }
      })
      .catch(() => {
        if (!cancelled) {
          /*
           * Keep the message generic so users
           * cannot determine whether another
           * person's code exists.
           */
          setError(
            "Report not found or unavailable."
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
  }, [reportCode]);

  const canOpenReportedItem =
    Boolean(
      report &&
      (
        report.targetType === "post" ||
        report.targetType === "comment"
      ) &&
      (
        report.sourceId ||
        report.targetId
      )
    );

  const openReportedItem =
    React.useCallback(() => {
      if (
        !report ||
        !canOpenReportedItem
      ) {
        return;
      }

      const finalPostId =
        report.targetType === "comment"
          ? String(
              report.sourceRoomId || ""
            ).trim()
          : String(
              report.sourceId ||
              report.targetId ||
              ""
            ).trim();

      if (!finalPostId) {
        return;
      }

      router.push({
        pathname: "/(tabs)",
        params: {
          openPostId:
            finalPostId,
        },
      } as any);
    }, [
      canOpenReportedItem,
      report,
      router,
    ]);

  const timeline = report
    ? [
        {
          key: "submitted",
          label: "Submitted",
          complete: true,
        },
        {
          key: "assigned",
          label:
            "Assigned to Safety Team",
          complete:
            report.status !== "open",
        },
        {
          key: "review",
          label: "Under Review",
          complete: [
            "in_review",
            "resolved",
            "escalated",
            "dismissed",
          ].includes(report.status),
        },
        {
          key: "resolved",
          label: "Resolved",
          complete:
            report.status ===
            "resolved",
        },
      ]
    : [];

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
            Report Status
          </Text>

          <Text style={styles.subtitle}>
            Private report tracking
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={GOLD}
          />
        </View>
      ) : error || !report ? (
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={43}
            color={GOLD}
          />

          <Text style={styles.errorTitle}>
            Report unavailable
          </Text>

          <Text style={styles.errorText}>
            {error ||
              "Report not found or unavailable."}
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
          <View style={styles.hero}>
            <Text style={styles.codeLabel}>
              REPORT COMMAND CODE
            </Text>

            <Text style={styles.code}>
              {report.reportCode}
            </Text>

            <View style={styles.statusPill}>
              <Text style={styles.statusText}>
                {statusLabel(
                  report.status
                )}
              </Text>
            </View>
          </View>

          <Pressable
            disabled={!canOpenReportedItem}
            onPress={openReportedItem}
            style={({ pressed }) => [
              styles.reportedItemCard,
              pressed &&
              canOpenReportedItem
                ? styles.reportedItemCardPressed
                : null,
            ]}
          >
            <View style={styles.reportedItemHeader}>
              <View style={styles.reportedItemIcon}>
                <Ionicons
                  name={targetTypeIcon(
                    report.targetType
                  )}
                  size={24}
                  color={GOLD}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.reportedItemEyebrow}>
                  REPORTED ITEM
                </Text>

                <Text style={styles.reportedItemType}>
                  {targetTypeLabel(
                    report.targetType
                  )}
                </Text>
              </View>
            </View>

            {report.targetThumbnailUri ? (
              <Image
                source={{
                  uri:
                    report.targetThumbnailUri,
                }}
                style={[
                  styles.reportedItemMedia,
                  report.targetType ===
                    "account" ||
                  report.targetType ===
                    "comment" ||
                  report.targetType ===
                    "message"
                    ? styles.reportedItemAvatar
                    : null,
                ]}
                resizeMode={
                  report.targetType ===
                    "post" ||
                  report.targetType ===
                    "live"
                    ? "cover"
                    : "cover"
                }
              />
            ) : null}

            <Text style={styles.reportedItemTitle}>
              {report.targetTitle ||
                report.targetOwnerName ||
                report.targetSubtitle ||
                "Reported item"}
            </Text>

            {report.targetPreview ? (
              <Text
                style={styles.reportedItemPreview}
                numberOfLines={4}
              >
                {report.targetPreview}
              </Text>
            ) : null}

            {canOpenReportedItem ? (
              <View style={styles.openOriginalRow}>
                <Ionicons
                  name="open-outline"
                  size={17}
                  color={GOLD}
                />

                <Text style={styles.openOriginalText}>
                  Open original
                </Text>
              </View>
            ) : null}
          </Pressable>

          <View style={styles.details}>
            <Text style={styles.sectionTitle}>
              Report details
            </Text>

            <Text style={styles.detailLabel}>
              Category
            </Text>

            <Text style={styles.detailValue}>
              {report.category}
            </Text>

            <Text style={styles.detailLabel}>
              Submitted
            </Text>

            <Text style={styles.detailValue}>
              {new Date(
                report.createdAt
              ).toLocaleString()}
            </Text>

            <Text style={styles.detailLabel}>
              Last updated
            </Text>

            <Text style={styles.detailValue}>
              {new Date(
                report.updatedAt
              ).toLocaleString()}
            </Text>
          </View>

          <View style={styles.timelineCard}>
            <Text style={styles.sectionTitle}>
              Progress
            </Text>

            {timeline.map(
              (step, index) => (
                <View
                  key={step.key}
                  style={styles.timelineRow}
                >
                  <View
                    style={[
                      styles.timelineDot,
                      step.complete &&
                        styles.timelineDotComplete,
                    ]}
                  >
                    {step.complete ? (
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color="#07111F"
                      />
                    ) : null}
                  </View>

                  <Text
                    style={[
                      styles.timelineText,
                      step.complete &&
                        styles.timelineTextComplete,
                    ]}
                  >
                    {step.label}
                  </Text>

                  {index <
                  timeline.length - 1 ? (
                    <View
                      style={[
                        styles.timelineLine,
                        step.complete &&
                          styles.timelineLineComplete,
                      ]}
                    />
                  ) : null}
                </View>
              )
            )}
          </View>

          <View style={styles.privacyCard}>
            <Ionicons
              name="shield-checkmark-outline"
              size={24}
              color="#6EE7B7"
            />

            <Text style={styles.privacyText}>
              This report is connected to
              your signed-in KRISTO account.
              The command code alone cannot
              be used by another person to
              open it.
            </Text>
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

  title: {
    color: TEXT,
    fontSize: 27,
    fontWeight: "900",
  },

  subtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },

  center: {
    flex: 1,
    paddingHorizontal: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  errorTitle: {
    marginTop: 15,
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
  },

  errorText: {
    marginTop: 8,
    color: MUTED,
    textAlign: "center",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },

  content: {
    padding: 17,
    gap: 15,
  },

  hero: {
    padding: 23,
    borderRadius: 25,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.28)",
    backgroundColor:
      "rgba(244,208,111,0.07)",
  },

  codeLabel: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },

  code: {
    marginTop: 9,
    color: GOLD,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  statusPill: {
    marginTop: 17,
    alignSelf: "flex-start",
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor:
      "rgba(147,197,253,0.13)",
  },

  statusText: {
    color: "#93C5FD",
    fontSize: 11,
    fontWeight: "900",
  },

  reportedItemCard: {
    padding: 20,
    borderRadius: 23,
    borderWidth: 1,
    borderColor:
      "rgba(244,208,111,0.22)",
    backgroundColor:
      "rgba(244,208,111,0.055)",
  },

  reportedItemCardPressed: {
    opacity: 0.78,
    transform: [
      {
        scale: 0.992,
      },
    ],
  },

  reportedItemMedia: {
    width: "100%",
    height: 170,
    marginTop: 16,
    borderRadius: 18,
    backgroundColor:
      "rgba(255,255,255,0.06)",
  },

  reportedItemAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignSelf: "flex-start",
  },

  openOriginalRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  openOriginalText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "900",
  },

  reportedItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  reportedItemIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(244,208,111,0.11)",
  },

  reportedItemEyebrow: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },

  reportedItemType: {
    marginTop: 3,
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },

  reportedItemTitle: {
    marginTop: 16,
    color: TEXT,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
  },

  reportedItemPreview: {
    marginTop: 12,
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },

  details: {
    padding: 20,
    borderRadius: 23,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.11)",
    backgroundColor:
      "rgba(255,255,255,0.045)",
  },

  sectionTitle: {
    marginBottom: 15,
    color: TEXT,
    fontSize: 19,
    fontWeight: "900",
  },

  detailLabel: {
    marginTop: 10,
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },

  detailValue: {
    marginTop: 4,
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
    textTransform: "capitalize",
  },

  timelineCard: {
    padding: 20,
    borderRadius: 23,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.11)",
    backgroundColor:
      "rgba(255,255,255,0.045)",
  },

  timelineRow: {
    minHeight: 57,
    flexDirection: "row",
    alignItems: "flex-start",
    position: "relative",
  },

  timelineDot: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 2,
    borderColor:
      "rgba(255,255,255,0.24)",
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },

  timelineDotComplete: {
    borderColor: GOLD,
    backgroundColor: GOLD,
  },

  timelineText: {
    marginLeft: 12,
    paddingTop: 3,
    color: MUTED,
    fontSize: 14,
    fontWeight: "700",
  },

  timelineTextComplete: {
    color: TEXT,
    fontWeight: "900",
  },

  timelineLine: {
    position: "absolute",
    left: 11,
    top: 25,
    bottom: -1,
    width: 2,
    backgroundColor:
      "rgba(255,255,255,0.12)",
  },

  timelineLineComplete: {
    backgroundColor:
      "rgba(244,208,111,0.55)",
  },

  privacyCard: {
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor:
      "rgba(110,231,183,0.22)",
    backgroundColor:
      "rgba(110,231,183,0.06)",
    flexDirection: "row",
    gap: 12,
  },

  privacyText: {
    flex: 1,
    color: MUTED,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: "600",
  },
});
