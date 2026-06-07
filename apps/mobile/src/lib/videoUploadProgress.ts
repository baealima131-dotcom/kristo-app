/** Visible upload bar ranges for compression, chunk upload, and publish. */
export const VISIBLE_UPLOAD_PROGRESS = {
  compressMin: 1,
  compressMax: 40,
  chunkMin: 40,
  chunkMax: 95,
  publishMin: 95,
  publishMax: 100,
} as const;

export function clampVisibleUploadProgress(progress: number): number {
  return Math.max(1, Math.min(100, Math.round(progress)));
}

/** Native compression 0–100 → visible 1–40. */
export function mapCompressionToVisibleProgress(compressionPct: number): number {
  const clamped = Math.max(0, Math.min(100, compressionPct));
  if (clamped <= 0) return VISIBLE_UPLOAD_PROGRESS.compressMin;
  const span = VISIBLE_UPLOAD_PROGRESS.compressMax - VISIBLE_UPLOAD_PROGRESS.compressMin;
  return clampVisibleUploadProgress(
    VISIBLE_UPLOAD_PROGRESS.compressMin + Math.round((clamped / 100) * span)
  );
}

/** Chunk upload 0–100 → visible 40–95. */
export function mapChunkToVisibleProgress(chunkPct: number): number {
  const clamped = Math.max(0, Math.min(100, chunkPct));
  const span = VISIBLE_UPLOAD_PROGRESS.chunkMax - VISIBLE_UPLOAD_PROGRESS.chunkMin;
  return clampVisibleUploadProgress(
    VISIBLE_UPLOAD_PROGRESS.chunkMin + Math.round((clamped / 100) * span)
  );
}

/** Publish/finalize step 0–100 → visible 95–100. */
export function mapPublishToVisibleProgress(publishStepPct = 100): number {
  const clamped = Math.max(0, Math.min(100, publishStepPct));
  const span = VISIBLE_UPLOAD_PROGRESS.publishMax - VISIBLE_UPLOAD_PROGRESS.publishMin;
  return clampVisibleUploadProgress(
    VISIBLE_UPLOAD_PROGRESS.publishMin + Math.round((clamped / 100) * span)
  );
}
