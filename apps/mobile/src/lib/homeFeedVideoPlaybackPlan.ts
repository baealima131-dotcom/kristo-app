import {
  homeFeedMediaUrl,
  inferPreviewVideoUriFromVideoUrl,
  resolveVideoUri,
} from "@/components/homeFeed/homeFeedUtils";
import { wasHomeFeedVideoUrlBufferedAhead } from "@/lib/homeFeedVideoWarmRegistry";

export type HomeFeedVideoPlaybackPlan = {
  postId: string;
  originalVideoUrl: string;
  fullQualityUri: string;
  startupUri: string;
  lowResVideoUrl: string | null;
  hasLowRes: boolean;
  prewarmHit: boolean;
};

function normalizeUrl(url: string) {
  return String(url || "").trim().split("?")[0];
}

export function resolveHomeFeedVideoPlaybackPlan(item: any): HomeFeedVideoPlaybackPlan {
  const postId = String(item?.id || "").trim();
  const originalVideoUrl = resolveVideoUri(item);
  const fullQualityUri = homeFeedMediaUrl(originalVideoUrl) || originalVideoUrl;

  const explicitLow = homeFeedMediaUrl(
    item?.lowResVideoUrl || item?.previewVideoUrl || ""
  );
  const inferredLow = inferPreviewVideoUriFromVideoUrl(fullQualityUri);
  const lowResCandidate = explicitLow || inferredLow;
  const hasLowRes = Boolean(
    lowResCandidate && normalizeUrl(lowResCandidate) !== normalizeUrl(fullQualityUri)
  );
  const startupUri = hasLowRes ? lowResCandidate : fullQualityUri;
  const prewarmHit =
    wasHomeFeedVideoUrlBufferedAhead(startupUri) ||
    wasHomeFeedVideoUrlBufferedAhead(fullQualityUri);

  return {
    postId,
    originalVideoUrl: fullQualityUri,
    fullQualityUri,
    startupUri,
    lowResVideoUrl: hasLowRes ? lowResCandidate : null,
    hasLowRes,
    prewarmHit,
  };
}

export function logHomeFeedVideoQualityTrace(payload: Record<string, unknown>) {
  console.log("KRISTO_HOME_FEED_VIDEO_QUALITY_TRACE", {
    ts: Date.now(),
    ...payload,
  });
}

export function getFirstHomeFeedVideoPlaybackPlans(
  rows: any[],
  maxCount = 2
): HomeFeedVideoPlaybackPlan[] {
  const plans: HomeFeedVideoPlaybackPlan[] = [];
  for (const row of rows) {
    if (!row) continue;
    const videoUrl = resolveVideoUri(row);
    if (!videoUrl) continue;
    plans.push(resolveHomeFeedVideoPlaybackPlan(row));
    if (plans.length >= maxCount) break;
  }
  return plans;
}
