# Asad Downloader Bridge

Local download engine for the **Asad Downloader** website
(https://asadkharal91.github.io/asaddownloader.io/).

**Architecture: free static website + your own PC.** The website never
downloads anything itself — it sends jobs to this bridge running on
`http://127.0.0.1:8765` on *your* computer, and your computer runs
yt-dlp + FFmpeg and saves the files to *your* disk. Nothing is uploaded
anywhere.

---

## How the website works

1. You open the website and go to the **Downloader** page.
2. The page checks `GET http://127.0.0.1:8765/api/health` every few seconds.
3. If the bridge answers → **● Connected**. If not → **○ Not Connected**
   with an **Install Local Engine** panel.
4. You paste URLs (one per line) and click **Start Download**.
5. The website `POST`s the URLs to `/api/jobs`. The bridge queues them and
   downloads with up to N parallel workers (default 3, configurable 1–8).
6. The website polls `/api/jobs` and renders live progress bars, speed,
   ETA, sizes and errors — no page reload needed.
7. Finished files stay on your PC. **Get File** streams a file back through
   localhost into your browser; **Open Folder** opens it in Explorer.

## How to run the local bridge

**Windows (easy):**

1. Install Python 3.10+ from https://www.python.org/downloads/
   (tick **"Add python.exe to PATH"**).
2. Double-click `install.bat` — installs yt-dlp.
3. Double-click `run.bat` — the bridge starts on `http://127.0.0.1:8765`.
4. Keep the window open, open the website, paste URLs, download.

**Manual:**

```bash
pip install -r requirements.txt
python bridge.py            # optional: --port 8765
```

## How to build the EXE

On a Windows PC:

1. `pip install pyinstaller yt-dlp`
2. (Recommended) place `ffmpeg.exe` next to `build.bat` so it is bundled.
3. Double-click `build.bat`.
4. The exe appears at `dist\AsadDownloaderBridge.exe`.
5. Upload it to a **GitHub Release** in this repository, then set the
   website's **Download Local Engine** button to that release URL
   (see `BRIDGE_DOWNLOAD_URL` at the top of the website's `app.js`).

## How the website communicates with localhost

The website is static (GitHub Pages cannot run code), so all API calls are
plain `fetch()` from JavaScript to `http://127.0.0.1:8765`:

| Method | Endpoint                | Purpose                              |
|--------|-------------------------|--------------------------------------|
| GET    | /api/health             | Bridge detection / status pill       |
| GET    | /api/jobs               | List active + history jobs           |
| POST   | /api/jobs               | Submit `{ "urls": [...] }`           |
| GET    | /api/jobs/{id}          | Single job detail                    |
| POST   | /api/jobs/{id}/cancel   | Cancel a running/queued job          |
| DELETE | /api/jobs/{id}          | Remove a finished job from the list  |
| GET    | /api/jobs/{id}/file     | Download the finished file (local)   |
| POST   | /api/open-folder        | Open the download folder in Explorer |
| GET    | /api/config             | Read bridge settings                 |
| POST   | /api/config             | Update bridge settings               |

The bridge answers CORS preflights (`OPTIONS`) and only accepts the
official website origin plus localhost dev origins. It **binds only to
127.0.0.1** — it is unreachable from your local network or the internet.

## Where downloaded files are stored

Default: `Downloads/Asad Downloader/` inside your user profile
(e.g. `C:\Users\You\Downloads\Asad Downloader\`).

- Change it anytime in the website's **Settings** tab.
- Optionally organize into subfolders per uploader/creator.
- Existing files are never overwritten: `video.mp4`, `video (1).mp4`, …
- Filenames are sanitized for Windows (`<>:"/\|?*` removed).

## How to configure FFmpeg

FFmpeg is needed for merging video+audio and for MP3 extraction.

1. Download a Windows build from https://www.gyan.dev/ffmpeg/builds/
   (the `ffmpeg-release-essentials.zip`).
2. Either:
   - put `ffmpeg.exe` on your PATH, **or**
   - copy `ffmpeg.exe` next to `bridge.py` (or into a `bin\` subfolder), **or**
   - let `build.bat` bundle it into the exe.
3. The bridge reports `ffmpeg_available` in `/api/health`; if it is missing,
   jobs fail with a clear **"FFmpeg missing"** message instead of a crash.

## Troubleshooting the bridge

| Symptom | Fix |
|---|---|
| Website shows "Not Connected" | Is `run.bat` / the exe running? Keep its window open. |
| "yt-dlp is not installed" | Run `install.bat` (or `pip install -r requirements.txt`). |
| "FFmpeg missing" on jobs | See "How to configure FFmpeg" above. |
| "Temporarily rate limited — retrying" | The service throttled us; the bridge backs off and retries automatically. Don't raise workers above 3–4 on strict sites. |
| "Authentication required" | Enable **Use browser cookies** in Settings and pick your browser (Chrome/Edge/Firefox/Brave). Cookies stay on your PC — the website never sees them. |
| Port 8765 already in use | Start with `python bridge.py --port 8770` and matching website config. |
| Nothing downloads, instant fail | Check `bridge.log` next to `bridge.py`; use **View Details** on the failed job. |

## Privacy notes

- Downloaded videos remain on your device. The website collects nothing.
- Browser-cookie mode uses yt-dlp's `--cookies-from-browser` locally.
  Raw cookies/tokens are never displayed on the website, never sent to any
  server, and are redacted from `bridge.log`.
- The bridge only ever listens on `127.0.0.1`.

## Acknowledgements

Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) and
[FFmpeg](https://ffmpeg.org/) (GPL/LGPL depending on build). Asad Downloader
is not affiliated with TikTok, YouTube, Instagram, Meta, or any platform.
Only download videos you own or have permission to download.
