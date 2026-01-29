// app/api/_lib/rateLimit.ts
import type { NextRequest } from "next/server";
import { readJsonFile, updateJsonFile } from "@/app/api/_lib/store/fs";

/**
 * Lightweight rate limiter (JSON store)
 * - Per (key) + per windowMs
 * - Not perfect for multi-instance prod, but good for prototype
 */

type Bucket = {
  key: string;
  windowStart: number; // epoch ms
  count: number;
};

const STORE_FILE = "rate_limit.json";

function nowMs() {
  return Date.now();
}

function pickHeader(req: NextRequest, key: string) {
  return (
    req.headers.get(key) ||
    req.headers.get(key.toLowerCase()) ||
    req.headers.get(key.toUpperCase()) ||
    ""
  );
}

function getClientIp(req: NextRequest) {
  const ip =
    pickHeader(req, "x-forwarded-for") ||
    pickHeader(req, "x-real-ip") ||
    "";
  return (ip ? String(ip).split(",")[0].trim() : "") || "unknown";
}

export async function rateLimit(req: NextRequest, opts: { name: string; limit: number; windowMs: number; key?: string }) {
  const ip = getClientIp(req);
  const key = opts.key || `${opts.name}:${ip}`;
  const limit = Math.max(1, opts.limit);
  const windowMs = Math.max(1000, opts.windowMs);

  let allowed = true;
  let remaining = limit;
  let resetInMs = windowMs;

  await updateJsonFile<Bucket[]>(
    STORE_FILE,
    (current) => {
      const list = Array.isArray(current) ? current : [];
      const t = nowMs();

      let b = list.find((x) => x.key === key);
      if (!b) {
        b = { key, windowStart: t, count: 0 };
        list.push(b);
      }

      // reset if window passed
      if (t - b.windowStart >= windowMs) {
        b.windowStart = t;
        b.count = 0;
      }

      b.count += 1;

      allowed = b.count <= limit;
      remaining = Math.max(0, limit - b.count);
      resetInMs = Math.max(0, windowMs - (t - b.windowStart));

      // cleanup old buckets (simple)
      const cutoff = t - windowMs * 10;
      return list.filter((x) => x.windowStart >= cutoff);
    },
    await readJsonFile<Bucket[]>(STORE_FILE, [])
  );

  return { allowed, remaining, resetInMs, key };
}
