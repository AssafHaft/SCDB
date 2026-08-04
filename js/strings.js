// ---------------------------------------------------------------------------
// All display text lives here, in one place, so a Hebrew version later is a
// second block in this file (plus dir="rtl" on <html>) — no markup changes.
//
// Note: the Hebrew→English mapping for the *source* page (zone names,
// availability wording, booking-state labels) lives in
// scripts/parse-sessions.mjs next to the parser that consumes it. The
// dashboard itself only ever sees already-normalised English JSON.
// ---------------------------------------------------------------------------
window.STRINGS = {
  en: {
    now: "Now in the water",
    waveProgram: "Wave program",
    nextUp: "Next up",
    endsIn: "Ends in",
    startsIn: "Starts in",
    min: "min",
    right: "Reef Right",
    left: "Reef Left",
    bay: "The Bay",
    open: "Open",
    full: "Full",
    inSession: "In session",
    noSession: "No session",
    placesLeft: (n) => (n === 1 ? "1 place left" : `${n} places left`),
    inWater: (n, cap) => `${n} of ${cap} in the water`,
    nextLesson: "Next lesson",
    updated: (m) => (m < 1 ? "Updated just now" : `Updated ${m} min ago`),
    stale: (m) => `Schedule last updated ${m} min ago`,
    closedTitle: "Closed",
    opensAt: (t) => `Opens at ${t}`,
    opensTomorrow: (t) => `Opens tomorrow at ${t}`,
    opensOn: (day, t) => `Opens ${day} at ${t}`,
    noData: "Schedule unavailable",
    wind: "Wind",
    kmh: "km/h",
    whatsOn: "What's On",
    noEvents: "No upcoming events",
    today: "Today",
    tomorrow: "Tmrw",
    tomorrowFull: "Tomorrow",
    sideRight: "Right",
    sideLeft: "Left",
    placesLabel: "Places left",
    inDur: (d) => `in ${d}`,
  },
};

// Active language. Later: "he".
window.T = window.STRINGS.en;
