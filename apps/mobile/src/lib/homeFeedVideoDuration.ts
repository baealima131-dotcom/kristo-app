export function resolveVideoDurationMs(item: any): number | undefined {
  const durationMs = Number(item?.durationMs || 0);
  if (Number.isFinite(durationMs) && durationMs > 0) return Math.round(durationMs);

  const durationSec = Number(item?.durationSec || item?.duration || 0);
  if (Number.isFinite(durationSec) && durationSec > 0) return Math.round(durationSec * 1000);

  return undefined;
}
