const warmedVideoUrls = new Set<string>();

export function wasHomeFeedVideoUrlBufferedAhead(url: string): boolean {
  const key = String(url || "").trim().split("?")[0];
  return Boolean(key && warmedVideoUrls.has(key));
}

export function markHomeFeedVideoUrlBufferedAhead(url: string) {
  const key = String(url || "").trim().split("?")[0];
  if (key) warmedVideoUrls.add(key);
}

export function unmarkHomeFeedVideoUrlBufferedAhead(url: string) {
  const key = String(url || "").trim().split("?")[0];
  if (key) warmedVideoUrls.delete(key);
}
