// app/api/_lib/store/fs.ts
import { promises as fs } from "fs";
import path from "path";

/**
 * ✅ Simple, safe JSON file store
 * - stores files under /data (local) or /tmp/kristo-data (serverless)
 * - prevents path traversal
 * - atomic writes (write temp -> rename)
 * - per-file in-process lock to avoid concurrent writes
 * - runtime file is canonical; bundled data/ is seeded once when runtime is missing
 */

const DATA_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join("/tmp", "kristo-data")
    : path.join(process.cwd(), "data");

export function getKristoDataDir() {
  return DATA_DIR;
}

export function isKristoServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export function getJsonStoreDebugInfo(fileName: string) {
  const safe = sanitizeFileName(fileName);
  return {
    runtimePath: path.join(DATA_DIR, safe),
    bundledPath: bundledDataPath(safe),
    serverless: isKristoServerlessRuntime(),
  };
}

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

function bundledDataPath(fileName: string) {
  return path.join(process.cwd(), "data", sanitizeFileName(fileName));
}

async function writeRuntimeFileUnlocked<T>(filePath: string, data: T): Promise<void> {
  const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const content = JSON.stringify(data, null, 2);

  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath).catch(async () => {
    try {
      await fs.unlink(filePath);
    } catch {}
    await fs.rename(tmp, filePath);
  });
}

/**
 * Load the canonical runtime JSON file. If runtime is missing, seed it once from
 * bundled data/ (when present) or fallback, then persist to runtime path.
 */
async function loadRuntimeJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  await ensureDataDir();
  const filePath = resolvePath(fileName);

  return await withLock(filePath, async () => {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return safeParseJson<T>(raw, fallback);
    } catch (e: any) {
      if (e?.code !== "ENOENT") {
        console.warn("[KRISTO] store read runtime failed", {
          fileName,
          filePath,
          code: e?.code,
          message: e?.message,
        });
        return fallback;
      }
    }

    let seed: T = fallback;
    let seedSource: "bundled" | "fallback" = "fallback";

    try {
      const raw = await fs.readFile(bundledDataPath(fileName), "utf8");
      seed = safeParseJson<T>(raw, fallback);
      seedSource = "bundled";
    } catch {
      seed = fallback;
    }

    await writeRuntimeFileUnlocked(filePath, seed);
    console.log("[KRISTO] store runtime initialized", {
      fileName,
      filePath,
      dataDir: DATA_DIR,
      seedSource,
    });

    return seed;
  });
}

export async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  return loadRuntimeJsonFile(fileName, fallback);
}

export async function writeJsonFile<T>(fileName: string, data: T): Promise<void> {
  await ensureDataDir();
  const filePath = resolvePath(fileName);

  await withLock(filePath, async () => {
    try {
      await writeRuntimeFileUnlocked(filePath, data);
    } catch (error: any) {
      console.error("[KRISTO] writeJsonFile failed", {
        fileName,
        filePath,
        code: error?.code,
        message: error?.message,
      });
      throw error;
    }
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
      if (e?.code === "ENOENT") {
        try {
          const raw = await fs.readFile(bundledDataPath(fileName), "utf8");
          cur = safeParseJson<T>(raw, fallback);
        } catch {
          cur = fallback;
        }
        await writeRuntimeFileUnlocked(filePath, cur);
        console.log("[KRISTO] store runtime initialized", {
          fileName,
          filePath,
          dataDir: DATA_DIR,
          seedSource: cur === fallback ? "fallback" : "bundled",
        });
      } else {
        console.warn("[KRISTO] store read runtime failed", {
          fileName,
          filePath,
          code: e?.code,
          message: e?.message,
        });
        cur = fallback;
      }
    }

    const next = mutator(cur);

    try {
      await writeRuntimeFileUnlocked(filePath, next);
    } catch (error: any) {
      console.error("[KRISTO] updateJsonFile write failed", {
        fileName,
        filePath,
        code: error?.code,
        message: error?.message,
      });
      throw error;
    }

    return next;
  });
}
