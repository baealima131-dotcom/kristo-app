# Cloudflare R2 — Media Studio video storage (production)

Kristo Media Studio uploads videos **directly to object storage** using presigned PUT URLs. Vercel only mints the signed URL and saves feed metadata — large files never pass through the API route body.

Relevant code:

- `app/api/_lib/media/objectStorage.ts` — config, presigned URL generation, startup logs
- `app/api/church/media/upload-url/route.ts` — authenticated signed-URL endpoint
- `apps/mobile/src/lib/churchVideoUpload.ts` — mobile direct upload + feed post

Home Feed logic is unchanged; it receives a public `videoUrl` after upload completes.

---

## 1. Bucket permissions (Cloudflare R2)

### Create the bucket

1. Cloudflare dashboard → **R2** → **Create bucket**
2. Name example: `kristo-church-videos` (use this value for `KRISTO_VIDEO_STORAGE_BUCKET`)

### API token (server-side signing only)

Create an **R2 API token** (R2 → Manage R2 API tokens):

| Setting | Value |
|--------|--------|
| Permission | **Object Read & Write** (minimum) or **Admin Read & Write** scoped to this bucket |
| Scope | This bucket only (`kristo-church-videos`) |
| TTL | No expiry (or rotate on your schedule) |

The token needs permission to **sign `PutObject`** for keys under `church-videos/*`. It is used **only on Vercel** to generate presigned URLs. Mobile clients upload with the presigned URL; they do not receive the secret key.

**Do not** use a token with account-wide delete permissions unless required by your security policy.

### Public read (streaming)

Presigned PUT writes objects; playback uses a **separate public URL**:

1. R2 bucket → **Settings** → **Public access** → connect a **custom domain** (recommended), e.g. `videos.kristoapp.com`
2. Ensure DNS is proxied through Cloudflare as needed
3. Objects must be readable at `{publicBaseUrl}/{key}` without auth

Optional: R2.dev subdomain for staging only — not recommended for production.

### CORS (recommended)

Mobile native PUT often works without CORS, but configure CORS for debugging and future web clients:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

R2 bucket → **Settings** → **CORS policy**

---

## 2. Vercel environment variables (exact names)

Set in **Production** (and Preview if you test uploads there):

| Variable | Required | Example | Notes |
|----------|----------|---------|--------|
| `KRISTO_VIDEO_STORAGE_BUCKET` | Yes | `kristo-church-videos` | R2 bucket name |
| `KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID` | Yes* | `a1b2c3...` | From R2 API token |
| `KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY` | Yes* | `secret...` | From R2 API token |
| `KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL` | Yes | `https://videos.kristoapp.com` | **No trailing slash**. Public playback base URL |
| `KRISTO_VIDEO_STORAGE_ENDPOINT` | Yes (R2) | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | S3-compatible API endpoint |
| `KRISTO_VIDEO_STORAGE_REGION` | No | `auto` | Defaults to `auto` when endpoint is set |

\*Fallbacks: `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` are accepted if the `KRISTO_VIDEO_STORAGE_*` credential vars are unset.

Add via CLI:

```bash
vercel env add KRISTO_VIDEO_STORAGE_BUCKET production
vercel env add KRISTO_VIDEO_STORAGE_ACCESS_KEY_ID production
vercel env add KRISTO_VIDEO_STORAGE_SECRET_ACCESS_KEY production
vercel env add KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL production
vercel env add KRISTO_VIDEO_STORAGE_ENDPOINT production
vercel env add KRISTO_VIDEO_STORAGE_REGION production
```

Redeploy after changes:

```bash
vercel --prod --archive=tgz
```

### Startup validation logs

After deploy, open Vercel function logs for any request that loads `objectStorage.ts` (e.g. first `POST /api/church/media/upload-url`):

**Configured:**

```
KRISTO_VIDEO_STORAGE_CONFIG_OK {
  bucket: "kristo-church-videos",
  region: "auto",
  endpointConfigured: true,
  publicBaseUrl: "https://videos.kristoapp.com",
  maxUploadGb: 4,
  uploadUrlTtlSeconds: 7200
}
```

