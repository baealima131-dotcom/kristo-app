import { resolveSavedFeedVideoPosterUri } from "@/src/lib/homeFeedPosterSavedUri";
import { resolveStablePosterVideoUrl, resolveVideoUri } from "@/src/lib/homeFeedVideoUri";
import {
  isMediaPosterCacheHydrated,
  mediaPosterCacheKey,
  peekCachedMediaPoster,
  peekCachedMediaPosterByPostId,
  resolveCachedMediaPoster,
} from "@/src/lib/mediaPosterCache";

export type PosterRegenerationReason =
  | "cache-miss"
  | "metadata-miss"
  | "alias-miss"
  | "satisfied-reset"
  | "hydration-reset"
  | "feed-reload"
  | "visible-window-change"
  | "unknown";

type SessionSatisfiedMeta = {
  at: number;
  reason: string;
  posterUri?: string;
};

const sessionSatisfiedPostIds = new Set<string>();
const sessionGeneratedDonePostIds = new Set<string>();
const sessionGenerationCountByPostId = new Map<string, number>();
const sessionSatisfiedMeta = new Map<string, SessionSatisfiedMeta>();

let lastPosterFeedKey = "";
let lastPosterVisibleSignature = "";
let pendingVisibleWindowChanged = false;

export function consumePosterVisibleWindowChanged(): boolean {
  const changed = pendingVisibleWindowChanged;
  pendingVisibleWindowChanged = false;
  return changed;
}

export function isPosterPostIdSessionSatisfied(postId: string): boolean {
  return sessionSatisfiedPostIds.has(String(postId || "").trim());
}

export function isPosterPostIdSessionGenerated(postId: string): boolean {
  return sessionGeneratedDonePostIds.has(String(postId || "").trim());
}

export function getPosterSessionGenerationCount(postId: string): number {
  return sessionGenerationCountByPostId.get(String(postId || "").trim()) || 0;
}

export function markPosterPostIdSessionSatisfied(
  postId: string,
  reason: string,
  extra: { posterUri?: string } = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;
  sessionSatisfiedPostIds.add(id);
  sessionSatisfiedMeta.set(id, {
    at: Date.now(),
    reason,
    posterUri: extra.posterUri,
  });
}

export function markPosterPostIdSessionGenerated(
  postId: string,
  extra: { posterUri?: string; source?: string } = {}
) {
  const id = String(postId || "").trim();
  if (!id) return;
  sessionGeneratedDonePostIds.add(id);
  markPosterPostIdSessionSatisfied(id, extra.source || "generated-done", {
    posterUri: extra.posterUri,
  });
}

export function notePosterFeedKeyChanged(feedKey: string): boolean {
  const key = String(feedKey || "").trim();
  if (!key) return false;
  const changed = Boolean(lastPosterFeedKey) && lastPosterFeedKey !== key;
  lastPosterFeedKey = key;
  return changed;
}

export function notePosterVisibleSignatureChanged(signature: string): boolean {
  const sig = String(signature || "").trim();
  if (!sig) return false;
  const changed = Boolean(lastPosterVisibleSignature) && lastPosterVisibleSignature !== sig;
  lastPosterVisibleSignature = sig;
  pendingVisibleWindowChanged = changed;
  return changed;
}

export function classifyPosterRegenerationReasons(
  item: any,
  context: string,
  opts: {
    keySatisfied?: boolean;
    feedReloaded?: boolean;
    visibleWindowChanged?: boolean;
  } = {}
): PosterRegenerationReason[] {
  const postId = String(item?.id || "").trim();
  const stableVideoUrl = resolveStablePosterVideoUrl(item);
  const playbackVideoUrl = resolveVideoUri(item);
  const cachedStable = resolveCachedMediaPoster(postId, stableVideoUrl);
  const cachedPlayback = resolveCachedMediaPoster(postId, playbackVideoUrl);
  const cachedByPostId = peekCachedMediaPosterByPostId(postId);
  const exactStable = peekCachedMediaPoster(postId, stableVideoUrl);
  const metadataPoster = resolveSavedFeedVideoPosterUri(item, stableVideoUrl);
  const reasons: PosterRegenerationReason[] = [];

  if (!cachedStable && !cachedByPostId) reasons.push("cache-miss");
  if (!metadataPoster) reasons.push("metadata-miss");
  if (!exactStable && !cachedByPostId && (cachedStable || cachedPlayback)) {
    reasons.push("alias-miss");
  }
  if (isPosterPostIdSessionSatisfied(postId) && opts.keySatisfied === false) {
    reasons.push("satisfied-reset");
  }
  if (!isMediaPosterCacheHydrated()) reasons.push("hydration-reset");
  if (opts.feedReloaded) reasons.push("feed-reload");
  if (opts.visibleWindowChanged) reasons.push("visible-window-change");

  if (!reasons.length) {
    if (context.includes("duplicate") || isPosterPostIdSessionGenerated(postId)) {
      reasons.push("unknown");
    }
  }

  return reasons;
}

