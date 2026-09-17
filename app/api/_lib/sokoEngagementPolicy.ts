/**
 * Product engagement and product-safety reports.
 * Distinct from Buyer Protection order cases.
 */

export const COMMENT_MIN = 1;
export const COMMENT_MAX = 500;
export const REPORT_DETAILS_MAX = 800;
export const SHARE_KINDS = ["share_completed", "share_sheet_opened"] as const;

export const PRODUCT_REPORT_REASONS = [
  "Misleading description",
  "Counterfeit item",
  "Prohibited or unsafe product",
  "Fraud or payment concern",
  "Inappropriate content",
  "Seller misconduct",
  "Intellectual-property concern",
  "Other",
] as const;

export type ProductReportReason = (typeof PRODUCT_REPORT_REASONS)[number];
export type ShareKind = (typeof SHARE_KINDS)[number];

export const REASON_CODES: Record<ProductReportReason, string> = {
  "Misleading description": "misleading_description",
  "Counterfeit item": "counterfeit",
  "Prohibited or unsafe product": "prohibited_unsafe",
  "Fraud or payment concern": "fraud_payment",
  "Inappropriate content": "inappropriate",
  "Seller misconduct": "seller_misconduct",
  "Intellectual-property concern": "intellectual_property",
  Other: "other",
};

/** Android Share often reports sharedAction even when the sheet is dismissed. iOS distinguishes completion. */
export const ANDROID_SHARE_LIMITATION =
  "Android may report share_completed when the sheet closes. Do not treat share_sheet_opened as a completed share.";

export const RATE_LIMITS = {
  likeBurst: { limit: 8, windowMs: 10_000 },
  likeMinute: { limit: 40, windowMs: 60_000 },
  saveBurst: { limit: 8, windowMs: 10_000 },
  saveMinute: { limit: 40, windowMs: 60_000 },
  reportUserHour: { limit: 3, windowMs: 60 * 60_000 },
  reportProductHour: { limit: 3, windowMs: 60 * 60_000 },
  commentMinute: { limit: 6, windowMs: 60_000 },
  shareMinute: { limit: 8, windowMs: 60_000 },
} as const;

export type ReportStatus = "open" | "assigned" | "escalated" | "dismissed" | "resolved";

export const REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  open: ["assigned", "escalated", "dismissed", "resolved"],
  assigned: ["escalated", "dismissed", "resolved"],
  escalated: ["assigned", "dismissed", "resolved"],
  dismissed: [],
  resolved: [],
};

const LEGACY_REASON_MAP: Record<string, ProductReportReason> = {
  "Misleading information": "Misleading description",
  "Counterfeit product": "Counterfeit item",
  "Prohibited product": "Prohibited or unsafe product",
  "Unsafe product": "Prohibited or unsafe product",
  "Stolen product": "Prohibited or unsafe product",
  "Scam or fraud": "Fraud or payment concern",
  Harassment: "Inappropriate content",
  Other: "Other",
};

export function canonicalProductReportReason(value: unknown): ProductReportReason | null {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if ((PRODUCT_REPORT_REASONS as readonly string[]).includes(text)) {
    return text as ProductReportReason;
  }
  return LEGACY_REASON_MAP[text] || null;
}

export function productReportReasonCode(value: unknown) {
  const reason = canonicalProductReportReason(value);
  return reason ? REASON_CODES[reason] : null;
}

export function normalizeReportStatus(value: unknown): ReportStatus {
  const text = String(value || "").trim();
  if (text === "assigned" || text === "escalated" || text === "dismissed" || text === "resolved") {
    return text;
  }
  return "open";
}

export function canTransitionReport(from: unknown, to: ReportStatus) {
  const current = normalizeReportStatus(from);
  return REPORT_TRANSITIONS[current].includes(to);
}

export function actionTargetStatus(action: string): ReportStatus | null {
  if (action === "assign") return "assigned";
  if (action === "escalate") return "escalated";
  if (action === "dismiss") return "dismissed";
  if (action === "resolve" || action === "restrict_listing") return "resolved";
  return null;
}

