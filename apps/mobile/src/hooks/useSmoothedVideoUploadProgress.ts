import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaVideoUploadStatus } from "@/src/lib/optimisticVideoUpload";
import type { UploadProgressSmoothingMeta } from "@/src/lib/videoUploadProgressSmoothing";
import {
  UploadProgressSmoother,
  uploadProgressStatusLabel,
} from "@/src/lib/videoUploadProgressSmoothing";

export function useSmoothedVideoUploadProgress() {
  const smootherRef = useRef<UploadProgressSmoother | null>(null);
  if (!smootherRef.current) {
    smootherRef.current = new UploadProgressSmoother();
  }
  const smoother = smootherRef.current;

  const [active, setActive] = useState(false);
  const [displayedPercent, setDisplayedPercent] = useState(1);
  const [uploadStatus, setUploadStatus] = useState<MediaVideoUploadStatus>("preparing");

  const start = useCallback(() => {
    smoother.reset();
    setActive(true);
    setDisplayedPercent(1);
    setUploadStatus("preparing");
  }, [smoother]);

  const ingest = useCallback(
    (
      realProgress: number,
      status?: MediaVideoUploadStatus,
      meta?: UploadProgressSmoothingMeta
    ) => {
      if (realProgress <= 0 && status !== "done" && status !== "processing") {
        if (status) setUploadStatus(status);
        return;
      }
      smoother.ingest(realProgress, status || "uploading", meta);
      if (status) setUploadStatus(status);
    },
    [smoother]
  );

  const markComplete = useCallback(() => {
    smoother.markComplete();
    setUploadStatus("done");
  }, [smoother]);

  const stop = useCallback(() => {
    setActive(false);
    smoother.reset();
    setDisplayedPercent(0);
    setUploadStatus("preparing");
  }, [smoother]);

  useEffect(() => {
    if (!active) return;

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
  }, [active, smoother]);

  return {
    active,
    displayedPercent,
    uploadStatus,
    statusLabel: uploadProgressStatusLabel(uploadStatus),
    start,
    ingest,
    markComplete,
    stop,
  };
}
