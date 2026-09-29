# Asad Downloader

**Created by Asad Raza**

A local-first video downloader: a free static website (this repo, hosted on
GitHub Pages) + a tiny download engine that runs on **your own computer**.
Your videos, files and bandwidth never touch a central server — because there
isn't one.

🌐 **Website:** https://asadkharal91.github.io/asaddownloader.io/

## How it works

```
GitHub Pages website  →  JavaScript  →  http://127.0.0.1:8765
                                            ↓
                                   Local Bridge (your PC)
                                            ↓
                                   yt-dlp + FFmpeg → your disk
```

1. Install & run the bridge below.
2. Open the website's **Downloader** page — it shows ● Connected.
3. Paste URLs, hit **Start Download**. Files land in `Downloads/Asad Downloader/`.

## Repository layout

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The static website (GitHub Pages) |
| `bridge/` | The local download engine (Python) |
| `bridge/bridge.py` | The bridge itself — API, queue, downloads |
| `bridge/install.bat` / `run.bat` | Install & run on Windows |
| `bridge/build.bat` | Build `AsadDownloaderBridge.exe` with PyInstaller |
| `bridge/README.md` | Full docs: setup, FFmpeg, API, troubleshooting |

## Quick start (Windows)

1. Install Python 3.10+ (tick "Add python.exe to PATH").
2. Double-click `bridge/install.bat`, then `bridge/run.bat`.
3. Open the website and download.

See [`bridge/README.md`](bridge/README.md) for the full guide.

## Privacy

Downloaded videos stay on your device. The website collects nothing — no
accounts, no uploads, no tracking. Raw cookies/tokens never leave your PC.

Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp) and
[FFmpeg](https://ffmpeg.org/). Not affiliated with any video platform.
Only download videos you own or have permission to download.

 
### Local-first deployment
The public site stays static on GitHub Pages. The localhost bridge performs the actual downloads and stores media on the user's computer; no central download server is required.
