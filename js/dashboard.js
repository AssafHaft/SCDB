/* ---------------------------------------------------------------------------
 * SRF club TV dashboard.
 * Read-only display: schedule from data/sessions.json (written by the
 * GitHub Actions parser), weather from Open-Meteo, time from the browser.
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";

  const T = window.T;
  const CONFIG = window.CONFIG;

  // ---- state ---------------------------------------------------------------
  let data = null;          // last successfully loaded sessions.json
  let dataFetchedAt = null; // Date when we last successfully fetched it
  let weather = null;       // last weather reading

  const $ = (id) => document.getElementById(id);

  // ---- time helpers --------------------------------------------------------
  const pad = (n) => String(n).padStart(2, "0");
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const todayStr = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // minutes since midnight for "HH:MM"
  const toMin = (s) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const nowMin = (d) => d.getHours() * 60 + d.getMinutes();

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
      const day = d.toLocaleDateString("en-GB", { weekday: "long" });
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

  // Next reef session, falling back to tomorrow's first.
  function nextReef(now) {
    const next = findNext(sessionsFor(todayStr(now)), now, "reef");
    if (next) return { session: next, tomorrow: false };
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const first = sessionsFor(todayStr(d))
      .filter((s) => s.zone === "reef")
      .sort((a, b) => toMin(a.start) - toMin(b.start))[0];
    return first ? { session: first, tomorrow: true } : null;
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
      time.textContent = `${current.start}–${current.end}`;
    } else if (next) {
      const n = next.places ? next.places[sideKey] : undefined;
      card.className = "zone-card is-idle";
      status.textContent = `○ ${T.noSession}`;
      program.innerHTML =
        `<span class="lvl-badge ${levelClass(next.level)}">${next.level}</span>` +
        `<span class="zone-name">${next.name}</span>`;
      places.textContent = n == null ? "" : placesText(n, next.level);
      time.textContent = `${T.nextLesson} ${next.start}`;
    } else {
      card.className = "zone-card is-idle";
      status.textContent = `○ ${T.noSession}`;
      program.textContent = "—";
      places.textContent = "";
      time.textContent = "";
    }
  }

  function render(now) {
    // clock
    $("clock").textContent = hm(now);
    $("date").textContent = now.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

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
    const reefNextInfo = nextReef(now);

    // hero: current wave program
    if (reefNow) {
      $("now-level").textContent = reefNow.level;
      $("now-level").className = "hero-badge " + levelClass(reefNow.level);
      $("now-name").textContent = reefNow.name;
      $("now-time").textContent = `${reefNow.start}–${reefNow.end}`;
      const minsLeft = toMin(reefNow.end) - nowMin(now);
      $("now-countdown").textContent = `${T.endsIn} ${minsLeft} ${T.min}`;
    } else if (reefNextInfo) {
      const s = reefNextInfo.session;
      $("now-level").textContent = s.level;
      $("now-level").className = "hero-badge " + levelClass(s.level);
      $("now-name").textContent = s.name;
      $("now-time").textContent = `${s.start}–${s.end}`;
      $("now-countdown").textContent = reefNextInfo.tomorrow
        ? `${T.startsIn} — ${s.start}`
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

    // next up strip
    if (reefNextInfo) {
      const s = reefNextInfo.session;
      $("next-body").innerHTML =
        `<span class="lvl-badge ${levelClass(s.level)}">${s.level}</span>` +
        `<span>${s.name}</span>` +
        `<span class="next-time">${reefNextInfo.tomorrow ? "Tomorrow " : ""}${s.start}–${s.end}</span>`;
    } else {
      $("next-body").textContent = "—";
    }

    // weather
    if (weather) {
      $("weather-temp").textContent = `${Math.round(weather.temp)}°`;
      $("weather-desc").textContent = weather.desc;
      $("weather-wind").textContent = `${T.wind} ${Math.round(weather.wind)} ${T.kmh}`;
    }

    // freshness note
    const upd = $("updated");
    if (data && data.updatedAt) {
      const ageMin = Math.floor((now - new Date(data.updatedAt)) / 60000);
      upd.textContent = T.updated(Math.max(ageMin, 0));
      upd.classList.toggle("stale", ageMin > CONFIG.staleWarnMinutes);
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

  const WMO = {
    0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain", 80: "Showers",
    81: "Showers", 82: "Heavy showers", 95: "Thunderstorm",
  };

  async function loadWeather() {
    try {
      const { latitude, longitude } = CONFIG.weather;
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      weather = {
        temp: j.current.temperature_2m,
        wind: j.current.wind_speed_10m,
        desc: WMO[j.current.weather_code] || "",
      };
    } catch (e) {
      console.warn("weather fetch failed:", e.message);
    }
  }

  // ---- boot ----------------------------------------------------------------
  async function start() {
    await Promise.all([loadSessions(), loadWeather()]);
    render(new Date());
    setInterval(() => render(new Date()), 1000);
    setInterval(loadSessions, CONFIG.sessionsRefreshSeconds * 1000);
    setInterval(loadWeather, CONFIG.weather.refreshMinutes * 60 * 1000);
  }

  document.addEventListener("DOMContentLoaded", start);
})();
