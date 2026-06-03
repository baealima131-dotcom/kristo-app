import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiGet, apiPost } from "@/src/lib/kristoApi";
import { getKristoHeaders } from "@/src/lib/kristoHeaders";
import { getSessionSync } from "@/src/lib/kristoSession";
import { baseFeedId } from "@/src/lib/scheduleSlotUtils";

export const HOME_FEED_REPORT_REASONS = [
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

export type HomeFeedReportReason = (typeof HOME_FEED_REPORT_REASONS)[number];

const REPORTED_CACHE_KEY = "kristo_home_feed_reported_v1";

function cleanPostId(raw: unknown) {
  return baseFeedId(String(raw || "").trim());
}

async function readReportedCache(): Promise<Record<string, true>> {
  try {
    const raw = await AsyncStorage.getItem(REPORTED_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

async function writeReportedCache(map: Record<string, true>) {
  try {
    await AsyncStorage.setItem(REPORTED_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

export async function markPostReportedLocally(postId: string) {
  const id = cleanPostId(postId);
  if (!id) return;
  const cache = await readReportedCache();
  cache[id] = true;
  await writeReportedCache(cache);
}

export async function getLocallyReportedPostIds() {
  const cache = await readReportedCache();
  return Object.keys(cache);
}

export async function isPostReportedLocally(postId: string) {
  const id = cleanPostId(postId);
  if (!id) return false;
  const cache = await readReportedCache();
  return Boolean(cache[id]);
}

export async function syncReportedPostIdsFromApi(postIds: string[]) {
  const ids = postIds.map(cleanPostId).filter(Boolean);
  if (!ids.length) return [] as string[];

  const session = getSessionSync() as any;
  if (!session?.userId) return [];

  try {
    const res: any = await apiGet(
      `/api/church/feed/report?postIds=${encodeURIComponent(ids.join(","))}`,
      {
        headers: getKristoHeaders({
          userId: session.userId,
          role: (session.role || "Member") as any,
          churchId: session.churchId || "",
        }),
      },
      { screen: "HomeFeedReport", throttleMs: 0 }
    );

    const reported = Array.isArray(res?.data?.reportedPostIds)
      ? res.data.reportedPostIds.map(cleanPostId).filter(Boolean)
      : [];

    if (reported.length) {
      const cache = await readReportedCache();
      for (const id of reported) cache[id] = true;
      await writeReportedCache(cache);
    }

    return reported;
  } catch {
    return [];
  }
}

export async function fetchPostReportStatus(postId: string) {
  const id = cleanPostId(postId);
  if (!id) return { reported: false, alreadyReported: false };

  if (await isPostReportedLocally(id)) {
    return { reported: true, alreadyReported: true };
  }

  const session = getSessionSync() as any;
  if (!session?.userId) return { reported: false, alreadyReported: false };

  try {
    const res: any = await apiGet(
      `/api/church/feed/report?postId=${encodeURIComponent(id)}`,
      {
        headers: getKristoHeaders({
          userId: session.userId,
          role: (session.role || "Member") as any,
          churchId: session.churchId || "",
        }),
      },
      { screen: "HomeFeedReport", throttleMs: 0 }
    );

    const reported = Boolean(res?.data?.reported || res?.data?.alreadyReported);
    if (reported) await markPostReportedLocally(id);
    return { reported, alreadyReported: reported };
  } catch {
    return { reported: false, alreadyReported: false };
  }
}

export type SubmitHomeFeedReportResult =
  | { ok: true; alreadyReported: boolean; duplicate: boolean }
  | { ok: false; error: string };

export async function submitHomeFeedReport(input: {
  postId: string;
  reason: HomeFeedReportReason;
  details?: string;
}): Promise<SubmitHomeFeedReportResult> {
  const postId = cleanPostId(input.postId);
  if (!postId) return { ok: false, error: "Missing post id" };

  const session = getSessionSync() as any;
  if (!session?.userId) return { ok: false, error: "Sign in to report posts" };

  console.log("KRISTO_REPORT_SUBMIT", { postId, reason: input.reason });

  try {
    const res: any = await apiPost(
      "/api/church/feed/report",
      {
        postId,
        reporterUserId: session.userId,
        reason: input.reason,
        details: String(input.details || "").trim(),
        createdAt: new Date().toISOString(),
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
      console.log("KRISTO_REPORT_FAILED", { postId, error: res?.error });
      return { ok: false, error: String(res?.error || "Report failed") };
    }

    const alreadyReported = Boolean(res?.alreadyReported || res?.duplicate);
    if (alreadyReported) {
      console.log("KRISTO_REPORT_DUPLICATE", { postId });
    } else {
      console.log("KRISTO_REPORT_SUCCESS", { postId });
    }

    await markPostReportedLocally(postId);
    return { ok: true, alreadyReported, duplicate: alreadyReported };
  } catch (error: any) {
    console.log("KRISTO_REPORT_FAILED", {
      postId,
      message: String(error?.message || error),
    });
    return { ok: false, error: String(error?.message || "Report failed") };
  }
}
