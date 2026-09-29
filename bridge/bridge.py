#!/usr/bin/env python3
"""
Asad Downloader Bridge v1.0.0
=============================
Local download engine for the Asad Downloader website.

Architecture:
    GitHub Pages website (static)
        -> JavaScript fetch()
            -> http://127.0.0.1:8765  (THIS process, localhost only)
                -> yt-dlp + FFmpeg run on the USER'S OWN PC
                    -> files saved on the USER'S OWN disk

Privacy guarantees:
- Binds ONLY to 127.0.0.1. It is not reachable from the network.
- Downloaded videos NEVER leave this computer.
- Raw cookies / tokens are NEVER sent to the website and NEVER logged.
- Only the official website origin (and localhost dev origins) are
  accepted via CORS.

Run:
    python bridge.py [--port 8765] [--dev]
"""

import base64
import hashlib
import json
import logging
import mimetypes
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

VERSION = "1.0.0"
HOST = "127.0.0.1"          # NEVER change to 0.0.0.0 - localhost only.
DEFAULT_PORT = 8765

# Origins allowed to talk to the bridge (CORS).
ALLOWED_ORIGINS = {
    "https://asadkharal91.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")
HISTORY_PATH = os.path.join(BASE_DIR, "history.json")
LOG_PATH = os.path.join(BASE_DIR, "bridge.log")

# --------------------------------------------------------------------------
# Logging (never log cookies, tokens, or full URLs with credentials)
# --------------------------------------------------------------------------

def _redact_url(url: str) -> str:
    """Strip credentials / tokens from a URL before logging."""
    try:
        p = urlparse(url)
        netloc = p.hostname or ""
        if p.port:
            netloc += f":{p.port}"
        return f"{p.scheme}://{netloc}{p.path}"
    except Exception:
        return "<unparseable-url>"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8"),
              logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("bridge")

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

DEFAULT_CONFIG = {
    "mode": "video",              # "video" | "audio"
    "quality": "best",            # "best" | "1080p" | "720p" | "480p"
    "audio_format": "mp3",        # for audio mode
    "workers": 3,                 # 1..8
    "download_dir": "",           # "" => ~/Downloads/Asad Downloader
    "filename_template": "%(title)s.%(ext)s",
    "organize_by_uploader": False,
    "retries": 3,                 # retries per job on temporary failure
    "retry_delay": 10,            # base seconds between retries
    "use_browser_cookies": False, # use --cookies-from-browser (local only)
    "browser": "chrome",          # chrome | edge | firefox | brave
    "theme": "dark",
    "notifications": True,
}

CONFIG_WRITABLE_KEYS = set(DEFAULT_CONFIG.keys())


def default_download_dir() -> str:
    home = os.path.expanduser("~")
    return os.path.join(home, "Downloads", "Asad Downloader")


def load_config() -> dict:
    cfg = dict(DEFAULT_CONFIG)
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, encoding="utf-8") as f:
                data = json.load(f)
            for k in CONFIG_WRITABLE_KEYS:
                if k in data:
                    cfg[k] = data[k]
    except Exception as e:
        log.warning("Could not load config.json, using defaults: %s", e)
    # sanitize
    try:
        cfg["workers"] = max(1, min(8, int(cfg.get("workers", 3))))
    except Exception:
        cfg["workers"] = 3
    if cfg.get("quality") not in ("best", "1080p", "720p", "480p"):
        cfg["quality"] = "best"
    if cfg.get("mode") not in ("video", "audio"):
        cfg["mode"] = "video"
    if cfg.get("browser") not in ("chrome", "edge", "firefox", "brave"):
        cfg["browser"] = "chrome"
    return cfg


def save_config(cfg: dict) -> None:
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        log.warning("Could not save config.json: %s", e)


CONFIG = load_config()

# --------------------------------------------------------------------------
# yt-dlp availability
# --------------------------------------------------------------------------

try:
    import yt_dlp
    from yt_dlp.utils import DownloadError
    YTDLP_AVAILABLE = True
    # NOTE: yt_dlp.version is a *module*; the string lives at __version__.
    YTDLP_VERSION = getattr(getattr(yt_dlp, "version", None),
                            "__version__", "unknown")
except Exception as e:  # pragma: no cover
    yt_dlp = None
    DownloadError = Exception
    YTDLP_AVAILABLE = False
    YTDLP_VERSION = None
    log.error("yt-dlp is not installed: %s", e)