**Missing config:**

```
KRISTO_VIDEO_STORAGE_CONFIG_MISSING {
  error: "Video storage is not configured. Missing: ..."
}
```

If you see `CONFIG_MISSING`, Media Studio returns **503** with the same error text in the app alert.

---

## 3. Public URL structure

### Object key (written by server)

```
church-videos/{churchId}/{timestamp}_{random}_{safeFileName}.{ext}
```

Example key:

```
church-videos/church_abc123/1717267200000_a1b2c3d4e5_sunday_sermon.mp4
```

- `churchId` — sanitized from session (`safeFileStem`)
- `timestamp` — `Date.now()`
- `random` — hex fragment
- `safeFileName` — derived from client `fileName` (non-alphanumeric stripped)
- `ext` — from filename or content-type (`.mp4`, `.mov`, `.webm`)

### Public playback URL (returned to mobile as `videoUrl`)

```
{KRISTO_VIDEO_STORAGE_PUBLIC_BASE_URL}/church-videos/{churchId}/{timestamp}_{random}_{safeFileName}.{ext}
```

Example:

```
https://videos.kristoapp.com/church-videos/church_abc123/1717267200000_a1b2c3d4e5_sunday_sermon.mp4
```

Path segments are URL-encoded per segment in code (`buildPublicVideoUrl`).

### Presigned upload URL (not the public URL)

Mobile PUTs to the **S3-compatible presigned URL** (host is `*.r2.cloudflarestorage.com`), valid for **7200 seconds (2 hours)**. This URL is single-object, single-method (PUT), and includes signed query parameters.

---

## 4. Test upload procedure

### A. Confirm server config

1. Deploy with all env vars set
2. Trigger `POST /api/church/media/upload-url` once (or check logs after deploy)
3. Confirm `KRISTO_VIDEO_STORAGE_CONFIG_OK` in Vercel logs

### B. Request signed URL (curl)

Replace `BASE`, `USER_ID`, `CHURCH_ID`, and `ROLE` with real values:

```bash
BASE="https://your-app.vercel.app"

curl -sS -X POST "$BASE/api/church/media/upload-url" \
  -H "Content-Type: application/json" \
  -H "x-kristo-user-id: USER_ID" \
  -H "x-kristo-church-id: CHURCH_ID" \
  -H "x-kristo-role: Pastor" \
  -d '{
    "fileName": "test-sermon.mp4",
    "contentType": "video/mp4",
    "fileSize": 1048576
  }' | jq .
```

**Expected (200):**

```json
{
  "ok": true,
  "data": {
    "uploadUrl": "https://...r2.cloudflarestorage.com/...",
    "videoUrl": "https://videos.kristoapp.com/church-videos/...",
    "key": "church-videos/...",
    "contentType": "video/mp4",
    "expiresIn": 7200,
    "maxBytes": 4294967296
  }
}
```

**Missing config (503):**

```json
{
  "ok": false,
  "error": "Video storage is not configured. Missing: ...",
  "reason": "video_storage_not_configured"
}
```

### C. Upload bytes to storage

```bash
UPLOAD_URL="<paste uploadUrl from response>"
VIDEO_FILE="./test-sermon.mp4"

curl -sS -X PUT "$UPLOAD_URL" \
  -H "Content-Type: video/mp4" \
  --data-binary @"$VIDEO_FILE" \
  -w "\nHTTP %{http_code}\n"
```

**Expected:** HTTP `200` (or `204`).

### D. Publish feed metadata (optional integration test)

```bash
VIDEO_URL="<paste videoUrl from signed-url response>"

curl -sS -X POST "$BASE/api/church/feed" \
  -H "Content-Type: application/json" \
  -H "x-kristo-user-id: USER_ID" \
  -H "x-kristo-church-id: CHURCH_ID" \
  -H "x-kristo-role: Pastor" \
  -d "{
    \"type\": \"video\",
    \"title\": \"Test Sermon\",
    \"text\": \"Integration test caption\",
    \"videoUrl\": \"$VIDEO_URL\"
  }" | jq .
```

