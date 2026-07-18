import React from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useFocusEffect,
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

type Tone =
  | "amber"
  | "blue"
  | "green"
  | "orange"
  | "red"
  | "neutral";

const TONES: Record<
  Tone,
  {
    fg: string;
    bg: string;
    border: string;
  }
> = {
  amber: {
    fg: GOLD,
    bg: "rgba(244,208,111,0.13)",
    border: "rgba(244,208,111,0.38)",
  },
  blue: {
    fg: "#93C5FD",
    bg: "rgba(147,197,253,0.13)",
    border: "rgba(147,197,253,0.34)",
  },
  green: {
    fg: "#6EE7B7",
    bg: "rgba(110,231,183,0.13)",
    border: "rgba(110,231,183,0.34)",
  },
  orange: {
    fg: "#FBBF24",
    bg: "rgba(251,191,36,0.13)",
    border: "rgba(251,191,36,0.34)",
  },
  red: {
    fg: "#FB7185",
    bg: "rgba(251,113,133,0.13)",
    border: "rgba(251,113,133,0.34)",
  },
  neutral: {
    fg: "rgba(255,255,255,0.82)",
    bg: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.16)",
  },
};

type DecisionType =
  NonNullable<
    SafetyReportSummary["decisionType"]
  >;

const ENFORCEMENT_DECISIONS: DecisionType[] =
  [
    "warning",
    "remove_content",
    "restrict_account",
    "suspend_account",
    "permanent_ban",
  ];

function isEnforcementDecision(
  decisionType?: DecisionType
): boolean {
  return Boolean(
    decisionType &&
      ENFORCEMENT_DECISIONS.includes(
        decisionType
      )
  );
}

function safeSafetyImageUri(
  value: unknown
) {
  const uri =
    String(value || "").trim();

  if (!uri) {
    return "";
  }

  const supported =
    /^https?:\/\//i.test(uri) ||
    /^file:\/\//i.test(uri) ||
    /^content:\/\//i.test(uri) ||
    /^data:image\//i.test(uri) ||
    /^ph:\/\//i.test(uri) ||
    /^assets-library:\/\//i.test(uri);

  return supported
    ? uri
    : "";
}

