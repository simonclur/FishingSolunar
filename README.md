# FishingSolunar

A single-page, no-build HTML/CSS/JS tool that generates a 14-day fishing
planner for any location — tides, waves/swell, weather, sun & moon times and
a solunar rating — styled after tide-forecast.com's tide/sea-conditions
tables, but tuned for:

- **Printing on 2x A4 landscape pages** (back-to-back lamination), high
  contrast black-on-white, no yellow/pale colours that wash out on B&W
  printers.
- **iPhone 13 landscape** use at the boat ramp: 1–3 days visible at a time,
  swipe left/right for more days, scroll up/down for more detail, with the
  date header pinned to the top of the screen.

See [docs/](docs/) for full documentation:

- [docs/OVERVIEW.md](docs/OVERVIEW.md) — what it does, screenshots reference, data model
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — APIs used, keys required, limits
- [docs/SETUP.md](docs/SETUP.md) — running it locally, configuring a location
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — file layout, rendering pipeline, print/mobile CSS strategy

## Quick start

Open `index.html` directly in a browser (double-click, or serve it with
`python3 -m http.server`), click the ⚙️ settings icon, enter/confirm the
location coordinates, a WorldTides API key (free signup), and a start date,
then click **Update**.
