# Data catalog

A reference of data available through the APIs this app already talks to
(Open-Meteo Forecast, Open-Meteo Marine, WorldTides) — split into **what we
already retrieve and display** and **what's available from the same
sources but not currently used**, so we can evaluate adding it. Also lists
a few related Open-Meteo endpoints we don't call yet at all. See
`docs/DATA_SOURCES.md` for the fuller narrative (fallback logic, offline
behaviour, graceful degradation).

---

## Part A — data currently retrieved and displayed

### 1. Open-Meteo Forecast API (weather)

`https://api.open-meteo.com/v1/forecast` — free, no key, CORS-enabled.
**Range:** ~3 months back to ~16 days ahead of today (hard server limit).

| Field | Used for |
|---|---|
| `temperature_2m_max` / `temperature_2m_min` | Weather row: daily min/max, colour-coded pill |
| `weathercode` (WMO code) | Weather row sky icon/text; Rain row precip-type icon |
| `winddirection_10m_dominant`, `windspeed_10m_max/mean`, `windgusts_10m_max` | Wind row (icon + Avg/Max/Gust stats, colour-coded speed pill) |
| `sunrise` / `sunset` | Sun row; also feeds Solunar major/minor period calc and daylight-bolding of tide times |
| `precipitation_sum`, `precipitation_probability_max` | Rain row: mm (chance%) |
| hourly `windspeed_10m` / `winddirection_10m` | Wind timeline row (2h/4h mini barb + speed) |

### 2. Open-Meteo Marine API (waves / swell / sea temp / current)

`https://marine-api.open-meteo.com/v1/marine` — free, no key, CORS-enabled.
**Range:** same window as above in theory, but wave/swell/current/sea-temp
values have been observed to go blank after ~9–10 days ahead in practice.

| Field | Used for |
|---|---|
| `wave_height_max` | Waves/Swell row "WAVE" bar |
| `swell_wave_height_max`, `swell_wave_direction_dominant`, `swell_wave_period_max` | Waves/Swell row "SWELL" bar + travel arrow + period text; feeds Wave energy |
| hourly `sea_surface_temperature` | Sea temp row (6am–6pm daily average) |
| hourly `ocean_current_velocity`, `ocean_current_direction` | Current timeline row (2h/4h speed pill + direction arrow) |
| `wave_direction_dominant`, `wave_period_max` | Fetched but not currently shown separately from swell |

### 3. WorldTides API (fallback tide source)

`https://www.worldtides.info/api/v3` — requires user-supplied key.

| Field (`extremes`) | Used for |
|---|---|
| High/low event time + height | High tide / Low tide rows, Tide curve interpolation |

### 4/5. Computed locally (no API)

Moon phase (`js/moon.js`) and Solunar rating (`js/solunar.js`) — unlimited
date range, pure calculation.

---

## Part B — available from the same sources, not currently used

These require **no new API/account** — just adding parameters to requests
we already make (or, for WorldTides, flags we already have a key for).

### From Open-Meteo Forecast API

| Field | What it is | Why it could be interesting for fishing |
|---|---|---|
| `pressure_msl` / `surface_pressure` (hourly, hPa) | Barometric pressure | Widely believed by anglers to affect fish feeding activity (falling pressure often = better bite); a pressure trend arrow could be a nice addition near Solunar |
| `cloud_cover` (hourly, %) | Total cloud cover | Overcast/bright conditions affect surface-feeding fish behaviour; could refine the Weather icon beyond the daily WMO code |
| `uv_index_max` (daily) / `uv_index` (hourly) | UV index | Sun-safety planning for a full day on the water |
| `visibility` (hourly, m) | Horizontal visibility | Relevant for boating safety (fog/haze) |
| `relative_humidity_2m` (hourly, %) | Humidity | Minor comfort factor; some anglers correlate humidity swings with bite windows (less scientifically robust than pressure) |
| `dew_point_2m` (hourly, °C) | Dew point | Early-morning fog risk indicator (paired with humidity/temp) |
| `precipitation_hours` (daily) | Hours of rain in the day | Shows "how much of the day is wet" rather than just total mm — useful for picking a dry window within a rainy day |
| `apparent_temperature_max/min` (daily) | "Feels like" temp | More relevant than raw air temp for what to wear/pack |
| Alternate weather models (best-match, ECMWF, GFS, ICON, etc.) | Multiple model consensus | Could show a confidence/agreement indicator instead of one model's number, but adds real complexity for uncertain benefit |

