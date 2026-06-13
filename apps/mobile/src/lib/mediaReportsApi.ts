import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";

export type MediaReportReasonBreakdown = {
  reason: string;
  severity: "critical" | "ai" | "medium" | "low" | "unknown";
  severityLabel: string;
  pendingCount: number;
  uniqueUsers: number;
  uniqueChurches: number;
};

export type MediaReportQueueRow = {
  postId: string;
  churchId: string;
  title: string;
  posterUri?: string;
  videoUrl?: string;
  pendingReportCount: number;
  uniqueReporterCount: number;
  uniqueChurchCount: number;
  primaryReason: string;
  primarySeverity: "critical" | "ai" | "medium" | "low" | "unknown";
  severityLabel: string;
  latestReportAt: string;
  topReasons: string[];
  reasonBreakdown: MediaReportReasonBreakdown[];
  autoHideEligible: boolean;
  hiddenByReports: boolean;
  reports: Array<{
    id: string;
    reason: string;
    details?: string;
    reporterUserId: string;
    reporterChurchId?: string;
    createdAt: string;
  }>;
};

export async function fetchMediaReports(args: {
  userId: string;
  role: string;
  churchId: string;
}): Promise<MediaReportQueueRow[]> {
  const res: any = await apiGet("/api/church/feed/reports", {
    headers: getKristoHeaders({
      userId: args.userId,
      role: args.role as any,
      churchId: args.churchId,
    }),
  });

  if (!res?.ok) {
    throw new Error(String(res?.error || "Failed to load media reports"));
  }

  const items = Array.isArray(res?.data?.items) ? res.data.items : [];
  return items as MediaReportQueueRow[];
}

export async function dismissMediaReport(args: {
  userId: string;
  role: string;
  churchId: string;
  postId: string;
}) {
  const res: any = await apiPost(
    "/api/church/feed/reports",
    { action: "dismiss", postId: args.postId },
    {
      headers: getKristoHeaders({
        userId: args.userId,
        role: args.role as any,
        churchId: args.churchId,
      }),
    }
  );

  if (!res?.ok) {
    throw new Error(String(res?.error || "Failed to dismiss report"));
  }

  return res?.data || {};
}

export async function deleteMediaReportPost(args: {
  userId: string;
  role: string;
  churchId: string;
  postId: string;
}) {
  const res: any = await apiPost(
    "/api/church/feed/reports",
    { action: "delete", postId: args.postId },
    {
      headers: getKristoHeaders({
        userId: args.userId,
        role: args.role as any,
        churchId: args.churchId,
      }),
    }
  );

  if (!res?.ok) {
    throw new Error(String(res?.error || "Failed to delete reported post"));
  }

  return res?.data || {};
}