function formatDateTime(
  value?: string
) {
  const raw =
    String(value || "").trim();

  if (!raw) {
    return "";
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString();
}

function formatDate(value?: string) {
  const raw =
    String(value || "").trim();

  if (!raw) {
    return "";
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleDateString();
}

function computeEndsDate(
  report: SafetyReportSummary
) {
  const raw =
    String(
      report.decisionAt || ""
    ).trim();

  const days = Number(
    report.decisionDurationDays || 0
  );

  if (!raw || !days || days <= 0) {
    return "";
  }

  const start = new Date(raw);

  if (Number.isNaN(start.getTime())) {
    return "";
  }

  const end = new Date(
    start.getTime() +
      days * 24 * 60 * 60 * 1000
  );

  return end.toLocaleDateString();
}

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

/*
 * Large case status badge driven purely from backend state.
 */
function caseStatusBadge(
  report: SafetyReportSummary
): {
  label: string;
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
} {
  const status = report.status;
  const decision = report.decisionType;

  if (status === "resolved") {
    if (decision === "no_violation") {
      return {
        label: "Closed — No Violation",
        tone: "neutral",
        icon: "checkmark-circle-outline",
      };
    }

    if (
      isEnforcementDecision(decision)
    ) {
      return {
        label: "Action Taken",
        tone: "green",
        icon: "shield-checkmark",
      };
    }

    return {
      label: "Case Closed",
      tone: "neutral",
      icon: "checkmark-done-outline",
    };
  }

  if (status === "dismissed") {
    return {
      label: "Closed — No Violation",
      tone: "neutral",
      icon: "checkmark-circle-outline",
    };
  }

  if (status === "escalated") {
    return {
      label:
        "Escalated for Further Review",
      tone: "orange",
      icon: "alert-circle-outline",
    };
  }

  if (
    status === "in_review" ||
    status === "enforcement_pending" ||
    status === "recovery_required"
  ) {
    return {
      label: "Under Investigation",
      tone: "blue",
      icon: "search-outline",
    };
  }

  if (status === "assigned") {
    return {
      label: "Assigned to Safety Team",
      tone: "blue",
      icon: "people-outline",
    };
  }

  return {
    label: "Waiting for Review",
    tone: "amber",
    icon: "hourglass-outline",
  };
}

/*
 * Human-facing outcome for the actual decision.
 */
function decisionOutcome(
  decisionType?: DecisionType
): {
  label: string;
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
} | null {
  if (!decisionType) {
    return null;
  }

  if (decisionType === "no_violation") {
    return {
      label: "No Violation",
      tone: "green",
      icon: "checkmark-circle",
    };
  }

  if (decisionType === "warning") {
    return {
      label: "Warning Issued",
      tone: "amber",
      icon: "warning",
    };
  }

  if (
    decisionType === "remove_content"
  ) {
    return {
      label: "Content Removed",
      tone: "orange",
      icon: "trash",
    };
  }

  if (
    decisionType === "restrict_account"
  ) {
    return {
      label: "Account Restricted",
      tone: "orange",
      icon: "lock-closed",
    };
  }

  if (
    decisionType === "suspend_account"
  ) {
    return {
      label: "Account Suspended",
      tone: "orange",
      icon: "pause-circle",
    };
  }

  if (
    decisionType === "permanent_ban"
  ) {
    return {
      label: "Permanent Ban",
      tone: "red",
      icon: "ban",
    };
  }

  if (decisionType === "escalate") {
    return {
      label:
        "Escalated for Further Review",
      tone: "blue",
      icon: "arrow-up-circle",
    };
  }

  return null;
}

function reviewerRoleLabel(
  role?: SafetyReportSummary["decidedByRole"]
) {
  if (role === "supervisor") {
    return "a Safety Supervisor";
  }

  if (role === "agent") {
    return "a Safety Agent";
  }

  if (role === "system_admin") {
    return "a Safety Administrator";
  }

  return "the Kristo Safety Team";
}

type TimelineStep = {
  key: string;
  label: string;
  subtitle?: string;
  timestamp?: string;
  icon: keyof typeof Ionicons.glyphMap;
};

/*
 * Reporter-safe lifecycle. Only completed steps proven by backend
 * fields are shown. Timestamps are attached only when the API
 * actually provides them (createdAt / assignedAt / decisionAt /
 * resolvedAt). AI screening and human-review steps appear only when
 * the reporter allowlist derived flags prove they occurred.
 */
const CANONICAL_STAGE_COUNT = 6;

function buildTimeline(
  report: SafetyReportSummary
): TimelineStep[] {
  const steps: TimelineStep[] = [];

  const underInvestigation =
    report.status === "in_review" ||
    report.status ===
      "enforcement_pending" ||
    report.status ===
      "recovery_required";

  const caseClosed =
    report.status === "resolved" ||
    report.status === "dismissed";

  steps.push({
    key: "submitted",
    label: "Report Submitted",
    timestamp: report.createdAt,
    icon: "create-outline",
  });

  if (report.aiScreeningCompleted) {
    steps.push({
      key: "ai",
      label: "AI Initial Screening",
      subtitle:
        "Automated screening completed",
      icon: "sparkles-outline",
    });
  }

  if (report.assignedToSafetyTeam) {
    steps.push({
      key: "assigned",
      label: "Assigned to Safety Team",
      timestamp: report.assignedAt,
      icon: "people-outline",
    });
  }

  if (
    underInvestigation ||
    report.status === "escalated" ||
    caseClosed
  ) {
    steps.push({
      key: "in_review",
      label: "Under Investigation",
      icon: "search-outline",
    });
  }

  if (report.status === "escalated") {
    steps.push({
      key: "escalated",
      label:
        "Escalated for Further Review",
      timestamp:
        report.decisionAt ||
        report.updatedAt,
      icon: "arrow-up-circle-outline",
    });
  }

  if (
    report.decisionType &&
    report.decisionType !== "escalate"
  ) {
    steps.push({
      key: "decision",
      label: "Decision Issued",
      timestamp: report.decisionAt,
      icon: "hammer-outline",
    });
  }

  if (caseClosed) {
    steps.push({
      key: "closed",
      label:
        report.status === "dismissed" ||
        report.decisionType ===
          "no_violation"
          ? "Closed — No Violation"
          : "Case Closed",
      timestamp:
        report.resolvedAt ||
        report.decisionAt,
      icon: "checkmark-done-outline",
    });
  }

  return steps;
}

function enforcementDetails(
  report: SafetyReportSummary
): {
  title: string;
  tone: Tone;
  rows: { label: string; value: string }[];
  statusLabel: string;
} | null {
  const decision = report.decisionType;

  if (
    !isEnforcementDecision(decision)
  ) {
    return null;
  }

  const date = formatDate(
    report.decisionAt
  );

  const ends = computeEndsDate(report);

  const durationText =
    report.decisionDurationDays &&
    report.decisionDurationDays > 0
      ? `${report.decisionDurationDays} Days`
      : "";

  const rows: {
    label: string;
    value: string;
  }[] = [];

  if (decision === "warning") {
    if (date) {
      rows.push({
        label: "Date",
        value: date,
      });
    }

    rows.push({
      label: "Effective",
      value: "Immediately",
    });

    return {
      title: "Warning Issued",
      tone: "amber",
      rows,
      statusLabel: "Active",
    };
  }

  if (decision === "remove_content") {
    if (date) {
      rows.push({
        label: "Date",
        value: date,
      });
    }

    rows.push({
      label: "Effective",
      value: "Immediately",
    });

    return {
      title: "Content Removed",
      tone: "orange",
      rows,
      statusLabel: "Completed",
    };
  }

  if (decision === "restrict_account") {
    if (date) {
      rows.push({
        label: "Date",
        value: date,
      });
    }

    if (durationText) {
      rows.push({
        label: "Duration",
        value: durationText,
      });
    }

    if (ends) {
      rows.push({
        label: "Ends",
        value: ends,
      });
    }

    return {
      title: "Account Restricted",
      tone: "orange",
      rows,
      statusLabel: "Active",
    };
  }

  if (decision === "suspend_account") {
    if (durationText) {
      rows.push({
        label: "Duration",
        value: durationText,
      });
    }

    if (date) {
      rows.push({
        label: "Started",
        value: date,
      });
    }

    if (ends) {
      rows.push({
        label: "Ends",
        value: ends,
      });
    }

    return {
      title: "Account Suspended",
      tone: "orange",
      rows,
      statusLabel: "Active",
    };
  }

  if (date) {
    rows.push({
      label: "Date",
      value: date,
    });
  }

  rows.push({
    label: "Duration",
    value: "Permanent",
  });

  return {
    title: "Permanent Ban",
    tone: "red",
    rows,
    statusLabel: "Permanent",
  };
}

function reporterFeedback(
  report: SafetyReportSummary
): {
  tone: Tone;
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
} | null {
  const concluded =
    report.status === "resolved" ||
    report.status === "dismissed";

  if (!concluded) {
    return null;
  }

  if (
    isEnforcementDecision(
      report.decisionType
    )
  ) {
    return {
      tone: "green",
      icon: "heart-outline",
      text:
        "Thank you for helping keep the Kristo community safe. Appropriate action has been taken.",
    };
  }

  return {
    tone: "neutral",
    icon: "shield-outline",
    text:
      "We carefully reviewed the available evidence but could not confirm a violation of Kristo policies.",
  };
}

function InvestigationSummaryRow({
  icon,
  label,
  done,
  pendingLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  done: boolean;
  pendingLabel: string;
}) {
  return (
    <View style={styles.summaryRow}>
      <View
        style={[
          styles.summaryIcon,
          done
            ? styles.summaryIconDone
            : null,
        ]}
      >
        <Ionicons
          name={icon}
          size={18}
          color={
            done ? "#6EE7B7" : MUTED
          }
        />
      </View>

      <Text style={styles.summaryLabel}>
        {label}
      </Text>

      <View
        style={[
          styles.summaryChip,
          done
            ? styles.summaryChipDone
            : null,
        ]}
      >
        <Text
          style={[
            styles.summaryChipText,
            done
              ? styles.summaryChipTextDone
              : null,
          ]}
        >
          {done
            ? "Completed"
            : pendingLabel}
        </Text>
      </View>
    </View>
  );
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

  const [refreshing, setRefreshing] =
    React.useState(false);

  const [error, setError] =
    React.useState("");

  const pulse = React.useRef(
    new Animated.Value(0)
  ).current;

  const progressAnim = React.useRef(
    new Animated.Value(0)
  ).current;

  const hasLoadedRef =
    React.useRef(false);

  React.useEffect(() => {
    hasLoadedRef.current = false;
    setReport(null);
    setError("");
    setLoading(true);
  }, [reportCode]);

  const loadReport =
    React.useCallback(
      async (
        mode:
          | "initial"
          | "focus"
          | "pull" = "initial"
      ) => {
        if (mode === "pull") {
          setRefreshing(true);
        } else if (
          mode === "initial" ||
          !hasLoadedRef.current
        ) {
          setLoading(true);
        }

        setError("");

        try {
          const row =
            await fetchMySafetyReportByCode(
              reportCode
            );
          setReport(row);
          hasLoadedRef.current = true;
        } catch {
          /*
           * Keep the message generic so users
           * cannot determine whether another
           * person's code exists.
           */
          setError(
            "Report not found or unavailable."
          );
          if (
            mode === "initial" ||
            !hasLoadedRef.current
          ) {
            setReport(null);
          }
        } finally {
          setLoading(false);
          setRefreshing(false);
        }
      },
      [reportCode]
    );

  useFocusEffect(
    React.useCallback(() => {
      void loadReport(
        hasLoadedRef.current
          ? "focus"
          : "initial"
      );
    }, [loadReport])
  );

  const timeline = React.useMemo(
    () =>
      report
        ? buildTimeline(report)
        : [],
    [report]
  );

  const caseClosed = Boolean(
    report &&
      (report.status === "resolved" ||
        report.status === "dismissed")
  );

  React.useEffect(() => {
    if (!report) {
      return;
    }

    progressAnim.setValue(0);

    Animated.timing(progressAnim, {
      toValue: Math.min(
        timeline.length /
          CANONICAL_STAGE_COUNT,
        1
      ),
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [
    report,
    timeline.length,
    progressAnim,
  ]);

  React.useEffect(() => {
    if (!report || caseClosed) {
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(
            Easing.ease
          ),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(
            Easing.ease
          ),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();

    return () => {
      loop.stop();
    };
  }, [report, caseClosed, pulse]);

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

  const badge = report
    ? caseStatusBadge(report)
    : null;

  const outcome = report
    ? decisionOutcome(
        report.decisionType
      )
    : null;

  const enforcement = report
    ? enforcementDetails(report)
    : null;

  const feedback = report
    ? reporterFeedback(report)
    : null;

  const pulseScale = pulse.interpolate(
    {
      inputRange: [0, 1],
      outputRange: [1, 2.4],
    }
  );

  const pulseOpacity = pulse.interpolate(
    {
      inputRange: [0, 1],
      outputRange: [0.45, 0],
    }
  );

  const progressWidth =
    progressAnim.interpolate({
      inputRange: [0, 1],
      outputRange: ["0%", "100%"],
    });

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
      ) : error || !report || !badge ? (
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
          showsVerticalScrollIndicator={
            false
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void loadReport("pull");
              }}
              tintColor={GOLD}
              colors={[GOLD]}
            />
          }
        >
          {/* Hero: command code + large status badge */}
          <View style={styles.hero}>
            <Text style={styles.codeLabel}>
              REPORT COMMAND CODE
            </Text>

            <Text style={styles.code}>
              {report.reportCode}
            </Text>

            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    TONES[badge.tone]
                      .bg,
                  borderColor:
                    TONES[badge.tone]
                      .border,
                },
              ]}
            >
              <Ionicons
                name={badge.icon}
                size={20}
                color={
                  TONES[badge.tone].fg
                }
              />

              <Text
                style={[
                  styles.badgeText,
                  {
                    color:
                      TONES[badge.tone]
                        .fg,
                  },
                ]}
              >
                {badge.label}
              </Text>
            </View>
          </View>

          {/* Actual decision outcome */}
          {outcome ? (
            <View
              style={[
                styles.outcomeCard,
                {
                  borderColor:
                    TONES[outcome.tone]
                      .border,
                  backgroundColor:
                    TONES[outcome.tone]
                      .bg,
                },
              ]}
            >
              <View
                style={[
                  styles.outcomeIcon,
                  {
                    backgroundColor:
                      TONES[
                        outcome.tone
                      ].bg,
                    borderColor:
                      TONES[
                        outcome.tone
                      ].border,
                  },
                ]}
              >
                <Ionicons
                  name={outcome.icon}
                  size={30}
                  color={
                    TONES[outcome.tone]
                      .fg
                  }
                />
              </View>

              <View
                style={{ flex: 1 }}
              >
                <Text
                  style={
                    styles.outcomeEyebrow
                  }
                >
                  OUTCOME
                </Text>

                <Text
                  style={[
                    styles.outcomeLabel,
                    {
                      color:
                        TONES[
                          outcome.tone
                        ].fg,
                    },
                  ]}
                >
                  {outcome.label}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Reported item */}
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
                  {report.targetType === "post" &&
                  report.targetMediaType
                    ? report.targetMediaType
                        .toUpperCase()
                    : targetTypeLabel(
                        report.targetType
                      )}
                </Text>
              </View>
            </View>

            {safeSafetyImageUri(report.targetThumbnailUri) ? (
              <Image
                source={{
                  uri: safeSafetyImageUri(
                    report.targetThumbnailUri
                  ),
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
                resizeMode="cover"
              />
            ) : null}

            <Text style={styles.reportedItemTitle}>
              {report.targetTitle ||
                report.targetOwnerName ||
                "Reported item"}
            </Text>

            {report.targetSubtitle ? (
              <View style={styles.reportedItemContextRow}>
                <Ionicons
                  name={
                    report.targetType === "comment"
                      ? "document-text-outline"
                      : report.targetType === "account"
                        ? "person-circle-outline"
                        : "business-outline"
                  }
                  size={16}
                  color={GOLD}
                />

                <Text
                  style={styles.reportedItemSubtitle}
                  numberOfLines={2}
                >
                  {report.targetType === "comment"
                    ? `On: ${report.targetSubtitle}`
                    : report.targetSubtitle}
                </Text>
              </View>
            ) : null}

            {report.targetOwnerName ? (
              <View style={styles.reportedOwnerRow}>
                {safeSafetyImageUri(
                  report.targetOwnerAvatarUri
                ) ? (
                  <Image
                    source={{
                      uri: safeSafetyImageUri(
                        report.targetOwnerAvatarUri
                      ),
                    }}
                    style={styles.reportedOwnerAvatar}
                  />
                ) : (
                  <View
                    style={
                      styles.reportedOwnerAvatarFallback
                    }
                  >
                    <Ionicons
                      name="business-outline"
                      size={27}
                      color={GOLD}
                    />
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  <Text
                    style={styles.reportedItemOwner}
                    numberOfLines={1}
                  >
                    {report.targetOwnerName}
                  </Text>

                  {report.targetMediaType ? (
                    <Text
                      style={
                        styles.reportedOwnerMediaType
                      }
                    >
                      {report.targetMediaType
                        .toUpperCase()}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

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

          {/* Investigation timeline */}
          <View style={styles.card}>
            <View
              style={
                styles.timelineHeader
              }
            >
              <Text
                style={styles.sectionTitle}
              >
                Investigation Progress
              </Text>

              <Text
                style={
                  styles.timelineStageCount
                }
              >
                {timeline.length}/
                {CANONICAL_STAGE_COUNT}
              </Text>
            </View>

            <View
              style={styles.progressTrack}
            >
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width:
                      progressWidth,
                  },
                ]}
              />
            </View>

            <View
              style={styles.timelineBody}
            >
              {timeline.map(
                (step, index) => {
                  const isLast =
                    index ===
                    timeline.length -
                      1;

                  const isCurrent =
                    isLast &&
                    !caseClosed;

                  return (
                    <View
                      key={step.key}
                      style={
                        styles.timelineRow
                      }
                    >
                      <View
                        style={
                          styles.timelineRail
                        }
                      >
                        {isCurrent ? (
                          <Animated.View
                            style={[
                              styles.timelinePulse,
                              {
                                opacity:
                                  pulseOpacity,
                                transform:
                                  [
                                    {
                                      scale:
                                        pulseScale,
                                    },
                                  ],
                              },
                            ]}
                          />
                        ) : null}

                        <View
                          style={[
                            styles.timelineDot,
                            isCurrent
                              ? styles.timelineDotCurrent
                              : styles.timelineDotDone,
                          ]}
                        >
                          <Ionicons
                            name={
                              isCurrent
                                ? step.icon
                                : "checkmark"
                            }
                            size={13}
                            color={
                              isCurrent
                                ? GOLD
                                : "#07111F"
                            }
                          />
                        </View>

                        {!isLast ? (
                          <View
                            style={
                              styles.timelineLine
                            }
                          />
                        ) : null}
                      </View>

                      <View
                        style={
                          styles.timelineContent
                        }
                      >
                        <Text
                          style={[
                            styles.timelineLabel,
                            isCurrent
                              ? styles.timelineLabelCurrent
                              : null,
                          ]}
                        >
                          {step.label}
                        </Text>

                        {step.subtitle ? (
                          <Text
                            style={
                              styles.timelineSubtitle
                            }
                          >
                            {
                              step.subtitle
                            }
                          </Text>
                        ) : null}

                        {formatDateTime(
                          step.timestamp
                        ) ? (
                          <Text
                            style={
                              styles.timelineTime
                            }
                          >
                            {formatDateTime(
                              step.timestamp
                            )}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                }
              )}
            </View>
          </View>

          {/* Investigation summary — only proven backend signals */}
          {(
            report.aiScreeningCompleted ||
            report.assignedToSafetyTeam ||
            report.humanReviewCompleted ||
            report.status ===
              "in_review" ||
            report.status ===
              "escalated" ||
            report.status ===
              "resolved" ||
            report.status ===
              "dismissed"
          ) ? (
            <View style={styles.card}>
              <Text
                style={
                  styles.sectionTitle
                }
              >
                Investigation Summary
              </Text>

              {report.aiScreeningCompleted ? (
                <InvestigationSummaryRow
                  icon="sparkles-outline"
                  label="AI initial screening"
                  done
                  pendingLabel="Pending"
                />
              ) : null}

              {report.assignedToSafetyTeam ? (
                <InvestigationSummaryRow
                  icon="people-outline"
                  label="Assigned to Safety Team"
                  done
                  pendingLabel="Pending"
                />
              ) : null}

              {(
                report.status ===
                  "in_review" ||
                report.status ===
                  "escalated" ||
                report.status ===
                  "resolved" ||
                report.status ===
                  "dismissed" ||
                report.humanReviewCompleted
              ) ? (
                <InvestigationSummaryRow
                  icon="search-outline"
                  label="Under investigation"
                  done
                  pendingLabel="Pending"
                />
              ) : null}

              {report.humanReviewCompleted ? (
                <InvestigationSummaryRow
                  icon="reader-outline"
                  label="Human review completed"
                  done
                  pendingLabel="Pending"
                />
              ) : null}
            </View>
          ) : null}

          {/* Official Safety Decision */}
          {report.decisionType ? (
            <View style={styles.card}>
              <Text
                style={
                  styles.sectionTitle
                }
              >
                Official Safety Decision
              </Text>

              <Text
                style={
                  styles.decisionReasonLabel
                }
              >
                DECISION EXPLANATION
              </Text>

              <Text
                style={
                  styles.decisionReason
                }
              >
                {String(
                  report.decisionReason ||
                    ""
                ).trim() ||
                  "The Safety Team reviewed this report and recorded an official decision. No additional explanation was shared."}
              </Text>

              <View
                style={
                  styles.decisionMetaRow
                }
              >
                <Ionicons
                  name="shield-checkmark-outline"
                  size={16}
                  color={MUTED}
                />

                <Text
                  style={
                    styles.decisionMetaText
                  }
                >
                  Reviewed by{" "}
                  {reviewerRoleLabel(
                    report.decidedByRole
                  )}
                </Text>
              </View>

              {formatDate(
                report.decisionAt
              ) ? (
                <View
                  style={
                    styles.decisionMetaRow
                  }
                >
                  <Ionicons
                    name="calendar-outline"
                    size={16}
                    color={MUTED}
                  />

                  <Text
                    style={
                      styles.decisionMetaText
                    }
                  >
                    Decision recorded{" "}
                    {formatDate(
                      report.decisionAt
                    )}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Enforcement details */}
          {enforcement ? (
            <View
              style={[
                styles.enforcementCard,
                {
                  borderColor:
                    TONES[
                      enforcement.tone
                    ].border,
                  backgroundColor:
                    TONES[
                      enforcement.tone
                    ].bg,
                },
              ]}
            >
              <View
                style={
                  styles.enforcementHeader
                }
              >
                <Text
                  style={[
                    styles.enforcementTitle,
                    {
                      color:
                        TONES[
                          enforcement
                            .tone
                        ].fg,
                    },
                  ]}
                >
                  {enforcement.title}
                </Text>

                <View
                  style={[
                    styles.enforcementStatusPill,
                    {
                      borderColor:
                        TONES[
                          enforcement
                            .tone
                        ].border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.enforcementStatusText,
                      {
                        color:
                          TONES[
                            enforcement
                              .tone
                          ].fg,
                      },
                    ]}
                  >
                    {
                      enforcement.statusLabel
                    }
                  </Text>
                </View>
              </View>

              {enforcement.rows.map(
                (row) => (
                  <View
                    key={row.label}
                    style={
                      styles.enforcementRow
                    }
                  >
                    <Text
                      style={
                        styles.enforcementRowLabel
                      }
                    >
                      {row.label}
                    </Text>

                    <Text
                      style={
                        styles.enforcementRowValue
                      }
                    >
                      {row.value}
                    </Text>
                  </View>
                )
              )}
            </View>
          ) : null}

          {/* Reporter feedback */}
          {feedback ? (
            <View
              style={[
                styles.feedbackCard,
                {
                  borderColor:
                    TONES[
                      feedback.tone
                    ].border,
                  backgroundColor:
                    TONES[feedback.tone]
                      .bg,
                },
              ]}
            >
              <Ionicons
                name={feedback.icon}
                size={24}
                color={
                  TONES[feedback.tone]
                    .fg
                }
              />

              <Text
                style={
                  styles.feedbackText
                }
              >
                {feedback.text}
              </Text>
            </View>
          ) : null}

          {/* Report details */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              Report Details
            </Text>

            <Text style={styles.detailLabel}>
              Category
            </Text>

            <Text style={styles.detailValue}>
              {readableCategory(
                report.category
              )}
            </Text>

            {String(
              report.description || ""
            ).trim() ? (
              <>
                <Text
                  style={
                    styles.detailLabel
                  }
                >
                  Your description
                </Text>

                <Text
                  style={
                    styles.detailValuePlain
                  }
                >
                  {report.description}
                </Text>
              </>
            ) : null}

            <Text style={styles.detailLabel}>
              Submitted
            </Text>

            <Text style={styles.detailValuePlain}>
              {formatDateTime(
                report.createdAt
              ) || "—"}
            </Text>

            <Text style={styles.detailLabel}>
              Last updated
            </Text>

            <Text style={styles.detailValuePlain}>
              {formatDateTime(
                report.updatedAt
              ) || "—"}
            </Text>
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

  badge: {
    marginTop: 18,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
  },

  badgeText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  outcomeCard: {
    padding: 18,
    borderRadius: 23,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
  },

  outcomeIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  outcomeEyebrow: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.1,
  },

  outcomeLabel: {
    marginTop: 5,
    fontSize: 21,
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

  reportedItemContextRow: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  reportedItemSubtitle: {
    flex: 1,
    color: "rgba(244,208,111,0.88)",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },

  reportedOwnerRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  reportedOwnerAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "rgba(244,208,111,0.58)",
    backgroundColor:
      "rgba(255,255,255,0.06)",
  },

  reportedOwnerAvatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(244,208,111,0.46)",
    backgroundColor:
      "rgba(244,208,111,0.08)",
  },

  reportedItemOwner: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
  },

  reportedOwnerMediaType: {
    marginTop: 2,
    color: "rgba(255,255,255,0.52)",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.8,
  },

  reportedItemPreview: {
    marginTop: 12,
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },

  card: {
    padding: 20,
    borderRadius: 23,
    borderWidth: 1,
    borderColor:
      "rgba(255,255,255,0.11)",
    backgroundColor:
      "rgba(255,255,255,0.045)",
  },

  sectionTitle: {
    color: TEXT,
    fontSize: 19,
    fontWeight: "900",
  },

  timelineHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  timelineStageCount: {
    color: GOLD,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },

  progressTrack: {
    marginTop: 14,
    height: 7,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor:
      "rgba(255,255,255,0.09)",
  },

  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: GOLD,
  },

  timelineBody: {
    marginTop: 20,
  },

  timelineRow: {
    flexDirection: "row",
    minHeight: 62,
  },

  timelineRail: {
    width: 26,
    alignItems: "center",
  },

  timelinePulse: {
    position: "absolute",
    top: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: GOLD,
  },

  timelineDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },

  timelineDotDone: {
    backgroundColor: GOLD,
  },

  timelineDotCurrent: {
    backgroundColor:
      "rgba(244,208,111,0.16)",
    borderWidth: 2,
    borderColor: GOLD,
  },

  timelineLine: {
    flex: 1,
    width: 2,
    marginTop: 2,
    marginBottom: -4,
    alignSelf: "center",
    backgroundColor:
      "rgba(244,208,111,0.4)",
  },

  timelineContent: {
    flex: 1,
    marginLeft: 13,
    paddingBottom: 18,
  },

  timelineLabel: {
    color: TEXT,
    fontSize: 15,
    fontWeight: "800",
  },

  timelineLabelCurrent: {
    color: GOLD,
    fontWeight: "900",
  },

  timelineSubtitle: {
    marginTop: 3,
    color: MUTED,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },

  timelineTime: {
    marginTop: 4,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
    fontWeight: "700",
  },

  summaryRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor:
      "rgba(255,255,255,0.06)",
  },

  summaryIconDone: {
    backgroundColor:
      "rgba(110,231,183,0.13)",
  },

  summaryLabel: {
    flex: 1,
    color: TEXT,
    fontSize: 14,
    fontWeight: "700",
  },

  summaryChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor:
      "rgba(255,255,255,0.07)",
  },

  summaryChipDone: {
    backgroundColor:
      "rgba(110,231,183,0.15)",
  },

  summaryChipText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "900",
  },

  summaryChipTextDone: {
    color: "#6EE7B7",
  },

  decisionReasonLabel: {
    marginTop: 16,
    color: MUTED,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },

  decisionReason: {
    marginTop: 7,
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
  },

  decisionMetaRow: {
    marginTop: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  decisionMetaText: {
    flex: 1,
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
  },

  enforcementCard: {
    padding: 20,
    borderRadius: 23,
    borderWidth: 1,
  },

  enforcementHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  enforcementTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "900",
  },

  enforcementStatusPill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },

  enforcementStatusText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
  },

  enforcementRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  enforcementRowLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  enforcementRowValue: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "800",
  },

  feedbackCard: {
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },

  feedbackText: {
    flex: 1,
    color: "rgba(255,255,255,0.86)",
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
  },

  detailLabel: {
    marginTop: 14,
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

  detailValuePlain: {
    marginTop: 4,
    color: TEXT,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
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
