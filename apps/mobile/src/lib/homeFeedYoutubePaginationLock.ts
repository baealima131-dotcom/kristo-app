/** Blocks fetch/append while a batch is waiting for covers or poster pipeline is active. */
let paginationLocked = true;
let visualPrepInflight = false;

export function isYoutubeFeedPaginationLocked(): boolean {
  return paginationLocked || visualPrepInflight;
}

export function setYoutubeFeedPaginationLocked(locked: boolean): void {
  paginationLocked = locked;
}

export function isYoutubeVisualPrepInflight(): boolean {
  return visualPrepInflight;
}

export async function runYoutubeVisualPrep<T>(work: () => Promise<T>): Promise<T> {
  visualPrepInflight = true;
  try {
    return await work();
  } finally {
    visualPrepInflight = false;
  }
}