export function buildPosterSessionDiag(item: any) {
  const postId = String(item?.id || "").trim();
  const stableVideoUrl = resolveStablePosterVideoUrl(item);
  const playbackVideoUrl = resolveVideoUri(item);

  return {
    postId: postId || null,
    stableVideoUrl: stableVideoUrl || null,
    playbackVideoUrl: playbackVideoUrl || null,
    cacheKeyStable: mediaPosterCacheKey(postId, stableVideoUrl) || null,
    cacheKeyPlayback: mediaPosterCacheKey(postId, playbackVideoUrl) || null,
    cachedStable: resolveCachedMediaPoster(postId, stableVideoUrl) || null,
    cachedPlayback: resolveCachedMediaPoster(postId, playbackVideoUrl) || null,
    cachedByPostId: peekCachedMediaPosterByPostId(postId) || null,
    sessionSatisfied: isPosterPostIdSessionSatisfied(postId),
    sessionGeneratedDone: isPosterPostIdSessionGenerated(postId),
    sessionGenerationCount: getPosterSessionGenerationCount(postId),
    cacheHydrated: isMediaPosterCacheHydrated(),
    lastFeedKey: lastPosterFeedKey || null,
    lastVisibleSignature: lastPosterVisibleSignature || null,
    satisfiedMeta: sessionSatisfiedMeta.get(postId) || null,
  };
}

/** Returns false when a satisfied/generated post must not enter POSTER_VISIBLE_MISSING. */
export function assertPosterVisibleMissingAllowed(item: any, context: string): boolean {
  const postId = String(item?.id || "").trim();
  if (!postId) return true;
  if (!isPosterPostIdSessionSatisfied(postId) && !isPosterPostIdSessionGenerated(postId)) {
    return true;
  }

  const reasons = classifyPosterRegenerationReasons(item, context, {
    keySatisfied: false,
  });

  console.log("POSTER_VISIBLE_MISSING_AFTER_SATISFIED", {
    context,
    reasons,
    ...buildPosterSessionDiag(item),
  });
  return false;
}

export function recordPosterVisibleGenerationAttempt(
  item: any,
  context: string,
  opts: {
    keySatisfied?: boolean;
    feedReloaded?: boolean;
    visibleWindowChanged?: boolean;
  } = {}
): { attempt: number; duplicate: boolean; blocked: boolean } {
  const postId = String(item?.id || "").trim();
  if (!postId) return { attempt: 0, duplicate: false, blocked: false };

  const prev = sessionGenerationCountByPostId.get(postId) || 0;
  const attempt = prev + 1;
  const duplicate =
    prev > 0 || isPosterPostIdSessionGenerated(postId) || isPosterPostIdSessionSatisfied(postId);

  if (duplicate) {
    const reasons = classifyPosterRegenerationReasons(item, context, opts);
    console.log("POSTER_VISIBLE_DUPLICATE_GENERATE", {
      context,
      attempt,
      reasons,
      ...buildPosterSessionDiag(item),
    });
    return { attempt, duplicate: true, blocked: true };
  }

  sessionGenerationCountByPostId.set(postId, attempt);
  return { attempt, duplicate: false, blocked: false };
}

/** Hard block: never frame-generate again for a postId satisfied this session. */
export function shouldBlockPosterFrameGeneration(item: any, context: string): boolean {
  const postId = String(item?.id || "").trim();
  if (!postId) return false;
  if (!isPosterPostIdSessionSatisfied(postId) && !isPosterPostIdSessionGenerated(postId)) {
    return false;
  }

  const videoUrl = resolveStablePosterVideoUrl(item);
  const cached =
    resolveCachedMediaPoster(postId, videoUrl) || peekCachedMediaPosterByPostId(postId);
  if (cached) return true;

  console.log("POSTER_VISIBLE_GENERATE_BLOCKED", {
    context,
    reasons: classifyPosterRegenerationReasons(item, context, { keySatisfied: false }),
    ...buildPosterSessionDiag(item),
  });
  return true;
}
