import type { MediaVideoUploadStatus } from "@/src/lib/optimisticVideoUpload";
import {
  clampVisibleUploadProgress,
  mapChunkToVisibleProgress,
  VISIBLE_UPLOAD_PROGRESS,
} from "@/src/lib/videoUploadProgress";

export type UploadSmoothingPhase = MediaVideoUploadStatus | "idle";

export type UploadProgressSmoothingMeta = {
  realProgress?: number;
  chunkCompleted?: number;
  chunkTotal?: number;
  partUploading?: boolean;
};

const PART_GAP_CREEP_RATIO = 0.85;
const COMPRESS_CREEP_MAX = 7;
const FINALIZE_CREEP_MAX = 4;

/** Interpolates discrete upload milestones into continuous visible progress. */
export class UploadProgressSmoother {
  private displayed = 1;
  private realTarget = 1;
  private phase: UploadSmoothingPhase = "preparing";
  private chunkCompleted = 0;
  private chunkTotal = 0;
  private partInFlight = false;
  private lastRealAt = Date.now();
  private complete = false;

  reset() {
    this.displayed = 1;
    this.realTarget = 1;
    this.phase = "preparing";
    this.chunkCompleted = 0;
    this.chunkTotal = 0;
    this.partInFlight = false;
    this.lastRealAt = Date.now();
    this.complete = false;
  }

  markComplete() {
    this.complete = true;
    this.realTarget = 100;
    this.phase = "done";
  }

  ingest(
    realProgress: number,
    phase: UploadSmoothingPhase,
    meta?: UploadProgressSmoothingMeta
  ) {
    if (this.complete) return;
    if (realProgress <= 0) return;

    const real = clampVisibleUploadProgress(realProgress);
    this.realTarget = Math.max(this.realTarget, real);
    if (phase !== "idle") {
      this.phase = phase;
    }
    this.lastRealAt = Date.now();

    if (typeof meta?.chunkCompleted === "number") {
      this.chunkCompleted = Math.max(this.chunkCompleted, meta.chunkCompleted);
    }
    if (typeof meta?.chunkTotal === "number" && meta.chunkTotal > 0) {
      this.chunkTotal = meta.chunkTotal;
    }
    if (typeof meta?.partUploading === "boolean") {
      this.partInFlight = meta.partUploading;
    }

    this.displayed = Math.max(this.displayed, 1);
  }

  private computeSoftCap(now: number): number {
    if (this.complete) return 100;

    const elapsed = now - this.lastRealAt;

    if (this.phase === "uploading" && this.chunkTotal > 0) {
      const completed = this.chunkCompleted;
      const total = this.chunkTotal;
      const floor = mapChunkToVisibleProgress((completed / total) * 100);
      const nextCompleted = Math.min(completed + 1, total);
      const nextFloor = mapChunkToVisibleProgress((nextCompleted / total) * 100);
      const gapCap =
        completed >= total
          ? VISIBLE_UPLOAD_PROGRESS.chunkMax - 1
          : floor + (nextFloor - floor) * PART_GAP_CREEP_RATIO;

      const creepMs = this.partInFlight ? 14000 : 9000;
      const creepT = Math.min(1, elapsed / creepMs);
      const creeped = floor + (gapCap - floor) * creepT;
      return Math.min(99, Math.max(this.realTarget, creeped));
    }

    if (this.phase === "preparing" || this.phase === "optimizing") {
      const creep = Math.min(COMPRESS_CREEP_MAX, elapsed / 420);
      const cap = Math.min(
        VISIBLE_UPLOAD_PROGRESS.compressMax - 1,
        this.realTarget + creep
      );
      return Math.min(99, Math.max(this.realTarget, cap));
    }

    if (this.phase === "finalizing" || this.phase === "processing") {
      const creep = Math.min(FINALIZE_CREEP_MAX, elapsed / 550);
      return Math.min(99, Math.max(this.realTarget, this.realTarget + creep));
    }

    return Math.min(99, this.realTarget + 1);
  }

  tick(dtMs: number) {
    const now = Date.now();
    const softCap = this.computeSoftCap(now);
    const target = this.complete ? 100 : Math.min(softCap, 99);

    if (this.displayed >= target) {
      if (this.complete && this.displayed < 100) {
        this.displayed = Math.min(100, this.displayed + Math.max(0.35, dtMs / 90));
      }
      return;
    }

    const gap = target - this.displayed;
    const step = Math.max(0.1, Math.min(2.6, gap * 0.055 + 0.07)) * (dtMs / 100);
    this.displayed = Math.min(target, this.displayed + step);
    this.displayed = Math.max(1, this.displayed);
  }

  getRoundedDisplayed() {
    if (this.complete) {
      return Math.min(100, Math.max(1, Math.round(this.displayed)));
    }
    return Math.max(1, Math.min(99, Math.round(this.displayed)));
  }

  getPhase() {
    return this.phase;
  }
}

export function uploadProgressStatusLabel(
  phase: UploadSmoothingPhase | MediaVideoUploadStatus
): string {
  switch (phase) {
    case "preparing":
      return "Preparing video…";
    case "optimizing":
      return "Optimizing video…";
    case "uploading":
      return "Uploading video…";
    case "finalizing":
    case "processing":
      return "Finalizing post…";
    case "done":
      return "Done";
    case "posted_refreshing":
      return "Finalizing post…";
    default:
      return "Uploading video…";
  }
}

export function mapJobPhaseToSmoothingPhase(
  phase: string
): UploadSmoothingPhase {
  if (phase === "preparing") return "preparing";
  if (phase === "optimizing") return "optimizing";
  if (phase === "uploading") return "uploading";
  if (phase === "finalizing") return "finalizing";
  if (phase === "processing") return "finalizing";
  if (phase === "ready") return "done";
  if (phase === "paused") return "paused";
  if (phase === "failed") return "failed";
  return "uploading";
}
