// js/solunar.js
// Approximate solunar rating + major/minor feed period times for a given day
// and location, using moonrise/moonset from js/astro.js.
//
// This is a documented approximation of the Knight solunar theory (see
// docs/DATA_SOURCES.md), not a proprietary/paid solunar table.

const HALF_LUNAR_DAY_MS = ((24 * 60 + 50) / 2) * 60 * 1000; // ~12h25m

/**
 * @param {Date} dayStart local midnight of the day in question
 * @param {number} lat
 * @param {number} lon
 * @param {{sunrise?: Date, sunset?: Date}} sunTimes optional, boosts rating when a
 *   major period overlaps sunrise/sunset (classic "best of both" bonus)
 */
function getSolunarInfo(dayStart, lat, lon, sunTimes) {
  const moonTimes = window.Astro.getMoonTimes(dayStart, lat, lon);
  const rise = moonTimes.rise || null;
  const set = moonTimes.set || null;

  // Approximate upper transit (moon overhead) as the midpoint between rise & set
  // when both fall on this day; otherwise fall back to rise+6h12m / set-6h12m.
  let transit = null;
  if (rise && set) {
    transit = new Date((rise.getTime() + set.getTime()) / 2);
    // if set occurs before rise (moon sets, then rises later same UTC day), the
    // naive midpoint is wrong — shift by half a lunar day.
    if (set < rise) transit = new Date(transit.getTime() + HALF_LUNAR_DAY_MS);
  } else if (rise) {
    transit = new Date(rise.getTime() + HALF_LUNAR_DAY_MS / 2);
  } else if (set) {
    transit = new Date(set.getTime() - HALF_LUNAR_DAY_MS / 2);
  }

  const underfoot = transit ? new Date(transit.getTime() + HALF_LUNAR_DAY_MS) : null;
  const underfootEarlier = transit ? new Date(transit.getTime() - HALF_LUNAR_DAY_MS) : null;

  const majors = [transit, underfoot, underfootEarlier]
    .filter((t) => t && sameLocalDay(t, dayStart))
    .map((t) => windowAround(t, 60)); // +/- 60 min

  const minors = [rise, set]
    .filter((t) => t && sameLocalDay(t, dayStart))
    .map((t) => windowAround(t, 30)); // +/- 30 min

  // --- rating ---
  let rating = 2; // baseline out of 5
  const daysFromNewOrFull = window.MoonCalc.daysFromNewOrFull(dayStart);
  if (daysFromNewOrFull <= 1.5) rating += 2;
  else if (daysFromNewOrFull <= 3) rating += 1;

  if (sunTimes) {
    const overlapsSun = majors.some(
      (m) =>
        (sunTimes.sunrise && overlaps(m, windowAround(sunTimes.sunrise, 30))) ||
        (sunTimes.sunset && overlaps(m, windowAround(sunTimes.sunset, 30)))
    );
    if (overlapsSun) rating += 1;
  }

  rating = Math.max(1, Math.min(5, rating));

  return { rating, majors, minors, transit, underfoot: underfoot || underfootEarlier, moonrise: rise, moonset: set };
}

function windowAround(date, minutes) {
  return { start: new Date(date.getTime() - minutes * 60000), end: new Date(date.getTime() + minutes * 60000), center: date };
}

function overlaps(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

function sameLocalDay(date, dayStart) {
  return (
    date.getFullYear() === dayStart.getFullYear() &&
    date.getMonth() === dayStart.getMonth() &&
    date.getDate() === dayStart.getDate()
  );
}

window.SolunarCalc = { getSolunarInfo };