### From Open-Meteo Marine API

| Field | What it is | Why it could be interesting for fishing |
|---|---|---|
| `wind_wave_height` / `wind_wave_period` / `wind_wave_direction` (hourly) | The **locally wind-driven** component of the sea state, separate from swell | Distinguishing "wind chop" from "groundswell" is exactly the wave-vs-swell distinction the app's icon already visually implies — this would make it data-driven rather than illustrative. A choppy-but-low-swell day reads very differently to an angler than a smooth-but-big-swell day |
| hourly `wave_height`, `swell_wave_height` (not just daily max) | Hour-by-hour wave/swell height | A "Wave timeline" row mirroring the existing Wind/Current timeline rows — shows building/easing swell through the day, useful for picking a launch/return window |
| Multiple marine models (`ewam`, `gwam`, `best_match`, etc.) | Model choice for wave data | Similar model-consensus consideration as weather above |

### From WorldTides API (would need `datums`/other flags added to the existing request)

| Field | What it is | Why it could be interesting |
|---|---|---|
| `datums` | Alternate chart datums (MLLW, LAT, MSL, etc.) | Currently the app takes whatever datum WorldTides/MSQ defaults to; exposing datum choice matters for cross-checking nautical charts, less so for fishing planning |
| `heights` (continuous, 30-min interval) | Real sampled tide-height curve, not interpolated | Could **replace** the cosine-interpolated Tide curve with an actual sampled curve for WorldTides-backed locations — more accurate for non-symmetrical tides, at the cost of extra API credits (heights cost the same 1-credit-per-7-days as extremes, so using both roughly doubles WorldTides credit usage per location) |
| `stations` | Nearby official tide station list + distance | Could power a "is there a more accurate nearby station?" suggestion, similar in spirit to how MSQ standard ports were curated for Queensland |

---

## Part C — related Open-Meteo endpoints not called at all today

These are separate APIs (different hostnames), so adding any of them means
a new network call (still free/no-key, CORS-enabled) rather than just a new
parameter on an existing request.

| API | Endpoint | Range | Why it could be interesting |
|---|---|---|---|
| **Air Quality API** | `air-quality-api.open-meteo.com/v1/air-quality` | Forecast ~5 days (varies by model); some historical | UV index (also available from Forecast API), plus ozone/PM2.5/PM10 — mostly a health/comfort angle with limited direct fishing relevance |
| **Historical Weather API** | `archive-api.open-meteo.com/v1/archive` | Back to **1940** | True historical actuals (not just the ~3-month archive window the Forecast API allows) — could support "what was the weather like on this date last year" comparisons or validating the Solunar model against real past trips, but out of scope for a forward trip planner |
| **Historical Forecast API** | `historical-forecast-api.open-meteo.com/v1/forecast` | Full archive of past forecast runs as originally issued | Niche — useful for forecast-accuracy analysis, not for planning a trip |
| **Flood API** | `flood-api.open-meteo.com/v1/flood` | River discharge forecasts (~30 days), global | Only relevant for estuary/river fishing spots near flood-prone catchments — likely low priority for this coastal-focused app |
| **Elevation API** | `api.open-meteo.com/v1/elevation` | N/A (static lookup) | Could auto-fill/validate a custom location's elevation; minor, mostly irrelevant for coastal fishing (elevation ≈ 0) |

---

## Suggested priority if extending the app

Roughly ordered by "fishing-relevance vs. implementation cost", assuming
no new API key or paid plan beyond what's already in use:

1. **Barometric pressure** (`pressure_msl`, hourly — already fetchable
   alongside existing weather fields) — high angler interest, near-zero
   added cost (one more `hourly=` parameter, no new endpoint).
2. **Wind-wave vs. swell split** (`wind_wave_height/period/direction`,
   already available from the Marine API we call) — turns the existing
   wave/swell icon distinction from illustrative into data-driven.
3. **Hourly wave/swell height** → a "Wave timeline" row, mirroring the
   existing Wind/Current timeline pattern exactly — moderate effort (new
   row + icon), reuses established UI conventions.
4. **UV index** (daily max, already fetchable from Forecast API) — cheap,
   useful for full-day trip planning, could sit as a small icon in the
   Weather or Sun row.
5. **WorldTides real sampled heights** — only benefits WorldTides-backed
   (non-QLD) locations, doubles WorldTides credit cost per location/day, so
   lower priority unless a specific complaint arises about curve accuracy
   for Tasmania/NSW/Victoria presets.