type RateBucket = { key: string; windowStart: number; hits: number };

export function consumeRateLimit(
  buckets: RateBucket[],
  key: string,
  now: number,
  limit: number,
  windowMs: number
) {
  const next = buckets.filter((bucket) => now - bucket.windowStart < windowMs);
  const current = next.find((bucket) => bucket.key === key);
  if (!current) {
    next.push({ key, windowStart: now, hits: 1 });
    return { allowed: true, buckets: next };
  }
  if (current.hits >= limit) return { allowed: false, buckets: next };
  current.hits += 1;
  return { allowed: true, buckets: next };
}

export function claimOpenProductReport(
  open: Map<string, string>,
  key: string,
  reportId: string
) {
  const existing = open.get(key);
  if (existing) return { created: false, reportId: existing };
  open.set(key, reportId);
  return { created: true, reportId };
}

export function cleanCommentBody(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length < COMMENT_MIN || text.length > COMMENT_MAX) return null;
  return text;
}

export function cleanReportDetails(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, REPORT_DETAILS_MAX);
  return text;
}

export function parseShareKind(value: unknown): ShareKind | null {
  const text = String(value || "").trim();
  return (SHARE_KINDS as readonly string[]).includes(text) ? (text as ShareKind) : null;
}

export function publicShareLabel(completedShares: number) {
  if (completedShares <= 0) return "Share";
  return String(completedShares);
}

export type PublicCommentAuthor = {
  displayName: string | null;
  kristoId: string | null;
  avatarUrl: string | null;
};

/** Public comment shape. Flags are server comparisons; never echo author.userId or a client role. */
export function publicProductComment(input: {
  id: string;
  body: string;
  createdAt: string;
  authorUserId: string;
  displayName: string | null;
  kristoId: string | null;
  avatarUrl: string | null;
  viewerUserId?: string;
  viewerCanModerate?: boolean;
}) {
  const viewerUserId = String(input.viewerUserId || "").trim();
  const authorUserId = String(input.authorUserId || "").trim();
  const own = Boolean(viewerUserId) && viewerUserId === authorUserId;
  const author: PublicCommentAuthor = {
    displayName: input.displayName,
    kristoId: input.kristoId,
    avatarUrl: input.avatarUrl,
  };
  return {
    id: input.id,
    body: input.body,
    createdAt: input.createdAt,
    author,
    viewerCanDelete: own,
    viewerCanHide: Boolean(input.viewerCanModerate) && Boolean(viewerUserId) && !own,
  };
}

export function reportPriority(reason: ProductReportReason) {
  if (reason === "Prohibited or unsafe product") return "critical" as const;
  if (
    reason === "Fraud or payment concern" ||
    reason === "Seller misconduct" ||
    reason === "Inappropriate content"
  ) {
    return "high" as const;
  }
  if (reason === "Counterfeit item" || reason === "Intellectual-property concern") {
    return "normal" as const;
  }
  return "low" as const;
}

export function isOpenReportStatus(status: unknown) {
  const text = String(status || "").trim();
  return text !== "resolved" && text !== "dismissed";
}

/** In-memory uniqueness used by tests and mirrored by SQL unique constraints. */
export function applyUniqueToggle(
  rows: Array<{ productId: string; userId: string }>,
  productId: string,
  userId: string,
  active: boolean
) {
  const key = `${productId}\0${userId}`;
  const next = rows.filter((row) => `${row.productId}\0${row.userId}` !== key);
  if (active) next.push({ productId, userId });
  return {
    rows: next,
    count: next.filter((row) => row.productId === productId).length,
    active: next.some((row) => row.productId === productId && row.userId === userId),
  };
}

export function productReportCopy() {
  return "Reporting sends this listing to SOKO’s safety team. It does not cancel an order or guarantee removal or refund.";
}
