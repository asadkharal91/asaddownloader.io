/* ==========================================================================
   Asad Downloader — website frontend (desktop-style dashboard)
   Static page (GitHub Pages) <-> local bridge at http://127.0.0.1:8765
   Workflow mirrors the desktop app: Paste Link -> queue -> Start All.
   ========================================================================== */
"use strict";

/* ---------------- configuration ---------------- */
const BRIDGE_BASE = "http://127.0.0.1:8765";
const BRIDGE_DOWNLOAD_URL = "https://github.com/asadkharal91/asaddownloader.io/releases";
const HEALTH_MS = 5000;
const JOBS_MS = 2000;

/* ---------------- state ---------------- */
let connected = false;
let jobsCache = [];
let healthInfo = null;
let settingsLoaded = false;
let pending = [];            // staged URLs not yet sent to the bridge
let smartMode = true;
try { smartMode = localStorage.getItem("ad-smart") !== "0"; } catch (e) {}

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
  const nl = $("navLinks");
  if (nl) nl.classList.remove("open");
  window.scrollTo({ top: 0 });
}

function goHomeAndScroll(id) {
  showView("home");
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
  const sv = e.target.closest("[data-subview]");
  if (sv) { showSubview(sv.getAttribute("data-subview")); return; }
});

function showSubview(name) {
  document.querySelectorAll(".subview").forEach((v) => v.classList.remove("active"));
  const el = $("sub-" + name);
  if (el) el.classList.add("active");
  document.querySelectorAll("[data-subview]").forEach((b) =>
    b.classList.toggle("active", b.getAttribute("data-subview") === name));
}

const navBurger = $("navBurger");
if (navBurger) navBurger.addEventListener("click", () => $("navLinks").classList.toggle("open"));

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

/* engine download buttons (class-based; works for dynamically added ones too) */
function wireEngineDls() {
  document.querySelectorAll(".engine-dl").forEach((el) => {
    el.href = BRIDGE_DOWNLOAD_URL; el.target = "_blank"; el.rel = "noopener";
  });
}
wireEngineDls();

/* ---------------- connection status ---------------- */
function renderConnection() {
  const on = connected;
  const nav = $("navStatus");
  if (nav) {
    nav.classList.toggle("is-on", on);
    nav.classList.toggle("is-off", !on);
    nav.querySelector(".lbl").textContent = on ? "● Connected" : "○ Not Connected";
  }
  const eb = $("engineBtn");
  if (eb) {
    eb.classList.toggle("is-on", on);
    eb.classList.toggle("is-off", !on);
    eb.querySelector(".lbl").textContent = on ? "● Engine Connected" : "○ Not Connected";
  }
  const hs = $("heroStatus");
  if (hs) {
    hs.classList.toggle("is-on", on);
    hs.classList.toggle("is-off", !on);
    hs.querySelector(".lbl").textContent = on ? "● Local engine connected" : "○ Local engine not detected";
  }
  const hh = $("heroStatusHint");
  if (hh) hh.textContent = on
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
    renderConnection();
    if (!was) { loadSettings(); refreshJobs(); }
  } catch (e) {
    if (connected) { connected = false; renderConnection(); }
    else renderConnection();
  }
}
$("checkAgainBtn").addEventListener("click", () => { toast("Checking for the local engine…"); checkHealth(); });
$("engineBtn").addEventListener("click", () => { toast("Checking for the local engine…"); checkHealth(); });

/* ---------------- queue: paste -> stage -> start ---------------- */
function shortUrl(u) {
  return u.length > 72 ? u.slice(0, 72) + "…" : u;
}

function addUrls(text) {
  const urls = String(text || "").split("\n").map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
  if (!urls.length) { toast("No URLs found. Copy a video link first.", true); return; }
  const seen = new Set(pending.map((p) => p.url));
  let added = 0;
  urls.forEach((u) => {
    if (!seen.has(u)) { seen.add(u); pending.push({ cid: "p" + Date.now() + "_" + added, url: u }); added++; }
  });
  if (!added) { toast("Those links are already in the queue.", true); return; }
  if (smartMode && connected) {
    startPending();
  } else {
    renderAll();
    toast(added + " link(s) added to the queue." +
      (smartMode && !connected ? " Engine is offline — they will wait here." : " Hit Start All when ready."));
  }
}

