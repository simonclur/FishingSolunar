// Lightning strike telemetry adapters. Each source normalises strikes to
// { t: ms epoch, lat, lon, energy: 0..1 } and feeds RadarBackground.setLightning(),
// which draws them as flashes on the smooth cloud layer's time axis.
//
// Sources:
//   xweather     Vaisala GLD360 via the Xweather API (poll; needs client id/secret).
//                Free tier = last 5 min within 100 km; strikes accumulate while open.
//   blitzortung  Community network live websocket (non-commercial / personal use
//                only; see https://www.blitzortung.org/). No history, so the buffer
//                fills from the moment it connects.
//   demo         Simulated drifting storm for testing the flashes.
(function (root) {
  "use strict";

  const LS_KEY = "fishingSolunar.lightning";
  const SOURCES = ["off", "demo", "xweather", "blitzortung"];
  const KEEP_MS = 3 * 3600 * 1000;
  const MAX_STRIKES = 4000;
  const INGEST_RADIUS_KM = 3500;
  const FLUSH_MS = 1500;
  const XW_URL = "https://data.api.xweather.com/lightning/";
  const BZ_HOSTS = ["ws1", "ws8", "ws7"];

  // One-time preview defaults (runs before radar.js reads its prefs): smooth
  // clouds in front of the planner with live Blitzortung lightning, replacing earlier
  // saved choices so the new features are visible without any setup.
  try {
    if (!localStorage.getItem("fishingSolunar.previewDefaults3")) {
      localStorage.setItem("fishingSolunar.previewDefaults3", "1");
      localStorage.setItem("fishingSolunar.radarMode", "smooth");
      localStorage.setItem("fishingSolunar.cloudFront", "1");
      localStorage.setItem("fishingSolunar.radarOpacity", "0.6");
      localStorage.setItem("fishingSolunar.viewSpan", "6000");
      localStorage.setItem(LS_KEY, JSON.stringify({ source: "blitzortung" }));
    }
  } catch (e) { /* storage unavailable */ }

  const cfg = { source: "off", xid: "", xsecret: "" };
  const strikes = new Map();
  let statusText = "";
  let statusCb = null;
  let flushTimer = 0;
  let stop = null; // teardown for the active source
  let centre = { lat: NaN, lon: NaN };

  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      if (SOURCES.includes(o.source)) cfg.source = o.source;
      if (typeof o.xid === "string") cfg.xid = o.xid;
      if (typeof o.xsecret === "string") cfg.xsecret = o.xsecret;
    } catch (e) { /* keep defaults */ }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }
  function setStatus(text) {
    statusText = text;
    if (statusCb) statusCb(text);
  }

  function distKm(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function currentCentre() {
    const l = root.RadarBackground && root.RadarBackground.getLocation && root.RadarBackground.getLocation();
    if (l && isFinite(l.lat) && isFinite(l.lon)) return l;
    return centre;
  }

  function add(t, lat, lon, energy, id) {
    if (!isFinite(t) || !isFinite(lat) || !isFinite(lon)) return false;
    const c = currentCentre();
    if (isFinite(c.lat) && distKm(c.lat, c.lon, lat, lon) > INGEST_RADIUS_KM) return false;
    const key = id || `${t}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (strikes.has(key)) return false;
    strikes.set(key, { t, lat, lon, energy: Math.max(0.2, Math.min(1, energy || 0.5)) });
    scheduleFlush();
    return true;
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_MS);
  }
  function flush() {
    flushTimer = 0;
    const cutoff = Date.now() - KEEP_MS;
    for (const [k, s] of strikes) if (s.t < cutoff) strikes.delete(k);
    if (strikes.size > MAX_STRIKES) {
      const keys = Array.from(strikes.keys());
      for (let i = 0; i < strikes.size - MAX_STRIKES; i++) strikes.delete(keys[i]);
    }
    if (root.RadarBackground) root.RadarBackground.setLightning(Array.from(strikes.values()));
  }

  // ---------- Xweather ----------
  function startXweather() {
    if (!cfg.xid || !cfg.xsecret) { setStatus("Xweather: enter a client ID and secret"); return null; }
    let timer = 0;
    let dead = false;
    async function poll() {
      const c = currentCentre();
      if (!isFinite(c.lat)) { setStatus("Xweather: waiting for a location"); }
      else {
        try {
          const url = `${XW_URL}${c.lat.toFixed(4)},${c.lon.toFixed(4)}?format=json&radius=100km&limit=1000` +
            `&client_id=${encodeURIComponent(cfg.xid)}&client_secret=${encodeURIComponent(cfg.xsecret)}`;
          const res = await fetch(url);
          const j = await res.json();
          if (dead) return;
          if (!j.success) throw new Error((j.error && (j.error.description || j.error.code)) || `HTTP ${res.status}`);
          let n = 0;
          for (const r of j.response || []) {
            const amp = Math.abs((r.ob.pulse && r.ob.pulse.peakamp) || 0);
            const ms = r.ob.timestampMS || r.ob.timestamp * 1000;
            if (add(ms, r.loc.lat, r.loc.long, 0.25 + amp / 40000, r.id)) n++;
          }
          setStatus(`Xweather: ${strikes.size} strikes buffered (+${n} new, within 100 km) \u00B7 ${new Date().toLocaleTimeString()}`);
        } catch (err) {
          if (!dead) setStatus(`Xweather error: ${err.message}`);
        }
      }
      if (!dead) timer = setTimeout(poll, 60 * 1000);
    }
    poll();
    return () => { dead = true; clearTimeout(timer); };
  }

  // ---------- Blitzortung ----------
  // Frames are LZW-compressed JSON ({time: ns, lat, lon, ...}).
  function bzDecode(b) {
    const dict = {};
    const d = b.split("");
    let c = d[0];
    let prev = c;
    const out = [c];
    let code = 256;
    for (let i = 1; i < d.length; i++) {
      const cc = d[i].charCodeAt(0);
      const e = cc < 256 ? d[i] : (dict[cc] ? dict[cc] : prev + c);
      out.push(e);
      c = e.charAt(0);
      dict[code++] = prev + c;
      prev = e;
    }
    return out.join("");
  }
  function startBlitzortung() {
    let ws = null;
    let dead = false;
    let host = 0;
    let retry = 0;
    let timer = 0;
    let got = 0;
    function connect() {
      if (dead || document.hidden) return;
      setStatus("Blitzortung: connecting\u2026");
      try { ws = new WebSocket(`wss://${BZ_HOSTS[host % BZ_HOSTS.length]}.blitzortung.org/`); }
      catch (e) { return fail(); }
      ws.onopen = () => { retry = 0; ws.send(JSON.stringify({ a: 111 })); setStatus("Blitzortung: connected, waiting for strikes near you\u2026"); };
      ws.onmessage = (ev) => {
        try {
          const s = JSON.parse(bzDecode(ev.data));
          if (add(s.time / 1e6, s.lat, s.lon, 0.5)) {
            got++;
            if (got % 5 === 1) setStatus(`Blitzortung: live \u00B7 ${strikes.size} strikes buffered`);
          }
        } catch (e) { /* ignore malformed frame */ }
      };
      ws.onclose = fail;
      ws.onerror = () => { try { ws.close(); } catch (e) { /* ignore */ } };
    }
    function fail() {
      if (dead) return;
      host++;
      retry = Math.min(retry + 1, 6);
      setStatus("Blitzortung: reconnecting\u2026");
      timer = setTimeout(connect, 2000 * retry);
    }
    // Don't hold a global stream open for a hidden tab.
    function vis() {
      if (document.hidden) { clearTimeout(timer); if (ws) { const w = ws; ws = null; w.onclose = null; w.close(); } }
      else if (!ws) connect();
    }
    document.addEventListener("visibilitychange", vis);
    connect();
    return () => {
      dead = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", vis);
      if (ws) { ws.onclose = null; ws.close(); }
    };
  }

  // ---------- Demo ----------
  function startDemo() {
    const c = currentCentre();
    if (!isFinite(c.lat)) { setStatus("Demo: waiting for a location"); return null; }
    const t0 = Date.now() - 90 * 60 * 1000;
    const pos = (t) => {
      const m = (t - t0) / 60000;
      return { lat: c.lat + 0.9 - m * 0.004, lon: c.lon - 1.2 + m * 0.022 };
    };
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.4;
    function burst(t) {
      const p = pos(t);
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) add(t + Math.random() * 20000, p.lat + gauss(), p.lon + gauss(), 0.3 + Math.random() * 0.7);
    }
    for (let t = t0; t < Date.now(); t += 30000) burst(t);
    const timer = setInterval(() => burst(Date.now()), 10000);
    setStatus("Demo: simulated storm (not real data)");
    return () => clearInterval(timer);
  }

  function restart() {
    if (stop) { stop(); stop = null; }
    strikes.clear();
    clearTimeout(flushTimer);
    flushTimer = 0;
    if (root.RadarBackground) root.RadarBackground.setLightning([]);
    setStatus("");
    if (cfg.source === "xweather") stop = startXweather();
    else if (cfg.source === "blitzortung") stop = startBlitzortung();
    else if (cfg.source === "demo") stop = startDemo();
  }

  const Lightning = {
    SOURCES,
    init() { load(); restart(); },
    getConfig() { return { ...cfg }; },
    setConfig(patch) {
      if (patch.source && SOURCES.includes(patch.source)) cfg.source = patch.source;
      if (typeof patch.xid === "string") cfg.xid = patch.xid.trim();
      if (typeof patch.xsecret === "string") cfg.xsecret = patch.xsecret.trim();
      save();
      restart();
    },
    getStatus() { return statusText; },
    onStatus(cb) { statusCb = cb; },
    // Called when the planner location changes; buffered strikes from a
    // far-away previous location are dropped, and the source is restarted.
    setCentre(lat, lon) {
      const moved = isFinite(centre.lat) && distKm(centre.lat, centre.lon, lat, lon) > 100;
      centre = { lat, lon };
      if (moved || (cfg.source === "demo" && !stop) || (cfg.source !== "off" && !stop)) restart();
    },
    // For other feeds / tests: normalised strike in.
    ingest(t, lat, lon, energy) { return add(t, lat, lon, energy); },
  };

  root.Lightning = Lightning;
  if (typeof module !== "undefined" && module.exports) module.exports = { Lightning, bzDecode };
})(typeof window !== "undefined" ? window : globalThis);
