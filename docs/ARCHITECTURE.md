# Architecture

## File layout

```
index.html                 markup: header, settings panel, main content mount point, footer
css/styles.css              all styling: base, responsive/mobile, print
js/locations.js             built-in location presets (name, region, lat, lon, timezone, tideStationId)
js/astro.js                 moon position / rise / set / illumination (adapted from SunCalc)
js/moon.js                  moon phase name/icon built on js/astro.js
js/solunar.js                major/minor period + 0-5 star rating, built on js/astro.js + js/moon.js
js/tides.js                 local tide CSV parser/loader (js/tides.js -> window.TideCalc)
js/app.js                   settings form wiring, data fetching + offline cache, day-model building, rendering
sw.js                       service worker: offline cache for the app shell + local tide CSVs
data/tides/*.csv             bundled official tide prediction files, one per station+year
docs/                       this documentation
```

No bundler/build step — plain `<script>` tags in dependency order (locations
→ astro → moon → solunar → tides → app), each attaching to `window.*`
globals (`window.Astro`, `window.MoonCalc`, `window.SolunarCalc`,
`window.TideCalc`, `window.LOCATION_PRESETS`). `sw.js` is registered
separately (not a `<script>` tag) via `navigator.serviceWorker.register()`
in `js/app.js`'s `init()`.

## Data flow

1. `app.js: init()` reads saved settings from `localStorage` (or the first
   preset) into the settings form, then calls `refresh()`.
2. `refresh()` reads the form → `buildPlan(settings)`:
   - Fetches Open-Meteo **weather** (`daily=` + `hourly=windspeed_10m,
     winddirection_10m`) and **marine** (`daily=` +
     `hourly=sea_surface_temperature`) for the exact `start_date`…`end_date`
     (14-day) window, in parallel with WorldTides **extremes** (tide
     highs/lows) if an API key is present. The hourly wind fields ride along
     in the *same* weather request/cache entry as the daily summary fields
     (no extra network call), and `hourlyWindForDay()` slices out every
     2-hour timestamp (00:00, 02:00, ... 22:00) for a given calendar day
     from that response.
   - For each of the 14 days, looks up that day's slice of each response,
     computes `SolunarCalc.getSolunarInfo()` and `MoonCalc.getMoonInfo()`,
     and assembles one plain-object "day" (see `docs/OVERVIEW.md` for the
     field list) - including `windHourly`, the array of 2-hourly
     `{hour, dir, speed}` samples for that day.
   - **Graceful degradation**: the weather and marine `cachedFetch()` calls
     are each wrapped in their own `.catch()` so a failure in one (most
     commonly Open-Meteo rejecting a `start_date`/`end_date` outside its
     supported rolling window - roughly the last ~3 months to ~16 days
     ahead of "today") falls back to an empty-but-well-shaped dataset
     (`EMPTY_WEATHER`/`EMPTY_MARINE`) instead of throwing and aborting the
     whole page. Tide highs/lows, the tide curve, moon phase and solunar
     rating are computed independently of Open-Meteo (local CSV / WorldTides
     + local astronomical calculation) and are unaffected either way.
     `buildPlan()` returns a `weatherNotes` array describing which
     Open-Meteo call(s) failed and why; `render()` shows this alongside the
     existing tide-source warning in the `#dataWarning` banner, explicitly
     noting this is a date-range limitation and not something a WorldTides
     API key can fix (that key only ever affects tide highs/lows).
3. `render(days, settings)` builds:
   - one **interactive** `<table>` (all 14 days, screen-only, scrollable)
   - two **print-only** `<table>`s (days 1–7 and 8–14) inside `.print-page`
     sections, each with its own heading naming the date range.
   Both are generated from the same `ROW_DEFS` array (row label + a
   `render(day, curveScale)` function per data group), so the two views
   can't drift out of sync. `curveScale` (a shared `{min, max}` height range
   for the whole 14-day window) is threaded through so the "Tide curve" row
   draws all days on one comparable vertical scale.

## Responsive / print CSS strategy

- **Screen (all sizes)**: a single scrollable container
  (`.table-scroll { overflow: auto }`) holds one `<table>`. The header `<tr>`
  cells (`thead th`) use `position: sticky; top: 0`, and the row-label
  column (`.row-label-col`) uses `position: sticky; left: 0`. Because both
  are sticky *within the same scroll container*, scrolling right always
  keeps the visible days' dates pinned at the top, and scrolling down always
  keeps the row labels pinned at the left — satisfying "scroll left/right for
  days, up/down for detail, date always visible" without any JS scroll
  syncing.
- **Narrow / landscape phone**: a media query
  (`max-width: 950px and max-height: 500px and orientation: landscape`,
  tuned for iPhone-13-class viewports) shrinks the day-column `min-width` to
  ~27vw so 2–3 day columns are visible at once, with smaller font/padding.
- **Print**: `@media print` hides everything with `.no-print` and shows
  `.print-only`; `@page { size: A4 landscape; margin: 4mm }` (kept near-zero
  per project preference) plus `.print-page { page-break-after: always }`
  (removed on the last page) puts exactly one 7-day table per sheet. Colours
  are restricted to black borders/text (`#000`) with no fills, so the page
  reproduces cleanly on a black & white printer or laminator. Font size/row
  padding were tuned down (12pt→10pt, tighter padding) so all 11 rows
  (including the tide curve) still fit on one A4 landscape sheet per week.
- **Digital column width**: on the default (non-mobile, non-print) desktop
  layout, day columns get an explicit `min-width: 12.5rem` (see
  `.planner-table:not(.print-table) th/td` in `css/styles.css`) so the
  Wind (2h) timeline's 12 mini wind-barb + speed-number cells per day have
  enough room to stay legible instead of nearly overlapping. This rule is
  scoped to exclude `.print-table` (which uses `table-layout: fixed` with
  its own explicit widths) and is overridden by the narrower
  viewport-relative (`vw`) widths in the mobile/iPhone-landscape media
  queries below, so it only affects wide desktop/tablet screens.
- **Screen-only colour highlighting of extreme values**: to let a user spot
  notably strong/adverse conditions at a glance (high rain chance, hot/cold
  temps, unusually high/low tide extremes for the 14-day window), several
  `ROW_DEFS.render()` functions apply small helper classifiers
  (`rainChanceClass()`, `tempClass()`, and the `curveScale`-relative logic
  inside `tideCell()`) that add one of `.value-high` (red), `.value-med`
  (amber), or `.value-cold` (blue) to the relevant span. These are fixed,
  general real-world thresholds (e.g. rain chance ≥60%) rather than being
  relative to the current 14-day window, so the same colour always means
  the same real-world condition across different date ranges. **Print must
  stay black & white**: `@media print` explicitly overrides all three
  classes back to `color: #000` (see `.print-table .value-high, .value-med,
  .value-cold`), so the same markup renders in colour on screen but plain
  black on the laminated print sheet.
