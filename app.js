/* ==========================================================================
   Asad Downloader — website frontend
   Static page (GitHub Pages) <-> local bridge at http://127.0.0.1:8765
   The website NEVER downloads anything itself; the bridge on the user's
   own PC does all the work via yt-dlp + FFmpeg.
   ========================================================================== */
"use strict";

/* ---------------- configuration ---------------- */
// ASAD: when you publish the bridge EXE as a GitHub Release, you can point
// this at the direct asset URL. The releases page works fine as-is too.
const BRIDGE_BASE = "http://127.0.0.1:8765";
const BRIDGE_DOWNLOAD_URL = "https://github.com/asadkharal91/asaddownloader.io/releases";
const HEALTH_MS = 5000;
const JOBS_MS = 2000;

/* ---------------- state ---------------- */
let connected = false;
let jobsCache = [];
let healthInfo = null;
let settingsLoaded = false;

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

let toastTimer = null;
function toast(msg, isErr) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

async function api(path, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  try {
    const res = await fetch(BRIDGE_BASE + path, Object.assign({ signal: ctrl.signal }, opts || {}));
    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON */ }
    if (!res.ok) throw new Error((data && data.error) || ("Request failed (" + res.status + ")"));
    return data;
  } finally {
    clearTimeout(t);
  }
}

function fmtBytes(n) {
  if (n == null || isNaN(n)) return "—";
  n = Number(n);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return n.toFixed(n < 10 && u > 0 ? 1 : 0) + " " + units[u];
}

function fmtEta(sec) {
  if (sec == null || isNaN(sec)) return "—";
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  if (h > 0) return h + "h " + (m % 60) + "m";
  return m + "m " + (sec % 60) + "s";
}

function fmtDate(ts) {
  if (!ts) return "—";
  try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return "—"; }
}

/* ---------------- navigation ---------------- */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const el = $("view-" + name);
  if (el) el.classList.add("active");
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("data-nav") === name));
  $("navLinks").classList.remove("open");
  window.scrollTo({ top: 0 });
}

function goHomeAndScroll(id) {
  showView("home");
  // wait a tick for the view to display, then scroll
  setTimeout(() => {
    const el = $(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) { e.preventDefault(); showView(nav.getAttribute("data-nav")); return; }
  const sc = e.target.closest("[data-scroll]");
  if (sc) { e.preventDefault(); goHomeAndScroll(sc.getAttribute("data-scroll")); return; }
});

$("navBurger").addEventListener("click", () => $("navLinks").classList.toggle("open"));

/* tabs */
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    document.querySelectorAll(".tabpane").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("tab-" + t.getAttribute("data-tab")).classList.add("active");
  });
});

/* theme */
function applyTheme(th) {
  document.documentElement.setAttribute("data-theme", th);
  try { localStorage.setItem("ad-theme", th); } catch (e) {}
}
$("themeToggle").addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
});
try {
  const saved = localStorage.getItem("ad-theme");
  if (saved === "light" || saved === "dark") applyTheme(saved);
} catch (e) {}

/* engine download buttons */
["heroEngineBtn", "dlEngineBtn", "dlEngineBtn2"].forEach((id) => {
  const el = $(id);
  if (el) { el.href = BRIDGE_DOWNLOAD_URL; el.target = "_blank"; el.rel = "noopener"; }
});

/* mobile note */
(function () {
  let dismissed = false;
  try { dismissed = localStorage.getItem("ad-mobile-note") === "1"; } catch (e) {}
  if (!dismissed && window.innerWidth < 640) $("mobileNote").hidden = false;
  $("mobileNoteX").addEventListener("click", () => {
    $("mobileNote").hidden = true;
    try { localStorage.setItem("ad-mobile-note", "1"); } catch (e) {}
  });
})();

/* ---------------- connection status ---------------- */
function setPill(el, state, label) {
  if (!el) return;
  el.classList.remove("is-on", "is-off");
  el.classList.add(state === "on" ? "is-on" : "is-off");
  el.querySelector(".lbl").textContent = label;
}

function renderConnection() {
  const on = connected;
  const label = on ? "● Connected" : "○ Not Connected";
  setPill($("navStatus"), on ? "on" : "off", on ? "● Connected" : "○ Not Connected");
  setPill($("dashStatus"), on ? "on" : "off", label);
  setPill($("heroStatus"), on ? "on" : "off", on ? "● Local engine connected" : "○ Local engine not detected");
  $("heroStatusHint").textContent = on
    ? "The Asad Downloader engine is running on this computer. Open the Downloader and paste your links."
    : "Install and run the Asad Downloader Bridge on this computer, then this will turn green automatically.";
  $("notConnected").hidden = on;
  $("dashMain").hidden = !on;
}

