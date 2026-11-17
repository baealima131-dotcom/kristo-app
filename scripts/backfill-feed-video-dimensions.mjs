#!/usr/bin/env node
/**
 * Backfill videoWidth/videoHeight on existing feed video posts by reading each video file's
 * MP4 header (display size, rotation applied). Watch then sizes its frame to the video's own
 * shape before playback starts (uploads made before dimensions were stored have none).
 *
 * Default: dry run (reads only, prints the plan). Writing requires both flags:
 *   npx tsx scripts/backfill-feed-video-dimensions.mjs --apply --i-understand-production-writes
 * Options: --limit=N (default 500)
 *
 * Only posts without dimensions and with an http(s) videoUrl are probed. External video links
 * (YouTube/TikTok) are skipped. Writes merge two keys into the JSON payload and nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { probeRemoteVideoDimensions } from "../lib/videoDimensions.ts";

const root = process.cwd();
const args = process.argv.slice(2);
const flags = {
  apply: args.includes("--apply"),
  confirmed: args.includes("--i-understand-production-writes"),
  limit: Math.max(1, Number((args.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || 500),
};

if (flags.apply && !flags.confirmed) {
  console.error("--apply also requires --i-understand-production-writes");
  process.exit(1);
}

function loadDatabaseUrl() {
  const envPath = path.join(root, ".env.local");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^DATABASE_URL=(.*)$/);
      if (match && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = match[1].trim().replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return String(process.env.DATABASE_URL || "").trim();
}

const sqlUrl = loadDatabaseUrl();
if (!sqlUrl) {
  console.error("DATABASE_URL missing; cannot plan backfill.");
  process.exit(1);
}

const sql = neon(sqlUrl);
const rows = await sql`
  SELECT id, payload->>'videoUrl' AS video_url, payload->>'source' AS source
  FROM kristo_church_feed
  WHERE (type = 'video' OR COALESCE(payload->>'videoUrl', '') <> '')
    AND NOT (payload ? 'videoWidth' AND payload ? 'videoHeight')
    AND COALESCE(payload->>'source', '') <> 'system-admin-video-link'
  ORDER BY created_at DESC
  LIMIT ${flags.limit}
`;

const plan = [];
let skipped = 0;
let unreadable = 0;
for (const row of rows) {
  const videoUrl = String(row.video_url || "").trim();
  if (!/^https?:\/\//i.test(videoUrl)) {
    skipped += 1;
    continue;
  }
  const dims = await probeRemoteVideoDimensions(videoUrl, { timeoutMs: 8000 }).catch(() => null);
  if (!dims) {
    unreadable += 1;
    console.log("UNREADABLE", row.id);
    continue;
  }
  const shape = dims.width < dims.height ? "vertical" : "landscape";
  console.log("PLAN", row.id, `${dims.width}x${dims.height}`, shape);
  plan.push({ id: String(row.id), ...dims });
}

let updated = 0;
if (flags.apply) {
  for (const entry of plan) {
    const written = await sql`
      UPDATE kristo_church_feed
      SET payload = payload || jsonb_build_object('videoWidth', ${entry.width}::int, 'videoHeight', ${entry.height}::int),
          updated_at = NOW()
      WHERE id = ${entry.id}
        AND NOT (payload ? 'videoWidth' AND payload ? 'videoHeight')
      RETURNING id
    `;
    updated += written.length;
  }
}

console.log(
  JSON.stringify(
    {
      dryRun: !flags.apply,
      candidates: rows.length,
      probed: plan.length,
      skippedNonHttpUrl: skipped,
      unreadable,
      updated,
      vertical: plan.filter((p) => p.width < p.height).length,
      landscape: plan.filter((p) => p.width >= p.height).length,
    },
    null,
    2
  )
);
