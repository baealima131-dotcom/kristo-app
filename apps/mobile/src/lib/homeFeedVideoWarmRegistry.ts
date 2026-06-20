const warmedVideoUrls = new Set<string>();

function normalizeUrl(url: string): string {
  return String(url || "").trim().split("?")[0];
}

export function wasHomeFeedVideoUrlBufferedAhead(videoUrl: string): boolean {
  const url = normalizeUrl(videoUrl);
  if (!url) return false;
  return warmedVideoUrls.has(url);
}

export function hasHomeFeedVideoWarmKey(normalizedKey: string): boolean {
  return warmedVideoUrls.has(normalizedKey);
}

export function markHomeFeedVideoWarmKey(normalizedKey: string): void {
  if (!normalizedKey) return;
  warmedVideoUrls.add(normalizedKey);
}

export function unmarkHomeFeedVideoWarmKey(normalizedKey: string): void {
  if (!normalizedKey) return;
  warmedVideoUrls.delete(normalizedKey);
}
