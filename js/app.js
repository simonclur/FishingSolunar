// js/app.js
// Wires up the settings form, fetches data from Open-Meteo (weather + marine)
// and WorldTides (tides), computes moon phase + solunar rating locally, and
// renders both the interactive responsive table and the two print-only A4
// tables. See docs/DATA_SOURCES.md and docs/ARCHITECTURE.md.

const LS_KEYS = {
  name: "fishingSolunar.locationName",
  lat: "fishingSolunar.lat",
  lon: "fishingSolunar.lon",
  start: "fishingSolunar.startDate",
  key: "fishingSolunar.worldTidesKey",
  refHeight: "fishingSolunar.refTideHeight",
  rowLabelsCollapsed: "fishingSolunar.rowLabelsCollapsed",
};

// Trip-planning "reference height" for the tide curve row: the user types
// in a critical water depth (e.g. the depth needed to safely cross a
// sandbar/channel) into an input in the "Tide curve" row label, and every
// day's curve then draws a dotted horizontal line at that exact height plus
// the time(s) each day's tide actually reaches it - so a single glance
// across the 14-day table shows every day's "safe to leave" / "safe to
// return" window at that depth. Persisted across reloads and included in
// print output (unlike the mouse-hover readout, which is screen-only).
let refTideHeight = (() => {
  const raw = localStorage.getItem(LS_KEYS.refHeight);
  const n = raw === null ? NaN : parseFloat(raw);
  return isNaN(n) ? null : n;
})();

// Set by `render()` each time so the ref-height input's change handler can
// re-render the table in place (cheap - no network refetch needed, since
// the underlying `days` data doesn't change, only the overlay drawn on top
// of it) rather than re-running the whole `refresh()` fetch pipeline.
let lastRenderArgs = null;

function setRefTideHeight(value) {
  refTideHeight = value;
  if (value === null || isNaN(value)) localStorage.removeItem(LS_KEYS.refHeight);
  else localStorage.setItem(LS_KEYS.refHeight, String(value));
}

const WMO_WEATHER = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
  96: "Thunderstorm, hail",
  99: "Thunderstorm, hail",
};

// Buckets the WMO weather code into a handful of icon categories, used by
// weatherIconSvg() below. Precipitation type (rain/drizzle/snow/storm) is
// distinguished from cloud cover (clear/partly/overcast/fog) since the two
// are shown as separate small icons in the Weather cell - similar in
// spirit to Windfinder's own cloud-cover + precipitation icon pairing,
// though these are original, simplified flat-icon shapes (not copies of
// their artwork).
function weatherCloudCategory(code) {
  if (code == null) return null;
  if (code === 0) return "clear";
  if (code === 1) return "few";
  if (code === 2) return "scattered";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  return "overcast"; // any precipitation code implies at least overcast skies
}

function weatherPrecipCategory(code) {
  if (code == null) return null;
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 66, 80, 81].includes(code)) return "rain";
  if ([65, 82].includes(code)) return "heavyrain";
  if ([71, 73, 75, 77].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return null;
}

// Small flat cloud-cover icon (sun / sun-behind-cloud / cloud / fog),
// echoing the clean, simplified style of Windfinder's own cloud-cover
// icon set (clear/few/broken/overcast, single flat shapes, no gradients)
// while using original shapes/paths so as not to reproduce their artwork.
// Rendered in `--ink`/grey fills only, so it stays legible in plain B&W
// print with no colour dependency (unlike the sun icon, which does use a
// mid-grey fill for the cloud so the two remain visually distinguishable
// even in black & white).
function cloudCoverIconSvg(category) {
  if (!category) return "";
  const sun = `<circle cx="11" cy="11" r="4.6" class="wx-sun"></circle>` +
    [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const rad = (a * Math.PI) / 180;
      const x1 = 11 + Math.cos(rad) * 7, y1 = 11 + Math.sin(rad) * 7;
      const x2 = 11 + Math.cos(rad) * 9.8, y2 = 11 + Math.sin(rad) * 9.8;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="wx-sun-ray"></line>`;
    }).join("");
  // Smooth, rounded "puffy cloud" silhouette (three overlapping lobes on a flat
  // base) rather than the earlier angular path - closer in spirit to classic
  // flat weather-icon sets while remaining an original shape/outline.
  const cloud = (cx, cy, s) =>
    `<path d="M ${(cx - 8.5 * s).toFixed(1)} ${(cy + 3.2 * s).toFixed(1)} ` +
    `a ${3.4 * s} ${3.4 * s} 0 0 1 -0.3 ${(-6.6 * s).toFixed(1)} ` +
    `a ${4 * s} ${4 * s} 0 0 1 ${7.4 * s} ${(-2.6 * s).toFixed(1)} ` +
    `a ${3.6 * s} ${3.6 * s} 0 0 1 ${5.4 * s} ${1 * s} ` +
    `a ${3.2 * s} ${3.2 * s} 0 0 1 ${1.6 * s} ${5 * s} z" class="wx-cloud"></path>`;
  if (category === "clear") {
    return `<svg class="wx-icon-svg" viewBox="0 0 22 22" role="img" aria-label="Clear sky">${sun}</svg>`;
  }
  if (category === "few") {
    return `<svg class="wx-icon-svg" viewBox="0 0 22 22" role="img" aria-label="Mostly clear">` +
      `<g transform="translate(-2,-2) scale(0.85)">${sun}</g>${cloud(13, 15, 0.8)}</svg>`;
  }
  if (category === "scattered") {
    return `<svg class="wx-icon-svg" viewBox="0 0 22 22" role="img" aria-label="Partly cloudy">` +
      `<g transform="translate(-3,-3) scale(0.75)">${sun}</g>${cloud(12, 14, 1)}</svg>`;
  }
  if (category === "fog") {
    return `<svg class="wx-icon-svg" viewBox="0 0 22 22" role="img" aria-label="Fog">` +
      [7, 11, 15].map((y) => `<line x1="2" y1="${y}" x2="20" y2="${y}" class="wx-fog-line"></line>`).join("") +
      `</svg>`;
  }
  // overcast (default for any remaining/precipitation codes)
  return `<svg class="wx-icon-svg" viewBox="0 0 22 22" role="img" aria-label="Overcast">${cloud(11, 12, 1.15)}</svg>`;
}

// Small precipitation-type icon (raindrop(s) / snowflake / lightning bolt)
// shown alongside the cloud-cover icon, again an original simplified flat
// BOM-style precipitation icon: a small cloud with rain lines below it, where
// the *number, length and slant* of the lines communicates intensity (few
// short dashes = drizzle, more/longer slanted lines = rain, dense long lines
// = heavy rain) - mirroring the Bureau of Meteorology's own forecast icon
// convention (bom.gov.au) rather than isolated raindrop shapes, which made it
// hard to tell drizzle from a downpour at a glance. Original artwork/paths.
function precipCloudSvg() {
  return `<path d="M4.5 9.2a3 3 0 0 1-0.3-5.9 3.6 3.6 0 0 1 6.9-1.6 3.4 3.4 0 0 1 4.9 3 3 3 0 0 1 -0.9 5.9 z" class="wx-precip-cloud"></path>`;
}
function rainLines(count, len, slant, startX, gap, y0) {
  let out = "";
  for (let i = 0; i < count; i++) {
    const x = startX + i * gap;
    out += `<line x1="${x}" y1="${y0}" x2="${(x - slant).toFixed(1)}" y2="${(y0 + len).toFixed(1)}" class="wx-drop"></line>`;
  }
  return out;
}
function precipIconSvg(category) {
  if (!category) return "";
  const cloud = precipCloudSvg();
  if (category === "drizzle") {
    return `<svg class="wx-icon-svg wx-precip-svg" viewBox="0 0 20 18" role="img" aria-label="Drizzle">${cloud}${rainLines(2, 2.2, 0.8, 6, 6, 11)}</svg>`;
  }
  if (category === "rain") {
    return `<svg class="wx-icon-svg wx-precip-svg" viewBox="0 0 20 18" role="img" aria-label="Rain">${cloud}${rainLines(3, 4, 1.4, 5, 4.2, 10.5)}</svg>`;
  }
  if (category === "heavyrain") {
    return `<svg class="wx-icon-svg wx-precip-svg" viewBox="0 0 20 18" role="img" aria-label="Heavy rain">${cloud}${rainLines(4, 5.5, 1.8, 4, 3.6, 10)}</svg>`;
  }
  if (category === "snow") {
    const flake = (cx, cy) => [0, 60, 120].map((a) => {
      const rad = (a * Math.PI) / 180;
      const dx = Math.cos(rad) * 3, dy = Math.sin(rad) * 3;
      return `<line x1="${(cx - dx).toFixed(1)}" y1="${(cy - dy).toFixed(1)}" x2="${(cx + dx).toFixed(1)}" y2="${(cy + dy).toFixed(1)}" class="wx-snow-line"></line>`;
    }).join("");
    return `<svg class="wx-icon-svg wx-precip-svg" viewBox="0 0 20 18" role="img" aria-label="Snow">${cloud}${flake(7, 13)}${flake(13, 13)}</svg>`;
  }
  if (category === "storm") {
    return `<svg class="wx-icon-svg wx-precip-svg" viewBox="0 0 20 18" role="img" aria-label="Thunderstorm">${cloud}` +
      `<polygon points="11,9 6.5,15 9.5,15 8,18 13,12 10,12" class="wx-bolt"></polygon></svg>`;
  }
  return "";
}

function weatherIconsHtml(weatherCode) {
  const cloud = cloudCoverIconSvg(weatherCloudCategory(weatherCode));
  if (!cloud) return "";
  return `<span class="wx-icon-row">${cloud}</span>`;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function degToCompass(deg) {
  if (deg == null || isNaN(deg)) return "\u2014";
  return COMPASS[Math.round(deg / 22.5) % 16];
}

function fmtTime(date, tz) {
  if (!date) return "\u2014";
  return new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(date);
}

function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function $(id) { return document.getElementById(id); }

// ---------- settings persistence ----------

function loadSettings() {
  return {
    name: localStorage.getItem(LS_KEYS.name) || window.LOCATION_PRESETS[0].name,
    lat: parseFloat(localStorage.getItem(LS_KEYS.lat) ?? window.LOCATION_PRESETS[0].lat),
    lon: parseFloat(localStorage.getItem(LS_KEYS.lon) ?? window.LOCATION_PRESETS[0].lon),
    start: localStorage.getItem(LS_KEYS.start) || isoDate(new Date()),
    key: localStorage.getItem(LS_KEYS.key) || "",
  };
}

function saveSettings(s) {
  localStorage.setItem(LS_KEYS.name, s.name);
  localStorage.setItem(LS_KEYS.lat, String(s.lat));
  localStorage.setItem(LS_KEYS.lon, String(s.lon));
  localStorage.setItem(LS_KEYS.start, s.start);
  localStorage.setItem(LS_KEYS.key, s.key);
}

// ---------- data fetching ----------

// Open-Meteo rejects the *entire* request if any single day of the
// requested start/end range falls outside its supported rolling window
// (roughly the last ~3 months to ~16 days ahead of "today" - and that
// window itself shifts by a day at midnight UTC). Rather than losing all
// 14 days over one day poking past the edge, we parse the "out of allowed
// range from X to Y" message it returns and retry once with the
// requested range clipped to the overlap - so e.g. requesting days 1-14
// when only days 1-13 are actually available still gets us 13 real days
// instead of zero.
function parseOutOfRangeReason(reason) {
  const m = /out of allowed range from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(reason || "");
  return m ? { min: m[1], max: m[2] } : null;
}

function clipIso(iso, min, max) {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

async function fetchWeather(lat, lon, startIso, endIso, tz) {
  const build = (s, e) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,windspeed_10m_max,windspeed_10m_mean,windgusts_10m_max,winddirection_10m_dominant,` +
    `sunrise,sunset,precipitation_sum,precipitation_probability_max,weathercode,uv_index_max` +
    `&hourly=windspeed_10m,winddirection_10m,pressure_msl` +
    `&start_date=${s}&end_date=${e}&timezone=${encodeURIComponent(tz)}`;
  let res = await fetch(build(startIso, endIso));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const range = parseOutOfRangeReason(body?.reason);
    if (range) {
      const s = clipIso(startIso, range.min, range.max);
      const e = clipIso(endIso, range.min, range.max);
      if (s <= e) {
        res = await fetch(build(s, e));
        if (res.ok) return res.json();
      }
    }
    throw new Error(`Open-Meteo weather API error (${res.status}${body?.reason ? ": " + body.reason : ""})`);
  }
  return res.json();
}

// Picks out the hourly wind speed/direction for one calendar day from
// Open-Meteo's hourly arrays, at every `intervalHours` (default 2), so the
// "Wind" timeline row can show how direction/strength shift through the
// day - same underlying model/data as the daily wind summary, just sampled
// more finely; no extra network request is needed since
// `&hourly=windspeed_10m,winddirection_10m` is fetched alongside the daily
// fields in the same cached request. All hours are kept in the stored
// `windHourly` array (2h resolution); the render step (`windTimelineHtml`)
// re-filters down to a coarser interval for print, so both views share one
// cached dataset.
function hourlyWindForDay(weatherHourly, isoDay, intervalHours) {
  const step = intervalHours || 2;
  if (!weatherHourly || !weatherHourly.time) return [];
  const times = weatherHourly.time;
  const speeds = weatherHourly.windspeed_10m;
  const dirs = weatherHourly.winddirection_10m;
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(isoDay)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (hour % step !== 0) continue;
    out.push({ hour, dir: dirs[i], speed: speeds[i] });
  }
  return out;
}

// Same idea as hourlyWindForDay() but for ocean surface current, pulled
// from the Marine API's hourly ocean_current_velocity/ocean_current_direction
// (see fetchMarine()) so the "Current" timeline row can show how it shifts
// through the day, mirroring the Wind timeline row's layout/behaviour.
function hourlyCurrentForDay(marineHourly, isoDay, intervalHours) {
  const step = intervalHours || 2;
  if (!marineHourly || !marineHourly.time) return [];
  const times = marineHourly.time;
  const speeds = marineHourly.ocean_current_velocity;
  const dirs = marineHourly.ocean_current_direction;
  if (!speeds || !dirs) return [];
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(isoDay)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (hour % step !== 0) continue;
    out.push({ hour, dir: dirs[i], speed: speeds[i] });
  }
  return out;
}

async function fetchMarine(lat, lon, startIso, endIso, tz) {
  const build = (s, e) => `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&daily=wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max,` +
    `swell_wave_direction_dominant,swell_wave_period_max,wind_wave_height_max,` +
    `wind_wave_direction_dominant,wind_wave_period_max&hourly=sea_surface_temperature,` +
    `ocean_current_velocity,ocean_current_direction,wave_height,swell_wave_height,` +
    `swell_wave_direction,wind_wave_height` +
    `&start_date=${s}&end_date=${e}&timezone=${encodeURIComponent(tz)}`;
  let res = await fetch(build(startIso, endIso));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const range = parseOutOfRangeReason(body?.reason);
    if (range) {
      const s = clipIso(startIso, range.min, range.max);
      const e = clipIso(endIso, range.min, range.max);
      if (s <= e) {
        res = await fetch(build(s, e));
        if (res.ok) return res.json();
      }
    }
    throw new Error(`Open-Meteo marine API error (${res.status}${body?.reason ? ": " + body.reason : ""})`);
  }
  return res.json();
}

async function fetchWorldTides(lat, lon, startIso, days, apiKey) {
  if (!apiKey) throw new Error("no WorldTides API key entered");
  // Explicitly request LAT (Lowest Astronomical Tide) datum - without this,
  // WorldTides defaults to MSL (Mean Sea Level), which reports heights
  // relative to the average sea level and so is commonly negative at low
  // tide. Our locally-bundled QLD CSVs (data/tides/*.csv, from Maritime
  // Safety Queensland) are all referenced to LAT, where height is always
  // >= 0 by definition (the tide can't go below the lowest astronomical
  // tide under normal conditions) - matching datums here keeps WorldTides
  // fallback locations (e.g. Tasmania/NSW/VIC presets with no local file)
  // showing tide heights on the same all-positive convention anglers
  // expect, instead of confusingly negative MSL-relative numbers.
  const url = `https://www.worldtides.info/api/v3?extremes&localtime&datum=LAT&date=${startIso}&days=${days}&lat=${lat}&lon=${lon}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && data.status !== 200) throw new Error(`WorldTides: ${data.error || "request failed"}`);
  return data;
}

// Prefers official locally-bundled tide predictions (data/tides/*.csv, see
// js/tides.js) and only calls the WorldTides API for days that aren't
// covered by a local file (e.g. a custom location, or a year that hasn't
// been published yet). Fetches one extra day either side of the requested
// range so the tide curve has real bracketing points at day 1 and day 14.
async function fetchTides(lat, lon, startDate, endDate, apiKey, preset, cacheKeyBase) {
  const bufferedStart = addDays(startDate, -1);
  const bufferedEnd = addDays(endDate, 1);
  const byDate = {};
  let source = null;
  let stale = false;
  const notes = [];

  // Local CSV files are same-origin static assets: they load from the
  // service worker's offline cache automatically, so no extra caching layer
  // is needed here - they "just work" offline once visited once online.
  if (preset && preset.tideStationId) {
    const local = await window.TideCalc.getLocalTides(preset.tideStationId, bufferedStart, bufferedEnd);
    Object.assign(byDate, local.byDate);
    if (Object.keys(local.byDate).length) source = "local";
    if (local.missingYears.length) {
      notes.push(`No local tide file yet for ${local.missingYears.join(", ")}`);
    }
  }

  const allDays = [];
  for (let d = new Date(startDate); d <= endDate; d = addDays(d, 1)) allDays.push(isoDate(d));
  const stillMissing = allDays.filter((iso) => !byDate[iso]);

  if (stillMissing.length && apiKey) {
    try {
      const bufferedDayCount = allDays.length + 2;
      const result = await cachedFetch(
        `worldtides:${cacheKeyBase}`,
        () => fetchWorldTides(lat, lon, isoDate(bufferedStart), bufferedDayCount, apiKey)
      );
      const data = result.data;
      stale = result.fromCache;
      for (const ex of data.extremes || []) {
        const dayIso = ex.date.slice(0, 10);
        (byDate[dayIso] ||= []).push({ date: dayIso, dt: new Date(ex.date), type: ex.type, height: ex.height });
      }
      source = source ? "local+worldtides" : "worldtides";
    } catch (e) {
      notes.push(e.message);
    }
  }

  const finalMissing = allDays.filter((iso) => !byDate[iso]);
  const sortedEvents = Object.values(byDate).flat().sort((a, b) => a.dt - b.dt);
  return { byDate, source, notes, missingDays: finalMissing, sortedEvents, stale };
}

// Samples a smooth (cosine-interpolated) height curve for one local calendar
// day from the surrounding tide extrema, i.e. a "sine wave" approximation of
// the real semi-diurnal tide between each known high/low. This is the same
// simple technique behind the "rule of twelfths"-style tide graphs.
function buildDayCurve(dayStart, sortedEvents, stepMinutes = 20) {
  if (!sortedEvents.length) return null;
  const points = [];
  const dayEnd = addDays(dayStart, 1);
  for (let t = dayStart.getTime(); t <= dayEnd.getTime(); t += stepMinutes * 60000) {
    let prev = null, next = null;
    for (const ev of sortedEvents) {
      if (ev.dt.getTime() <= t) prev = ev;
      if (ev.dt.getTime() >= t && !next) next = ev;
    }
    let h;
    if (prev && next && prev !== next) {
      const span = next.dt.getTime() - prev.dt.getTime();
      const frac = span > 0 ? (t - prev.dt.getTime()) / span : 0;
      h = prev.height + (next.height - prev.height) * (1 - Math.cos(Math.PI * frac)) / 2;
    } else if (prev) {
      h = prev.height;
    } else if (next) {
      h = next.height;
    } else {
      continue;
    }
    points.push({ t: new Date(t), h });
  }
  return points.length ? points : null;
}

// Finds every point in a day's 20-min-resolution tide curve where the
// curve crosses a given target height, interpolating the exact crossing
// time between the two bracketing samples. Used to draw the "reference
// height" dotted line + time labels on every day's tide curve (see
// `refTideHeight` above) - each crossing also records whether the tide is
// rising or falling at that instant, which lets the UI show a rising vs
// falling arrow next to each time. `allEvents` (the full multi-day sorted
// high/low list) is used to find the two actual tide extrema immediately
// bracketing each crossing (`prevExtremum`/`nextExtremum`) - one High, one
// Low, since they always alternate - so the label-placement logic can
// tell which of the two the crossing is closer to.
function findHeightCrossings(points, targetHeight, allEvents) {
  if (!points || points.length < 2 || targetHeight == null || isNaN(targetHeight)) return [];
  const crossings = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const lo = Math.min(a.h, b.h), hi = Math.max(a.h, b.h);
    if (targetHeight < lo || targetHeight > hi) continue;
    const span = b.h - a.h;
    const frac = span !== 0 ? (targetHeight - a.h) / span : 0;
    if (frac < 0 || frac > 1) continue;
    const t = new Date(a.t.getTime() + (b.t.getTime() - a.t.getTime()) * frac);
    let prevExtremum = null, nextExtremum = null;
    if (allEvents) {
      for (const e of allEvents) {
        if (e.dt.getTime() <= t.getTime()) prevExtremum = e;
        if (e.dt.getTime() >= t.getTime() && !nextExtremum) nextExtremum = e;
      }
    }
    crossings.push({ t, rising: b.h >= a.h, prevExtremum, nextExtremum });
  }
  return crossings;
}

// Decides which side of the reference-height line a crossing's time label
// should sit on: a crossing always sits on an arc between exactly two
// bracketing tide extrema (one High, one Low, since they always
// alternate) - this compares the reference height itself against those
// two extrema's HEIGHTS (not their times) and picks whichever the
// reference height is numerically closer to, reporting whether that one
// is the high peak. Both crossings that flank the SAME peak (one rising
// into it, one falling out of it) share that exact peak/trough height
// pair, so comparing by height (rather than by time-distance, which can
// differ between the two sides of an asymmetric arc) guarantees they
// always resolve identically and get matching placement.
function nearestExtremumIsHigh(crossing) {
  const { prevExtremum: p, nextExtremum: n, t } = crossing;
  if (!p && !n) return false;
  if (!p) return n.type === "High";
  if (!n) return p.type === "High";
  const distP = Math.abs(p.height - refTideHeight);
  const distN = Math.abs(n.height - refTideHeight);
  return (distP <= distN ? p : n).type === "High";
}

// average sea_surface_temperature over 6am-6pm local for each day
function dailySeaTemp(marineHourly, isoDay) {
  const times = marineHourly.time;
  const temps = marineHourly.sea_surface_temperature;
  let sum = 0, n = 0;
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(isoDay)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (hour >= 6 && hour <= 18 && temps[i] != null) { sum += temps[i]; n++; }
  }
  return n ? sum / n : null;
}

// average ocean current speed + circular-mean direction over 6am-6pm local
// for each day (circular mean avoids the wrap-around error a plain average
// would give near 0/360deg, same reasoning as wind direction averaging
// elsewhere would need, though wind here only ever uses a single dominant
// reading rather than an hourly average).
function dailyOceanCurrent(marineHourly, isoDay) {
  const times = marineHourly.time;
  const speeds = marineHourly.ocean_current_velocity;
  const dirs = marineHourly.ocean_current_direction;
  if (!speeds || !dirs) return { speed: null, dir: null };
  let sumSpeed = 0, sumSin = 0, sumCos = 0, n = 0;
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(isoDay)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (hour >= 6 && hour <= 18 && speeds[i] != null && dirs[i] != null) {
      sumSpeed += speeds[i];
      const rad = (dirs[i] * Math.PI) / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);
      n++;
    }
  }
  if (!n) return { speed: null, dir: null };
  let dir = (Math.atan2(sumSin / n, sumCos / n) * 180) / Math.PI;
  if (dir < 0) dir += 360;
  return { speed: sumSpeed / n, dir };
}