async function checkHealth() {
  try {
    const h = await api("/api/health", {}, 3500);
    const was = connected;
    connected = true;
    healthInfo = h;
    if (!was) { renderConnection(); loadSettings(); refreshJobs(); }
    else renderConnection();
  } catch (e) {
    if (connected) { connected = false; renderConnection(); }
    else { setPill($("navStatus"), "off", "○ Not Connected"); setPill($("heroStatus"), "off", "○ Local engine not detected"); setPill($("dashStatus"), "off", "○ Not Connected"); }
  }
}
$("checkAgainBtn").addEventListener("click", () => { toast("Checking for the local engine…"); checkHealth(); });

/* ---------------- jobs ---------------- */
const TERMINAL = ["completed", "failed", "cancelled"];

function statusChip(s) {
  const map = {
    queued: "Queued", downloading: "Downloading", retrying: "Retrying",
    completed: "Completed", failed: "Failed", cancelled: "Cancelled",
  };
  return '<span class="chip ' + esc(s) + '">' + esc(map[s] || s) + "</span>";
}

function jobCard(j, inHistory) {
  const pct = Math.max(0, Math.min(100, Number(j.progress) || 0));
  let meta = '<span><b>' + pct.toFixed(0) + '%</b></span>';
  if (j.speed) meta += "<span>Speed <b>" + esc(j.speed) + "</b></span>";
  if (j.eta != null) meta += "<span>ETA <b>" + esc(fmtEta(j.eta)) + "</b></span>";
  if (j.downloaded_bytes || j.total_bytes)
    meta += "<span><b>" + esc(fmtBytes(j.downloaded_bytes)) + "</b> / " + esc(fmtBytes(j.total_bytes)) + "</span>";
  if (j.filename) meta += "<span>" + esc(j.filename) + "</span>";
  if (j.attempt > 1) meta += "<span>Attempt <b>" + j.attempt + "</b></span>";

  let actions = "";
  if (!TERMINAL.includes(j.status)) {
    actions = '<button class="mini-btn danger" data-cancel="' + esc(j.id) + '">Cancel</button>';
  } else {
    if (j.status === "completed" && j.has_file)
      actions += '<a class="mini-btn" href="' + BRIDGE_BASE + "/api/jobs/" + esc(j.id) + '/file">Get File</a>';
    actions += '<button class="mini-btn" data-openfolder="1">Open Folder</button>';
    actions += '<button class="mini-btn danger" data-remove="' + esc(j.id) + '">Remove</button>';
  }

  let err = "";
  if (j.error) {
    err = '<details class="job-err"><summary>' + esc(j.error) + '</summary>' +
      (j.error_detail ? "<p>" + esc(j.error_detail) + "</p>" : "") +
      '<p><button class="link-btn" data-details="' + esc(j.id) + '">View Details</button></p></details>';
  }

  return '<div class="card job">' +
    '<div class="job-top"><div><div class="job-title">' + esc(j.title || j.url) + "</div>" +
    '<div class="job-url">' + esc(j.url) + "</div></div>" +
    '<div class="job-actions">' + statusChip(j.status) + actions + "</div></div>" +
    '<div class="pbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    '<div class="job-meta">' + meta + "</div>" + err +
    (inHistory ? '<div class="job-meta"><span>' + esc(fmtDate(j.finished_at || j.created_at)) + "</span></div>" : "") +
    "</div>";
}

function renderJobs() {
  const active = jobsCache.filter((j) => !TERMINAL.includes(j.status));
  const done = jobsCache.filter((j) => TERMINAL.includes(j.status));

  const q = $("queueList");
  q.innerHTML = active.length
    ? active.map((j) => jobCard(j, false)).join("")
    : '<p class="empty">No downloads yet. Paste some URLs above and hit <strong>Start Download</strong>.</p>';

  const h = $("historyList");
  h.innerHTML = done.length
    ? done.map((j) => jobCard(j, true)).join("")
    : '<p class="empty">Nothing here yet.</p>';
  $("historyCount").textContent = done.length ? done.length + " job(s)" : "";

  // stats
  let a = 0, qu = 0, c = 0, f = 0;
  jobsCache.forEach((j) => {
    if (j.status === "downloading" || j.status === "retrying") a++;
    else if (j.status === "queued") qu++;
    else if (j.status === "completed") c++;
    else if (j.status === "failed") f++;
  });
  $("stActive").textContent = a;
  $("stQueued").textContent = qu;
  $("stDone").textContent = c;
  $("stFailed").textContent = f;
}

async function refreshJobs() {
  if (!connected) return;
  try {
    const data = await api("/api/jobs", {}, 8000);
    jobsCache = data.jobs || [];
    renderJobs();
  } catch (e) { /* keep last render; next poll retries */ }
}