async function startPending() {
  if (!pending.length) { toast("Nothing to start — paste some links first.", true); return; }
  if (!connected) { toast("Start the local engine first (see the panel above).", true); return; }
  const urls = pending.map((p) => p.url);
  try {
    const data = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: urls,
        options: { mode: $("setMode").value, quality: $("setQuality").value },
      }),
    });
    const n = (data.jobs || []).length;
    pending = [];
    renderAll();
    refreshJobs();
    toast(n + " download(s) started on your local engine.");
  } catch (e) {
    toast("Could not start downloads: " + e.message, true);
  }
}

$("pasteBtn").addEventListener("click", async () => {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    $("manualPaste").hidden = false;
    toast("The browser blocked clipboard access — paste manually below.", true);
    return;
  }
  if (!text.trim()) { toast("Clipboard is empty. Copy a video link first.", true); return; }
  addUrls(text);
});

$("manualToggle").addEventListener("click", () => {
  $("manualPaste").hidden = !$("manualPaste").hidden;
});
$("manualAdd").addEventListener("click", () => {
  addUrls($("manualBox").value);
  $("manualBox").value = "";
});

function renderSmartBtn() {
  $("smartBtn").textContent = "Smart Mode: " + (smartMode ? "ON" : "OFF");
}
$("smartBtn").addEventListener("click", () => {
  smartMode = !smartMode;
  try { localStorage.setItem("ad-smart", smartMode ? "1" : "0"); } catch (e) {}
  renderSmartBtn();
  toast("Smart Mode " + (smartMode ? "ON — pasted links start instantly." : "OFF — pasted links wait for Start All."));
});
renderSmartBtn();

$("startAllBtn").addEventListener("click", startPending);

$("retryBtn").addEventListener("click", async () => {
  const failed = jobsCache.filter((j) => j.status === "failed");
  if (!failed.length) { toast("No failed downloads to retry.", true); return; }
  if (!connected) { toast("Start the local engine first.", true); return; }
  const urls = failed.map((j) => j.url);
  try {
    await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urls, options: { mode: $("setMode").value, quality: $("setQuality").value } }),
    });
    for (const j of failed) { try { await api("/api/jobs/" + j.id, { method: "DELETE" }); } catch (e) {} }
    toast(urls.length + " download(s) re-queued.");
    refreshJobs();
  } catch (e) { toast("Retry failed: " + e.message, true); }
});

async function clearFinished() {
  const done = jobsCache.filter((j) => ["completed", "failed", "cancelled"].includes(j.status));
  if (!done.length) { toast("Nothing to clear.", true); return; }
  for (const j of done) { try { await api("/api/jobs/" + j.id, { method: "DELETE" }); } catch (e) {} }
  toast("Cleared " + done.length + " finished job(s).");
  refreshJobs();
}
$("clearFinishedBtn").addEventListener("click", clearFinished);
$("clearHistoryBtn").addEventListener("click", clearFinished);

async function openFolder() {
  try {
    const d = await api("/api/open-folder", { method: "POST" });
    toast("Opened: " + (d.folder || "download folder"));
  } catch (e) { toast("Could not open folder: " + e.message, true); }
}
$("openFolderBtn").addEventListener("click", openFolder);

/* ---------------- jobs rendering ---------------- */
const TERMINAL = ["completed", "failed", "cancelled"];

function statusChip(s) {
  const map = {
    queued: "Queued", downloading: "Downloading", retrying: "Retrying",
    completed: "Completed", failed: "Failed", cancelled: "Cancelled",
  };
  return '<span class="chip ' + esc(s) + '">' + esc(map[s] || s) + "</span>";
}

function pendingRow(p) {
  return '<div class="qrow">' +
    '<div class="job-top"><div><div class="job-title">' + esc(shortUrl(p.url)) + "</div>" +
    '<div class="job-url">Waiting to start</div></div>' +
    '<div class="job-actions">' + statusChip("queued") +
    '<button class="mini-btn danger" data-unstage="' + esc(p.cid) + '">✕</button></div></div></div>';
}

