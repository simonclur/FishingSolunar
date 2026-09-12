// js/tides.js
// Loads and parses official government-published tide predictions from
// local CSV files (bundled in data/tides/), so tide highs/lows are computed
// fully offline — no API key, no request limits, no live network call.
//
// File format: Maritime Safety Queensland (MSQ) / Bureau of Meteorology
// "predicted high/low" CSV export (one file per station per calendar year).
// See docs/DATA_SOURCES.md for where to get these and how to add a new
// station/year.

const csvCache = new Map(); // key: `${stationId}-${year}` -> array of events, or null if missing

function parseHiLoCsv(text) {
  const lines = text.split(/\r?\n/);
  const events = [];
  // Data rows look like: "01/01/2026 , 06:07 ,  1 ,   2.060"
  const rowRe = /^(\d{2})\/(\d{2})\/(\d{4})\s*,\s*(\d{2}):(\d{2})\s*,\s*(-?1)\s*,\s*([\d.]+)/;
  for (const line of lines) {
    const m = rowRe.exec(line);
    if (!m) continue;
    const [, dd, mm, yyyy, hh, min, ind, height] = m;
    const iso = `${yyyy}-${mm}-${dd}`;
    events.push({
      date: iso,
      time: `${hh}:${min}`,
      // local wall-clock time at the station; stations bundled here are all
      // Australia/Brisbane (UTC+10, no daylight saving)
      dt: new Date(`${iso}T${hh}:${min}:00+10:00`),
      type: ind === "1" ? "High" : "Low",
      height: parseFloat(height),
    });
  }
  return events;
}

async function loadStationYear(stationId, year) {
  const cacheKey = `${stationId}-${year}`;
  if (csvCache.has(cacheKey)) return csvCache.get(cacheKey);
  const url = `data/tides/${stationId}-${year}.csv`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const events = parseHiLoCsv(text);
    csvCache.set(cacheKey, events);
    return events;
  } catch (e) {
    csvCache.set(cacheKey, null);
    return null;
  }
}

// Works out this station's "usual" extreme high/low tide levels - used to
// flag likely "king tide" (unusually large) events on the tide curve,
// independent of whatever 14-day window is currently on screen. Rather
// than a fixed absolute threshold (which would need per-station tuning),
// this uses the station's own predicted-tide *distribution*: the value
// at the 75th percentile of all High-tide heights (i.e. "this station's
// highest 25% of high tides") and the 25th percentile of all Low-tide
// heights ("its lowest 25% of low tides"), computed across every
// bundled calendar year for that station (currently just one year per
// station - see data/tides/ - but this naturally improves as more years
// get added without any code change). Returns null if no local CSV data
// is available for this station at all (e.g. a custom/non-QLD location
// with no bundled file - callers should fall back to a window-relative
// estimate in that case, see buildPlan()'s fallback).
function percentile(sortedArr, p) {
  const idx = Math.min(sortedArr.length - 1, Math.max(0, Math.floor(sortedArr.length * p)));
  return sortedArr[idx];
}

async function getStationAnnualExtremes(stationId, aroundYear) {
  if (!stationId) return null;
  const years = [aroundYear - 1, aroundYear, aroundYear + 1];
  const results = await Promise.all(years.map((y) => loadStationYear(stationId, y)));
  const events = results.filter(Boolean).flat();
  if (!events.length) return null;
  const highs = events.filter((e) => e.type === "High").map((e) => e.height).sort((a, b) => a - b);
  const lows = events.filter((e) => e.type === "Low").map((e) => e.height).sort((a, b) => a - b);
  if (!highs.length || !lows.length) return null;
  return {
    highThreshold: percentile(highs, 0.75),
    lowThreshold: percentile(lows, 0.25),
    sampleSize: highs.length + lows.length,
    windowOnly: false,
  };
}

/**
 * @param {string} stationId matches a data/tides/<stationId>-<year>.csv file
 * @param {Date} startDate
 * @param {Date} endDate inclusive
 * @returns {{ byDate: Record<string, Array>, missingYears: number[] }}
 */
async function getLocalTides(stationId, startDate, endDate) {
  const years = [];
  for (let y = startDate.getFullYear(); y <= endDate.getFullYear(); y++) years.push(y);

  const results = await Promise.all(years.map((y) => loadStationYear(stationId, y)));
  const missingYears = years.filter((y, i) => results[i] === null);

  const byDate = {};
  const startMs = startDate.getTime();
  const endMs = endDate.getTime() + 24 * 3600 * 1000; // inclusive of whole end day
  for (const events of results) {
    if (!events) continue;
    for (const ev of events) {
      const t = ev.dt.getTime();
      if (t < startMs || t >= endMs) continue;
      (byDate[ev.date] ||= []).push(ev);
    }
  }
  return { byDate, missingYears };
}

window.TideCalc = { getLocalTides, parseHiLoCsv, getStationAnnualExtremes, percentile };
