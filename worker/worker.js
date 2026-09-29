/**
 * Asad Downloader - zero-install online resolver
 *
 * The Worker resolves public media URLs through SaveAPI.
 * It does not store video files or run FFmpeg.
 * Required Worker secret: SAVEAPI_KEY
 */

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function cors(origin) {
  const allowed = origin && (
    origin === "https://asadkharal91.github.io" ||
    origin.endsWith(".github.io")
  );
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...cors(origin) },
  });
}

function pickMedia(data, quality, mode) {
  const items = Array.isArray(data?.medias) ? data.medias : [];
  if (!items.length) return null;

  const wantedAudio = mode === "audio";
  let candidates = items.filter((item) => {
    const type = String(item.type || "").toLowerCase();
    const ext = String(item.ext || "").toLowerCase();
    if (wantedAudio) return type === "audio" || ["mp3","m4a","ogg","wav","opus"].includes(ext);
    return type === "video" || ["mp4","webm","mkv","mov"].includes(ext);
  });

  if (!candidates.length) candidates = items.slice();
  candidates = candidates.filter((item) => /^https?:\\/\\//i.test(String(item?.url || "")));
  if (!candidates.length) return null;

  if (quality !== "best") {
    const target = Number(quality);
    if (Number.isFinite(target)) {
      const withHeight = candidates.filter((x) => Number(x.height) > 0);
      if (withHeight.length) {
        const below = withHeight.filter((x) => Number(x.height) <= target);
        const pool = below.length ? below : withHeight;
        pool.sort((a,b) => Math.abs(Number(a.height)-target) - Math.abs(Number(b.height)-target));
        return pool[0];
      }
    }
  }

  candidates.sort((a,b) => Number(b.size_mb || 0) - Number(a.size_mb || 0));
  return candidates[0];
}

async function resolveOne(url, env, options) {
  const endpoint = "https://api.saveapi.org/v1/download?url=" + encodeURIComponent(url);
  const response = await fetch(endpoint, {
    headers: {
      "Authorization": "Bearer " + env.SAVEAPI_KEY,
      "Accept": "application/json",
    },
  });

  let data = null;
  try { data = await response.json(); } catch (_) {}

  if (!response.ok) {
    return {
      ok: false,
      url,
      status: response.status,
      error: data?.error || data?.message || ("Provider error " + response.status),
      retryAfter: Number(response.headers.get("Retry-After") || 0) || null,
    };
  }

  const media = pickMedia(data, options.quality, options.mode);
  if (!media) return { ok:false, url, status:422, error:"No public media was returned." };

  const title = data?.meta?.title || data?.title || "";
  const fallbackName = title ? title + "." + (media.ext || "mp4") : "download." + (media.ext || "mp4");
  return {
    ok: true,
    url,
    title,
    author: data?.meta?.author || data?.author || "",
    downloadUrl: media.url,
    filename: media.filename || data?.filename || fallbackName,
    ext: media.ext || "",
    sizeMb: media.size_mb || null,
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status:204, headers:cors(origin) });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok:true, mode:"online", provider:"saveapi" }, 200, origin);
    }

    if (url.pathname !== "/api/resolve-batch" || request.method !== "POST") {
      return json({ ok:false, error:"Not found." }, 404, origin);
    }

    if (!env.SAVEAPI_KEY) {
      return json({ ok:false, error:"SAVEAPI_KEY is not configured on the Worker." }, 500, origin);
    }

    let body;
    try { body = await request.json(); } catch (_) {
      return json({ ok:false, error:"Invalid JSON." }, 400, origin);
    }

    let urls = Array.isArray(body?.urls) ? body.urls : [];
    urls = urls.filter((x) => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => /^https?:\\/\\//i.test(x));

    if (!urls.length) return json({ ok:false, error:"No valid URLs supplied." }, 400, origin);
    if (urls.length > 10) {
      return json({ ok:false, error:"Maximum 10 URLs per online batch.", retryAfter:60 }, 429, origin);
    }

    const mode = body?.mode === "audio" ? "audio" : "video";
    const quality = ["best","1080","720","480"].includes(String(body?.quality)) ? String(body.quality) : "best";
    const results = await Promise.all(urls.map((u) => resolveOne(u, env, { mode, quality })));

    const limited = results.find((r) => r.status === 429);
    if (limited) return json({
      ok:false,
      error:"Provider rate limit reached. Wait and retry.",
      retryAfter:limited.retryAfter || 60,
      results,
    }, 429, origin);

    return json({ ok:true, results }, 200, origin);
  },
};