function jobRow(j, inHistory) {
  const pct = Math.max(0, Math.min(100, Number(j.progress) || 0));
  let meta = "<span><b>" + pct.toFixed(0) + "%</b></span>";
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
    err = '<details class="job-err"><summary>' + esc(j.error) + "</summary>" +
      (j.error_detail ? "<p>" + esc(j.error_detail) + "</p>" : "") + "</details>";
  }

  return '<div class="qrow">' +
    '<div class="job-top"><div><div class="job-title">' + esc(j.title || shortUrl(j.url)) + "</div>" +
    '<div class="job-url">' + esc(j.url) + "</div></div>" +
    '<div class="job-actions">' + statusChip(j.status) + actions + "</div></div>" +
    '<div class="pbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
    '<div class="job-meta">' + meta + "</div>" + err +
    (inHistory ? '<div class="job-meta"><span>' + esc(fmtDate(j.finished_at || j.created_at)) + "</span></div>" : "") +
    "</div>";
}

function emptyQueueHtml() {
  return '<div class="empty-queue"><div class="big-arrow">↓</div>' +
    "<strong>No downloads yet</strong><span>Copy a video link, then click Paste Link above.</span></div>";
}

function renderAll() {
  const active = jobsCache.filter((j) => !TERMINAL.includes(j.status));
  const done = jobsCache.filter((j) => TERMINAL.includes(j.status));

  const q = $("queueList");
  const rows = pending.map(pendingRow).concat(active.map((j) => jobRow(j, false)));
  q.innerHTML = rows.length ? rows.join("") : emptyQueueHtml();

  const h = $("historyList");
  h.innerHTML = done.length ? done.map((j) => jobRow(j, true)).join("")
    : '<div class="empty-queue"><strong>No history yet</strong><span>' +
      (connected ? "Finished downloads will appear here." : "Start the local engine to see download history.") + "</span></div>";

  let a = 0, qu = 0, c = 0, f = 0;
  jobsCache.forEach((j) => {
    if (j.status === "downloading" || j.status === "retrying") a++;
    else if (j.status === "queued") qu++;
    else if (j.status === "completed") c++;
    else if (j.status === "failed") f++;
  });
  $("stActive").textContent = a;
  $("stQueued").textContent = qu + pending.length;
  $("stDone").textContent = c;
  $("stFailed").textContent = f;
  renderSingleProgress();
}

async function refreshJobs() {
  if (!connected) return;
  try {
    const data = await api("/api/jobs", {}, 8000);
    jobsCache = data.jobs || [];
    renderAll();
  } catch (e) { /* keep last render; next poll retries */ }
}

/* delegated job actions */
document.addEventListener("click", async (e) => {
  const unstage = e.target.closest("[data-unstage]");
  if (unstage) {
    pending = pending.filter((p) => p.cid !== unstage.getAttribute("data-unstage"));
    renderAll();
    return;
  }
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
  if (e.target.closest("[data-openfolder]")) { openFolder(); }
});

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
  return "<div><span>" + esc(k) + "</span><strong>" + v + "</strong></div>";
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

/* ---------------- single-link flow (home hero, greenhole-style) ---------------- */
let singleJobId = null;
let singleUrl = "";

function singleMsg(t, isErr) {
  const el = $("singleMsg");
  el.textContent = t || "";
  el.style.color = isErr ? "#ff6b6b" : "";
}

async function probeSingle() {
  const url = $("singleUrl").value.trim();
  if (!/^https?:\/\//i.test(url)) { singleMsg("Paste a valid video URL first.", true); return; }
  if (!connected) {
    singleMsg("");
    $("singleResult").innerHTML =
      '<div class="card warn-card"><h3>LOCAL DOWNLOADER REQUIRED</h3>' +
      "<p>Run the Asad Downloader Bridge on this PC first — then paste your link again.</p>" +
      '<p><a href="#" class="btn primary engine-dl">Download Local Engine</a></p></div>';
    wireEngineDls();
    return;
  }
  singleUrl = url; singleJobId = null;
  singleMsg("Reading video info…");
  $("singleResult").innerHTML = "";
  $("singleGo").disabled = true;
  try {
    const d = await api("/api/probe", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    }, 60000);
    singleMsg("");
    renderVideoCard(d.video);
  } catch (e) {
    singleMsg("Couldn't read that link: " + e.message, true);
  } finally {
    $("singleGo").disabled = false;
  }
}