- **Windfinder-style wind-speed colour scale (screen only)**: the Wind
  summary row's speed pill and the Wind (2h)/(4h) timeline row use a
  continuous 27-band colour gradient (`WIND_SPEED_COLORS` in `js/app.js`),
  reproduced from windfinder.com's own forecast-table stylesheet (its
  `.ws0`..`.ws26` classes), running purple/blue (calm) → green →
  yellow/orange → red → hot pink (extreme gale). Windfinder indexes this
  scale by whole knots, so `windSpeedColorIndex()` converts the app's km/h
  wind speed to knots and rounds to the nearest band before looking up the
  colour; `windSpeedStyle()` returns the resulting inline
  `background-color`/`color` pair for the Wind row's speed pill (white text
  on the darkest/most saturated bands, near-black text on the lighter
  middle bands, matching Windfinder's own text-colour pairing). In the Wind
  (2h)/(4h) timeline row, rather than colouring just the small speed number
  in isolation (which left distracting gaps of plain white between
  adjacent per-increment cells), `windTimelineHtml()` instead paints one
  continuous full-height coloured strip per increment
  (`.wind-timeline-bg`), sized to exactly the increment's width
  (`step / 24 * 100`%) and positioned edge-to-edge with its neighbours, so
  the colour band changes flow into one another with **no whitespace
  between increments** - making the speed trend across the day much easier
  to read at a glance, similar to a continuous heat-strip. The mini wind
  barb and speed number sit on top of these strips (`z-index: 1`); the barb
  gets a thin white outline (`.wind-barb-mini-outline`, screen-only, via
  `paint-order: stroke fill`) so it stays visible against the darker colour
  bands, and the speed number's text colour flips to white
  (`WIND_SPEED_WHITE_TEXT`) on the same bands the pill uses. This is all
  applied via inline `style=`/conditional classes (a continuous per-knot
  scale doesn't map cleanly to a small, fixed set of named CSS classes) and
  only when `isPrint` is false. **Print stays unaffected**: the render
  functions skip the background strips and outline/white-text logic
  entirely on print (`isPrint ? "" : ...`), and `.print-table
  .wind-speed-pill, .print-table .wind-timeline-speed` force
  `background: none` / `color: #000` as a defensive backstop in
  `css/styles.css`.
- **Taller tide curve on screen**: `.tide-curve-wrap` height is `148px` on
  screen (up from an earlier `103px`) versus `22mm` in print, so the
  digital table can dedicate more vertical space to accentuating the visual
  difference between tide highs and lows, while the print layout keeps a
  compact height so all 11 rows still fit one A4 landscape sheet per week.
  This is a pure CSS height change — `tideCurveSvg()`'s internal SVG
  `viewBox` and padding constants are unchanged, since the SVG is rendered
  without `preserveAspectRatio="none"` on its own height (only width
  stretches to the column), so a taller CSS box simply lets the existing
  curve occupy more vertical pixels without distorting its proportions.

## Tide curve, wave/swell and wind iconography

In the "High tide" / "Low tide" rows (`tideCell()`), each event's time is
rendered in `<strong>` (bold) only when it falls between that day's sunrise
and sunset (`d.sunrise`/`d.sunset`, already computed per day for the Sun
row); night-time tide events are left at normal weight. This lets an
angler scan a day's column and immediately see which tide changes happen
during daylight vs after dark, complementing the tide curve's own
`.tide-night` shaded band (see below) with the same day/night distinction
in plain text form.

Three rows use small inline SVGs instead of plain text, drawn with a shared
visual language (dark-blue `--accent` on screen, solid black in print) so
they read as one family of "at a glance" water/weather icons:

- **Tide curve** (`tideCurveSvg(d, scale)`): a filled `<polygon>` +
  `<polyline>` built from ~20-minute cosine-interpolated sample points
  (`buildDayCurve()`), against one shared min/max height scale
  (`curveScale`, computed once in `buildPlan()`) so relative tidal range is
  visually comparable across all 14 days. The SVG has **zero internal
  horizontal padding and the `.tide-curve-cell` has zero horizontal cell
  padding**, so each day's curve touches both edges of its `<td>` exactly -
  this is what makes the curve look continuous across day boundaries
  instead of visibly "breaking" at each cell border (the cause of an
  earlier bug: the SVG's own 3px inner padding plus the cell's `0.4rem`
  padding left a visible gap at every column edge). The chart area is
  double the height of the other icon rows (92px view box on screen, 20mm
  in print) both to give the curve visual weight as the row's primary
  fishing-planning aid and to leave enough room for H/L labels without
  clipping. Each high/low extremum that falls within that calendar day is
  also marked directly on the curve: a small dot at the peak/trough plus a
  text label ("H 1.9m" / "L 0.4m") positioned above (for highs) or below
  (for lows), using `xFor()`/`yFor()` helpers that map the extremum's real
  timestamp/height onto the same coordinate space as the curve line (`xFor`
  = time-of-day fraction across the day's width, `yFor` = the shared height
  scale, with `labelPad` reserved at both the top and bottom of the
  `viewBox` so labels aren't clipped). This is in addition to, not a
  replacement for, the existing plain-text "High tide"/"Low tide" rows.
  The H/L dot + label markers are rendered as an **absolutely-positioned
  HTML overlay** (`.tide-marker-dot`/`.tide-marker-label` spans inside a
  `.tide-curve-wrap` container) rather than as SVG `<circle>`/`<text>`
  elements, even though their x/y coordinates are computed with the same
  `xFor()`/`yFor()` math as the curve itself. This is because the curve's
  `<svg viewBox="0 0 150 92" preserveAspectRatio="none">` is deliberately
  stretched non-uniformly to fill whatever width the day column ends up at
  (which varies - e.g. columns get wider once the "Wind (2h)" row's content
  forces a wider layout) - anything drawn *inside* that SVG stretches along
  with it, which distorted the dots into ellipses and the "H"/"L" glyphs
  into squashed/stretched shapes on wide columns. Positioning the markers
  as plain HTML `position: absolute; left/top: <percentage>` on top of the
  SVG keeps their pixel shapes always correct regardless of column width,
  while still tracking the curve's data-driven position exactly.
  A faint `.tide-night` shaded band (`--ink` at ~6-8% opacity, so it stays
  legible and print-safe in black & white) is drawn across the portion of
  each day's width before sunrise and after sunset (using the same
  `xFor(d.sunrise)`/`xFor(d.sunset)` mapping), so it's visible at a glance
  which tide events happen in daylight vs after dark.
  A `.tide-axis` strip of hour tick labels ("00", "02"/"04", ...) sits
  directly above the curve, generated by the same `tideCurveSvg(d, scale,
  intervalHours)` function and positioned with the same `xFor()` time-based
  percentage mapping as the curve/markers - so a tick at, say, "12:00" lines
  up exactly with wherever the curve's value is at noon. `intervalHours` is
  **2 on screen and 4 in print** (`ROW_DEFS`'s `tideCurve.render` passes
  `isPrint ? 4 : 2`, mirroring the same screen/print interval split used
  for the Wind timeline row below it), so the two timeline-style rows'
  tick columns line up with each other as well as with the curve.
  **High/low colour differentiation (screen only)**, inspired by
  tide-forecast.com's own tide chart: the filled area under the curve
  (`.tide-curve-fill`) now uses a vertical `<linearGradient>` (one per day,
  `id="tideGrad-<iso>"`, built inline in `tideCurveSvg()`) running from a
  deeper blue (`#0b4f8a`) at the top of the chart down to a lighter blue
  (`#bcdcf2`) at the bottom - so the fill itself reads like a simple depth
  gauge: **more "water" (deeper blue) near high-tide peaks, less "water"
  (lighter blue) near low-tide troughs**, at a glance, without needing to
  read the H/L labels. The gradient is applied via the SVG `fill="url(#...)"`
  presentation attribute (rather than a CSS `fill:` declared through the
  `.tide-curve-fill` class) specifically so print can still force solid
  black: a real CSS rule (`.print-table .tide-curve-fill { fill: #000 }`)
  always wins the cascade over a presentation attribute, so print output is
  unaffected regardless of the gradient reference. The H/L overlay markers
  also get a matching `--high`/`--low` modifier class
  (`.tide-marker-dot--high`/`.tide-marker-label--high` in the same deeper
  `#0b4f8a`, `.tide-marker-dot--low`/`.tide-marker-label--low` in a lighter
  `#6fb1e0`/`#4a90c4`) instead of one flat `--ink` colour for both, so the
  dot/text labels reinforce the same high/low colour language as the fill.
  **Print stays plain black** throughout: `.print-table
  .tide-marker-dot--high`/`--low` and the label equivalents are explicitly
  overridden back to `#000` in `css/styles.css`, same pattern as all the
  other screen-colour features.
  **Interactive hover/touch readout (screen only)**, also inspired by
  tide-forecast.com's tide chart: `wireTideCurveHover()` (called once from
  `render()` against the whole screen table, not per-cell, since
  `buildTable()` rebuilds the table on every refresh) adds delegated
  `mousemove`/`touchstart`/`touchmove` listeners that, for whichever
  `.tide-curve-plot[data-tide-hover]` the cursor/finger is over, linearly
  interpolate between the two nearest of that day's already-computed
  ~20-minute sample points (serialized into a `data-points` JSON attribute
  by `tideCurveSvg()`, alongside `data-daystart`/`data-tz`/`data-scale-min`/
  `data-scale-max` needed to convert the interpolated height back into a
  y-position) to show a `.tide-hover-line` (vertical guide), `.tide-hover-dot`
  (marker at the exact curve point), and a `.tide-hover-tooltip` (small
  floating "9:32 am · 1.40m" label, flipping to the left of the cursor via
  `.tide-hover-tooltip--flip` once past 70% of the column's width so it
  doesn't run off the right edge). These elements are only rendered at all
  when `isPrint` is false (`tideCurveSvg()`'s `data-tide-hover` attribute
  and the three hover `<div>`s are omitted entirely in print output), with
  a defensive `.print-table .tide-hover-*  { display: none !important; }`
  backstop in CSS as well.
- **Waves / Swell** (`waveIconSvg(d, waveScale)`): two bars (wave height
  wider/lighter, swell height narrower/darker) against one shared 0..max
  scale (`waveScale`, also computed once in `buildPlan()`). Each bar is
  labelled with a small uppercase tag ("WAVE" / "SWELL") positioned just
  above its own height value, inside/adjacent to that bar (rather than as a
  separate header row), so the label stays visually tied to the bar it
  describes even as bar heights change day to day. Each bar also carries a
  small line-drawing glyph, sized/scaled with the bar's own height, that
  visually distinguishes the two water-motion types per the classic
  wave-vs-swell reference diagram: the **wave** glyph (`.wave-lines`, dark
  `--ink`) is a steep, asymmetric Bezier line with a hooked/overturning
  crest to evoke choppy, locally wind-driven seas; the **swell** glyph
  (`.wave-squiggle`, `--accent`) is a smooth, symmetrical sine-like curve to
  evoke a long-wavelength harmonic swell from a distant system - the same
  visual distinction used in oceanography reference diagrams for
  "wind wave" vs "swell". An arrow showing the swell's *travel* direction
  (compass "from" + 180°) is placed between the two bars, with the period
  as text underneath - deliberately similar shape language to the tide
  curve.
- **Weather cloud-cover + precipitation icons** (`weatherIconsHtml()` /
  `cloudCoverIconSvg()` / `precipIconSvg()`): small flat icons shown inline
  before the temperature/description text in the Weather row, borrowing the
  general iconography style used by windfinder.com's own forecast tables -
  a simple sun/cloud/fog glyph for cloud cover plus a separate small
  raindrop/snowflake/lightning-bolt glyph for precipitation type - though
  these are original, simplified shapes drawn from scratch (not copies of
  Windfinder's actual artwork/SVGs). `weatherCloudCategory(code)` and
  `weatherPrecipCategory(code)` bucket the Open-Meteo WMO weather code
  (`d.weatherCode`) into one of five cloud categories (`clear`/`few`/
  `scattered`/`overcast`/`fog`) and, independently, one of five
  precipitation categories (`drizzle`/`rain`/`heavyrain`/`snow`/`storm`, or
  `null` for no precipitation) - the two are shown side by side so, e.g., a
  drizzly overcast day shows both a cloud glyph *and* a raindrop glyph
  rather than needing one icon per WMO code combination. On screen the sun
  is amber, clouds/fog mid-grey, raindrops/snow the same blue `--accent` as
  the tide curve, and the lightning bolt dark red; **print stays fully
  black & white** via `.print-table .wx-*` overrides forcing solid black
  fills/strokes (with a light grey clouds fill only, kept as the single
  exception since a fully solid black cloud silhouette reads worse than a
  light-grey-with-black-outline one when printed/laminated).
- **Wind** (`windIconSvg(windDir, windSpeed)`): a compass rose with a
  tapered wind barb, following the standard meteorological convention of
  showing both where the wind is coming *from* and where it's blowing *to*
  in one glyph. A fixed ring (`.wind-ring`) with unrotated N/E/S/W tick
  labels (`.wind-tick-label`) gives an absolute frame of reference. A single
  wide-to-narrow triangle (`.wind-barb`) spans the full compass diameter -
  its thick, flat base sits at the ring edge on the compass bearing the wind
  is blowing *from* (`windDir`, unmodified - no +180 needed since the shape
  itself, not an arrowhead, encodes direction), tapering to a sharp point at
  the diametrically opposite edge, i.e. where it's blowing *to*. The whole
  barb is rotated with `rotate(fromDeg)` (SVG's clockwise rotation matches
  compass bearings directly, so `fromDeg` can be used as-is). A speed circle
  (`.wind-circle` + `.wind-speed-label`) is drawn on top at the centre,
  neatly covering the barb's midsection so only the tail and tip peek out
  past it - keeping the numeric speed as the precise readout while the barb
  shape gives an instant at-a-glance sense of direction. Barb tail
  width scales gently with speed (capped at 60 km/h) so a stronger blow
  looks visibly heavier at its source.
- **Wind timeline** (`windTimelineHtml(d, intervalHours)` / `miniWindBarbSvg()`):
  a separate row directly below "Wind" showing how direction and strength
  shift *through* the day, in the spirit of Windfinder/Windy's hourly wind
  tables. `hourlyWindForDay()` always stores 2-hourly samples in
  `d.windHourly` (this is the finest resolution requested from Open-Meteo);
  `windTimelineHtml()` then further thins that down at render time via its
  `intervalHours` argument, so the same cached data drives two different
  densities: **2h on screen** (label "Wind (2h)", 12 samples/day) and
  **4h in print** (label "Wind (4h)", 6 samples/day) - `buildTable()` passes
  `isPrint` through to `render()` for exactly this purpose, and each row's
  optional `labelSub: { screen, print }` renders the matching "(2h)"/"(4h)"
  suffix next to the row label. The coarser 4h print interval keeps the row
  to a single line per day even in the narrower 7-day-per-page print
  columns; the finer 2h screen interval gives more temporal detail where
  horizontal space isn't as constrained. Cells are positioned absolutely
  by `left: (hour / 24 * 100)%` (not flex-wrapped) so each cell's hour tick
  lands on the same time-of-day grid as the Tide curve's `.tide-axis` -
  "00:00" sits exactly on the left edge of the column (the midnight
  boundary with the previous day), matching how the tide axis's "00" tick
  aligns. Each cell is a `[hour label / mini barb icon / speed number]`
  stack. The mini barb (`miniWindBarbSvg()`) reuses the same
  tapered-triangle shape and "thick tail = FROM, point = TO" convention as
  the main compass-rose wind icon, but without the ring/ticks/speed-circle
  chrome (dropped entirely per user feedback - the ring added visual noise
  without extra information at this small size), so it stays legible at a
  much smaller size (each mini icon is scaled against that *day's own*
  max sampled speed at the interval being rendered, not the whole 14-day
  window, since the goal here is relative change through one day rather
  than cross-day comparison).
- **Current timeline** (`currentTimelineHtml()` / `miniCurrentArrowSvg()`):
  a row positioned directly above the Waves/Swell row (grouped with the
  other marine-condition rows rather than beside Wind, per user preference),
  laid out identically to the Wind timeline row (same `hour / 24 * 100`%
  absolute positioning, same 2h screen / 4h print density split, same
  `[hour label / mini icon / value]` cell stack) so it lines up on the same
  time grid as the Wind timeline and Tide curve axis.
  `hourlyCurrentForDay()` pulls `ocean_current_velocity`/`ocean_current_direction`
  from the Marine API's hourly arrays (see docs/DATA_SOURCES.md) the same
  way `hourlyWindForDay()` pulls wind. Unlike the wind barb's
  tail/tip shape, the current icon is a plain arrow pointing the direction
  the water is *travelling towards* (API direction + 180°, matching the
  swell-direction arrow in the Waves/Swell row). The speed number is
  colour-coded on screen via `currentSpeedStyle()`/`CURRENT_SPEED_SCALE` - a
  blue-to-red ramp in the same spirit as the Wind row's Windfinder-derived
  scale, but with much lower breakpoints (~0.5-4kt) since coastal tidal
  currents rarely reach the tens-of-knots range wind does; print stays
  plain black/no background as usual. The arrow itself is also
  speed-scaled (`miniCurrentArrowSvg(dir, magnitude, maxScale)`'s optional
  third argument): stroke width ramps 1px\u21923px and half-length ramps
  4px\u21928px as the value goes from 0 to a caller-supplied max (at
  least 3km/h for current, so a flat/near-zero day doesn't stretch its
  weakest arrows to "full strength" the way the fixed per-day
  timeline-bar scaling bug once did for Wave/Swell/Wind-chop - see the
  bug-fix note below), giving a thin/short arrow for weak current and a
  thick/long one for strong, mirroring `miniWindBarbSvg()`'s speed-scaled
  tail width. The Swell timeline row reuses this same function/shape for
  its travel-direction glyph, passing the shared window-wide
  `waveTimelineScale.max` (metres) as `maxScale` instead of a current
  speed, so swell arrows are thin/short for a calm ~0.3m day and
  thick/long for a big ~2m+ day - the same visual language as Current,
  just scaled to a different unit/magnitude, layered on top of that row's
  existing bar+colour height encoding.

All three icon systems share `overflow: visible` on their SVG elements
(`.tide-curve-svg`, `.wind-icon-svg`) since labels/markers/arrows are
intentionally drawn at or slightly outside the nominal `viewBox` bounds;
without it Chrome clips strictly to the `viewBox` rectangle. Note also that
`.wind-cell` (a `<td>`) must use `text-align: center` rather than
`display: flex` - flex on a table cell breaks the HTML table's column
layout entirely (discovered when an earlier version of the wind icon CSS
used flex and every day after the first went blank/misaligned).

### Wave energy row

Modelled on surf-forecast.com's own published methodology (see their public
FAQ at surf-forecast.com/pages/faq): wave energy is a function of swell
height *squared* and swell period *linearly* - i.e. taller swells matter far
more than longer ones, but a long-period groundswell still carries
noticeably more energy than a short-period wind swell of equal height. This
lets two swells of the same height but different periods be told apart at a
glance (something the raw height/period numbers alone don't communicate
well).

`waveEnergyKJ(swellHeightM, swellPeriodS)` in `js/app.js` computes
`swellHeight^2 * swellPeriod * 10` - the underlying `H^2 * T` relationship
matches the standard deep-water wave-power approximation used in wave
energy resource assessment (`P[kW/m] ~= 0.5 * Hs^2 * Te`); the constant `10`
is our own scaling choice, tuned so typical values land in the same rough
bands surf-forecast.com describes in their FAQ (not a reproduction of their
undisclosed exact formula/constant - this is an original, independently
tuned approximation for the same purpose). No new data source is fetched:
we reuse `swell_wave_height_max`/`swell_wave_period_max`, already pulled
from the Open-Meteo Marine API for the existing Waves/Swell row.

`waveEnergyBand()` buckets the kJ value into the same rough bands
surf-forecast.com's FAQ describes (flat &lt;100, small 100-200, punchy
200-1000, heavy 1000-3000, extreme 3000+) for both the text label shown
under the kJ figure and the colour used on screen
(`WAVE_ENERGY_COLORS`/`waveEnergyStyle()` - grey/blue/green/orange/red,
following the "flat -> extreme" progression). As with every other coloured
metric, print forces plain black text with no background
(`.print-table .wave-energy-pill` override), keeping the laminated sheet
readable in B&W.