/* delegated job actions */
document.addEventListener("click", async (e) => {
  const cancelBtn = e.target.closest("[data-cancel]");
  if (cancelBtn) {
    const id = cancelBtn.getAttribute("data-cancel");
    cancelBtn.disabled = true;
    try { await api("/api/jobs/" + id + "/cancel", { method: "POST" }); toast("Download cancelled."); }
    catch (err) { toast("Cancel failed: " + err.message, true); }
    refreshJobs();
    return;
  }
  const rmBtn = e.target.closest("[data-remove]");
  if (rmBtn) {
    const id = rmBtn.getAttribute("data-remove");
    try { await api("/api/jobs/" + id, { method: "DELETE" }); }
    catch (err) { toast("Remove failed: " + err.message, true); }
    refreshJobs();
    return;
  }
  if (e.target.closest("[data-openfolder]")) { openFolder(); return; }
  const detBtn = e.target.closest("[data-details]");
  if (detBtn) {
    const id = detBtn.getAttribute("data-details");
    try {
      const d = await api("/api/jobs/" + id);
      const j = d.job || {};
      toast("Job " + id.slice(0, 8) + " · status=" + j.status +
        (j.error_detail ? " · " + j.error_detail : ""));
    } catch (err) { toast("Details unavailable: " + err.message, true); }
  }
});

async function openFolder() {
  try {
    const d = await api("/api/open-folder", { method: "POST" });
    toast("Opened: " + (d.folder || "download folder"));
  } catch (e) { toast("Could not open folder: " + e.message, true); }
}
$("openFolderBtn").addEventListener("click", openFolder);

/* submit */
$("startBtn").addEventListener("click", async () => {
  const raw = $("urlBox").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!raw.length) { toast("Paste at least one URL first.", true); return; }
  if (raw.length > 100) { toast("Maximum 100 URLs per submission.", true); return; }
  const btn = $("startBtn");
  btn.disabled = true;
  btn.textContent = "Sending…";
  try {
    const data = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: raw,
        options: { mode: $("optMode").value, quality: $("optQuality").value },
      }),
    });
    const n = (data.jobs || []).length;
    $("urlBox").value = "";
    toast(n + " job(s) sent to your local engine.");
    // jump to queue tab
    document.querySelector('.tab[data-tab="queue"]').click();
    refreshJobs();
  } catch (e) {
    toast("Could not start downloads: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Start Download";
  }
});
$("clearBtn").addEventListener("click", () => { $("urlBox").value = ""; $("urlBox").focus(); });

/* ---------------- settings ---------------- */
async function loadSettings() {
  try {
    const d = await api("/api/config");
    const c = d.config || {};
    settingsLoaded = true;
    $("setMode").value = c.mode || "video";
    $("setQuality").value = c.quality || "best";
    $("setWorkers").value = c.workers || 3;
    $("workersVal").textContent = c.workers || 3;
    $("workersWarn").hidden = (c.workers || 3) <= 4;
    $("setDir").value = c.download_dir || "";
    $("setTemplate").value = c.filename_template || "%(title)s.%(ext)s";
    $("setOrganize").checked = !!c.organize_by_uploader;
    $("setRetries").value = c.retries != null ? c.retries : 3;
    $("setRetryDelay").value = c.retry_delay != null ? c.retry_delay : 10;
    $("setCookies").checked = !!c.use_browser_cookies;
    $("setBrowser").value = c.browser || "chrome";
    $("optMode").value = c.mode || "video";
    $("optQuality").value = c.quality || "best";
    // bridge info
    const h = healthInfo || {};
    $("bridgeInfo").innerHTML =
      infoRow("Bridge version", "v" + esc(h.version || "?")) +
      infoRow("yt-dlp", h.yt_dlp_available ? esc("available (" + h.yt_dlp + ")") : "MISSING") +
      infoRow("FFmpeg", h.ffmpeg_available ? "found" : "NOT FOUND") +
      infoRow("Download folder", esc(c.download_dir_resolved || c.download_dir || "—")) +
      infoRow("Listening on", "127.0.0.1:8765 (localhost only)");
  } catch (e) { /* not connected yet */ }
}
function infoRow(k, v) {
  return '<div><span>' + esc(k) + "</span><strong>" + v + "</strong></div>";
}

$("setWorkers").addEventListener("input", (e) => {
  $("workersVal").textContent = e.target.value;
  $("workersWarn").hidden = Number(e.target.value) <= 4;
});

$("saveSettingsBtn").addEventListener("click", async () => {
  const payload = {
    mode: $("setMode").value,
    quality: $("setQuality").value,
    workers: Number($("setWorkers").value),
    download_dir: $("setDir").value.trim(),
    filename_template: $("setTemplate").value.trim() || "%(title)s.%(ext)s",
    organize_by_uploader: $("setOrganize").checked,
    retries: Number($("setRetries").value),
    retry_delay: Number($("setRetryDelay").value),
    use_browser_cookies: $("setCookies").checked,
    browser: $("setBrowser").value,
  };
  $("settingsMsg").textContent = "Saving…";
  try {
    await api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    $("settingsMsg").textContent = "Saved.";
    toast("Settings saved on your local engine.");
    setTimeout(() => { $("settingsMsg").textContent = ""; }, 2500);
  } catch (e) {
    $("settingsMsg").textContent = "";
    toast("Save failed: " + e.message, true);
  }
});

/* ---------------- boot ---------------- */
renderConnection();
checkHealth();
setInterval(checkHealth, HEALTH_MS);
setInterval(refreshJobs, JOBS_MS);
