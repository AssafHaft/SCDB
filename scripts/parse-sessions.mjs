#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Fetches the club's public booking data and writes data/sessions.json.
 *
 * Design rules:
 *  - FAIL LOUDLY. If the data can't be fetched or yields implausibly few
 *    sessions, exit non-zero WITHOUT touching the existing sessions.json.
 *    The dashboard then keeps showing the last good data, and the failed
 *    Actions run is the alarm bell.
 *  - All Hebrew→English mapping happens here, in HE-facing NAME_MAP below,
 *    so the dashboard only ever sees normalised English JSON.
 *
 * Data source (rewritten 2026-08-17):
 *   The club replaced the server-rendered booking page with a React app, so
 *   the old "scrape .box_session divs out of /sessions" approach now matches
 *   nothing — the page ships an empty shell and the cards are built in the
 *   browser. We read the same JSON the app itself reads:
 *
 *     GET /products/sessions-react/?ajax=1&from_date=   (X-Requested-With)
 *       → { success, scheduler: [...], close_days, dateArray, from_date, to_date }
 *
 *   One `scheduler` entry per side of a slot. Each entry mirrors its own
 *   side's numbers into BOTH the left_* and right_* fields, so always read
 *   the pair named by `area_number`. Fields we rely on:
 *     scheduler_id, date, startTime, endTime, name, en_name, wave,
 *     wave_level, area ("reef"|"bay"), area_number ("left"|"right"),
 *     left/right_max_users, left/right_count_users, left/right_age_group,
 *     type, disabled.
 *
 *   As a fallback (if the ajax route moves) we scrape the same payload out of
 *   the `window.srxInitial = {...}` bootstrap the page still embeds.
 *
 * Level, spots and availability are derived exactly the way the site's own
 * computeBox() does it, so the dashboard keeps showing what the club shows.
 *
 * Runs on Node 18+ with no dependencies.
 * Test offline against a saved payload (JSON response or saved HTML page):
 *   node scripts/parse-sessions.mjs --from-file payload.json
 * ------------------------------------------------------------------------- */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "sessions.json");
const SOURCE_URL = "https://srfparktlv.co.il/sessions";
const API_URL = "https://srfparktlv.co.il/products/sessions-react/?ajax=1&from_date=";

// The club runs on Israel time; GitHub's runners are UTC. Every wall-clock
// comparison below goes through israelWallClock() so a session that started
// at 07:00 in Tel Aviv isn't judged against 07:00 UTC.
const CLUB_TZ = "Asia/Jerusalem";

// Minimum plausible number of sessions across the 3 published days.
// The reef alone runs ~17 hourly sessions/day, so anything under this
// means the parse went wrong.
const MIN_PLAUSIBLE_SESSIONS = 20;

// Booking extras stripped from names on the TV (e.g. "includes free softboard").
// Both spellings are needed: we prefer the feed's en_name, but fall back to
// the Hebrew name when an entry has none.
const STRIP_RE = /\s*-?\s*(?:כולל גלשן סופט ללא עלות|including free softboard)/i;

// Known session names → short English display names. The feed's `en_name`
// already covers most of the catalogue, so these mostly exist to keep the
// long bay lesson titles short enough for the TV layout; the Hebrew patterns
// stay as a safety net for entries published without an en_name.
const NAME_MAP = [
  [/Beginners?\s+lesson\s+in\s+the\s+Bay\s*-\s*Over\s*16\s*years/i, "Beginner lesson in Bay - Adults 16+"],
  [/Beginners?\s+lesson\s+in\s+the\s+Bay\s*-\s*ages\s*11-16/i, "Beginner lesson in Bay - Kids 11-16"],
  [/Beginners?\s+lesson\s+in\s+the\s+Bay\s*-\s*ages\s*7-10/i, "Beginner lesson in Bay - Kids 7-10"],
  [/שיעור גלישה למתחילים ב\s*Bay\s*-\s*בוגרים.*16/, "Beginner lesson in Bay - Adults 16+"],
  [/שיעור גלישה למתחילים ב\s*Bay\s*-\s*ילדים\s*11-16/, "Beginner lesson in Bay - Kids 11-16"],
  [/שיעור גלישה למתחילים ב\s*Bay\s*-\s*ילדים\s*7-10/, "Beginner lesson in Bay - Kids 7-10"],
  [/אימון פרטי\s*-?\s*/, "Private training - "],
];

// Sessions that share a reef slot with the regular program (private training,
// special activities). They sort after regular sessions so the dashboard's
// "current session" pick prefers the public program.
const SPECIAL_RE = /Private training|Galna/i;