Adding this row required tightening the print table's base font-size/padding
slightly (10pt/1.4mm -> 9.3pt/1mm, plus a small tide-curve-wrap height trim)
so 12 rows (up from 11) still fit on a single A4-landscape page per
7-day half - `buildTable()`/`ROW_DEFS` doesn't auto-fit to the page, so any
future row addition should re-check the printed PDF page count the same
way (see "Testing method" notes elsewhere in this doc).

### Screen-only rows (Pressure, Wave/Swell timelines, UV) + printed Wind chop row

Several extra data points from `docs/DATA_CATALOG.md`'s "Part B" list were
added. Most are **screen-view only** (never printed), so the laminated
2-page A4 layout and page count are unaffected by them; one - Wind chop -
was deliberately made a **printed** row since it's a quick, useful
boat-launch safety/comfort read even on the laminated sheet:

- **`ROW_DEFS` `screenOnly: true` flag** - `buildTable()` does
  `if (row.screenOnly && isPrint) continue;`, skipping the row's `<tr>`
  entirely when building a print table. This is a stronger guarantee than a
  CSS `display: none` override: the row never exists in the print DOM at
  all, so it can't leak into print via a missed selector or affect the
  printed page's row count/height.
- **Pressure row** (`pressure`, `screenOnly: true`) - `dailyPressure()`
  averages hourly `pressure_msl` (hPa) 6am-6pm local, same shape as
  `dailySeaTemp()`/`dailyOceanCurrent()`. Colour-coded low (blue) -> high
  (purple) via a new `PRESSURE_SCALE`/`pressureStyle()` (structurally the
  same pattern as `CURRENT_SPEED_SCALE`/`currentSpeedStyle()`, but using
  the standard meteorological blue->purple pressure-map convention rather
  than the wind/current speed colours), since falling/low pressure is
  commonly associated with more fish activity.
