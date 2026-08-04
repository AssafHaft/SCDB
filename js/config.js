// ---------------------------------------------------------------------------
// Dashboard configuration — the only file staff should ever need to edit.
// ---------------------------------------------------------------------------
window.CONFIG = {
  clubName: "SRF Park TLV",

  // Operating hours per weekday (0 = Sunday … 6 = Saturday), local time.
  // Outside these hours the dashboard shows the quiet "closed" screen.
  // Times are "HH:MM" 24h. Set a day to null to mark the whole day closed.
  operatingHours: {
    0: { open: "06:00", close: "23:00" }, // Sunday
    1: { open: "06:00", close: "23:00" }, // Monday
    2: { open: "06:00", close: "23:00" }, // Tuesday
    3: { open: "06:00", close: "23:00" }, // Wednesday
    4: { open: "06:00", close: "23:00" }, // Thursday
    5: { open: "06:00", close: "23:00" }, // Friday
    6: { open: "06:00", close: "23:00" }, // Saturday
  },

  // Where the parsed schedule lives (written by the GitHub Actions job).
  sessionsUrl: "data/sessions.json",

  // Weather: Open-Meteo, free, no API key, CORS-enabled.
  // Coordinates for the park (Tel Aviv coast). Adjust if needed.
  weather: {
    latitude: 32.0853,
    longitude: 34.7818,
    refreshMinutes: 10,
  },

  // How often to re-read sessions.json (seconds).
  sessionsRefreshSeconds: 60,

  // Show a "data may be stale" note if sessions.json is older than this.
  staleWarnMinutes: 30,

  // Optional: session capacities per level, used to show "8 of 12 in the
  // water" instead of "places left". Leave null until capacities are
  // confirmed with the club — the dashboard then shows the booking page's
  // own wording, which is always honest.
  capacities: null,
  // Example once confirmed:
  // capacities: { L0: 14, L1: 14, L2: 14, L3: 18, L4: 16, L5: 14, L6: 15 },
};
