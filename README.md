# SRF Club TV Dashboard

A wall-mounted TV dashboard for the surf club: current session, wave program,
Reef Right / Reef Left / Bay status, places left, next session, upcoming park
events, clock and weather. One static page, no backend, no login — hosted
free on GitHub Pages.

## How it works

```
GitHub Actions (every 10 min) ──► scripts/parse-sessions.mjs
        fetches srfparktlv.co.il/sessions, writes data/sessions.json
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
   go full screen (F11 on most). Done — the page refreshes its own data.

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

Display text lives in **`js/strings.js`** — one English/Hebrew block per
language, so adding a third language is a third block there, nothing else.
Session names themselves (e.g. "T-Time Pro Carves") are the park's own
naming and stay in English in both languages.

Layout is direction-pinned where it matters: the reef-side cards and the
place-left chips name real pool sides, so `#hero`, `#zones` and
`.nx-places` in `css/style.css` are locked to `direction: ltr` regardless
of language — only the text inside re-flows for Hebrew. If you rename or
restructure those sections, keep that pin or the customer-reported
"Right/Left on the wrong side" bug comes back.

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
  anything about the club's markup. The parser refuses to write implausible
  output (fewer than 20 sessions), so a redesign can never blank the wall.
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
