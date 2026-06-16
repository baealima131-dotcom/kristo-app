import { useEffect, useRef, useState } from "react";
import type { PersistedMediaUploadJob } from "@/src/lib/mediaUploadJobStore";
import {
  mapJobPhaseToSmoothingPhase,
  UploadProgressSmoother,
  uploadProgressStatusLabel,
} from "@/src/lib/videoUploadProgressSmoothing";

export function useSmoothedJobUploadProgress(job: PersistedMediaUploadJob) {
  const smootherRef = useRef<UploadProgressSmoother | null>(null);
  if (!smootherRef.current) {
    smootherRef.current = new UploadProgressSmoother();
  }
  const smoother = smootherRef.current;

  const [displayedPercent, setDisplayedPercent] = useState(1);
  const phase = mapJobPhaseToSmoothingPhase(job.phase);
  const isActive =
    job.phase !== "ready" && job.phase !== "failed" && job.phase !== "paused";

  useEffect(() => {
    if (job.phase === "ready") {
      smoother.markComplete();
      return;
    }

    const real = Math.max(1, Math.round(job.uploadProgress || 1));
    smoother.ingest(real, phase, {
      chunkCompleted: job.uploadedChunkIndexes?.length ?? 0,
      chunkTotal: job.totalChunks ?? 0,
      partUploading: job.phase === "uploading",
    });
  }, [
    job.uploadProgress,
    job.phase,
    job.uploadedChunkIndexes?.length,
    job.totalChunks,
    phase,
    smoother,
  ]);

  useEffect(() => {
    if (!isActive && job.phase !== "ready") return;

    let raf = 0;
    let last = Date.now();

    const loop = () => {
      const now = Date.now();
      smoother.tick(now - last);
      last = now;
      setDisplayedPercent(smoother.getRoundedDisplayed());
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isActive, job.jobId, job.phase, smoother]);

  return {
    displayedPercent: job.phase === "ready" ? 100 : Math.max(1, displayedPercent),
    statusLabel: uploadProgressStatusLabel(phase),
  };
}