- **Wind chop (2h screen / 4h print) timeline row** (`windWaveTimeline`,
  **printed**, not `screenOnly`) - `windWaveTimelineHtml()` plots hourly
  `wind_wave_height` (the locally wind-driven component of sea state,
  separate from swell), following the same 2h-screen/4h-print interval
  convention as the Wind/Current timeline rows.
- **Wave (2h) and Swell (2h) timeline rows** (`waveTimeline`/
  `swellTimeline`, both `screenOnly: true`) - `hourlyWaveForDay()` extracts
  hourly `wave_height`/`swell_wave_height`/`swell_wave_direction`/
  `wind_wave_height` per day at a 2h interval. `waveTimelineHtml()` plots
  whichever of wave/swell height is taller that hour as a small bar;
  `swellTimelineHtml()` plots swell height specifically plus a small
  travel-direction arrow (reusing `miniCurrentArrowSvg()`). All three
  timeline rows (Wind chop, Wave, Swell) share the same `.wind-timeline`/
  `.wind-timeline-cell` classes and a smaller `.wave-timeline-value` value
  font (reduced twice - once when the Swell row was added, once more when
  the Wind chop row made three timeline rows total feel cramped) as the
  existing Wind/Current timeline rows, so all timeline rows line up on the
  same time-of-day grid.
