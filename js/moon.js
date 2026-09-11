// js/moon.js
// Moon phase name/icon for a given Date, built on the precise illumination
// figure from js/astro.js (Astro.getMoonIllumination), which returns:
//   phase: 0..1 (0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter)
//   fraction: 0..1 illuminated disc fraction

const SYNODIC_MONTH = 29.53058867;

const PHASE_STEPS = [
  { max: 0.02, name: "New Moon", icon: "\u25CF" },
  { max: 0.24, name: "Waxing Crescent", icon: "\u263D" },
  { max: 0.26, name: "First Quarter", icon: "\u25D0" },
  { max: 0.49, name: "Waxing Gibbous", icon: "\u25D5" },
  { max: 0.51, name: "Full Moon", icon: "\u25CB" },
  { max: 0.74, name: "Waning Gibbous", icon: "\u25D4" },
  { max: 0.76, name: "Last Quarter", icon: "\u25D1" },
  { max: 0.98, name: "Waning Crescent", icon: "\u263E" },
  { max: 1.01, name: "New Moon", icon: "\u25CF" },
];

function phaseNameFromFraction(phase) {
  for (const p of PHASE_STEPS) {
    if (phase < p.max) return { name: p.name, icon: p.icon };
  }
  return PHASE_STEPS[PHASE_STEPS.length - 1];
}

/**
 * @param {Date} date local calendar date (time is normalised to local noon)
 */
function getMoonInfo(date) {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const illum = window.Astro.getMoonIllumination(noon);
  const { name, icon } = phaseNameFromFraction(illum.phase);
  return {
    phase: illum.phase, // 0..1
    illumination: illum.fraction, // 0..1
    illuminationPct: Math.round(illum.fraction * 100),
    waxing: illum.waxing,
    name,
    icon,
  };
}

// Age in days since the last new moon (0..SYNODIC_MONTH), derived from `phase`.
function moonAgeDays(date) {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const illum = window.Astro.getMoonIllumination(noon);
  return illum.phase * SYNODIC_MONTH;
}

// Distance in days to the nearest new (phase 0/1) or full (phase 0.5) moon —
// used by the solunar rating to boost days close to new/full moon.
function daysFromNewOrFull(date) {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const illum = window.Astro.getMoonIllumination(noon);
  const distToNew = Math.min(illum.phase, 1 - illum.phase) * SYNODIC_MONTH;
  const distToFull = Math.abs(illum.phase - 0.5) * SYNODIC_MONTH;
  return Math.min(distToNew, distToFull);
}

window.MoonCalc = { getMoonInfo, moonAgeDays, daysFromNewOrFull, SYNODIC_MONTH };