// average pressure_msl over 6am-6pm local for each day - same "daytime
// representative value" pattern as dailySeaTemp()/dailyOceanCurrent()
// above. Screen-only Pressure row (see docs/DATA_CATALOG.md - high angler
// interest, near-zero added fetch cost since it rides along with the
// existing hourly weather request).
function dailyPressure(weatherHourly, isoDay) {
  const times = weatherHourly.time;
  const pressures = weatherHourly.pressure_msl;
  if (!pressures) return null;
  let sum = 0, n = 0;
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(isoDay)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (hour >= 6 && hour <= 18 && pressures[i] != null) { sum += pressures[i]; n++; }
  }
  return n ? sum / n : null;
}

// Picks out hourly wave/swell height for one calendar day, at every
// `intervalHours` (mirrors hourlyWindForDay()/hourlyCurrentForDay()), for
// the screen-only "Wave" timeline row that shows how sea state builds/eases
// through the day. wind_wave_height is included too so the timeline can
// (like the daily Waves/Swell row) distinguish locally wind-driven chop
// from groundswell.
function hourlyWaveForDay(marineHourly, isoDay, intervalHours) {
  const step = intervalHours || 2;
  if (!marineHourly || !marineHourly.time) return [];
  const times = marineHourly.time;
  const waveH = marineHourly.wave_height;
  const swellH = marineHourly.swell_wave_height;
  const swellDir = marineHourly.swell_wave_direction;
  const windWaveH = marineHourly.wind_wave_height;
  if (!waveH || !swellH) return [];
  const out = [];
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(isoDay)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (hour % step !== 0) continue;
    out.push({ hour, wave: waveH[i], swell: swellH[i], swellDir: swellDir ? swellDir[i] : null, windWave: windWaveH ? windWaveH[i] : null });
  }
  return out;
}

// ---------- offline-friendly caching ----------
// Wraps a network fetch: on success, stashes the JSON response (with a
// timestamp) in localStorage; on failure (offline, DNS, CORS, etc.) falls
// back to the last cached response for the same cache key, if any, so the
// app keeps working with the most recent data it successfully saw.
const CACHE_PREFIX = "fishingSolunar.cache.";

function readCache(cacheKey) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(cacheKey, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch {
    /* localStorage full/unavailable - degrade silently, just no offline cache */
  }
}

async function cachedFetch(cacheKey, fetcher) {
  try {
    const data = await fetcher();
    writeCache(cacheKey, data);
    return { data, fromCache: false, fetchedAt: Date.now() };
  } catch (err) {
    const cached = readCache(cacheKey);
    if (cached) {
      return { data: cached.data, fromCache: true, fetchedAt: cached.fetchedAt, error: err };
    }
    throw err;
  }
}



// Open-Meteo's live forecast/marine endpoints only cover a rolling window
// (~3 months of history to ~16 days ahead of "today" - see
// docs/DATA_SOURCES.md); a start date outside that window causes Open-Meteo
// to reject the request outright. That's unrelated to tides/moon/solunar
// (which are calculated locally or from the bundled CSV and don't depend on
// this window at all), so weather/marine failures must degrade gracefully
// instead of aborting the whole page. This gives buildPlan() an empty but
// well-shaped result to index into (all lookups already treat a missing
// `wIdx`/`mIdx` as "no data for this day" and render "\u2014").
const EMPTY_WEATHER = { daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], windspeed_10m_max: [], windspeed_10m_mean: [], windgusts_10m_max: [], winddirection_10m_dominant: [], sunrise: [], sunset: [], precipitation_sum: [], precipitation_probability_max: [], weathercode: [], uv_index_max: [] }, hourly: { time: [], windspeed_10m: [], winddirection_10m: [], pressure_msl: [] } };
const EMPTY_MARINE = { daily: { time: [], wave_height_max: [], wave_direction_dominant: [], wave_period_max: [], swell_wave_height_max: [], swell_wave_direction_dominant: [], swell_wave_period_max: [], wind_wave_height_max: [], wind_wave_direction_dominant: [], wind_wave_period_max: [] }, hourly: { time: [], sea_surface_temperature: [], ocean_current_velocity: [], ocean_current_direction: [], wave_height: [], swell_wave_height: [], swell_wave_direction: [], wind_wave_height: [] } };

