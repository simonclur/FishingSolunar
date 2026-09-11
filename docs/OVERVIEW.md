# Overview

## Purpose

A self-contained fishing/tide planner web page (no backend, no build step)
for a chosen location, showing a rolling **14-day window** starting from a
user-chosen date. It mirrors the key data shown on tide-forecast.com's
`sea-conditions` and `tide-times` pages (see reference screenshots discussed
in project chat), but adds a **Solunar rating**, is optimised for **print**
(2x A4 landscape) and for **iPhone 13 landscape** browsing.

## Data shown per day

| Group | Fields |
|---|---|
| Date | day of week, day + month |
| Solunar | 0–5 star rating, major/minor feed period times |
| Tide | each high & low: time + height (m) |
| Waves | swell direction, swell height (m), swell period (s), sig. wave height (m) |
| Sea | sea surface temperature (°C) |
| Weather | min/max air temp, wind direction + speed, sky condition |
| Sun | sunrise, sunset |
| Rain | rainfall (mm), chance of rain (%) |
| Moon | phase name + icon (illumination %) |

## Layout modes

1. **Desktop / tablet / print (landscape)** — a single wide table: rows are
   the data groups above, columns are the 14 days. This matches the
   tide-forecast.com layout.
2. **Print** — the same data is re-rendered into **two static A4-landscape
   tables** (days 1–7 and days 8–14), one per printed page, styled in
   black/greyscale-safe colours (no yellow fills, dark borders, large
   readable numerals).
3. **Mobile (narrow / iPhone landscape)** — the table becomes horizontally
   snap-scrollable showing ~1–3 day columns at a time, each day still shows
   all rows (scroll vertically within the table body), and the **day-header
   row is `position: sticky; top:0`** so the visible date(s) never scroll out
   of view.

## Location input

There's no reliable free geocoder for small fishing spots (e.g. "Waddy
Point" isn't in Open-Meteo's geocoding database), so the app:

- Ships with a small built-in preset list (`js/locations.js`) — currently
  Waddy Point, K'gari (Fraser Island), QLD.
- Lets the user type a location **name** (label only) plus **latitude /
  longitude** manually, which is what's actually sent to the weather/marine
  APIs.
- Remembers the last-used location + API key in `localStorage`.
