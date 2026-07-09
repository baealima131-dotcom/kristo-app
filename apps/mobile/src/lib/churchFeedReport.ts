import { apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { HOME_FEED_REPORT_REASONS, type HomeFeedReportReason } from "@/src/lib/homeFeedReport";
import { normalizeFeedChurchId } from "@/src/lib/homeFeedModeration";

export { HOME_FEED_REPORT_REASONS, type HomeFeedReportReason };

export async function submitChurchReport(input: {
  churchId: string;
  reason: HomeFeedReportReason;
  details?: string;
}) {
  const churchId = normalizeFeedChurchId(input.churchId);
  if (!churchId) {
    return { ok: false as const, error: "Missing church id" };
  }

  const session = getSessionSync() as any;
  if (!session?.userId) {
    return { ok: false as const, error: "Sign in to report churches" };
  }

  try {
    const res: any = await apiPost(
      "/api/church/feed/report-church",
      {
        churchId,
        reason: input.reason,
        details: String(input.details || "").trim(),
        reporterUserId: session.userId,
      },
      {
        headers: getKristoHeaders({
          userId: session.userId,
          role: (session.role || "Member") as any,
          churchId: session.churchId || "",
        }),
      }
    );

    if (!res?.ok) {
      return { ok: false as const, error: String(res?.error || "Failed to submit report") };
    }

    return { ok: true as const };
  } catch (error: any) {
    return { ok: false as const, error: String(error?.message || "Failed to submit report") };
  }
}
