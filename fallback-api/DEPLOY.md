# Fallback API — deploy guide

This puts the online fallback server behind **asaddownloader.io**'s home-page
downloader. It is used **only** when the visitor's local bridge engine isn't
running (e.g. they're on a phone). The local engine stays the primary,
recommended path.

**Honest limits of this free setup (read before deploying):**
- The free Render server **sleeps after ~15 min idle** — the first request after
  sleep takes 30–60s while it wakes and re-downloads yt-dlp/ffmpeg.
- **YouTube often blocks datacenter IPs**, so some YouTube links may fail on the
  fallback even though they work fine on the local engine. TikTok/Instagram/
  Facebook/X usually work.
- The free disk is **temporary** — finished files can vanish when the server
  restarts. Files are kept up to 12h (`FILE_TTL_MINUTES=720`).
- No API key is baked into the website: the server only accepts requests coming
  from `https://asadkharal91.github.io` (Origin/Referer check). Someone could
  still call it with curl, but per-IP rate limits bound the abuse, and you can
  rotate to key-mode later if needed.

Total cost: **$0** (Supabase free tier + Render free tier).
Time: ~10 minutes of clicking.

---

## Step 1 — Free database (Supabase)

1. Go to https://supabase.com and sign up (GitHub login is fine).
2. **New Project** → name it `asad-downloader` → set a database password
   (save it somewhere) → pick the region closest to you → Create.
3. Wait ~2 min for provisioning. Then: **Project Settings (gear) → Database**.
4. Under **Connection string**, pick **Session pooler** (this is the IPv4 one —
   Render can't reach the direct IPv6 address).
5. Copy the string. It looks like:
   `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
   Replace `[YOUR-PASSWORD]` with the password from step 2. **Keep this tab.**

## Step 2 — Free server (Render)

1. Go to https://render.com and sign up (GitHub login is fine).
2. Dashboard → **New + → Blueprint**.
3. Choose **Public Git repository** and paste:
   `https://github.com/fabwaseem/social-media-video-downloader-api`
4. Render reads `render.yaml` (the one in this folder — same content) and shows
   the service plan. When it asks for `DATABASE_URL`, paste the Supabase
   session-pooler string from Step 1.
5. **Apply** / Deploy. First build takes ~5–8 min (installs Node deps, builds
   the app, runs DB migrations automatically).
6. When it's live, open `https://<your-service>.onrender.com/v2/health`
   — you should see JSON with `"status": "ok"` (first load may be slow).

## Step 3 — Wire it into the website

1. Copy your Render URL, e.g. `https://asad-downloader-api.onrender.com`
   (no trailing slash).
2. Send it to Muse — the site's `FALLBACK_API_URL` gets pointed at it and the
   "Try online fallback" button appears on the home page whenever the local
   engine isn't detected. Nothing else on the site changes.

## If something breaks

- **Build fails on Render:** open the deploy log; 9 times out of 10 it's the
  `DATABASE_URL` (wrong password or you copied the direct IPv6 string instead
  of the session pooler one). Fix the env var → **Manual Deploy**.
- **API answers 401 "requires an API key":** `ALLOWED_ORIGINS` must exactly
  match the site origin (`https://asadkharal91.github.io`). Check env vars.
- **YouTube links fail but TikTok works:** datacenter IP block (see limits
  above) — not fixable on the free tier. The local engine is the answer for
  those links.
- **First click is slow:** the server was asleep; give it up to a minute.

## Rotating to key-mode later (optional)

If the open endpoint ever gets abused: in Render set `FRONTEND_SECRET` to a
long random string AND create an API key via the admin endpoint, then ask Muse
to switch the site to send `X-API-Key`. Until then, origin-check mode is fine.
