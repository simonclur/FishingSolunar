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

window.TideCalc = { getLocalTides, parseHiLoCsv };