// ---------------------------------------------------------------------------
async function fetchJson(url, attempt = 1) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000), // a hung request must fail, not stall the job
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
        "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest", // without this the route returns the HTML page
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`response from ${url} was not JSON (got ${text.length} bytes)`);
    }
  } catch (err) {
    if (attempt < 2) {
      console.warn(`Fetch failed (${err.message}), retrying once ...`);
      return fetchJson(url, attempt + 1);
    }
    throw err;
  }
}

// Fallback source: the booking page still bootstraps the React app with the
// same payload inline, so we can recover the schedule even if the ajax route
// changes shape or name.
async function fetchBootstrapped() {
  console.warn(`Falling back to the window.srxInitial bootstrap on ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept-Language": "he-IL,he;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
  return extractBootstrap(await res.text());
}

function extractBootstrap(html) {
  const payload = sliceJsonObject(html, html.indexOf("window.srxInitial"));
  if (!payload) throw new Error("no window.srxInitial payload found in the page");
  return JSON.parse(payload);
}

// Walk from the first "{" after `from` to its matching "}", so we don't have
// to guess where the inline object ends (it contains braces and quotes).
function sliceJsonObject(text, from) {
  if (from === -1) return null;
  const start = text.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// "Now" and session start times compared in the club's own wall clock, as a
// UTC-stamped instant so plain numeric comparison works.
function israelWallClock(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(d)
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
}

function slotWallClock(date, hhmm) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
}

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

const hhmm = (t) => String(t || "").slice(0, 5);

function normalizeName(raw) {
  let name = String(raw || "").replace(/\s+/g, " ").trim();
  name = name.replace(STRIP_RE, "");
  for (const [re, en] of NAME_MAP) name = name.replace(re, en);
  // Drop the leading level prefix ("L4 – ", "L5- ", "L3 - ") — the badge
  // already shows it.
  name = name.replace(/^L[0-6]\s*[-–]?\s*/, "");
  return name.replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
 * extractSessions(payload) → merged session list.
 * The one function that knows the club's data shape.
 * ------------------------------------------------------------------------ */
function extractSessions(payload) {
  const scheduler = payload && Array.isArray(payload.scheduler) ? payload.scheduler : [];
  const now = israelWallClock();
  const raw = [];

  for (const e of scheduler) {
    const side = String(e.area_number || "").trim();
    if (!e.date || !e.startTime || (side !== "left" && side !== "right")) continue;

    const zone = String(e.area || "").includes("bay") ? "bay" : "reef";
    const disabled = !!num(e.disabled);

    // Remaining places for this record's own side. Entries mirror their side's
    // numbers into both field pairs, so read the pair `area_number` names.
    const max = num(side === "left" ? e.left_max_users : e.right_max_users);
    const taken = num(side === "left" ? e.left_count_users : e.right_count_users);
    const places = disabled ? 0 : Math.max(0, max - taken);

    // The wave badge is authoritative; bay lessons always show L0 even though
    // they carry a (misleading) reef wave_level.
    const level = zone === "bay"
      ? "L0"
      : (e.wave ? String(e.wave).split("-")[0].trim() : "") || `L${num(e.wave_level) || "?"}`;

    // The site closes booking once the slot is under a minute away.
    const timePassed = now >= slotWallClock(e.date, hhmm(e.startTime)) - 60_000;
    const name = normalizeName(e.en_name || e.name);

    raw.push({
      date: String(e.date).slice(0, 10),
      start: hhmm(e.startTime),
      end: hhmm(e.endTime),
      level,
      name,
      zone,
      side,
      ageGroup: (side === "left" ? e.left_age_group : e.right_age_group) || "all",
      places,
      open: places > 0 && !disabled && !timePassed,
      special: String(e.type || "regular") !== "regular" || SPECIAL_RE.test(name),
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
  let payload;
  if (fileArg !== -1) {
    const path = process.argv[fileArg + 1];
    console.log(`Reading ${path} ...`);
    const text = readFileSync(path, "utf8");
    payload = text.trimStart().startsWith("{") ? JSON.parse(text) : extractBootstrap(text);
  } else {
    console.log(`Fetching ${API_URL} ...`);
    // A renamed route answers with a 404 or with the HTML page rather than
    // JSON, so a hard failure here still gets the bootstrap fallback. If that
    // fails too the error propagates and the run fails loudly, as intended.
    try {
      payload = await fetchJson(API_URL);
    } catch (err) {
      console.warn(`Ajax feed unavailable (${err.message}).`);
      payload = null;
    }
    if (!payload || payload.success !== true || !Array.isArray(payload.scheduler)) {
      if (payload) console.warn("Ajax payload missing a scheduler array.");
      payload = await fetchBootstrapped();
    }
  }
  console.log(`Got ${(payload.scheduler || []).length} scheduler entries.`);

  const sessions = extractSessions(payload);
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
