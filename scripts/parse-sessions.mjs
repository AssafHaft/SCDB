#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Fetches the club's public booking page and writes data/sessions.json.
 *
 * Design rules:
 *  - FAIL LOUDLY. If the page can't be fetched or yields implausibly few
 *    sessions, exit non-zero WITHOUT touching the existing sessions.json.
 *    The dashboard then keeps showing the last good data, and the failed
 *    Actions run is the alarm bell.
 *  - All Hebrew→English mapping happens here, in HE_MAP / NAME_MAP below,
 *    so the dashboard only ever sees normalised English JSON.
 *
 * The page structure this parser relies on (verified 2026-08-04):
 *   <div class="box_session wrapper [disabled]"
 *        data-area="reef right|reef left|bay right|bay left" ...>
 *     <div class="wave l4">L4</div>
 *     <div class="title"> NAME <span>ימין|שמאל</span></div>
 *     <div class="wrapper bottom" data-dates="20260804T060000/20260804T070000">
 *       <div class="status have">נותרו 9 מקומות</div>  (or "לא נותרו מקומות")
 *     <button class="btn_blue [disabled]">בחרו | ההרשמה סגורה</button>
 *
 * Runs on Node 18+ with no dependencies.
 * Test offline against a saved page:  node scripts/parse-sessions.mjs --from-file page.html
 * ------------------------------------------------------------------------- */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "sessions.json");
const SOURCE_URL = "https://srfparktlv.co.il/sessions";

// Minimum plausible number of sessions across the 3 published days.
// The reef alone runs ~17 hourly sessions/day, so anything under this
// means the parse went wrong.
const MIN_PLAUSIBLE_SESSIONS = 20;

// --- Hebrew → English mapping (kept in one place, next to the parser) ------
const HE_MAP = {
  placesLeft: /נותרו\s+(\d+)\s+מקומות/, // also covers "נותרו 1 מקומות"
  noPlaces: /לא\s+נותרו\s+מקומות/,
};

// Known Hebrew (or mixed) session names → English display names.
const NAME_MAP = [
  [/שיעור גלישה למתחילים ב\s*Bay\s*-\s*בוגרים.*16/, "Beginner lesson in Bay - Adults 16+"],
  [/שיעור גלישה למתחילים ב\s*Bay\s*-\s*ילדים\s*11-16/, "Beginner lesson in Bay - Kids 11-16"],
  [/אימון פרטי\s*-?\s*/, "Private training - "],
];

// Booking extras stripped from names on the TV (e.g. "includes free softboard").
const STRIP_RE = /\s*-?\s*כולל גלשן סופט ללא עלות/;

// Sessions that share a reef slot with the regular program (private training,
// special activities). They sort after regular sessions so the dashboard's
// "current session" pick prefers the public program.
const SPECIAL_RE = /Private training|Galna/i;

// ---------------------------------------------------------------------------
async function fetchPage(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000), // a hung request must fail, not stall the job
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } catch (err) {
    if (attempt < 2) {
      console.warn(`Fetch failed (${err.message}), retrying once ...`);
      return fetchPage(url, attempt + 1);
    }
    throw err;
  }
}

