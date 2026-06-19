import type { HomeFeedVideoPlaybackPlan } from "@/lib/homeFeedVideoPlaybackPlan";

export type { HomeFeedVideoPlaybackPlan } from "@/lib/homeFeedVideoPlaybackPlan";
export {
  getFirstHomeFeedVideoPlaybackPlans,
  logHomeFeedVideoQualityTrace,
  resolveHomeFeedVideoPlaybackPlan,
} from "@/lib/homeFeedVideoPlaybackPlan";

const verifiedLowResUrls = new Map<string, boolean>();
const failedLowResPreviewUrls = new Set<string>();

export function markHomeFeedLowResPreviewFailed(previewUrl: string) {
  const url = normalizeUrl(previewUrl);
  if (!url) return;
  failedLowResPreviewUrls.add(url);
}

export function isHomeFeedLowResPreviewFailed(previewUrl: string) {
  return failedLowResPreviewUrls.has(normalizeUrl(previewUrl));
}

function normalizeUrl(url: string) {
  return String(url || "").trim().split("?")[0];
}

export async function resolveVerifiedStartupVideoUri(
  plan: HomeFeedVideoPlaybackPlan
): Promise<string> {
  return verifyHomeFeedStartupPlaybackUri(plan);
}

/** Pick the startup URI the player should mount with (sync when HEAD result is cached). */
export function resolveInitialStartupPlaybackUri(plan: HomeFeedVideoPlaybackPlan): string {
  if (!plan.hasLowRes || !plan.lowResVideoUrl) {
    return plan.fullQualityUri;
  }

  const preview = plan.lowResVideoUrl;
  const cached = verifiedLowResUrls.get(preview);
  if (cached === true) return preview;
  if (cached === false) return plan.fullQualityUri;
  return plan.startupUri;
}

export async function verifyHomeFeedStartupPlaybackUri(
  plan: HomeFeedVideoPlaybackPlan
): Promise<string> {
  if (!plan.hasLowRes || !plan.lowResVideoUrl) {
    return plan.fullQualityUri;
  }

  const preview = plan.lowResVideoUrl;
  const cached = verifiedLowResUrls.get(preview);
  if (cached === true) return preview;
  if (cached === false) return plan.fullQualityUri;

  try {
    const head = await fetch(preview, { method: "HEAD" });
    if (head.ok || head.status === 206) {
      verifiedLowResUrls.set(preview, true);
      return preview;
    }
  } catch {}

  verifiedLowResUrls.set(preview, false);
  return plan.fullQualityUri;
}
