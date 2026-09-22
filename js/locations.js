// js/locations.js
// Built-in preset list of Queensland coastal locations with official Maritime
// Safety Queensland (MSQ) tide-gauge stations (data.qld.gov.au). Each preset's
// tideStationId matches a bundled data/tides/<tideStationId>-<year>.csv file
// (official predicted high/low data). Users can still type any custom name +
// lat/lon; locations without a bundled CSV fall back to the WorldTides API.

window.LOCATION_PRESETS = [
  {
    id: "waddy-point",
    name: "Waddy Point, K'gari (Fraser Island), Queensland, Australia",
    region: "Fraser Coast",
    lat: -24.9675,
    lon: 153.3369,
    timezone: "Australia/Brisbane",
    // matches data/tides/<tideStationId>-<year>.csv (official MSQ/BOM predictions)
    tideStationId: "waddy-point-kgari",
  },
  {
    id: "thursday-island",
    name: "Thursday Island, Queensland, Australia",
    region: "Torres Strait",
    lat: -10.5833,
    lon: 142.2167,
    timezone: "Australia/Brisbane",
    tideStationId: "thursday-island",
  },
  {
    id: "cooktown",
    name: "Cooktown, Queensland, Australia",
    region: "Cape York",
    lat: -15.45,
    lon: 145.2333,
    timezone: "Australia/Brisbane",
    tideStationId: "cooktown",
  },
  {
    id: "cape-flattery",
    name: "Cape Flattery, Queensland, Australia",
    region: "Cape York",
    lat: -14.95,
    lon: 145.3,
    timezone: "Australia/Brisbane",
    tideStationId: "cape-flattery",
  },
  {
    id: "lizard-island",
    name: "Lizard Island, Queensland, Australia",
    region: "Cape York",
    lat: -14.6667,
    lon: 145.4333,
    timezone: "Australia/Brisbane",
    tideStationId: "lizard-island",
  },
  {
    id: "weipa",
    name: "Weipa, Queensland, Australia",
    region: "Cape York",
    lat: -12.6667,
    lon: 141.85,
    timezone: "Australia/Brisbane",
    tideStationId: "weipa",
  },
  {
    id: "karumba",
    name: "Karumba, Queensland, Australia",
    region: "Gulf of Carpentaria",
    lat: -17.4833,
    lon: 140.8333,
    timezone: "Australia/Brisbane",
    tideStationId: "karumba",
  },
  {
    id: "clump-point",
    name: "Clump Point, Mission Beach, Queensland, Australia",
    region: "Far North Queensland",
    lat: -17.85,
    lon: 146.1,
    timezone: "Australia/Brisbane",
    tideStationId: "clump-point",
  },
  {
    id: "mourilyan",
    name: "Mourilyan Harbour, Queensland, Australia",
    region: "Far North Queensland",
    lat: -17.5833,
    lon: 146.1167,
    timezone: "Australia/Brisbane",
    tideStationId: "mourilyan",
  },
  {
    id: "cairns",
    name: "Cairns, Queensland, Australia",
    region: "Far North Queensland",
    lat: -16.9167,
    lon: 145.7667,
    timezone: "Australia/Brisbane",
    tideStationId: "cairns",
  },
  {
    id: "port-douglas",
    name: "Port Douglas, Queensland, Australia",
    region: "Far North Queensland",
    lat: -16.4833,
    lon: 145.45,
    timezone: "Australia/Brisbane",
    tideStationId: "port-douglas",
  },
  {
    id: "mossman",
    name: "Mossman, Queensland, Australia",
    region: "Far North Queensland",
    lat: -16.4167,
    lon: 145.4,
    timezone: "Australia/Brisbane",
    tideStationId: "mossman",
  },
  {
    id: "townsville",
    name: "Townsville, Queensland, Australia",
    region: "Townsville/Cardwell",
    lat: -19.2333,
    lon: 146.8333,
    timezone: "Australia/Brisbane",
    tideStationId: "townsville",
  },
  {
    id: "lucinda",
    name: "Lucinda, Queensland, Australia",
    region: "Townsville/Cardwell",
    lat: -18.5167,
    lon: 146.3833,
    timezone: "Australia/Brisbane",
    tideStationId: "lucinda",
  },
  {
    id: "cardwell",
    name: "Cardwell, Queensland, Australia",
    region: "Townsville/Cardwell",
    lat: -18.25,
    lon: 146.0167,
    timezone: "Australia/Brisbane",
    tideStationId: "cardwell",
  },
  {
    id: "hay-point",
    name: "Hay Point, Queensland, Australia",
    region: "Mackay/Whitsundays",
    lat: -21.2667,
    lon: 149.3,
    timezone: "Australia/Brisbane",
    tideStationId: "hay-point",
  },
  {
    id: "mackay",
    name: "Mackay, Queensland, Australia",
    region: "Mackay/Whitsundays",
    lat: -21.1,
    lon: 149.2167,
    timezone: "Australia/Brisbane",
    tideStationId: "mackay",
  },
  {
    id: "shute-harbour",
    name: "Shute Harbour, Whitsundays, Queensland, Australia",
    region: "Mackay/Whitsundays",
    lat: -20.2833,
    lon: 148.7833,
    timezone: "Australia/Brisbane",
    tideStationId: "shute-harbour",
  },
  {
    id: "bowen",
    name: "Bowen, Queensland, Australia",
    region: "Mackay/Whitsundays",
    lat: -20.0167,
    lon: 148.25,
    timezone: "Australia/Brisbane",
    tideStationId: "bowen",
  },
  {
    id: "abbot-point",
    name: "Abbot Point, Queensland, Australia",
    region: "Mackay/Whitsundays",
    lat: -19.85,
    lon: 148.0833,
    timezone: "Australia/Brisbane",
    tideStationId: "abbot-point",
  },
  {
    id: "gladstone-auckland-point",
    name: "Gladstone, Queensland, Australia",
    region: "Capricorn Coast",
    lat: -23.8167,
    lon: 151.25,
    timezone: "Australia/Brisbane",
    tideStationId: "gladstone-auckland-point",
  },
  {
    id: "port-alma",
    name: "Port Alma, Queensland, Australia",
    region: "Capricorn Coast",
    lat: -23.5833,
    lon: 150.85,
    timezone: "Australia/Brisbane",
    tideStationId: "port-alma",
  },
  {
    id: "rockhampton",
    name: "Rockhampton, Queensland, Australia",
    region: "Capricorn Coast",
    lat: -23.3667,
    lon: 150.5167,
    timezone: "Australia/Brisbane",
    tideStationId: "rockhampton",
  },
  {
    id: "rosslyn-bay",
    name: "Rosslyn Bay, Queensland, Australia",
    region: "Capricorn Coast",
    lat: -23.15,
    lon: 150.7833,
    timezone: "Australia/Brisbane",
    tideStationId: "rosslyn-bay",
  },
  {
    id: "urangan",
    name: "Urangan, Hervey Bay, Queensland, Australia",
    region: "Fraser Coast",
    lat: -25.2833,
    lon: 152.9,
    timezone: "Australia/Brisbane",
    tideStationId: "urangan",
  },
  {
    id: "bundaberg",
    name: "Bundaberg (Burnett Heads), Queensland, Australia",
    region: "Fraser Coast",
    lat: -24.7667,
    lon: 152.3667,
    timezone: "Australia/Brisbane",
    tideStationId: "bundaberg",
  },
  {
    id: "burnett-heads",
    name: "Burnett Heads, Queensland, Australia",
    region: "Fraser Coast",
    lat: -24.75,
    lon: 152.4,
    timezone: "Australia/Brisbane",
    tideStationId: "burnett-heads",
  },
  {
    id: "mooloolaba",
    name: "Mooloolaba, Queensland, Australia",
    region: "Sunshine Coast",
    lat: -26.6833,
    lon: 153.1333,
    timezone: "Australia/Brisbane",
    tideStationId: "mooloolaba",
  },
  {
    id: "noosa-head",
    name: "Noosa Head, Queensland, Australia",
    region: "Sunshine Coast",
    lat: -26.3833,
    lon: 153.1,
    timezone: "Australia/Brisbane",
    tideStationId: "noosa-head",
  },
  {
    id: "tin-can-bay-snapper-creek",
    name: "Tin Can Bay, Queensland, Australia",
    region: "Sunshine Coast",
    lat: -25.9,
    lon: 153.0,
    timezone: "Australia/Brisbane",
    tideStationId: "tin-can-bay-snapper-creek",
  },
  {
    id: "southport",
    name: "Southport, Queensland, Australia",
    region: "South East Queensland",
    lat: -27.9667,
    lon: 153.4167,
    timezone: "Australia/Brisbane",
    tideStationId: "southport",
  },
  {
    id: "gold-coast-seaway",
    name: "Gold Coast Seaway, Queensland, Australia",
    region: "South East Queensland",
    lat: -27.9333,
    lon: 153.4167,
    timezone: "Australia/Brisbane",
    tideStationId: "gold-coast-seaway",
  },
  {
    id: "brisbane-bar",
    name: "Brisbane Bar, Queensland, Australia",
    region: "South East Queensland",
    lat: -27.4,
    lon: 153.15,
    timezone: "Australia/Brisbane",
    tideStationId: "brisbane-bar",
  },
  {
    id: "shorncliffe",
    name: "Shorncliffe, Queensland, Australia",
    region: "South East Queensland",
    lat: -27.3167,
    lon: 153.0833,
    timezone: "Australia/Brisbane",
    tideStationId: "shorncliffe",
  },
  {
    id: "scarborough",
    name: "Scarborough, Queensland, Australia",
    region: "South East Queensland",
    lat: -27.1833,
    lon: 153.1,
    timezone: "Australia/Brisbane",
    tideStationId: "scarborough",
  },
  {
    id: "tangalooma",
    name: "Tangalooma, Moreton Island, Queensland, Australia",
    region: "South East Queensland",
    lat: -27.1667,
    lon: 153.3667,
    timezone: "Australia/Brisbane",
    tideStationId: "tangalooma",
  },

  // ---- Tasmania ----
  // No free official predicted high/low CSV source found (BOM/AHO publish
  // Tasmanian tide tables as PDF/web only, not machine-readable open data),
  // so these presets have no tideStationId and rely on the WorldTides API
  // fallback for tide highs/lows (a WorldTides key is required in Settings).
  {
    id: "hobart",
    name: "Hobart, Tasmania, Australia",
    region: "Tasmania",
    lat: -42.8826,
    lon: 147.3257,
    timezone: "Australia/Hobart",
  },
  {
    id: "bicheno",
    name: "Bicheno, Tasmania, Australia",
    region: "Tasmania",
    lat: -41.8733,
    lon: 148.2967,
    timezone: "Australia/Hobart",
  },
  {
    id: "st-helens-tas",
    name: "St Helens, Tasmania, Australia",
    region: "Tasmania",
    lat: -41.3167,
    lon: 148.2333,
    timezone: "Australia/Hobart",
  },
  {
    id: "devonport",
    name: "Devonport, Tasmania, Australia",
    region: "Tasmania",
    lat: -41.1833,
    lon: 146.3667,
    timezone: "Australia/Hobart",
  },
  {
    id: "burnie",
    name: "Burnie, Tasmania, Australia",
    region: "Tasmania",
    lat: -41.0500,
    lon: 145.9167,
    timezone: "Australia/Hobart",
  },
  {
    id: "stanley-tas",
    name: "Stanley, Tasmania, Australia",
    region: "Tasmania",
    lat: -40.7667,
    lon: 145.3000,
    timezone: "Australia/Hobart",
  },
  {
    id: "strahan",
    name: "Strahan, Tasmania, Australia",
    region: "Tasmania",
    lat: -42.1500,
    lon: 145.3333,
    timezone: "Australia/Hobart",
  },
  {
    id: "bruny-island",
    name: "Bruny Island, Tasmania, Australia",
    region: "Tasmania",
    lat: -43.2833,
    lon: 147.3333,
    timezone: "Australia/Hobart",
  },
  {
    id: "port-arthur",
    name: "Port Arthur, Tasmania, Australia",
    region: "Tasmania",
    lat: -43.1500,
    lon: 147.8500,
    timezone: "Australia/Hobart",
  },
  {
    id: "flinders-island",
    name: "Flinders Island (Lady Barron), Tasmania, Australia",
    region: "Tasmania",
    lat: -40.2167,
    lon: 148.2333,
    timezone: "Australia/Hobart",
  },

  // ---- New South Wales ----
  // No free official predicted high/low CSV source found (Manly Hydraulics
  // Laboratory/data.nsw.gov.au publish observed/historical monitoring data,
  // not forward tide predictions), so these rely on the WorldTides API too.
  {
    id: "sydney-fort-denison",
    name: "Sydney (Fort Denison), New South Wales, Australia",
    region: "New South Wales",
    lat: -33.8523,
    lon: 151.2266,
    timezone: "Australia/Sydney",
  },
  {
    id: "port-stephens",
    name: "Port Stephens (Nelson Bay), New South Wales, Australia",
    region: "New South Wales",
    lat: -32.7167,
    lon: 152.1500,
    timezone: "Australia/Sydney",
  },
  {
    id: "coffs-harbour",
    name: "Coffs Harbour, New South Wales, Australia",
    region: "New South Wales",
    lat: -30.3000,
    lon: 153.1333,
    timezone: "Australia/Sydney",
  },
  {
    id: "byron-bay",
    name: "Byron Bay, New South Wales, Australia",
    region: "New South Wales",
    lat: -28.6474,
    lon: 153.6020,
    timezone: "Australia/Sydney",
  },
  {
    id: "yamba",
    name: "Yamba, New South Wales, Australia",
    region: "New South Wales",
    lat: -29.4333,
    lon: 153.3500,
    timezone: "Australia/Sydney",
  },
  {
    id: "forster-tuncurry",
    name: "Forster-Tuncurry, New South Wales, Australia",
    region: "New South Wales",
    lat: -32.1833,
    lon: 152.5167,
    timezone: "Australia/Sydney",
  },
  {
    id: "newcastle",
    name: "Newcastle, New South Wales, Australia",
    region: "New South Wales",
    lat: -32.9167,
    lon: 151.8000,
    timezone: "Australia/Sydney",
  },
  {
    id: "jervis-bay",
    name: "Jervis Bay, New South Wales, Australia",
    region: "New South Wales",
    lat: -35.1333,
    lon: 150.6833,
    timezone: "Australia/Sydney",
  },
  {
    id: "batemans-bay",
    name: "Batemans Bay, New South Wales, Australia",
    region: "New South Wales",
    lat: -35.7167,
    lon: 150.1833,
    timezone: "Australia/Sydney",
  },
  {
    id: "merimbula",
    name: "Merimbula, New South Wales, Australia",
    region: "New South Wales",
    lat: -36.9000,
    lon: 149.9000,
    timezone: "Australia/Sydney",
  },
  {
    id: "eden-nsw",
    name: "Eden, New South Wales, Australia",
    region: "New South Wales",
    lat: -37.0667,
    lon: 149.9000,
    timezone: "Australia/Sydney",
  },
  {
    id: "lord-howe-island",
    name: "Lord Howe Island, New South Wales, Australia",
    region: "New South Wales",
    lat: -31.5556,
    lon: 159.0803,
    timezone: "Australia/Lord_Howe",
  },

  // ---- Victoria ----
  // No free official predicted high/low CSV source found (DataVic only
  // publishes storm-surge/inundation modelling, not routine tide-table
  // predictions), so these rely on the WorldTides API too.
  {
    id: "melbourne-port-phillip",
    name: "Melbourne (Port Phillip Heads), Victoria, Australia",
    region: "Victoria",
    lat: -38.2833,
    lon: 144.6500,
    timezone: "Australia/Melbourne",
  },
  {
    id: "queenscliff",
    name: "Queenscliff, Victoria, Australia",
    region: "Victoria",
    lat: -38.2667,
    lon: 144.6667,
    timezone: "Australia/Melbourne",
  },
  {
    id: "barwon-heads",
    name: "Barwon Heads, Victoria, Australia",
    region: "Victoria",
    lat: -38.2833,
    lon: 144.4833,
    timezone: "Australia/Melbourne",
  },
  {
    id: "apollo-bay",
    name: "Apollo Bay, Victoria, Australia",
    region: "Victoria",
    lat: -38.7500,
    lon: 143.6667,
    timezone: "Australia/Melbourne",
  },
  {
    id: "portland-vic",
    name: "Portland, Victoria, Australia",
    region: "Victoria",
    lat: -38.3500,
    lon: 141.6000,
    timezone: "Australia/Melbourne",
  },
  {
    id: "warrnambool",
    name: "Warrnambool, Victoria, Australia",
    region: "Victoria",
    lat: -38.3833,
    lon: 142.4833,
    timezone: "Australia/Melbourne",
  },
  {
    id: "san-remo",
    name: "San Remo, Victoria, Australia",
    region: "Victoria",
    lat: -38.5167,
    lon: 145.3833,
    timezone: "Australia/Melbourne",
  },
  {
    id: "wilsons-promontory",
    name: "Wilsons Promontory (Tidal River), Victoria, Australia",
    region: "Victoria",
    lat: -39.0333,
    lon: 146.3167,
    timezone: "Australia/Melbourne",
  },
  {
    id: "lakes-entrance",
    name: "Lakes Entrance, Victoria, Australia",
    region: "Victoria",
    lat: -37.8833,
    lon: 147.9833,
    timezone: "Australia/Melbourne",
  },
  {
    id: "mallacoota",
    name: "Mallacoota, Victoria, Australia",
    region: "Victoria",
    lat: -37.5500,
    lon: 149.7500,
    timezone: "Australia/Melbourne",
  },
];

// ---------- distance helpers ----------
// Supports "nearest location" features: a GPS/typed lat+lon rarely lands
// exactly on a preset (e.g. Fingal Head, NSW sits right on the border a
// few km from the Southport/Gold Coast Seaway tide gauges), so the app
// needs to work out which bundled presets are physically closest rather
// than requiring an exact coordinate match.

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Every bundled preset, annotated with its distance (km) from the given
// point and sorted nearest-first. Returns [] if lat/lon aren't valid
// numbers (e.g. the form fields are still empty).
function presetsByDistance(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon)) return [];
  return window.LOCATION_PRESETS
    .map((p) => ({ ...p, distanceKm: haversineKm(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// Nearest preset that actually has a bundled local tide-station CSV (i.e.
// can supply official tide highs/lows offline, not just a WorldTides
// fallback) - this is what "auto" tide-station resolution picks for a
// custom/GPS location that doesn't exactly match a preset.
function nearestPresetWithTide(lat, lon) {
  const withTide = presetsByDistance(lat, lon).filter((p) => p.tideStationId);
  return withTide.length ? withTide[0] : null;
}

window.LocationUtils = { haversineKm, presetsByDistance, nearestPresetWithTide };
