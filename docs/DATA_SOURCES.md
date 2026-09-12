# Data sources

All data is fetched **directly from the browser** (no server component), so
every API used must support CORS for browser `fetch()` calls.

## 1. Weather — Open-Meteo Forecast API

- Endpoint: `https://api.open-meteo.com/v1/forecast`
- No API key required. Free for non-commercial use. CORS-enabled.
- Fields used (`daily=`): `temperature_2m_max`, `temperature_2m_min`,
  `windspeed_10m_max`, `winddirection_10m_dominant`, `sunrise`, `sunset`,
  `precipitation_sum`, `precipitation_probability_max`, `weathercode`,
  `uv_index_max`.
- Also fetched hourly: `pressure_msl` (used for the screen-only Pressure
  row, averaged 6am–6pm per day like sea temp/current below).
- Covers a rolling window of roughly the last ~3 months up to ~16 days
  ahead of "today" (Open-Meteo enforces this server-side and rejects
  `start_date`/`end_date` outside it with a 400 error). A 14-day planner
  window whose start date falls outside that range will fail to fetch
  weather/wind/sun data (see "Graceful degradation" below) — tide, moon
  phase and solunar rating are unaffected since they don't depend on this
  API at all.

## 2. Waves / swell / sea temperature / ocean current — Open-Meteo Marine API

- Endpoint: `https://marine-api.open-meteo.com/v1/marine`
- No API key required. CORS-enabled.
- Fields used (`daily=`): `wave_height_max`, `wave_direction_dominant`,
  `wave_period_max`, `swell_wave_height_max`, `swell_wave_direction_dominant`,
  `swell_wave_period_max`, `wind_wave_height_max`,
  `wind_wave_direction_dominant`, `wind_wave_period_max` (the last three
  power a screen-only "wind chop" detail line, distinguishing locally
  wind-driven chop from groundswell).
- Also fetched hourly: `wave_height`, `swell_wave_height`,
  `swell_wave_direction` for screen-only Wave (2h) and Swell (2h) timeline
  rows, and `wind_wave_height` for a **printed** Wind chop (2h screen /
  4h print) timeline row, mirroring the existing Wind/Current timeline
  rows.
- Sea surface temperature is only available hourly (`hourly=sea_surface_temperature`);
  the app averages the daytime hours (6am–6pm) per day for a daily figure.
- Ocean surface current (`hourly=ocean_current_velocity,ocean_current_direction`)
  is also only available hourly, sourced from ECMWF/Copernicus Marine/DWD/NOAA
  models at roughly 8km resolution (a coarse, offshore-representative value —
  not tuned for very close inshore accuracy). The app averages the 6am–6pm
  hourly readings into a single daily speed (km/h) and a circular mean
  direction (to avoid wrap-around error near 0°/360°), shown as a small arrow
  and label under the Waves/Swell row, using the same "direction of travel"
  convention as the swell arrow (API direction + 180°).
- Same rolling-window limitation as the Forecast API above (roughly 3
  months back to ~16 days ahead of today).

### Graceful degradation outside the Open-Meteo window

Picking a start date whose 14-day window falls outside Open-Meteo's
supported range no longer breaks the whole page:

- **Partial overlap** (the common case — e.g. only the last day or two of
  the 14-day window pokes past the ~16-day-ahead limit): `fetchWeather()`/
  `fetchMarine()` in `js/app.js` parse Open-Meteo's `"out of allowed range
  from X to Y"` error message and automatically retry once with the
  request clipped to that overlap, so the in-range days still get real
  data and only the handful of out-of-range days show "—".
- **No overlap at all** (the whole window is outside the range):
  `buildPlan()` catches the failure independently of the tide/moon/solunar
  calculation and substitutes an empty (but well-shaped) dataset, so every
  day shows "—" for weather/wind/wave fields while tide highs/lows, the
  tide curve, moon phase and solunar rating (none of which depend on
  Open-Meteo) still render normally.

Either way, the on-page warning banner explains which/how many days are
affected and why — this is a normal API range limit, not something an API
key can fix.


## 3. Tides (high/low times & heights) — local government data first, WorldTides as fallback

The app **prefers fully offline, local calculation** over any live API for
tides, per project requirements. It works in two tiers:

1. **Local tide prediction files (preferred, default for Waddy Point and 35
   other bundled Queensland locations)**
   - Source: **Maritime Safety Queensland (MSQ) Open Data**, published via
     `data.qld.gov.au` (CKAN). MSQ publishes official, BOM-derived,
     harmonic-analysis "Standard Port" whole-year predicted high/low tide
     tables as CC-BY-4.0 CSV downloads, refreshed annually.
   - Waddy Point (K'gari/Fraser Island) is a Standard Port (station code
     `014004A`). Its 2026 predictions are bundled directly in this repo at
     `data/tides/waddy-point-kgari-2026.csv` — **no network call needed** to
     show tide data for this location/year, satisfying the "calculate/serve
     locally wherever accurate" requirement.
   - **36 Queensland coastal locations total are bundled** (see
     `js/locations.js`), spanning the whole QLD coast from Thursday Island
     (Torres Strait) down to the Gold Coast Seaway. Each was curated from the
     78 MSQ standard-port "predicted high/low" CKAN datasets published at
     data.qld.gov.au, favouring well-known recreational fishing/boating spots
     and skipping most remote industrial ports, dredge/river gauges and
     Torres Strait islands (Thursday Island kept as the one Torres Strait
     example). Station name and authoritative lat/lon for every location were
     scraped directly from each station's own CSV header block (MSQ embeds
     `Tidal Station Name`, `Latitude/Longitude Degrees Minutes`, etc. as
     metadata rows before the data rows) — no separate geocoding was needed.
   - Presets are grouped into 10 regions for the Settings ⚙ region filter:
     Torres Strait, Cape York, Gulf of Carpentaria, Far North Queensland,
     Townsville/Cardwell, Mackay/Whitsundays, Capricorn Coast, Fraser Coast,
     Sunshine Coast, South East Queensland (assigned by coastal geography,
     roughly north to south).
   - Parsed by `js/tides.js` (`parseHiLoCsv`, `getLocalTides`), which reads
     rows like `01/01/2026 , 06:07 , 1 , 2.060` (date, time, `1`=High/`-1`=Low,
     height in metres above the station's Lowest Astronomical Tide datum).
   - A location opts in by setting `tideStationId` on its entry in
     `js/locations.js`; the app then looks for
     `data/tides/<tideStationId>-<year>.csv`.
   - To add another year or station: download the "Predicted High/Low CSV"
     resource for that station/year from data.qld.gov.au, save it as
     `data/tides/<tideStationId>-<year>.csv`, add a matching entry (with
     `region`) to `js/locations.js` — no other code changes required (see
     `docs/SETUP.md`).
2. **WorldTides API (fallback, and the primary tide source for Tasmania, NSW
   & Victoria presets)** — used for any days/locations not covered by a local
   file (e.g. a custom lat/lon with no bundled station, a future year not yet
   published by MSQ, or any of the 32 Tasmania/NSW/Victoria presets below).
   - Tasmania, New South Wales and Victoria presets have **no bundled local
     tide CSV**, because — unlike Queensland's MSQ open-data CKAN publisher —
     none of these states currently publish a free, machine-readable
     "predicted high/low" dataset: Tasmania's and NSW's state open-data
     portals only publish *observed/historical* gauge monitoring data (not
     forward predictions), Victoria's DataVic only publishes storm-surge/
     inundation modelling, and the Bureau of Meteorology / Australian
     Hydrographic Office's official Australian National Tide Tables (ANTT)
     are published as PDF/interactive web pages only (the full machine-
     readable AusTides dataset is a paid product). So these 32 locations
     rely entirely on the WorldTides API fallback — **a WorldTides API key
     is required in ⚙ Settings to see tide highs/lows for these locations.**
   - If a free official CSV/API source for any of these states is found in
     future, the same `tideStationId` + bundled-CSV pattern used for
     Queensland can be applied to add fully-offline local tide data for
     them too.
   - Endpoint: `https://www.worldtides.info/api/v3`, requires a free
     user-supplied API key entered once in ⚙️ Settings and cached in
     `localStorage` (`fishingSolunar.worldTidesKey`) — sent only to
     worldtides.info.
   - `fetchWorldTides()` explicitly requests `datum=LAT` — without this,
     WorldTides defaults to **MSL** (Mean Sea Level), which reports low-tide
     heights as negative numbers (below the long-term sea-level average).
     Requesting `LAT` (Lowest Astronomical Tide) matches the datum already
     used by the bundled QLD CSVs, so all locations — whether local-file or
     WorldTides-sourced — show heights on the same all-positive-metres
     convention anglers expect (a Tasmania/NSW/Victoria preset previously
     showed negative low-tide heights before this fix).
   - The status line under Settings (`#tideSourceNote`) reports which source
     was actually used: local only, local+WorldTides (mixed), WorldTides
     only, or none.
3. Why not read the BOM PDF or tidesnear.me directly: both are useful as a
   **manual cross-check** but have no public JSON API/CORS support:
   - BOM PDF: <https://www.bom.gov.au/ntc/IDO59001/IDO59001_2026_QLD_TP035.pdf>
   - <https://tidesnear.me/tide_stations/3939>

### Tide curve (visual sine-wave chart)

Each day's "Tide curve" row draws a small inline SVG chart approximating the
continuous rise/fall of the tide, using **cosine interpolation** between
each pair of consecutive known high/low points (the same shape used by
`buildDayCurve()` in `js/app.js`):

```
height(t) = h0 + (h1 - h0) * (1 - cos(π * (t - t0) / (t1 - t0))) / 2
```

This produces a smooth, S-shaped curve that closely matches a real
semi-diurnal tide without needing 10-minute-interval data. The tide fetch is
buffered by ±1 day so the curve has real data to interpolate from right up
to the edges of the first and last displayed day. All 14 days share one
min/max height scale (computed once per `buildPlan()` call) so taller bars
= genuinely bigger tidal range, matching tide-forecast.com's chart
convention. MSQ also publishes a "Predicted Interval" (10-minute) dataset
per station which could replace the interpolation with real sampled data in
future if finer accuracy is needed.

## Offline behaviour

Tide/moon/solunar are pure client-side calculations, so once the page and
its local tide CSV have loaded once, they never need network access again.
Two mechanisms make the *whole app* resilient to a lost connection:

1. **Service worker app-shell cache (`sw.js`)** — on first successful visit,
   caches `index.html`, `css/styles.css`, every `js/*.js` file, and the
   bundled local tide CSV(s). On any later visit, same-origin requests are
   served cache-first, so the page loads and tide data computes with zero
   network at all (verified with Chrome DevTools "offline" mode + a full
   page reload).
2. **`localStorage` response cache for live APIs** (`cachedFetch()` in
   `js/app.js`) — every Open-Meteo (weather/marine) and WorldTides response
   is stashed in `localStorage`, keyed by `location+date-range`, alongside a
   `fetchedAt` timestamp. If a live fetch fails (offline, DNS, timeout), the
   app transparently falls back to the newest cached response for that same
   key instead of failing the page.
3. **Stale-data badge** — a small fixed badge, bottom-right of the screen
   (`#staleBadge`, hidden by default), appears only when the app is
   currently showing weather/wave (or WorldTides) data that came from the
   cache *and* that cached data is more than 6 hours old. It's cleared the
   moment a live refresh succeeds again — including automatically, via a
   listener on the browser's `online` event, so the page self-heals the
   next time connectivity returns without the user doing anything. Tide
   highs/lows/curve/moon/solunar are never flagged stale since they're
   always computed fresh from local data, regardless of connectivity.

This means: once you've loaded the plan for a trip while you still have
signal, the whole two-week view (including the visual tide curve) keeps
working exactly the same with the phone in airplane mode — only the
weather/wave numbers may lag behind if you're offline for a long stretch,
and that's clearly flagged rather than silently shown as current.

## 4. Moon phase — computed locally

- No API. Standard synodic-month algorithm (`js/moon.js`) computes the moon
  age (days since last new moon) from the date, then derives phase name,
  illumination % and an icon.

## 5. Solunar rating — computed locally

- No API/paid solunar service used. `js/solunar.js` implements a common
  open approximation of the Knight/Richard Alden Knight solunar theory:
  - **Major periods** (~2 hrs long, higher weight): centred on lunar
    transit (moon overhead) and lunar underfoot (opposite transit),
    approximated from moonrise/moonset times.
  - **Minor periods** (~1 hr, lower weight): centred on moonrise and
    moonset.
  - **Daily 0–5 star rating**: boosted near new/full moon (perigee data
    isn't available without a paid ephemeris, so it's excluded), and when
    a major period overlaps sunrise/sunset.
  - This is a **reasonable approximation**, not identical to proprietary
    solunar tables/apps — documented as such in the UI (info tooltip).

## Known limitations

- Tide data: local files only exist for stations bundled in `data/tides/`
  (currently Waddy Point 2026). Other locations, or years beyond what's
  bundled, need a WorldTides API key entered as a fallback; if neither is
  available, tide cells show "—" and a warning banner is shown.
- **Waves/swell/sea temperature only forecast ~9-10 days ahead** in testing
  (verified 11 Sep → 24 Sep window: real values through ~19 Sep, `null`
  after that) — this is a genuine data-availability limit of Open-Meteo's
  marine model, not a bug in this app. Those cells show "—" for the tail of
  the 14-day window until closer to the date.
- Open-Meteo weather forecasts run out ~16 days ahead; choosing a start date
  more than ~2 days in the future will show blanks for the tail end of the
  14-day window until closer to the time.
- Solunar & moon phase are computed, not fetched — see above.
