(function () {
  "use strict";

  const config = window.GRADUATION_CONFIG || {};
  const localKey = "graduation-invite-preview";
  const state = {
    rsvps: [],
    messages: [],
    totals: null,
    adminUnlocked: false,
    supabaseClient: null,
    usingSupabase: false
  };

  const weatherCodes = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Heavy drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Rain showers",
    82: "Heavy showers",
    95: "Thunderstorms"
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value === undefined || value === null ? "" : String(value);
  }

  function table(name) {
    return `${config.supabase?.tablePrefix || "graduation_"}${name}`;
  }

  function shareUrl() {
    return config.links?.liveSiteUrl || window.location.href.split("#")[0];
  }

  function formatDate(value) {
    if (!value) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return "";
    }
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function guestKey(name, contact) {
    const base = `${normalize(name)}|${normalize(contact)}`;
    let hash = 0;
    for (let index = 0; index < base.length; index += 1) {
      hash = (hash << 5) - hash + base.charCodeAt(index);
      hash |= 0;
    }
    return `guest_${Math.abs(hash)}`;
  }

  function hydrateContent() {
    const event = config.event || {};
    document.title = event.title || document.title;
    setText("#event-title", event.title);
    setText("#event-kicker", event.kicker);
    setText("#event-subtitle", event.subtitle);
    setText("#event-date", event.dateText);
    setText("#event-time", event.timeText);
    setText("#event-location", event.locationName);
    setText("#event-address", event.address);
    setText("#event-status", event.statusText);
    setText("#event-note", event.note);
    setText("#visit-location", event.locationName);
    setText("#visit-address", event.address);
    setText("#invite-copy", event.inviteCopy);
    setText("#footer-title", event.title);

    $("#hero-map-link").href = event.googleMapsUrl || "#";
    $("#visit-map-link").href = event.googleMapsUrl || "#";

    if (config.assets?.heroImage) {
      $("#hero-image").style.backgroundImage = `url("${config.assets.heroImage}")`;
    }

    if (config.assets?.invitationImage) {
      const image = $("#invite-image");
      image.src = config.assets.invitationImage;
      image.hidden = false;
      $("#invite-placeholder").hidden = true;
    }

    renderResources("#hotel-list", config.stay || []);
    renderResources("#food-list", config.food || []);
    renderPhotos(config.assets?.photos || []);
    renderQr();
  }

  function initSupabase() {
    const settings = config.supabase || {};
    if (settings.enabled && settings.url && settings.anonKey && window.supabase) {
      state.usingSupabase = true;
      state.supabaseClient = window.supabase.createClient(settings.url, settings.anonKey);
    }
  }

  function readLocal() {
    try {
      const stored = JSON.parse(localStorage.getItem(localKey) || "{}");
      state.rsvps = Array.isArray(stored.rsvps) ? stored.rsvps : [];
      state.messages = Array.isArray(stored.messages) ? stored.messages : [];
    } catch (error) {
      state.rsvps = [];
      state.messages = [];
    }
  }

  function writeLocal() {
    localStorage.setItem(localKey, JSON.stringify({ rsvps: state.rsvps, messages: state.messages }));
  }

  async function loadPublicData() {
    if (!state.usingSupabase) {
      readLocal();
      state.totals = null;
      return;
    }

    const totalsResult = await state.supabaseClient.from(table("rsvp_totals")).select("*");
    if (!totalsResult.error) {
      state.totals = { yes: 0, maybe: 0, no: 0 };
      totalsResult.data.forEach((row) => {
        state.totals[row.response] = Number(row.total || 0);
      });
    }

    const messagesResult = await state.supabaseClient
      .from(table("messages"))
      .select("id, body, created_at")
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(60);

    if (!messagesResult.error) {
      state.messages = messagesResult.data.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at
      }));
    }
  }

  function totals() {
    if (state.totals) return state.totals;
    return state.rsvps.reduce(
      (sum, rsvp) => {
        const response = rsvp.response || "yes";
        const count = Math.max(1, Number(rsvp.partyCount || 1));
        sum[response] += response === "no" ? 1 : count;
        return sum;
      },
      { yes: 0, maybe: 0, no: 0 }
    );
  }

  function renderResources(selector, resources) {
    const list = $(selector);
    list.innerHTML = "";
    resources.forEach((resource) => {
      const link = document.createElement("a");
      link.className = "resource-card";
      link.href = resource.url || "#";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.innerHTML = `<span><strong></strong><span></span></span><strong aria-hidden="true">Open</strong>`;
      link.querySelector("strong").textContent = resource.name || "Nearby option";
      link.querySelector("span span").textContent = resource.meta || "Open search";
      list.append(link);
    });
  }

  function renderPhotos(photos) {
    const grid = $("#photo-grid");
    grid.innerHTML = "";
    if (!photos.length) {
      grid.innerHTML = '<div class="empty">Add photo paths in config.js when ready.</div>';
      return;
    }
    photos.forEach((photo) => {
      const card = document.createElement("figure");
      card.className = "photo-card";
      const img = document.createElement("img");
      img.src = photo.src;
      img.alt = photo.alt || "Graduation photo";
      img.loading = "lazy";
      card.append(img);
      grid.append(card);
    });
  }

  function renderQr() {
    const url = shareUrl();
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=16&data=${encodeURIComponent(url)}`;
    $("#qr-image").src = qr;
    $("#share-url").value = url;
    $("#qr-link").href = qr;
  }

  function renderCounts() {
    const current = totals();
    setText("#count-yes", current.yes);
    setText("#count-maybe", current.maybe);
    setText("#count-no", current.no);
  }

  function renderMessages() {
    const board = $("#note-board");
    board.innerHTML = "";
    if (!state.messages.length) {
      board.innerHTML = '<div class="empty">No notes yet. Be the first one to post a message.</div>';
      return;
    }

    state.messages.slice(0, 24).forEach((message) => {
      const note = document.createElement("article");
      note.className = "sticky-note";
      const body = document.createElement("p");
      body.textContent = message.body;
      const time = document.createElement("time");
      time.dateTime = message.createdAt || "";
      time.textContent = formatDate(message.createdAt) || "Just now";
      note.append(body, time);
      board.append(note);
    });
  }

  function renderAdmin() {
    if (!state.adminUnlocked) return;
    const current = totals();
    const mode = state.usingSupabase ? "Supabase" : "local preview storage";
    setText("#admin-summary", `${current.yes} yes, ${current.maybe} maybe, ${current.no} no. Data source: ${mode}.`);

    const rows = $("#admin-rsvp-rows");
    rows.innerHTML = "";
    if (!state.rsvps.length) {
      rows.innerHTML = `<tr><td colspan="6">${state.usingSupabase ? "Add the admin Edge Function URL in config.js to read private RSVP rows." : "No RSVPs yet."}</td></tr>`;
    } else {
      state.rsvps.forEach((rsvp) => {
        const row = document.createElement("tr");
        [rsvp.name, rsvp.response, rsvp.partyCount, rsvp.contact, rsvp.note, formatDate(rsvp.updatedAt || rsvp.createdAt)].forEach((value) => {
          const cell = document.createElement("td");
          cell.textContent = value || "";
          row.append(cell);
        });
        rows.append(row);
      });
    }

    const list = $("#admin-message-list");
    list.innerHTML = "";
    if (!state.messages.length) {
      list.innerHTML = '<div class="empty">No messages yet.</div>';
    } else {
      state.messages.forEach((message) => {
        const item = document.createElement("article");
        item.className = "admin-message";
        item.innerHTML = "<p></p><time></time>";
        item.querySelector("p").textContent = message.body;
        item.querySelector("time").textContent = formatDate(message.createdAt);
        list.append(item);
      });
    }
  }

  function renderAll() {
    renderCounts();
    renderMessages();
    renderAdmin();
  }

  async function saveRsvp(entry) {
    if (state.usingSupabase) {
      const now = new Date().toISOString();
      const { error } = await state.supabaseClient.from(table("rsvps")).upsert(
        {
          guest_key: entry.guestKey,
          guest_name: entry.name,
          party_count: entry.partyCount,
          response: entry.response,
          contact: entry.contact,
          note: entry.note,
          updated_at: now
        },
        { onConflict: "guest_key" }
      );
      if (error) throw error;
      await loadPublicData();
      return;
    }

    const now = new Date().toISOString();
    const index = state.rsvps.findIndex((rsvp) => rsvp.guestKey === entry.guestKey);
    if (index >= 0) {
      state.rsvps[index] = { ...state.rsvps[index], ...entry, updatedAt: now };
    } else {
      state.rsvps.unshift({ id: crypto.randomUUID?.() || String(Date.now()), ...entry, createdAt: now, updatedAt: now });
    }
    writeLocal();
  }

  async function saveMessage(body) {
    if (state.usingSupabase) {
      const { error } = await state.supabaseClient.from(table("messages")).insert({ body, is_hidden: false });
      if (error) throw error;
      await loadPublicData();
      return;
    }
    state.messages.unshift({ id: crypto.randomUUID?.() || String(Date.now()), body, createdAt: new Date().toISOString() });
    writeLocal();
  }

  async function loadAdmin(password) {
    const endpoint = config.supabase?.adminEndpoint;
    if (!state.usingSupabase || !endpoint) return false;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", password })
    });

    if (!response.ok) throw new Error("Admin login failed.");
    const payload = await response.json();
    state.rsvps = (payload.rsvps || []).map((row) => ({
      id: row.id,
      guestKey: row.guest_key,
      name: row.guest_name,
      partyCount: row.party_count,
      response: row.response,
      contact: row.contact,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    state.messages = (payload.messages || []).map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: row.created_at
    }));
    return true;
  }

  function bindForms() {
    $("#rsvp-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const name = String(data.get("guestName") || "").trim();
      const contact = String(data.get("contact") || "").trim();
      try {
        await saveRsvp({
          guestKey: guestKey(name, contact),
          name,
          partyCount: Math.max(1, Number(data.get("partyCount") || 1)),
          response: String(data.get("response") || "yes"),
          contact,
          note: String(data.get("note") || "").trim()
        });
        setText("#rsvp-feedback", "RSVP saved. Submit again with the same name if plans change.");
        renderAll();
      } catch (error) {
        console.error(error);
        setText("#rsvp-feedback", "Could not save RSVP yet. Check Supabase setup and try again.");
      }
    });

    $("#message-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = String(new FormData(event.currentTarget).get("body") || "").trim();
      if (!body) return;
      try {
        await saveMessage(body);
        event.currentTarget.reset();
        setText("#message-feedback", "Anonymous note posted.");
        renderAll();
      } catch (error) {
        console.error(error);
        setText("#message-feedback", "Could not post the note yet. Check Supabase setup and try again.");
      }
    });

    $("#admin-login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = $("#admin-password").value;
      try {
        const usedEndpoint = await loadAdmin(password);
        if (!usedEndpoint && password !== (config.admin?.previewPassword || "cats")) {
          setText("#admin-feedback", "Wrong password.");
          return;
        }
        state.adminUnlocked = true;
        $("#admin-dashboard").hidden = false;
        setText("#admin-feedback", "Admin unlocked.");
        renderAll();
      } catch (error) {
        console.error(error);
        setText("#admin-feedback", "Admin login failed.");
      }
    });

    $("#clear-demo-data").addEventListener("click", () => {
      if (state.usingSupabase) {
        setText("#admin-feedback", "Clear is only for local preview storage.");
        return;
      }
      state.rsvps = [];
      state.messages = [];
      writeLocal();
      renderAll();
    });

    $("#export-rsvps").addEventListener("click", () => {
      const headers = ["name", "response", "party_count", "contact", "note", "updated_at"];
      const lines = [
        headers.join(","),
        ...state.rsvps.map((rsvp) =>
          [rsvp.name, rsvp.response, rsvp.partyCount, rsvp.contact, rsvp.note, rsvp.updatedAt || rsvp.createdAt]
            .map((value) => `"${String(value || "").replace(/"/g, '""')}"`)
            .join(",")
        )
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "graduation-rsvps.csv";
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  async function loadWeather() {
    const settings = config.weather || {};
    if (!settings.latitude || !settings.longitude) return;
    setText("#weather-place", settings.label || "Weather");
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", settings.latitude);
    url.searchParams.set("longitude", settings.longitude);
    url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m");
    url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("forecast_days", "1");

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Weather request failed.");
      const payload = await response.json();
      const current = payload.current || {};
      const daily = payload.daily || {};
      setText("#weather-temp", `${Math.round(current.temperature_2m)} F`);
      setText("#weather-summary", weatherCodes[current.weather_code] || "Current conditions");
      setText(
        "#weather-extra",
        `Feels like ${Math.round(current.apparent_temperature)} F. High ${Math.round(daily.temperature_2m_max?.[0])} F, low ${Math.round(daily.temperature_2m_min?.[0])} F. Rain/snow chance ${daily.precipitation_probability_max?.[0] || 0}%.`
      );
    } catch (error) {
      setText("#weather-temp", "--");
      setText("#weather-summary", "Weather unavailable");
      setText("#weather-extra", "The live forecast will load when the page can reach Open-Meteo.");
    }
  }

  async function boot() {
    hydrateContent();
    initSupabase();
    await loadPublicData();
    bindForms();
    renderAll();
    loadWeather();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