def find_ffmpeg() -> str | None:
    """Locate an ffmpeg binary: PATH first, then next to the bridge."""
    found = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    if found:
        return found
    for name in ("ffmpeg.exe", "ffmpeg"):
        cand = os.path.join(BASE_DIR, name)
        if os.path.isfile(cand):
            return cand
        cand = os.path.join(BASE_DIR, "bin", name)
        if os.path.isfile(cand):
            return cand
    return None


FFMPEG_PATH = find_ffmpeg()

# --------------------------------------------------------------------------
# Job store
# --------------------------------------------------------------------------

TERMINAL_STATES = ("completed", "failed", "cancelled")

jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
history: list[dict] = []          # newest-first snapshots of terminal jobs
MAX_HISTORY = 500


def load_history() -> None:
    global history
    try:
        if os.path.exists(HISTORY_PATH):
            with open(HISTORY_PATH, encoding="utf-8") as f:
                history = json.load(f) or []
    except Exception as e:
        log.warning("Could not load history.json: %s", e)
        history = []


def persist_history() -> None:
    try:
        with open(HISTORY_PATH, "w", encoding="utf-8") as f:
            json.dump(history[:MAX_HISTORY], f, indent=2)
    except Exception as e:
        log.warning("Could not save history.json: %s", e)


def job_public(job: dict) -> dict:
    """Job dict safe to send to the website (no local paths leaked beyond
    what the UI needs, never any credentials)."""
    return {
        "id": job["id"],
        "url": job["url"],
        "title": job.get("title") or "",
        "status": job["status"],
        "progress": round(job.get("progress", 0.0), 1),
        "speed": job.get("speed") or "",
        "eta": job.get("eta"),
        "downloaded_bytes": job.get("downloaded_bytes", 0),
        "total_bytes": job.get("total_bytes"),
        "filename": job.get("filename") or "",
        "error": job.get("error") or "",
        "error_detail": job.get("error_detail") or "",
        "created_at": job.get("created_at"),
        "finished_at": job.get("finished_at"),
        "attempt": job.get("attempt", 1),
        "has_file": bool(job.get("filepath") and os.path.exists(job["filepath"])),
    }


# --------------------------------------------------------------------------
# Filename helpers
# --------------------------------------------------------------------------

_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_filename(name: str, max_len: int = 180) -> str:
    name = _UNSAFE_CHARS.sub("", name).strip().strip(".")
    if not name:
        name = "video"
    if len(name) > max_len:
        name = name[:max_len].rstrip()
    # Avoid Windows reserved names
    if name.upper() in {"CON", "PRN", "AUX", "NUL"} | \
            {f"COM{i}" for i in range(1, 10)} | {f"LPT{i}" for i in range(1, 10)}:
        name = "_" + name
    return name


def unique_path(directory: str, filename: str, ignore: str | None = None) -> str:
    """Return a path that does not overwrite an existing file:
    video.mp4, video (1).mp4, video (2).mp4, ...
    `ignore` (abspath) is excluded from the collision check, so a file
    never collides with itself."""
    base, ext = os.path.splitext(filename)
    candidate = os.path.join(directory, filename)
    i = 1
    while os.path.exists(candidate) and (
            ignore is None or os.path.abspath(candidate) != os.path.abspath(ignore)):
        candidate = os.path.join(directory, f"{base} ({i}){ext}")
        i += 1
    return candidate


# --------------------------------------------------------------------------
# Error classification (user-friendly messages, no stack traces to the UI)
# --------------------------------------------------------------------------

