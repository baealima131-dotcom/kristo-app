export const FEED_REPORT_REASONS = [
  "Spam",
  "Harassment or Bullying",
  "Hate Speech",
  "Violence",
  "Sexual Content",
  "False Teaching",
  "Copyright Violation",
  "AI-Generated Video or Audio",
  "Other",
] as const;

export type FeedReportReason = (typeof FEED_REPORT_REASONS)[number];

export type FeedReportSeverity = "critical" | "ai" | "medium" | "low" | "unknown";

export function normalizeFeedReportReason(raw: unknown): FeedReportReason | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  return (FEED_REPORT_REASONS as readonly string[]).includes(value)
    ? (value as FeedReportReason)
    : null;
}

export function classifyFeedReportSeverity(reason: string): FeedReportSeverity {
  switch (reason) {
    case "Violence":
    case "Sexual Content":
    case "Hate Speech":
      return "critical";
    case "AI-Generated Video or Audio":
      return "ai";
    case "Harassment or Bullying":
    case "False Teaching":
    case "Copyright Violation":
      return "medium";
    case "Spam":
    case "Other":
      return "low";
    default:
      return "unknown";
  }
}

export function feedReportSeverityLabel(severity: FeedReportSeverity): string {
  switch (severity) {
    case "critical":
      return "Critical";
    case "ai":
      return "AI / deception";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    default:
      return "Report";
  }
}

/** High-risk reasons can auto-hide after cross-church agreement. */
export function isAutoHideEligibleReport(args: {
  severity: FeedReportSeverity;
  uniqueReporterCount: number;
  uniqueChurchCount: number;
  primaryReason: string;
}): boolean {
  const { severity, uniqueReporterCount, uniqueChurchCount, primaryReason } = args;

  if (primaryReason === "False Teaching") {
    return uniqueReporterCount >= 5 && uniqueChurchCount >= 3;
  }

  if (severity === "critical" || severity === "ai") {
    return uniqueReporterCount >= 3 && uniqueChurchCount >= 2;
  }

  if (severity === "medium") {
    return uniqueReporterCount >= 5 && uniqueChurchCount >= 3;
  }

  return false;
}