- **Every row is individually toggle-able for print** (a later follow-up
  that generalised the above) - initially only `Current` was always
  printed and `Wave`/`Swell` were user-togglable via a hardcoded
  `printToggleKey` on those three rows, but it turned out any row's print
  inclusion is a personal/trip preference, not just those three (e.g.
  someone might want to drop Moon or Pressure from the laminated sheet
  too). `ROW_DEFS` items lost the one-off `printToggleKey`/`screenOnly`
  flags in favour of a single optional `printDefault: false` flag (used
  only by Wave/Swell/Pressure, the three rows that were screen-only before
  this system existed) - every row is now looked up by its own `key` in
  `printRowToggles`. `buildTable()`'s print-skip logic is simply
  `if (isPrint && !printRowToggles?.[row.key]) continue;`.
  `defaultPrintRowToggles()` derives the default set straight from
  `ROW_DEFS` (`row.printDefault !== false`) so the out-of-the-box printed
  layout is unchanged from before this feature - Wave/Swell/Pressure
  default off, everything else defaults on. Persisted to `localStorage`
  under `fishingSolunar.printRows` via `loadPrintRowToggles()`/
  `savePrintRowToggles()`. The settings panel's checkbox list
  (`#printRowCheckboxes`) is now built dynamically in `init()` by
  iterating `ROW_DEFS` (one `<label><input type="checkbox"
  id="printRow-${row.key}">` per row, labelled with `row.label` +
  `row.labelSub.print` where present, e.g. "Current (4h)") rather than
  hardcoded per-row markup in `index.html` - so any future new row
  automatically gets a print checkbox for free, with no HTML changes
  needed. Each checkbox re-renders immediately on change (no "Update"
  click needed) so the print preview reflects the choice right away.
  `waveTimelineHtml()`/`swellTimelineHtml()` gained the same
  `intervalHours`/`isPrint` parameters the other timeline rows already
  had, so a toggled-on row correctly switches to the coarser 4h print
  interval and disables on-screen-only text colouring, exactly like
  `windWaveTimelineHtml()` already did. Since enabling extra rows adds a
  full extra row to every printed day, toggling many/all optional rows on
  can push the print output past 2 pages (verified: 4 pages with all three
  originally-screen-only rows enabled) - an accepted, expected trade-off
  (the 2-page guarantee only applies to the *default* toggle state), not a
  bug.
- **Fixed 2h-row print values overflowing their row height** - a follow-up
  bugfix found alongside the above: the printed Current/Wind-chop/Wind (4h)
  timeline rows' value text was rendering slightly below the row's own
  bottom border in print (though not on screen), because `.wind-timeline`'s
  fixed print `height: 8mm` was a touch shorter than its own content
  (hour-tick + icon + value stack) actually needed once print font metrics
  were accounted for. Fixed by bumping `.print-table .wind-timeline`'s
  height to `8.8mm` and setting `line-height: 1` on the hour-tick/value
  text (`.wind-timeline-hour`/`.wind-timeline-speed`/`.wave-timeline-value`
  print rules) to remove extra leading that was inflating their rendered
  height - verified the value text now sits fully inside its row's
  boundary and the 2-page print total is unaffected.
- **Wave and Wind chop timeline rows switched from height bars to
  direction-scaled arrows** (a further follow-up, once the row-height fix
  above still left Wave/Wind chop's *bar* visually inconsistent with the
  arrow-based Current/Swell rows, and their fixed `barMaxPx` bar height was
  itself part of what made these two rows more prone to overflowing their
  row box than the arrow-based rows). Both `wave_direction` and
  `wind_wave_direction` turned out to already be available as hourly
  Marine API fields (added to the `&hourly=` query string alongside the
  existing `wave_height`/`wind_wave_height`, and to `hourlyWaveForDay()`'s
  per-hour object as `waveDir`/`windWaveDir`), so - like the Swell row
  already did with `swellDir` - `waveTimelineHtml()`/
  `windWaveTimelineHtml()` were rewritten to plot `miniCurrentArrowSvg()`
  (the same direction+magnitude-scaled arrow used by Current/Swell) instead
  of `timelineBarSvg()`'s fixed-height vertical bar, which is now unused
  and removed along with its `.wave-timeline-bar`/`-svg`/`-wrap` CSS. Wave's
  arrow direction follows whichever of wave/swell height is taller that
  hour (mirroring its existing "taller of the two" height logic). This
  makes all four sea-state/current timeline rows (Current, Wind chop,
  Wave, Swell) share one consistent visual language, adds previously-
  unavailable-at-a-glance wind-chop/wave direction information, and
  incidentally fixes the overflow risk entirely since arrow height is
  capped by `miniCurrentArrowSvg()`'s own fixed-max geometry rather than a
  per-row pixel scale that could, for certain height ranges, exceed the
  row's box.
