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

  // ---- operating hours -----------------------------------------------------
  function openState(now) {
    const hours = CONFIG.operatingHours[now.getDay()];
    if (hours && nowMin(now) >= toMin(hours.open) && nowMin(now) < toMin(hours.close)) {
      return { open: true };
    }
    // find next opening
    for (let i = 0; i < 8; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const h = CONFIG.operatingHours[d.getDay()];
      if (!h) continue;
      if (i === 0 && nowMin(now) >= toMin(h.close)) continue; // already closed today
      if (i === 0) return { open: false, label: T.opensAt(h.open) };
      if (i === 1) return { open: false, label: T.opensTomorrow(h.open) };
      const day = d.toLocaleDateString(T.locale, { weekday: "long" });
      return { open: false, label: T.opensOn(day, h.open) };
    }
    return { open: false, label: "" };
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

  function findNext(sessions, now, zone) {
    const n = nowMin(now);
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

  function placesText(n, level) {
    if (n === 0) return T.full;
    if (CONFIG.capacities && CONFIG.capacities[level] != null) {
      const cap = CONFIG.capacities[level];
      return T.inWater(Math.max(cap - n, 0), cap);
    }
    return T.placesLeft(n);
  }

  function renderZone(id, current, next, sideKey) {
    const card = $(id);
    const status = card.querySelector(".zone-status");
    const program = card.querySelector(".zone-program");
    const places = card.querySelector(".zone-places");
    const time = card.querySelector(".zone-time");

    if (current) {
      const n = current.places ? current.places[sideKey] : undefined;
      const isFull = n === 0;
      const name = (current.sideNames && current.sideNames[sideKey]) || current.name;
      card.className = "zone-card " + (isFull ? "is-full" : "is-live");
      status.textContent = isFull ? `● ${T.inSession} · ${T.full}` : `● ${T.inSession}`;
      program.innerHTML =
        `<span class="lvl-badge ${levelClass(current.level)}">${current.level}</span>` +
        `<span class="zone-name">${name}</span>`;
      places.textContent = n == null ? "—" : placesText(n, current.level);
      time.textContent = iso(`${current.start}–${current.end}`);
    } else if (next) {
      const n = next.places ? next.places[sideKey] : undefined;
      card.className = "zone-card is-idle";
      status.textContent = `○ ${T.noSession}`;
      program.innerHTML =
        `<span class="lvl-badge ${levelClass(next.level)}">${next.level}</span>` +
        `<span class="zone-name">${next.name}</span>`;
      places.textContent = n == null ? "" : placesText(n, next.level);
      time.textContent = `${T.nextLesson} ${iso(next.start)}`;
    } else {
      card.className = "zone-card is-idle";
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
    name.textContent = s.name;
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
    // in Hebrew — matches the physically-pinned #zones cards below.
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

    const badge = document.createElement("span");
    badge.className = "lvl-badge " + levelClass(current.level);
    badge.textContent = current.level;

    const name = document.createElement("span");
    name.className = "now-name";
    name.textContent = current.name;

    const meta = document.createElement("span");
    meta.className = "now-meta";
    const minsLeft = toMin(current.end) - nowMin(now);
    meta.textContent =
      `${iso(`${current.start}–${current.end}`)} · ${T.endsIn} ${minsLeft} ${T.min}`;

    body.append(badge, name, meta);
  }

  // "Upcoming Events" card: the next few park events. Built with DOM nodes (not
  // innerHTML) because titles come from an external page.
  function renderEvents(now) {
    const list = $("events-list");
    if (!list) return;

    const upcoming = ((eventsData && eventsData.events) || [])
      .filter((e) => {
        // Keep an event visible until an hour past its start time.
        const dt = new Date(`${e.date}T${e.time || "23:59"}:00`);
        return !isNaN(dt) && dt.getTime() > now.getTime() - 60 * 60000;
      })
      .slice(0, CONFIG.maxEvents || 4);

    list.textContent = "";
    if (upcoming.length === 0) {
      const empty = document.createElement("div");
      empty.className = "events-empty";
      empty.textContent = T.noEvents;
      list.appendChild(empty);
      return;
    }

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const todayS = todayStr(now);
    const tomorrowS = todayStr(tomorrow);

    for (const e of upcoming) {
      const row = document.createElement("div");
      row.className = "event-row" + (e.date === todayS ? " is-today" : "");

      // One-line "when" pill: day, date and start time together, so the
      // row stays short enough for the card to fit the screen.
      const when = document.createElement("span");
      when.className = "event-when";
      const dow = document.createElement("span");
      dow.className = "event-dow";
      const d = new Date(`${e.date}T12:00:00`);
      dow.textContent =
        e.date === todayS ? T.today :
        e.date === tomorrowS ? T.tomorrow :
        T.dow(d);
      const dom = document.createElement("span");
      dom.className = "event-dom";
      dom.textContent = iso(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}`);
      when.append(dow, dom);
      if (e.time) {
        const time = document.createElement("span");
        time.className = "event-time";
        time.textContent = iso(e.time);
        when.appendChild(time);
      }

      const name = document.createElement("div");
      name.className = "event-name";
      name.dir = "auto"; // Hebrew titles lay out correctly
      name.textContent = e.title;

      row.append(when, name);
      list.appendChild(row);
    }
  }

  function render(now) {
    // clock
    $("clock").textContent = iso(hm(now));
    $("date").textContent = T.date(now);

    // open / closed
    const state = openState(now);
    document.body.classList.toggle("closed", !state.open);
    if (!state.open) {
      $("closed-sub").textContent = state.label || "";
      $("closed-clock").textContent = hm(now);
      return;
    }

    const sessions = sessionsFor(todayStr(now));
    const reefNow = findCurrent(sessions, now, "reef");
    const bayNow = findCurrent(sessions, now, "bay");
    const bayNext = findNext(sessions, now, "bay");
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
    renderZone("zone-right", reefNow, reefNextInfo && !reefNextInfo.tomorrow ? reefNextInfo.session : null, "right");
    renderZone("zone-left", reefNow, reefNextInfo && !reefNextInfo.tomorrow ? reefNextInfo.session : null, "left");
    renderZone("zone-bay", bayNow, bayNext, "bay");

    // park events
    renderEvents(now);

    // weather — description resolved at render time (not fetch time) so
    // it follows the current language on every rotation.
    if (weather) {
      $("weather-temp").textContent = `${Math.round(weather.temp)}°`;
      $("weather-desc").textContent = T.wmo[weather.code] || "";
      $("weather-wind").textContent = `${T.wind} ${Math.round(weather.wind)} ${T.kmh}`;
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

  async function loadWeather() {
    try {
      const { latitude, longitude } = CONFIG.weather;
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      // Store the raw WMO code — render() looks up the description in the
      // current language's T.wmo table, so it follows language rotation.
      weather = {
        temp: j.current.temperature_2m,
        wind: j.current.wind_speed_10m,
        code: j.current.weather_code,
      };
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
    setInterval(loadSessions, CONFIG.sessionsRefreshSeconds * 1000);
    setInterval(loadEvents, CONFIG.sessionsRefreshSeconds * 1000);
    setInterval(loadWeather, CONFIG.weather.refreshMinutes * 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", start);
})();
