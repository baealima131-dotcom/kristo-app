// app/api/_lib/store/fs.ts
import { promises as fs } from "fs";
import path from "path";

/**
 * ✅ Simple, safe JSON file store
 * - stores files under /data
 * - prevents path traversal
 * - atomic writes (write temp -> rename)
 * - per-file in-process lock to avoid concurrent writes
 */

const DATA_DIR = path.join(process.cwd(), "data");

// In-process lock per file (good enough for single Next dev server process)
const locks = new Map<string, Promise<unknown>>();

function sanitizeFileName(fileName: string) {
  const f = String(fileName || "").trim();
  if (!f) throw new Error("Missing fileName");
  // prevent path traversal + absolute paths
  if (f.includes("..") || f.includes("/") || f.includes("\\") || f.startsWith(".")) {
    throw new Error("Invalid fileName");
  }
  return f;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function resolvePath(fileName: string) {
  const safe = sanitizeFileName(fileName);
  return path.join(DATA_DIR, safe);
}

async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(filePath) ?? Promise.resolve();
  let release!: () => void;

  const next = new Promise<void>((r) => (release = r));
  locks.set(
    filePath,
    prev
      .catch(() => {})
      .then(() => next)
  );

  try {
    await prev;
    return await fn();
  } finally {
    release();
    // cleanup if no one else queued
    if (locks.get(filePath) === next) locks.delete(filePath);
  }
}

function safeParseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const filePath = resolvePath(fileName);

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeParseJson<T>(raw, fallback);
  } catch (e: any) {
    if (e?.code === "ENOENT") return fallback;
    // if anything weird happens, return fallback (keep app running)
    return fallback;
  }
}

export async function writeJsonFile<T>(fileName: string, data: T): Promise<void> {
  await ensureDataDir();
  const filePath = resolvePath(fileName);

  await withLock(filePath, async () => {
    const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const content = JSON.stringify(data, null, 2);

    await fs.writeFile(tmp, content, "utf8");
    // atomic replace on most platforms
    await fs.rename(tmp, filePath).catch(async () => {
      // windows sometimes needs unlink first
      try {
        await fs.unlink(filePath);
      } catch {}
      await fs.rename(tmp, filePath);
    });
  });
}

export async function updateJsonFile<T>(
  fileName: string,
  mutator: (current: T) => T,
  fallback: T
): Promise<T> {
  await ensureDataDir();
  const filePath = resolvePath(fileName);

  return await withLock(filePath, async () => {
    let cur: T = fallback;

    try {
      const raw = await fs.readFile(filePath, "utf8");
      cur = safeParseJson<T>(raw, fallback);
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        // ignore and use fallback
        cur = fallback;
      }
    }

    const next = mutator(cur);

    const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const content = JSON.stringify(next, null, 2);

    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, filePath).catch(async () => {
      try {
        await fs.unlink(filePath);
      } catch {}
      await fs.rename(tmp, filePath);
    });

    return next;
  });
}