function normalizeName(raw) {
  let name = raw.replace(/\s+/g, " ").trim();
  name = name.replace(STRIP_RE, "");
  for (const [re, en] of NAME_MAP) name = name.replace(re, en);
  // Drop the leading level prefix ("L4 – ", "L5- ", "L3 - ") — the badge
  // already shows it.
  name = name.replace(/^L[0-6]\s*[-–]?\s*/, "");
  return name.replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
 * extractSessions(html) → merged session list.
 * The one function that knows the club's markup.
 * ------------------------------------------------------------------------ */
function extractSessions(html) {
  const cards = html.match(/<div class="box_session wrapper[^"]*"[\s\S]*?<\/button>/g) || [];
  const raw = [];

  for (const c of cards) {
    const attr = (n) => {
      const m = c.match(new RegExp(`data-${n}="([^"]*)"`));
      return m ? m[1] : "";
    };

    const dates = attr("dates");
    const area = attr("area"); // "reef right" | "reef left" | "bay right" | "bay left"
    if (!dates || !area) continue; // skip empty template cards

    // Level: the wave badge is authoritative (bay cards carry a misleading
    // data-level).
    const waveM = c.match(/class="wave (l[0-6])"/);
    const level = waveM ? waveM[1].toUpperCase() : `L${attr("level") || "?"}`;

    const titleM = c.match(/<div class="title">\s*([\s\S]*?)\s*<span>/);
    const name = normalizeName(titleM ? titleM[1] : "");

    const statusM = c.match(/<div class="status[^"]*">([^<]*)<\/div>/);
    const statusTxt = statusM ? statusM[1].trim() : "";
    let places = null;
    const pm = statusTxt.match(HE_MAP.placesLeft);
    if (pm) places = parseInt(pm[1], 10);
    else if (HE_MAP.noPlaces.test(statusTxt)) places = 0;

    const open = !/box_session wrapper disabled/.test(c);

    const [d0, d1] = dates.split("/");
    raw.push({
      date: `${d0.slice(0, 4)}-${d0.slice(4, 6)}-${d0.slice(6, 8)}`,
      start: `${d0.slice(9, 11)}:${d0.slice(11, 13)}`,
      end: `${d1.slice(9, 11)}:${d1.slice(11, 13)}`,
      level,
      name,
      zone: area.startsWith("bay") ? "bay" : "reef",
      side: area.endsWith("left") ? "left" : "right",
      ageGroup: attr("age_group") || "all",
      places,
      open,
      special: SPECIAL_RE.test(name),
    });
  }

  return mergeSides(raw);
}

// Merge reef right/left cards of the same slot+level+kind into one session
// with places per side. Bay cards stay individual (each side is its own
// lesson, e.g. adults on the right while kids run on the left).
function mergeSides(raw) {
  const merged = [];
  const reefGroups = new Map();

  for (const r of raw) {
    if (r.zone === "bay") {
      merged.push({
        date: r.date, start: r.start, end: r.end, level: r.level,
        name: r.name, zone: "bay", side: r.side, ageGroup: r.ageGroup,
        places: { bay: r.places }, open: r.open, special: r.special,
      });
      continue;
    }
    const key = [r.date, r.start, r.end, r.level, r.special].join("|");
    if (!reefGroups.has(key)) {
      reefGroups.set(key, {
        date: r.date, start: r.start, end: r.end, level: r.level,
        name: r.name, zone: "reef", places: {}, sideNames: {},
        open: false, special: r.special,
      });
      merged.push(reefGroups.get(key));
    }
    const g = reefGroups.get(key);
    if (r.places !== null) g.places[r.side] = r.places;
    g.sideNames[r.side] = r.name;
    g.open = g.open || r.open;
  }

  // Tidy: drop sideNames when both sides run the same program.
  for (const s of merged) {
    if (s.sideNames) {
      const names = [...new Set(Object.values(s.sideNames))];
      if (names.length <= 1) delete s.sideNames;
      else s.name = s.sideNames.right || names[0];
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
function groupByDay(sessions) {
  const days = new Map();
  for (const s of sessions) {
    if (!days.has(s.date)) days.set(s.date, []);
    const { date, ...rest } = s;
    days.get(s.date).push(rest);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      // Specials sort after regular sessions so "current session" lookups
      // hit the public program first.
      sessions: list.sort(
        (a, b) => a.start.localeCompare(b.start) || (a.special ? 1 : 0) - (b.special ? 1 : 0)
      ),
    }));
}

// ---------------------------------------------------------------------------
async function main() {
  const fileArg = process.argv.indexOf("--from-file");
  let html;
  if (fileArg !== -1) {
    const path = process.argv[fileArg + 1];
    console.log(`Reading ${path} ...`);
    html = readFileSync(path, "utf8");
  } else {
    console.log(`Fetching ${SOURCE_URL} ...`);
    html = await fetchPage(SOURCE_URL);
  }
  console.log(`Got ${html.length} bytes.`);

  const sessions = extractSessions(html);
  console.log(`Extracted ${sessions.length} sessions (after side-merge).`);

  if (sessions.length < MIN_PLAUSIBLE_SESSIONS) {
    console.error(
      `FAIL: only ${sessions.length} sessions extracted ` +
        `(expected ≥ ${MIN_PLAUSIBLE_SESSIONS}). ` +
        `Leaving the existing sessions.json untouched.`
    );
    if (existsSync(OUT)) {
      const prev = JSON.parse(readFileSync(OUT, "utf8"));
      console.error(`Previous data from ${prev.updatedAt} remains in place.`);
    }
    process.exit(1);
  }

  const out = {
    updatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    parserOk: true,
    days: groupByDay(sessions),
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${OUT} with ${out.days.length} days.`);
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
