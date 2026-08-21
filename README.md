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
  that turns warm inside `urgentMinutes`, and big per-side spot counts. It
  is the tallest row on the screen, and both hero columns use
  `justify-content: space-between` so the panel fills its height instead of
  floating in empty teal.
  The session name is auto-fitted by `fitHeroName()` in `js/dashboard.js`:
  short names stay at full size and only unusually long ones step down, so
  a program title is never ellipsised away on the wall.
- **The current session gets one quiet line** (`#now-strip`). Visible, never
  competing.
- **The pool sits in one compact box** (`#pool-box`): Reef Left and Reef
  Right side by side as they are in the water, Bay spanning underneath.
  It's a status readout, so it takes about a third of the width.
- **Upcoming Events** is the widest card in that row and carries thumbnails
  (hot-linked from the club's media host) plus a line of detail. Today's
  event is pinned in the top row; the rest of the week rolls through the
  remaining rows on a slow crossfade — `eventsRotateSeconds` in
  `js/config.js`. Rows only rebuild when the visible set actually changes,
  so the carousel never re-requests images.

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
  these languages (keys into `window.STRINGS`, currently `en` and `he`)
  every 60 seconds, wall-clock-timed so every TV switches in the same
  second. Set `languages` to a single entry to stop rotating and stay on
  one language.
- `showSignupCta` — the "Sign up at reception" line under the spot counts.
  Set `false` to hide it; reword it per language via `signupCta` in
  `js/strings.js` (e.g. if sign-ups move to an app or a different desk).
- `urgentMinutes` — how close a session must be for the countdown to switch
  to the warm/urgent treatment. Default 20.

Display text lives in **`js/strings.js`** — one English/Hebrew block per
language, so adding a third language is a third block there, nothing else.
Session names themselves (e.g. "T-Time Pro Carves") are the park's own
naming and stay in English in both languages.

Layout is direction-pinned where it matters: the reef-side cells and the
spot boxes name real pool sides, so `#hero`, `#zones`, `.pool-grid` and
`.spots-boxes` in `css/style.css` are locked to `direction: ltr` regardless
of language — only the text inside re-flows for Hebrew. If you rename or
restructure those sections, keep that pin or the customer-reported
"Right/Left on the wrong side" bug comes back.

The pool cells are laid out by `.pool-grid` (2 columns, Bay spanning both).
`renderZone()` toggles only the `is-live` / `is-full` / `is-idle` class on
them — it must never assign `className`, which would strip the structural
`.pool-cell` class and drop the cell out of the grid.

Two deliberate exceptions to "pinned containers keep their text RTL in
Hebrew":

- `#now-strip` stays `direction: ltr` in both languages. Its label is the
  heading for the pool box directly beneath it, which sits on the left; in
  RTL it would swing to the right edge, away from what it describes.
- `.event-when` stays `ltr` so `21.08` / `20:00` read correctly either way.

Everything else must follow the page direction. Do **not** put `dir="auto"`
on event titles or descriptions: it lets each string pick its own direction,
so an English title inside the Hebrew layout stays left-aligned while its
neighbours are right-aligned, and rows look ragged after a language switch.
`.pool-cell` is flipped explicitly for the same reason — `.pool-grid` above
it is pinned `ltr`, and the cells would otherwise inherit that.

The dashboard is laid out as a fixed 16:9 "stage" (`#stage` in
`index.html`, sized by `sizeStage()` in `js/dashboard.js`), so it matches a
16:9 wall TV pixel-for-pixel and letterboxes — rather than stretching —
on any other screen, including this repo's own preview tooling.

**Everything must fit inside that stage — nothing scrolls on a wall.** The
zone-card row is `minmax(0, 1fr)`, not `1fr`: a bare `1fr` keeps an
implicit `auto` minimum, so one over-tall card (the events list is the
usual culprit) refuses to shrink and shoves the whole grid off the bottom
of the screen. That is precisely how the cards once ended up visibly cut
off. The cards also carry `min-height: 0` and `overflow: hidden` as a
backstop. If you add content to a card, re-check the bottom edge at
1920x1080 rather than trusting it to wrap.

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
  event list. Note it matches the whole `.box`, not just `.event_content`,
  because the thumbnail lives in a sibling `.event_img`.
- **Event thumbnails missing, text still fine** — the images are hot-linked
  from `api.srfparktlv.co.il`. If that host blocks or fails, each row drops
  its thumbnail and runs full-width text; nothing else breaks. This is
  deliberate: the events card is never worth failing the wall over.
- **Weather panel empty** — Open-Meteo hiccup; it retries every 10 minutes
  on its own.

## Notes

- GitHub Actions cron is best-effort; runs can be delayed a few minutes at
  busy times. The schedule only changes on the hour, so this doesn't matter.
- The `*/10 3-20 * * *` schedule covers park hours in Israel time (UTC+2/+3).
  Adjust in `.github/workflows/update-sessions.yml` if hours change.
