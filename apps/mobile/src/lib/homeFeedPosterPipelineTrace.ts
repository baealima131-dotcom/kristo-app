import { resolveYouTubeFeedMetadataPosterUri } from "@/src/components/homeFeed/homeFeedUtils";

export type HomeFeedPosterPipelineStage =
  | "api_row_received"
  | "poster_url_resolved"
  | "prefetch_started"
  | "card_mounted"
  | "image_component_mounted"
  | "image_request_started"
  | "image_loaded"
  | "first_poster_painted";

type TraceEntry = {
  postId: string;
  stages: Partial<Record<HomeFeedPosterPipelineStage, number>>;
  posterUri?: string;
  rowIndex?: number;
};

const traces = new Map<string, TraceEntry>();
let firstPosterPaintedLogged = false;

export function homeFeedPosterTraceKey(postId: string, videoUrl?: string) {
  const pid = String(postId || "").trim();
  const video = String(videoUrl || "").trim().split("?")[0];
  return `${pid}|${video}`;
}

function resolveRowVideoUrl(row: any): string {
  return String(row?.videoUrl || row?.mediaUrl || row?.videoUri || row?.localVideoUri || "").trim();
}

function buildDeltas(entry: TraceEntry, stage: HomeFeedPosterPipelineStage, now: number) {
  const apiAt = entry.stages.api_row_received;
  const deltas: Record<string, number | null> = {
    msSinceApi: apiAt != null ? now - apiAt : null,
  };
  if (stage !== "api_row_received" && apiAt != null) {
    for (const [name, ts] of Object.entries(entry.stages)) {
      if (name === stage || ts == null) continue;
      deltas[`msSince_${name}`] = now - ts;
    }
  }
  return deltas;
}

export function markHomeFeedPosterPipelineStage(
  postId: string,
  stage: HomeFeedPosterPipelineStage,
  extra?: {
    posterUri?: string;
    videoUrl?: string;
    rowIndex?: number;
    source?: string;
  }
) {
  const pid = String(postId || "").trim();
  if (!pid) return;

  const key = homeFeedPosterTraceKey(pid, extra?.videoUrl);
  let entry = traces.get(key);
  if (!entry) {
    entry = { postId: pid, stages: {} };
    traces.set(key, entry);
  }

  if (entry.stages[stage] != null) return;

  const now = Date.now();
  entry.stages[stage] = now;
  if (extra?.posterUri) entry.posterUri = extra.posterUri;
  if (typeof extra?.rowIndex === "number") entry.rowIndex = extra.rowIndex;

  const deltas = buildDeltas(entry, stage, now);
  const payload = {
    stage,
    postId: pid,
    rowIndex: extra?.rowIndex ?? entry.rowIndex ?? null,
    posterUri: extra?.posterUri ?? entry.posterUri ?? null,
    source: extra?.source ?? null,
    ts: now,
    ...deltas,
  };

  console.log("KRISTO_POSTER_PIPELINE_TRACE", payload);

  if (stage === "first_poster_painted" && !firstPosterPaintedLogged) {
    firstPosterPaintedLogged = true;
    console.log("KRISTO_POSTER_PIPELINE_FIRST_PAINT", payload);
    void import("@/src/lib/homeFeedStartupTiming").then(({ markHomeFeedStartupTiming }) => {
      markHomeFeedStartupTiming("FIRST_POSTER_VISIBLE_TS", {
        postId: pid,
        rowIndex: extra?.rowIndex ?? entry.rowIndex ?? null,
      });
    });
  }
}

/** Called as soon as feed API rows are available — starts poster download before cards mount. */
export function markHomeFeedPosterApiRowsReceived(rows: any[]) {
  if (!Array.isArray(rows) || !rows.length) return;

  rows.forEach((row, index) => {
    const postId = String(row?.id || "").trim();
    const videoUrl = resolveRowVideoUrl(row);
    if (!postId) return;

    markHomeFeedPosterPipelineStage(postId, "api_row_received", {
      videoUrl,
      rowIndex: index,
      source: "home_feed_api",
    });

    const posterUri = resolveYouTubeFeedMetadataPosterUri(row, postId, videoUrl);
    if (posterUri) {
      markHomeFeedPosterPipelineStage(postId, "poster_url_resolved", {
        posterUri,
        videoUrl,
        rowIndex: index,
        source: "api_metadata_sync",
      });
    }
  });

  void import("@/src/lib/homeFeedPosterPrewarm").then(({ prefetchHomeFeedPosterMetadata }) => {
    for (const row of rows) {
      prefetchHomeFeedPosterMetadata(row);
    }
  });
}

export function resetHomeFeedPosterPipelineTrace() {
  traces.clear();
  firstPosterPaintedLogged = false;
}
