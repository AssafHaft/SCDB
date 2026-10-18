/* ---------------------------------------------------------------------------
 * SRF club TV dashboard.
 * Read-only display: schedule from data/sessions.json (written by the
 * GitHub Actions parser), weather from Open-Meteo, time from the browser.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  let T = window.T; // re-pointed by applyLanguage() when rotating
  const CONFIG = window.CONFIG;

  // ---- state ---------------------------------------------------------------
  let data = null;          // last successfully loaded sessions.json
  let dataFetchedAt = null; // Date when we last successfully fetched it
  let weather = null;       // last weather reading
  let eventsData = null;    // last successfully loaded events.json

  const $ = (id) => document.getElementById(id);

  // ---- time helpers --------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");

  // PM10 µg/m³ — Israel's ambient standard. A sharav dust event blows
  // straight past it; ordinary days sit far below.
  const DUST_PM10 = 130;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  // Wrap a time range in bidi isolates (LRI…PDI) so "06:00–07:00" never
  // renders reversed inside RTL text.
  const iso = (s) => "⁦" + s + "⁩";
  const todayStr = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // minutes since midnight for "HH:MM"
  const toMin = (s) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const nowMin = (d) => d.getHours() * 60 + d.getMinutes();

  // ---- 16:9 stage ----------------------------------------------------------
  // The layout is designed for 16:9. --uw/--uh are 1/100 of the largest
  // 16:9 box that fits the window (CSS falls back to 1vw/1vh), so on a
  // 16:9 TV this is a no-op and on anything else the dashboard letterboxes
  // instead of stretching.
  function sizeStage() {
    const w = Math.min(window.innerWidth, (window.innerHeight * 16) / 9);
    const h = Math.min(window.innerHeight, (window.innerWidth * 9) / 16);
    const st = document.documentElement.style;
    st.setProperty("--uw", w / 100 + "px");
    st.setProperty("--uh", h / 100 + "px");
  }

  // ---- hidden full-screen toggle -------------------------------------------
  // A transparent corner button (see #fs-toggle in the CSS) so staff can put
  // the TV browser into full screen without a keyboard. The Fullscreen API
  // only works from a real user gesture, which the click provides. Prefixed
  // variants are here because smart-TV browsers are often several years
  // behind desktop.
  function toggleFullscreen() {
    const doc = document;
    const el = doc.documentElement;
    const isFull =
      doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;
    try {
      if (isFull) {
        const exit =
          doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen;
        if (exit) exit.call(doc);
      } else {
        const req =
          el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) req.call(el);
      }
    } catch (e) {
      // Kiosk browsers may block or already be full screen; never let this
      // throw into the render loop.
      console.warn("fullscreen toggle failed:", e.message);
    }
  }

  // ---- language rotation ---------------------------------------------------
  // Wall-clock driven so every TV switches in the same second. The switch
  // itself hides behind a short opacity fade (see .lang-fade in the CSS).
  let langIdx = 0;
  let langSwitching = false;

  function desiredLangIdx(now) {
    const langs = CONFIG.languages || ["en"];
    if (langs.length < 2) return 0;
    const interval = CONFIG.languageIntervalSeconds || 30;
    return Math.floor(now.getTime() / 1000 / interval) % langs.length;
  }

  function applyLanguage(idx) {
    langIdx = idx;
    const code = (CONFIG.languages || ["en"])[idx];
    T = window.STRINGS[code] || window.STRINGS.en;
    document.documentElement.lang = code;
    document.documentElement.dir = T.dir || "ltr";
    // static labels that render() never rewrites
    $("lbl-now").textContent = T.now;
    $("lbl-next").textContent = T.nextSession;
    $("lbl-spots").textContent = T.spotsLeft;
    $("events-title").textContent = T.eventsTitle;
    document.querySelector("#zone-left .zone-title").textContent = T.left;
    document.querySelector("#zone-right .zone-title").textContent = T.right;
    document.querySelector("#zone-bay .zone-title").textContent = T.bay;
  }

  function maybeSwitchLanguage(now) {
    const want = desiredLangIdx(now);
    if (want === langIdx || langSwitching) return;
    langSwitching = true;
    document.body.classList.add("lang-fade");
    setTimeout(() => {
      applyLanguage(want);
      render(new Date());
      document.body.classList.remove("lang-fade");
      langSwitching = false;
    }, 380);
  }

  // ---- schedule lookups ----------------------------------------------------
  function sessionsFor(dateStr) {
    if (!data || !data.days) return [];
    const day = data.days.find((d) => d.date === dateStr);
    return day ? day.sessions : [];
  }

  function findCurrent(sessions, now, zone) {
    const n = nowMin(now);
    return sessions.find(
      (s) => s.zone === zone && n >= toMin(s.start) && n < toMin(s.end)
    );
  }

  function findNext(sessions, n, zone) {
    return sessions
      .filter((s) => s.zone === zone && toMin(s.start) > n)
      .sort((a, b) => toMin(a.start) - toMin(b.start))[0];
  }

  // Upcoming reef sessions in order: today's remaining, then tomorrow's.
  // One entry per time slot (specials sharing a slot with the regular
  // program are skipped — the JSON lists regulars first).
  function upcomingReef(now) {
    const out = [];
    const push = (list, tomorrow) => {
      for (const s of list) {
        if (out.length && out[out.length - 1].session.start === s.start &&
            out[out.length - 1].tomorrow === tomorrow) continue;
        out.push({ session: s, tomorrow });
      }
    };
    push(
      sessionsFor(todayStr(now))
        .filter((s) => s.zone === "reef" && toMin(s.start) > nowMin(now))
        .sort((a, b) => toMin(a.start) - toMin(b.start)),
      false
    );
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    push(
      sessionsFor(todayStr(d))
        .filter((s) => s.zone === "reef")
        .sort((a, b) => toMin(a.start) - toMin(b.start)),
      true
    );
    return out;
  }

  // ---- rendering -----------------------------------------------------------
  function levelClass(level) {
    return "lvl-" + (level || "Lx").toLowerCase();
  }

  // The club site's own rule (its sessions.js): English name when showing
  // English and the session has one, otherwise the Hebrew `name`. `side`
  // picks a reef side's own program when the two sides of a slot differ.
  function sessionName(s, side) {
    const per = side && s.sideNames && side in s.sideNames;
    const he = per ? s.sideNames[side] : s.name;
    const en = per ? (s.sideNamesEn || {})[side] : s.nameEn;
    return (T === window.STRINGS.en && en) || he;
  }

  function placesText(n, level) {
    if (n === 0) return T.full;
    if (CONFIG.capacities && CONFIG.capacities[level] != null) {
      const cap = CONFIG.capacities[level];
      return T.inWater(Math.max(cap - n, 0), cap);
    }
    return T.placesLeft(n);
  }

  function renderZone(id, current, next, sideKey, tomorrow) {
    const card = $(id);
    const status = card.querySelector(".zone-status");
    const program = card.querySelector(".zone-program");
    const places = card.querySelector(".zone-places");
    const time = card.querySelector(".zone-time");

    // Toggle only the state class — these cells carry structural classes
    // (.pool-cell) and a grid position, so overwriting className would
    // strip their layout out from under them.
    const setState = (s) => {
      card.classList.remove("is-live", "is-full", "is-idle");
      card.classList.add(s);
    };

    if (current) {
      const n = current.places ? current.places[sideKey] : undefined;
      const isFull = n === 0;
      const name = sessionName(current, sideKey);
      setState(isFull ? "is-full" : "is-live");
      status.textContent = isFull ? `● ${T.inSession} · ${T.full}` : `● ${T.inSession}`;
      program.innerHTML =
        `<span class="lvl-badge ${levelClass(current.level)}">${current.level}</span>` +
        `<span class="zone-name">${name}</span>`;
      places.textContent = n == null ? "—" : placesText(n, current.level);
      time.textContent = iso(`${current.start}–${current.end}`);
    } else if (next) {
      const n = next.places ? next.places[sideKey] : undefined;
      setState("is-idle");
      status.textContent = `○ ${T.noSession}`;
      program.innerHTML =
        `<span class="lvl-badge ${levelClass(next.level)}">${next.level}</span>` +
        `<span class="zone-name">${sessionName(next, sideKey)}</span>`;
      places.textContent = n == null ? "" : placesText(n, next.level);
      time.textContent = `${tomorrow ? T.tomorrowFull : T.nextLesson} ${iso(next.start)}`;
    } else {
      setState("is-idle");
      status.textContent = `○ ${T.noSession}`;
      program.textContent = "—";
      places.textContent = "";
      time.textContent = "";
    }
  }

  // The hero name is the largest type on the wall, and program names vary a
  // lot in length ("Pro (T2+B2)" vs "2B Or Not To Be (B2+B3) - Barrel Fest").
  // Rather than ellipsis away information a customer needs, step the size
  // down only as far as a given name actually requires — short names keep
  // the full size. Re-measured only when the text or the box changes, so
  // the once-a-second render loop doesn't thrash layout.
  const HERO_NAME_MAX = 4.2, HERO_NAME_MIN = 2.6, HERO_NAME_STEP = 0.15;
  let lastNameFit = "";
  function fitHeroName(el) {
    const key = `${el.textContent}|${el.clientWidth}`;
    if (key === lastNameFit) return;
    lastNameFit = key;
    for (let s = HERO_NAME_MAX; s >= HERO_NAME_MIN; s -= HERO_NAME_STEP) {
      el.style.fontSize = `calc(var(--uw) * ${s.toFixed(2)})`;
      if (el.scrollWidth <= el.clientWidth + 1) return;
    }
  }

  // THE LEAD. The next session is the only thing a passer-by can still act
  // on, so it owns the hero: what it is, how soon, and — the part that
  // actually converts — how many spots are left on each side.
  //
  // `asOf` is set when the schedule data is stale; the spot counts then say
  // so, because the wall must never assert a count it can't back.
  function renderHero(info, now, asOf) {
    const level = $("nx-level");
    const name = $("nx-name");
    const time = $("nx-time");
    const countdown = $("nx-countdown");
    const spots = $("nx-spots");
    const note = $("nx-note");

    spots.textContent = "";
    note.textContent = "";
    note.className = "spots-note";

    if (!info) {
      level.textContent = "";
      level.className = "hero-badge";
      name.textContent = T.noMoreToday;
      time.textContent = "";
      countdown.textContent = "";
      countdown.className = "hero-countdown";
      $("lbl-spots").style.visibility = "hidden";
      return;
    }
    $("lbl-spots").style.visibility = "";

    const s = info.session;
    level.textContent = s.level;
    level.className = "hero-badge " + levelClass(s.level);
    name.textContent = sessionName(s);
    fitHeroName(name);

    const minsAway = info.tomorrow
      ? null
      : toMin(s.start) - nowMin(now);
    time.textContent = info.tomorrow
      ? `${T.tomorrowFull} ${iso(`${s.start}–${s.end}`)}`
      : iso(`${s.start}–${s.end}`);
    countdown.textContent = minsAway == null ? "" : T.startsInShort(T.dur(minsAway));
    // Imminent sessions get the warm treatment — that's the moment a
    // last-minute sign-up is actually winnable.
    countdown.className =
      "hero-countdown" +
      (minsAway != null && minsAway <= (CONFIG.urgentMinutes || 20) ? " is-soon" : "");

    // Physical pool sides, left-to-right as the customer faces the water.
    // .spots-boxes is direction-pinned in CSS so this order never mirrors
    // in Hebrew — matches the physically-pinned .pool-grid cells below.
    const sides = [
      [T.sideLeft, s.places && s.places.left],
      [T.sideRight, s.places && s.places.right],
      [T.bay, s.places && s.places.bay],
    ].filter(([, v]) => v != null);

    for (const [side, v] of sides) {
      const box = document.createElement("div");
      box.className = "spot-box" + (v === 0 ? " is-full" : "");
      const lab = document.createElement("div");
      lab.className = "spot-side";
      lab.textContent = side;
      const val = document.createElement("div");
      val.className = "spot-count";
      val.textContent = v === 0 ? T.full : String(v);
      box.append(lab, val);
      spots.appendChild(box);
    }

    // One honest line under the counts: how to act, or why you can't.
    // The booking cutoff is judged against our own live clock — the feed's
    // `open` flag freezes that at parse time and would contradict the spot
    // counts sitting right above this line.
    const anyLeft = sides.some(([, v]) => v > 0);
    const tooLate = minsAway != null && minsAway < 1;
    if (!sides.length) {
      note.textContent = "";
    } else if (s.disabled) {
      note.textContent = T.bookingClosed;
      note.className = "spots-note is-closed";
    } else if (!anyLeft) {
      note.textContent = T.spotsFull;
      note.className = "spots-note is-closed";
    } else if (tooLate) {
      note.textContent = T.bookingClosed;
      note.className = "spots-note is-closed";
    } else if (asOf) {
      note.textContent = T.asOf(asOf);
      note.className = "spots-note is-stale";
    }
  }

  // Secondary: what's already in the water. Present tense, nothing to act
  // on, so it gets one quiet line rather than a panel.
  function renderNowStrip(current, now) {
    const body = $("now-body");
    body.textContent = "";

    if (!current) {
      body.textContent = T.nothingInWater;
      body.className = "now-body is-idle";
      return;
    }
    body.className = "now-body";

    // Order is fixed and deliberate: heading, session name, when it runs,
    // how long is left. The level badge used to sit between the heading and
    // the name, which broke that reading order; the level is already shown
    // in the pool cells directly below, so the strip does without it.
    // Time and countdown are separate elements rather than one string, so
    // each is its own bidi run and neither can reorder the other.
    const name = document.createElement("span");
    name.className = "now-name";
    name.textContent = sessionName(current);

    const time = document.createElement("span");
    time.className = "now-time";
    time.textContent = iso(`${current.start}–${current.end}`);

    const remain = document.createElement("span");
    remain.className = "now-remain";
    const minsLeft = toMin(current.end) - nowMin(now);
    remain.textContent = `${T.endsIn} ${minsLeft} ${T.min}`;

    body.append(name, time, remain);
  }

  // ---- "Upcoming Events" card ----------------------------------------------
  // Today's event is pinned in the top row; the rest of the week rolls
  // through the remaining rows on a slow crossfade (see tickEventsRotation).
  //
  // Rebuilds are gated on a signature rather than run every second: the rows
  // carry <img> thumbnails hot-linked from the club's media host, and
  // recreating them once a second would re-request the images and flicker.
  let eventsOffset = 0;      // rolling window position over the non-pinned events
  let eventsRotatable = 0;   // how many events the window rolls over
  let lastEventsSig = "";

  function upcomingEvents(now) {
    return ((eventsData && eventsData.events) || []).filter((e) => {
      // Keep an event visible until an hour past its start time.
      const dt = new Date(`${e.date}T${e.time || "23:59"}:00`);
      return !isNaN(dt) && dt.getTime() > now.getTime() - 60 * 60000;
    });
  }

  // Thumbnails are hot-linked from the club's media host. One master <img>
  // per URL is loaded once and kept out of the DOM; rows get clones of it,
  // which paint from cache instead of hitting their server again on every
  // language flip or carousel step. Clones (not the master itself) because
  // a recurring event reuses the same image, and appending one element to
  // two rows would just move it out of the first.
  // A URL that fails is remembered as broken and skipped from then on —
  // the row runs full-width text rather than showing an empty box.
  const eventImgCache = new Map();
  function eventThumb(src) {
    let rec = eventImgCache.get(src);
    if (!rec) {
      const img = document.createElement("img");
      img.alt = "";
      rec = { img, broken: false };
      img.onerror = () => { rec.broken = true; };
      img.src = src;
      eventImgCache.set(src, rec);
    }
    return rec;
  }

  // One event row: thumbnail, when-pill, title, and a line of detail.
  function buildEventRow(e, todayS, tomorrowS) {
    const row = document.createElement("div");
    row.className = "event-row" + (e.date === todayS ? " is-today" : "");

    if (e.image) {
      const rec = eventThumb(e.image);
      if (!rec.broken) {
        const thumb = document.createElement("div");
        thumb.className = "event-thumb";
        const img = rec.img.cloneNode(false);
        img.onerror = () => { rec.broken = true; thumb.remove(); };
        thumb.appendChild(img);
        row.appendChild(thumb);
      }
    }

    // Title with its description underneath. No dir="auto" here: letting
    // each string pick its own direction meant an English title inside the
    // Hebrew layout stayed left-aligned while everything around it was
    // right-aligned, which is what made rows look ragged after a language
    // switch. These inherit the page direction instead, so the whole card
    // is RTL/right-aligned in Hebrew and LTR/left-aligned in English.
    const body = document.createElement("div");
    body.className = "event-body";

    const name = document.createElement("div");
    name.className = "event-name";
    name.textContent = e.title;
    body.appendChild(name);

    if (e.details) {
      const detail = document.createElement("div");
      detail.className = "event-detail";
      detail.textContent = e.details;
      body.appendChild(detail);
    }
    row.appendChild(body);

    // When it happens, stacked at the far end of the row: day, date, time.
    // Sits opposite the thumbnail so the description keeps a readable
    // column instead of stretching the width of the card.
    const when = document.createElement("div");
    when.className = "event-when";
    const d = new Date(`${e.date}T12:00:00`);
    const dow = document.createElement("div");
    dow.className = "event-dow";
    dow.textContent =
      e.date === todayS ? T.today :
      e.date === tomorrowS ? T.tomorrow :
      T.dow(d);
    const dom = document.createElement("div");
    dom.className = "event-dom";
    dom.textContent = iso(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}`);
    when.append(dow, dom);
    if (e.time) {
      const time = document.createElement("div");
      time.className = "event-time";
      time.textContent = iso(e.time);
      when.appendChild(time);
    }
    row.appendChild(when);

    return row;
  }

  function renderEvents(now) {
    const pinnedEl = $("events-pinned");
    const rotEl = $("events-rotating");
    if (!pinnedEl || !rotEl) return;

    const todayS = todayStr(now);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowS = todayStr(tomorrow);

    const all = upcomingEvents(now);
    const slots = Math.max(CONFIG.maxEvents || 3, 1);

    // Today's event holds the top row; everything else rolls beneath it.
    const pinned = all.find((e) => e.date === todayS) || null;
    const rest = all.filter((e) => e !== pinned);
    const rotSlots = Math.max(slots - (pinned ? 1 : 0), 0);

    eventsRotatable = rest.length > rotSlots ? rest.length : 0;
    if (!eventsRotatable) eventsOffset = 0;

    const windowed = [];
    for (let i = 0; i < Math.min(rotSlots, rest.length); i++) {
      windowed.push(rest[(eventsOffset + i) % rest.length]);
    }

    const key = (e) => (e ? `${e.date}|${e.time}|${e.url}` : "-");
    const sig = [langIdx, key(pinned), ...windowed.map(key)].join("~");
    if (sig === lastEventsSig) return;   // nothing changed — leave the DOM (and its images) alone
    lastEventsSig = sig;

    pinnedEl.textContent = "";
    rotEl.textContent = "";

    if (!pinned && windowed.length === 0) {
      const empty = document.createElement("div");
      empty.className = "events-empty";
      empty.textContent = T.noEvents;
      pinnedEl.appendChild(empty);
      return;
    }

    if (pinned) pinnedEl.appendChild(buildEventRow(pinned, todayS, tomorrowS));
    for (const e of windowed) rotEl.appendChild(buildEventRow(e, todayS, tomorrowS));
  }

  // Advance the rolling window, hidden behind a fade so rows never visibly
  // pop. The pinned row is in its own container and is untouched.
  function tickEventsRotation() {
    const rotEl = $("events-rotating");
    if (!rotEl || !eventsRotatable) return;
    rotEl.classList.add("is-fading");
    setTimeout(() => {
      eventsOffset = (eventsOffset + 1) % Math.max(eventsRotatable, 1);
      renderEvents(new Date());
      rotEl.classList.remove("is-fading");
    }, 450);
  }

  function render(now) {
    // clock
    $("clock").textContent = iso(hm(now));
    $("date").textContent = T.date(now);

    const sessions = sessionsFor(todayStr(now));
    const reefNow = findCurrent(sessions, now, "reef");
    const bayNow = findCurrent(sessions, now, "bay");
    const bayToday = findNext(sessions, nowMin(now), "bay");
    const tmr = new Date(now);
    tmr.setDate(tmr.getDate() + 1);
    const bayNext = bayToday || findNext(sessionsFor(todayStr(tmr)), -1, "bay");
    const queue = upcomingReef(now);
    const reefNextInfo = queue[0] || null;

    // data freshness — drives the stale note and the places "as of" hint
    const ageMin = data && data.updatedAt
      ? Math.max(Math.floor((now - new Date(data.updatedAt)) / 60000), 0)
      : null;
    const isStale = ageMin != null && ageMin > CONFIG.staleWarnMinutes;
    const asOf = isStale ? hm(new Date(data.updatedAt)) : null;

    // the lead: the next session and its remaining spots
    renderHero(reefNextInfo, now, asOf);

    // secondary: what's in the water right now
    renderNowStrip(reefNow, now);

    // zone columns
    // After the day's last session these show tomorrow's first instead.
    const reefNext = reefNextInfo && reefNextInfo.session;
    const reefTmr = reefNextInfo && reefNextInfo.tomorrow;
    renderZone("zone-right", reefNow, reefNext, "right", reefTmr);
    renderZone("zone-left", reefNow, reefNext, "left", reefTmr);
    renderZone("zone-bay", bayNow, bayNext, "bay", !bayToday);

    // park events
    renderEvents(now);

    // weather — text resolved at render time (not fetch time) so it
    // follows the current language on every rotation. UV shows only in
    // daylight; rain and dust haze only when they matter, so on a normal
    // day the block stays three short lines.
    if (weather) {
      const w = weather;
      const warn = (s) => `<span class="wx-warn">${s}</span>`;
      const uv = Math.round(w.uv);
      const uvText = T.uv(uv, T.uvLevels[uv < 3 ? 0 : uv < 6 ? 1 : uv < 8 ? 2 : uv < 11 ? 3 : 4]);
      const sun = [[T.sunrise, w.sunrise[0]], [T.sunset, w.sunset[0]], [T.sunrise, w.sunrise[1]]]
        .find(([, t]) => t > now);
      $("weather-temp").textContent = `${Math.round(w.temp)}°`;
      $("weather-desc").textContent =
        [T.wmo[w.code], T.feelsLike(Math.round(w.feels))].filter(Boolean).join(" · ");
      // Only touch the DOM when the text actually changes — rebuilding
      // these every second would restart the icon animations each tick.
      const setHTML = (el, html) => { if (el._html !== html) el.innerHTML = el._html = html; };
      setHTML($("weather-wind"), [
        uv > 0 && (uv >= 6 ? warn(uvText) : uvText), // WHO: 6+ is "high"
        `${windIcon(w.wind)}${T.wind} ${Math.round(w.wind)} ${T.kmh}`,
      ].filter(Boolean).join(" · "));
      setHTML($("weather-extra"), [
        sun && `${horizonIcon(sun[0] === T.sunrise)}${sun[0]} ${iso(hm(sun[1]))}`,
        w.rain >= 30 && warn(T.rainChance(w.rain)),
        w.pm10 >= DUST_PM10 && warn(T.dust),
      ].filter(Boolean).join(" · "));
    }

    // freshness note
    const upd = $("updated");
    if (ageMin != null) {
      upd.textContent = isStale ? T.stale(ageMin) : T.updated(ageMin);
      upd.classList.toggle("stale", isStale);
    } else {
      upd.textContent = data ? "" : T.noData;
      upd.classList.add("stale");
    }
  }

  // ---- data fetching -------------------------------------------------------
  async function loadSessions() {
    try {
      const res = await fetch(`${CONFIG.sessionsUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      dataFetchedAt = new Date();
    } catch (e) {
      // Keep showing the last good data; the "updated X min ago" note
      // communicates staleness. Never blank the wall.
      console.warn("sessions.json fetch failed:", e.message);
    }
  }

  async function loadEvents() {
    try {
      const res = await fetch(`${CONFIG.eventsUrl}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      eventsData = await res.json();
    } catch (e) {
      // Same policy as sessions: keep the last good list on screen.
      console.warn("events.json fetch failed:", e.message);
    }
  }

  // One icon per WMO weather code, in a 64x64 box: clear, partly cloudy,
  // overcast, fog/haze, rain (drizzle, showers, and the snow codes Tel Aviv
  // never sees) and thunderstorm — moon instead of sun at night. A dust
  // event is drawn as haze. Colours come from .i-* classes in style.css;
  // motion from .a-* classes (slow on purpose — a wall, not a screensaver).
  // Animated parts are wrapped in <g> so a CSS transform never overrides a
  // shape's own transform attribute, and rotations name their pivot in
  // user units instead of relying on transform-box (older TV browsers).
  const CLOUD = "M20 48A10 10 0 0 1 19.15 28.04A13 13 0 0 1 44.38 26.02A11 11 0 1 1 45 48Z";
  const MOON = "M38 14A18 18 0 1 0 50 40A15 15 0 0 1 38 14Z";
  function weatherIcon(code, day) {
    const cloud = (t, cls = "") =>
      `<g class="a-drift ${cls}"><path class="i-cloud ${cls}" d="${CLOUD}" transform="${t}"/></g>`;
    const sun = (x, y, r) => {
      let rays = "";
      for (let i = 0; i < 8; i++) {
        const c = Math.cos(i * Math.PI / 4), s = Math.sin(i * Math.PI / 4);
        rays += `M${(x + c * (r + 5)).toFixed(1)} ${(y + s * (r + 5)).toFixed(1)}` +
                `L${(x + c * (r + 11)).toFixed(1)} ${(y + s * (r + 11)).toFixed(1)}`;
      }
      return `<circle class="i-sun" cx="${x}" cy="${y}" r="${r}"/>` +
        `<path class="i-ray a-spin" style="transform-origin:${x}px ${y}px" d="${rays}"/>`;
    };
    const moon = (t, o) =>
      `<g class="a-rock" style="transform-origin:${o}px ${o}px"><path class="i-sun" d="${MOON}" transform="${t}"/></g>`;
    const drops = [22, 33, 44].map((x, i) =>
      `<path class="i-drop a-fall" style="animation-delay:-${i * 0.4}s" d="M${x} 47L${x - 3} 56"/>`).join("");
    let g;
    if (code <= 1) g = day ? sun(32, 32, 12) : moon("", 32);
    else if (code === 2) g = (day ? sun(23, 23, 9) : moon("translate(2 2) scale(.6)", 21)) + cloud("translate(5 7)");
    else if (code === 3) g = cloud("translate(12 -5) scale(.75)", "back") + cloud("translate(-3 6)");
    else if (code <= 48) g = cloud("translate(0 -8)") +
      '<path class="i-fog a-drift" d="M12 47H48"/><path class="i-fog a-drift back" d="M20 56H56"/>';
    else if (code >= 95) g = cloud("translate(0 -6)") + '<path class="i-bolt a-flash" d="M34 40L24 53H31L27 63L40 49H33Z"/>';
    else g = cloud("translate(0 -6)") + drops;
    return `<svg viewBox="0 0 64 64">${g}</svg>`;
  }

  // Small inline symbols for the wind and sun lines (24x24, sized in em).
  // The gusts flow faster the windier it is: ~5s a loop when calm, down
  // to 1s in a strong wind.
  function windIcon(kmh) {
    const dur = Math.max(1, 5.5 - Math.round(kmh) / 8).toFixed(1);
    return `<svg class="wx-sm" viewBox="0 0 24 24"><path class="i-wind a-flow" style="animation-duration:${dur}s" ` +
      `d="M2 9H13A3 3 0 1 0 10 6M2 13H18A3 3 0 1 1 15 16M2 17H9"/></svg>`;
  }
  // Half a sun on the horizon, rising or sinking behind it.
  function horizonIcon(rise) {
    return `<svg class="wx-sm" viewBox="0 0 24 24">` +
      `<clipPath id="wx-hz"><rect width="24" height="16"/></clipPath>` +
      `<g clip-path="url(#wx-hz)"><g class="${rise ? "a-rise" : "a-set"}">` +
      `<circle class="i-sun" cx="12" cy="16" r="4.5"/>` +
      `<path class="i-ray" d="M7.4 11.4L5.6 9.6M12 9.5V7M16.6 11.4L18.4 9.6"/></g></g>` +
      `<path class="i-hz" d="M2 16H22"/></svg>`;
  }

  async function loadWeather() {
    const get = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    };
    try {
      const { latitude, longitude } = CONFIG.weather;
      const q = `latitude=${latitude}&longitude=${longitude}&timezone=auto`;
      const [f, air] = await Promise.all([
        get(`https://api.open-meteo.com/v1/forecast?${q}` +
          `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index,is_day` +
          `&daily=sunrise,sunset,precipitation_probability_max&forecast_days=2`),
        // Air quality only feeds the dust-haze note; never lose the
        // weather because this one call failed.
        get(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=pm10`)
          .catch(() => null),
      ]);
      // Sunrise/sunset come as local times with no offset, which older TV
      // browsers parse as UTC — pin them with the offset Open-Meteo reports.
      const at = (s) => new Date(Date.parse(s + "Z") - f.utc_offset_seconds * 1000);
      // Store raw values (WMO code, numbers) — render() words them in the
      // current language, so they follow language rotation.
      weather = {
        temp: f.current.temperature_2m,
        feels: f.current.apparent_temperature,
        wind: f.current.wind_speed_10m,
        uv: f.current.uv_index,
        code: f.current.weather_code,
        rain: f.daily.precipitation_probability_max[0],
        sunrise: f.daily.sunrise.map(at),
        sunset: f.daily.sunset.map(at),
        pm10: air ? air.current.pm10 : null,
      };
      // The icon doesn't depend on language, so it's drawn once per fetch.
      $("weather-icon").innerHTML = weatherIcon(
        weather.pm10 >= DUST_PM10 ? 45 : weather.code, f.current.is_day !== 0);
    } catch (e) {
      console.warn("weather fetch failed:", e.message);
    }
  }

  // ---- boot ----------------------------------------------------------------
  async function start() {
    sizeStage();
    window.addEventListener("resize", sizeStage);

    const fsBtn = $("fs-toggle");
    if (fsBtn) fsBtn.addEventListener("click", toggleFullscreen);

    // Join the rotation already in progress — every TV that boots mid-cycle
    // lands on the same language, driven off the wall clock.
    applyLanguage(desiredLangIdx(new Date()));

    await Promise.all([loadSessions(), loadEvents(), loadWeather()]);
    render(new Date());
    setInterval(() => {
      // Re-check the stage size every tick, not just on resize — belt and
      // suspenders against embedded/kiosk browsers that resize the
      // viewport without firing a real `resize` event. Two property
      // writes; effectively free.
      sizeStage();
      const now = new Date();
      maybeSwitchLanguage(now);
      render(now);
    }, 1000);
    setInterval(tickEventsRotation, (CONFIG.eventsRotateSeconds || 10) * 1000);
    setInterval(loadSessions, CONFIG.sessionsRefreshSeconds * 1000);
    setInterval(loadEvents, CONFIG.sessionsRefreshSeconds * 1000);
    setInterval(loadWeather, CONFIG.weather.refreshMinutes * 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", start);
})();