$("singleGo").addEventListener("click", probeSingle);
$("singleUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") probeSingle(); });

function renderVideoCard(v) {
  const qs = ["2160p", "1080p", "720p", "480p", "360p"];
  $("singleResult").innerHTML =
    '<div class="video-card">' +
    (v.thumbnail ? '<img src="' + esc(v.thumbnail) + '" alt="">' : "") +
    '<div class="vc-body"><h4>' + esc(v.title) + "</h4>" +
    '<div class="vc-meta">' + esc([v.uploader, v.duration_str].filter(Boolean).join(" · ")) + "</div>" +
    '<div class="qbtns">' +
    qs.map((q) => '<button class="qbtn" data-q="' + q + '">' + (q === "2160p" ? "4K" : q) + "</button>").join("") +
    '<button class="qbtn mp3" data-q="audio">MP3</button>' +
    '</div><div class="vc-progress" id="vcProg"></div></div></div>';
}

document.addEventListener("click", async (e) => {
  const qb = e.target.closest("[data-q]");
  if (!qb || !qb.closest("#singleResult")) return;
  const q = qb.getAttribute("data-q");
  qb.disabled = true;
  const prog = $("vcProg");
  prog.innerHTML = '<div class="pbar"><i style="width:0%"></i></div><div class="job-meta"><span>Starting…</span></div>';
  try {
    const d = await api("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls: [singleUrl],
        options: q === "audio" ? { mode: "audio", quality: "best" } : { mode: "video", quality: q },
      }),
    }, 15000);
    singleJobId = (d.jobs || [])[0] && d.jobs[0].id;
    refreshJobs();
  } catch (err) {
    prog.innerHTML = '<div class="job-err"><summary>Could not start: ' + esc(err.message) + "</summary></div>";
    qb.disabled = false;
  }
});

function renderSingleProgress() {
  if (!singleJobId) return;
  const box = $("vcProg");
  if (!box) return;
  const j = jobsCache.find((x) => x.id === singleJobId);
  if (!j) return;
  const pct = Math.max(0, Math.min(100, Number(j.progress) || 0));
  if (j.status === "completed" && j.has_file) {
    box.innerHTML = '<div class="job-meta"><span>Saved to your PC' +
      (j.filename ? ": <b>" + esc(j.filename) + "</b>" : "") + "</span></div>" +
      '<div class="row gap" style="margin-top:8px"><a class="mini-btn" href="' + BRIDGE_BASE + "/api/jobs/" + esc(j.id) + '/file">Get File</a>' +
      '<button class="mini-btn" data-openfolder="1">Open Folder</button> ' +
      '<button class="link-btn" id="singleAgain">Download another</button></div>';
    singleJobId = null;
    $("singleAgain").addEventListener("click", () => {
      $("singleResult").innerHTML = ""; $("singleUrl").value = ""; $("singleUrl").focus();
    });
  } else if (j.status === "failed" || j.status === "cancelled") {
    box.innerHTML = '<div class="job-err"><summary>' + esc(j.error || j.status) + "</summary></div>";
    singleJobId = null;
  } else {
    box.innerHTML = '<div class="pbar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="job-meta"><span><b>' + pct.toFixed(0) + "%</b></span>" +
      (j.speed ? "<span>" + esc(j.speed) + "</span>" : "") +
      (j.eta != null ? "<span>ETA " + esc(fmtEta(j.eta)) + "</span>" : "") + "</div>";
  }
}

/* ---------------- boot ---------------- */
renderAll();
renderConnection();
checkHealth();
setInterval(checkHealth, HEALTH_MS);
setInterval(refreshJobs, JOBS_MS);
