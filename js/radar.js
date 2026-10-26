// Full-screen animated weather background: rain radar (BOM per-site images,
// falling back to RainViewer tiles) or Himawari cloud satellite (NASA GIBS
// tiles), drawn over an Esri gray-canvas basemap (place-name labels drawn above the weather) in a fixed layer behind the planner.
// See docs/ARCHITECTURE.md "Radar / satellite background".
//
// Everything is plain <img> loads (no fetch/canvas of BOM images - they send
// no CORS headers) positioned in Web-Mercator "world pixel" space around the
// current location, so all sources share one georeferencing model. Any
// failure just leaves the (static) basemap or nothing - never blocks the
// planner.
(function () {
  "use strict";

  const TILE = 256;
  const BOM_ORIGIN = "https://reg.bom.gov.au";
  const ESRI_BASE = "https://server.arcgisonline.com/ArcGIS/rest/services";
  const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
  const GIBS_LAYER = "Himawari_AHI_Band13_Clean_Infrared";
  const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
  const REFRESH_MS = 5 * 60 * 1000; // BOM radar cadence
  const FRAME_MS = 700;
  const HOLD_MS = 2000;
  const MIN = 60 * 1000;
  const LS_MODE = "fishingSolunar.radarMode"; // "off" | "radar" | "satellite"
  const LS_OPACITY = "fishingSolunar.radarOpacity"; // 0.1 - 1
  const LS_RANGE = "fishingSolunar.radarRange"; // 64 | 128 | 256 | 512 (km)
  const LS_PRODUCT = "fishingSolunar.radarProduct"; // "now" | "since9am" | "24h"
  const RANGES = [64, 128, 256, 512];
  // BOM product code suffixes: reflectivity is IDR<site><1|2|3|4> (512/256/128/64 km);
  // the rainfall-accumulation products only exist at 128 km.
  const RANGE_SUFFIX = { 512: "1", 256: "2", 128: "3", 64: "4" };
  const PRODUCTS = {
    now: { label: "rain radar", stepMs: 5 * MIN, keepMs: 80 * MIN },
    since9am: { suffix: "C", label: "rainfall since 9am", stepMs: 60 * MIN, minute: 15, keepMs: 12 * 60 * MIN, count: 8 },
    "24h": { suffix: "D", label: "24-hour rainfall", stepMs: 24 * 60 * MIN, minute: 0, hourUtc: 23, keepMs: 9 * 24 * 60 * MIN, count: 7 },
  };
  const DEFAULT_MODE = "radar";
  const DEFAULT_OPACITY = 0.95;
  // BOM radar frames have a copyright banner (top) and a timestamp/legend
  // strip (bottom) baked in; crop them out of the full-screen view (the
  // attribution is shown in the page footer instead).
  const BOM_CROP = "inset(5% 0 6% 0)";

  const state = {
    mode: DEFAULT_MODE,
    opacity: DEFAULT_OPACITY,
    range: 128,
    product: "now",
    lat: NaN,
    lon: NaN,
    gen: 0,
    lastBuild: 0,
    frames: [],
    idx: 0,
    animTimer: null,
    bom: { siteId: null, frames: new Map() },
    els: null,
  };

  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtBom(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
  }
  function fmtIso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }
  function fmtLocalDate(ms) {
    return new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }
  function fmtLocalTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function readPrefs() {
    try {
      const m = localStorage.getItem(LS_MODE);
      if (m === "off" || m === "radar" || m === "satellite") state.mode = m;
      const o = parseFloat(localStorage.getItem(LS_OPACITY));
      if (o >= 0.1 && o <= 1) state.opacity = o;
      const r = parseInt(localStorage.getItem(LS_RANGE), 10);
      if (RANGES.includes(r)) state.range = r;
      const p = localStorage.getItem(LS_PRODUCT);
      if (PRODUCTS[p]) state.product = p;
    } catch (e) { /* localStorage unavailable - keep defaults */ }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
  }

  // ---------- geometry ----------
  const EARTH_M_PER_PX_Z0 = 156543.03392;
  function resolution(z, lat) {
    return EARTH_M_PER_PX_Z0 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z);
  }
  function project(lat, lon, z) {
    const n = TILE * Math.pow(2, z);
    const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
    return {
      x: (lon + 180) / 360 * n,
      y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
    };
  }
  function distanceKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
  }
  // Picks the tile zoom + CSS scale so `spanKm` spans the viewport's larger
  // dimension (i.e. the picture fills the screen), centred on the location.
  function layoutFor(spanKm, zMax) {
    const vw = window.innerWidth || 800;
    const vh = window.innerHeight || 600;
    const mpp = spanKm * 1000 / Math.max(vw, vh);
    const ideal = Math.log2(EARTH_M_PER_PX_Z0 * Math.cos(state.lat * Math.PI / 180) / mpp);
    const z = Math.max(3, Math.min(zMax, Math.round(ideal)));
    const scale = resolution(z, state.lat) / mpp;
    const c = project(state.lat, state.lon, z);
    return { z, scale, cx: c.x, cy: c.y, vw, vh };
  }
  function tileRange(L) {
    const halfW = L.vw / 2 / L.scale + TILE;
    const halfH = L.vh / 2 / L.scale + TILE;
    const n = Math.pow(2, L.z);
    return {
      x0: Math.floor((L.cx - halfW) / TILE),
      x1: Math.floor((L.cx + halfW) / TILE),
      y0: Math.max(0, Math.floor((L.cy - halfH) / TILE)),
      y1: Math.min(n - 1, Math.floor((L.cy + halfH) / TILE)),
      n,
    };
  }
  function makeTiles(L, urlFn) {
    const r = tileRange(L);
    const frag = document.createDocumentFragment();
    for (let ty = r.y0; ty <= r.y1; ty++) {
      for (let tx = r.x0; tx <= r.x1; tx++) {
        const wrapped = ((tx % r.n) + r.n) % r.n;
        const img = document.createElement("img");
        img.className = "radar-tile";
        img.alt = "";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.draggable = false;
        img.style.left = `${tx * TILE - L.cx}px`;
        img.style.top = `${ty * TILE - L.cy}px`;
        img.onerror = () => { img.style.display = "none"; };
        img.src = urlFn(wrapped, ty, L.z);
        frag.appendChild(img);
      }
    }
    return frag;
  }

  // ---------- DOM ----------
  function ensureDom() {
    if (state.els) return state.els;
    const bg = document.createElement("div");
    bg.id = "radarBg";
    bg.className = "radar-bg no-print";
    bg.setAttribute("aria-hidden", "true");
    bg.hidden = true;
    const map = document.createElement("div");
    map.className = "radar-map";
    const base = document.createElement("div");
    base.className = "radar-layer";
    const overlay = document.createElement("div");
    overlay.className = "radar-layer";
    const ref = document.createElement("div");
    ref.className = "radar-layer";
    map.append(base, overlay, ref);
    bg.appendChild(map);
    document.body.insertBefore(bg, document.body.firstChild);
    state.els = { bg, map, base, overlay, ref, caption: document.getElementById("radarCaption") };
    bg.style.opacity = String(state.opacity);
    return state.els;
  }
  function setCaption(text) {
    const els = ensureDom();
    if (!els.caption) els.caption = document.getElementById("radarCaption");
    if (els.caption) {
      els.caption.textContent = text;
      els.caption.hidden = !text;
    }
  }
  function applyScale(L) {
    state.els.map.style.transform = `scale(${L.scale})`;
  }
  function renderBasemap(L, coastlines) {
    const kind = document.documentElement.getAttribute("data-theme") === "dark" ? "Dark" : "Light";
    const esri = (layer) => (x, y, z) => `${ESRI_BASE}/Canvas/World_${kind}_Gray_${layer}/MapServer/tile/${z}/${y}/${x}`;
    state.els.base.replaceChildren(makeTiles(L, esri("Base")));
    state.els.ref.replaceChildren(makeTiles(L, esri("Reference")));
    // Opaque cloud imagery hides the basemap, so draw coastlines/borders on top.
    if (coastlines) {
      const lines = makeTiles(L, (x, y, z) => `${GIBS_BASE}/Coastlines/default/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png`);
      const wrap = document.createElement("div");
      wrap.className = "radar-coast";
      wrap.appendChild(lines);
      state.els.ref.appendChild(wrap);
    }
    applyScale(L);
  }

  // ---------- animation ----------
  function stopAnim() {
    clearTimeout(state.animTimer);
    state.animTimer = null;
  }
  function showFrame(i) {
    state.idx = i;
    state.frames.forEach((f, j) => f.el.classList.toggle("on", j === i));
    const f = state.frames[i];
    if (f) setCaption(`${f.label} \u00B7 ${f.daily ? "to " + fmtLocalDate(f.t) : fmtLocalTime(f.t)}`);
  }
  function startAnim() {
    stopAnim();
    const n = state.frames.length;
    if (!n) return;
    showFrame(n - 1);
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (n < 2 || reduced || document.hidden) return;
    const step = () => {
      if (document.hidden) { state.animTimer = null; return; }
      const next = (state.idx + 1) % n;
      showFrame(next);
      state.animTimer = setTimeout(step, next === n - 1 ? HOLD_MS : FRAME_MS);
    };
    state.animTimer = setTimeout(step, HOLD_MS);
  }

  // ---------- sources ----------
  function loadImage(url, timeoutMs) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.className = "radar-frame radar-frame-img";
      img.alt = "";
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        img.onload = img.onerror = null;
        resolve(ok ? img : null);
      };
      const timer = setTimeout(() => finish(false), timeoutMs || 8000);
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    });
  }

  // Rainfall-accumulation products are only published at 128 km.
  function effectiveRange() {
    return state.product === "now" ? state.range : 128;
  }

  function nearestBomSite() {
    if (typeof BOM_RADAR_SITES === "undefined") return null;
    let best = null;
    let bestD = Infinity;
    for (const s of BOM_RADAR_SITES) {
      const d = distanceKm(state.lat, state.lon, s.lat, s.lon);
      if (d < bestD) { best = s; bestD = d; }
    }
    // Needs the location well inside the 128 km circle to be worth showing.
    return best && bestD <= effectiveRange() * 0.85 ? best : null;
  }

  // BOM publishes no machine-readable frame list (the loop page isn't
  // CORS-readable and BOM blocks scraping), so frame times are probed:
  // minute-by-minute for the newest one, then at the 5-minute cadence back
  // from it. Already-found frames are reused between refreshes.
  async function fetchBom(site) {
    const prod = PRODUCTS[state.product];
    const code = prod.suffix ? site.id + prod.suffix : site.id + RANGE_SUFFIX[effectiveRange()];
    const cacheId = `${site.id}/${code}`;
    const cache = state.bom.siteId === cacheId ? state.bom.frames : new Map();
    state.bom = { siteId: cacheId, frames: cache };
    const now = Date.now();
    for (const [k, f] of cache) if (now - f.t > prod.keepMs) cache.delete(k);

    const probe = async (t) => {
      if (t > now) return false;
      const key = fmtBom(t);
      if (cache.has(key)) return true;
      const img = await loadImage(`${BOM_ORIGIN}/radar/${code}.T.${key}.png`);
      if (img) cache.set(key, { t, img });
      return !!img;
    };
    const newestMs = () => Math.max(0, ...[...cache.values()].map((f) => f.t));

    if (prod.suffix) {
      // Rainfall products publish on a fixed schedule (hourly at :15, or
      // daily at 23:00 UTC = 9am AEST), so candidates are computed directly.
      const d = new Date(now);
      let t;
      if (prod.hourUtc != null) {
        t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), prod.hourUtc, 0);
      } else {
        t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), prod.minute);
      }
      while (t > now) t -= prod.stepMs;
      const cands = [];
      for (let k = 0; k < prod.count + 1; k++) cands.push(t - k * prod.stepMs);
      await Promise.all(cands.map(probe));
    } else {
      let newest = newestMs();
      const floorMin = Math.floor(now / MIN) * MIN;
      const first = [];
      if (newest) {
        for (let m = 4; m <= 7; m++) first.push(newest + m * MIN);
      } else {
        for (let m = 0; m <= 16; m++) first.push(floorMin - m * MIN);
      }
      await Promise.all(first.map(probe));
      newest = newestMs();
      if (!newest) return [];

      if (cache.size < 7) {
        for (const stepMin of [5, 6]) {
          const back = [];
          for (let k = 1; k <= 7; k++) back.push(newest - k * stepMin * MIN);
          const found = (await Promise.all(back.map(probe))).filter(Boolean).length;
          if (found >= 3) break;
        }
      }
    }
    const label = `BOM ${prod.label} \u00B7 ${site.name}${prod.suffix ? "" : ` \u00B7 ${effectiveRange()} km`}`;
    return [...cache.values()]
      .sort((a, b) => a.t - b.t)
      .slice(-(prod.count || 7))
      .map((f) => ({ t: f.t, label, el: f.img, daily: prod.hourUtc != null }));
  }
  function placeBomFrames(frames, site, L) {
    const sp = project(site.lat, site.lon, L.z);
    const w = 2 * effectiveRange() * 1000 / resolution(L.z, site.lat);
    for (const f of frames) {
      const s = f.el.style;
      s.left = `${sp.x - L.cx - w / 2}px`;
      s.top = `${sp.y - L.cy - w / 2}px`;
      s.width = `${w}px`;
      s.height = `${w}px`;
      s.clipPath = BOM_CROP;
    }
  }

  async function fetchRainViewer() {
    const res = await fetch(RAINVIEWER_API, { cache: "no-store" });
    if (!res.ok) throw new Error(`RainViewer ${res.status}`);
    const j = await res.json();
    const past = (j.radar && j.radar.past) || [];
    return past.slice(-8).map((f) => ({ t: f.time * 1000, host: j.host, path: f.path }));
  }
  async function fetchGibsTimes() {
    const now = Date.now();
    const url = `${GIBS_BASE}/1.0.0/${GIBS_LAYER}/default/GoogleMapsCompatible_Level6/all/${fmtIso(now - 8 * 60 * MIN)}--${fmtIso(now + 60 * MIN)}.xml`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GIBS ${res.status}`);
    const m = (await res.text()).match(/<Domain>([^<]+)<\/Domain>/);
    if (!m) return [];
    const ranges = m[1].split(",");
    const last = ranges[ranges.length - 1].split("/");
    const end = Date.parse(last[1] || last[0]);
    if (!isFinite(end)) return [];
    const out = [];
    for (let k = 5; k >= 0; k--) out.push(end - k * 10 * MIN);
    return out;
  }

  function tileFrame(L, urlFn, t, label) {
    const el = document.createElement("div");
    el.className = "radar-frame";
    el.appendChild(makeTiles(L, urlFn));
    return { t, label, el };
  }

  // ---------- build ----------
  async function build() {
    const gen = ++state.gen;
    stopAnim();
    state.lastBuild = Date.now();
    state.frames = [];
    const els = ensureDom();
    els.overlay.replaceChildren();
    if (state.mode === "off" || !isFinite(state.lat) || !isFinite(state.lon)) {
      els.bg.hidden = true;
      document.documentElement.classList.remove("has-radar");
      setCaption("");
      return;
    }
    els.bg.hidden = false;
    document.documentElement.classList.add("has-radar");

    const site = state.mode === "radar" ? nearestBomSite() : null;
    const attempts = state.mode === "satellite" ? ["gibs"] : (site ? ["bom", "rainviewer"] : ["rainviewer"]);
    for (const source of attempts) {
      let L;
      let frames = [];
      try {
        if (source === "bom") {
          L = layoutFor(1.5 * effectiveRange(), 12);
          renderBasemap(L);
          frames = await fetchBom(site);
          if (gen !== state.gen) return;
          if (frames.length < 2) { frames = []; continue; }
          placeBomFrames(frames, site, L);
        } else if (source === "rainviewer") {
          L = layoutFor(350, 7);
          renderBasemap(L);
          const list = await fetchRainViewer();
          if (gen !== state.gen) return;
          frames = list.map((f) => tileFrame(L, (x, y, z) => `${f.host}${f.path}/256/${z}/${x}/${y}/2/1_1.png`, f.t, "Rain radar \u00B7 RainViewer"));
        } else {
          L = layoutFor(1500, 6);
          renderBasemap(L, true);
          const times = await fetchGibsTimes();
          if (gen !== state.gen) return;
          frames = times.map((t) => tileFrame(L, (x, y, z) => `${GIBS_BASE}/${GIBS_LAYER}/default/${fmtIso(t)}/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`, t, "Himawari cloud satellite \u00B7 NASA GIBS"));
        }
      } catch (err) {
        if (gen !== state.gen) return;
        console.warn(`Radar background: ${source} unavailable`, err);
        frames = [];
        continue;
      }
      if (!frames.length) continue;
      state.frames = frames;
      for (const f of frames) els.overlay.appendChild(f.el);
      startAnim();
      return;
    }
    if (gen === state.gen) setCaption("");
  }

  // ---------- public API ----------
  let resizeTimer = null;
  function schedule(delay) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.mode !== "off") build(); }, delay);
  }

  const RadarBackground = {
    init() {
      readPrefs();
      ensureDom();
      window.addEventListener("resize", () => schedule(400));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { stopAnim(); return; }
        if (state.mode === "off") return;
        if (Date.now() - state.lastBuild > REFRESH_MS) build(); else startAnim();
      });
      new MutationObserver(() => schedule(100)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      setInterval(() => {
        if (!document.hidden && state.mode !== "off") build();
      }, REFRESH_MS);
    },
    // Called after every planner refresh(): rebuilds on a location change,
    // or when the last build is older than the radar cadence.
    update(loc) {
      const lat = loc && Number(loc.lat);
      const lon = loc && Number(loc.lon);
      let moved = false;
      if (isFinite(lat) && isFinite(lon)) {
        moved = !isFinite(state.lat) || Math.abs(lat - state.lat) > 0.01 || Math.abs(lon - state.lon) > 0.01;
        state.lat = lat;
        state.lon = lon;
      }
      if (moved || !state.lastBuild || Date.now() - state.lastBuild >= REFRESH_MS - 30 * 1000) build();
    },
    getMode() { return state.mode; },
    getOpacity() { return state.opacity; },
    setMode(mode) {
      if (mode !== "off" && mode !== "radar" && mode !== "satellite") return;
      state.mode = mode;
      savePref(LS_MODE, mode);
      build();
    },
    getRange() { return state.range; },
    getProduct() { return state.product; },
    setRange(km) {
      const r = parseInt(km, 10);
      if (!RANGES.includes(r)) return;
      state.range = r;
      savePref(LS_RANGE, r);
      if (state.mode === "radar") build();
    },
    setProduct(p) {
      if (!PRODUCTS[p]) return;
      state.product = p;
      savePref(LS_PRODUCT, p);
      if (state.mode === "radar") build();
    },
    setOpacity(value) {
      const o = Math.max(0.1, Math.min(1, Number(value)));
      if (!isFinite(o)) return;
      state.opacity = o;
      savePref(LS_OPACITY, o);
      if (state.els) state.els.bg.style.opacity = String(o);
    },
  };

  readPrefs();
  window.RadarBackground = RadarBackground;
})();