async function buildPlan(settings) {
  const { lat, lon, start, key } = settings;
  const preset = window.LOCATION_PRESETS.find((p) => p.lat === lat && p.lon === lon);
  const tz = preset?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startDate = new Date(start + "T00:00:00");
  const endDate = addDays(startDate, 13);
  const startIso = isoDate(startDate);
  const endIso = isoDate(endDate);

  const cacheKeyBase = `${lat},${lon},${startIso},${endIso}`;
  const [weatherResult, marineResult, tides] = await Promise.all([
    cachedFetch(`weather:${cacheKeyBase}`, () => fetchWeather(lat, lon, startIso, endIso, tz))
      .catch((err) => ({ data: EMPTY_WEATHER, fromCache: false, fetchedAt: null, error: err })),
    cachedFetch(`marine:${cacheKeyBase}`, () => fetchMarine(lat, lon, startIso, endIso, tz))
      .catch((err) => ({ data: EMPTY_MARINE, fromCache: false, fetchedAt: null, error: err })),
    fetchTides(lat, lon, startDate, endDate, key, preset, cacheKeyBase),
  ]);
  const weather = weatherResult.data;
  const marine = marineResult.data;

  // "King tide" thresholds: this station's own usual highest-25%-of-highs
  // and lowest-25%-of-lows levels, computed from the full bundled-year
  // local tide CSV (see getStationAnnualExtremes() in js/tides.js) rather
  // than from just the current 14-day window - so what counts as an
  // unusually large tide is a stable, location-specific fact, not
  // something that shifts depending on which two weeks happen to be on
  // screen. Falls back to null (no local CSV station, e.g. a custom
  // location relying purely on the WorldTides API) - callers fall back to
  // a window-relative estimate in that case, see curveScale below.
  const kingTideThresholds = preset?.tideStationId
    ? await window.TideCalc.getStationAnnualExtremes(preset.tideStationId, startDate.getFullYear())
    : null;

  const days = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(startDate, i);
    const iso = isoDate(date);
    const wIdx = weather.daily.time.indexOf(iso);
    const mIdx = marine.daily.time.indexOf(iso);

    const extremesForDay = tides.byDate[iso] || [];
    const highs = extremesForDay.filter((e) => e.type === "High");
    const lows = extremesForDay.filter((e) => e.type === "Low");

    const sunrise = wIdx >= 0 && weather.daily.sunrise[wIdx] ? new Date(weather.daily.sunrise[wIdx]) : null;
    const sunset = wIdx >= 0 && weather.daily.sunset[wIdx] ? new Date(weather.daily.sunset[wIdx]) : null;

    const solunar = window.SolunarCalc.getSolunarInfo(date, lat, lon, { sunrise, sunset });
    const moon = window.MoonCalc.getMoonInfo(date);

    const tideCurve = tides.missingDays.includes(iso) ? null : buildDayCurve(date, tides.sortedEvents);
    const oceanCurrent = dailyOceanCurrent(marine.hourly, iso);

    days.push({
      date,
      iso,
      dow: new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: tz }).format(date),
      dayMonth: new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone: tz }).format(date),
      solunar,
      moon,
      tideHighs: highs,
      tideLows: lows,
      // Full sorted high/low list across the whole 14-day window (not
      // just this day) - passed through so the reference-height overlay
      // in `tideCurveSvg()` can find the correct nearest peak/trough even
      // for crossings near midnight, where the nearest extremum may fall
      // on the adjacent day and wouldn't be in `tideHighs`/`tideLows`.
      tideAllEvents: tides.sortedEvents,
      tideCurve,
      tidesMissing: tides.missingDays.includes(iso),
      waveHeight: mIdx >= 0 ? marine.daily.wave_height_max[mIdx] : null,
      swellHeight: mIdx >= 0 ? marine.daily.swell_wave_height_max[mIdx] : null,
      swellDir: mIdx >= 0 ? marine.daily.swell_wave_direction_dominant[mIdx] : null,
      swellPeriod: mIdx >= 0 ? marine.daily.swell_wave_period_max[mIdx] : null,
      windWaveHeight: mIdx >= 0 ? marine.daily.wind_wave_height_max[mIdx] : null,
      windWaveDir: mIdx >= 0 ? marine.daily.wind_wave_direction_dominant[mIdx] : null,
      windWavePeriod: mIdx >= 0 ? marine.daily.wind_wave_period_max[mIdx] : null,
      waveHourly: hourlyWaveForDay(marine.hourly, iso),
      waveEnergy: waveEnergyKJ(
        mIdx >= 0 ? marine.daily.swell_wave_height_max[mIdx] : null,
        mIdx >= 0 ? marine.daily.swell_wave_period_max[mIdx] : null,
      ),
      seaTemp: dailySeaTemp(marine.hourly, iso),
      currentSpeed: oceanCurrent.speed,
      currentDir: oceanCurrent.dir,
      pressure: dailyPressure(weather.hourly, iso),
      uvIndexMax: wIdx >= 0 ? weather.daily.uv_index_max[wIdx] : null,
      tempMin: wIdx >= 0 ? weather.daily.temperature_2m_min[wIdx] : null,
      tempMax: wIdx >= 0 ? weather.daily.temperature_2m_max[wIdx] : null,
      weatherCode: wIdx >= 0 ? weather.daily.weathercode[wIdx] : null,
      windDir: wIdx >= 0 ? weather.daily.winddirection_10m_dominant[wIdx] : null,
      windSpeed: wIdx >= 0 ? weather.daily.windspeed_10m_max[wIdx] : null,
      windAvg: wIdx >= 0 ? weather.daily.windspeed_10m_mean[wIdx] : null,
      windGust: wIdx >= 0 ? weather.daily.windgusts_10m_max[wIdx] : null,
      windHourly: hourlyWindForDay(weather.hourly, iso),
      currentHourly: hourlyCurrentForDay(marine.hourly, iso),
      sunrise,
      sunset,
      rainMm: wIdx >= 0 ? weather.daily.precipitation_sum[wIdx] : null,
      rainChance: wIdx >= 0 ? weather.daily.precipitation_probability_max[wIdx] : null,
      tz,
    });
  }

  let curveScale = null;
  const allHeights = days.flatMap((d) => (d.tideCurve || []).map((p) => p.h));
  if (allHeights.length) {
    const min = Math.min(...allHeights), max = Math.max(...allHeights);
    const pad = (max - min) * 0.08 || 0.1;
    curveScale = { min: min - pad, max: max + pad };
  }

  // Attach the king-tide thresholds to curveScale (rather than a separate
  // object threaded through render()) since every place that already
  // receives curveScale (tideCurveSvg(), tideCell()) is exactly where this
  // is needed too. Falls back to a window-relative estimate (top/bottom
  // 15% of *this* 14-day window's own range - the pre-existing behaviour)
  // when no local-CSV station data is available at all.
  if (curveScale) {
    if (kingTideThresholds) {
      curveScale.kingHigh = kingTideThresholds.highThreshold;
      curveScale.kingLow = kingTideThresholds.lowThreshold;
      curveScale.kingTideIsStationWide = true;
    } else {
      const span = curveScale.max - curveScale.min;
      curveScale.kingHigh = curveScale.max - span * 0.15;
      curveScale.kingLow = curveScale.min + span * 0.15;
      curveScale.kingTideIsStationWide = false;
    }
  }

  // Shared 0..max scale for the wave/swell bar icon, so a 3m day always
  // looks taller than a 1m day across the whole window (not autoscaled
  // per-cell, same principle as curveScale above).
  let waveScale = null;
  const allWaveHeights = days.flatMap((d) => [d.waveHeight, d.swellHeight]).filter((v) => v != null);
  if (allWaveHeights.length) {
    waveScale = { max: Math.max(...allWaveHeights) * 1.1 || 1 };
  }

  // Shared scales for the hourly Wave/Swell/Wind-chop *timeline* rows
  // (waveTimelineHtml/swellTimelineHtml/windWaveTimelineHtml). These used
  // to self-scale per-day (each day's own hourly max mapped to a full-height
  // bar), which meant a flat 0.1-0.2m day and a genuinely rough 1.1m+ day
  // could render with near-identical bar heights - misleading at a glance
  // and the reported bug ("0.2m bars look as tall as 1.1m bars"). Using one
  // fixed max across the whole 14-day window (mirroring waveScale above)
  // makes bar height comparable both across hours *and* across days.
  const allHourlyWaveSwell = days.flatMap((d) => (d.waveHourly || []).flatMap((h) => [h.wave, h.swell])).filter((v) => v != null);
  const waveTimelineScale = { max: Math.max(0.3, ...allHourlyWaveSwell) * 1.1 };
  const allHourlyWindWave = days.flatMap((d) => (d.waveHourly || []).map((h) => h.windWave)).filter((v) => v != null);
  const windWaveTimelineScale = { max: Math.max(0.3, ...allHourlyWindWave) * 1.1 };

  // Oldest fetchedAt across everything we actually used (fresh network calls
  // count as "now"; cached fallbacks carry their original timestamp) tells
  // us how stale the *most stale* piece of live data is.
  const fetchedAts = [weatherResult.fetchedAt, marineResult.fetchedAt].filter(Boolean);
  const anyFromCache = weatherResult.fromCache || marineResult.fromCache || tides.stale;
  const oldestFetchedAt = fetchedAts.length ? Math.min(...fetchedAts) : null;

  const weatherNotes = [];
  if (weatherResult.error) weatherNotes.push(`Weather/wind/sun unavailable for this date range (${weatherResult.error.message})`);
  if (marineResult.error) weatherNotes.push(`Waves/swell/sea temp unavailable for this date range (${marineResult.error.message})`);

  // Even on a "successful" request, a retry may have clipped the range to
  // what Open-Meteo actually has available (see fetchWeather/fetchMarine),
  // so some days at the start/end of the 14-day window may still have no
  // weather/marine data even though no error was thrown. Surface that too.
  if (!weatherResult.error) {
    const missing = days.filter((d) => !weather.daily.time.includes(d.iso)).length;
    if (missing) weatherNotes.push(`Weather/wind/sun unavailable for ${missing} of 14 day(s) (outside Open-Meteo's forecast range)`);
  }
  if (!marineResult.error) {
    const missing = days.filter((d) => !marine.daily.time.includes(d.iso)).length;
    if (missing) weatherNotes.push(`Waves/swell/sea temp unavailable for ${missing} of 14 day(s) (outside Open-Meteo's forecast range)`);
  }

  return {
    days,
    tideSource: tides.source,
    tideNotes: tides.notes,
    weatherNotes,
    curveScale,
    waveScale,
    waveTimelineScale,
    windWaveTimelineScale,
    dataFromCache: anyFromCache,
    oldestFetchedAt,
  };
}

// ---------- rendering ----------

function starString(rating) {
  return "\u2605".repeat(rating) + "\u2606".repeat(5 - rating);
}

// Screen-only colour-coding thresholds. These give a quick "at a glance"
// signal for notably strong/adverse conditions; they are fixed, general
// wind/rain thresholds (not relative to the 14-day window) so the same
// colour always means the same real-world condition. Print stays plain
// black via `.print-table` CSS overrides regardless of these classes.

// Wind-speed colour scale, reproduced from windfinder.com's own forecast
// table stylesheet (`.ws0`..`.ws26`, one colour step per knot from calm
// purple/blue through green/yellow to red and finally hot-pink for extreme
// gale-force wind) - see docs/ARCHITECTURE.md for how this was sourced.
// Windfinder indexes by knots, so km/h is converted before indexing.
const WIND_SPEED_COLORS = [
  "#9700ff", "#6400ff", "#3200ff", "#0032ff", "#0064ff", "#0096ff", "#00c7ff",
  "#00e6f0", "#25c192", "#11d411", "#00e600", "#00fa00", "#b8ff61", "#fffe00",
  "#ffe100", "#ffc800", "#ffaf00", "#ff9600", "#e67d00", "#e66400", "#dc4a1d",
  "#c8321d", "#b4191d", "#aa001d", "#b40032", "#c80064", "#fe0096",
];
// Indices whose background is dark enough to need white text (windfinder
// pairs the two lowest bands - purple/blue - and the reds/pinks at the top
// with white text; the green/yellow/orange middle bands use black text).
const WIND_SPEED_WHITE_TEXT = new Set([0, 1, 2, 3, 4, 5, 18, 19, 20, 21, 22, 23, 24, 25, 26]);

function windSpeedColorIndex(speedKmh) {
  const knots = speedKmh / 1.852;
  return Math.max(0, Math.min(WIND_SPEED_COLORS.length - 1, Math.round(knots)));
}

// Parses a "#rrggbb" hex colour string into an [r,g,b] byte array.
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Continuous colour lookup for a `{max, color}` band scale (as used by
// CURRENT_SPEED_SCALE / WAVE_HEIGHT_SCALE below), replacing a hard
// per-band lookup with smooth linear RGB interpolation so colour changes
// gradually with the value instead of jumping abruptly at each threshold.
// Treats each band's own `max` as an anchor point where its colour is
// "fully reached", and linearly blends between a band's colour and the
// next band's colour across the value range leading up to that next
// threshold (the first band's colour is anchored at value 0). Values at
// or beyond the second-to-last threshold clamp to the final band's colour
// (its `max` is Infinity, so there's no "next" anchor to blend towards).
function interpolatedScaleColor(scale, value) {
  const n = scale.length;
  // Values within the first band render flat at its colour (no "previous"
  // colour to blend from); each subsequent band's colour is reached
  // exactly at its own `max` threshold, with a linear RGB blend from the
  // previous band's colour across the range leading up to it. The final
  // band's `max` is Infinity, so anything beyond the second-to-last
  // threshold clamps to the final colour.
  if (value <= scale[0].max) return scale[0].color;
  for (let i = 1; i < n - 1; i++) {
    const lo = scale[i - 1].max;
    const hi = scale[i].max;
    if (value <= hi) {
      const t = hi === lo ? 1 : (value - lo) / (hi - lo);
      const from = hexToRgb(scale[i - 1].color);
      const to = hexToRgb(scale[i].color);
      return rgbToHex(from.map((c, k) => c + (to[k] - c) * t));
    }
  }
  return scale[n - 1].color;
}

// Returns inline style (not just a class) since the colour is a continuous
// per-knot scale rather than a few fixed buckets - matches windfinder's own
// approach of one CSS class per knot value.
function windSpeedStyle(speedKmh) {
  if (speedKmh == null) return "";
  const idx = windSpeedColorIndex(speedKmh);
  const color = WIND_SPEED_WHITE_TEXT.has(idx) ? "#fff" : "#111";
  return `background-color:${WIND_SPEED_COLORS[idx]};color:${color}`;
}

function rainChanceClass(pct) {
  if (pct == null) return "";
  if (pct >= 60) return "value-high";
  if (pct >= 30) return "value-med";
  return "";
}

// 8-stage weather-map temperature colour scale (deep violet = extreme cold -> magenta = extreme heat).
const TEMP_SCALE = [
  { max: -10, color: "#5E35B1" }, // below -10C: deep violet
  { max: 0, color: "#1565C0" },   // -10 to 0C: dark blue
  { max: 10, color: "#0288D1" },  // 0 to 10C: light blue/cyan
  { max: 20, color: "#43A047" },  // 10 to 20C: green
  { max: 30, color: "#FDD835" },  // 20 to 30C: gold
  { max: 35, color: "#FB8C00" },  // 30 to 35C: orange
  { max: 40, color: "#E53935" },  // 35 to 40C: crimson red
  { max: Infinity, color: "#D81B60" }, // above 40C: magenta
];

// Luminance-based contrast: light backgrounds (cyan, green, gold) get black text,
// dark/saturated backgrounds (violet, dark blue, crimson, magenta) get white text.
const TEMP_WHITE_TEXT_MAX_INDEX = new Set([0, 1, 6, 7]); // violet, dark blue, crimson, magenta

function tempColor(tempC) {
  if (tempC == null) return null;
  for (const stage of TEMP_SCALE) {
    if (tempC < stage.max || stage.max === Infinity) return stage.color;
  }
  return TEMP_SCALE[TEMP_SCALE.length - 1].color;
}

function tempStageIndex(tempC) {
  for (let i = 0; i < TEMP_SCALE.length; i++) {
    if (tempC < TEMP_SCALE[i].max || TEMP_SCALE[i].max === Infinity) return i;
  }
  return TEMP_SCALE.length - 1;
}

function tempStyle(tempC, isPrint) {
  const color = tempColor(tempC);
  if (!color || isPrint) return "";
  const idx = tempStageIndex(tempC);
  const textColor = TEMP_WHITE_TEXT_MAX_INDEX.has(idx) ? "#fff" : "#111";
  return ` style="background-color:${color};color:${textColor}"`;
}

// Ocean-current-speed colour scale. There's no single official standard,
// but oceanographic/marine charts (e.g. NOAA surface-current maps) commonly
// use a "blue = slow, green/yellow = moderate, red/purple = fast" ramp with
// breakpoints in the roughly-0-4kt range typical of most coastal tidal
// currents (unlike wind, which regularly spans 0-60+ knots) - see
// docs/ARCHITECTURE.md for sourcing notes. Thresholds are in km/h (as
// returned by Open-Meteo) but chosen to land on round knot values
// (0.5/1/1.5/2/3/4kt) since that's how current strength is conventionally
// described.
const CURRENT_SPEED_SCALE = [
  { max: 0.9, color: "#0064ff" },   // < 0.5kt: calm - blue
  { max: 1.85, color: "#00c7ff" },  // 0.5-1kt: light blue
  { max: 2.8, color: "#11d411" },   // 1-1.5kt: green
  { max: 3.7, color: "#fffe00" },   // 1.5-2kt: yellow
  { max: 5.6, color: "#ff9600" },   // 2-3kt: orange
  { max: 7.4, color: "#e66400" },   // 3-4kt: dark orange/red
  { max: Infinity, color: "#b40032" }, // 4kt+: deep red/magenta
];

// Perceptual luminance (per ITU-R BT.601) of a "#rrggbb" colour, used to
// pick black/white text for contrast against an interpolated (not a fixed
// lookup-table) background colour - replaces the old white-text index set
// approach, which only worked for a small fixed set of discrete colours.
function readableTextColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance < 140 ? "#fff" : "#111";
}

