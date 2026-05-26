# Vercel deployment (Kristo App monorepo)

This repo is a monorepo:

- **Next.js web + API** — root `app/`, `app/api/`, `public/`, `data/`, `lib/`
- **Expo mobile** — `apps/mobile/` (not deployed to Vercel)

Vercel deploys **only the Next.js server**. The root `.vercelignore` excludes mobile, native folders, restores, backups, and local artifacts so uploads stay under Vercel’s 15,000-file limit.

## Prerequisites

- [Vercel CLI](https://vercel.com/docs/cli) installed and logged in (`vercel login`)
- Project linked at repo root (`.vercel/project.json` present after `vercel link`)

## Production deploy

From the repository root:

```bash
vercel --prod --archive=tgz
```

Use `--archive=tgz` so the CLI uploads a single compressed archive instead of tens of thousands of loose files (important for monorepos with large ignored trees on disk).

## Production environment variables (email / auth)

Set these once per Vercel project (Production environment). The CLI prompts for each value interactively:

```bash
vercel env add RESEND_API_KEY production
# Paste your Resend API key (starts with re_)

vercel env add RESEND_FROM_EMAIL production
# Example: Kristo <noreply@kristoapp.com>
# Must be a verified sender/domain in Resend for production recipients.

vercel env add KRISTO_DEBUG_EMAIL production
# Optional: set to 1 to log email send details in server logs; use 0 or omit in production.
```

After adding or changing env vars, redeploy so functions pick them up:

```bash
vercel --prod --archive=tgz
```

## What gets deployed

Included:

- `app/` (pages, layouts, **`app/api/**` routes**)
- `public/`, `data/`, `lib/`, `types/`
- Root config: `package.json`, `next.config.ts`, `tsconfig*.json`, etc.

Excluded (via `.vercelignore`):

- `apps/mobile/` (entire Expo app)
- `node_modules/`, `.git`
- `ios/`, `android/`, `.expo`
- `_restore*`, `_bak`, `backups`, `*.bak*`
- `dist`, `build`, `coverage`, `.next/cache`

## Troubleshooting

| Error | Fix |
|-------|-----|
| `files should NOT have more than 15000 items` | Ensure `.vercelignore` exists at repo root and use `--archive=tgz`. |
| Signup email fails in production | Set `RESEND_API_KEY` and a verified `RESEND_FROM_EMAIL`, then redeploy. |
| API routes 404 | Confirm deploy root is repo root (not `apps/mobile`). |
