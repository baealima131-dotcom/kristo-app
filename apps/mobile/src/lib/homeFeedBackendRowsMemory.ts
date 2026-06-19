/** In-memory backend feed snapshot — leaf store to avoid claim/api import cycles. */
let lastFetchedHomeFeedBackendRows: any[] = [];

export function peekHomeFeedBackendRowsMemory(): any[] {
  return lastFetchedHomeFeedBackendRows;
}

export function setHomeFeedBackendRowsMemory(rows: any[]) {
  lastFetchedHomeFeedBackendRows = Array.isArray(rows) ? rows : [];
}

export function clearHomeFeedBackendRowsMemory() {
  lastFetchedHomeFeedBackendRows = [];
}
