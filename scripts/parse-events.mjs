#!/usr/bin/env node
/* ---------------------------------------------------------------------------
 * Fetches the park's public events page and writes data/events.json.
 *
 * Same design rules as parse-sessions.mjs:
 *  - FAIL LOUDLY. If the page can't be fetched, or event cards exist but
 *    none parse, exit non-zero WITHOUT touching the existing events.json.
 *    The dashboard keeps showing the last good data.
 *  - A page with no event cards at all is a legitimate empty list (the park
 *    simply has nothing scheduled), not a failure.
 *
 * The page structure this parser relies on (verified 2026-08-05):
 *   <div class="event_content">
 *     <div class="event_date">
 *       <span class="day">יום רביעי</span> ... <span class="date">05.08.2026</span>
 *       ... <span class="hour">20:00 </span>
 *     </div>
 *     <div class="event_title">Family Movie Night</div>
 *     <div class="event_detais">…</div>            (typo is the site's own)
 *     <div class="event_price">…</div>
 *     <div class="event_link"><a href="/eventer/…/">…</a>
 *
 * Runs on Node 18+ with no dependencies.
 * Test offline against a saved page:  node scripts/parse-events.mjs --from-file page.html
 * ------------------------------------------------------------------------- */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");
const SOURCE_URL = "https://www.srfparktlv.co.il/eventer/";

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

const clean = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/* --------------------------------------------------------------------------
 * extractEvents(html) → sorted event list.
 * The one function that knows the events page markup.
 * ------------------------------------------------------------------------ */
function extractEvents(html) {
  // Match the whole `.box`, not just `.event_content`, because the card's
  // thumbnail lives in a sibling `.event_img` immediately before it:
  //   <div class="box">
  //     <div class="event_img"><img src="…"></div>
  //     <div class="event_content"> … </div>
  const cards =
    html.match(/<div class="box">[\s\S]*?<div class="event_content">[\s\S]*?<\/a>/g) || [];
  const events = [];

  for (const c of cards) {
    const grab = (re) => {
      const m = c.match(re);
      return m ? clean(m[1]) : "";
    };

    // "05.08.2026" → "2026-08-05"; skip cards without a parseable date.
    const rawDate = grab(/<span class="date">([\s\S]*?)<\/span>/);
    const dm = rawDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dm) continue;

    const hour = grab(/<span class="hour">([\s\S]*?)<\/span>/);
    const hm = hour.match(/(\d{1,2}:\d{2})/);

    // Absolute URL on the club's media host. Hot-linked by the dashboard;
    // the TV hides the thumbnail if it fails to load, so a broken or
    // blocked image never costs us the event text.
    const imgM = c.match(/<div class="event_img">[\s\S]*?<img[^>]+src="([^"]+)"/);

    events.push({
      date: `${dm[3]}-${dm[2]}-${dm[1]}`,
      time: hm ? hm[1] : "",
      title: grab(/<div class="event_title">([\s\S]*?)<\/div>/),
      details: grab(/<div class="event_detais">([\s\S]*?)<\/div>/),
      image: imgM ? imgM[1] : "",
      url: grab(/<a href="([^"]*)"/),
    });
  }

  // The page renders each event more than once (e.g. desktop + mobile
  // blocks) — keep one card per date/time/url.
  const seen = new Set();
  const unique = events.filter((e) => {
    const key = `${e.date}|${e.time}|${e.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort(
    (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
  );
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

  const cardCount = (html.match(/event_content/g) || []).length;
  const events = extractEvents(html);
  console.log(`Extracted ${events.length} events from ${cardCount} cards.`);

  // Cards present but nothing parsed → the markup changed under us.
  if (cardCount > 0 && events.length === 0) {
    console.error(
      "FAIL: event cards found but none parsed — page markup has changed. " +
        "Leaving the existing events.json untouched."
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
    events,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${OUT} with ${events.length} events.`);
}

main().catch((err) => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