- **Height bar restored behind Wave/Swell/Wind chop arrows** - once the
  arrow conversion above shipped, the at-a-glance height comparison the
  old bars gave was missed, so `miniHeightBarBg(val, maxH, isPrint)` was
  added: a small bar (`.wave-timeline-barbg`/`-fill`), separate from and
  positioned *behind* `miniCurrentArrowSvg()`'s `<svg>` inside a new
  `.wave-timeline-arrow-wrap` container, filled to `val/maxH` percent
  height. Deliberately a fixed-size element independent of the arrow (not
  sized to match it) so it can never itself push the row past its print
  height regardless of value - this is what the arrow conversion was
  originally for. On screen the fill is colour-matched to the value via
  `WAVE_HEIGHT_SCALE`; in print it's a flat light grey (`#bbb`) so it stays
  visible in black-and-white. The arrow SVG needed `position: relative;
  z-index: 1` added so it paints in front of the bar rather than being
  covered by it (both are now stacked children of the same
  position-relative wrapper).
- **UV badge moved onto the Weather condition line** - previously
  `uvBadgeHtml()` sat on its own `<br>`-separated line under the
  weather-condition text; changed to render inline right after it
  (space-separated, no `<br>`) to save vertical space, with `.uv-badge`'s
  `margin-top` swapped for `margin-left` to suit its new inline position.
- **Wind-wave vs. swell detail** - `waveIconSvg()` gained an `isPrint`
  parameter; when `!isPrint` it adds a `.wind-wave-detail` line under the
  existing swell line using the Marine API's daily `wind_wave_height_max`/
  `wind_wave_direction_dominant`/`wind_wave_period_max` (already
  fetched for the Waves/Swell row), making the wind-chop-vs-groundswell
  distinction data-driven instead of just illustrative.
- **UV index badge** - the `weather` row itself still always renders (it's
  printed), but its `render()` conditionally appends `uvBadgeHtml()` only
  `!isPrint`. Colour bands follow the standard WHO/EPA UV index scale
  (`UV_SCALE`: green/yellow/orange/red/violet).

**Printing the timeline bars reliably**: the Wave/Swell/Wind-chop timeline
bars are rendered as an inline SVG `<rect>` (`timelineBarSvg()`) rather than
a plain `<div>` with a CSS `background-color` - a CSS background is
commonly *not* printed unless the user has "print background graphics"
enabled in their browser's print dialog (a non-default, easy-to-miss
setting), whereas an SVG `fill` always prints. This was discovered when the
first version of the printed Wind chop row's bars were invisible on the
printed PDF despite looking fine on screen. `.print-table .wave-timeline-bar`
forces the fill to solid black (opacity 1) for the laminated sheet.

**Wind chop row placement + colour** (later refinement): the printed Wind
chop row was moved to sit directly under Current (before Waves/Swell) in
`ROW_DEFS` - since `ROW_DEFS` is a single flat array shared by both screen
and print tables, this reordered both views identically (no separate
screen/print ordering mechanism exists). Its print bar fill was changed
from solid black to mid-grey (`#888`) to visually de-emphasise it slightly
relative to the black tide-curve/wave-icon ink, and its `.wind-timeline-cell`
print width got `white-space: nowrap` plus a smaller `.wave-timeline-value`
font-size (6pt \u2192 5.2pt) and tightened `letter-spacing` after values like
"0.7"/"1.0" were found (via `pdftoppm` visual rendering) to overflow/overlap
their 5.2mm-wide print cell.

**Screen-view colour scales for Wave/Swell/Wind-chop timelines**: a new
shared `WAVE_HEIGHT_SCALE`/`waveHeightStyle()` (metres, blue\u2192green\u2192
yellow\u2192orange\u2192red, same low\u2192high convention as
`CURRENT_SPEED_SCALE`/`WIND_SPEED_COLORS`) colours the value pill (not the
bar) in `waveTimelineHtml()`, `swellTimelineHtml()`, and
`windWaveTimelineHtml()`. Print is unaffected - `waveHeightStyle()` returns
`""` when `isPrint`, and `.wave-timeline-value` is included in the existing
`.print-table` pill-stripping selector list (alongside `.wind-timeline-speed`
etc.) as a defensive backstop.

