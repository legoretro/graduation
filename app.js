(function () {
  "use strict";

  const config = window.GRADUATION_CONFIG || {};
  const defaultConfig = JSON.parse(JSON.stringify(config));
  const localKey = "graduation-invite-preview";
  const ownerTokenKey = "graduation-memory-owner-token";
  const ownedMemoryKey = "graduation-owned-memory-ids";
  const ownedRsvpKey = "graduation-owned-rsvp-cache";
  const deletedRsvpPrefix = "__deleted__";
  const allowedNoteColors = new Set(["pastel-yellow", "pastel-blue", "pastel-mint", "pastel-pink", "pastel-peach"]);
  const resourceGroups = [
    { key: "stay", label: "Hotels" },
    { key: "food", label: "Food" },
    { key: "more", label: "More" }
  ];
  const heicConverterUrl = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
  const maxMemoryImageLength = 1800000;
  const maxPlaceImageLength = 650000;
  let heicConverterPromise = null;
  const state = {
    rsvps: [],
    publicRsvps: [],
    ownedRsvps: [],
    messages: [],
    memories: [],
    ownerToken: "",
    ownedMemoryIds: new Set(),
    ownedRsvpPanelOpen: false,
    openRsvpGroup: "",
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
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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
        graduationLocationName: defaultConfig.event?.graduationLocationName,
        graduationAddress: defaultConfig.event?.graduationAddress,
        graduationGoogleMapsUrl: defaultConfig.event?.graduationGoogleMapsUrl,
        homeLocationName: defaultConfig.event?.homeLocationName,
        homeAddress: defaultConfig.event?.homeAddress,
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

  function normalizeMapQuery(address) {
    return String(address || "")
      .trim()
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b(Dr|Drive|Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Way)\s+(Portland|Wilsonville|Beaverton|Hillsboro|Tigard|Klamath|Salem|Eugene)\b/gi, "$1, $2")
      .replace(/\s+/g, " ");
  }

  function mapsUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalizeMapQuery(address))}`;
  }

  function graduationMapUrl(event) {
    const address = event.graduationAddress || event.address || event.graduationLocationName || event.locationName || "OHSU Portland OR";
    return mapsUrl(address);
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

  function missingSupabaseFunction(error) {
    const message = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
    return /PGRST202|42883|schema cache|Could not find the function/i.test(message);
  }

  function isHeicFile(file) {
    const type = String(file?.type || "").toLowerCase();
    const name = String(file?.name || "").toLowerCase();
    return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/i.test(name);
  }

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (window.heic2any) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load the HEIC converter."));
      document.head.append(script);
    });
  }

  async function heicConverter() {
    if (window.heic2any) return window.heic2any;
    if (!heicConverterPromise) {
      heicConverterPromise = loadScriptOnce(heicConverterUrl).then(() => {
        if (!window.heic2any) throw new Error("Could not start the HEIC converter.");
        return window.heic2any;
      });
    }
    return heicConverterPromise;
  }

  async function canvasReadyImage(file, feedbackSelector) {
    if (!isHeicFile(file)) return file;
    setText(feedbackSelector, "Converting HEIC photo...");
    const convert = await heicConverter();
    const result = await convert({ blob: file, toType: "image/jpeg", quality: 0.86 });
    const blob = Array.isArray(result) ? result[0] : result;
    if (!blob) throw new Error("Could not convert that HEIC photo.");
    try {
      return new File([blob], String(file.name || "photo.heic").replace(/\.(heic|heif)$/i, ".jpg"), {
        type: blob.type || "image/jpeg"
      });
    } catch (error) {
      return new Blob([blob], { type: blob.type || "image/jpeg" });
    }
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
    setText("#quick-grad-location", event.graduationLocationName || event.locationName);
    setText("#quick-grad-address", normalizeMapQuery(event.graduationAddress || event.address));
    setText("#home-place-name", event.homeLocationName || "Elizabeth & Angela's Place");
    setText("#home-place-address", normalizeMapQuery(event.homeAddress));
    setText("#invite-copy", event.inviteCopy);
    setText("#invite-card-headline", event.inviteHeadline || "Join us to celebrate");
    setText("#invite-card-title", event.title);
    setText("#invite-card-tagline", event.inviteTagline || "OIT/OHSU Medical Laboratory Science Graduation");
    setText("#invite-card-date", event.dateText);
    setText("#invite-card-time", event.timeText);
    setText("#invite-card-location", event.graduationLocationName || event.locationName);
    setText("#invite-card-address", normalizeMapQuery(event.graduationAddress || event.address));
    setText("#invite-card-footer-copy", event.inviteFooter || "Scan to RSVP, get directions, leave a note, and share photos.");
    setText("#footer-title", event.title);

    const gradMapUrl = graduationMapUrl(event);
    setHref("#hero-map-link", gradMapUrl);
    setHref("#quick-grad-map-link", gradMapUrl);
    setHref("#home-place-map-link", mapsUrl(event.homeAddress || event.homeLocationName));

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

  function normalizeRsvp(row) {
    return {
      id: row.id || "",
      guestKey: row.guest_key || row.guestKey || "",
      name: row.guest_name || row.name || "Unnamed",
      partyCount: Math.max(1, Number(row.party_count || row.partyCount || 1)),
      response: row.response || "yes",
      updatedAt: row.updated_at || row.updatedAt || row.created_at || row.createdAt || "",
      createdAt: row.created_at || row.createdAt || row.updated_at || row.updatedAt || ""
    };
  }

  function isDeletedRsvp(row) {
    const name = String(row?.guest_name || row?.name || "").trim().toLowerCase();
    return name.startsWith(deletedRsvpPrefix);
  }

  function visibleRsvps(rows) {
    return (rows || []).filter((row) => !isDeletedRsvp(row));
  }

  function totalsFromRsvps(rows) {
    return visibleRsvps(rows).reduce(
      (sum, rsvp) => {
        const response = rsvp.response || "yes";
        const count = Math.max(1, Number(rsvp.partyCount || rsvp.party_count || 1));
        sum[response] += response === "no" ? 1 : count;
        return sum;
      },
      { yes: 0, maybe: 0, no: 0 }
    );
  }

  function syncPublicTotals() {
    state.totals = totalsFromRsvps(state.publicRsvps);
  }

  function upsertPublicRsvp(rsvp) {
    if (!rsvp?.name) return;
    if (isDeletedRsvp(rsvp)) {
      state.publicRsvps = state.publicRsvps.filter((item) => {
        if (rsvp.id && item.id === rsvp.id) return false;
        if (rsvp.guestKey && item.guestKey === rsvp.guestKey) return false;
        return true;
      });
      syncPublicTotals();
      return;
    }
    const publicRsvp = normalizeRsvp(rsvp);
    state.publicRsvps = [
      publicRsvp,
      ...state.publicRsvps.filter((item) => {
        if (publicRsvp.id && item.id === publicRsvp.id) return false;
        if (publicRsvp.guestKey && item.guestKey === publicRsvp.guestKey) return false;
        return item.name.trim().toLowerCase() !== publicRsvp.name.trim().toLowerCase();
      })
    ];
    syncPublicTotals();
  }

  function readOwnedRsvpCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(ownedRsvpKey) || "[]");
      return Array.isArray(cached)
        ? cached
            .filter((rsvp) => rsvp.ownerToken === state.ownerToken)
            .map((rsvp) => ({ ...normalizeRsvp(rsvp), note: rsvp.note || "", ownerToken: rsvp.ownerToken || state.ownerToken }))
        : [];
    } catch (error) {
      return [];
    }
  }

  function writeOwnedRsvpCache(items) {
    localStorage.setItem(ownedRsvpKey, JSON.stringify(items.slice(0, 20)));
  }

  function forgetOwnedRsvp(rsvp) {
    const id = typeof rsvp === "string" ? rsvp : rsvp?.id;
    const guestKey = typeof rsvp === "string" ? "" : rsvp?.guestKey;
    const name = typeof rsvp === "string" ? "" : normalize(rsvp?.name);
    const keep = (item) => {
      if (id && item.id === id) return false;
      if (guestKey && item.guestKey === guestKey) return false;
      if (name && normalize(item.name) === name) return false;
      return true;
    };
    state.ownedRsvps = state.ownedRsvps.filter(keep);
    writeOwnedRsvpCache(readOwnedRsvpCache().filter(keep));
  }

  function cacheOwnedRsvp(rsvp) {
    if (!rsvp?.name) return;
    if (isDeletedRsvp(rsvp)) return;
    const cached = readOwnedRsvpCache().filter((item) => {
      if (rsvp.id && item.id === rsvp.id) return false;
      if (rsvp.guestKey && item.guestKey === rsvp.guestKey) return false;
      return item.name.trim().toLowerCase() !== rsvp.name.trim().toLowerCase();
    });
    const saved = {
      ...normalizeRsvp(rsvp),
      note: rsvp.note || "",
      ownerToken: rsvp.ownerToken || state.ownerToken
    };
    state.ownedRsvps = [saved, ...cached];
    writeOwnedRsvpCache(state.ownedRsvps);
  }

  function localOwnedRsvps() {
    return visibleRsvps(state.rsvps).filter((rsvp) => rsvp.ownerToken === state.ownerToken);
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
      state.publicRsvps = visibleRsvps(state.rsvps).map(normalizeRsvp);
      syncPublicTotals();
      state.ownedRsvps = localOwnedRsvps();
      return;
    }

    syncPublicTotals();

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

    const { data: publicRsvpData, error: publicRsvpError } = await state.supabaseClient.rpc("graduation_public_rsvps");
    if (!publicRsvpError) {
      state.publicRsvps = visibleRsvps(publicRsvpData || []).map(normalizeRsvp);
      syncPublicTotals();
    } else if (!missingSupabaseFunction(publicRsvpError)) {
      console.error(publicRsvpError);
    } else {
      syncPublicTotals();
    }
  }

  async function loadOwnedRsvps() {
    if (!state.ownerToken) return [];
    if (!state.usingSupabase) {
      state.ownedRsvps = localOwnedRsvps();
      return state.ownedRsvps;
    }

    const { data, error } = await state.supabaseClient.rpc("graduation_owned_rsvps", {
      p_owner_token: state.ownerToken
    });
    if (error) {
      if (missingSupabaseFunction(error)) {
        state.ownedRsvps = readOwnedRsvpCache();
        return state.ownedRsvps;
      }
      throw error;
    }
    state.ownedRsvps = visibleRsvps(data || []).map((row) => ({
      id: row.id,
      guestKey: row.guest_key,
      name: row.guest_name,
      partyCount: row.party_count,
      response: row.response,
      ownerToken: row.owner_token,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ownerToken: state.ownerToken
    }));
    writeOwnedRsvpCache(state.ownedRsvps);
    return state.ownedRsvps;
  }

  function totals() {
    return state.totals || totalsFromRsvps(state.publicRsvps.length ? state.publicRsvps : state.rsvps);
  }

  function resourceItems(resources) {
    if (Array.isArray(resources)) return resources;
    if (isObject(resources)) return Object.values(resources);
    return [];
  }

  function resourceGroupLabel(key) {
    return resourceGroups.find((group) => group.key === key)?.label || "Places";
  }

  function normalizeResourceGroup(value) {
    const key = String(value || "").trim().toLowerCase();
    return resourceGroups.some((group) => group.key === key) ? key : "more";
  }

  function cleanResource(resource) {
    return {
      name: String(resource?.name || "").trim(),
      address: normalizeMapQuery(resource?.address || ""),
      image: String(resource?.image || "").trim(),
      url: String(resource?.url || "").trim()
    };
  }

  function publicResourceItems(key) {
    return resourceItems(config[key] || []).map(cleanResource).filter((resource) =>
      resource.name || resource.address || resource.image || resource.url
    );
  }

  function renderResources(selector, resources) {
    const list = $(selector);
    if (!list) return;
    list.innerHTML = "";
    const items = resourceItems(resources).filter((resource) =>
      resource && (resource.name || resource.address || resource.image || resource.url)
    );

    if (!items.length) {
      list.innerHTML = '<div class="empty small-empty">Coming soon.</div>';
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
      action.textContent = "Go to maps";
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
    $$(".count-card").forEach((button) => {
      const active = button.dataset.rsvpFilter === state.openRsvpGroup;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-expanded", String(active));
    });
    renderPublicRsvps();
  }

  function renderPublicRsvps() {
    const list = $("#rsvp-public-list");
    if (!list) return;
    const response = state.openRsvpGroup;
    if (!response) {
      list.hidden = true;
      list.innerHTML = "";
      return;
    }

    const label = response === "yes" ? "Yes" : response === "maybe" ? "Maybe" : "No";
    const names = state.publicRsvps
      .filter((rsvp) => (rsvp.response || "yes") === response)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    list.hidden = false;
    list.innerHTML = "";

    const heading = document.createElement("h3");
    heading.textContent = `${label} RSVPs`;
    list.append(heading);

    if (!names.length) {
      const empty = document.createElement("div");
      empty.className = "empty small-empty";
      empty.textContent = state.publicRsvps.length ? `No ${label.toLowerCase()} RSVPs yet.` : "No names to show yet.";
      list.append(empty);
      return;
    }

    const people = document.createElement("div");
    people.className = "public-rsvp-people";
    names.forEach((rsvp) => {
      const person = document.createElement("article");
      person.className = `public-rsvp-person public-rsvp-${response}`;

      const name = document.createElement("strong");
      name.textContent = rsvp.name || "Unnamed";

      const meta = document.createElement("span");
      const count = Math.max(1, Number(rsvp.partyCount || 1));
      meta.textContent = response === "no" ? "Not attending" : `${count} attending`;

      person.append(name, meta);
      people.append(person);
    });
    list.append(people);
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

  function setRsvpFormMode(mode) {
    const form = $("#rsvp-form");
    if (!form) return;
    const submit = form.querySelector('button[type="submit"]');
    const newButton = $("#new-rsvp-button");
    if (submit) submit.textContent = mode === "edit" ? "Update RSVP" : "Lock in RSVP";
    if (newButton) newButton.hidden = mode !== "edit";
  }

  function fillRsvpForm(rsvp, source) {
    const form = $("#rsvp-form");
    if (!form || !rsvp) return;
    form.elements.rsvpId.value = rsvp.id || "";
    form.elements.guestKey.value = rsvp.guestKey || "";
    form.elements.ownerToken.value = rsvp.ownerToken || "";
    form.elements.guestName.value = rsvp.name || "";
    form.elements.partyCount.value = Math.max(1, Number(rsvp.partyCount || 1));
    const response = rsvp.response || "yes";
    const responseInput = form.querySelector(`input[name="response"][value="${response}"]`);
    if (responseInput) responseInput.checked = true;
    form.elements.note.value = rsvp.note || "";
    setRsvpFormMode("edit");
    if (source === "admin") $("#admin details")?.removeAttribute("open");
    form.scrollIntoView({ block: "center", behavior: "smooth" });
    setText("#rsvp-feedback", source === "admin" ? "Admin edit loaded. Update and save." : "Your RSVP is loaded. Make changes and update it.");
  }

  function resetRsvpForm() {
    const form = $("#rsvp-form");
    if (!form) return;
    form.reset();
    form.elements.rsvpId.value = "";
    form.elements.guestKey.value = "";
    form.elements.ownerToken.value = "";
    const yes = form.querySelector('input[name="response"][value="yes"]');
    if (yes) yes.checked = true;
    setRsvpFormMode("new");
    setText("#rsvp-feedback", "");
  }

  function renderOwnedRsvps() {
    const list = $("#owned-rsvp-list");
    if (!list) return;
    const button = $("#show-owned-rsvps");
    if (button) button.textContent = state.ownedRsvpPanelOpen ? "Hide my RSVP" : "Want to change your RSVP?";
    list.hidden = !state.ownedRsvpPanelOpen;
    if (!state.ownedRsvpPanelOpen) return;

    list.innerHTML = "";
    if (!state.ownedRsvps.length) {
      list.innerHTML = '<div class="empty small-empty">Message Elizabeth or Angela to update!</div>';
      return;
    }

    state.ownedRsvps.forEach((rsvp) => {
      const item = document.createElement("article");
      item.className = "owned-rsvp-card";

      const copy = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = rsvp.name || "Unnamed";
      const meta = document.createElement("span");
      meta.textContent = `${rsvp.response || "yes"} · ${rsvp.partyCount || 1} attending · ${formatDate(rsvp.updatedAt || rsvp.createdAt) || "saved"}`;
      copy.append(name, meta);

      const actions = document.createElement("div");
      actions.className = "owned-rsvp-actions";
      const edit = document.createElement("button");
      edit.className = "button secondary";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => fillRsvpForm(rsvp, "guest"));
      const del = document.createElement("button");
      del.className = "button quiet delete-rsvp";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteOwnedRsvp(rsvp.id));
      actions.append(edit, del);

      item.append(copy, actions);
      list.append(item);
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
      rows.innerHTML = `<tr><td colspan="6">${state.usingSupabase ? "No RSVP rows loaded yet. If guests have RSVP'd, run the Supabase admin SQL setup so this private list can load." : "No RSVPs yet."}</td></tr>`;
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

        const action = document.createElement("td");
        const edit = document.createElement("button");
        edit.className = "button secondary edit-rsvp";
        edit.type = "button";
        edit.textContent = "Edit";
        edit.addEventListener("click", () => fillRsvpForm(rsvp, "admin"));
        const del = document.createElement("button");
        del.className = "button quiet delete-rsvp";
        del.type = "button";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteRsvp(rsvp.id, del));
        action.className = "admin-rsvp-actions";
        action.append(edit, del);

        row.append(name, response, party, note, updated, action);
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

    renderAdminPlaces();

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

  function renderAdminPlaces() {
    const list = $("#admin-place-list");
    if (!list) return;
    list.innerHTML = "";

    const items = resourceGroups.flatMap((group) =>
      publicResourceItems(group.key).map((resource, index) => ({ ...resource, group: group.key, index }))
    );

    if (!items.length) {
      list.innerHTML = '<div class="empty small-empty">No places yet. Add a name, address, and optional image above.</div>';
      return;
    }

    items.forEach((resource) => {
      const item = document.createElement("article");
      item.className = "admin-place";

      if (resource.image) {
        const image = document.createElement("img");
        image.src = resource.image;
        image.alt = "";
        image.loading = "lazy";
        item.append(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "admin-place-placeholder";
        placeholder.textContent = "IMG";
        item.append(placeholder);
      }

      const copy = document.createElement("div");
      const category = document.createElement("span");
      category.className = "admin-place-category";
      category.textContent = resourceGroupLabel(resource.group);
      const name = document.createElement("p");
      name.textContent = resource.name || "Unnamed place";
      const address = document.createElement("small");
      address.textContent = resource.address || "No address yet";
      copy.append(category, name, address);

      const actions = document.createElement("div");
      actions.className = "admin-place-actions";
      const edit = document.createElement("button");
      edit.className = "button secondary";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => startEditPlace(resource));
      const map = document.createElement("a");
      map.className = "button secondary";
      map.href = mapsUrl(resource.address || resource.name);
      map.target = "_blank";
      map.rel = "noreferrer";
      map.textContent = "Open map";
      const del = document.createElement("button");
      del.className = "button quiet";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => deletePlace(resource.group, resource.index));
      actions.append(edit, map, del);

      item.append(copy, actions);
      list.append(item);
    });
  }

  function resetPlaceForm() {
    const form = $("#place-form");
    if (!form) return;
    form.reset();
    form.elements.editCategory.value = "";
    form.elements.editIndex.value = "";
    form.elements.image.placeholder = "Paste image URL or leave blank";
    const submit = $(".place-submit-button", form);
    if (submit) submit.textContent = "Add place";
    const cancel = $("#cancel-place-edit");
    if (cancel) cancel.hidden = true;
  }

  function startEditPlace(resource) {
    const form = $("#place-form");
    if (!form) return;
    form.elements.category.value = normalizeResourceGroup(resource.group);
    form.elements.name.value = resource.name || "";
    form.elements.address.value = resource.address || "";
    form.elements.image.value = resource.image && !resource.image.startsWith("data:") ? resource.image : "";
    form.elements.image.placeholder = resource.image ? "Image already saved. Upload another to replace." : "Paste image URL or leave blank";
    if (form.elements.imageFile) form.elements.imageFile.value = "";
    form.elements.editCategory.value = normalizeResourceGroup(resource.group);
    form.elements.editIndex.value = String(resource.index);
    const submit = $(".place-submit-button", form);
    if (submit) submit.textContent = "Save place";
    const cancel = $("#cancel-place-edit");
    if (cancel) cancel.hidden = false;
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    setText("#admin-feedback", "Editing place. Make changes, then save.");
  }

  async function placeImageFromForm(formData, existingImage) {
    const upload = formData.get("imageFile");
    if (upload?.size) return compressPlaceImage(upload);
    const pasted = String(formData.get("image") || "").trim();
    return pasted || existingImage || "";
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
    renderOwnedRsvps();
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
      const legacyPayload = {
        p_guest_key: entry.guestKey,
        p_guest_name: entry.name,
        p_party_count: entry.partyCount,
        p_response: entry.response,
        p_contact: entry.contact,
        p_note: entry.note
      };
      const payload = {
        ...legacyPayload,
        p_owner_token: entry.ownerToken || state.ownerToken
      };
      let { data, error } = await state.supabaseClient.rpc("graduation_save_rsvp", payload);
      let legacyMode = false;
      if (error) {
        if (missingSupabaseFunction(error)) {
          const legacyResult = await state.supabaseClient.rpc("graduation_save_rsvp", legacyPayload);
          if (legacyResult.error) throw legacyResult.error;
          data = legacyResult.data;
          legacyMode = true;
        } else {
          throw error;
        }
      }
      await loadPublicData();
      if (!legacyMode) await loadOwnedRsvps().catch(() => {});
      const saved = { ...entry, id: data?.id || entry.id, guestKey: data?.guest_key || entry.guestKey, ownerToken: entry.ownerToken || state.ownerToken };
      upsertPublicRsvp(saved);
      cacheOwnedRsvp(saved);
      return {
        id: data?.id || entry.id,
        guestKey: data?.guest_key || entry.guestKey,
        ...entry,
        ownerToken: entry.ownerToken || state.ownerToken,
        legacyMode
      };
    }

    const now = new Date().toISOString();
    const index = state.rsvps.findIndex((rsvp) => (entry.id && rsvp.id === entry.id) || rsvp.guestKey === entry.guestKey);
    let saved;
    if (index >= 0) {
      state.rsvps[index] = { ...state.rsvps[index], ...entry, ownerToken: entry.ownerToken || state.ownerToken, updatedAt: now };
      saved = state.rsvps[index];
    } else {
      saved = { ...entry, id: entry.id || crypto.randomUUID?.() || String(Date.now()), ownerToken: entry.ownerToken || state.ownerToken, createdAt: now, updatedAt: now };
      state.rsvps.unshift(saved);
    }
    state.ownedRsvps = localOwnedRsvps();
    upsertPublicRsvp(saved);
    writeLocal();
    return saved;
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
        image.onerror = () => reject(new Error("That image did not open. Try JPG, PNG, WebP, or HEIC."));
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
    const imageFile = await canvasReadyImage(file, "#memory-feedback");
    const attempts = [
      { maxEdge: 1280, quality: 0.78 },
      { maxEdge: 1000, quality: 0.72 },
      { maxEdge: 820, quality: 0.66 }
    ];
    for (const attempt of attempts) {
      const dataUrl = await canvasDataUrl(imageFile, attempt.maxEdge, attempt.quality);
      if (dataUrl.length <= maxMemoryImageLength) return dataUrl;
    }
    throw new Error("That photo is still too big. Try a smaller image.");
  }

  async function compressPlaceImage(file) {
    const imageFile = await canvasReadyImage(file, "#admin-feedback");
    const attempts = [
      { maxEdge: 760, quality: 0.72 },
      { maxEdge: 620, quality: 0.66 },
      { maxEdge: 520, quality: 0.6 }
    ];
    for (const attempt of attempts) {
      const dataUrl = await canvasDataUrl(imageFile, attempt.maxEdge, attempt.quality);
      if (dataUrl.length <= maxPlaceImageLength) return dataUrl;
    }
    throw new Error("That place image is too big. Try a smaller one.");
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

    state.rsvps = visibleRsvps(payload.rsvps || []).map((row) => ({
      id: row.id,
      guestKey: row.guest_key,
      name: row.guest_name,
      partyCount: row.party_count,
      response: row.response,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
    state.publicRsvps = state.rsvps.map(normalizeRsvp);
    syncPublicTotals();
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

  async function addPlace(formData) {
    const group = normalizeResourceGroup(formData.get("category"));
    const editGroup = normalizeResourceGroup(formData.get("editCategory"));
    const editIndexValue = String(formData.get("editIndex") || "");
    const editIndex = editIndexValue === "" ? -1 : Number(editIndexValue);
    const isEditing = Number.isInteger(editIndex) && editIndex >= 0;
    const existingItems = isEditing ? publicResourceItems(editGroup) : [];
    const existingPlace = isEditing ? existingItems[editIndex] : null;
    const place = cleanResource({
      name: formData.get("name"),
      address: formData.get("address"),
      image: await placeImageFromForm(formData, existingPlace?.image || "")
    });

    if (!place.name && !place.address) {
      setText("#admin-feedback", "Add at least a place name or address.");
      return false;
    }

    if (isEditing && existingPlace) {
      const updates = {};
      if (editGroup === group) {
        updates[group] = existingItems.map((item, index) => (index === editIndex ? place : item));
      } else {
        updates[editGroup] = existingItems.filter((_, index) => index !== editIndex);
        updates[group] = [...publicResourceItems(group), place];
      }
      await saveSiteSettings(updates);
      setText("#admin-feedback", "Place updated.");
    } else {
      const nextItems = [...publicResourceItems(group), place];
      await saveSiteSettings({ [group]: nextItems });
      setText("#admin-feedback", `${resourceGroupLabel(group).replace(/s$/, "")} added.`);
    }
    renderAll();
    return true;
  }

  async function deletePlace(group, index) {
    const key = normalizeResourceGroup(group);
    const nextItems = publicResourceItems(key).filter((_, itemIndex) => itemIndex !== Number(index));
    try {
      await saveSiteSettings({ [key]: nextItems });
      setText("#admin-feedback", "Place removed.");
      renderAll();
    } catch (error) {
      console.error(error);
      setText("#admin-feedback", friendlyError(error, "Could not remove that place yet."));
    }
  }

  async function deleteRsvp(rsvpId, button) {
    if (!rsvpId) return;
    const rsvp = state.rsvps.find((item) => item.id === rsvpId);
    const name = rsvp?.name || "this RSVP";
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    const oldText = button?.textContent || "";
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Deleting...";
      }
      setText("#admin-feedback", "Deleting RSVP...");
      if (state.usingSupabase) {
        const endpoint = config.supabase?.adminEndpoint;
        if (endpoint) {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "delete_rsvp", password: state.adminPassword, rsvpId })
          });
          if (!response.ok) throw new Error("Could not delete RSVP.");
        } else {
          try {
            await callAdminDeleteRsvp(rsvpId);
          } catch (hardDeleteError) {
            console.warn("Admin hard delete failed; using RSVP soft delete.", hardDeleteError);
            await softDeleteRsvp(rsvp);
          }
        }
        await loadAdmin(state.adminPassword);
        if (state.rsvps.some((item) => item.id === rsvpId)) {
          await softDeleteRsvp(rsvp);
          await loadAdmin(state.adminPassword);
        }
        if (state.rsvps.some((item) => item.id === rsvpId)) {
          throw new Error("Could not verify RSVP delete.");
        }
        await loadOwnedRsvps().catch(() => {});
      } else {
        state.rsvps = state.rsvps.filter((rsvp) => rsvp.id !== rsvpId);
        state.publicRsvps = state.publicRsvps.filter((rsvp) => rsvp.id !== rsvpId);
        state.ownedRsvps = localOwnedRsvps();
        syncPublicTotals();
        writeLocal();
      }
      forgetOwnedRsvp(rsvp || rsvpId);
      setText("#admin-feedback", "RSVP deleted.");
      renderAll();
    } catch (error) {
      console.error(error);
      setText("#admin-feedback", "Could not delete that RSVP yet. Refresh and try again.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText || "Delete";
      }
    }
  }

  async function callAdminDeleteRsvp(rsvpId) {
    const { error } = await state.supabaseClient.rpc("graduation_admin_delete_rsvp", {
      admin_password: state.adminPassword,
      rsvp_id: rsvpId
    });
    if (!error) return;
    if (!missingSupabaseFunction(error)) throw error;

    const fallback = await state.supabaseClient.rpc("graduation_admin_delete_message", {
      admin_password: state.adminPassword,
      message_id: rsvpId
    });
    if (fallback.error) throw fallback.error;
  }

  async function softDeleteRsvp(rsvp) {
    if (!rsvp?.guestKey) throw new Error("Cannot soft delete RSVP without a guest key.");
    const hiddenName = `${deletedRsvpPrefix} ${rsvp.id || rsvp.guestKey || Date.now()}`;
    const { error } = await state.supabaseClient.rpc("graduation_save_rsvp", {
      p_guest_key: rsvp.guestKey,
      p_guest_name: hiddenName,
      p_party_count: 1,
      p_response: "no",
      p_contact: "",
      p_note: ""
    });
    if (error) throw error;
  }

  async function deleteOwnedRsvp(rsvpId) {
    if (!rsvpId) return;
    const rsvp = state.ownedRsvps.find((item) => item.id === rsvpId);
    if (!window.confirm(`Delete ${rsvp?.name || "this RSVP"}? This cannot be undone.`)) return;
    try {
      if (state.usingSupabase) {
        const { error } = await state.supabaseClient.rpc("graduation_delete_owned_rsvp", {
          p_owner_token: state.ownerToken,
          rsvp_id: rsvpId
        });
        if (error) {
          if (!missingSupabaseFunction(error) || !rsvp) throw error;
          await softDeleteRsvp(rsvp);
        }
        await loadPublicData();
        await loadOwnedRsvps();
      } else {
        state.rsvps = state.rsvps.filter((rsvp) => !(rsvp.id === rsvpId && rsvp.ownerToken === state.ownerToken));
        state.publicRsvps = state.publicRsvps.filter((rsvp) => rsvp.id !== rsvpId);
        state.ownedRsvps = localOwnedRsvps();
        syncPublicTotals();
        writeLocal();
      }
      forgetOwnedRsvp(rsvp || rsvpId);
      resetRsvpForm();
      setText("#rsvp-feedback", "Your RSVP was deleted from this phone.");
      renderAll();
    } catch (error) {
      console.error(error);
      setText("#rsvp-feedback", "Message Elizabeth or Angela to update!");
    }
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

  async function assetDataUrl(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Could not load ${path}`);
      return await blobToDataUrl(await response.blob());
    } catch (error) {
      console.warn(error);
      return "";
    }
  }

  async function inviteAssetDataUrls() {
    const [cellPattern, microscope, redCell, smilingCell] = await Promise.all([
      assetDataUrl("assets/mls-red-cell-pattern.jpg"),
      assetDataUrl("assets/mls-microscope.png"),
      assetDataUrl("assets/mls-red-cell-sticker.png"),
      assetDataUrl("assets/mls-smiling-cell.png")
    ]);
    return { cellPattern, microscope, redCell, smilingCell };
  }

  function invitationSvg(qrHref, art = {}) {
    const event = config.event || {};
    const title = event.title || "Elizabeth & Angela's OIT MLS Graduation";
    const headline = event.inviteHeadline || "You're invited to";
    const tagline = event.inviteTagline || "OIT/OHSU Medical Laboratory Science Graduation";
    const date = event.dateText || "December 2026";
    const time = event.timeText || "Time TBA";
    const place = event.graduationLocationName || event.locationName || "Graduation at OHSU";
    const address = normalizeMapQuery(event.graduationAddress || event.address || "OHSU, Portland, OR");
    const footer = event.inviteFooter || "Scan to RSVP, get directions, leave a note, and share a memory.";
    const cellPattern = art.cellPattern ? `<image x="1020" y="-90" width="880" height="1380" href="${escapeXml(art.cellPattern)}" preserveAspectRatio="xMidYMid slice" opacity="0.2"/>` : "";
    const microscope = art.microscope ? `<image x="690" y="405" width="500" height="675" href="${escapeXml(art.microscope)}" preserveAspectRatio="xMidYMid meet" opacity="0.78" transform="rotate(-7 940 742)"/>` : "";
    const redCell = art.redCell ? `<image x="600" y="95" width="170" height="240" href="${escapeXml(art.redCell)}" preserveAspectRatio="xMidYMid meet" transform="rotate(12 685 215)"/>` : "";
    const smilingCell = art.smilingCell ? `<image x="1540" y="735" width="185" height="265" href="${escapeXml(art.smilingCell)}" preserveAspectRatio="xMidYMid meet" transform="rotate(-7 1632 867)"/>` : "";

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
  ${cellPattern}
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
  <g opacity="0.2" stroke="#ffffff" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <rect x="170" y="985" width="300" height="34" rx="17" stroke-width="9"/>
    <path d="M246 984 v-106 l120 -58" stroke-width="11"/>
    <circle cx="392" cy="808" r="46" stroke-width="10"/>
    <path d="M430 834 l115 82" stroke-width="11"/>
    <rect x="615" y="982" width="170" height="44" rx="16" stroke-width="8"/>
    <rect x="650" y="850" width="28" height="132" rx="14" stroke-width="7"/>
    <rect x="704" y="820" width="28" height="162" rx="14" stroke-width="7"/>
    <rect x="758" y="875" width="28" height="107" rx="14" stroke-width="7"/>
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
  ${microscope}
  ${redCell}
  ${smilingCell}

  <text x="120" y="130" font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="36" font-weight="700" fill="#d9a21a">OIT / OHSU MLS</text>
  ${svgTextBlock({ text: headline, x: 120, y: 255, maxChars: 30, maxLines: 1, size: 86, weight: 400, fill: "#f3c79f", anchor: "start", family: "Brush Script MT, Snell Roundhand, cursive" })}
  <rect x="88" y="304" width="895" height="330" rx="34" fill="#001f3f" opacity="0.32"/>
  ${svgTextBlock({ text: title, x: 120, y: 405, maxChars: 22, maxLines: 2, size: 76, weight: 800, fill: "#ffffff", anchor: "start", lineHeight: 1.04 })}
  ${svgTextBlock({ text: tagline, x: 124, y: 585, maxChars: 44, maxLines: 2, size: 33, weight: 800, fill: "#e5f2fb", anchor: "start", family: "Manrope, Arial, sans-serif" })}
  <g font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="24" font-weight="700" opacity="0.92">
    <rect x="120" y="640" width="160" height="48" rx="24" fill="#001f3f" fill-opacity="0.28" stroke="#d9a21a" stroke-width="2"/>
    <rect x="300" y="640" width="190" height="48" rx="24" fill="#001f3f" fill-opacity="0.28" stroke="#d9a21a" stroke-width="2"/>
    <rect x="512" y="640" width="205" height="48" rx="24" fill="#001f3f" fill-opacity="0.28" stroke="#d9a21a" stroke-width="2"/>
    <text x="200" y="673" text-anchor="middle" fill="#ffffff">HEMATOLOGY</text>
    <text x="395" y="673" text-anchor="middle" fill="#ffffff">MICROBIOLOGY</text>
    <text x="614" y="673" text-anchor="middle" fill="#ffffff">CHEMISTRY</text>
  </g>

  <g font-family="Manrope, Arial, sans-serif" filter="url(#softShadow)">
    <rect x="120" y="710" width="455" height="250" rx="26" fill="#ffffff" opacity="0.96"/>
    <rect x="610" y="710" width="485" height="250" rx="26" fill="#ffffff" opacity="0.96"/>
    <text x="158" y="780" font-size="31" font-weight="900" fill="#d9a21a">WHEN</text>
    <text x="158" y="846" font-size="49" font-weight="900" fill="#17212b">${escapeXml(date)}</text>
    <text x="158" y="900" font-size="34" font-weight="800" fill="#5c6874">${escapeXml(time)}</text>
    <text x="648" y="780" font-size="31" font-weight="900" fill="#d9a21a">WHERE</text>
    ${svgTextBlock({ text: place, x: 648, y: 842, maxChars: 20, maxLines: 2, size: 39, weight: 900, fill: "#17212b", anchor: "start", family: "Manrope, Arial, sans-serif" })}
    ${svgTextBlock({ text: address, x: 648, y: 925, maxChars: 30, maxLines: 2, size: 27, weight: 800, fill: "#5c6874", anchor: "start", family: "Manrope, Arial, sans-serif" })}
  </g>

  <g filter="url(#softShadow)">
    <rect x="1188" y="78" width="470" height="880" rx="42" fill="#ffffff" opacity="0.94"/>
    <rect x="1188" y="78" width="470" height="14" fill="url(#scienceGold)"/>
    <circle cx="1260" cy="158" r="42" fill="#e7f1f8" stroke="#d7e0e8" stroke-width="3"/>
    <text x="1260" y="170" text-anchor="middle" font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="28" font-weight="700" fill="#003767">MLS</text>
    <text x="1423" y="194" text-anchor="middle" font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="44" font-weight="700" fill="#003767">SCAN RSVP</text>
    <text x="1423" y="244" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="27" font-weight="800" fill="#5c6874">directions | notes | memories</text>
    <rect x="1294" y="298" width="258" height="258" rx="24" fill="#ffffff" stroke="#d7e0e8" stroke-width="4"/>
    <image x="1315" y="319" width="216" height="216" href="${escapeXml(qrHref)}" preserveAspectRatio="xMidYMid meet"/>
    ${svgTextBlock({ text: footer, x: 1248, y: 636, maxChars: 24, maxLines: 4, size: 31, weight: 800, fill: "#003767", anchor: "start", family: "Manrope, Arial, sans-serif" })}
    <g font-family="Manrope, Arial, sans-serif" font-size="22" font-weight="900">
      <rect x="1248" y="812" width="118" height="42" rx="21" fill="#fffaf0" stroke="#d7e0e8" stroke-width="2"/>
      <rect x="1385" y="812" width="134" height="42" rx="21" fill="#e7f1f8" stroke="#d7e0e8" stroke-width="2"/>
      <rect x="1538" y="812" width="92" height="42" rx="21" fill="#eef7f0" stroke="#d7e0e8" stroke-width="2"/>
      <text x="1307" y="840" text-anchor="middle" fill="#003767">LAB</text>
      <text x="1452" y="840" text-anchor="middle" fill="#003767">FAMILY</text>
      <text x="1584" y="840" text-anchor="middle" fill="#003767">OHSU</text>
    </g>
    <text x="1423" y="904" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="24" font-weight="900" fill="#5c6874">${escapeXml(shareUrl())}</text>
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

  function svgToPngBlob(svg, width, height) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Could not create image."));
          }
        }, "image/png");
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not load image."));
      };
      image.src = url;
    });
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not create image."));
        }
      }, "image/png");
    });
  }

  function waitForCardImages(root) {
    const images = Array.from(root.querySelectorAll("img"));
    return Promise.all(
      images.map(
        (image) =>
          new Promise((resolve) => {
            if (image.complete && image.naturalWidth) {
              resolve();
              return;
            }
            const done = () => {
              image.removeEventListener("load", done);
              image.removeEventListener("error", done);
              resolve();
            };
            image.addEventListener("load", done, { once: true });
            image.addEventListener("error", done, { once: true });
            window.setTimeout(done, 2000);
          })
      )
    );
  }

  function nextPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  }

  async function captureInviteCardBlob() {
    const card = $("#printable-invite-card");
    const qr = $("#invite-card-qr");
    if (!card || typeof window.html2canvas !== "function") {
      throw new Error("Invite card capture is not ready.");
    }

    const originalQrSrc = qr?.getAttribute("src") || "";
    try {
      if (qr) {
        const qrDataUrl = await inviteQrDataUrl();
        qr.src = qrDataUrl || originalQrSrc || qrImageUrl();
      }
      await document.fonts?.ready?.catch(() => {});
      await waitForCardImages(card);
      await nextPaint();

      const rect = card.getBoundingClientRect();
      const scale = Math.min(3, Math.max(2, 1800 / Math.max(rect.width, 1)));
      const canvas = await window.html2canvas(card, {
        allowTaint: false,
        backgroundColor: null,
        logging: false,
        scale,
        useCORS: true
      });
      return await canvasToPngBlob(canvas);
    } finally {
      if (qr) qr.src = originalQrSrc || qrImageUrl();
    }
  }

  async function showSaveableImage(blob, options) {
    const preview = options.previewSelector ? $(options.previewSelector) : null;
    if (preview) {
      preview.src = await blobToDataUrl(blob);
      preview.hidden = false;
    }

    let shared = false;
    try {
      if (navigator.share && typeof File === "function") {
        const file = new File([blob], options.fileName, { type: "image/png" });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ title: options.shareTitle, files: [file] });
          shared = true;
        }
      }
    } catch (error) {
      console.warn(error);
    }

    if (!preview && !shared) {
      downloadBlob(blob, options.fileName);
    }

    setText(
      options.feedbackSelector,
      shared
        ? "Share/save sheet opened."
        : preview
        ? "Image is ready below. On your phone, long-press it to save to Photos."
        : "Invite image download started."
    );
    preview?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function downloadInvitationPng() {
    setText("#invite-download-feedback", "Preparing the card you see...");
    try {
      const blob = await captureInviteCardBlob();
      await showSaveableImage(blob, {
        fileName: "elizabeth-angela-graduation-invite.png",
        feedbackSelector: "#invite-download-feedback",
        shareTitle: "Elizabeth & Angela graduation invite"
      });
    } catch (error) {
      console.error(error);
      setText("#invite-download-feedback", "Could not create the invite image yet. Try again.");
    }
  }

  function responseTone(response) {
    if (response === "no") return { label: "No", bg: "#f8d7dc", fg: "#8c1020" };
    if (response === "maybe") return { label: "Maybe", bg: "#fff1c7", fg: "#7a5700" };
    return { label: "Yes", bg: "#dff4e8", fg: "#006b36" };
  }

  function rsvpImageSvg() {
    const event = config.event || {};
    const current = totals();
    const rows = state.rsvps.slice(0, 80);
    const rowHeight = 108;
    const height = 520 + Math.max(rows.length, 1) * rowHeight;
    const generatedAt = new Date().toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    const rowMarkup = rows.length
      ? rows
          .map((rsvp, index) => {
            const y = 430 + index * rowHeight;
            const tone = responseTone(rsvp.response || "yes");
            const count = Math.max(1, Number(rsvp.partyCount || 1));
            const note = rsvp.note ? `Note: ${rsvp.note}` : "No private note";
            return `
  <g font-family="Manrope, Arial, sans-serif">
    <rect x="48" y="${y}" width="984" height="88" rx="22" fill="#ffffff" stroke="#d7e0e8" stroke-width="2"/>
    <circle cx="88" cy="${y + 44}" r="18" fill="${tone.bg}" stroke="${tone.fg}" stroke-width="3"/>
    ${svgTextBlock({ text: rsvp.name || "Unnamed", x: 126, y: y + 42, maxChars: 24, maxLines: 1, size: 33, weight: 900, fill: "#17212b", anchor: "start", family: "Manrope, Arial, sans-serif" })}
    <text x="126" y="${y + 72}" font-size="21" font-weight="800" fill="#5c6874">${escapeXml(formatDate(rsvp.updatedAt || rsvp.createdAt))}</text>
    <rect x="472" y="${y + 24}" width="142" height="42" rx="21" fill="${tone.bg}"/>
    <text x="543" y="${y + 53}" text-anchor="middle" font-size="24" font-weight="900" fill="${tone.fg}">${tone.label}</text>
    <text x="660" y="${y + 53}" font-size="26" font-weight="900" fill="#003767">${count} ${count === 1 ? "person" : "people"}</text>
    ${svgTextBlock({ text: note, x: 820, y: y + 44, maxChars: 17, maxLines: 2, size: 21, weight: 800, fill: "#5c6874", anchor: "middle", family: "Manrope, Arial, sans-serif" })}
  </g>`;
          })
          .join("")
      : `
  <g font-family="Manrope, Arial, sans-serif">
    <rect x="48" y="430" width="984" height="88" rx="22" fill="#ffffff" stroke="#d7e0e8" stroke-width="2"/>
    <text x="540" y="486" text-anchor="middle" font-size="30" font-weight="900" fill="#5c6874">No RSVPs yet.</text>
  </g>`;

    return {
      width: 1080,
      height,
      svg: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}">
  <defs>
    <linearGradient id="rsvpBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="0.52" stop-color="#e7f1f8"/>
      <stop offset="1" stop-color="#eef7f0"/>
    </linearGradient>
    <linearGradient id="rsvpHeader" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#001f3f"/>
      <stop offset="1" stop-color="#003767"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="${height}" fill="url(#rsvpBg)"/>
  <rect x="0" y="0" width="1080" height="238" fill="url(#rsvpHeader)"/>
  <rect x="0" y="0" width="180" height="14" fill="#003767"/>
  <rect x="180" y="0" width="180" height="14" fill="#d9a21a"/>
  <rect x="360" y="0" width="180" height="14" fill="#0038a8"/>
  <rect x="540" y="0" width="180" height="14" fill="#ce1126"/>
  <rect x="720" y="0" width="180" height="14" fill="#fffaf0"/>
  <rect x="900" y="0" width="180" height="14" fill="#009246"/>
  <g opacity="0.16" stroke="#ffffff" fill="none">
    <circle cx="862" cy="90" r="64" stroke-width="7"/>
    <path d="M907 135 l95 68" stroke-width="12" stroke-linecap="round"/>
    <path d="M650 62 h170 M686 62 v92 M774 62 v92 M662 154 h160" stroke-width="8" stroke-linecap="round"/>
  </g>
  <text x="48" y="86" font-family="Chakra Petch, Space Grotesk, Arial, sans-serif" font-size="30" font-weight="700" fill="#d9a21a">PRIVATE ADMIN RSVP IMAGE</text>
  ${svgTextBlock({ text: event.title || "Elizabeth & Angela's OIT MLS Graduation", x: 48, y: 150, maxChars: 30, maxLines: 2, size: 46, weight: 900, fill: "#ffffff", anchor: "start", lineHeight: 1.03 })}
  <text x="48" y="218" font-family="Manrope, Arial, sans-serif" font-size="23" font-weight="800" fill="#d7e8f5">Created ${escapeXml(generatedAt)}</text>

  <g font-family="Manrope, Arial, sans-serif" filter="none">
    <rect x="48" y="272" width="300" height="108" rx="24" fill="#003767"/>
    <rect x="390" y="272" width="300" height="108" rx="24" fill="#fff1c7" stroke="#d9a21a" stroke-width="2"/>
    <rect x="732" y="272" width="300" height="108" rx="24" fill="#ffffff" stroke="#d7e0e8" stroke-width="2"/>
    <text x="84" y="314" font-size="23" font-weight="900" fill="#d9a21a">YES</text>
    <text x="84" y="360" font-size="48" font-weight="900" fill="#ffffff">${current.yes}</text>
    <text x="426" y="314" font-size="23" font-weight="900" fill="#7a5700">MAYBE</text>
    <text x="426" y="360" font-size="48" font-weight="900" fill="#17212b">${current.maybe}</text>
    <text x="768" y="314" font-size="23" font-weight="900" fill="#8c1020">NO</text>
    <text x="768" y="360" font-size="48" font-weight="900" fill="#17212b">${current.no}</text>
  </g>
  ${rowMarkup}
</svg>`
    };
  }

  async function saveRsvpImage() {
    if (!state.adminUnlocked) return;
    setText("#admin-feedback", "Preparing RSVP image...");
    try {
      const image = rsvpImageSvg();
      const blob = await svgToPngBlob(image.svg, image.width, image.height);
      await showSaveableImage(blob, {
        fileName: "graduation-rsvps.png",
        previewSelector: "#rsvp-image-preview",
        feedbackSelector: "#admin-feedback",
        shareTitle: "Graduation RSVP list"
      });
    } catch (error) {
      console.error(error);
      setText("#admin-feedback", "Could not create the RSVP image yet.");
    }
  }

  function bindForms() {
    $("#rsvp-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const name = String(data.get("guestName") || "").trim();
      const existingGuestKey = String(data.get("guestKey") || "").trim();
      const existingId = String(data.get("rsvpId") || "").trim();
      const existingOwnerToken = String(data.get("ownerToken") || "").trim();
      try {
        const saved = await saveRsvp({
          id: existingId,
          guestKey: existingGuestKey || guestKey(name, state.ownerToken),
          name,
          partyCount: Math.max(1, Number(data.get("partyCount") || 1)),
          response: String(data.get("response") || "yes"),
          contact: "",
          note: String(data.get("note") || "").trim(),
          ownerToken: existingOwnerToken || state.ownerToken
        });
        if (saved?.id) form.elements.rsvpId.value = saved.id;
        if (saved?.guestKey) form.elements.guestKey.value = saved.guestKey;
        form.elements.ownerToken.value = saved?.ownerToken || existingOwnerToken || state.ownerToken;
        state.ownedRsvpPanelOpen = !saved?.legacyMode;
        if (!saved?.legacyMode) await loadOwnedRsvps().catch(() => {});
        if (state.adminUnlocked) await loadAdmin(state.adminPassword).catch(() => {});
        setRsvpFormMode("edit");
        setText(
          "#rsvp-feedback",
          saved?.legacyMode
            ? "RSVP saved! If anything needs changing later, admin can fix it while the private edit tools finish setup."
            : "RSVP saved. You can edit or delete it from this same phone."
        );
        renderAll();
        burstConfetti(90);
      } catch (error) {
        console.error(error);
        setText("#rsvp-feedback", "Message Elizabeth or Angela to update!");
      }
    });

    $("#show-owned-rsvps")?.addEventListener("click", async () => {
      state.ownedRsvpPanelOpen = !state.ownedRsvpPanelOpen;
      if (state.ownedRsvpPanelOpen) {
        setText("#rsvp-feedback", "Loading RSVP from this phone...");
        try {
          await loadOwnedRsvps();
          setText("#rsvp-feedback", "");
        } catch (error) {
          console.error(error);
          setText("#rsvp-feedback", "Message Elizabeth or Angela to update!");
        }
      }
      renderOwnedRsvps();
    });

    $("#new-rsvp-button")?.addEventListener("click", resetRsvpForm);

    $$(".count-card").forEach((button) => {
      button.addEventListener("click", () => {
        const response = button.dataset.rsvpFilter || "";
        state.openRsvpGroup = state.openRsvpGroup === response ? "" : response;
        renderCounts();
      });
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
        setText("#message-feedback", "That note did not stick yet. Try again in a minute.");
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
        const knownImageIssue = /Choose an image file|Could not read that image|JPG|PNG|WebP|HEIC|converter|too big|smaller image/i.test(message);
        const safeMessage = knownImageIssue
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

    const placeForm = $("#place-form");
    if (placeForm) {
      placeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const saved = await addPlace(new FormData(event.currentTarget));
          if (saved) resetPlaceForm();
        } catch (error) {
          console.error(error);
          const message = String(error?.message || "");
          const knownImageIssue = /image|photo|JPG|PNG|WebP|HEIC|converter|too big|smaller/i.test(message);
          setText("#admin-feedback", knownImageIssue ? message : friendlyError(error, "Could not save that place yet."));
        }
      });
    }

    $("#cancel-place-edit")?.addEventListener("click", () => {
      resetPlaceForm();
      setText("#admin-feedback", "Place edit canceled.");
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

    $("#export-rsvps").addEventListener("click", saveRsvpImage);

    $("#download-selected-memories").addEventListener("click", () => {
      downloadMemoryBatch(selectedMemories());
    });

    $("#download-all-memories").addEventListener("click", () => {
      downloadMemoryBatch(state.memories);
    });

    $("#share-qr-button").addEventListener("click", shareQrCode);
    $("#download-invite-png")?.addEventListener("click", downloadInvitationPng);
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