def classify_error(exc: BaseException) -> tuple[str, str, bool]:
    """Return (short_message, detail, is_temporary)."""
    msg = str(exc)
    low = msg.lower()

    if isinstance(exc, CancelledError):
        return ("Cancelled", "The download was cancelled.", False)
    if "ffmpeg" in low and ("not found" in low or "missing" in low):
        return ("FFmpeg missing",
                "FFmpeg was not found. Install it and make sure it is on PATH, "
                "or place ffmpeg.exe next to bridge.py. See README.md.", False)
    if "429" in low or "too many requests" in low or "rate-limit" in low:
        return ("Temporarily rate limited",
                "The service asked us to slow down. Will retry automatically "
                "with backoff.", True)
    if "private" in low and "video" in low:
        return ("Private / unavailable video",
                "This video is private, deleted, or not available.", False)
    if "login" in low or "sign in" in low or "authentication" in low or \
            "cookies" in low and "required" in low:
        return ("Authentication required",
                "This video needs a login. Enable 'Use browser cookies' in "
                "Settings and pick your browser.", False)
    if "unsupported url" in low or "no video formats found" in low:
        return ("Unsupported URL",
                "No downloadable video was found at this URL.", False)
    if "timed out" in low or "timeout" in low:
        return ("Network timeout",
                "The connection timed out. Will retry automatically.", True)
    if "disk" in low and ("full" in low or "space" in low) or "no space" in low:
        return ("Disk full",
                "There is not enough free disk space for this download.", False)
    if "permission denied" in low:
        return ("Permission denied",
                "The bridge could not write to the download folder.", False)
    if "name or service not known" in low or "failed to resolve" in low or \
            "network is unreachable" in low:
        return ("Network error",
                "Could not reach the video service. Check your connection.", True)
    # generic
    short = msg.split("\n")[0][:160] or "Download failed"
    return ("Download failed", short, False)


class CancelledError(Exception):
    pass


class FFmpegMissingError(Exception):
    pass


# --------------------------------------------------------------------------
# Download execution
# --------------------------------------------------------------------------

cancel_events: dict[str, threading.Event] = {}


def build_ydl_opts(job: dict, download_dir: str) -> dict:
    cfg = CONFIG
    template = cfg.get("filename_template") or "%(title)s.%(ext)s"
    if cfg.get("organize_by_uploader"):
        template = os.path.join("%(uploader)s", template)
    outtmpl = os.path.join(download_dir, template)

    if cfg["mode"] == "audio":
        fmt = "bestaudio/best"
        postprocessors = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": cfg.get("audio_format", "mp3"),
            "preferredquality": "192",
        }]
    else:
        q = cfg.get("quality", "best")
        if q == "1080p":
            fmt = "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
        elif q == "720p":
            fmt = "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
        elif q == "480p":
            fmt = "bestvideo[height<=480]+bestaudio/best[height<=480]/best"
        else:
            fmt = "bestvideo+bestaudio/best"
        postprocessors = [{"key": "FFmpegVideoConvertor", "preferedformat": "mp4"}] \
            if FFMPEG_PATH else []

    opts = {
        "format": fmt,
        "outtmpl": outtmpl,
        "postprocessors": postprocessors,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "retries": 2,
        "fragment_retries": 2,
        "progress_hooks": [lambda d, j=job: _progress_hook(j, d)],
        "logger": _YtDlpLogger(job),
    }
    if FFMPEG_PATH:
        opts["ffmpeg_location"] = os.path.dirname(FFMPEG_PATH)
    if cfg.get("use_browser_cookies"):
        # Local-only: the website never sees these cookies.
        opts["cookiesfrombrowser"] = (cfg.get("browser", "chrome"),)
    return opts


class _YtDlpLogger:
    def __init__(self, job):
        self.job = job

    def _redacted(self, msg):
        # Never let cookies/tokens reach the log file.
        return re.sub(r"(?i)(cookie|token|auth)[=:][^\s]+", r"\1=<redacted>", msg)

    def debug(self, msg):
        pass

    def warning(self, msg):
        log.warning("[%s] %s", self.job["id"][:8], self._redacted(msg))

    def error(self, msg):
        log.error("[%s] %s", self.job["id"][:8], self._redacted(msg))


def _progress_hook(job: dict, d: dict):
    ev = cancel_events.get(job["id"])
    if ev is not None and ev.is_set():
        raise CancelledError("cancelled by user")
    status = d.get("status")
    with jobs_lock:
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            downloaded = d.get("downloaded_bytes", 0)
            job["downloaded_bytes"] = downloaded
            job["total_bytes"] = total
            if total:
                job["progress"] = downloaded / total * 100.0
            job["speed"] = _fmt_speed(d.get("speed"))
            job["eta"] = d.get("eta")
            if not job.get("title"):
                info = d.get("info_dict") or {}
                job["title"] = info.get("title") or ""
            fn = d.get("filename")
            if fn and not job.get("filename"):
                job["filename"] = safe_filename(os.path.basename(fn))
        elif status == "finished":
            job["progress"] = 100.0


