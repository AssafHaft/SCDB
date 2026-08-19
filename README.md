# SRF Club TV Dashboard

A wall-mounted TV dashboard for the surf club: the next session and its
remaining spots, what's currently in the water, Reef Left / Reef Right / Bay
status, upcoming park events, clock and weather. One static page, no backend,
no login — hosted free on GitHub Pages.

## What it's for

**The dashboard exists to fill the next session, not to report the present.**

A session already in the water is status — nobody walking past can act on it.
The next session is the only thing still influenceable: seeing that it starts
soon and has spots left is what turns a passer-by into a last-minute sign-up.
So the layout is deliberately lopsided:

- **The next session owns the hero** — level, name, start time, a countdown
  that turns warm inside `urgentMinutes`, and big per-side spot counts. This
  is the conversion surface; everything about it is sized to be read across
  a room, and both hero columns use `justify-content: space-between` so the
  panel fills its height instead of floating in empty teal.
  The session name is auto-fitted by `fitHeroName()` in `js/dashboard.js`:
  short names stay at full size and only unusually long ones step down, so
  a program title is never ellipsised away on the wall.
- **The current session gets one quiet line** (`#now-strip`). Visible, never
  competing.
- **Zone cards and events** are the detail layer underneath.

Two rules follow from this, and both are load-bearing:

1. **Never assert a spot count the data can't back.** If the schedule goes
   stale, the count line says "as of HH:MM" instead of implying it's live.
2. **Never contradict the counts.** "Booking closed" is shown only when the
   club actually pulled the slot (`disabled`) or the start time has genuinely
   passed by *this page's* clock — not from the feed's `open` flag, which
   freezes the booking cutoff at parse time and goes stale between runs.

If you restructure the hero, keep those two properties. They're the
difference between a screen staff trust and one they start apologising for.

## How it works

```
GitHub Actions (every 10 min) ──► scripts/parse-sessions.mjs
        fetches the srfparktlv.co.il booking feed, writes data/sessions.json
                              ──► scripts/parse-events.mjs
        fetches srfparktlv.co.il/eventer, writes data/events.json
                              │
                              ▼
GitHub Pages serves index.html ──► the TV's browser reads sessions.json
        + events.json (same domain, so no CORS issues) + Open-Meteo weather
```

The dashboard never talks to the club's site directly — a browser on another
domain can't. The Actions job does the fetching and parsing in one place, so
if the club redesigns its site, the wall keeps showing the last good data
while `scripts/parse-sessions.mjs` is fixed.

## Setup (one time, ~10 minutes)

1. **Create the repository.** On GitHub, create a new public repository
   (e.g. `surfclub-dashboard`), then push this folder to it:

   ```bash
   cd surfclub-dashboard
   git init
   git add .
   git commit -m "Initial dashboard"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/surfclub-dashboard.git
   git push -u origin main
   ```

2. **Enable GitHub Pages.** Repo → Settings → Pages → Source:
   "Deploy from a branch" → Branch: `main`, folder `/ (root)` → Save.
   After a minute the dashboard is live at
   `https://YOUR-USERNAME.github.io/surfclub-dashboard/`.

3. **Enable the workflow.** Repo → Actions tab → enable workflows if
   prompted. Then open "Update sessions data" → "Run workflow" to do a first
   manual run. Check that it turns green and that `data/sessions.json` got a
   fresh commit.

4. **Point the TV at the page.** Open the Pages URL in the TV's browser and
   go full screen. If the TV has no keyboard for F11, **tap the top-right
   corner of the screen** — there's an invisible toggle there (`#fs-toggle`)
   that puts the browser into full screen and back out again. Done — the
   page refreshes its own data.

## Configuration

Everything staff might need to change lives in **`js/config.js`**:

- `operatingHours` — per weekday; outside them the quiet closed screen shows.
- `weather.latitude/longitude` — park location for Open-Meteo.
- `capacities` — set per-level session capacities (once confirmed with the
  club) to switch the display from "4 places left" to "8 of 12 in the water".
  Leave `null` to show the booking page's own wording.
- `languages` / `languageIntervalSeconds` — the dashboard rotates through
  these languages (keys into `window.STRINGS`, currently `en` and `he`),
  wall-clock-timed so every TV switches in the same second. Set `languages`
  to a single entry to stop rotating and stay on one language.
- `showSignupCta` — the "Sign up at reception" line under the spot counts.
  Set `false` to hide it; reword it per language via `signupCta` in
  `js/strings.js` (e.g. if sign-ups move to an app or a different desk).
- `urgentMinutes` — how close a session must be for the countdown to switch
  to the warm/urgent treatment. Default 20.

Display text lives in **`js/strings.js`** — one English/Hebrew block per
language, so adding a third language is a third block there, nothing else.
Session names themselves (e.g. "T-Time Pro Carves") are the park's own
naming and stay in English in both languages.

Layout is direction-pinned where it matters: the reef-side cards and the
spot boxes name real pool sides, so `#hero`, `#zones` and `.spots-boxes` in
`css/style.css` are locked to `direction: ltr` regardless of language —
only the text inside re-flows for Hebrew. If you rename or restructure
those sections, keep that pin or the customer-reported "Right/Left on the
wrong side" bug comes back.

The dashboard is laid out as a fixed 16:9 "stage" (`#stage` in
`index.html`, sized by `sizeStage()` in `js/dashboard.js`), so it matches a
16:9 wall TV pixel-for-pixel and letterboxes — rather than stretching —
on any other screen, including this repo's own preview tooling.

The Hebrew→English mapping for the *source* page (zone names, availability
wording, booking states) lives at the top of `scripts/parse-sessions.mjs`,
next to the parser that uses it.

## When something breaks

- **Dashboard shows "Schedule last updated N min ago" in yellow** — the
  Actions job is failing. Check the repo's Actions tab for the red run; the
  log says why. The wall keeps showing the last good schedule meanwhile.
- **Club redesigned their site** — fix `extractSessions()` in
  `scripts/parse-sessions.mjs`. It is deliberately the only file that knows
  anything about the club's data shape. The parser refuses to write implausible
  output (fewer than 20 sessions), so a redesign can never blank the wall.
  It reads the same JSON feed the club's own booking app uses
  (`/products/sessions-react/?ajax=1`), falling back to the `window.srxInitial`
  payload embedded in the booking page if that route ever moves. Test a fix
  offline against a saved response or a saved page:
  `node scripts/parse-sessions.mjs --from-file payload.json`.
- **"Upcoming Events" card empty or stale** — same idea: `extractEvents()` in
  `scripts/parse-events.mjs` is the only code that knows the events page
  markup. A broken events parse never blocks the sessions update (the
  workflow step is `continue-on-error`), and the wall keeps the last good
  event list.
- **Weather panel empty** — Open-Meteo hiccup; it retries every 10 minutes
  on its own.

## Notes

- GitHub Actions cron is best-effort; runs can be delayed a few minutes at
  busy times. The schedule only changes on the hour, so this doesn't matter.
- The `*/10 3-20 * * *` schedule covers park hours in Israel time (UTC+2/+3).
  Adjust in `.github/workflows/update-sessions.yml` if hours change.