// Barometric pressure (hPa) colour scale - screen-only Pressure row.
// Anglers commonly treat falling/low pressure as favourable for fish
// activity and high/stable pressure as neutral, so this is coloured as a
// low->high gradient. Standard meteorological pressure maps use blue for
// low pressure and red/purple for high pressure (e.g. OpenWeatherMap's
// pressure layer) - this follows that same blue->purple convention rather
// than reusing the wind/current speed ramps, since pressure is a much
// narrower, slower-moving value (typically 990-1030hPa) than either.
const PRESSURE_SCALE = [
  { max: 1005, color: "#0033cc" },  // low pressure - deep blue
  { max: 1013, color: "#3399ff" },  // below-average - blue
  { max: 1018, color: "#9966cc" },  // average - blue-violet
  { max: 1023, color: "#8a2be2" },  // above-average - violet
  { max: Infinity, color: "#5b0e91" }, // high pressure - deep purple
];
const PRESSURE_WHITE_TEXT_MAX_INDEX = new Set([0, 1, 2, 3, 4]);

function pressureStageIndex(hpa) {
  for (let i = 0; i < PRESSURE_SCALE.length; i++) {
    if (hpa < PRESSURE_SCALE[i].max) return i;
  }
  return PRESSURE_SCALE.length - 1;
}

function pressureStyle(hpa) {
  if (hpa == null) return "";
  const idx = pressureStageIndex(hpa);
  const textColor = PRESSURE_WHITE_TEXT_MAX_INDEX.has(idx) ? "#fff" : "#111";
  return ` style="background-color:${PRESSURE_SCALE[idx].color};color:${textColor}"`;
}

// UV index colour scale - standard WHO/EPA UV index bands and colours
// (Low=green, Moderate=yellow, High=orange, Very High=red, Extreme=violet).
const UV_SCALE = [
  { max: 3, color: "#00e600", label: "Low" },
  { max: 6, color: "#fffe00", label: "Moderate" },
  { max: 8, color: "#ff9600", label: "High" },
  { max: 11, color: "#ff0000", label: "Very High" },
  { max: Infinity, color: "#8a2be2", label: "Extreme" },
];
const UV_WHITE_TEXT_MAX_INDEX = new Set([3, 4]);

function uvStageIndex(uv) {
  for (let i = 0; i < UV_SCALE.length; i++) {
    if (uv < UV_SCALE[i].max) return i;
  }
  return UV_SCALE.length - 1;
}

function uvBadgeHtml(uv) {
  if (uv == null) return "";
  const idx = uvStageIndex(uv);
  const textColor = UV_WHITE_TEXT_MAX_INDEX.has(idx) ? "#fff" : "#111";
  return `<span class="uv-badge" title="UV index: ${UV_SCALE[idx].label}" style="background-color:${UV_SCALE[idx].color};color:${textColor}">UV ${uv.toFixed(0)}</span>`;
}

function tideCell(list, tz, sunrise, sunset, curveScale, kind, isPrint) {
  if (!list || !list.length) return "\u2014";
  return list.map((e, i) => {
    const isDaylight = sunrise && sunset && e.dt >= sunrise && e.dt <= sunset;
    const timeHtml = isDaylight ? `<strong>${fmtTime(e.dt, tz)}</strong>` : fmtTime(e.dt, tz);
    let heightClass = "";
    if (curveScale && kind === "high" && e.height >= curveScale.kingHigh) heightClass = "value-high";
    if (curveScale && kind === "low" && e.height <= curveScale.kingLow) heightClass = "value-cold";
    const stagger = i % 2 === 0 ? "tide-entry--left" : "tide-entry--right";
    // Print packs both events for the day onto a single row (rather than
    // stacking each event on its own line as the screen view does), with
    // the height shown smaller in brackets right after the time - this is
    // what let the High tide/Low tide rows each collapse to one printed
    // row instead of two, trimming enough height to fit 2 full A4 pages.
    if (isPrint) {
      return `<span class="tide-entry-print ${stagger}">${timeHtml} <span class="muted tide-entry-height ${heightClass}">(${e.height.toFixed(2)}m)</span></span>`;
    }
    return `<div class="tide-entry ${stagger}"><span class="tide-entry-time">${timeHtml}</span><span class="muted tide-entry-height ${heightClass}">${e.height.toFixed(2)}m</span></div>`;
  }).join("");
}

// Renders the smooth tide-height curve for one day as an inline SVG
// (sine/cosine-interpolated between the day's actual high/low points — see
// buildDayCurve() in the data layer), with small "H"/"L" markers + height
// labels plotted directly on each peak/trough. `scale` is shared across all
// days so bigger tide swings visually read as taller waves. No internal
// horizontal padding is used (pad=0) and the cell itself has zero
// horizontal padding (see .tide-curve-cell), so each day's curve touches
// both edges of its cell exactly - this makes the curve look continuous
// across the day boundary instead of visually "breaking" at each cell
// border.
function tideCurveSvg(d, scale, intervalHours, isPrint) {
  const points = d.tideCurve;
  if (!points || !scale) return '<span class="muted">\u2014</span>';
  const w = 150, h = 92, padY = 4, labelPad = 12, labelPadBottom = 12;
  const range = scale.max - scale.min || 1;
  const dayStartMs = d.date.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const usableH = h - padY * 2 - labelPad - labelPadBottom;
  const xFor = (dt) => Math.max(0, Math.min(w, ((dt.getTime() - dayStartMs) / dayMs) * w));
  const yFor = (height) => padY + labelPad + usableH * (1 - (height - scale.min) / range);

  const stepX = w / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = yFor(p.h);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = `0,${h} ${coords.join(" ")} ${w},${h}`;
  // Depth-shaded fill: a vertical gradient from a deeper blue at the top
  // (near high-tide peaks - "more water") to a lighter blue at the bottom
  // (near low-tide troughs - "less water"), so the filled area itself
  // reads like a simple depth gauge at a glance, on top of the existing
  // H/L text labels. Applied as an SVG presentation attribute (not a CSS
  // `fill:` declaration) specifically so the print stylesheet's
  // `.print-table .tide-curve-fill { fill: #000 }` override (a real CSS
  // rule, which always wins over a presentation attribute) can still force
  // solid black in print regardless. Each day needs its own gradient `id`
  // since all 14 SVGs share one DOM/document.
  const gradientId = `tideGrad-${d.iso}`;
  const clipId = `tideClip-${d.iso}`;
  const gradientDefs = `<defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#0b4f8a"></stop>` +
    `<stop offset="1" stop-color="#bcdcf2"></stop>` +
    `</linearGradient>` +
    `<clipPath id="${clipId}"><polygon points="${areaPoints}"></polygon></clipPath>` +
    `</defs>`;

  // "King tide" zone shading: a horizontal band marking the top/bottom of
  // this station's usual tide range (see getStationAnnualExtremes() in
  // js/tides.js - the station's own highest 25% of highs / lowest 25% of
  // lows, from the full bundled-year CSV, not just this 14-day window),
  // clipped to the curve's own filled area (via `clipId` above) so the
  // shading only actually appears where this day's curve pokes up/down
  // into that zone, rather than as a distracting full-width stripe
  // regardless of whether today's tide even reaches it. Screen tints it a
  // subtle red (`.tide-king-zone`), print instead uses a darker grey fill
  // (see `.print-table .tide-king-zone`) since colour tinting doesn't
  // reliably print in B&W. Skipped entirely if this station has no known
  // threshold (e.g. a flat/degenerate curve).
  let kingZoneSvg = "";
  if (scale.kingHigh != null && scale.kingLow != null) {
    const yKingHigh = yFor(scale.kingHigh);
    const yKingLow = yFor(scale.kingLow);
    let zones = "";
    if (yKingHigh > 0) {
      // High zone: the area fill already only exists above a given y where
      // the curve actually reaches that high, so simply clipping a
      // 0..yKingHigh rect to the curve's own fill area correctly restricts
      // it to "where the curve pokes above the threshold".
      zones += `<rect x="0" y="0" width="${w}" height="${yKingHigh.toFixed(1)}" class="tide-king-zone tide-king-zone--high"></rect>`;
    }
    if (yKingLow < h) {
      // Low zone: the area fill always extends down to the bottom edge
      // regardless of the curve's height at that x, so clipping a rect the
      // same way as above would (wrongly) shade the full width. Instead
      // build a dedicated polygon whose top edge is clamped to
      // max(curveY, yKingLow) - this collapses to zero height wherever the
      // curve stays above (i.e. shallower than) the threshold, and only
      // gains area where the curve actually dips below it.
      const lowCoords = points.map((p, i) => `${(i * stepX).toFixed(1)},${Math.max(yFor(p.h), yKingLow).toFixed(1)}`);
      zones += `<polygon points="0,${h} ${lowCoords.join(" ")} ${w},${h}" class="tide-king-zone tide-king-zone--low"></polygon>`;
    }
    kingZoneSvg = `<g clip-path="url(#${clipId})">${zones}</g>`;
  }

  // Night shading: darken the portion of the 24h width that falls before
  // sunrise and after sunset, so it's visible at a glance whether a given
  // high/low tide occurs during daylight or after dark. Falls back to no
  // shading if sunrise/sunset aren't available for this day.
  let nightSvg = "";
  if (d.sunrise && d.sunset) {
    const xSunrise = xFor(d.sunrise);
    const xSunset = xFor(d.sunset);
    nightSvg =
      `<rect x="0" y="0" width="${xSunrise.toFixed(1)}" height="${h}" class="tide-night"></rect>` +
      `<rect x="${xSunset.toFixed(1)}" y="0" width="${(w - xSunset).toFixed(1)}" height="${h}" class="tide-night"></rect>`;
  }

  // H/L markers: only for extrema that actually fall within this day (an
  // event just before midnight belongs to the previous day's cell, etc.).
  // Rendered as HTML (not inside the SVG) because the SVG uses
  // `preserveAspectRatio="none"` to stretch the curve to fill whatever
  // width the column ends up at (which varies - e.g. wider once the
  // Wind (2h) row is present) - shapes/text *inside* that SVG get
  // stretched non-uniformly along with it, which distorted both the dot
  // markers (into ellipses) and the "H"/"L" glyphs on wide columns. An
  // absolutely positioned HTML overlay uses real pixel-shaped dots/text at
  // any column width, while still tracking the curve position via
  // percentage offsets.
  const markerDefs = [...d.tideHighs.map((e) => ({ ...e, letter: "H" })), ...d.tideLows.map((e) => ({ ...e, letter: "L" }))]
    .filter((e) => e.dt.getTime() >= dayStartMs && e.dt.getTime() <= dayStartMs + dayMs);
  const markerOverlay = markerDefs
    .map((e) => {
      const x = xFor(e.dt);
      const y = yFor(e.height);
      const above = e.letter === "H"; // put the label above high peaks, below low troughs
      const leftPct = (x / w) * 100;
      const topPct = (y / h) * 100;
      const labelAlign = above ? "translate(-50%, -125%)" : "translate(-50%, 25%)";
      return `<span class="tide-marker-dot tide-marker-dot--${e.letter === "H" ? "high" : "low"}" style="left:${leftPct.toFixed(1)}%; top:${topPct.toFixed(1)}%;"></span>` +
        `<span class="tide-marker-label tide-marker-label--${e.letter === "H" ? "high" : "low"}" style="left:${leftPct.toFixed(1)}%; top:${topPct.toFixed(1)}%; transform:${labelAlign};">${e.letter} ${e.height.toFixed(1)}m</span>`;
    }).join("");

  // Time-of-day axis: hour tick labels ("00", "02"/"04", ... ) above the
  // curve, at the same `intervalHours` used for the Wind timeline row (2h
  // on screen, 4h in print) so the two timeline rows visually line up -
  // same idea as the marker overlay: plain HTML positioned by percentage
  // via `xFor()`, so ticks stay pixel-perfect at any column width rather
  // than being stretched by the SVG's `preserveAspectRatio="none"`.
  const step = intervalHours || 2;
  const axisTicks = [];
  for (let hr = 0; hr < 24; hr += step) {
    const dt = new Date(dayStartMs + hr * 60 * 60 * 1000);
    axisTicks.push({ hr, x: xFor(dt) });
  }
  const axisOverlay = axisTicks.map((t) => {
    const leftPct = (t.x / w) * 100;
    return `<span class="tide-axis-tick" style="left:${leftPct.toFixed(1)}%;"></span>` +
      `<span class="tide-axis-label" style="left:${leftPct.toFixed(1)}%;">${String(t.hr).padStart(2, "0")}</span>`;
  }).join("");

  // Reference-height overlay: user-entered "critical depth" (see
  // `refTideHeight` / the input in the Tide curve row label). Drawn on
  // both screen AND print (unlike the mouse-hover readout) since it's an
  // explicit trip-planning value the user wants to see and rely on when
  // laminated. A dotted horizontal line at that height, plus a small dot +
  // time label at every point this day's curve actually crosses it -
  // there can be 0, 1, 2 (typical, once per rising/falling side of a
  // tide) or more crossings per day. Both crossings that flank the same
  // peak/trough always get placed on the SAME side (below for a high
  // peak, above for a low trough - see `nearestExtremumIsHigh()`), so the
  // pair reads as a matched "leave by / back by" set rather than being
  // split across the line.
  let refOverlay = "";
  if (refTideHeight != null && !isNaN(refTideHeight) && refTideHeight >= scale.min && refTideHeight <= scale.max) {
    const yPct = (yFor(refTideHeight) / h) * 100;
    const crossings = findHeightCrossings(points, refTideHeight, d.tideAllEvents);
    const crossingHtml = crossings.map((c) => {
      const xPct = (xFor(c.t) / w) * 100;
      // Pre-rotation arrow glyphs: the label (including the arrow) is
      // rotated -90deg via CSS so the whole thing reads bottom-to-top -
      // a "\u2192" (right arrow) rotated -90deg ends up pointing straight
      // up, and "\u2190" (left arrow) ends up pointing straight down, so
      // using those (rather than the "upright" \u2191/\u2193 glyphs, which
      // would end up sideways once rotated) keeps the arrow direction
      // visually correct after rotation.
      const arrow = c.rising ? "\u2192" : "\u2190";
      const nearestIsHigh = nearestExtremumIsHigh(c);
      const sideClass = nearestIsHigh ? "tide-ref-time--below" : "tide-ref-time--above";
      // Two narrow spaces (U+2009) between the arrow glyph and the time
      // text - a plain " " renders too tight at this font size once
      // rotated -90deg; using the Unicode thin-space keeps a small but
      // consistent visual gap without materially lengthening the label
      // (which would need a bigger dot-to-label clearance to still fit
      // within the print row height).
      return `<span class="tide-ref-dot" style="left:${xPct.toFixed(1)}%; top:${yPct.toFixed(1)}%;"></span>` +
        `<span class="tide-ref-time ${sideClass}" style="left:${xPct.toFixed(1)}%; top:${yPct.toFixed(1)}%;">${arrow}\u2009\u2009${fmtTime(c.t, d.tz)}</span>`;
    }).join("");
    refOverlay = `<div class="tide-ref-line" style="top:${yPct.toFixed(1)}%;"></div>${crossingHtml}`;
  }

  return `<div class="tide-curve-wrap">` +
    `<div class="tide-axis">${axisOverlay}</div>` +
    `<div class="tide-curve-plot"${isPrint ? "" : ` data-tide-hover data-points='${JSON.stringify(points.map((p) => ({ t: p.t.getTime(), h: p.h })))}' data-tz="${d.tz}" data-daystart="${dayStartMs}" data-w="${w}" data-h="${h}" data-scale-min="${scale.min}" data-scale-max="${scale.max}"`}>` +
    `<svg class="tide-curve-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Tide height curve">` +
    gradientDefs +
    nightSvg +
    `<polygon points="${areaPoints}" class="tide-curve-fill" fill="url(#${gradientId})"></polygon>` +
    kingZoneSvg +
    `<polyline points="${coords.join(" ")}" class="tide-curve-line"></polyline>` +
    `</svg>` +
    markerOverlay +
    refOverlay +
    (isPrint ? "" : `<div class="tide-hover-line"></div><div class="tide-hover-dot"></div><div class="tide-hover-tooltip"></div>`) +
    `</div>` +
    `</div>`;
}

