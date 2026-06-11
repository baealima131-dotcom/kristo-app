#!/usr/bin/env node
/**
 * Benchmark first-byte and range throughput for a church video URL.
 *
 * Usage:
 *   node scripts/benchmark-video-delivery.mjs
 *   node scripts/benchmark-video-delivery.mjs "https://videos.kristoapp.com/church-videos/..."
 */

const FEED_URL = "https://kristo-app.vercel.app/api/church/feed?scope=global";

async function pickFirstVideoUrl() {
  const res = await fetch(FEED_URL);
  const json = await res.json();
  const rows = json.data || json.rows || [];
  for (const row of rows) {
    const url = String(row.videoUrl || row.mediaUri || "").trim();
    if (/^https?:\/\/.+\.(mp4|mov|m4v)(\?|#|$)/i.test(url.split("?")[0])) {
      return url;
    }
  }
  throw new Error("No HTTPS video URL found in feed");
}

async function measureTtfb(url) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Range: "bytes=0-1" } });
  const reader = res.body?.getReader();
  if (reader) {
    await reader.read();
    await reader.cancel();
  } else {
    await res.arrayBuffer();
  }
  return { ms: Date.now() - t0, status: res.status };
}

async function measureRange(url, start, end) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Date.now() - t0;
  const kbs = ms > 0 ? Math.round(buf.length / 1024 / (ms / 1000)) : 0;
  return { ms, status: res.status, bytes: buf.length, kbs };
}

async function main() {
  const url = process.argv[2] || (await pickFirstVideoUrl());
  const host = new URL(url).host;
  console.log("VIDEO_URL", url);
  console.log("HOST", host);

  for (let i = 0; i < 3; i += 1) {
    const ttfb = await measureTtfb(url);
    console.log(`TTFB run${i}`, JSON.stringify(ttfb));
  }

  for (let i = 0; i < 3; i += 1) {
    const r256 = await measureRange(url, 0, 262143);
    console.log(`FIRST_256KB run${i}`, JSON.stringify(r256));
  }

  for (let i = 0; i < 3; i += 1) {
    const r1m = await measureRange(url, 0, 1048575);
    console.log(`FIRST_1MB run${i}`, JSON.stringify(r1m));
  }
}

main().catch((err) => {
  console.error("ERR", err);
  process.exit(1);
});
