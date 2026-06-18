(function () {
  "use strict";

  const config = window.GRADUATION_CONFIG || {};
  const defaultConfig = JSON.parse(JSON.stringify(config));
  const localKey = "graduation-invite-preview";
  const ownerTokenKey = "graduation-memory-owner-token";
  const ownedMemoryKey = "graduation-owned-memory-ids";
  const allowedNoteColors = new Set(["pastel-yellow", "pastel-blue", "pastel-mint", "pastel-pink", "pastel-peach"]);
  const maxMemoryImageLength = 1800000;
  const state = {
    rsvps: [],
    messages: [],
    memories: [],
    ownerToken: "",
    ownedMemoryIds: new Set(),
    totals: null,
    adminUnlocked: false,
    adminPassword: "",
    inlineEditMode: false,
    inlineSnapshot: null,
    confettiFrame: null,
    confettiPieces: [],
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

  function isObject(value) {
    return value && typeof value === "object" && !Array.isArray(value);
  }

  function deepMerge(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
      if (isObject(value)) {
        if (!isObject(target[key])) target[key] = {};
        deepMerge(target[key], value);
      } else {
        target[key] = value;
      }
    });
    return target;
  }

  function getPath(path) {
    return path.split(".").reduce((value, key) => (value ? value[key] : undefined), config);
  }

  function setPath(path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    const target = parts.reduce((current, key) => {
      if (/^\d+$/.test(key)) {
        return current[Number(key)];
      }
      if (!isObject(current[key]) && !Array.isArray(current[key])) current[key] = /^\d+$/.test(parts[0]) ? [] : {};
      return current[key];
    }, config);
    target[last] = value;
  }

  function setPathInObject(targetObject, path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    const target = parts.reduce((current, key, index) => {
      const nextKey = parts[index + 1] || last;
      if (/^\d+$/.test(key)) {
        return current[Number(key)];
      }
      if (current[key] === undefined) {
        current[key] = /^\d+$/.test(nextKey) ? [] : {};
      }
      return current[key];
    }, targetObject);
    target[last] = value;
  }

  function applyCurrentDefaults(savedSettings) {
    if (savedSettings?.contentVersion === defaultConfig.contentVersion) return;

    deepMerge(config, {
      contentVersion: defaultConfig.contentVersion,
      event: {
        subtitle: defaultConfig.event?.subtitle,
        locationName: defaultConfig.event?.locationName,
        address: defaultConfig.event?.address,
        googleMapsUrl: defaultConfig.event?.googleMapsUrl,
        homeLocationName: defaultConfig.event?.homeLocationName,
        homeAddress: defaultConfig.event?.homeAddress,
        homeGoogleMapsUrl: defaultConfig.event?.homeGoogleMapsUrl,
        graduationLocationName: defaultConfig.event?.graduationLocationName,
        graduationAddress: defaultConfig.event?.graduationAddress,
        graduationGoogleMapsUrl: defaultConfig.event?.graduationGoogleMapsUrl,
        statusText: defaultConfig.event?.statusText,
        note: defaultConfig.event?.note,
        inviteCopy: defaultConfig.event?.inviteCopy,
        inviteHeadline: defaultConfig.event?.inviteHeadline,
        inviteTagline: defaultConfig.event?.inviteTagline,
        inviteFooter: defaultConfig.event?.inviteFooter
      },
      assets: {
        heroImage: defaultConfig.assets?.heroImage,
        photos: defaultConfig.assets?.photos
      },
      weather: defaultConfig.weather,
      stay: defaultConfig.stay,
      food: defaultConfig.food,
      more: defaultConfig.more
    });
  }

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value === undefined || value === null ? "" : String(value);
  }

  function setHref(selector, value) {
    const node = $(selector);
    if (node) node.href = value || "#";
  }

  function mapsUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  function setHeroTitle(value) {
    const node = $("#event-title");
    if (!node) return;
    const title = String(value || "");
    const match = title.match(/^(.*?)(\s+OIT\s+.*)$/);
    const lines = match ? [match[1], match[2].trim()] : [title];
    node.textContent = "";
    lines.forEach((line, index) => {
      if (index) node.append(document.createTextNode(" "));
      const span = document.createElement("span");
      span.textContent = line;
      node.append(span);
    });
  }

  function friendlyError(error, fallback) {
    const message = `${error?.message || ""} ${error?.details || ""}`;
    if (error?.code === "PGRST205" || message.includes("Could not find the table")) {
      return "Database tables are missing. Copy/paste and run the SQL setup block first.";
    }
    if (error?.code === "PGRST202" || error?.code === "42883" || message.includes("function") || message.includes("schema cache") || message.includes("crypt")) {
      return "Database functions are missing. Copy/paste and run the updated SQL setup block first.";
    }
    return fallback;
  }

  function noteColor(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    if (allowedNoteColors.has(normalized)) return normalized;
    const fullName = `pastel-${normalized.replace(/^pastel-/, "")}`;
    return allowedNoteColors.has(fullName) ? fullName : "pastel-yellow";
  }

  function noteColorBackground(value) {
    return `var(--note-${noteColor(value).replace("pastel-", "")})`;
  }

  function guestError(fallback) {
    return fallback;
  }

  function setupError(error, setupMessage, fallback) {
    const message = `${error?.message || ""} ${error?.details || ""}`;
    if (
      error?.code === "PGRST202" ||
      error?.code === "PGRST205" ||
      /schema cache|Could not find|column|function|relation/i.test(message)
    ) {
      return setupMessage;
    }
    return fallback;
  }

  function table(name) {
    return `${config.supabase?.tablePrefix || "graduation_"}${name}`;
  }

  function shareUrl() {
    return config.links?.liveSiteUrl || window.location.href.split("#")[0];
  }

  function qrImageUrl() {
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(shareUrl())}`;
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
    setHeroTitle(event.title);
    setText("#event-kicker", event.kicker);
    setText("#event-subtitle", event.subtitle);
    setText("#event-date", event.dateText);
    setText("#event-time", event.timeText);
    setText("#event-location", event.locationName);
    setText("#event-address", event.address);
    setText("#event-status", event.statusText);
    setText("#event-note", event.note);
    setText("#quick-home-location", event.homeLocationName || "E&A's Home");
    setText("#quick-home-address", event.homeAddress || "Home address coming soon");
    setText("#quick-grad-location", event.graduationLocationName || event.locationName);
    setText("#quick-grad-address", event.graduationAddress || event.address);
    setText("#invite-copy", event.inviteCopy);
    setText("#invite-card-headline", event.inviteHeadline || "Join us to celebrate");
    setText("#invite-card-title", event.title);
    setText("#invite-card-tagline", event.inviteTagline || "OIT/OHSU Medical Laboratory Science Graduation");
    setText("#invite-card-date", event.dateText);
    setText("#invite-card-time", event.timeText);
    setText("#invite-card-location", event.graduationLocationName || event.locationName);
    setText("#invite-card-address", event.graduationAddress || event.address);
    setText("#invite-card-footer-copy", event.inviteFooter || "Scan to RSVP, get directions, leave a note, and share photos.");
    setText("#footer-title", event.title);

    setHref("#hero-map-link", event.graduationGoogleMapsUrl || event.googleMapsUrl);
    setHref("#quick-home-map-link", event.homeGoogleMapsUrl);
    setHref("#quick-grad-map-link", event.graduationGoogleMapsUrl || event.googleMapsUrl);

    if (config.assets?.heroImage) {
      $(".hero").classList.add("custom-hero");
      $("#hero-image").style.backgroundImage = `url("${config.assets.heroImage}")`;
    } else {
      $(".hero").classList.remove("custom-hero");
    }

    renderResources("#hotel-list", config.stay || []);
    renderResources("#food-list", config.food || []);
    renderResources("#more-list", config.more || []);
    renderPhotos(config.assets?.photos || []);
    hydrateShareTools();
    syncInlineInputs();
    fillEditor();
  }

  function hydrateShareTools() {
    const qr = $("#qr-image");
    if (qr) qr.src = qrImageUrl();
    const inviteQr = $("#invite-card-qr");
    if (inviteQr) inviteQr.src = qrImageUrl();
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
      state.memories = Array.isArray(stored.memories) ? stored.memories : [];
    } catch (error) {
      state.rsvps = [];
      state.messages = [];
      state.memories = [];
    }
  }

  function writeLocal() {
    localStorage.setItem(localKey, JSON.stringify({ rsvps: state.rsvps, messages: state.messages, memories: state.memories }));
  }

  function initMemoryOwner() {
    let token = localStorage.getItem(ownerTokenKey);
    if (!token) {
      token = crypto.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(ownerTokenKey, token);
    }
    state.ownerToken = token;

    try {
      const owned = JSON.parse(localStorage.getItem(ownedMemoryKey) || "[]");
      state.ownedMemoryIds = new Set(Array.isArray(owned) ? owned : []);
    } catch (error) {
      state.ownedMemoryIds = new Set();
    }
  }

  function rememberOwnedMemory(memoryId) {
    if (!memoryId) return;
    state.ownedMemoryIds.add(memoryId);
    localStorage.setItem(ownedMemoryKey, JSON.stringify([...state.ownedMemoryIds]));
  }

  function forgetOwnedMemory(memoryId) {
    state.ownedMemoryIds.delete(memoryId);
    localStorage.setItem(ownedMemoryKey, JSON.stringify([...state.ownedMemoryIds]));
  }

  async function loadSiteSettings() {
    if (!state.usingSupabase) return;

    const { data, error } = await state.supabaseClient
      .from(table("site_settings"))
      .select("settings")
      .eq("setting_key", "site")
      .maybeSingle();

    if (!error && data?.settings) {
      deepMerge(config, data.settings);
      applyCurrentDefaults(data.settings);
    }
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
      .select("id, body, note_color, created_at")
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(60);

    if (!messagesResult.error) {
      state.messages = messagesResult.data.map((row) => ({
        id: row.id,
        body: row.body,
        noteColor: noteColor(row.note_color),
        createdAt: row.created_at
      }));
    }

    const { data: memoryData, error: memoryError } = await state.supabaseClient.rpc("graduation_public_memories");
    if (!memoryError) {
      state.memories = (memoryData || []).map((row) => ({
        id: row.id,
        imageData: row.image_data,
        caption: row.caption,
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

  function resourceItems(resources) {
    if (Array.isArray(resources)) return resources;
    if (isObject(resources)) return Object.values(resources);
    return [];
  }

  function renderResources(selector, resources) {
    const list = $(selector);
    if (!list) return;
    list.innerHTML = "";
    const items = resourceItems(resources).filter((resource) =>
      resource && (resource.name || resource.address || resource.image || resource.url)
    );

    if (!items.length) {
      list.innerHTML = '<div class="empty small-empty">Add places in admin when you are ready.</div>';
      return;
    }

    items.forEach((resource) => {
      const link = document.createElement("a");
      link.className = "resource-card";
      link.href = resource.url || (resource.address ? mapsUrl(resource.address) : "#");
      link.target = "_blank";
      link.rel = "noreferrer";

      if (resource.image) {
        const image = document.createElement("img");
        image.src = resource.image;
        image.alt = "";
        image.loading = "lazy";
        link.append(image);
      }

      const copy = document.createElement("span");
      const name = document.createElement("strong");
      const meta = document.createElement("span");
      name.textContent = resource.name || "Helpful place";
      meta.textContent = resource.address || resource.meta || "Add an address in admin";
      copy.append(name, meta);

      const action = document.createElement("strong");
      action.setAttribute("aria-hidden", "true");
      action.textContent = "Map";
      link.append(copy, action);
      list.append(link);
    });
  }

  function renderPhotos(photos) {
    const grid = $("#photo-grid");
    if (!grid) return;
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

  function renderCounts() {
    const current = totals();
    setText("#count-yes", current.yes);
    setText("#count-maybe", current.maybe);
    setText("#count-no", current.no);
  }

  function renderMessages() {
    const board = $("#note-board");
    board.innerHTML = "";
    const visibleMessages = state.messages.filter((message) => !message.isHidden);
    if (!visibleMessages.length) {
      board.innerHTML = '<div class="empty">No notes yet. Be the first one to post a message.</div>';
      return;
    }

    visibleMessages.slice(0, 24).forEach((message) => {
      const note = document.createElement("article");
      const color = noteColor(message.noteColor);
      note.className = `sticky-note ${color}${message.isPending ? " is-pending" : ""}`;
      note.style.setProperty("--sticky-bg", noteColorBackground(color));
      const body = document.createElement("p");
      body.textContent = message.body;
      const time = document.createElement("time");
      time.dateTime = message.createdAt || "";
      time.textContent = message.isPending ? "Saving..." : formatDate(message.createdAt) || "Just now";
      note.append(body, time);
      board.append(note);
    });
  }

  function renderMemories() {
    const grid = $("#memory-grid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!state.memories.length) {
      grid.innerHTML = '<div class="empty">No shared memories yet.</div>';
      return;
    }

    state.memories.slice(0, 48).forEach((memory) => {
      const card = document.createElement("figure");
      card.className = "memory-card";
      const img = document.createElement("img");
      img.src = memory.imageData;
      img.alt = memory.caption || "Shared graduation memory";
      img.loading = "lazy";
      card.append(img);

      if (memory.caption) {
        const caption = document.createElement("figcaption");
        caption.textContent = memory.caption;
        card.append(caption);
      }

      if (state.ownedMemoryIds.has(memory.id)) {
        const button = document.createElement("button");
        button.className = "memory-delete";
        button.type = "button";
        button.textContent = "Delete";
        button.addEventListener("click", () => deleteMemory(memory.id, false));
        card.append(button);
      }
      grid.append(card);
    });
  }

  function renderAdmin() {
    if (!state.adminUnlocked) return;
    const current = totals();
    const mode = state.usingSupabase ? "Supabase" : "local preview storage";
    setText("#admin-summary", `${state.rsvps.length} RSVP entries. Totals: ${current.yes} yes, ${current.maybe} maybe, ${current.no} no. Data source: ${mode}.`);

    const rows = $("#admin-rsvp-rows");
    rows.innerHTML = "";
    if (!state.rsvps.length) {
      rows.innerHTML = `<tr><td colspan="5">${state.usingSupabase ? "No RSVP rows loaded yet. If guests have RSVP'd, run the Supabase admin SQL setup so this private list can load." : "No RSVPs yet."}</td></tr>`;
    } else {
      state.rsvps.forEach((rsvp) => {
        const row = document.createElement("tr");
        const name = document.createElement("td");
        name.innerHTML = "<strong></strong>";
        name.querySelector("strong").textContent = rsvp.name || "Unnamed";

        const response = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = `response-badge response-${rsvp.response || "yes"}`;
        badge.textContent = rsvp.response || "yes";
        response.append(badge);

        const party = document.createElement("td");
        party.textContent = rsvp.partyCount || "1";

        const note = document.createElement("td");
        note.textContent = rsvp.note || "";

        const updated = document.createElement("td");
        updated.textContent = formatDate(rsvp.updatedAt || rsvp.createdAt);

        row.append(name, response, party, note, updated);
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
        if (message.isHidden) item.setAttribute("aria-disabled", "true");
        item.innerHTML = '<div><p></p><time></time><span class="message-status"></span></div><button class="button quiet delete-message" type="button">Delete</button>';
        item.querySelector("p").textContent = message.body;
        item.querySelector("time").textContent = formatDate(message.createdAt);
        item.querySelector(".message-status").textContent = message.isHidden ? "Hidden" : "";
        item.querySelector(".delete-message").addEventListener("click", () => deleteMessage(message.id));
        list.append(item);
      });
    }

    const memories = $("#admin-memory-list");
    if (!memories) return;
    memories.innerHTML = "";
    if (!state.memories.length) {
      memories.innerHTML = '<div class="empty">No memory uploads yet.</div>';
    } else {
      state.memories.forEach((memory) => {
        const item = document.createElement("article");
        item.className = "admin-memory";

        const selectLabel = document.createElement("label");
        selectLabel.className = "admin-memory-check";
        const checkbox = document.createElement("input");
        checkbox.className = "admin-memory-select";
        checkbox.type = "checkbox";
        checkbox.value = memory.id;
        const selectText = document.createElement("span");
        selectText.textContent = "Select";
        selectLabel.append(checkbox, selectText);

        const image = document.createElement("img");
        image.src = memory.imageData;
        image.alt = memory.caption || "Uploaded memory";

        const copy = document.createElement("div");
        const caption = document.createElement("p");
        caption.textContent = memory.caption || "No caption";
        const time = document.createElement("time");
        time.textContent = formatDate(memory.createdAt);
        copy.append(caption, time);

        const actions = document.createElement("div");
        actions.className = "admin-memory-actions";
        const download = document.createElement("button");
        download.className = "button secondary";
        download.type = "button";
        download.textContent = "Download";
        download.addEventListener("click", () => downloadMemory(memory));
        const del = document.createElement("button");
        del.className = "button quiet delete-memory";
        del.type = "button";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteMemory(memory.id, true));
        actions.append(download, del);

        item.append(selectLabel, image, copy, actions);
        memories.append(item);
      });
    }
  }

  function fillEditor() {
    const form = $("#site-editor");
    if (!form) return;
    form.querySelectorAll("[data-setting]").forEach((field) => {
      field.value = getPath(field.dataset.setting) || "";
    });
  }

  function inlineEditFields() {
    return Array.from(document.querySelectorAll("[data-inline-setting]"));
  }

  function inlineInputFields() {
    return Array.from(document.querySelectorAll("[data-inline-input]"));
  }

  function syncInlineInputs() {
    inlineInputFields().forEach((field) => {
      field.value = getPath(field.dataset.inlineInput) || "";
    });
  }

  function setInlineEditing(enabled) {
    state.inlineEditMode = enabled;
    document.body.classList.toggle("admin-editing", enabled);

    inlineEditFields().forEach((field) => {
      field.contentEditable = enabled ? "true" : "false";
      field.spellcheck = true;
    });

    document.querySelectorAll("[data-admin-edit-panel]").forEach((panel) => {
      panel.hidden = !enabled;
    });

    const editButton = $("#toggle-page-edit");
    const saveButton = $("#save-inline-edits");
    const cancelButton = $("#cancel-inline-edits");
    if (editButton) editButton.textContent = enabled ? "Editing page" : "Edit page";
    if (saveButton) saveButton.hidden = !enabled;
    if (cancelButton) cancelButton.hidden = !enabled;

    if (enabled) {
      state.inlineSnapshot = JSON.parse(JSON.stringify(config));
      syncInlineInputs();
      setText("#editor-feedback", "Click the page text you want to edit, then save.");
    } else {
      setText("#editor-feedback", "");
    }
  }

  function collectInlineSettings() {
    const settings = {};

    inlineEditFields().forEach((field) => {
      setPathInObject(settings, field.dataset.inlineSetting, field.textContent.trim());
    });

    inlineInputFields().forEach((field) => {
      setPathInObject(settings, field.dataset.inlineInput, field.value.trim());
    });

    return settings;
  }

  function restoreInlineSnapshot() {
    if (!state.inlineSnapshot) return;
    Object.keys(config).forEach((key) => delete config[key]);
    deepMerge(config, state.inlineSnapshot);
    hydrateContent();
  }

  function collectEditorSettings() {
    const settings = {};
    const form = $("#site-editor");
    if (!form) return settings;
    form.querySelectorAll("[data-setting]").forEach((field) => {
      setPathInObject(settings, field.dataset.setting, field.value.trim());
    });
    return settings;
  }

  function renderAll() {
    renderCounts();
    renderMessages();
    renderMemories();
    renderAdmin();
  }

  function addPendingMessage(body, selectedColor) {
    const pendingId = `pending-${Date.now()}`;
    state.messages = [
      {
        id: pendingId,
        body,
        noteColor: noteColor(selectedColor),
        createdAt: new Date().toISOString(),
        isHidden: false,
        isPending: true
      },
      ...state.messages
    ];
    renderMessages();
    return pendingId;
  }

  function removePendingMessage(pendingId) {
    state.messages = state.messages.filter((message) => message.id !== pendingId);
    renderMessages();
  }

  async function saveRsvp(entry) {
    if (state.usingSupabase) {
      const payload = {
        p_guest_key: entry.guestKey,
        p_guest_name: entry.name,
        p_party_count: entry.partyCount,
        p_response: entry.response,
        p_contact: entry.contact,
        p_note: entry.note
      };
      const { error } = await state.supabaseClient.rpc("graduation_save_rsvp", payload);
      if (error) {
        const message = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
        if (/PGRST202|schema cache|Could not find the function/i.test(message)) {
          const { error: directError } = await state.supabaseClient.from(table("rsvps")).upsert(
            {
              guest_key: entry.guestKey,
              guest_name: entry.name,
              party_count: entry.partyCount,
              response: entry.response,
              contact: entry.contact || null,
              note: entry.note || null,
              updated_at: new Date().toISOString()
            },
            { onConflict: "guest_key" }
          );
          if (directError) throw error;
        } else {
          throw error;
        }
      }
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

  async function saveMessage(body, selectedColor) {
    const color = noteColor(selectedColor);
    if (state.usingSupabase) {
      const { data, error } = await state.supabaseClient
        .from(table("messages"))
        .insert({ body, is_hidden: false, note_color: color })
        .select("id, body, note_color, created_at")
        .single();
      if (error) throw error;
      if (data) {
        state.messages = [
          {
            id: data.id,
            body: data.body,
            noteColor: noteColor(data.note_color),
            createdAt: data.created_at,
            isHidden: false
          },
          ...state.messages.filter((message) => message.id !== data.id)
        ];
      }
      await loadPublicData();
      return;
    }
    state.messages.unshift({ id: crypto.randomUUID?.() || String(Date.now()), body, noteColor: color, createdAt: new Date().toISOString() });
    writeLocal();
  }

  function canvasDataUrl(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Choose an image file."));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Try a JPG, PNG, or WebP image."));
        image.onload = () => {
          const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function compressMemoryImage(file) {
    const attempts = [
      { maxEdge: 1280, quality: 0.78 },
      { maxEdge: 1000, quality: 0.72 },
      { maxEdge: 820, quality: 0.66 }
    ];
    for (const attempt of attempts) {
      const dataUrl = await canvasDataUrl(file, attempt.maxEdge, attempt.quality);
      if (dataUrl.length <= maxMemoryImageLength) return dataUrl;
    }
    throw new Error("That photo is still too big. Try a smaller image.");
  }

  async function saveMemory(file, caption) {
    const imageData = await compressMemoryImage(file);
    if (state.usingSupabase) {
      const { data, error } = await state.supabaseClient.rpc("graduation_add_memory", {
        p_owner_token: state.ownerToken,
        p_image_data: imageData,
        p_caption: caption
      });
      if (error) throw error;
      if (data?.id) rememberOwnedMemory(data.id);
      await loadPublicData();
      return;
    }

    const memory = {
      id: crypto.randomUUID?.() || String(Date.now()),
      imageData,
      caption,
      ownerToken: state.ownerToken,
      createdAt: new Date().toISOString()
    };
    state.memories.unshift(memory);
    rememberOwnedMemory(memory.id);
    writeLocal();
  }

  async function loadAdmin(password) {
    const endpoint = config.supabase?.adminEndpoint;
    if (!state.usingSupabase) return false;

    if (!endpoint) {
      const { data, error } = await state.supabaseClient.rpc("graduation_admin_list", {
        admin_password: password
      });
      if (error) throw error;
      applyAdminPayload(data || {});
      return true;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", password })
    });

    if (!response.ok) throw new Error("Admin login failed.");
    const payload = await response.json();
    applyAdminPayload(payload);
    return true;
  }

  function applyAdminPayload(payload) {
    if (payload.settings) {
      deepMerge(config, payload.settings);
      hydrateContent();
    }

    state.rsvps = (payload.rsvps || []).map((row) => ({
      id: row.id,
      guestKey: row.guest_key,
      name: row.guest_name,
      partyCount: row.party_count,
      response: row.response,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    state.messages = (payload.messages || []).map((row) => ({
      id: row.id,
      body: row.body,
      noteColor: noteColor(row.note_color),
      createdAt: row.created_at,
      isHidden: row.is_hidden
    }));
    state.memories = (payload.memories || state.memories || []).map((row) => ({
      id: row.id,
      imageData: row.image_data || row.imageData,
      caption: row.caption,
      createdAt: row.created_at || row.createdAt,
      isHidden: row.is_hidden
    }));
  }

  function publicSettingsSnapshot(overrides) {
    const snapshot = JSON.parse(
      JSON.stringify({
        contentVersion: defaultConfig.contentVersion || config.contentVersion,
        event: config.event || {},
        links: config.links || {},
        assets: config.assets || {},
        weather: config.weather || {},
        stay: config.stay || [],
        food: config.food || [],
        more: config.more || []
      })
    );
    return deepMerge(snapshot, overrides || {});
  }

  async function saveSiteSettings(settings) {
    const mergedSettings = publicSettingsSnapshot(settings);

    if (!state.usingSupabase) {
      deepMerge(config, mergedSettings);
      setText("#editor-feedback", "Edit saved successfully in this browser preview.");
      return;
    }

    const endpoint = config.supabase?.adminEndpoint;
    if (endpoint) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_settings", password: state.adminPassword, settings: mergedSettings })
      });
      if (!response.ok) throw new Error("Could not save settings.");
    } else {
      const { error } = await state.supabaseClient.rpc("graduation_admin_save_settings", {
        admin_password: state.adminPassword,
        new_settings: mergedSettings
      });
      if (error) throw error;
    }

    deepMerge(config, mergedSettings);
    hydrateContent();
    setText("#editor-feedback", "Edit saved successfully.");
    burstConfetti(120);
  }

  async function deleteMessage(messageId) {
    if (!messageId) return;
    try {
      if (state.usingSupabase) {
        const endpoint = config.supabase?.adminEndpoint;
        if (endpoint) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_message", password: state.adminPassword, messageId })
          });
          if (!response.ok) throw new Error("Could not delete message.");
        } else {
          const { error } = await state.supabaseClient.rpc("graduation_admin_delete_message", {
            admin_password: state.adminPassword,
            message_id: messageId
          });
          if (error) throw error;
        }
        await loadAdmin(state.adminPassword);
      } else {
        state.messages = state.messages.filter((message) => message.id !== messageId);
        writeLocal();
      }
      setText("#admin-feedback", "Message deleted.");
      renderAll();
    } catch (error) {
      console.error(error);
      setText("#admin-feedback", friendlyError(error, "Could not delete that message yet."));
    }
  }

  async function deleteMemory(memoryId, adminMode) {
    if (!memoryId) return;
    try {
      if (state.usingSupabase) {
        if (adminMode) {
          const endpoint = config.supabase?.adminEndpoint;
          if (endpoint) {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete_memory", password: state.adminPassword, memoryId })
            });
            if (!response.ok) throw new Error("Could not delete memory.");
          } else {
            const { error } = await state.supabaseClient.rpc("graduation_admin_delete_memory", {
              admin_password: state.adminPassword,
              memory_id: memoryId
            });
            if (error) throw error;
          }
          await loadAdmin(state.adminPassword);
        } else {
          const { error } = await state.supabaseClient.rpc("graduation_delete_memory", {
            p_owner_token: state.ownerToken,
            memory_id: memoryId
          });
          if (error) throw error;
          forgetOwnedMemory(memoryId);
          await loadPublicData();
        }
      } else {
        state.memories = state.memories.filter((memory) => memory.id !== memoryId);
        forgetOwnedMemory(memoryId);
        writeLocal();
      }
      setText(adminMode ? "#admin-feedback" : "#memory-feedback", "Memory deleted.");
      renderAll();
    } catch (error) {
      console.error(error);
      setText(adminMode ? "#admin-feedback" : "#memory-feedback", adminMode ? friendlyError(error, "Could not delete that memory yet.") : guestError("Could not delete that memory from this phone."));
    }
  }

  function safeFileName(value, fallback) {
    const safe = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42);
    return safe || fallback;
  }

  function downloadMemory(memory) {
    if (!memory?.imageData) return;
    const link = document.createElement("a");
    const name = safeFileName(memory.caption, "graduation-memory");
    link.href = memory.imageData;
    link.download = `${name}-${String(memory.id || Date.now()).slice(0, 8)}.jpg`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function selectedMemories() {
    const ids = new Set(Array.from(document.querySelectorAll(".admin-memory-select:checked")).map((input) => input.value));
    return state.memories.filter((memory) => ids.has(String(memory.id)));
  }

  function downloadMemoryBatch(memories) {
    if (!memories.length) {
      setText("#admin-feedback", "Select at least one photo first.");
      return;
    }
    memories.forEach((memory, index) => {
      window.setTimeout(() => downloadMemory(memory), index * 180);
    });
    setText("#admin-feedback", `${memories.length} photo download${memories.length === 1 ? "" : "s"} started.`);
  }

  async function shareQrCode() {
    const url = shareUrl();
    try {
      if (navigator.share) {
        await navigator.share({
          title: config.event?.title || "Graduation invitation",
          text: "Elizabeth & Angela's graduation invitation",
          url
        });
        setText("#qr-feedback", "Shared.");
        return;
      }
      await navigator.clipboard.writeText(url);
      setText("#qr-feedback", "Link copied.");
    } catch (error) {
      console.warn(error);
      setText("#qr-feedback", url);
    }
  }

  function escapeXml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function svgTextLines(value, maxChars, maxLines) {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\.+$/, "")}...`;
      return kept;
    }
    return lines;
  }

  function svgTextBlock({ text, x, y, maxChars, maxLines, size, weight = 700, fill = "#17212b", anchor = "middle", lineHeight = 1.12, family = "Space Grotesk, Manrope, Arial, sans-serif" }) {
    const lines = svgTextLines(text, maxChars, maxLines);
    const tspans = lines
      .map((line, index) => `<tspan x="${x}" dy="${index ? size * lineHeight : 0}">${escapeXml(line)}</tspan>`)
      .join("");
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not prepare the QR code."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  }

  async function inviteQrDataUrl() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(qrImageUrl(), { mode: "cors", signal: controller.signal });
      if (!response.ok) throw new Error("QR request failed.");
      return await blobToDataUrl(await response.blob());
    } catch (error) {
      console.warn(error);
      return qrImageUrl();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function invitationSvg(qrHref) {
    const event = config.event || {};
    const title = event.title || "Elizabeth & Angela's OIT MLS Graduation";
    const headline = event.inviteHeadline || "Join us to celebrate";
    const tagline = event.inviteTagline || "OIT/OHSU Medical Laboratory Science Graduation";
    const date = event.dateText || "December 2026";
    const time = event.timeText || "Time TBA";
    const place = event.graduationLocationName || event.locationName || "Graduation at OHSU";
    const address = event.graduationAddress || event.address || "OHSU, Portland, OR";
    const footer = event.inviteFooter || "Scan to RSVP, get directions, leave a note, and share photos.";

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1200" viewBox="0 0 1800 1200">
  <defs>
    <linearGradient id="cardBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f8fbfd"/>
      <stop offset="0.53" stop-color="#e8f2f7"/>
      <stop offset="1" stop-color="#eef7f0"/>
    </linearGradient>
    <linearGradient id="bluePanel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#001f3f"/>
      <stop offset="1" stop-color="#003767"/>
    </linearGradient>
    <linearGradient id="scienceGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f1c75f"/>
      <stop offset="1" stop-color="#d9a21a"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#0a1f33" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="1800" height="1200" fill="url(#cardBg)"/>
  <path d="M0 0 H1120 L1010 1200 H0 Z" fill="url(#bluePanel)"/>
  <rect x="0" y="0" width="300" height="18" fill="#003767"/>
  <rect x="300" y="0" width="300" height="18" fill="#d9a21a"/>
  <rect x="600" y="0" width="300" height="18" fill="#0038a8"/>
  <rect x="900" y="0" width="300" height="18" fill="#ce1126"/>
  <rect x="1200" y="0" width="300" height="18" fill="#fffaf0"/>
  <rect x="1500" y="0" width="300" height="18" fill="#009246"/>
  <rect x="0" y="1182" width="300" height="18" fill="#003767"/>
  <rect x="300" y="1182" width="300" height="18" fill="#d9a21a"/>
  <rect x="600" y="1182" width="300" height="18" fill="#0038a8"/>
  <rect x="900" y="1182" width="300" height="18" fill="#ce1126"/>
  <rect x="1200" y="1182" width="300" height="18" fill="#fffaf0"/>
  <rect x="1500" y="1182" width="300" height="18" fill="#009246"/>

  <g opacity="0.15" stroke="#ffffff" fill="none">
    <circle cx="210" cy="235" r="118" stroke-width="8"/>
    <path d="M300 310 L520 456" stroke-width="16" stroke-linecap="round"/>
    <circle cx="550" cy="170" r="38" stroke-width="8"/>
    <path d="M512 170 H588 M550 132 V208" stroke-width="8" stroke-linecap="round"/>
    <path d="M770 170 h170 M812 170 v118 M898 170 v118 M790 288 h150" stroke-width="10" stroke-linecap="round"/>
  </g>
  <g opacity="0.18" stroke="#003767">
    <path d="M1160 100 H1710 M1160 165 H1710 M1160 230 H1710 M1160 295 H1710 M1160 360 H1710 M1160 425 H1710 M1160 490 H1710 M1160 555 H1710 M1160 620 H1710 M1160 685 H1710 M1160 750 H1710 M1160 815 H1710 M1160 880 H1710" stroke-width="2"/>
    <path d="M1195 70 V930 M1260 70 V930 M1325 70 V930 M1390 70 V930 M1455 70 V930 M1520 70 V930 M1585 70 V930 M1650 70 V930" stroke-width="2"/>
  </g>
  <g opacity="0.32">
    <circle cx="1380" cy="165" r="68" fill="#d9a21a"/>
    <circle cx="1576" cy="272" r="34" fill="#ce1126"/>
    <circle cx="1238" cy="840" r="46" fill="#0038a8"/>
    <circle cx="1660" cy="868" r="28" fill="#009246"/>
  </g>
  <g opacity="0.36" stroke="#d9a21a" fill="none" stroke-width="4">
    <ellipse cx="1395" cy="170" rx="156" ry="44" transform="rotate(-22 1395 170)"/>
    <ellipse cx="1395" cy="170" rx="156" ry="44" transform="rotate(22 1395 170)"/>
    <circle cx="1395" cy="170" r="16" fill="#d9a21a" stroke="none"/>
  </g>

  <text x="120" y="130" font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="36" font-weight="700" fill="#d9a21a">OIT / OHSU MLS</text>
  ${svgTextBlock({ text: headline.toUpperCase(), x: 120, y: 245, maxChars: 27, maxLines: 1, size: 62, weight: 800, fill: "#ffffff", anchor: "start", family: "Chakra Petch, Space Grotesk, Arial, sans-serif" })}
  ${svgTextBlock({ text: title, x: 120, y: 390, maxChars: 25, maxLines: 2, size: 98, weight: 800, fill: "#ffffff", anchor: "start", lineHeight: 1.02 })}
  ${svgTextBlock({ text: tagline, x: 124, y: 635, maxChars: 48, maxLines: 2, size: 36, weight: 800, fill: "#d7e8f5", anchor: "start", family: "Manrope, Arial, sans-serif" })}

  <g font-family="Manrope, Arial, sans-serif" filter="url(#softShadow)">
    <rect x="120" y="755" width="425" height="180" rx="26" fill="#ffffff" opacity="0.95"/>
    <rect x="585" y="755" width="440" height="180" rx="26" fill="#ffffff" opacity="0.95"/>
    <text x="155" y="820" font-size="28" font-weight="900" fill="#d9a21a">WHEN</text>
    <text x="155" y="880" font-size="42" font-weight="900" fill="#17212b">${escapeXml(date)}</text>
    <text x="155" y="928" font-size="30" font-weight="800" fill="#5c6874">${escapeXml(time)}</text>
    <text x="620" y="820" font-size="28" font-weight="900" fill="#d9a21a">WHERE</text>
    ${svgTextBlock({ text: place, x: 620, y: 880, maxChars: 19, maxLines: 2, size: 34, weight: 900, fill: "#17212b", anchor: "start", family: "Manrope, Arial, sans-serif" })}
    ${svgTextBlock({ text: address, x: 620, y: 970, maxChars: 28, maxLines: 2, size: 25, weight: 800, fill: "#5c6874", anchor: "start", family: "Manrope, Arial, sans-serif" })}
  </g>

  <g filter="url(#softShadow)">
    <rect x="1175" y="122" width="505" height="880" rx="42" fill="#ffffff" opacity="0.94"/>
    <rect x="1175" y="122" width="505" height="14" fill="url(#scienceGold)"/>
    <text x="1428" y="232" text-anchor="middle" font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="42" font-weight="700" fill="#003767">SCAN FOR RSVP</text>
    <text x="1428" y="288" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="28" font-weight="800" fill="#5c6874">directions | notes | photos</text>
    <rect x="1303" y="380" width="250" height="250" rx="24" fill="#ffffff" stroke="#d7e0e8" stroke-width="4"/>
    <image x="1323" y="400" width="210" height="210" href="${escapeXml(qrHref)}" preserveAspectRatio="xMidYMid meet"/>
    ${svgTextBlock({ text: footer, x: 1245, y: 720, maxChars: 25, maxLines: 4, size: 31, weight: 800, fill: "#003767", anchor: "start", family: "Manrope, Arial, sans-serif" })}
    <text x="1428" y="927" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="24" font-weight="900" fill="#5c6874">${escapeXml(shareUrl())}</text>
  </g>
</svg>`;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadInvitationSvg() {
    setText("#invite-download-feedback", "Preparing invite...");
    const svg = invitationSvg(await inviteQrDataUrl());
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "elizabeth-angela-graduation-invite.svg");
    setText("#invite-download-feedback", "SVG invite downloaded.");
  }

  async function downloadInvitationPng() {
    setText("#invite-download-feedback", "Preparing print-ready image...");
    const svg = invitationSvg(await inviteQrDataUrl());
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1800;
      canvas.height = 1200;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          setText("#invite-download-feedback", "Could not create the PNG yet. Try SVG.");
          return;
        }
        downloadBlob(blob, "elizabeth-angela-graduation-invite.png");
        setText("#invite-download-feedback", "PNG invite downloaded.");
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setText("#invite-download-feedback", "Could not create the PNG yet. Try SVG.");
    };
    image.src = url;
  }

  async function printInvitationCard() {
    setText("#invite-download-feedback", "Opening print card...");
    const svg = invitationSvg(await inviteQrDataUrl());
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const printWindow = window.open(url, "_blank");
    if (!printWindow) {
      setText("#invite-download-feedback", "Popup blocked. Download PNG or SVG instead.");
      URL.revokeObjectURL(url);
      return;
    }
    window.setTimeout(() => {
      try {
        printWindow.print();
      } catch (error) {
        console.warn(error);
      }
      URL.revokeObjectURL(url);
    }, 900);
    setText("#invite-download-feedback", "Print card opened.");
  }

  function bindForms() {
    $("#rsvp-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const name = String(data.get("guestName") || "").trim();
      try {
        await saveRsvp({
          guestKey: guestKey(name, ""),
          name,
          partyCount: Math.max(1, Number(data.get("partyCount") || 1)),
          response: String(data.get("response") || "yes"),
          contact: "",
          note: String(data.get("note") || "").trim()
        });
        setText("#rsvp-feedback", "RSVP saved. Submit again with the same name if plans change.");
        renderAll();
        burstConfetti(90);
      } catch (error) {
        console.error(error);
        setText("#rsvp-feedback", guestError(setupError(error, "RSVP needs the Supabase SQL setup first. Run the RSVP setup block, then refresh.", "Could not save that RSVP yet. Try again in a minute.")));
      }
    });

    $("#message-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const body = String(data.get("body") || "").trim();
      const selectedColor = String(data.get("noteColor") || "pastel-yellow");
      if (!body) return;
      const pendingId = addPendingMessage(body, selectedColor);
      setText("#message-feedback", "Loading note, please hold...");
      try {
        await saveMessage(body, selectedColor);
        removePendingMessage(pendingId);
        $("#message-body").value = "";
        setText("#message-feedback", "Your caring note is on the board.");
        renderAll();
        burstConfetti(70);
      } catch (error) {
        console.error(error);
        removePendingMessage(pendingId);
        setText(
          "#message-feedback",
          guestError(setupError(error, "Notes need the Supabase SQL update first. Run the setup block, then refresh.", "That note did not stick yet. Try again in a minute."))
        );
      }
    });

    $("#memory-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const file = data.get("memoryImage");
      const caption = String(data.get("caption") || "").trim().slice(0, 100);
      if (!(file instanceof File) || !file.size) return;
      try {
        setText("#memory-feedback", "Uploading memory...");
        await saveMemory(file, caption);
        form.reset();
        setText("#memory-feedback", "Memory added to the strip.");
        renderAll();
        burstConfetti(100);
      } catch (error) {
        console.error(error);
        const message = String(error?.message || "");
        const setupMissing = /function|schema cache|graduation_add_memory|PGRST202/i.test(message);
        const knownImageIssue = /Choose an image file|Could not read that image|JPG|PNG|WebP|too big|smaller image/i.test(message);
        const safeMessage = setupMissing
          ? "Memory uploads need the Supabase SQL update first. Run the memory setup block, then refresh."
          : knownImageIssue
          ? message
          : "Could not upload that memory yet. Try again in a minute.";
        setText("#memory-feedback", guestError(safeMessage));
      }
    });

    $("#admin-login").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = $("#admin-password").value.trim();
      const adminPassword = config.admin?.previewPassword || "cats";
      if (password !== adminPassword) {
        setText("#admin-feedback", "Wrong password.");
        return;
      }

      state.adminUnlocked = true;
      state.adminPassword = password;
      $("#admin-password").value = "";
      $("#admin-dashboard").hidden = false;
      document.body.classList.add("admin-unlocked");
      syncInlineInputs();
      fillEditor();

      try {
        await loadAdmin(password);
        setText("#admin-feedback", "Admin unlocked.");
      } catch (error) {
        console.error(error);
        const detail = friendlyError(error, "Private RSVP/photo data needs the Supabase SQL setup before it can load.");
        setText("#admin-feedback", `Admin unlocked. ${detail}`);
      }
      renderAll();
    });

    const siteEditor = $("#site-editor");
    if (siteEditor) {
      siteEditor.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          await saveSiteSettings(collectEditorSettings());
        } catch (error) {
          console.error(error);
          setText("#editor-feedback", friendlyError(error, "Could not save edits yet."));
        }
      });
    }

    $("#toggle-page-edit").addEventListener("click", () => {
      setInlineEditing(!state.inlineEditMode);
    });

    $("#save-inline-edits").addEventListener("click", async () => {
      try {
        await saveSiteSettings(collectInlineSettings());
        setInlineEditing(false);
        setText("#admin-feedback", "Page edits saved.");
      } catch (error) {
        console.error(error);
        setText("#editor-feedback", friendlyError(error, "Could not save edits yet."));
      }
    });

    $("#cancel-inline-edits").addEventListener("click", () => {
      restoreInlineSnapshot();
      setInlineEditing(false);
      setText("#admin-feedback", "Page edits canceled.");
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
      const headers = ["name", "response", "party_count", "note", "updated_at"];
      const lines = [
        headers.join(","),
        ...state.rsvps.map((rsvp) =>
          [rsvp.name, rsvp.response, rsvp.partyCount, rsvp.note, rsvp.updatedAt || rsvp.createdAt]
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

    $("#download-selected-memories").addEventListener("click", () => {
      downloadMemoryBatch(selectedMemories());
    });

    $("#download-all-memories").addEventListener("click", () => {
      downloadMemoryBatch(state.memories);
    });

    $("#share-qr-button").addEventListener("click", shareQrCode);
    $("#download-invite-png").addEventListener("click", downloadInvitationPng);
    $("#download-invite-svg").addEventListener("click", downloadInvitationSvg);
    $("#print-invite-card").addEventListener("click", printInvitationCard);
  }

  async function loadWeather() {
    const settings = config.weather || {};
    if (settings.live === false) {
      setText("#weather-place", settings.label || "Portland-Metro / Wilsonville");
      setText("#weather-temp", settings.placeholderTemp || "Cloud icon");
      setText("#weather-summary", settings.placeholderSummary || "Graduation-week forecast coming soon");
      setText("#weather-extra", settings.placeholderExtra || "Weather will be updated during the week of graduation.");
      return;
    }
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

  function initConfetti() {
    const button = $("#celebrate-button");
    if (button) {
      button.addEventListener("click", () => burstConfetti(150));
    }
  }

  function startAutoRefresh() {
    if (!state.usingSupabase) return;

    const refresh = async () => {
      try {
        await loadPublicData();
        renderCounts();
        renderMessages();
        renderMemories();
      } catch (error) {
        console.warn("Auto-refresh skipped.", error);
      }
    };

    window.setInterval(refresh, 8000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }

  function burstConfetti(amount) {
    const canvas = $("#confetti-canvas");
    if (!canvas) return;
    const colors = ["#003767", "#f4b400", "#ce1126", "#ffffff", "#0038a8", "#009246", "#d62828", "#ffd166"];
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    for (let index = 0; index < amount; index += 1) {
      state.confettiPieces.push({
        x: width * 0.5 + (Math.random() - 0.5) * Math.min(width, 360),
        y: height * 0.18 + Math.random() * 90,
        vx: (Math.random() - 0.5) * 9,
        vy: Math.random() * -8 - 3,
        gravity: Math.random() * 0.25 + 0.16,
        drag: 0.985,
        size: Math.random() * 8 + 5,
        spin: Math.random() * 0.25,
        angle: Math.random() * Math.PI,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 180
      });
    }

    if (!state.confettiFrame) animateConfetti();
  }

  function animateConfetti() {
    const canvas = $("#confetti-canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    state.confettiPieces = state.confettiPieces.filter((piece) => {
      piece.vx *= piece.drag;
      piece.vy = piece.vy * piece.drag + piece.gravity;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.angle += piece.spin;
      piece.life -= 1;

      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.angle);
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 3, piece.size, piece.size * 0.65);
      context.restore();

      return piece.life > 0 && piece.y < canvas.height + 40;
    });

    if (state.confettiPieces.length) {
      state.confettiFrame = requestAnimationFrame(animateConfetti);
    } else {
      state.confettiFrame = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  async function boot() {
    initMemoryOwner();
    initSupabase();
    await loadSiteSettings();
    hydrateContent();
    await loadPublicData();
    bindForms();
    initConfetti();
    startAutoRefresh();
    renderAll();
    loadWeather();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