// Interactive hover/touch readout for the tide curve (screen only): shows
// the exact time + interpolated tide height at any point the user hovers
// or drags along the curve, similar to tide-forecast.com's own tide chart.
// Delegated to a single pair of listeners on the whole screen table
// (rather than one per cell) since `render()` rebuilds the table on every
// refresh - re-attaching per-cell listeners would leak. Each
// `.tide-curve-plot[data-tide-hover]` carries its own day's sample points
// (`data-points`, the same 20-min-step array `tideCurveSvg()` already
// plots) as a JSON attribute, so no extra data source or refetch is
// needed - just linear interpolation between the two nearest samples for
// smooth in-between readings.
function wireTideCurveHover(container) {
  let activePlot = null;

  function updateFromClientX(plot, clientX) {
    const rect = plot.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pts = JSON.parse(plot.dataset.points);
    const dayStart = Number(plot.dataset.daystart);
    const tz = plot.dataset.tz;
    const w = Number(plot.dataset.w), h = Number(plot.dataset.h);
    const fracX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const targetMs = dayStart + fracX * 24 * 60 * 60 * 1000;

    // Find the two bracketing sample points and linearly interpolate.
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].t < targetMs) i++;
    const p0 = pts[i], p1 = pts[Math.min(i + 1, pts.length - 1)];
    const span = p1.t - p0.t;
    const frac = span > 0 ? (targetMs - p0.t) / span : 0;
    const height = p0.h + (p1.h - p0.h) * frac;
    const t = new Date(p0.t + (p1.t - p0.t) * frac);

    const padY = 4, labelPad = 12, labelPadBottom = 12;
    const usableH = h - padY * 2 - labelPad - labelPadBottom;
    // Recompute scale bounds from the min/max of this day's own points is
    // not available here directly, so instead derive y purely from the
    // fraction along x using the already-plotted SVG polyline geometry:
    // simplest is to reuse the same padY/labelPad/usableH constants
    // `tideCurveSvg()` uses, and the day's min/max via the dataset.
    const scaleMin = Number(plot.dataset.scaleMin), scaleMax = Number(plot.dataset.scaleMax);
    const range = scaleMax - scaleMin || 1;
    const yFrac = 1 - (height - scaleMin) / range;
    const yPct = ((padY + labelPad + usableH * yFrac) / h) * 100;
    const xPct = fracX * 100;

    const line = plot.querySelector(".tide-hover-line");
    const dot = plot.querySelector(".tide-hover-dot");
    const tip = plot.querySelector(".tide-hover-tooltip");
    if (!line || !dot || !tip) return;
    line.style.left = `${xPct.toFixed(2)}%`;
    line.style.display = "block";
    dot.style.left = `${xPct.toFixed(2)}%`;
    dot.style.top = `${yPct.toFixed(2)}%`;
    dot.style.display = "block";
    tip.textContent = `${fmtTime(t, tz)} \u00B7 ${height.toFixed(2)}m`;
    tip.style.left = `${xPct.toFixed(2)}%`;
    tip.style.top = `${yPct.toFixed(2)}%`;
    tip.classList.toggle("tide-hover-tooltip--flip", xPct > 70);
    tip.style.display = "block";
  }

  function hide(plot) {
    const line = plot.querySelector(".tide-hover-line");
    const dot = plot.querySelector(".tide-hover-dot");
    const tip = plot.querySelector(".tide-hover-tooltip");
    if (line) line.style.display = "none";
    if (dot) dot.style.display = "none";
    if (tip) tip.style.display = "none";
  }

  container.addEventListener("mousemove", (e) => {
    const plot = e.target.closest("[data-tide-hover]");
    if (plot) updateFromClientX(plot, e.clientX);
  });
  container.addEventListener("click", (e) => {
    const plot = e.target.closest("[data-tide-hover]");
    if (!plot) return;
    const rect = plot.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pts = JSON.parse(plot.dataset.points);
    const dayStart = Number(plot.dataset.daystart);
    const fracX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetMs = dayStart + fracX * 24 * 60 * 60 * 1000;
    let i = 0;
    while (i < pts.length - 1 && pts[i + 1].t < targetMs) i++;
    const p0 = pts[i], p1 = pts[Math.min(i + 1, pts.length - 1)];
    const span = p1.t - p0.t;
    const frac = span > 0 ? (targetMs - p0.t) / span : 0;
    const height = p0.h + (p1.h - p0.h) * frac;
    setRefTideHeight(Math.round(height * 100) / 100);
    if (lastRenderArgs) render(lastRenderArgs.days, lastRenderArgs.settings, lastRenderArgs.tideMeta);
  });
  container.addEventListener("mouseleave", (e) => {
    const plot = e.target.closest ? e.target.closest("[data-tide-hover]") : null;
    if (plot) hide(plot);
    else container.querySelectorAll("[data-tide-hover]").forEach(hide);
  }, true);
  container.addEventListener("touchstart", (e) => {
    const plot = e.target.closest("[data-tide-hover]");
    if (plot && e.touches[0]) { updateFromClientX(plot, e.touches[0].clientX); activePlot = plot; }
  }, { passive: true });
  container.addEventListener("touchmove", (e) => {
    if (activePlot && e.touches[0]) updateFromClientX(activePlot, e.touches[0].clientX);
  }, { passive: true });
  container.addEventListener("touchend", () => { if (activePlot) hide(activePlot); activePlot = null; });
}

// Wires the "reference tide height" number input that sits in the Tide
// curve row's label cell (only one exists at a time - it's in the
// screen/interactive table only, `.no-print`, since the print output has
// no way to accept input; the chosen value is still drawn on the *print*
// curves via `tideCurveSvg()`, just entered here). On change, persists the
// value and re-renders the whole table in place so the dotted
// reference-height line + crossing times appear on every day immediately,
// without a network refetch.
function wireRefHeightInput() {
  const input = $("refHeightInput");
  if (!input) return;
  input.addEventListener("change", () => {
    const raw = input.value.trim();
    const n = raw === "" ? null : parseFloat(raw);
    setRefTideHeight(n === null || isNaN(n) ? null : n);
    if (lastRenderArgs) render(lastRenderArgs.days, lastRenderArgs.settings, lastRenderArgs.tideMeta);
  });
}


// Wave energy estimate (kJ/m of wave front, indicative only), following the
// approach documented in surf-forecast.com's public FAQ
// (surf-forecast.com/pages/faq): energy is a function of swell height
// *squared* and swell period linearly - i.e. taller swells matter far more
// than longer ones, but a long-period groundswell still carries noticeably
// more energy than a short-period wind swell of the same height. The
// underlying relationship (E proportional to H^2 * T) matches the standard
// deep-water wave-power approximation P[kW/m] = 0.5 * Hs^2 * Te used in wave
// energy resource assessment; we scale that by a constant factor (10) so a
// typical day's numbers land in the same rough bands surf-forecast.com
// publishes in their FAQ (~100 = just surfable, 200-1000 = punchy,
// 1000-5000+ = heavy/dangerous) - this is an original approximation for
// display purposes, not a reproduction of their (undisclosed) exact formula.
function waveEnergyKJ(swellHeightM, swellPeriodS) {
  if (swellHeightM == null || swellPeriodS == null) return null;
  return swellHeightM * swellHeightM * swellPeriodS * 10;
}

// Buckets a wave energy value into surf-forecast.com's own published bands
// (their FAQ: ~100kJ just surfable, 200-1000kJ increasingly punchy,
// 1000-5000+kJ heavy/dangerous) for colour-coding on screen.
function waveEnergyBand(kj) {
  if (kj == null) return null;
  if (kj < 100) return "flat";
  if (kj < 200) return "small";
  if (kj < 1000) return "punchy";
  if (kj < 3000) return "heavy";
  return "extreme";
}

const WAVE_ENERGY_COLORS = {
  flat: "#cfd8dc",
  small: "#8fc6e8",
  punchy: "#43a047",
  heavy: "#fb8c00",
  extreme: "#d32f2f",
};
const WAVE_ENERGY_WHITE_TEXT = new Set(["punchy", "heavy", "extreme"]);

function waveEnergyStyle(kj, isPrint) {
  const band = waveEnergyBand(kj);
  if (!band || isPrint) return "";
  const textColor = WAVE_ENERGY_WHITE_TEXT.has(band) ? "#fff" : "#111";
  return ` style="background-color:${WAVE_ENERGY_COLORS[band]};color:${textColor}"`;
}

