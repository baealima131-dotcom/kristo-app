import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Remembers each video's real shape (width / height, as reported by the player) on this device,
 * keyed by video URL. Older posts saved before dimensions were stored then open in the right
 * Watch frame from the second view on, with no wait. Reads are synchronous from memory.
 */

const STORAGE_KEY = "kristo_video_aspect_memory_v1";
const MAX_ENTRIES = 600;

const aspects = new Map<string, number>();
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function keyFor(videoUrl: unknown): string {
  const raw = String(videoUrl || "").trim();
  if (!raw) return "";
  // Signed URLs change their query string; the path identifies the file.
  return raw.split("?")[0].split("#")[0];
}

function validAspect(aspect: unknown): number | null {
  const n = Number(aspect);
  return Number.isFinite(n) && n > 0.1 && n < 10 ? n : null;
}

export function hydrateVideoAspectMemory(): Promise<void> {
  if (hydrated) return Promise.resolve();
  hydrated = true;
  return AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") return;
      for (const [key, value] of Object.entries(parsed)) {
        const aspect = validAspect(value);
        // Entries learned this session (already in memory) win over stored ones.
        if (aspect && !aspects.has(key)) aspects.set(key, aspect);
      }
    })
    .catch(() => {});
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const entries = Array.from(aspects.entries()).slice(-MAX_ENTRIES);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries))).catch(() => {});
  }, 1500);
}

/** The remembered width / height for this video, or undefined when it has not been played here. */
export function peekVideoAspect(videoUrl: unknown): number | undefined {
  const key = keyFor(videoUrl);
  return key ? aspects.get(key) : undefined;
}

export function rememberVideoAspect(videoUrl: unknown, aspect: number) {
  const key = keyFor(videoUrl);
  const value = validAspect(aspect);
  if (!key || !value) return;
  const previous = aspects.get(key);
  if (previous && Math.abs(previous - value) < 0.01) return;
  aspects.delete(key); // re-insert so the most recent entries survive trimming
  aspects.set(key, value);
  schedulePersist();
}

/**
 * Shape of each video's cover picture as loaded on this device (memory only, never stored). A first
 * guess for uploads saved without dimensions: Home has usually loaded the cover already, so Watch
 * opens in the video's own frame instead of a default one that changes when the track reports.
 */
const posterAspects = new Map<string, number>();

export function notePosterAspect(videoUrl: unknown, width: unknown, height: unknown) {
  const key = keyFor(videoUrl);
  const w = Number(width);
  const h = Number(height);
  if (!key || !(w > 0) || !(h > 0)) return;
  const value = validAspect(w / h);
  if (!value) return;
  posterAspects.delete(key);
  posterAspects.set(key, value);
  if (posterAspects.size > MAX_ENTRIES) {
    const oldest = posterAspects.keys().next().value;
    if (oldest) posterAspects.delete(oldest);
  }
}

/** Width / height of this video's cover picture, when it has been loaded on this device. */
export function peekPosterAspect(videoUrl: unknown): number | undefined {
  const key = keyFor(videoUrl);
  return key ? posterAspects.get(key) : undefined;
}

void hydrateVideoAspectMemory();
