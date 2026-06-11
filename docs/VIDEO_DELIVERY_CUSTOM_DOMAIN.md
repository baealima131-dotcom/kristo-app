# Video delivery — custom domain cutover (`videos.kristoapp.com`)

Production church videos are stored in the **same R2 bucket**. This runbook switches **public playback** from the rate-limited R2 dev endpoint (`pub-…r2.dev`) to a Cloudflare custom domain on that bucket.

No file migration. Existing feed rows keep their stored `pub-…r2.dev` URLs; the API and mobile app rewrite them to the custom domain at runtime (same object key).

---

## Current state (verified)

| Item | Value |
|------|--------|
| Bucket env | `KRISTO_VIDEO_STORAGE_BUCKET` (unchanged) |
| Legacy playback host | `pub-4dbd367781b94d8686d8caab4f5cf171.r2.dev` |
| Target playback host | `videos.kristoapp.com` |
| DNS today | `videos.kristoapp.com` does **not** resolve yet |
| `kristoapp.com` DNS | Cloudflare (`monroe.ns.cloudflare.com`, `brodie.ns.cloudflare.com`) |

**Throughput on legacy host (sample first video, this network):**

| Test | Legacy `pub-…r2.dev` |
|------|----------------------|
| TTFB | 113–342 ms |
| First 256 KB | 547–2689 ms |
| First 1 MB (cold) | **8.9–33 s** (~31–115 KB/s) |

**Target after cutover:** first 1 MB in **~1–3 s**, Home Feed `KRISTO_VIDEO_FIRST_FRAME` in the same ballpark.

---

## Step 1 — Cloudflare R2 custom domain (dashboard)

Do this **before** changing Vercel env or shipping a mobile build.

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → account that owns `kristoapp.com`.
2. **R2** → open the production bucket (same name as `KRISTO_VIDEO_STORAGE_BUCKET`, e.g. `kristo-church-videos`).
3. **Settings** → **Public access** → **Connect domain** (or **Custom Domains**).
4. Enter: `videos.kristoapp.com`
5. Confirm Cloudflare creates the DNS record (usually automatic because the zone is on Cloudflare).
6. Wait until status shows **Active** / **Enabled** (typically 1–5 minutes).

### Verify object access (no migration)

Pick any existing object key from a feed video URL, e.g.:

```
church-videos/CH7-WQJD0P/1780810270578_01d8062adeab2_....mp4
```

Then:

```bash
curl -sI "https://videos.kristoapp.com/church-videos/CH7-WQJD0P/1780810270578_01d8062adeab2_2BD9EE85-DFFA-45B9-9457-D62C36592C6B-81723-00000ADF09DAC24E.mp4"
```

**Pass:** HTTP `200`, `Accept-Ranges: bytes`, `Content-Length` matches the same object on `pub-…r2.dev`.

Optional range check:

```bash
curl -sI -H "Range: bytes=0-262143" "https://videos.kristoapp.com/church-videos/..."
```

**Pass:** HTTP `206`.

---

## Step 2 — Vercel env (production + preview)

Update **only** the public playback base URL. Keep bucket, endpoint, and credentials unchanged.

```bash
# Production
vercel env rm KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL production --yes
printf '%s' 'https://videos.kristoapp.com' | vercel env add KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL production

# Preview (optional, same value)
vercel env rm KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL preview --yes
printf '%s' 'https://videos.kristoapp.com' | vercel env add KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL preview
```

Redeploy:

```bash
vercel --prod --archive=tgz
```

### Confirm in logs

After deploy, trigger any route that loads `objectStorage.ts` (e.g. feed or upload-url). Expect:

```
KRISTO_VIDEO_STORAGE_CONFIG_OK {
  publicBaseUrl: "https://videos.kristoapp.com",
  publicBaseUrlUsesR2Dev: false,
  ...
}
```

New uploads will receive `videoUrl` values on `videos.kristoapp.com` automatically via `buildPublicVideoUrl`.

---

## Step 3 — Mobile env (EAS)

`apps/mobile/eas.json` already sets:

```
EXPO_PUBLIC_VIDEO_STORAGE_PUBLIC_BASE_URL=https://videos.kristoapp.com
```

This rewrites cached `pub-…r2.dev` playback URLs client-side (same key, no DB change). Ship a new **preview/production** build after Step 1 is live.

Local dev (optional):

```bash
export EXPO_PUBLIC_VIDEO_STORAGE_PUBLIC_BASE_URL=https://videos.kristoapp.com
```

---

## Step 4 — Runtime URL rewrite (already in code)

| Layer | Behavior |
|-------|----------|
| Server `canonicalPublicVideoUrl()` | Feed API returns `videos.kristoapp.com/...` even when DB still stores `pub-…r2.dev/...` |
| Mobile `canonicalPublicVideoPlaybackUrl()` | Rewrites legacy `*.r2.dev` church video paths when env is set |

Same R2 object key; no file copy.

---

## Step 5 — Benchmark after cutover

From repo root:

```bash
node scripts/benchmark-video-delivery.mjs
# or explicit URL:
node scripts/benchmark-video-delivery.mjs "https://videos.kristoapp.com/church-videos/..."
```

**Pass criteria:**

| Metric | Target |
|--------|--------|
| TTFB | &lt; 500 ms |
| First 256 KB | &lt; 1 s |
| First 1 MB | **1–3 s** (was 15–33 s on `pub-…r2.dev`) |

### On-device

After custom domain + Vercel redeploy + app build with `EXPO_PUBLIC_VIDEO_STORAGE_PUBLIC_BASE_URL`:

1. Cold launch → Home Feed
2. Capture:
   - `KRISTO_VIDEO_FILE_DIAG` → `videoUrlHost` should be `videos.kristoapp.com`
   - `KRISTO_VIDEO_FIRST_FRAME` → target **~1–3 s**
   - `KRISTO_HOME_FIRST_VIDEO_PREPARE_READY` → `prewarmHit:true`, URL on custom domain

---

## Rollback

1. Revert Vercel env to `https://pub-4dbd367781b94d8686d8caab4f5cf171.r2.dev` and redeploy.
2. Remove or unset `EXPO_PUBLIC_VIDEO_STORAGE_PUBLIC_BASE_URL` in the mobile build.
3. R2 bucket and objects are unchanged; legacy URLs still work on `pub-…r2.dev`.

---

## What we did **not** change

- Home Feed owner / player / startup lifecycle
- Faststart / upload / ffmpeg pipeline
- R2 bucket or object keys
- Feed DB stored URLs (rewrite is runtime only)

See also: `docs/CLOUDFLARE_R2_VIDEO_STORAGE.md` (upload + bucket setup).
