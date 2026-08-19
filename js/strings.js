// ---------------------------------------------------------------------------
// All display text lives here, in one place. The dashboard rotates between
// the languages listed in CONFIG.languages (js/config.js); each block also
// carries its direction, date locale, and the few formatters that differ
// per language (durations, weekday chips, weather wording).
//
// Note: the Hebrew→English mapping for the *source* page (zone names,
// availability wording, booking-state labels) lives in
// scripts/parse-sessions.mjs next to the parser that consumes it. The
// dashboard itself only ever sees already-normalised English JSON, and
// session names stay in English in both languages (the park's own naming).
// ---------------------------------------------------------------------------
window.STRINGS = {
  en: {
    dir: "ltr",
    locale: "en-GB",
    now: "Now in the water",
    nextSession: "Next session",
    spotsLeft: "Spots left",
    spotsFull: "Fully booked",
    bookingClosed: "Booking closed",
    noMoreToday: "No more sessions today",
    nothingInWater: "Nothing in the water",
    endsIn: "Ends in",
    startsInShort: (d) => `in ${d}`,
    min: "min",
    right: "Reef Right",
    left: "Reef Left",
    bay: "BAY",
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
    eventsTitle: "Upcoming Events",
    noEvents: "No upcoming events",
    today: "Today",
    tomorrow: "Tmrw",
    tomorrowFull: "Tomorrow",
    sideRight: "Right",
    sideLeft: "Left",
    asOf: (t) => `as of ${t}`,
    dur: (mins) => {
      if (mins < 60) return `${mins} min`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    },
    date: (d) =>
      d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
    dow: (d) => d.toLocaleDateString("en-GB", { weekday: "short" }),
    wmo: {
      0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
      61: "Light rain", 63: "Rain", 65: "Heavy rain", 80: "Showers",
      81: "Showers", 82: "Heavy showers", 95: "Thunderstorm",
    },
  },

  he: {
    dir: "rtl",
    locale: "he-IL",
    now: "עכשיו במים",
    nextSession: "הסשן הבא",
    spotsLeft: "מקומות פנויים",
    spotsFull: "הסשן מלא",
    bookingClosed: "ההרשמה נסגרה",
    noMoreToday: "אין סשנים נוספים היום",
    nothingInWater: "אין סשן במים",
    endsIn: "מסתיים בעוד",
    startsInShort: (d) => `בעוד ${d}`,
    min: "דק׳",
    right: "ריף ימין",
    left: "ריף שמאל",
    bay: "ביי",
    open: "פתוח",
    full: "מלא",
    inSession: "סשן פעיל",
    noSession: "אין סשן",
    placesLeft: (n) => (n === 1 ? "נותר מקום אחד" : `נותרו ${n} מקומות`),
    inWater: (n, cap) => `${n} מתוך ${cap} במים`,
    nextLesson: "השיעור הבא",
    updated: (m) => (m < 1 ? "עודכן ממש עכשיו" : `עודכן לפני ${m} דק׳`),
    stale: (m) => `הלוח עודכן לפני ${m} דק׳`,
    closedTitle: "סגור",
    opensAt: (t) => `נפתח בשעה ${t}`,
    opensTomorrow: (t) => `נפתח מחר בשעה ${t}`,
    opensOn: (day, t) => `נפתח ב${day} בשעה ${t}`,
    noData: "לוח הזמנים אינו זמין",
    wind: "רוח",
    kmh: "קמ״ש",
    eventsTitle: "אירועים קרובים",
    noEvents: "אין אירועים קרובים",
    today: "היום",
    tomorrow: "מחר",
    tomorrowFull: "מחר",
    sideRight: "ימין",
    sideLeft: "שמאל",
    asOf: (t) => `נכון ל-${t}`,
    dur: (mins) => {
      if (mins < 60) return `${mins} דק׳`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? `${h} שע׳ ${m} דק׳` : `${h} שע׳`;
    },
    date: (d) =>
      d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" }),
    dow: (d) => d.toLocaleDateString("he-IL", { weekday: "short" }),
    wmo: {
      0: "בהיר", 1: "בהיר ברובו", 2: "מעונן חלקית", 3: "מעונן",
      45: "ערפל", 48: "ערפל", 51: "טפטוף", 53: "טפטוף", 55: "טפטוף",
      61: "גשם קל", 63: "גשם", 65: "גשם כבד", 80: "ממטרים",
      81: "ממטרים", 82: "ממטרים עזים", 95: "סופת רעמים",
    },
  },
};

// Startup language; js/dashboard.js re-points this when rotating.
window.T = window.STRINGS.en;