// Wave/swell mini chart - deliberately uses the same visual language as the
// tide curve (a filled shape against a shared scale, drawn with --accent /
// black-in-print) so all three water-height rows read as one family: two
// bars sized against a shared 0..max scale (wave height = lighter/wider,
// swell height = darker/narrower). Each bar shows, stacked top-to-bottom
// within the grey bar: a height-scaled line icon that visually distinguishes
// wind waves from swell (per the classic wave-vs-swell reference diagram -
// wave = steep/asymmetric/hooked crest to evoke local wind chop; swell =
// smooth symmetrical sine-like curve to evoke a long-wavelength harmonic
// swell), then the "WAVE"/"SWELL" tag, then the height value at the very
// bottom - so icon size grows/shrinks with the bar itself and the label
// always sits directly above its value. The swell-direction arrow sits
// between the two bars (with period printed underneath).
function waveIconSvg(d, waveScale, isPrint) {
  if (d.waveHeight == null || !waveScale) return '<span class="muted">\u2014</span>';
  const w = 150, h = 46, padY = 3, padX = 10, barW = 32;
  const max = waveScale.max || 1;
  const barBottomY = h - 2;
  const minBarH = 12, maxBarH = h - padY - 13; // leave room for tag+value below icon
  const waveBarH = minBarH + (maxBarH - minBarH) * Math.min(d.waveHeight / max, 1);
  const swellBarH = d.swellHeight != null ? minBarH + (maxBarH - minBarH) * Math.min(d.swellHeight / max, 1) : minBarH;
  const waveX = padX, swellX = w - padX - barW;
  const arrowCx = w / 2, arrowCy = h / 2 - 2;

  // Each column: icon zone (top of bar down to just above the tag), then
  // the "WAVE"/"SWELL" tag, then the height value at the very bottom.
  const valueY = barBottomY - 2;
  const tagY = valueY - 9;
  const iconBottom = tagY - 5;

  // Wave icon: a single steep, jagged line (asymmetric peaks with a
  // hooked/breaking crest) to evoke a choppy, wind-driven sea - visually
  // distinct from the swell's smooth curve per the classic
  // wave-vs-swell reference diagram (sharp irregular crests vs long
  // symmetrical harmonics). Amplitude grows with the bar height.
  function waveLinesIcon(barTopY, cx) {
    const iconTop = barTopY + 2;
    const iconH = Math.max(iconBottom - iconTop, 7);
    const amp = Math.min(6, Math.max(2.5, iconH / 2.2));
    const midY = iconTop + iconH / 2;
    const halfW = barW / 2 - 3;
    const x0 = cx - halfW, x3 = cx + halfW;
    const qw = halfW / 2;
    // Steep rise, hooked/overturning crest, sharp drop, choppy trough.
    return `<path d="M ${x0} ${midY + amp * 0.3} ` +
      `C ${x0 + qw * 0.5} ${midY + amp * 0.3}, ${x0 + qw * 0.7} ${midY - amp * 0.7}, ${x0 + qw} ${midY - amp} ` +
      `C ${x0 + qw * 1.15} ${midY - amp * 1.15}, ${x0 + qw * 0.9} ${midY - amp * 0.3}, ${cx} ${midY + amp * 0.15} ` +
      `C ${cx + qw * 0.35} ${midY + amp * 0.5}, ${cx + qw * 0.55} ${midY - amp * 0.55}, ${cx + qw} ${midY - amp * 0.85} ` +
      `C ${x3 - qw * 0.15} ${midY - amp * 1.05}, ${x3 - qw * 0.25} ${midY - amp * 0.1}, ${x3} ${midY + amp * 0.3}" ` +
      `class="wave-lines"></path>`;
  }

  // Swell icon: a smooth, symmetrical sine-like curve (long wavelength,
  // rolling harmonic shape) to contrast with the wave's sharp chop.
  // Amplitude scales gently with the bar height.
  function swellLineIcon(barTopY, cx) {
    const iconTop = barTopY + 2;
    const iconH = Math.max(iconBottom - iconTop, 7);
    const amp = Math.min(5, Math.max(2, iconH / 3));
    const y = iconTop + iconH / 2;
    const halfW = barW / 2 - 3;
    const q = halfW / 2;
    return `<path d="M ${cx - halfW} ${y} ` +
      `C ${cx - halfW + q} ${y - amp * 2}, ${cx - q} ${y - amp * 2}, ${cx} ${y} ` +
      `C ${cx + q} ${y + amp * 2}, ${cx + halfW - q} ${y + amp * 2}, ${cx + halfW} ${y}" ` +
      `class="wave-squiggle"></path>`;
  }


  const waveIcon = waveLinesIcon(barBottomY - waveBarH, waveX + barW / 2);
  const swellIcon = swellLineIcon(barBottomY - swellBarH, swellX + barW / 2);

  // Arrow shows the swell's *travel* direction (compass "coming from" + 180),
  // i.e. the way it's heading, drawn as a simple triangle-tipped line,
  // placed between the two bars.
  let arrowSvg = "";
  if (d.swellDir != null) {
    const travelDeg = (d.swellDir + 180) % 360;
    const len = 13;
    arrowSvg = `<g transform="translate(${arrowCx},${arrowCy}) rotate(${travelDeg})">` +
      `<line x1="0" y1="${len / 2}" x2="0" y2="${-len / 2}" class="wave-arrow"></line>` +
      `<polyline points="-4.5,${-len / 2 + 5} 0,${-len / 2} 4.5,${-len / 2 + 5}" class="wave-arrow"></polyline>` +
      `</g>`;
  }

  return `<svg class="wave-icon-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Wave and swell height">` +
    `<rect x="${waveX}" y="${barBottomY - waveBarH}" width="${barW}" height="${waveBarH}" class="wave-bar" opacity="0.22"></rect>` +
    `<rect x="${swellX}" y="${barBottomY - swellBarH}" width="${barW}" height="${swellBarH}" class="wave-bar" opacity="0.55"></rect>` +
    waveIcon +
    swellIcon +
    arrowSvg +
    `<text x="${waveX + barW / 2}" y="${tagY}" text-anchor="middle" class="wave-tag">WAVE</text>` +
    `<text x="${swellX + barW / 2}" y="${tagY}" text-anchor="middle" class="wave-tag">SWELL</text>` +
    `<text x="${waveX + barW / 2}" y="${valueY}" text-anchor="middle" class="wave-label">${d.waveHeight.toFixed(1)}m</text>` +
    `<text x="${swellX + barW / 2}" y="${h - 1}" text-anchor="middle" class="wave-label">${d.swellHeight != null ? d.swellHeight.toFixed(1) + "m" : "\u2014"}</text>` +
    `</svg>` +
    `<div class="muted">${degToCompass(d.swellDir)} swell \u00B7 ${d.swellPeriod != null ? d.swellPeriod.toFixed(0) + "s period" : "\u2014"}</div>` +
    (isPrint || d.windWaveHeight == null ? "" :
      `<div class="muted wind-wave-detail">${degToCompass(d.windWaveDir)} wind chop \u00B7 ${d.windWaveHeight.toFixed(1)}m${d.windWavePeriod != null ? " \u00B7 " + d.windWavePeriod.toFixed(0) + "s" : ""}</div>`);
}

// Wind icon: a compass rose (fixed N/E/S/W ticks + ring, for absolute
// reference) with a tapered wind barb crossing it - a wide/feathered tail
// at the ring edge the wind is blowing *from*, tapering to a sharp point at
// the opposite edge showing where it's blowing *to* (meteorological
// convention). The wind speed sits in a small circle at the centre, on top
// of the barb, as the precise numeric readout.
function windIconSvg(windDir, windSpeed) {
  if (windSpeed == null) return '<span class="muted">\u2014</span>';
  const fromDeg = windDir != null ? windDir : 0; // compass direction the wind comes FROM
  const maxSpeed = 60; // km/h, above which the barb maxes out visually
  const scale = Math.min(windSpeed / maxSpeed, 1);
  const cx = 20, cy = 20;
  const ringR = 15;
  const tailW = 6 + scale * 4; // 6..10, width of the barb's feathered tail
  const centerR = 7.5; // speed circle radius, also where the barb's point stops short

  // Compass ring + fixed (unrotated) cardinal tick marks/labels, giving an
  // absolute frame of reference independent of the wind direction itself.
  const ticks = ["N", "E", "S", "W"].map((label, i) => {
    const ang = i * 90; // 0=N(top), 90=E(right), 180=S(bottom), 270=W(left)
    const rad = (ang - 90) * (Math.PI / 180); // -90 so 0deg points up
    const tx = cx + Math.cos(rad) * (ringR + 5.5);
    const ty = cy + Math.sin(rad) * (ringR + 5.5);
    return `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle" dominant-baseline="central" class="wind-tick-label">${label}</text>`;
  }).join("");

  // Tapered barb: a single wide-to-narrow triangle spanning the *whole*
  // compass diameter - thick, flat tail at the ring edge on the side the
  // wind is coming FROM, tapering to a sharp point at the opposite ring
  // edge (where it's blowing TO). The centre speed-circle is drawn on top
  // afterwards, so it neatly covers the barb's midsection without needing
  // to shorten the shape - only the tail (thick/flat, meteorological
  // "wind is coming from here") and the tip (sharp point, "blowing to
  // here") peek out past the circle, once rotated to the true compass
  // bearing (`fromDeg`, using SVG's clockwise rotate() to match compass
  // bearings directly).
  const halfTail = tailW / 2;
  const tailY = -(ringR - 1); // tail at the ring edge, north before rotation
  const tipY = ringR - 1; // tip at the opposite ring edge, south before rotation
  const barb =
    `<polygon points="${-halfTail.toFixed(1)},${tailY} ${halfTail.toFixed(1)},${tailY} 0,${tipY}" class="wind-barb"></polygon>`;

  return `<svg class="wind-icon-svg" viewBox="0 0 40 40" role="img" aria-label="Wind direction and speed">` +
    `<circle cx="${cx}" cy="${cy}" r="${ringR}" class="wind-ring"></circle>` +
    ticks +
    `<g transform="translate(${cx},${cy}) rotate(${fromDeg})">${barb}</g>` +
    `<circle cx="${cx}" cy="${cy}" r="${centerR}" class="wind-circle"></circle>` +
    `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" class="wind-speed-label">${Math.round(windSpeed)}</text>` +
    `</svg>`;
}


// Small version of the wind barb (no ring/ticks/speed circle - just the
// tapered triangle itself) for compact per-hour timeline use in the
// "Wind (2h)" row. Kept visually consistent with the main wind icon's
// meteorological convention: thick tail = direction wind is coming FROM,
// tapering to a point = direction it's blowing TO.
function miniWindBarbSvg(windDir, windSpeed, maxSpeedForScale, outline) {
  if (windDir == null || windSpeed == null) return '<span class="muted">\u2014</span>';
  const fromDeg = windDir;
  const scale = Math.min(windSpeed / (maxSpeedForScale || 60), 1);
  const cx = 11, cy = 11, r = 9;
  const tailW = 3 + scale * 3; // 3..6
  const halfTail = tailW / 2;
  const tailY = -(r - 0.5);
  const tipY = r - 0.5;
  const barbClass = outline ? "wind-barb-mini wind-barb-mini-outline" : "wind-barb-mini";
  const barb = `<polygon points="${-halfTail.toFixed(1)},${tailY} ${halfTail.toFixed(1)},${tailY} 0,${tipY}" class="${barbClass}"></polygon>`;
  return `<svg class="wind-barb-mini-svg" viewBox="0 0 22 22" role="img" aria-label="Wind at this time">` +
    `<g transform="translate(${cx},${cy}) rotate(${fromDeg})">${barb}</g>` +
    `</svg>`;
}

// Renders the "Wind" timeline row: one mini wind-barb icon + speed per
// increment across the day, in a horizontally laid out strip, so
// direction/strength shifts through the day are visible at a glance
// (similar in spirit to Windfinder's hourly/3-hourly wind tables).
// `windHourly` is always sampled at 2h resolution; `intervalHours` (4 for
// print, 2 for screen) further thins that down here at render time so the
// print layout - with much narrower per-day columns across 7 days - still
// fits comfortably, while the interactive screen view keeps the finer 2h
// detail. Cells are positioned by percentage-of-day (`hour / 24 * 100`),
// exactly like the Tide curve's `.tide-axis` ticks, so "00:00" always
// lands right on the left edge of the column (the midnight boundary
// between two days) rather than being centred in an arbitrary flex cell -
// keeping the two timeline-style rows visually aligned to the same time
// grid. Falls back to a dash if hourly data isn't available (e.g. very
// old cached response from before this feature existed).
function windTimelineHtml(d, intervalHours, isPrint) {
  if (!d.windHourly || !d.windHourly.length) return '<span class="muted">\u2014</span>';
  const step = intervalHours || 2;
  const hours = d.windHourly.filter((h) => h.hour % step === 0);
  const maxSpeedForScale = Math.max(60, ...hours.map((h) => h.speed || 0));
  const bgStrips = timelineGradientBgStrips(hours, step, (h) => h && h.speed != null ? WIND_SPEED_COLORS[windSpeedColorIndex(h.speed)] : null, isPrint);
  const cells = hours.map((h) => {
    const hh = String(h.hour).padStart(2, "0");
    const leftPct = (h.hour / 24) * 100;
    const textColor = !isPrint && h.speed != null && WIND_SPEED_WHITE_TEXT.has(windSpeedColorIndex(h.speed)) ? "color:#fff" : "";
    return `<div class="wind-timeline-cell" style="left:${leftPct.toFixed(2)}%;">` +
      `<div class="wind-timeline-hour">${hh}</div>` +
      miniWindBarbSvg(h.dir, h.speed, maxSpeedForScale, !isPrint) +
      `<div class="wind-timeline-speed" style="${textColor}">${h.speed != null ? Math.round(h.speed) : "\u2014"}</div>` +
      `</div>`;
  }).join("");
  return `<div class="wind-timeline">${bgStrips}${cells}</div>`;
}

// Builds a row of edge-to-edge, gradient-shaded background strips behind a
// timeline row's cells - shared by the Current/Wave/Swell/Wind chop rows
// below, mirroring the Wind row's own `.wind-timeline-bg` strip pattern
// above (kept separate there since it also needs the discrete
// WIND_SPEED_COLORS/windSpeedColorIndex lookup rather than an interpolated
// scale). Each strip spans one interval's full cell width, and rather than
// a single flat colour, is itself a left-to-right CSS `linear-gradient`
// from this interval's colour to the *next* interval's colour - since one
// strip's right-hand colour always matches the next strip's left-hand
// colour, the strips read as one continuous, smoothly-graduated band
// across the whole row with no visible seams, rather than discrete flat
// blocks butted together. Screen-only (returns "" when isPrint, same
// convention as the colour styling functions themselves).
function timelineGradientBgStrips(hours, step, colorForHour, isPrint) {
  if (isPrint) return "";
  const cellWidthPct = (step / 24) * 100;
  return hours.map((h, i) => {
    const color = colorForHour(h);
    if (!color) return "";
    const nextColor = colorForHour(hours[i + 1]) || color;
    const leftPct = (h.hour / 24) * 100 - cellWidthPct / 2;
    return `<div class="wind-timeline-bg" style="left:${leftPct.toFixed(2)}%;width:${cellWidthPct.toFixed(2)}%;background:linear-gradient(to right, ${color}, ${nextColor});"></div>`;
  }).join("");
}

// Small arrow showing travel direction for either ocean current or swell
// (unlike the wind barb, which points where wind is blowing FROM/TO with a
// tail/tip shape - here it's a simple arrow pointing the direction the
// water/swell is travelling towards, consistent with the arrow used in
// waveIconSvg() above). `maxScale` (optional) lets a caller normalise
// `magnitude` (current speed in km/h, or swell height in metres) against a
// known max so both stroke width and arrow length scale from thin/short
// (weak) to thick/long (strong) - mirrors `miniWindBarbSvg()`'s
// speed-scaled tail width. Without `maxScale` the arrow renders at its
// original fixed thin/short size.
function miniCurrentArrowSvg(currentDir, magnitude, maxScale) {
  if (currentDir == null || magnitude == null) return '<span class="muted">\u2014</span>';
  const travelDeg = (currentDir + 180) % 360;
  const scale = maxScale ? Math.min(Math.max(magnitude / maxScale, 0), 1) : null;
  // Thin (1px) + short (4px half-length) for weak current, thick (3px) +
  // long (8px half-length) for strong - halfLen 4..8, strokeW 1..3.
  const halfLen = scale != null ? 4 + scale * 4 : 6;
  const strokeW = scale != null ? 1 + scale * 2 : 1.6;
  const headHalf = scale != null ? 2 + scale * 2.5 : 4;
  const tailY = halfLen, tipY = -halfLen;
  const headBaseY = tipY + (scale != null ? 3 + scale * 2 : 4);
  return `<svg class="current-arrow-mini-svg" viewBox="0 0 22 22" role="img" aria-label="Current direction at this time">` +
    `<g transform="translate(11,11) rotate(${travelDeg.toFixed(0)})">` +
    `<line x1="0" y1="${tailY.toFixed(1)}" x2="0" y2="${tipY.toFixed(1)}" class="current-arrow-mini" style="stroke-width:${strokeW.toFixed(1)}"></line>` +
    `<polyline points="${(-headHalf).toFixed(1)},${headBaseY.toFixed(1)} 0,${tipY.toFixed(1)} ${headHalf.toFixed(1)},${headBaseY.toFixed(1)}" class="current-arrow-mini" style="stroke-width:${strokeW.toFixed(1)}"></polyline>` +
    `</g></svg>`;
}

