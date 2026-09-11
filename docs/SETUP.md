# Setup & usage

## Running it

No build step, no dependencies. Either:

- Double-click `index.html` to open it in a browser, **or**
- Serve it locally (recommended, avoids some browsers' stricter `file://`
  fetch rules):
  ```bash
  cd FishingSolunar
  python3 -m http.server 8765
  # then open http://localhost:8765/
  ```

## First-time configuration

1. Click the **⚙️** icon (top right) to open Settings.
2. **Preset location** — pick "Waddy Point, K'gari (Fraser Island), QLD" or
   choose "— custom —" and fill in your own **Location name** + **Latitude /
   Longitude** (decimal degrees; south/west are negative).
3. **Start date** — the first of the 14 days shown.
4. **WorldTides API key** — sign up free at <https://www.worldtides.info/>,
   copy your key in. Without a key, tide high/low cells show "—" and a
   warning banner appears (everything else still works).
5. Click **Update**. Settings are remembered in the browser (`localStorage`)
   for next time.

## Printing

Click **Print / Save as PDF**, or use your browser's normal print command
(⌘/Ctrl+P). The page is pre-configured for **A4 landscape**, 2 pages (days
1–7, then 8–14). In the print dialog:

- Set paper size to A4, orientation Landscape.
- Turn on "Background graphics" if your browser has it off (not required —
  the print styles use borders, not background fills, so it prints fine
  either way).
- Margins: "Default" or "None" both work; the stylesheet sets its own 10mm
  page margin.

## Adding another location permanently

Add an entry to the `LOCATION_PRESETS` array in `js/locations.js`:

```js
{
  id: "my-spot",
  name: "My Spot, Somewhere",
  lat: -27.1234,
  lon: 153.5678,
  timezone: "Australia/Brisbane",
}
```