def _fmt_speed(bps) -> str:
    if not bps:
        return ""
    bps = float(bps)
    for unit in ("B/s", "KB/s", "MB/s", "GB/s"):
        if bps < 1024:
            return f"{bps:.1f} {unit}"
        bps /= 1024
    return f"{bps:.1f} TB/s"


def _is_temporary(exc) -> bool:
    return classify_error(exc)[2]


executor: ThreadPoolExecutor | None = None
executor_lock = threading.Lock()
rate_limit_strikes = 0
rate_limit_lock = threading.Lock()


def get_executor() -> ThreadPoolExecutor:
    global executor
    with executor_lock:
        want = max(1, min(8, int(CONFIG.get("workers", 3))))
        with rate_limit_lock:
            # Back off concurrency when the service keeps rate limiting us.
            if rate_limit_strikes >= 3:
                want = max(1, want // 2)
        if executor is None or executor._max_workers != want:
            if executor is not None:
                executor.shutdown(wait=False, cancel_futures=True)
            executor = ThreadPoolExecutor(max_workers=want,
                                          thread_name_prefix="dl")
            log.info("Worker pool: %d concurrent downloads", want)
        return executor


def submit_job(job: dict):
    get_executor().submit(_run_job_with_retries, job["id"])


def _run_job_with_retries(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job["status"] = "downloading"
        job["attempt"] = 1

    max_retries = max(0, int(CONFIG.get("retries", 3)))
    base_delay = max(1, int(CONFIG.get("retry_delay", 10)))
    attempt = 0

    while True:
        attempt += 1
        with jobs_lock:
            job["attempt"] = attempt
            if attempt > 1:
                job["status"] = "retrying"
        try:
            _download_once(job_id)
            _finish_job(job_id, "completed")
            return
        except CancelledError:
            _finish_job(job_id, "cancelled",
                        short="Cancelled", detail="Cancelled by user.")
            return
        except Exception as exc:  # noqa: BLE001 - classified below
            short, detail, temporary = classify_error(exc)
            log.warning("Job %s attempt %d failed (%s): %s",
                        job_id[:8], attempt, short, _redact_url(jobs[job_id]["url"]))
            if isinstance(exc, FFmpegMissingError):
                _finish_job(job_id, "failed", short=short, detail=detail)
                return
            if temporary and attempt <= max_retries:
                if "rate limited" in short.lower():
                    with rate_limit_lock:
                        global rate_limit_strikes
                        rate_limit_strikes += 1
                delay = base_delay * (2 ** (attempt - 1)) + random.uniform(0, 5)
                with jobs_lock:
                    job["status"] = "retrying"
                    job["error"] = f"{short} — retrying in {int(delay)}s"
                log.info("Job %s retrying in %.0fs", job_id[:8], delay)
                # interruptible sleep so cancel still works promptly
                ev = cancel_events.get(job_id)
                if ev is not None and ev.wait(timeout=delay):
                    _finish_job(job_id, "cancelled",
                                short="Cancelled", detail="Cancelled by user.")
                    return
                continue
            with rate_limit_lock:
                rate_limit_strikes = 0
            _finish_job(job_id, "failed", short=short, detail=detail)
            return


def _download_once(job_id: str):
    with jobs_lock:
        job = jobs[job_id]

    if not YTDLP_AVAILABLE:
        raise RuntimeError("yt-dlp is not installed. Run install.bat first.")

    download_dir = CONFIG.get("download_dir") or default_download_dir()
    try:
        os.makedirs(download_dir, exist_ok=True)
    except OSError as e:
        raise PermissionError(f"Cannot create download folder: {e}")

    needs_ffmpeg = CONFIG.get("mode") == "audio" or True  # merge needs ffmpeg
    if needs_ffmpeg and not FFMPEG_PATH:
        # Video-only single file may not need ffmpeg; check after probe.
        pass

    ydl_opts = build_ydl_opts(job, download_dir)

    # Pre-reserve a unique output path to avoid overwrites:
    # yt-dlp resolves the template; we then ensure uniqueness by renaming
    # via a two-step: download, then move to unique_path if collision.
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(job["url"], download=False)
        except Exception as e:
            raise e
        title = (info or {}).get("title") or "video"
        with jobs_lock:
            job["title"] = title
        ydl.download([job["url"]])

    # Locate the produced file and ensure a unique, safe name.
    with jobs_lock:
        job = jobs[job_id]
    produced = _find_produced_file(job, download_dir)
    if not produced or not os.path.exists(produced):
        raise RuntimeError("Download finished but no output file was found.")
    final = unique_path(download_dir,
                        safe_filename(os.path.basename(produced)),
                        ignore=produced)
    if os.path.abspath(produced) != os.path.abspath(final):
        try:
            os.makedirs(os.path.dirname(final), exist_ok=True)
            shutil.move(produced, final)
        except OSError:
            final = produced  # keep original if move fails
    with jobs_lock:
        job["filepath"] = final
        job["filename"] = os.path.basename(final)
        job["progress"] = 100.0


def _find_produced_file(job: dict, download_dir: str) -> str | None:
    """Best-effort: find the newest media file in the download dir that
    matches this job (by recorded filename, else newest file)."""
    fn = job.get("filename")
    if fn:
        for root, _dirs, files in os.walk(download_dir):
            if fn in files:
                return os.path.join(root, fn)
    # fallback: newest media file created after job start
    created = job.get("created_at", 0)
    best = None
    best_mtime = created
    exts = (".mp4", ".mkv", ".webm", ".mp3", ".m4a", ".opus", ".avi", ".mov")
    for root, _dirs, files in os.walk(download_dir):
        for f in files:
            if not f.lower().endswith(exts):
                continue
            p = os.path.join(root, f)
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if m >= best_mtime:
                best, best_mtime = p, m
    return best


def _finish_job(job_id: str, status: str, short="", detail=""):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        # Never report success without a real file on disk.
        if status == "completed":
            fp = job.get("filepath")
            if not fp or not os.path.exists(fp):
                status = "failed"
                short = short or "Download failed"
                detail = detail or "No output file was produced."
        job["status"] = status
        job["finished_at"] = time.time()
        if status == "completed":
            job["progress"] = 100.0
            job["error"] = ""
            job["error_detail"] = ""
        else:
            job["error"] = short
            job["error_detail"] = detail
        snap = job_public(job)
    cancel_events.pop(job_id, None)
    with jobs_lock:
        history.insert(0, snap)
        del history[MAX_HISTORY:]
    persist_history()
    log.info("Job %s -> %s (%s)", job_id[:8], status, short or snap.get("title"))


def create_jobs(urls: list[str]) -> list[dict]:
    created = []
    for raw in urls:
        url = (raw or "").strip()
        if not url:
            continue
        p = urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id, "url": url, "title": "", "status": "failed",
                "progress": 0.0, "speed": "", "eta": None,
                "downloaded_bytes": 0, "total_bytes": None,
                "filename": "", "filepath": "",
                "error": "Invalid URL",
                "error_detail": "The URL must start with http:// or https://",
                "created_at": time.time(), "finished_at": time.time(),
                "attempt": 1,
            }
            with jobs_lock:
                jobs[job_id] = job
                history.insert(0, job_public(job))
            persist_history()
            created.append(job_public(job))
            continue
        job_id = uuid.uuid4().hex
        job = {
            "id": job_id, "url": url, "title": "", "status": "queued",
            "progress": 0.0, "speed": "", "eta": None,
            "downloaded_bytes": 0, "total_bytes": None,
            "filename": "", "filepath": "",
            "error": "", "error_detail": "",
            "created_at": time.time(), "finished_at": None,
            "attempt": 0,
        }
        with jobs_lock:
            jobs[job_id] = job
        cancel_events[job_id] = threading.Event()
        created.append(job_public(job))
        log.info("Queued job %s: %s", job_id[:8], _redact_url(url))
    for c in created:
        if c["status"] == "queued":
            submit_job(jobs[c["id"]])
    return created


# --------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------

class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "AsadDownloaderBridge/" + VERSION

    # -- helpers ---------------------------------------------------------
    def _origin_ok(self) -> str | None:
        origin = self.headers.get("Origin")
        if not origin:
            return None  # same-origin / non-browser client
        if origin in ALLOWED_ORIGINS:
            return origin
        # allow any localhost dev origin
        try:
            p = urlparse(origin)
            if p.hostname in ("127.0.0.1", "localhost"):
                return origin
        except Exception:
            pass
        return None

    def _send_cors(self):
        origin = self._origin_ok()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self._send_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 1_000_000:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def log_message(self, fmt, *args):
        # Quieter access log; never log query strings that might hold tokens.
        path = self.path.split("?")[0]
        log.info("%s %s", self.command, path)

    # -- routing ---------------------------------------------------------
    def do_GET(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/health":
            self._json({
                "status": "ok",
                "service": "asad-downloader-bridge",
                "version": VERSION,
                "yt_dlp": YTDLP_VERSION,
                "yt_dlp_available": YTDLP_AVAILABLE,
                "ffmpeg_available": bool(FFMPEG_PATH),
                "download_dir": CONFIG.get("download_dir") or default_download_dir(),
                "workers": max(1, min(8, int(CONFIG.get("workers", 3)))),
            })
            return
        if path == "/api/jobs":
            with jobs_lock:
                active = [job_public(j) for j in jobs.values()]
                hist = list(history)
            # merge: active jobs first, then history entries not already active
            active_ids = {j["id"] for j in active}
            merged = active + [h for h in hist if h["id"] not in active_ids]
            self._json({"jobs": merged})
            return
        if path == "/api/config":
            cfg = dict(CONFIG)
            cfg["download_dir_resolved"] = CONFIG.get("download_dir") or default_download_dir()
            cfg["ffmpeg_available"] = bool(FFMPEG_PATH)
            cfg["yt_dlp_version"] = YTDLP_VERSION
            self._json({"config": cfg})
            return
        m = re.fullmatch(r"/api/jobs/([0-9a-f]{32})", path)
        if m:
            with jobs_lock:
                job = jobs.get(m.group(1))
            if not job:
                # maybe in history
                with jobs_lock:
                    job = next((h for h in history if h["id"] == m.group(1)), None)
                if not job:
                    self._json({"error": "Job not found"}, 404)
                    return
                self._json({"job": job})
                return
            self._json({"job": job_public(job)})
            return
        m = re.fullmatch(r"/api/jobs/([0-9a-f]{32})/file", path)
        if m:
            self._serve_file(m.group(1))
            return
        self._json({"error": "Not found"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path == "/api/jobs":
            data = self._read_json()
            urls = data.get("urls") or []
            if isinstance(urls, str):
                urls = [urls]
            urls = [u for u in urls if isinstance(u, str) and u.strip()]
            if not urls:
                self._json({"error": "Provide at least one URL."}, 400)
                return
            if len(urls) > 100:
                self._json({"error": "Maximum 100 URLs per submission."}, 400)
                return
            # per-request option overrides (validated)
            opts = data.get("options") or {}
            self._apply_request_options(opts)
            created = create_jobs(urls)
            self._json({"jobs": created}, 201)
            return
        m = re.fullmatch(r"/api/jobs/([0-9a-f]{32})/cancel", path)
        if m:
            job_id = m.group(1)
            with jobs_lock:
                job = jobs.get(job_id)
            if not job:
                self._json({"error": "Job not found"}, 404)
                return
            if job["status"] in TERMINAL_STATES:
                self._json({"job": job_public(job)})
                return
            ev = cancel_events.get(job_id)
            if ev:
                ev.set()
            with jobs_lock:
                job["status"] = "cancelled"
                job["finished_at"] = time.time()
                job["error"] = "Cancelled"
            _finish_job(job_id, "cancelled", short="Cancelled",
                        detail="Cancelled by user.")
            self._json({"job": job_public(jobs[job_id])})
            return
        if path == "/api/open-folder":
            target = CONFIG.get("download_dir") or default_download_dir()
            try:
                os.makedirs(target, exist_ok=True)
            except OSError as e:
                self._json({"error": f"Cannot create folder: {e}"}, 500)
                return
            try:
                if sys.platform.startswith("win"):
                    os.startfile(target)  # noqa: S606 - local path only
                elif sys.platform == "darwin":
                    subprocess.run(["open", target], check=False)
                else:
                    subprocess.run(["xdg-open", target], check=False)
                self._json({"ok": True, "folder": target})
            except Exception as e:
                self._json({"error": f"Could not open folder: {e}"}, 500)
            return
        if path == "/api/config":
            data = self._read_json()
            updated = {}
            for k in CONFIG_WRITABLE_KEYS:
                if k in data:
                    updated[k] = data[k]
            # validate
            if "workers" in updated:
                try:
                    updated["workers"] = max(1, min(8, int(updated["workers"])))
                except Exception:
                    updated.pop("workers")
            if "download_dir" in updated and not isinstance(updated["download_dir"], str):
                updated.pop("download_dir")
            CONFIG.update(updated)
            save_config(CONFIG)
            get_executor()  # re-size pool if workers changed
            self._json({"config": dict(CONFIG)})
            return
        self._json({"error": "Not found"}, 404)

    def do_DELETE(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        m = re.fullmatch(r"/api/jobs/([0-9a-f]{32})", path)
        if m:
            job_id = m.group(1)
            with jobs_lock:
                job = jobs.get(job_id)
                if not job:
                    self._json({"error": "Job not found"}, 404)
                    return
                if job["status"] not in TERMINAL_STATES:
                    self._json({"error": "Cannot remove an active job. Cancel it first."}, 409)
                    return
                del jobs[job_id]
            cancel_events.pop(job_id, None)
            self._json({"ok": True})
            return
        self._json({"error": "Not found"}, 404)

    def _apply_request_options(self, opts: dict):
        """Allow the website to override quality/mode per submission."""
        allowed = {}
        if opts.get("mode") in ("video", "audio"):
            allowed["mode"] = opts["mode"]
        if opts.get("quality") in ("best", "1080p", "720p", "480p"):
            allowed["quality"] = opts["quality"]
        if allowed:
            CONFIG.update(allowed)

    def _serve_file(self, job_id: str):
        with jobs_lock:
            job = jobs.get(job_id)
            snap = next((h for h in history if h["id"] == job_id), None)
        filepath = (job or {}).get("filepath") or (snap or {}).get("filepath")
        # history snapshots don't keep filepath; re-resolve from jobs/history
        if not filepath and snap:
            with jobs_lock:
                for h in history:
                    if h["id"] == job_id and h.get("filename"):
                        cand = os.path.join(
                            CONFIG.get("download_dir") or default_download_dir(),
                            h["filename"])
                        if os.path.exists(cand):
                            filepath = cand
                            break
        if not filepath or not os.path.exists(filepath):
            # last resort: look up live job record
            with jobs_lock:
                j = jobs.get(job_id)
                if j and j.get("filepath") and os.path.exists(j["filepath"]):
                    filepath = j["filepath"]
        if not filepath or not os.path.exists(filepath):
            self._json({"error": "File not available."}, 404)
            return
        # Security: only serve files inside the download directory.
        base = os.path.abspath(CONFIG.get("download_dir") or default_download_dir())
        if os.path.commonpath([base, os.path.abspath(filepath)]) != base:
            self._json({"error": "Forbidden."}, 403)
            return
        filename = os.path.basename(filepath)
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        try:
            size = os.path.getsize(filepath)
            self.send_response(200)
            self._send_cors()
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition",
                             f'attachment; filename="{filename}"')
            self.end_headers()
            with open(filepath, "rb") as f:
                shutil.copyfileobj(f, self.wfile, length=1024 * 256)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            log.warning("File serve failed: %s", e)


# --------------------------------------------------------------------------
# Startup
# --------------------------------------------------------------------------

def main(argv):
    port = DEFAULT_PORT
    if "--port" in argv:
        try:
            port = int(argv[argv.index("--port") + 1])
        except Exception:
            pass

    load_history()
    get_executor()

    print("=" * 60)
    print(f"  ASAD DOWNLOADER BRIDGE v{VERSION}")
    print("=" * 60)
    print(f"  Listening on http://{HOST}:{port}  (localhost only)")
    print(f"  Website: https://asadkharal91.github.io/asaddownloader.io/")
    print(f"  Downloads: {CONFIG.get('download_dir') or default_download_dir()}")
    print(f"  yt-dlp: {'available (' + str(YTDLP_VERSION) + ')' if YTDLP_AVAILABLE else 'MISSING - run install.bat'}")
    print(f"  FFmpeg: {'found' if FFMPEG_PATH else 'NOT FOUND - see README.md'}")
    print()
    print("  Keep this window open while using the website downloader.")
    print("=" * 60)

    if not YTDLP_AVAILABLE:
        log.error("yt-dlp is missing. Install it with: pip install -r requirements.txt")

    server = ThreadingHTTPServer((HOST, port), BridgeHandler)
    # Double-check we never listen publicly, even if HOST is edited wrongly.
    assert server.socket.getsockname()[0] == HOST, "Refusing to bind non-localhost!"
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main(sys.argv)