// Renders the "Current" timeline row: one mini arrow + speed per increment
// across the day, laid out exactly like the Wind timeline row above (same
// percentage-of-day positioning so the two timeline rows - and the Tide
// curve's axis - all line up on the same time grid). Sourced from the
// Marine API's hourly ocean current fields (see hourlyCurrentForDay()).
function currentTimelineHtml(d, intervalHours, isPrint) {
  if (!d.currentHourly || !d.currentHourly.length) return '<span class="muted">\u2014</span>';
  const step = intervalHours || 2;
  const hours = d.currentHourly.filter((h) => h.hour % step === 0);
  const maxSpeedForScale = Math.max(3, ...hours.map((h) => h.speed || 0));
  const bgStrips = timelineGradientBgStrips(hours, step, (h) => h && h.speed != null ? interpolatedScaleColor(CURRENT_SPEED_SCALE, h.speed) : null, isPrint);
  const cells = hours.map((h) => {
    const hh = String(h.hour).padStart(2, "0");
    const leftPct = (h.hour / 24) * 100;
    const textColor = !isPrint && h.speed != null ? readableTextColor(interpolatedScaleColor(CURRENT_SPEED_SCALE, h.speed)) : "";
    return `<div class="wind-timeline-cell" style="left:${leftPct.toFixed(2)}%;">` +
      `<div class="wind-timeline-hour">${hh}</div>` +
      miniCurrentArrowSvg(h.dir, h.speed, maxSpeedForScale) +
      `<div class="wind-timeline-speed current-timeline-speed"${textColor ? ` style="color:${textColor}"` : ""}>${h.speed != null ? h.speed.toFixed(1) : "\u2014"}</div>` +
      `</div>`;
  }).join("");
  return `<div class="wind-timeline">${bgStrips}${cells}</div>`;
}

// Small vertical bar rendered as an inline SVG <rect> rather than a CSS
// `background-color` div - unlike a CSS background, an SVG `fill` reliably
// prints even when the browser's "print background graphics" option is
// off (the common default), which matters since these timeline bars are
// used in both the screen-only Wave/Swell rows and the printed Wind chop
// row. `heightPx` is measured from the bottom of a fixed-height (barMaxPx) box.
function timelineBarSvg(heightPx, barMaxPx) {
  const w = 10;
  const y = barMaxPx - heightPx;
  return `<svg class="wave-timeline-bar-svg" width="${w}" height="${barMaxPx}" viewBox="0 0 ${w} ${barMaxPx}">` +
    `<rect x="0" y="${y.toFixed(1)}" width="${w}" height="${heightPx.toFixed(1)}" class="wave-timeline-bar"></rect>` +
    `</svg>`;
}

// Sea-state height colour scale (metres), shared by the screen-only
// Wave/Swell timeline rows and the printed Wind chop row's value pill (bar
// stays neutral/grey in print - see .print-table .wave-timeline-bar - only
// the on-screen text value gets the colour treatment, same convention as
// currentSpeedStyle()). Breakpoints follow the common surf-forecast
// calm/small/moderate/rough/very-rough bands (~0.5m steps up to 2m, then
// coarser), not an official standard, chosen to mirror the low->high
// green->red ramp already used for wind/current speed.
const WAVE_HEIGHT_SCALE = [
  { max: 0.5, color: "#0064ff" },   // calm - blue
  { max: 1.0, color: "#11d411" },   // small - green
  { max: 1.5, color: "#fffe00" },   // moderate - yellow
  { max: 2.0, color: "#ff9600" },   // rough - orange
  { max: 3.0, color: "#e66400" },   // very rough - dark orange
  { max: Infinity, color: "#b40032" }, // heavy - deep red
];

// Screen-only "Wave" timeline row: a small bar (wave/swell height, whichever
// is greater that hour) per interval across the day, so building/easing sea
// state is visible at a glance - same interval/positioning convention as
// the Wind/Current timeline rows (mirrors hourlyWaveForDay()). Print omits
// this row entirely (see ROW_DEFS `screenOnly` flag) to keep the laminated
// sheet uncluttered - it's supplementary detail beyond the daily
// Waves/Swell summary row, not a print essential.
function waveTimelineHtml(d, scale) {
  if (!d.waveHourly || !d.waveHourly.length) return '<span class="muted">\u2014</span>';
  const hours = d.waveHourly;
  const maxH = scale?.max || Math.max(0.3, ...hours.map((h) => Math.max(h.wave || 0, h.swell || 0)));
  const barMaxPx = 22;
  const valOf = (h) => h ? (h.wave != null ? h.wave : h.swell) : null;
  const bgStrips = timelineGradientBgStrips(hours, 2, (h) => { const v = valOf(h); return v != null ? interpolatedScaleColor(WAVE_HEIGHT_SCALE, v) : null; }, false);
  const cells = hours.map((h) => {
    const hh = String(h.hour).padStart(2, "0");
    const leftPct = (h.hour / 24) * 100;
    const val = valOf(h);
    const barH = val != null ? Math.max(2, (val / maxH) * barMaxPx) : 0;
    const textColor = val != null ? readableTextColor(interpolatedScaleColor(WAVE_HEIGHT_SCALE, val)) : "";
    return `<div class="wind-timeline-cell wave-timeline-cell" style="left:${leftPct.toFixed(2)}%;">` +
      `<div class="wind-timeline-hour">${hh}</div>` +
      `<div class="wave-timeline-bar-wrap">${timelineBarSvg(barH, barMaxPx)}</div>` +
      `<div class="wind-timeline-speed wave-timeline-value"${textColor ? ` style="color:${textColor}"` : ""}>${val != null ? val.toFixed(1) : "\u2014"}</div>` +
      `</div>`;
  }).join("");
  return `<div class="wind-timeline">${bgStrips}${cells}</div>`;
}

// Screen-only "Swell" timeline row: same layout/interval convention as the
// Wave timeline above, but plots hourly swell height + a small travel-
// direction arrow (mirrors miniCurrentArrowSvg()) instead of the
// wave-or-swell-whichever-taller bar - lets building/backing-off
// groundswell *and* its direction be tracked hour-by-hour, complementing
// the daily Waves/Swell summary row. Screen-only, print unaffected.
function swellTimelineHtml(d, scale) {
  if (!d.waveHourly || !d.waveHourly.length) return '<span class="muted">\u2014</span>';
  const hours = d.waveHourly;
  const maxH = scale?.max || Math.max(0.3, ...hours.map((h) => h.swell || 0));
  const barMaxPx = 22;
  const bgStrips = timelineGradientBgStrips(hours, 2, (h) => h && h.swell != null ? interpolatedScaleColor(WAVE_HEIGHT_SCALE, h.swell) : null, false);
  const cells = hours.map((h) => {
    const hh = String(h.hour).padStart(2, "0");
    const leftPct = (h.hour / 24) * 100;
    const val = h.swell;
    const barH = val != null ? Math.max(2, (val / maxH) * barMaxPx) : 0;
    const textColor = val != null ? readableTextColor(interpolatedScaleColor(WAVE_HEIGHT_SCALE, val)) : "";
    return `<div class="wind-timeline-cell wave-timeline-cell" style="left:${leftPct.toFixed(2)}%;">` +
      `<div class="wind-timeline-hour">${hh}</div>` +
      (h.swellDir != null ? miniCurrentArrowSvg(h.swellDir, val, maxH) : `<div class="wave-timeline-bar-wrap">${timelineBarSvg(barH, barMaxPx)}</div>`) +
      `<div class="wind-timeline-speed wave-timeline-value"${textColor ? ` style="color:${textColor}"` : ""}>${val != null ? val.toFixed(1) : "\u2014"}</div>` +
      `</div>`;
  }).join("");
  return `<div class="wind-timeline">${bgStrips}${cells}</div>`;
}

// "Wind chop" timeline row: hourly wind-wave height (the locally
// wind-driven component of sea state, separate from swell - see
// waveIconSvg()'s wind-wave detail line for the daily-max equivalent).
// Unlike the Wave/Swell timeline rows above, this one *is* printed (at a
// coarser 4h interval, matching the Wind/Current timeline rows' print
// convention) since wind chop is a quick, useful read for boat-launch
// safety/comfort even on the laminated sheet.
function windWaveTimelineHtml(d, intervalHours, isPrint, scale) {
  if (!d.waveHourly || !d.waveHourly.length) return '<span class="muted">\u2014</span>';
  const step = intervalHours || 2;
  const hours = d.waveHourly.filter((h) => h.hour % step === 0);
  const maxH = scale?.max || Math.max(0.3, ...hours.map((h) => h.windWave || 0));
  const barMaxPx = 22;
  const bgStrips = timelineGradientBgStrips(hours, step, (h) => h && h.windWave != null ? interpolatedScaleColor(WAVE_HEIGHT_SCALE, h.windWave) : null, isPrint);
  const cells = hours.map((h) => {
    const hh = String(h.hour).padStart(2, "0");
    const leftPct = (h.hour / 24) * 100;
    const val = h.windWave;
    const barH = val != null ? Math.max(2, (val / maxH) * barMaxPx) : 0;
    const textColor = !isPrint && val != null ? readableTextColor(interpolatedScaleColor(WAVE_HEIGHT_SCALE, val)) : "";
    return `<div class="wind-timeline-cell wave-timeline-cell" style="left:${leftPct.toFixed(2)}%;">` +
      `<div class="wind-timeline-hour">${hh}</div>` +
      `<div class="wave-timeline-bar-wrap">${timelineBarSvg(barH, barMaxPx)}</div>` +
      `<div class="wind-timeline-speed wave-timeline-value"${textColor ? ` style="color:${textColor}"` : ""}>${val != null ? val.toFixed(1) : "\u2014"}</div>` +
      `</div>`;
  }).join("");
  return `<div class="wind-timeline">${bgStrips}${cells}</div>`;
}


// make it immediately clear at a glance that this star rating is a
// fishing-activity ("fishability") score rather than a generic moon-phase
// indicator. Simple flat single-colour shape (body + tail + eye cut-out),
// legible at very small (row-label) sizes and equally fine forced to solid
// black in print.
function fishLabelIconSvg() {
  return `<svg class="row-label-icon" viewBox="0 0 28 16" role="img" aria-label="Fishing activity rating">` +
    `<path d="M2 8 C5 2, 15 1, 21 8 C15 15, 5 14, 2 8 Z" class="fish-body"></path>` +
    `<path d="M21 8 L27 3 L25 8 L27 13 Z" class="fish-tail"></path>` +
    `<circle cx="7" cy="7" r="1.3" class="fish-eye"></circle>` +
    `</svg>`;
}

// Compact 1-2 glyph representations shown in the row-label column when it's
// collapsed (screen view only - see `.row-label-col--collapsed` / the click
// handler wired in `wireRowLabelToggle()`). Kept as small emoji glyphs
// rather than new SVGs since this collapsed state is a screen-only space
// saver (print always shows full text labels, so B&W/laminated print
// legibility is unaffected by using colour emoji here).
const ROW_SHORT_ICONS = {
  solunar: "\u{1F3A3}", // fishing rod
  tideHigh: "\u{2B06}\u{FE0F}\u{1F30A}", // up arrow + wave
  tideLow: "\u{2B07}\u{FE0F}\u{1F30A}", // down arrow + wave
  tideCurve: "\u{1F30A}\u{1F4C8}", // wave + chart
  waves: "\u{1F30A}",
  windWaveTimeline: "\u{1F4A8}\u{1F30A}",
  waveTimeline: "\u{1F30A}",
  swellTimeline: "\u{1F30A}\u2197\uFE0F",
  waveEnergy: "\u{26A1}",
  seaTemp: "\u{1F30A}\u{1F321}\u{FE0F}",
  weather: "\u{26C5}",
  pressure: "\u{1F321}\u{FE0F}\u{1F4CA}",
  rain: "\u{1F327}\u{FE0F}",
  wind: "\u{1F4A8}",
  windTimeline: "\u{1F4A8}",
  currentTimeline: "\u{1F30A}\u{27A1}\u{FE0F}",
  sun: "\u{2600}\u{FE0F}",
  moon: "\u{1F319}",
};

const ROW_DEFS = [
  {
    key: "solunar", label: "Solunar", labelIcon: fishLabelIconSvg(),
    render: (d) => `<span class="stars" title="Approximate rating">${starString(d.solunar.rating)}</span>`,
  },
  { key: "tideHigh", label: "High tide", render: (d, scales, isPrint) => d.tidesMissing ? '<span class="warn">&mdash;</span>' : tideCell(d.tideHighs, d.tz, d.sunrise, d.sunset, scales?.curveScale, "high", isPrint) },
  { key: "tideLow", label: "Low tide", render: (d, scales, isPrint) => d.tidesMissing ? '<span class="warn">&mdash;</span>' : tideCell(d.tideLows, d.tz, d.sunrise, d.sunset, scales?.curveScale, "low", isPrint) },
  {
    key: "tideCurve", label: "Tide curve", cellClass: "tide-curve-cell",
    labelIcon: () => `<span class="tide-ref-input-wrap no-print" title="Enter a critical tide height to plan a departure/return window">` +
      `<input type="number" step="0.1" min="0" max="10" id="refHeightInput" class="tide-ref-input" placeholder="m" value="${refTideHeight != null ? refTideHeight : ""}"></span>` +
      (refTideHeight != null && !isNaN(refTideHeight)
        ? `<span class="tide-ref-print-label">Traced height: ${refTideHeight.toFixed(2)}m</span>`
        : ""),
    render: (d, scales, isPrint) => d.tidesMissing ? '<span class="warn">&mdash;</span>' : tideCurveSvg(d, scales?.curveScale, isPrint ? 4 : 2, isPrint),
  },
  {
    key: "currentTimeline", label: "Current", cellClass: "wind-timeline-cell-wrap",
    labelSub: { screen: "(2h)", print: "(4h)" },
    render: (d, scales, isPrint) => currentTimelineHtml(d, isPrint ? 4 : 2, isPrint),
  },
  {
    key: "windWaveTimeline", label: "Wind chop", cellClass: "wind-timeline-cell-wrap",
    labelSub: { screen: "(2h)", print: "(4h)" },
    render: (d, scales, isPrint) => windWaveTimelineHtml(d, isPrint ? 4 : 2, isPrint, scales?.windWaveTimelineScale),
  },
  {
    key: "waves", label: "Waves / Swell", cellClass: "wave-icon-cell",
    render: (d, scales, isPrint) => waveIconSvg(d, scales?.waveScale, isPrint),
  },
  {
    key: "waveTimeline", label: "Wave", cellClass: "wind-timeline-cell-wrap", screenOnly: true,
    labelSub: { screen: "(2h)" },
    render: (d, scales) => waveTimelineHtml(d, scales?.waveTimelineScale),
  },
  {
    key: "swellTimeline", label: "Swell", cellClass: "wind-timeline-cell-wrap", screenOnly: true,
    labelSub: { screen: "(2h)" },
    render: (d, scales) => swellTimelineHtml(d, scales?.waveTimelineScale),
  },
  {
    key: "waveEnergy", label: "Wave energy",
    render: (d, scales, isPrint) => {
      if (d.waveEnergy == null) return "\u2014";
      const band = waveEnergyBand(d.waveEnergy);
      const labels = { flat: "Flat", small: "Small", punchy: "Punchy", heavy: "Heavy", extreme: "Extreme" };
      const sep = isPrint ? " \u00b7 " : "<br>";
      return `<span class="wave-energy-pill"${waveEnergyStyle(d.waveEnergy, isPrint)}>${Math.round(d.waveEnergy)} kJ</span>${sep}<span class="muted">${labels[band] ?? ""}</span>`;
    },
  },
  { key: "seaTemp", label: "Sea temp", render: (d) => d.seaTemp == null ? "\u2014" : `${d.seaTemp.toFixed(1)}\u00B0C` },
  {
    key: "weather", label: "Weather",
    render: (d, scales, isPrint) => `${weatherIconsHtml(d.weatherCode)}<span class="temp-pill"${tempStyle(d.tempMax, isPrint)}>${d.tempMax?.toFixed(0) ?? "\u2014"}</span> / <span class="temp-pill"${tempStyle(d.tempMin, isPrint)}>${d.tempMin?.toFixed(0) ?? "\u2014"}</span>\u00B0C<br>${WMO_WEATHER[d.weatherCode] ?? "\u2014"}${!isPrint && d.uvIndexMax != null ? `<br>${uvBadgeHtml(d.uvIndexMax)}` : ""}`,
  },
  {
    key: "pressure", label: "Pressure", screenOnly: true,
    render: (d) => d.pressure == null ? "\u2014" : `<span class="pressure-pill"${pressureStyle(d.pressure)}>${Math.round(d.pressure)} hPa</span>`,
  },
  {
    key: "rain", label: "Rain",
    render: (d) => {
      const icon = precipIconSvg(weatherPrecipCategory(d.weatherCode));
      return `${icon ? `<span class="wx-icon-row">${icon}</span>` : ""}<span class="${rainChanceClass(d.rainChance)}">${d.rainMm != null ? d.rainMm.toFixed(1) : "0.0"}mm (${d.rainChance ?? 0}%)</span>`;
    },
  },
  {
    key: "wind", label: "Wind", cellClass: "wind-cell",
    render: (d, scales, isPrint) => {
      if (d.windSpeed == null) return "\u2014";
      const stat = (label, val) => val == null ? "" :
        `<div class="wind-stat"><span class="wind-stat-label">${label}</span><span class="wind-stat-val" style="${isPrint ? "" : windSpeedStyle(val)}">${val.toFixed(0)}</span></div>`;
      return `<div class="wind-cell-row">` +
        `${windIconSvg(d.windDir, d.windSpeed)}` +
        `<div class="wind-stats">${stat("Avg", d.windAvg)}${stat("Max", d.windSpeed)}${stat("Gust", d.windGust)}</div>` +
        `</div>` +
        `<div class="wind-speed-pill" style="${isPrint ? "" : windSpeedStyle(d.windSpeed)}">${degToCompass(d.windDir)} ${d.windSpeed.toFixed(0)} km/h</div>`;
    },
  },
  {
    key: "windTimeline", label: "Wind", cellClass: "wind-timeline-cell-wrap",
    labelSub: { screen: "(2h)", print: "(4h)" },
    render: (d, scales, isPrint) => windTimelineHtml(d, isPrint ? 4 : 2, isPrint),
  },
  {
    key: "sun", label: "Sun",
    render: (d) => `&uarr; ${fmtTime(d.sunrise, d.tz)} &nbsp; &darr; ${fmtTime(d.sunset, d.tz)}`,
  },
  {
    key: "moon", label: "Moon",
    render: (d) => `<span class="moon-icon">${d.moon.icon}</span> ${d.moon.name}`,
  },
];

