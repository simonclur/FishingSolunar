// js/locations.js
// Small built-in preset list for locations that don't reliably resolve via
// public geocoders. Users can still type any custom name + lat/lon.

window.LOCATION_PRESETS = [
  {
    id: "waddy-point",
    name: "Waddy Point, K'gari (Fraser Island), Queensland, Australia",
    lat: -24.9675,
    lon: 153.3369,
    timezone: "Australia/Brisbane",
    // matches data/tides/<tideStationId>-<year>.csv (official MSQ/BOM predictions)
    tideStationId: "waddy-point-kgari",
  },
];
