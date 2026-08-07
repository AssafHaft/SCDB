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
    $("lbl-next").textContent = T.nextUp;
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

  // Hero right side: the next reef session, with places left per side —
  // the question customers ask most. When the schedule data is stale,
  // `asOf` carries the data's own timestamp ("13:44") and the places label
  // quietly says so — the wall must never assert a count it can't back.
  function renderHeroNext(info, now, asOf) {
    const level = $("nx-level");
    const name = $("nx-name");
    const time = $("nx-time");
    const places = $("nx-places");

    places.textContent = "";
    if (!info) {
      level.textContent = "";
      level.className = "lvl-badge";
      name.textContent = "—";
      time.textContent = "";
      return;
    }

    const s = info.session;
    level.textContent = s.level;
    level.className = "lvl-badge " + levelClass(s.level);
    name.textContent = s.name;
    const range = iso(`${s.start}–${s.end}`);
    time.textContent = info.tomorrow
      ? `${T.tomorrowFull} ${range}`
      : `${range} · ${T.inDur(T.dur(toMin(s.start) - nowMin(now)))}`;

    // Physical pool sides, left-to-right as the customer faces the water.
    // .nx-places is direction-pinned in CSS so this order never mirrors
    // in Hebrew — matches the physically-pinned #zones cards below.
    const sides = [
      [T.sideLeft, s.places && s.places.left],
      [T.sideRight, s.places && s.places.right],
    ].filter(([, v]) => v != null);
    if (sides.length) {
      const lab = document.createElement("span");
      lab.className = "nx-places-label";
      lab.textContent = T.placesLabel;
      if (asOf) {
        const note = document.createElement("span");
        note.className = "nx-asof";
        note.textContent = ` · ${T.asOf(asOf)}`;
        lab.appendChild(note);
      }
      places.appendChild(lab);
      for (const [side, v] of sides) {
        const chip = document.createElement("span");
        chip.className = "place-chip" + (v === 0 ? " is-full" : "");
        chip.textContent = v === 0 ? `${side} · ${T.full}` : `${side} · ${v}`;
        places.appendChild(chip);
      }
    }
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

      const when = document.createElement("div");
      when.className = "event-when";
      const dow = document.createElement("div");
      dow.className = "event-dow";
      const d = new Date(`${e.date}T12:00:00`);
      dow.textContent =
        e.date === todayS ? T.today :
        e.date === tomorrowS ? T.tomorrow :
        T.dow(d);
      const dom = document.createElement("div");
      dom.className = "event-dom";
      dom.textContent = iso(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}`);
      when.append(dow, dom);

      const info = document.createElement("div");
      info.className = "event-info";
      const name = document.createElement("div");
      name.className = "event-name";
      name.dir = "auto"; // Hebrew titles lay out correctly
      name.textContent = e.title;
      const time = document.createElement("div");
      time.className = "event-time";
      time.textContent = iso(e.time);
      info.append(name, time);

      row.append(when, info);
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

    // hero: current wave program
    if (reefNow) {
      $("now-level").textContent = reefNow.level;
      $("now-level").className = "hero-badge " + levelClass(reefNow.level);
      $("now-name").textContent = reefNow.name;
      $("now-time").textContent = iso(`${reefNow.start}–${reefNow.end}`);
      const minsLeft = toMin(reefNow.end) - nowMin(now);
      $("now-countdown").textContent = `${T.endsIn} ${minsLeft} ${T.min}`;
    } else if (reefNextInfo) {
      const s = reefNextInfo.session;
      $("now-level").textContent = s.level;
      $("now-level").className = "hero-badge " + levelClass(s.level);
      $("now-name").textContent = s.name;
      $("now-time").textContent = iso(`${s.start}–${s.end}`);
      $("now-countdown").textContent = reefNextInfo.tomorrow
        ? `${T.startsIn} — ${iso(s.start)}`
        : `${T.startsIn} ${toMin(s.start) - nowMin(now)} ${T.min}`;
    } else {
      $("now-level").textContent = "";
      $("now-name").textContent = T.noData;
      $("now-time").textContent = "";
      $("now-countdown").textContent = "";
    }

    // zone columns
    renderZone("zone-right", reefNow, reefNextInfo && !reefNextInfo.tomorrow ? reefNextInfo.session : null, "right");
    renderZone("zone-left", reefNow, reefNextInfo && !reefNextInfo.tomorrow ? reefNextInfo.session : null, "left");
    renderZone("zone-bay", bayNow, bayNext, "bay");

    // park events
    renderEvents(now);

    // hero right side: next up. When nothing is running, the hero's main
    // slot already shows queue[0] ("Starts in …"), so show the one after.
    renderHeroNext((reefNow ? queue[0] : queue[1]) || null, now, asOf);

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