function buildTable(days, className, scales) {
  const isPrint = className.includes("print-table");
  const table = document.createElement("table");
  table.className = className;

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = `<th class="row-label-col">&nbsp;</th>` +
    days.map((d) => `<th><span class="dow">${d.dow}</span><br><span class="daymonth">${d.dayMonth}</span></th>`).join("");
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of ROW_DEFS) {
    // Some rows (e.g. Pressure, Wave timeline) are screen-only extras that
    // don't need to take up space on the laminated print sheet - skip them
    // entirely for print tables rather than rendering an empty/unwanted row.
    if (row.screenOnly && isPrint) continue;
    const tr = document.createElement("tr");
    const cellClass = row.cellClass ? ` class="${row.cellClass}"` : "";
    const labelSuffix = row.labelSub ? ` <span class="row-label-sub">${isPrint ? row.labelSub.print : row.labelSub.screen}</span>` : "";
    const labelIcon = row.labelIcon ? ` ${typeof row.labelIcon === "function" ? row.labelIcon() : row.labelIcon}` : "";
    // Screen only: a compact 1-2 glyph stand-in for the row label, shown
    // instead of the full text label when the row-label column is
    // collapsed (see wireRowLabelToggle()). Print always uses the full text.
    const shortIcon = !isPrint && ROW_SHORT_ICONS[row.key]
      ? `<span class="row-label-short" aria-hidden="true">${ROW_SHORT_ICONS[row.key]}</span>`
      : "";
    const fullLabel = `<span class="row-label-full">${row.label}${labelIcon}${labelSuffix}</span>`;
    tr.innerHTML = `<th class="row-label-col">${shortIcon}${fullLabel}</th>` +
      days.map((d) => `<td${cellClass}>${row.render(d, scales, isPrint)}</td>`).join("");
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// Toggles the row-label column between its compact icon-only form and the
// full text-label form. Applies to the whole (screen) table at once via a
// class on the table-scroll wrapper, toggled by clicking/tapping any
// row-label cell - lets a mobile user reclaim horizontal space for day
// columns most of the time, then tap once to see full row names again.
// Persisted in localStorage so the choice survives reloads.
function wireRowLabelToggle(container) {
  const collapsed = localStorage.getItem(LS_KEYS.rowLabelsCollapsed) === "1";
  container.classList.toggle("row-labels-collapsed", collapsed);
  container.addEventListener("click", (e) => {
    if (!e.target.closest(".row-label-col")) return;
    const isCollapsed = container.classList.toggle("row-labels-collapsed");
    localStorage.setItem(LS_KEYS.rowLabelsCollapsed, isCollapsed ? "1" : "0");
  });
}


function render(days, settings, tideMeta) {
  lastRenderArgs = { days, settings, tideMeta };
  $("locationTitle").textContent = settings.name;
  document.title = `${settings.name} \u2014 FishingSolunar`;

  const root = $("plannerRoot");
  root.innerHTML = "";
  const scales = { curveScale: tideMeta.curveScale, waveScale: tideMeta.waveScale, waveTimelineScale: tideMeta.waveTimelineScale, windWaveTimelineScale: tideMeta.windWaveTimelineScale };
  // --- interactive (screen) table ---
  const screenWrap = document.createElement("div");
  screenWrap.className = "table-scroll no-print";
  screenWrap.appendChild(buildTable(days, "planner-table", scales));
  root.appendChild(screenWrap);
  wireTideCurveHover(screenWrap);
  wireRefHeightInput();
  wireRowLabelToggle(screenWrap);

  // --- print-only tables, 7 days per A4 landscape page ---
  const printWrap = document.createElement("div");
  printWrap.className = "print-pages print-only";

  for (const half of [days.slice(0, 7), days.slice(7, 14)]) {
    const page = document.createElement("section");
    page.className = "print-page";
    const heading = document.createElement("h2");
    heading.className = "print-heading";
    heading.textContent = `${settings.name} \u2014 ${half[0].dayMonth} to ${half[half.length - 1].dayMonth}`;
    page.appendChild(heading);
    page.appendChild(buildTable(half, "planner-table print-table", scales));
    printWrap.appendChild(page);
  }
  root.appendChild(printWrap);

  const warningEl = $("dataWarning");
  const missingCount = days.filter((d) => d.tidesMissing).length;
  const messages = [];
  if (missingCount) {
    const extra = tideMeta.notes.length ? ` (${tideMeta.notes.join("; ")})` : "";
    messages.push(`\u26A0 Tide highs/lows unavailable for ${missingCount} of 14 day(s)${extra}. Add a WorldTides API key in \u2699 Settings as a fallback, or add a local tide file (see docs/DATA_SOURCES.md).`);
  }
  if (tideMeta.weatherNotes && tideMeta.weatherNotes.length) {
    messages.push(`\u26A0 ${tideMeta.weatherNotes.join("; ")}. Open-Meteo's live weather/marine data only covers roughly 3 months back to ~16 days ahead of today \u2014 pick a start date within that window (no API key needed for this).`);
  }
  if (messages.length) {
    warningEl.hidden = false;
    warningEl.textContent = messages.join(" ");
  } else {
    warningEl.hidden = true;
  }
  setStatus("");

  const noteEl = $("tideSourceNote");
  if (tideMeta.source === "local") {
    noteEl.textContent = "\u2713 Tide highs/lows: official local prediction file (no API used).";
  } else if (tideMeta.source === "local+worldtides") {
    noteEl.textContent = "\u2713 Tide highs/lows: local file + WorldTides API for the remaining days.";
  } else if (tideMeta.source === "worldtides") {
    noteEl.textContent = "Tide highs/lows: WorldTides API (no local file for this location).";
  } else {
    noteEl.textContent = "Tide highs/lows: no data source available for this location yet.";
  }

  updateStaleBadge(tideMeta.dataFromCache, tideMeta.oldestFetchedAt);
}

// ---------- stale-data badge (bottom-right) ----------
// Shown only once serving data that came from a localStorage cache (i.e. the
// last successful network fetch failed - typically offline) AND that cached
// data is more than STALE_AFTER_MS old. Cleared the moment a fresh network
// fetch succeeds. Tide highs/lows/moon/solunar are computed locally and are
// never "stale" in this sense - this only reflects weather/waves/sea-temp
// (and WorldTides, if used as a fallback).
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6 hours
let lastTideMetaForBadge = null;

function updateStaleBadge(dataFromCache, oldestFetchedAt) {
  lastTideMetaForBadge = { dataFromCache, oldestFetchedAt };
  const badge = $("staleBadge");
  const ageMs = oldestFetchedAt ? Date.now() - oldestFetchedAt : 0;
  if (dataFromCache && ageMs > STALE_AFTER_MS) {
    const hours = Math.round(ageMs / 3600000);
    badge.textContent = `\u26A0 Weather/wave data may be stale (offline, last updated ~${hours}h ago). Tides are calculated locally and are always current.`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function setStatus(msg, isError) {
  const el = $("statusMsg");
  el.textContent = msg;
  el.classList.toggle("error", !!isError);
}

// ---------- form wiring ----------

function populatePresets() {
  const sel = $("locationPreset");
  const regionSel = $("regionFilter");

  // region filter options, in the same north-to-south order as LOCATION_PRESETS
  const regions = [...new Set(window.LOCATION_PRESETS.map((p) => p.region).filter(Boolean))];
  for (const region of regions) {
    const opt = document.createElement("option");
    opt.value = region;
    opt.textContent = region;
    regionSel.appendChild(opt);
  }

  function renderPresetOptions(regionFilterValue) {
    const prevValue = sel.value;
    sel.innerHTML = '<option value="">&mdash; custom &mdash;</option>';
    const groups = new Map(); // region -> optgroup element
    for (const p of window.LOCATION_PRESETS) {
      if (regionFilterValue && p.region !== regionFilterValue) continue;
      let group = groups.get(p.region);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = p.region || "Other";
        sel.appendChild(group);
        groups.set(p.region, group);
      }
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      group.appendChild(opt);
    }
    // keep the previous selection if it's still present in the filtered list
    if ([...sel.options].some((o) => o.value === prevValue)) {
      sel.value = prevValue;
    }
  }

  renderPresetOptions("");

  regionSel.addEventListener("change", () => {
    renderPresetOptions(regionSel.value);
  });

  sel.addEventListener("change", () => {
    const p = window.LOCATION_PRESETS.find((x) => x.id === sel.value);
    if (p) {
      $("locationName").value = p.name;
      $("lat").value = p.lat;
      $("lon").value = p.lon;
    }
  });
}

function currentFormSettings() {
  return {
    name: $("locationName").value.trim(),
    lat: parseFloat($("lat").value),
    lon: parseFloat($("lon").value),
    start: $("startDate").value,
    key: $("worldTidesKey").value.trim(),
  };
}

async function refresh() {
  const settings = currentFormSettings();
  if (!settings.name || isNaN(settings.lat) || isNaN(settings.lon) || !settings.start) {
    setStatus("Please fill in location, coordinates and start date.", true);
    return;
  }
  saveSettings(settings);
  setStatus("Loading\u2026");
  try {
    const { days, tideSource, tideNotes, weatherNotes, curveScale, waveScale, waveTimelineScale, windWaveTimelineScale, dataFromCache, oldestFetchedAt } = await buildPlan(settings);
    render(days, settings, { source: tideSource, notes: tideNotes, weatherNotes, curveScale, waveScale, waveTimelineScale, windWaveTimelineScale, dataFromCache, oldestFetchedAt });
  } catch (err) {
    console.error(err);
    setStatus("Error loading data: " + err.message, true);
  }
}

// Force refresh: clears every cache layer (the localStorage weather/marine/
// WorldTides response cache, and the service worker's app-shell cache) so a
// stale cached page or stale cached API response can't linger, then does a
// hard reload to guarantee the freshly-registered service worker and newly
// fetched assets take effect immediately rather than on the *next* visit
// (the browser's default SW update timing).
async function forceRefresh() {
  const btn = $("forceRefreshBtn");
  if (btn) btn.disabled = true;
  setStatus("Force refreshing\u2026 clearing cached data\u2026");
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }

    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (err) {
    console.warn("Force refresh cache clear failed:", err);
  }
  // Bust any HTTP cache on the reload too.
  window.location.href = window.location.pathname + "?_refresh=" + Date.now();
}

function init() {
  populatePresets();
  const saved = loadSettings();
  $("locationName").value = saved.name;
  $("lat").value = saved.lat;
  $("lon").value = saved.lon;
  $("startDate").value = saved.start;
  $("worldTidesKey").value = saved.key;

  $("settingsToggle").addEventListener("click", () => {
    $("settingsPanel").hidden = !$("settingsPanel").hidden;
  });
  $("settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    refresh();
  });
  $("printBtn").addEventListener("click", () => window.print());
  $("forceRefreshBtn").addEventListener("click", forceRefresh);

  // auto-load on first visit if we have a saved/preset location
  refresh();

  // If the network comes back after being offline, silently retry so fresh
  // data replaces the cached fallback and the stale badge clears.
  window.addEventListener("online", () => refresh());

  // Re-evaluate the badge's age text periodically even without a refresh,
  // so "~6h ago" keeps advancing while the tab stays open.
  setInterval(() => {
    if (lastTideMetaForBadge) {
      updateStaleBadge(lastTideMetaForBadge.dataFromCache, lastTideMetaForBadge.oldestFetchedAt);
    }
  }, 5 * 60 * 1000);

  // Register the service worker so the app shell (HTML/CSS/JS/local tide
  // CSVs) is available offline after the first successful visit.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Service worker registration failed:", err));
  }
}

document.addEventListener("DOMContentLoaded", init);