**Fitting the Wind chop row onto 2 pages**: adding a fourth printed
timeline-style row (Wind chop, alongside Wind and Current) pushed the
print table past a single A4-landscape page again. Rather than shrinking
fonts further, three rows were compacted to single lines instead of two:
High tide/Low tide (`tideCell()` gained an `isPrint` branch that renders
both of a day's events inline on one row, e.g. `08:41 (1.68m)  20:49
(1.82m)`, instead of stacking them as two flex rows like the screen view
does) and Wave energy (`" \u00b7 "` separator instead of `<br>` when
`isPrint`). The Day/Date header row was similarly forced onto one line in
print via `.print-table thead th br { display: none; }`. Screen view is
completely unaffected by all three changes (the `isPrint` branches only
fire for the print table).

All new rows reuse `ROW_SHORT_ICONS` entries for the collapsed-label view
like every other row. Adding the printed Wind chop row was re-checked
against the printed PDF page count (still exactly 2 pages/7-day half) per
the print-page-count invariant noted above.

**Bug fix: timeline bars must use a window-wide shared scale, not
per-day self-scaling.** The Wave/Swell/Wind-chop timeline rows originally
scaled each day's bars independently (`Math.max(0.3, ...that day's own
hourly values)`), the same way `miniWindBarbSvg()`'s per-day-relative
scaling works for the Wind timeline row. For height bars this is
misleading: a calm day where wind chop only ever reaches 0.1-0.2m still
stretched its tallest hour to nearly full bar height, making it look
visually identical to a genuinely rough 1.1m+ day elsewhere in the
14-day window (reported as "0.2m bars appear as tall as 1.1m bars").
Fixed by computing three window-wide shared scales in `buildPlan()`
(`waveTimelineScale` from all days' hourly wave/swell heights,
`windWaveTimelineScale` from all days' hourly wind-wave heights - mirroring
the existing `waveScale` used by the daily Waves/Swell icon), threading
them through `render()`'s `scales` object into
`waveTimelineHtml(d, scale)`/`swellTimelineHtml(d, scale)`/
`windWaveTimelineHtml(d, intervalHours, isPrint, scale)`. Bar height is now
comparable both hour-to-hour *and* day-to-day, matching the Waves/Swell
icon's existing convention. (The Wind and Current timeline rows aren't
affected by this - their mini-barb/arrow icons are shape/rotation based,
not bar-height based, so per-day speed scaling there doesn't have the same
visually-misleading effect.)

**Gap-free, graduated colour backgrounds for Current/Wave/Swell/Wind-chop
timelines.** Originally each hourly cell's colour was applied only as a
small inline `background-color` pill directly on the value text
(`.current-timeline-speed`/`.wave-timeline-value`), sized to the text's own
natural width - this left visible white gaps between adjacent cells'
pills, unlike the Wind timeline row, which already used a separate set of
absolutely-positioned `.wind-timeline-bg` divs spanning each interval's
*full* cell width, sitting behind the icon/label/value content. Fixed by
extracting a shared `timelineGradientBgStrips(hours, step, colorForHour,
isPrint)` helper (reusing the same `.wind-timeline-bg` CSS class) and
calling it from `currentTimelineHtml()`, `waveTimelineHtml()`,
`swellTimelineHtml()`, and `windWaveTimelineHtml()`; the per-value inline
pill background was removed (only the text `color` is still set inline,
for contrast). At the same time, per the user's follow-up request for
"a graduated transition between different colours", each strip is no
longer a single flat colour but a left-to-right CSS
`linear-gradient(to right, thisHourColor, nextHourColor)` - since one
strip's right edge colour always equals the next strip's left edge
colour, adjacent strips read as one continuous smoothly-blended band with
no visible seams at cell boundaries, rather than flat blocks butted
together.

This only closes the horizontal (hour-to-hour) gaps/seams; the
*within-row* colour itself was still a discrete band lookup
(`currentSpeedStageIndex()`/`waveHeightStageIndex()` picking one of
6-7 fixed colours per band, jumping abruptly at each threshold). To make
the colour itself change smoothly with the underlying value too, both
were replaced with a shared `interpolatedScaleColor(scale, value)`
helper that linearly interpolates RGB between a band's colour and the
adjacent band's colour based on how far the value sits between their
thresholds (anchored so the first band's colour is flat at/below its own
threshold, and each subsequent band's colour is "fully reached" exactly
at its own `max`). `currentSpeedStyle()`/`waveHeightStyle()` and the old
`*StageIndex()`/`*_WHITE_TEXT_MAX_INDEX` lookup-table plumbing were
removed since the interpolated colour is now looked up directly at each
call site; a new `readableTextColor(hex)` (luminance-based, ITU-R BT.601
weights) replaces the old fixed white-text index sets, since text
contrast now needs to work against *any* interpolated colour, not just a
handful of known discrete ones. `WIND_SPEED_COLORS`/`windSpeedColorIndex()`
(the Wind row's already near-continuous 27-band-per-knot scale) were left
untouched, since the "graduated transition" request was made specifically
in the context of the Current/Wave/Swell/Wind-chop rows. As before, all
of this is screen-only - `timelineGradientBgStrips()` returns `""` when
`isPrint`, keeping the printed Wind chop row's grey SVG bars unaffected.

**Wind (2h) row adopted the same gradient-strip helper too** (a follow-up
request, since the two rows now look inconsistent otherwise): its own
bespoke `bgStrips` construction in `windTimelineHtml()` (a `hours.map()`
building one flat-colour `.wind-timeline-bg` div per interval) was
replaced with a call to the same `timelineGradientBgStrips()` helper,
passing `WIND_SPEED_COLORS[windSpeedColorIndex(h.speed)]` as the
per-hour colour lookup - so the Wind row's already-fine-grained 27-band
scale itself is unchanged (no interpolation added there, per the earlier
note above), but the *background rendering* is now the same shared
gap-free, gradient-blended strip used by the other four timeline rows.

### King-tide highlighting on the Tide curve

The Tide curve row shades the portion of each day's curve that pokes into
"unusually large tide" territory for that station - a subtle red tint on
screen, a darker grey fill for print - so an approaching king tide (or an
unusually shallow low, e.g. for reef-walking) is visible at a glance
without reading every H/L label.

**Why a station-based threshold, not a window-relative one.** The tide
table already had an *unrelated*, pre-existing window-relative highlight:
`tideCell()`'s `.value-high`/`.value-cold` classes on the High tide/Low
tide text rows, driven by `curveScale.min`/`.max` (just the min/max of
whatever 14-day window happens to be on screen). That's fine for
"biggest tide in this fortnight" but says nothing about whether this
fortnight is itself unusually big compared to the location's typical
year - a mediocre 1.5m high could still be the biggest tide in a flat
two-week window and get flagged, while a genuinely exceptional 1.9m king
tide sitting in an otherwise-big spring-tide fortnight might not stand
out at all. King-tide spotting needs an absolute, station-specific
baseline, not a window-relative one.

**How the threshold is computed** (`getStationAnnualExtremes()` in
`js/tides.js`): for the preset's `tideStationId`, load the bundled CSV
years `[year-1, year, year+1]` (whichever actually exist locally -
currently every bundled QLD station only has 2026 data, so in practice
this is just one year, improving automatically as more years get added),
pool every High-tide height and every Low-tide height across those years,
and take the 75th percentile of the highs / 25th percentile of the lows
(`percentile()`, a small sorted-array helper). Percentiles (not a fixed
absolute cm/m cutoff) are used so the same logic self-calibrates across
stations with very different tidal ranges (e.g. Bundaberg vs. a
low-range QLD reef site) without per-station magic numbers - consistent
with the existing `WAVE_HEIGHT_SCALE`/`CURRENT_SPEED_SCALE` convention of
deriving thresholds from data rather than hardcoding them. Returns
`{ highThreshold, lowThreshold, sampleSize, windowOnly: false }`, or
`null` if the station has no bundled CSV at all (e.g. a custom lat/lon
with no `tideStationId` match in `LOCATION_PRESETS`).

**Fallback for locations with no local CSV.** `buildPlan()` computes
`kingTideThresholds` via `getStationAnnualExtremes()` when
`preset?.tideStationId` exists, then attaches `kingHigh`/`kingLow` onto
the shared `curveScale` object (the same object `tideCurveSvg()` and
`tideCell()` already receive, so no new prop needed threading through
`render()`). When there's no local station data, `kingHigh`/`kingLow`
instead fall back to the top/bottom 15% of *this window's own* curveScale
range (`windowOnly: true`, in effect reusing the pre-existing
window-relative math) - a "best effort" indicator rather than nothing, on
the assumption a rough highlight is better than silently disabling the
feature for non-QLD/custom locations.

**Rendering** (`tideCurveSvg()`): a `<clipPath>` referencing the day's own
curve-fill polygon restricts the shading to only where the curve *actually
reaches* that territory (not a distracting full-width band regardless of
the day's real tide). The high zone is a simple rect clipped to the fill
polygon (the fill already only exists above a given y where the curve
reaches that high, so clipping is sufficient). The low zone needs a
dedicated polygon whose top edge is `max(curveY, yKingLow)` per point,
since the area-fill's bottom is a fixed baseline regardless of curve
height - a naive rect-clip would incorrectly shade the full width. Both
use the `.tide-king-zone`/`--high`/`--low` CSS classes: `#c0392b` red at
`opacity:0.32` on screen, `#000` grey at `opacity:0.28` for print
(consistent with the existing print convention of trading colour for
opacity-based greyscale, e.g. `.tide-night`/`.tide-curve-fill`'s own print
overrides). `tideCell()`'s existing `.value-high`/`.value-cold` classes on
the High tide/Low tide text rows were also switched from the old
window-relative 15%-band check to the same `curveScale.kingHigh`/`.kingLow`
threshold, so the text and curve highlights now agree with each other.

### Reference tide height ("planning line")

For trip planning (e.g. "I need at least 1.0m of water to safely cross this
sandbar - what time can I leave, and what time must I be back by?"), the
Tide curve row's label cell has a small number input (`#refHeightInput`,
`.no-print` - screen only, since print can't accept input). Entering a
height there:

- Persists the value to `localStorage` (`fishingSolunar.refTideHeight`,
  via `setRefTideHeight()`) so it survives reloads, same pattern as the
  other settings fields.
- Triggers `render()` again in place (no network refetch - the underlying
  `days` data is unchanged, only the overlay drawn on top of the existing
  curves changes), via a module-level `lastRenderArgs` captured each time
  `render()` runs.
- Draws a dotted horizontal reference line at that exact height across
  **every** day's tide curve (`tideCurveSvg()`), plus a small dot and a
  time label (with a &uarr;/&darr; rising/falling arrow, rotated -90deg to
  read vertically) at every point each day's curve actually crosses that
  height - typically twice per semi-diurnal tide (once rising, once
  falling), giving an at-a-glance "leave by / back by" window for each of
  the 14 days side by side.
- Can also be set by **clicking directly on any tide curve**: the click
  handler (in `wireTideCurveHover()`, alongside the existing hover-readout
  logic, since both need the same per-day `data-points`/`data-daystart`
  geometry) reads the height at the clicked x-position, rounds it to 2
  decimal places, and calls `setRefTideHeight()` + re-renders - updating
  the input box's displayed value (and overwriting any previously-set
  height) without needing to type into the box at all.

Each crossing's time label is placed **below the curve if the nearby
peak/trough is a High, above the curve if it's a Low** - critically, the
*two* crossings that flank the *same* peak/trough (one rising into it, one
falling out of it) must always land on the **same** side, so the pair
reads as a matched "leave by / back by" set rather than being visually
split across the line. This ruled out simpler approaches:
- Using the crossing's own rising/falling direction (`c.rising`) directly
  was tried first, but by definition the two crossings of a pair have
  *opposite* rising/falling values, so that always split the pair - wrong.
- Picking the extremum nearest **in time** was tried next (both across
  the full multi-day event list and restricted to just the two extrema
  bracketing that crossing's arc) - also wrong, because on an asymmetric
  tide arc the two flanking crossings aren't necessarily equidistant in
  time from their shared extremum, so time-distance can pick different
  answers for what should be a matching pair.

The working approach, in `nearestExtremumIsHigh(crossing)`: compare
`refTideHeight` by **height distance** (not time distance) to
`crossing.prevExtremum.height` and `crossing.nextExtremum.height`, and
report whichever is closer. Both crossings flanking one peak/trough share
the *exact same two* bracketing extrema (and thus the exact same two
height values), so comparing the same reference height against the same
two numbers with the same formula is guaranteed to produce the same
answer for both - this is what makes the pair always match.
`findHeightCrossings()` computes `prevExtremum`/`nextExtremum` for each
crossing by scanning the day's full `tideAllEvents` list (the 14-day
sorted High/Low list, attached to every day object in `buildPlan()`) for
the last event at/before and first event at/after the crossing's time.

`findHeightCrossings(points, targetHeight, allEvents)` walks each day's
existing 20-minute-resolution `tideCurve` samples (the same array already
used to draw the curve and power the mouse-hover readout - no new data
source), linearly interpolating the exact crossing time between the two
bracketing samples for each segment where the target height falls between
the two sample heights, and records whether the tide was rising or falling
at that crossing (`c.rising`, still used for the arrow glyph direction,
just no longer for the above/below side).

The above/below CSS offset (`.tide-ref-time--above`/`--below`) is set in
`em` units (`3.2em`, relative to the label's own `font-size`) rather than
a fixed pixel value, so the clearance from the curve line scales
automatically if the font size ever changes (print vs. screen, future
responsive tweaks) instead of needing separate manual re-tuning.

Unlike the mouse-hover tooltip (screen-only, ephemeral), this reference
line is drawn identically in both the screen and print SVG paths (the
`isPrint` branch only affects whether the *input* itself renders - the
line/dot/time overlay always renders when a height is set), so the chosen
planning height and its crossing times are visible on the laminated
printout too. The print stylesheet forces the line/dot/labels to solid
black (`.print-table .tide-ref-line/.tide-ref-dot/.tide-ref-time`), same
pattern as every other coloured overlay in this table.

Note: the Tide curve row's `labelIcon` (the input wrapper) is defined as a
**function**, not a static string, in `ROW_DEFS` - it's re-evaluated on
every `buildTable()` call so the input's `value` attribute always reflects
the current `refTideHeight` (a static string would bake in the value from
the first render only, and never update after a click or programmatic
change).


## Offline support

See `docs/DATA_SOURCES.md` "Offline behaviour" for full detail. In short:
`sw.js` cache-first-serves the app shell (HTML/CSS/JS/local tide CSVs) so
the whole page + tide calculations work with no network; `cachedFetch()` in
`js/app.js` keeps the last-good weather/marine/WorldTides API responses in
`localStorage` per location+date-range as a fallback when a live fetch
fails; and a bottom-right `#staleBadge` (shown/hidden by `updateStaleBadge()`)
flags when currently-displayed weather/wave data is a >6h-old cached
fallback, clearing automatically on the next successful live refresh
(including via a browser `online` event listener).

Because the service worker is cache-first for the app shell, a normal
browser reload can keep serving old HTML/CSS/JS (and `cachedFetch()` can
still surface an old API response if a live fetch happens to fail at that
moment) even after the underlying files/logic have changed. The **"Force
refresh" button** (`#forceRefreshBtn`, `forceRefresh()` in `js/app.js`)
exists for exactly this: it clears every cache layer - all
`fishingSolunar.cache.*` keys in `localStorage`, every entry via the
`caches` API (the service worker's app-shell cache), and unregisters the
service worker itself - then does a hard `location.href` reload with a
cache-busting query param, guaranteeing the very next load fetches
everything fresh and re-registers the service worker from scratch.

## Adding a data field

To add a new row (e.g. "Water clarity"), add one entry to the `ROW_DEFS`
array in `js/app.js` with a `label` and a `render(day)` function returning
an HTML string — it will automatically appear in both the interactive table
and both print tables. If the value comes from a new API field, add it to
the relevant `fetch*()` call's query string and to the per-day object built
in `buildPlan()`.