### E. Media Studio (mobile)

1. Open **Media Studio** → create video post
2. Choose a video, add title + caption
3. Tap **Post to Home Feed**
4. Confirm progress UI (`Uploading N%`)
5. On missing config: alert **Upload failed** with storage configuration message (no Metro red screen)

---

## 5. Verify signed URL generation

| Check | Pass criteria |
|-------|----------------|
| Auth | Without Kristo headers → guard rejects (401/403) |
| Config | With headers, missing env → **503** + `video_storage_not_configured` |
| Content type | Non-video `contentType` → **400** |
| File size | `fileSize` 0 or negative → **400** |
| Max size | Over 4 GB → **400** |
| Success | Returns `uploadUrl`, `videoUrl`, `key`, `expiresIn: 7200` |
| Logs | `KRISTO_VIDEO_STORAGE_CONFIG_OK` at startup; no secrets in logs |

Presigned URL should:

- Use host `*.r2.cloudflarestorage.com`
- Accept **PUT** with `Content-Type` matching the signed value
- Reject PUT after expiry (2 hours)

---

## 6. Verify uploaded video streams on mobile

1. Complete upload + feed post (steps 4C–4D or Media Studio)
2. Copy `videoUrl` from API response
3. **Direct test:** open `videoUrl` in Safari/Chrome on device — video should play or download
4. **App test:** open Home Feed post — player should load remote HTTPS URL (feed already accepts non-`/uploads/` URLs server-side)

Troubleshooting:

| Symptom | Likely cause |
|---------|----------------|
| 403 on GET `videoUrl` | Public domain not connected to bucket, or object not public |
| Upload 403 | Wrong R2 token permissions or clock skew |
| Upload 403 signature | `Content-Type` on PUT does not match signed type |
| Player spins forever | `videoUrl` uses API endpoint instead of public domain |

---

## 7. Verify 60+ minute sermon uploads

| Limit | Value | Source |
|-------|-------|--------|
| Max file size | **4 GB** | `MAX_VIDEO_UPLOAD_BYTES` in `objectStorage.ts` |
| Signed URL TTL | **2 hours** | `VIDEO_UPLOAD_URL_TTL_SECONDS` |
| Vercel body limit | Not applicable | File bypasses Vercel |

### Size planning (60 minutes)

| Quality (approx.) | Estimated size |
|-------------------|----------------|
| 720p moderate | 600 MB – 1.5 GB |
| 1080p phone recording | 1 – 2.5 GB |
| High bitrate 1080p | 2 – 4 GB |

All typical 60-minute sermons should fit under the 4 GB cap.

### Upload duration vs TTL

At **2 hours** TTL, minimum sustained upload speed for a **4 GB** file:

```
4 GB / 7200 s ≈ 0.55 MB/s (≈ 4.4 Mbps)
```

Slower connections need stable network for the full window; user should keep the app open (Media Studio shows an uploading progress card).

### Production test checklist

- [ ] Upload a **> 100 MB** sample from Media Studio; confirm progress reaches 100%
- [ ] Upload a **> 60 minute** recording (or large test file **> 1 GB** if available)
- [ ] Confirm feed post succeeds with HTTPS `videoUrl`
- [ ] Stream from device on Wi‑Fi and cellular
- [ ] Confirm Vercel logs show `KRISTO_VIDEO_STORAGE_CONFIG_OK` (not `CONFIG_MISSING`)

---

## Quick reference

```
Mobile → POST /api/church/media/upload-url  (small JSON, Vercel)
       ← { uploadUrl, videoUrl }

Mobile → PUT uploadUrl                      (large binary, R2 direct)

Mobile → POST /api/church/feed              (metadata only, Vercel)
         { type: "video", title, text, videoUrl }
```

No changes to Home Feed ranking, polling, or rendering are required for R2 — only a valid public `videoUrl` must reach the feed API.
