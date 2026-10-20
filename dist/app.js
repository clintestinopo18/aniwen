import { loadCatalog, normalize, safeUrl } from "./catalog.js";
import { chapterAvailability, availabilityLabel, checkAvailability } from "./reading-availability.js";
const availabilityCache = new Map();
function cachedAvailability(item) {
  const value = availabilityCache.get(`${item.base}|${item.key}`);
  return value && Date.now() - value.checkedAt < 120000 ? value : null;
}
function saveAvailability(item, value) {
  if (availabilityCache.size >= 500) availabilityCache.delete(availabilityCache.keys().next().value);
  availabilityCache.set(`${item.base}|${item.key}`, { ...value, checkedAt: Date.now() });
}
import { API_CONFIG } from "./config.js";
import { embedUrl, playerEvent } from "./megaplay.js";
const $ = (s) => document.querySelector(s);
const icons = {
  play: '<path d="m9 5 11 7-11 7z"/>',
  book: '<path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  cloud:
    '<path d="M7 18a5 5 0 1 1 0-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11M12 11v10m-3-7 3-3 3 3"/>',
};
const icon = (name) =>
  `<svg aria-hidden="true" viewBox="0 0 24 24">${icons[name] || icons.book}</svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem("yoru-" + key));
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}
let storageWarning = false;
function persist(key, value) {
  try {
    localStorage.setItem("yoru-" + key, JSON.stringify(value));
  } catch {
    if (!storageWarning) {
      storageWarning = true;
      toast(
        "Browser storage is unavailable. Changes will last for this session only.",
      );
    }
  }
}
const savedPreferences = read("settings", {});
let prefs = {
  ...API_CONFIG,
  base: new URL(isLocal ? "/api" : API_CONFIG.base, location.origin).href.replace(/\/+$/, ""),
  autoplay: savedPreferences.autoplay === true,
};
// API destinations and providers are deployment settings, never visitor preferences.
let profile = read("profile", {});
profile = {
  name: typeof profile.name === "string" ? profile.name.slice(0, 32) : "Story explorer",
  bio: typeof profile.bio === "string" ? profile.bio.slice(0, 120) : "One more episode. One more chapter.",
};
let library = read("library", {}),
  remoteCache = read("remote", {}),
  catalog = [],
  all = new Map(),
  detailCache = new Map();
let routeVersion = 0,
  routeAbort = null,
  hls = null,
  disposeEmbed = null,
  observer = null,
  toastTimer,
  libraryFilter = "all",
  searchType = "all",
  homeType = "all";
let activeUnits = [],
  activeTotalKnown = true,
  activeItem = null,
  readerPages = [],
  readerIndex = 0,
  readerMode = "scroll";
const main = $("#main");
const link = (item) => "#title/" + encodeURIComponent(item.key);
const pretty = (kind) =>
  kind === "anime" ? "Anime" : kind === "manhwa" ? "Manhwa" : "Manga";
const totalLabel = (item) =>
  item.total
    ? `${item.total} ${item.kind === "anime" ? "episodes" : "chapters"}`
    : item.kind === "anime"
      ? "Episode guide"
      : "Chapter guide";
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 2800);
}
function count() {
  let n = Object.keys(library).length;
  $("#library-count").textContent = n;
  $("#library-count").hidden = !n;
}
function remember(item) {
  all.set(item.key, item);
  if (!item.editorial) {
    remoteCache[item.key] = item;
    const entries = Object.entries(remoteCache);
    remoteCache = Object.fromEntries(entries.slice(-100));
    persist("remote", remoteCache);
  }
}
function save(item) {
  if (library[item.key]) {
    delete library[item.key];
    toast("Removed from your library");
  } else {
    library[item.key] = {
      item,
      status: "planned",
      updatedAt: Date.now(),
      done: [],
      progress: null,
    };
    toast("Added to your library");
  }
  persist("library", library);
  count();
  document.querySelectorAll("[data-save]").forEach((b) => {
    if (b.dataset.save === item.key) {
      const yes = !!library[item.key];
      b.classList.toggle("saved", yes);
      b.setAttribute("aria-pressed", String(yes));
      b.setAttribute("aria-label", (yes ? "Remove " : "Save ") + item.title);
      b.innerHTML = b.classList.contains("save-card")
        ? icon(yes ? "check" : "plus")
        : icon(yes ? "check" : "plus") + (yes ? "In my library" : "My list");
    }
  });
}
function progress(item, unit, extra = {}) {
  const old = library[item.key] || { item, status: "active", done: [] };
  library[item.key] = {
    ...old,
    item,
    status: old.status === "completed" ? "completed" : "active",
    updatedAt: Date.now(),
    progress: {
      ...old.progress,
      id: String(unit.id),
      number: unit.number || unit.chapterNumber || "",
      ...extra,
    },
  };
  persist("library", library);
  count();
}
function markDone(item, unit) {
  progress(item, unit);
  const entry = library[item.key];
  entry.done = [...new Set([...(entry.done || []), String(unit.id)])];
  // Finishing the available MangaDex uploads does not establish that the entire series is complete.
  if (item.provider !== "mangadex" && activeTotalKnown && activeUnits.length && entry.done.length >= activeUnits.length)
    entry.status = "completed";
  persist("library", library);
}
function card(item, withStatus = false) {
  const saved = library[item.key],
    pr = saved?.progress;
  const pct = pr?.duration ? Math.min(100, (pr.time / pr.duration) * 100) : 0;
  return `<article class="card"><a class="card-image" href="${link(item)}" aria-label="Open ${esc(item.title)}"><img src="${esc(safeUrl(item.image))}" alt="${esc(item.title)} cover" loading="lazy"><span class="card-badge ${item.kind}">${pretty(item.kind).toUpperCase()}</span><span class="card-format">${esc(totalLabel(item))}</span><span class="card-hover-play">${icon(item.kind === "anime" ? "play" : "book")}</span>${pct ? `<span class="progress-track"><span style="width:${pct}%"></span></span>` : ""}</a><button class="save-card ${saved ? "saved" : ""}" data-save="${esc(item.key)}" aria-pressed="${!!saved}" aria-label="${saved ? "Remove" : "Save"} ${esc(item.title)}">${icon(saved ? "check" : "plus")}</button><h3><a href="${link(item)}">${esc(item.title)}</a></h3><div class="card-info"><span class="genre">${esc(item.genres?.slice(0, 2).join(" · ") || pretty(item.kind))}</span><span>${esc(item.year)}</span></div>${
    withStatus
      ? `<div class="library-status"><select data-status="${esc(item.key)}" aria-label="Status for ${esc(item.title)}">${[
          ["planned", "Plan to " + (item.kind === "anime" ? "watch" : "read")],
          ["active", item.kind === "anime" ? "Watching" : "Reading"],
          ["completed", "Completed"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}" ${saved?.status === v ? "selected" : ""}>${l}</option>`,
          )
          .join("")}</select></div>`
      : ""
  }</article>`;
}
function section(title, subtitle, items, target, extra = "") {
  return `<section class="section"><div class="section-head"><div><h2>${title}</h2>${subtitle ? `<p class="subhead">${subtitle}</p>` : ""}</div>${target ? `<a href="${target}" class="text-link">Explore all ${icon("arrow")}</a>` : ""}</div><div class="collection-grid ${extra}">${items.map((i) => card(i)).join("")}</div></section>`;
}
function empty(title, description, action = "") {
  return `<div class="empty">${icon("spark")}<h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function loading(label = "Loading…") {
  return `<div class="loading" role="status"><span class="spinner"></span>${esc(label)}</div>`;
}
function networkError(error) {
  if (error.name === "AbortError")
    return "The connection timed out. Please try again.";
  return error.message || "Could not reach the source. Please try again.";
}
async function api(path, base = prefs.base, signal = routeAbort?.signal) {
  base = prefs.base; // Ignore API URLs retained in older backups or cached titles.
  const u = new URL(base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, ""));
  const timeout = AbortSignal.timeout(22000);
  let response;
  try {
    response = await fetch(u, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    if (e.name === "AbortError" || e.name === "TimeoutError")
      throw new Error(
        "The source took too long to respond. Please try again shortly.",
      );
    throw new Error(
      "The story service is temporarily unavailable. Please try again later.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The story service is not available yet. You can still browse and save titles.",
    );
  }
  if (!response.ok)
    throw new Error(
      data.message ||
        data.error ||
        `The source returned HTTP ${response.status}.`,
    );
  if (data.error)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : "The provider returned an error.",
    );
  return data;
}
function providerFor(kind) {
  return prefs[kind] || prefs.manga;
}
function groupFor(kind) {
  return kind === "anime" ? "anime" : "manga";
}
async function providerPage(query, kind, page = 1) {
  const provider = providerFor(kind),
    base = prefs.base;
  const result = await api(
    `${groupFor(kind)}/${encodeURIComponent(provider)}/${encodeURIComponent(query)}?page=${page}&kind=${kind}`,
    base,
  );
  const items = (result.results || [])
    .filter((r) => r.id)
    .map((r) => {
      const x = normalize(r, kind, provider, base);
      remember(x);
      return x;
    }).filter((x) => x.kind === kind);
  return { items, hasNextPage: result.hasNextPage === true, currentPage: page };
}
async function searchProvider(query, kind) {
  return (await providerPage(query, kind)).items;
}
async function resolveTitle(key) {
  if (all.has(key)) return;
  const match = /^title-(anime|manga|manhwa)-(megaplay|weebcentral|mangapill|comick|mangadex)-(.+)$/.exec(key);
  if (!match || (match[1] === "anime") !== (match[2] === "megaplay")) return;
  const [, kind, provider, encodedId] = match;
  const data = await api(`${groupFor(kind)}/${provider}/info?id=${encodeURIComponent(decodeURIComponent(encodedId))}`);
  const item = normalize(data, kind, provider, prefs.base);
  remember(item);
  all.set(key, item);
  detailCache.set(item.key, data);
}
async function details(item) {
  const id = item.key;
  if (detailCache.has(id)) return detailCache.get(id);
  const data = await api(
    `${groupFor(item.kind)}/${item.editorial && item.kind === "anime" ? "megaplay" : item.provider}/info?id=${encodeURIComponent(item.editorial && item.kind === "anime" ? item.sourceId : item.id)}`,
    item.base,
  );
  if (Array.isArray(data.chapters))
    data.chapters.sort(
      (a, b) => (Number(a.chapterNumber) || 0) - (Number(b.chapterNumber) || 0),
    );
  if (Array.isArray(data.episodes))
    data.episodes.sort(
      (a, b) => (Number(a.number) || 0) - (Number(b.number) || 0),
    );
  detailCache.set(id, data);
  return data;
}
function connectionNotice() {
  return `<div class="notice">Episodes and chapters are temporarily unavailable. Your library is still ready to explore.</div>`;
}
function home() {
  const f = catalog[0];
  const picks =
    homeType === "all"
      ? catalog.filter((i) =>
          [
            "solo-leveling",
            "jujutsu-kaisen",
            "chainsaw-man",
            "solo-leveling-manhwa",
            "dandadan",
            "spy-family",
          ].includes(i.key),
        )
      : catalog.filter((i) => i.kind === homeType).slice(0, 6);
  const recents = Object.values(library)
    .filter((v) => v.progress)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6)
    .map((v) => v.item);
  main.innerHTML = `<section class="hero"><img class="hero-art" src="assets/hero.jpg" alt="Frieren and her companions on their journey"><span class="hero-side-label">The Yoru spotlight</span><div class="hero-inner"><div class="eyebrow"><span class="line"></span>A journey worth taking</div><h1>Frieren<span>Beyond Journey’s End</span></h1><div class="meta"><span class="pill">ANIME</span><span>2023</span><span class="dot"></span><span>28 episodes</span><span class="dot"></span><span>Fantasy · Adventure</span></div><p class="hero-copy">The adventure ends. A new journey begins.<br>Some stories stay with you long after the last episode.</p><div class="actions"><a class="button" href="${link(f)}">${icon("play")}Explore series</a><button class="button secondary" data-save="frieren" aria-pressed="${!!library.frieren}">${icon(library.frieren ? "check" : "plus")}${library.frieren ? "In my library" : "My list"}</button></div></div><div class="hero-page"><b>01</b><span></span>SPOTLIGHT</div></section><div class="content"><div class="type-strip"><div class="type-tabs">${[
    ["all", "All stories"],
    ["anime", "Anime"],
    ["manga", "Manga"],
    ["manhwa", "Manhwa"],
  ]
    .map(
      ([id, label]) =>
        `<button class="chip ${homeType === id ? "active" : ""}" data-home-type="${id}" aria-pressed="${homeType === id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><span class="tiny-label">Your next obsession starts here.</span></div>${recents.length ? section("Pick up where you left off", "Your stories, right where you left them.", recents, "#library") : ""}${section("Find your next obsession", "A few favorites to get you started.", picks, homeType === "all" ? "#anime" : "#" + homeType, "home-six")}<section class="section discovery-grid"><a class="editorial-banner" href="#manhwa"><div class="editorial-text"><div class="eyebrow">A different kind of adventure</div><h2>One more chapter.<br>Just one more.</h2><p>Discover worlds made for the scroll.<br>Your next manhwa rabbit hole awaits.</p><span class="text-link">Explore manhwa ${icon("arrow")}</span></div><div class="poster-stack" aria-hidden="true"><img src="assets/omniscient-reader.jpg" alt=""><img src="assets/solo-leveling-manhwa.jpg" alt=""></div></a><div class="library-promo">${icon("bookmark")}<h3>Your stories. Your space.</h3><p>Keep your favorites together and pick up where you left off.</p><a href="#library" class="text-link">Make yourself at home ${icon("arrow")}</a></div></section>${section("From panel to obsession", "Big worlds. Unforgettable characters. Your next great read.", catalog.filter((i) => i.kind === "manga").slice(0, 6), "#manga", "home-six")}<section class="section"><div class="section-head"><div><h2>Follow your mood</h2><p class="subhead">There’s a story for every kind of day.</p></div></div><div class="genre-row">${["Action", "Fantasy", "Adventure", "Comedy", "Drama", "Supernatural"].map((g) => `<a href="#anime?genre=${g}" class="genre-tile">${g}<span>↗</span></a>`).join("")}</div></section></div>`;
}
function browseCurated(kind, params) {
  const genre = params.get("genre") || "all",
    sort = params.get("sort") || "curated";
  let list = catalog.filter(
    (i) => i.kind === kind && (genre === "all" || i.genres.includes(genre)),
  );
  if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "year") list.sort((a, b) => b.year - a.year);
  const title = pretty(kind);
  const copy = {
    anime:
      "New worlds. Unforgettable characters. Find the series you’ll stay up for.",
    manga: "Every panel opens a door. Discover your next great read.",
    manhwa: "Full-color worlds and stories you won’t stop scrolling.",
  };
  const genres = [
    ...new Set(catalog.filter((i) => i.kind === kind).flatMap((i) => i.genres)),
  ].sort();
  main.innerHTML = `<div class="content"><div class="page-head"><div class="eyebrow">The ${title} library</div><h1>${title}, your way.</h1><p>${copy[kind]}</p></div><div class="filter-bar"><label>Genre <select id="genre-filter">${["all", ...genres].map((g) => `<option value="${g}" ${genre === g ? "selected" : ""}>${g === "all" ? "All genres" : g}</option>`).join("")}</select></label><label>Sort <select id="sort-filter">${[
    ["curated", "Yoru picks"],
    ["title", "Title A–Z"],
    ["year", "Release year"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${sort === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><span class="result-count">${list.length} curated titles</span></div><div class="collection-grid">${list.length ? list.map((i) => card(i)).join("") : empty("No stories in this filter", "Try another genre to discover something new.")}</div><div class="notice">Looking for something else? <a href="#search?type=${kind}">Search more ${title.toLowerCase()} titles.</a></div></div>`;
  ["genre-filter", "sort-filter"].forEach((id) =>
    $("#" + id).addEventListener("change", () => {
      location.hash = `${kind}?genre=${encodeURIComponent($("#genre-filter").value)}&sort=${$("#sort-filter").value}`;
    }),
  );
}
async function browse(kind, params, version) {
  if (params.get("sort") === "curated") return browseCurated(kind, params);
  const anime = kind === "anime", provider = providerFor(kind);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.get("page")) || 1)));
  const sortOptions = anime ? [["popular", "Most popular"], ["trending", "Trending now"], ["title", "Title A–Z"], ["year", "Newest releases"]] : [["popular", "Most popular"], ["updated", "Recently updated"], ["title", "Title A–Z"]];
  const sort = sortOptions.some(([v]) => v === params.get("sort")) ? params.get("sort") : "popular";
  const genres = ["all", "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mecha", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];
  const genre = genres.includes(params.get("genre")) ? params.get("genre") : "all";
  const query = (params.get("q") || "").slice(0, 150);
  const hostedOnly = !anime && params.get("availability") === "hosted";
  const route = (p) => `#${kind}?${new URLSearchParams({ page: String(p), sort, genre, q: query, ...(hostedOnly ? { availability: "hosted" } : {}) })}`;
  main.innerHTML = `<div class="content"><div class="page-head"><div class="eyebrow">Beyond the collection</div><h1>${pretty(kind)}, your way.</h1><p>${anime ? "Explore the live anime catalog—not just our starter picks. Stream availability varies by title and episode." : "Explore the live chapter catalog. Choose a series to see its available chapters."}</p></div><form class="catalog-search" id="catalog-search"><input id="catalog-query" type="search" aria-label="Search this catalog" maxlength="150" placeholder="Search ${pretty(kind).toLowerCase()} titles…" value="${esc(query)}"><button class="button">Search</button></form><div class="filter-bar">${anime ? `<label>Genre <select id="catalog-genre">${genres.map(g => `<option value="${g}" ${genre === g ? "selected" : ""}>${g === "all" ? "All genres" : g}</option>`).join("")}</select></label>` : ""}<label>Sort <select id="catalog-sort">${sortOptions.map(([v,l]) => `<option value="${v}" ${sort === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><span class="result-count">Page ${page} · ${anime ? "AniList / MegaPlay" : "WeebCentral"}</span><a href="#${kind}?sort=curated" class="text-link">Yoru picks</a></div><div id="catalog-results">${loading("Loading the live catalog…")}</div><nav class="catalog-pagination" aria-label="Catalog pages" id="catalog-pagination"></nav></div>`;
  const filter = () => { location.hash = `${kind}?${new URLSearchParams({ sort: $("#catalog-sort").value, genre: $("#catalog-genre")?.value || "all", q: $("#catalog-query").value.trim(), ...(!anime ? { availability: $("#catalog-availability").value } : {}) })}`; };
  if (!anime) {
    $(".page-head p").textContent = "Explore the MangaDex catalog beyond our starter picks. English chapter availability varies by title.";
    $(".result-count").textContent = `Page ${page} · MangaDex`;
    $(".filter-bar").insertAdjacentHTML("afterbegin", `<label>Genre <select id="catalog-genre">${genres.map(g => `<option value="${g}" ${genre === g ? "selected" : ""}>${g === "all" ? "All genres" : g}</option>`).join("")}</select></label>`);
    $(".filter-bar").insertAdjacentHTML("beforeend", `<label>Reading <select id="catalog-availability"><option value="all">All titles</option><option value="hosted" ${hostedOnly ? "selected" : ""}>With English chapters (this page)</option></select></label>`);
    $("#catalog-results").insertAdjacentHTML("beforebegin", '<div class="reading-summary"><p id="availability-summary" role="status">Checking this page for hosted English chapters…</p><p>Chapter lists may be partial. Images can still become unavailable. This filter checks each catalog page separately; use Next page to discover more.</p><button class="button secondary" id="retry-availability" hidden>Recheck unconfirmed titles</button></div>');
    $("#catalog-availability").onchange = () => {
      const url = new URLSearchParams({ page: String(page), sort, genre, q: query, availability: $("#catalog-availability").value });
      location.hash = `${kind}?${url}`;
    };
  }
  $("#catalog-search").onsubmit = e => { e.preventDefault(); filter(); };
  $("#catalog-sort").onchange = filter;
  if ($("#catalog-genre")) $("#catalog-genre").onchange = filter;
  try {
    const data = await api(`${groupFor(kind)}/${provider}/catalog?${new URLSearchParams({ page: String(page), sort, kind, genre, search: query })}`);
    if (version !== routeVersion) return;
    const items = (data.results || []).filter(r => r.id).map(r => { const item = normalize(r, kind, provider, prefs.base); remember(item); return item; });
    if (!anime) $(".result-count").textContent = `Page ${page} · ${Number(data.total || 0).toLocaleString()} titles · MangaDex`;
    $("#catalog-results").innerHTML = items.length ? `<div class="collection-grid">${items.map(i => card(i)).join("")}</div>` : empty("No titles found", "Try another search or filter.");
    $("#catalog-pagination").innerHTML = `${page > 1 ? `<a class="button secondary" href="${esc(route(page - 1))}">← Previous page</a>` : ""}<span>Page ${page}</span>${data.hasNextPage && page < 10000 ? `<a class="button secondary" href="${esc(route(page + 1))}">Next page →</a>` : ""}`;
    if (!anime) {
      const states = new Map(items.map(item => [item.key, cachedAvailability(item)]));
      $("#catalog-results").innerHTML = `<div class="collection-grid">${items.map(item => `<div class="reading-card" data-reading-key="${esc(item.key)}">${card(item)}<p class="reading-status"></p></div>`).join("")}</div><div id="reading-empty"></div>`;
      const readingCards = [...$("#catalog-results").querySelectorAll("[data-reading-key]")];
      let running = false;
      const paint = () => {
        if (version !== routeVersion) return;
        let hosted = 0, unknown = 0, pending = 0;
        for (const value of states.values()) {
          if (!value) pending++;
          else if (value.state === "hosted") hosted++;
          else if (value.state === "unknown") unknown++;
        }
        $("#availability-summary").textContent = `${hosted} of ${items.length} titles on this page have hosted English chapters${pending ? ` · ${pending} checking` : ""}${unknown ? ` · ${unknown} unconfirmed` : ""}.`;
        $("#retry-availability").hidden = running || !unknown;
        readingCards.forEach((element, index) => {
          const item = items[index], value = states.get(item.key);
          element.hidden = hostedOnly && value?.state !== "hosted";
          const status = element.querySelector(".reading-status");
          status.textContent = availabilityLabel(value, item.readingLinks?.length > 0);
          status.className = `reading-status ${value?.state || "pending"}`;
        });
        const visible = items.filter(item => !hostedOnly || states.get(item.key)?.state === "hosted");
        $("#reading-empty").innerHTML = visible.length ? "" : empty(
          pending ? "Checking chapter availability…" : "No confirmed chapter lists on this page",
          pending ? "Titles will appear as their chapter lists are checked." : "Try the next catalog page, change your search, or switch to All titles. Unconfirmed titles are not treated as empty.",
        );
      };
      const run = async () => {
        running = true;
        paint();
        const unchecked = items.filter(item => !states.get(item.key) || states.get(item.key).state === "unknown");
        await checkAvailability(unchecked,
          item => api(`manga/${provider}/chapters?${new URLSearchParams({ id: item.id, page: "1" })}`, item.base),
          (item, value) => { states.set(item.key, value); saveAvailability(item, value); paint(); },
          { isCurrent: () => version === routeVersion });
        running = false;
        paint();
      };
      $("#retry-availability").onclick = run;
      void run();
    }
  } catch (e) {
    if (version === routeVersion) $("#catalog-results").innerHTML = `<div class="notice error">${esc(networkError(e))}</div><button class="button secondary" id="retry-catalog">Retry catalog</button>`;
    if (version === routeVersion) $("#retry-catalog").onclick = () => render();
  }
}
function libraryPage(params) {
  libraryFilter = params.get("type") || "all";
  let entries = Object.values(library)
    .filter(
      (v) =>
        v.item && (libraryFilter === "all" || v.item.kind === libraryFilter),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const status = params.get("status") || "all";
  if (status !== "all") entries = entries.filter((v) => v.status === status);
  const values = Object.values(library);
  main.innerHTML = `<div class="content"><div class="page-head"><div class="eyebrow">A place for your favorites</div><h1>My library<span style="color:var(--accent)">.</span></h1><p>All the worlds you’re exploring, and the ones waiting for you.</p></div><div class="library-summary"><div><strong>${values.length}</strong><small>Saved stories</small></div><div><strong>${values.filter((v) => v.status === "active").length}</strong><small>In progress</small></div><div><strong>${values.filter((v) => v.status === "completed").length}</strong><small>Completed</small></div></div><div class="filter-bar"><div class="type-tabs">${[
    ["all", "Everything"],
    ["anime", "Anime"],
    ["manga", "Manga"],
    ["manhwa", "Manhwa"],
  ]
    .map(
      ([v, l]) =>
        `<a class="chip ${libraryFilter === v ? "active" : ""}" href="#library?type=${v}&status=${status}">${l}</a>`,
    )
    .join("")}</div><label>Status <select id="library-filter">${[
    ["all", "All statuses"],
    ["planned", "Planned"],
    ["active", "In progress"],
    ["completed", "Completed"],
  ]
    .map(
      ([v, l]) =>
        `<option value="${v}" ${status === v ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label></div><div class="collection-grid">${entries.length ? entries.map((v) => card(v.item, true)).join("") : empty("Your next chapter starts here", "Save a title with the + button and it will have a home right here.", `<a href="#home" class="button">Discover stories ${icon("arrow")}</a>`)}</div><p class="tiny-label" style="margin-top:25px">Your library is saved in this browser. Export a backup from your profile to move it to another device.</p></div>`;
  $("#library-filter").onchange = (e) => {
    location.hash = `library?type=${libraryFilter}&status=${e.target.value}`;
  };
}
async function searchPage(params, version) {
  const q = params.get("q") || "";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(params.get("page")) || 1)));
  searchType = params.get("type") || "all";
  const local = catalog.filter(
    (i) =>
      (searchType === "all" || i.kind === searchType) &&
      (!q ||
        `${i.title} ${i.alternative} ${i.genres.join(" ")}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  main.innerHTML = `<div class="content"><div class="page-head"><div class="eyebrow">Find something worth getting lost in</div><h1>Search stories.</h1><form class="search-page-form" id="search-page-form"><input type="search" id="page-query" value="${esc(q)}" placeholder="A title, a world, a new obsession…" aria-label="Title search" style="background:#1d1b23;border:1px solid #37333f;border-radius:7px;padding:13px;color:white"><button class="button">${icon("search")}Search</button></form></div><div class="filter-bar"><div class="type-tabs">${[
    ["all", "All stories"],
    ["anime", "Anime"],
    ["manga", "Manga"],
    ["manhwa", "Manhwa"],
  ]
    .map(
      ([v, l]) =>
        `<a class="chip ${searchType === v ? "active" : ""}" href="#search?q=${encodeURIComponent(q)}&type=${v}">${l}</a>`,
    )
    .join(
      "",
    )}</div></div><p class="source-label">From the Yoru collection</p><div class="collection-grid">${local.length ? local.map((i) => card(i)).join("") : empty("No matches in the collection", "Try another title, or search the connected provider below.")}</div><section class="section"><div class="section-head"><h2>Beyond the collection</h2></div><div id="remote-results">${!q ? empty("A bigger world awaits", "Search a title above to explore Yoru’s story service.") : !prefs.base ? connectionNotice() : loading("Searching your provider…")}</div></section></div>`;
  $("#search-page-form").onsubmit = (e) => {
    e.preventDefault();
    location.hash = `search?q=${encodeURIComponent($("#page-query").value.trim())}&type=${searchType}`;
  };
  if (!q || !prefs.base) return;
  try {
    const kinds =
      searchType === "all" ? ["anime", "manga", "manhwa"] : [searchType];
    const results = await Promise.allSettled(
      kinds.map((k) => providerPage(q, k, page)),
    );
    if (version !== routeVersion) return;
    let html = "";
    results.forEach((r, i) => {
      html += `<p class="source-label" style="margin-top:25px">${pretty(kinds[i])} · ${esc(providerFor(kinds[i]))}</p>`;
      html +=
        r.status === "fulfilled"
          ? r.value.items.length
            ? `<div class="collection-grid">${r.value.items.map((i) => card(i)).join("")}</div>`
            : empty(
                "No results from this provider",
                "Try a shorter title or search again later.",
              )
          : `<div class="notice error">${esc(networkError(r.reason))}</div>`;
      if (r.status === "fulfilled") {
        const route = p => `#search?${new URLSearchParams({ q, type: kinds[i], page: String(p) })}`;
        html += `<nav class="catalog-pagination" aria-label="${pretty(kinds[i])} search pages">${page > 1 ? `<a class="button secondary" href="${esc(route(page - 1))}">← Previous page</a>` : ""}<span>Page ${page}</span>${r.value.hasNextPage && page < 10000 ? `<a class="button secondary" href="${esc(route(page + 1))}">More ${pretty(kinds[i])} →</a>` : ""}</nav>`;
      }
    });
    $("#remote-results").innerHTML = html;
  } catch (e) {
    if (version === routeVersion)
      $("#remote-results").innerHTML =
        `<div class="notice error">${esc(networkError(e))}</div>`;
  }
}
function matches(items) {
  return items.length
    ? `<p class="tiny-label">Choose the matching edition from the provider. Availability varies by source.</p>${items.map((i) => `<a class="provider-match" href="${link(i)}"><img src="${esc(safeUrl(i.image))}" alt="" loading="lazy"><span><strong>${esc(i.title)}</strong><small>${esc(i.provider)} · ${esc(i.year || pretty(i.kind))}</small></span><span>${icon("arrow")}</span></a>`).join("")}`
    : empty(
        "No matching editions",
        "Try searching an alternate title or check again later.",
        `<a class="button secondary" href="#profile">My profile</a>`,
      );
}
function sourceCredits(data, unit) {
  const credits = [data.sourceCredit, ...(unit?.groups || [])].filter((c) => c?.name && safeUrl(c.url));
  return credits.length ? `<p class="source-credits">Source & credits: ${credits.map((c) => `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>`).join(" · ")}</p>` : "";
}
function readingOptions(data) {
  const links = (data.readingLinks || []).filter(l => l?.name && safeUrl(l.url));
  return links.length ? `<section class="reading-options"><h3>Publisher reading options</h3><p>English translation links listed by MangaDex. These open outside Yoru; payment, sign-in, or regional restrictions may apply.</p><div class="actions">${links.map(l => `<a class="button secondary" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.name)} ↗</a>`).join("")}</div></section>` : "";
}
function unitList(item, data, selected = "") {
  let units = item.kind === "anime" ? data.episodes || [] : data.chapters || [];
  activeUnits = units;
  activeTotalKnown = !data.chapterPagination?.hasNextPage && data.chapterPagination?.chapter === undefined;
  activeItem = item;
  const done = new Set(library[item.key]?.done || []);
  if (!units.length)
    return empty(
      item.kind === "anime" ? "No episodes returned" : "No chapters returned",
      item.kind === "anime" ? "This source did not return episodes for this edition." : data.chapterPagination?.chapter !== undefined ? "No hosted English upload was found for this chapter number. Try Show all or a publisher reading option." : "This source has no hosted English chapters for this edition right now. Check the publisher options above, if available, or find another edition.",
      `<a class="button secondary" href="#search?type=${item.kind}&q=${encodeURIComponent(item.title)}">Find another edition</a>`,
    );
  return item.kind === "anime"
    ? `<div class="episode-grid">${units.map((u, i) => `<a class="episode ${String(u.id) === selected ? "current" : ""} ${done.has(String(u.id)) ? "done" : ""}" title="${esc(u.title || "Episode " + (u.number || i + 1))}" href="#watch/${encodeURIComponent(item.key)}?unit=${encodeURIComponent(u.id)}">${done.has(String(u.id)) ? "✓ " : ""}${esc(u.number || i + 1)}</a>`).join("")}</div>`
    : `<div class="chapter-list">${units.map((u, i) => `<a class="chapter" href="#read/${encodeURIComponent(item.key)}?unit=${encodeURIComponent(u.id)}"><span>${done.has(String(u.id)) ? '<span class="chapter-read">✓ </span>' : ""}${esc(u.title || "Chapter " + (u.chapterNumber || i + 1))}</span><small>Read →</small></a>`).join("")}</div>`;
}
async function titlePage(key, version) {
  const item = all.get(key);
  if (!item) return missing();
  const saved = !!library[key];
  main.innerHTML = `<div class="content" style="padding-bottom:15px"><a class="breadcrumb" href="#${item.kind}">${icon("back")}Back to ${pretty(item.kind)}</a></div><section class="detail-hero"><img class="detail-cover" src="${esc(safeUrl(item.image))}" alt="${esc(item.title)} cover"><div class="detail-copy"><div class="eyebrow">${pretty(item.kind)} · ${item.editorial ? "The Yoru collection" : esc(item.provider)}</div><h1>${esc(item.title)}</h1><div class="meta"><span>${esc(item.year)}</span><span class="dot"></span><span>${esc(totalLabel(item))}</span><span class="dot"></span><span>${esc(item.status)}</span></div><p>${esc(item.description || "Explore this edition and its available episodes or chapters below.")}</p><div class="actions"><button class="button" data-find="${esc(key)}">${icon(item.kind === "anime" ? "play" : "book")}${item.kind === "anime" ? "Find episodes" : "Find chapters"}</button><button class="button secondary" data-save="${esc(key)}" aria-pressed="${saved}">${icon(saved ? "check" : "plus")}${saved ? "In my library" : "My list"}</button></div></div></section><div class="content detail-layout"><section class="section"><div class="section-head"><h2>${item.editorial ? "Available editions" : item.kind === "anime" ? "Episodes" : "Chapters"}</h2><span class="tiny-label">${esc(item.provider || providerFor(item.kind))}</span></div><div id="units-panel">${item.editorial ? (prefs.base ? empty("Ready for your next chapter?", `Find this title on ${esc(providerFor(item.kind))} to see available ${item.kind === "anime" ? "episodes" : "chapters"}.`, `<button class="button secondary" data-find="${esc(key)}">Find ${item.kind === "anime" ? "episodes" : "chapters"} ${icon("arrow")}</button>`) : connectionNotice()) : loading("Loading available entries…")}</div></section><aside class="side-panel"><h3>Story details</h3><dl><div><dt>Format</dt><dd>${pretty(item.kind)}</dd></div><div><dt>Released</dt><dd>${esc(item.year || "Not listed")}</dd></div><div><dt>Genres</dt><dd>${esc(item.genres?.join(" · ") || "Not listed")}</dd></div><div><dt>Status</dt><dd>${esc(item.status || "Unknown")}</dd></div></dl></aside></div>`;
  if (item.editorial && item.kind === "anime") {
    $("[data-find]").innerHTML = icon("play") + "Watch now";
    $("#units-panel").innerHTML = loading("Loading episode guide…");
    $("#units-panel").previousElementSibling.querySelector("h2").textContent = "Episodes";
  }
  if (!item.editorial || item.kind === "anime") {
    try {
      const data = await details(item);
      if (version !== routeVersion) return;
      renderTitleUnits(item, data, version);
    } catch (e) {
      if (version === routeVersion)
        $("#units-panel").innerHTML = errorPanel(e, key);
    }
  } else {
    await findEdition(key);
  }
}
function renderTitleUnits(item, data, version) {
  const panel = $("#units-panel"), pagination = data.chapterPagination;
  panel.innerHTML = (data.playbackNotice ? `<p class="embed-notice">${esc(data.playbackNotice)}</p>` : "") + (pagination ? `<p class="embed-notice">English chapters · ${pagination.chapter !== undefined ? "Filtered chapter results" : `Loaded through source page ${pagination.currentPage} of ${pagination.totalPages}`}. Load more for older/later entries, or find a chapter number. Alternate uploads are grouped by chapter.</p><form id="chapter-search" class="catalog-search"><input type="number" min="0" step="any" id="chapter-number" aria-label="Chapter number" placeholder="Chapter number (e.g. 1 or 12.5)" value="${esc(pagination.chapter ?? "")}"><button class="button secondary">Find chapter</button><button class="button secondary" type="button" id="reset-chapters">Show all</button></form><p id="chapter-status" role="status"></p>` : "") + unitList(item, data) + (pagination?.hasNextPage ? '<button class="button secondary" id="more-chapters">Load more chapters</button>' : "");
  if (item.kind !== "anime") {
    const availability = chapterAvailability(data);
    if (pagination?.chapter === undefined) saveAvailability(item, availability);
    const first = availability.first;
    panel.insertAdjacentHTML("afterbegin", readingOptions(data) + `<p class="reading-coverage">${availability.state === "hosted" ? `English chapters are listed below, but this does not mean the whole series is available.${first != null && Number(first) > 1 && pagination?.currentPage === 1 && pagination?.chapter === undefined ? ` The first available chapter is ${esc(first)}; earlier chapters are missing from this source.` : ""}` : availability.state === "none" ? "No hosted English chapters in this result." : "Chapter availability could not be confirmed."}</p>`);
  }
  if (!pagination) return;
  const loadPage = async (page, chapter, replace) => {
    panel.querySelectorAll("button").forEach(b => b.disabled = true);
    $("#chapter-status").textContent = "Loading chapters…";
    try {
      const result = await api(`manga/${item.provider}/chapters?${new URLSearchParams({ id: item.id, page: String(page), ...(chapter !== undefined ? { chapter } : {}) })}`, item.base);
      if (version !== routeVersion) return;
      const chapters = new Map();
      for (const c of [...(replace ? [] : data.chapters), ...result.chapters]) {
        const chapterKey = c.chapterNumber == null ? c.id : String(c.chapterNumber);
        if (!chapters.has(chapterKey)) chapters.set(chapterKey, c);
      }
      data.chapters = [...chapters.values()].sort((a,b) => Number(a.chapterNumber) - Number(b.chapterNumber));
      data.chapterPagination = result.chapterPagination;
      renderTitleUnits(item, data, version);
    } catch (e) {
      if (version !== routeVersion) return;
      $("#chapter-status").textContent = networkError(e);
      panel.querySelectorAll("button").forEach(b => b.disabled = false);
    }
  };
  $("#chapter-search").onsubmit = e => { e.preventDefault(); const value = $("#chapter-number").value.trim(); loadPage(1, value || undefined, true); };
  $("#reset-chapters").onclick = () => loadPage(1, undefined, true);
  if ($("#more-chapters")) $("#more-chapters").onclick = () => loadPage(pagination.currentPage + 1, pagination.chapter, false);
}
function errorPanel(error, key) {
  return `<div class="notice error">${esc(networkError(error))}</div><div class="actions"><button class="button secondary" data-find="${esc(key)}">Try again</button><a class="button secondary" href="#profile">My profile</a></div>`;
}
async function findEdition(key) {
  const item = all.get(key),
    panel = $("#units-panel"),
    version = routeVersion;
  if (!item || !panel) return;
  if (item.editorial && item.kind === "anime") {
    location.hash = `watch/${encodeURIComponent(key)}`;
    return;
  }
  if (!prefs.base && item.editorial) {
    panel.innerHTML = connectionNotice();
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  panel.innerHTML = loading(
    item.editorial ? "Finding matching editions…" : "Loading entries…",
  );
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    if (item.editorial) {
      const data = await searchProvider(item.title, item.kind);
      if (version === routeVersion) panel.innerHTML = matches(data);
    } else {
      detailCache.delete(key);
      const data = await details(item);
      if (version === routeVersion) renderTitleUnits(item, data, version);
    }
  } catch (e) {
    if (version === routeVersion) panel.innerHTML = errorPanel(e, key);
  }
}
function missing() {
  main.innerHTML = `<div class="content section">${empty("This story isn’t in this browser yet", "Open a title from the collection, your library, or provider search.", `<a href="#home" class="button">Back to discover</a>`)}</div>`;
}
async function watchPage(key, params, version) {
  const item = all.get(key);
  if (!item || item.kind !== "anime") return missing();
  const unitId = params.get("unit");
  main.innerHTML = `<div class="content"><a class="breadcrumb" href="${link(item)}">${icon("back")}Back to ${esc(item.title)}</a><h1 class="watch-title">${esc(item.title)}</h1><div class="player" id="player">${loading("Finding video sources…")}</div><div id="video-message"></div><div id="player-controls"></div><section class="section"><div class="section-head"><h2>Episodes</h2></div><div id="watch-episodes">${loading()}</div></section></div>`;
  try {
    const data = await details(item);
    if (version !== routeVersion) return;
    const unit =
      data.episodes?.find((u) => String(u.id) === unitId) || data.episodes?.[0];
    if (!unit) throw new Error("This edition has no episodes available.");
    $("#watch-episodes").innerHTML = unitList(item, data, String(unit.id));
    if (item.editorial || item.provider === "megaplay") {
      showEmbedPlayer(item, data, unit, params, version);
      return;
    }
    const sources = await api(
      `anime/${item.provider}/watch?episodeId=${encodeURIComponent(unit.id)}`,
      item.base,
    );
    if (version !== routeVersion) return;
    const choices = (sources.sources || []).filter((s) => safeUrl(s.url));
    if (!choices.length)
      throw new Error(
        "The provider did not return a playable source for this episode.",
      );
    const index = activeUnits.findIndex(
        (u) => String(u.id) === String(unit.id),
      ),
      next = activeUnits[index + 1],
      previous = activeUnits[index - 1];
    $("#player").innerHTML =
      `<video id="video" controls playsinline preload="metadata" aria-label="${esc(item.title)} episode ${esc(unit.number || index + 1)}" crossorigin="anonymous"></video>`;
    const video = $("#video");
    for (const sub of sources.subtitles || []) {
      const url = safeUrl(sub.url);
      if (!url || sub.lang === "Thumbnails") continue;
      const t = document.createElement("track");
      t.kind = "subtitles";
      t.label = sub.lang || "Subtitles";
      t.srclang = (sub.lang || "en").slice(0, 2).toLowerCase();
      t.src = url;
      video.append(t);
    }
    $("#player-controls").innerHTML =
      `<div class="player-controls"><div class="meta"><span>Episode ${esc(unit.number || index + 1)}</span><label>Quality <select id="quality" aria-label="Video quality">${choices.map((s, i) => `<option value="${i}">${esc(s.quality || "Source " + (i + 1))}</option>`).join("")}</select></label></div><div class="actions">${previous ? `<a class="button secondary small" href="#watch/${encodeURIComponent(key)}?unit=${encodeURIComponent(previous.id)}">← Previous</a>` : ""}${next ? `<a class="button secondary small" href="#watch/${encodeURIComponent(key)}?unit=${encodeURIComponent(next.id)}">Next episode →</a>` : ""}</div></div>`;
    const restored = library[key]?.progress;
    const initial = restored?.id === String(unit.id) ? restored.time || 0 : 0;
    let pendingSeek = initial;
    const mediaError = () => {
      $("#video-message").innerHTML =
        '<div class="notice error">Playback could not start. The source may be unavailable or may not allow playback from this browser. Try another quality or another edition.</div>';
    };
    function setSource(index) {
      const s = choices[index];
      if (hls) {
        hls.destroy();
        hls = null;
      }
      $("#video-message").innerHTML = "";
      const url = safeUrl(s.url);
      if (
        (s.isM3U8 || /\.m3u8(?:\?|$)/i.test(url)) &&
        !video.canPlayType("application/vnd.apple.mpegurl") &&
        window.Hls?.isSupported()
      ) {
        hls = new window.Hls();
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_, d) => {
          if (d.fatal) mediaError();
        });
      } else {
        video.src = url;
      }
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (pendingSeek && Number.isFinite(video.duration))
            video.currentTime = Math.min(
              pendingSeek,
              Math.max(0, video.duration - 2),
            );
          if (prefs.autoplay) video.play().catch(() => {});
        },
        { once: true },
      );
    }
    video.addEventListener("error", mediaError);
    let lastSave = 0;
    video.addEventListener("timeupdate", () => {
      if (Date.now() - lastSave > 5000 && video.currentTime > 0) {
        lastSave = Date.now();
        progress(item, unit, {
          time: video.currentTime,
          duration: video.duration || 0,
        });
      }
    });
    video.addEventListener("pause", () => {
      if (video.currentTime > 0)
        progress(item, unit, {
          time: video.currentTime,
          duration: video.duration || 0,
        });
    });
    video.addEventListener("ended", () => {
      markDone(item, unit);
      if (prefs.autoplay && next)
        location.hash = `watch/${encodeURIComponent(key)}?unit=${encodeURIComponent(next.id)}`;
    });
    $("#quality").onchange = (e) => {
      pendingSeek = video.currentTime;
      setSource(Number(e.target.value));
    };
    setSource(0);
  } catch (e) {
    if (version === routeVersion) {
      $("#player").innerHTML = empty(
        "Episode unavailable",
        esc(networkError(e)),
        `<a class="button secondary" href="${link(item)}">Back to editions</a>`,
      );
      $("#watch-episodes").innerHTML = "";
    }
  }
}
function showEmbedPlayer(item, data, unit, params, version) {
  const key = item.key;
  const index = data.episodes.findIndex((e) => String(e.id) === String(unit.id));
  const previous = data.episodes[index - 1], next = data.episodes[index + 1];
  let language = params.get("audio") === "dub" ? "dub" : "sub";
  const route = (u) => `#watch/${encodeURIComponent(key)}?unit=${encodeURIComponent(u.id)}&audio=${language}`;
  $("#player-controls").innerHTML = `<div class="player-controls"><div class="meta"><span>Episode ${esc(unit.number)} · MegaPlay</span><label>Audio <select id="embed-audio"><option value="sub">Japanese · Sub</option><option value="dub">English · Dub</option></select></label><button class="button secondary small" id="reload-embed">Reload player</button></div><div class="actions">${previous ? `<a class="button secondary small" id="embed-prev">← Previous</a>` : ""}${next ? `<a class="button secondary small" id="embed-next">Next episode →</a>` : ""}</div></div><p class="tiny-label">Video is supplied by MegaPlay. Availability and subtitles vary; the embedded player may display third-party ads. Your place is saved when the player reports progress. Automatic seeking to a saved time is not supported.</p>`;
  $("#player-controls .tiny-label").className = "embed-notice";
  $("#player-controls").insertAdjacentHTML("beforeend", sourceCredits(data));
  $("#embed-audio").value = language;
  let frame, lastSave = 0;
  const setEmbed = () => {
    $("#video-message").textContent = "";
    const url = embedUrl(data.id, unit.number, language);
    frame = document.createElement("iframe");
    frame.title = `${item.title} — Episode ${unit.number} (${language})`;
    frame.src = url;
    frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    // MegaPlay requires a standard cross-origin iframe and rejects sandboxed embeds.
    $("#player").replaceChildren(frame);
    if (previous) $("#embed-prev").href = route(previous);
    if (next) $("#embed-next").href = route(next);
    document.querySelectorAll("#watch-episodes .episode").forEach((a) => { a.href = a.getAttribute("href").split("&audio=")[0] + `&audio=${language}`; });
  };
  const onMessage = (event) => {
    if (routeVersion !== version) return;
    const message = playerEvent(event, frame?.contentWindow);
    if (!message) return;
    if (message.type === "progress" && Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      progress(item, unit, { time: message.time, duration: message.duration, audio: language });
    } else if (message.type === "complete") {
      markDone(item, unit);
      if (prefs.autoplay && next) location.hash = route(next);
    } else if (message.type === "error") {
      $("#video-message").textContent = "MegaPlay could not play this episode. Try the other audio option or reload the player.";
    }
  };
  window.addEventListener("message", onMessage);
  disposeEmbed = () => { window.removeEventListener("message", onMessage); frame?.remove(); };
  $("#embed-audio").onchange = (e) => { language = e.target.value; history.replaceState(null, "", route(unit)); setEmbed(); };
  $("#reload-embed").onclick = setEmbed;
  setEmbed();
}
async function readerPage(key, params, version) {
  const item = all.get(key);
  if (!item || item.editorial) return missing();
  main.innerHTML = `<div class="reader-toolbar"><a href="${link(item)}">← ${esc(item.title)}</a><h2 id="chapter-title">Loading chapter…</h2></div><div id="reader-body">${loading("Loading chapter pages…")}</div>`;
  try {
    const data = await details(item);
    if (version !== routeVersion) return;
    const requested = params.get("unit");
    if (item.provider === "mangadex" && requested && !data.chapters?.some(c => String(c.id) === requested)) {
      const found = await api(`manga/mangadex/chapter?${new URLSearchParams({ id: item.id, chapterId: requested })}`, item.base);
      if (version !== routeVersion) return;
      data.chapters = [...data.chapters, found].sort((a,b) => Number(a.chapterNumber) - Number(b.chapterNumber));
    }
    if (item.provider === "comick" && requested && !data.chapters?.some(c => String(c.id) === requested)) {
      const number = requested.match(/-chapter-(\d+(?:\.\d+)?)-en$/)?.[1];
      if (number && requested.startsWith(item.id + "/")) {
        const found = await api(`manga/comick/chapters?${new URLSearchParams({ id: item.id, chapter: number })}`, item.base);
        if (version !== routeVersion) return;
        data.chapters = [...data.chapters, ...found.chapters.filter(c => !data.chapters.some(old => old.id === c.id))].sort((a,b) => Number(a.chapterNumber) - Number(b.chapterNumber));
      }
    }
    activeUnits = data.chapters || [];
    activeTotalKnown = !data.chapterPagination?.hasNextPage && data.chapterPagination?.chapter === undefined;
    activeItem = item;
    const unit = requested ? activeUnits.find((u) => String(u.id) === requested) : activeUnits[0];
    if (!unit) throw new Error("No chapter is available for this edition.");
    const response = await api(
      `manga/${item.provider}/read?chapterId=${encodeURIComponent(unit.id)}`,
      item.base,
    );
    if (version !== routeVersion) return;
    readerPages = (Array.isArray(response) ? response : response.pages || [])
      .filter((p) => safeUrl(p.img || p.url))
      .sort((a, b) => (Number(a.page) || 0) - (Number(b.page) || 0));
    if (!readerPages.length)
      throw new Error("The provider returned no readable pages.");
    const saved = library[key]?.progress;
    readerIndex =
      saved?.id === String(unit.id)
        ? Math.min(saved.page || 0, readerPages.length - 1)
        : 0;
    const idx = activeUnits.findIndex((u) => u.id === unit.id),
      next = activeUnits[idx + 1];
    $(".reader-toolbar").innerHTML =
      `<a href="${link(item)}">← ${esc(item.title)}</a><h2>${esc(unit.title || "Chapter " + (unit.chapterNumber || idx + 1))}</h2><div class="reader-mode"><button class="chip active" data-mode="scroll">Scroll</button><button class="chip" data-mode="paged">Pages</button></div><span class="reader-progress" id="reader-progress"></span>`;
    $("#reader-body").innerHTML =
      `<div class="reader-pages" id="reader-pages">${readerPages.map((p, i) => `<img src="${esc(safeUrl(p.img || p.url))}" alt="Page ${i + 1}" data-page="${i}" loading="${i < 2 ? "eager" : "lazy"}" referrerpolicy="no-referrer">`).join("")}</div><div class="reader-controls"><button class="button secondary" id="prev-page">← Previous page</button><button class="button secondary" id="next-page">Next page →</button><button class="button" id="chapter-done">Mark chapter read</button>${next ? `<a class="button secondary" href="#read/${encodeURIComponent(key)}?unit=${encodeURIComponent(next.id)}">Next chapter →</a>` : ""}</div>`;
    // Resume in single-page mode to avoid lazy image layout shifting the saved position.
    readerMode = readerIndex > 0 ? "paged" : "scroll";
    $("#reader-body").insertAdjacentHTML("afterbegin", sourceCredits(data, unit));
    $("#reader-body").insertAdjacentHTML("afterbegin", '<p class="notice error" id="reader-image-error" role="status" hidden></p>');
    $("#reader-pages").querySelectorAll("img").forEach(img => {
      img.onerror = () => {
        if (version !== routeVersion) return;
        $("#reader-image-error").hidden = false;
        $("#reader-image-error").innerHTML = `Some pages could not load from the image host. Reload the chapter, use the source link below, or <a href="#search?type=${item.kind}&q=${encodeURIComponent(item.title)}">find another edition</a>.`;
        img.alt = "Page could not load. The image source may be unavailable.";
        img.style.minHeight = "160px";
      };
      if (img.complete && !img.naturalWidth) img.onerror();
    });
    const update = () => {
      $("#reader-progress").textContent =
        `Page ${readerIndex + 1} of ${readerPages.length}`;
      progress(item, unit, { page: readerIndex });
      $("#prev-page").disabled = readerIndex === 0;
      $("#next-page").disabled = readerIndex === readerPages.length - 1;
    };
    const renderMode = () => {
      observer?.disconnect();
      $("#reader-pages").classList.toggle("paged", readerMode === "paged");
      $("#reader-pages")
        .querySelectorAll("img")
        .forEach(
          (img, i) =>
            (img.hidden = readerMode === "paged" && i !== readerIndex),
        );
      document
        .querySelectorAll("[data-mode]")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.mode === readerMode),
        );
      if (readerMode === "scroll") {
        observer = new IntersectionObserver(
          (entries) => {
            for (const en of entries) {
              if (en.isIntersecting) {
                readerIndex = Number(en.target.dataset.page);
                update();
              }
            }
          },
          { rootMargin: "-10% 0px -50% 0px", threshold: 0 },
        );
        $("#reader-pages")
          .querySelectorAll("img")
          .forEach((img) => observer.observe(img));
      }
      update();
    };
    const go = (delta) => {
      readerIndex = Math.max(
        0,
        Math.min(readerPages.length - 1, readerIndex + delta),
      );
      if (readerMode === "paged") {
        renderMode();
        window.scrollTo(0, 0);
      } else {
        $(`[data-page="${readerIndex}"]`).scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
      update();
    };
    $("#prev-page").onclick = () => go(-1);
    $("#next-page").onclick = () => go(1);
    $("#chapter-done").onclick = () => {
      markDone(item, unit);
      toast("Chapter marked as read");
    };
    document.querySelectorAll("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          readerMode = b.dataset.mode;
          renderMode();
        }),
    );
    renderMode();
  } catch (e) {
    if (version === routeVersion)
      $("#reader-body").innerHTML =
        `<div class="content section">${empty("Chapter unavailable", esc(networkError(e)), `<a href="${link(item)}" class="button secondary">Back to chapters</a>`)}</div>`;
  }
}
function updateProfileAvatar() {
  const avatar = document.querySelector(".header-actions .avatar");
  if (avatar) avatar.textContent = Array.from(profile.name.trim() || "Y")[0].toUpperCase();
}
function resumeLink(entry) {
  if (entry.progress?.id && (!entry.item.editorial || entry.item.kind === "anime")) {
    return `#${entry.item.kind === "anime" ? "watch" : "read"}/${encodeURIComponent(entry.item.key)}?unit=${encodeURIComponent(entry.progress.id)}${entry.item.kind === "anime" ? `&audio=${entry.progress.audio === "dub" ? "dub" : "sub"}` : ""}`;
  }
  return link(entry.item);
}
function profilePage() {
  const entries = Object.values(library).filter((v) => v?.item?.key);
  const active = entries.filter((v) => v.status === "active").sort((a, b) => b.updatedAt - a.updatedAt);
  const completed = entries.filter((v) => v.status === "completed");
  const recent = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const initial = Array.from(profile.name.trim() || "Y")[0].toUpperCase();
  const journey = active.slice(0, 3).map((v) => `<a class="journey-row" href="${resumeLink(v)}"><img src="${esc(safeUrl(v.item.image))}" alt="" loading="lazy"><span><small>${pretty(v.item.kind)}</small><strong>${esc(v.item.title)}</strong><span>${v.progress?.number ? esc((v.item.kind === "anime" ? "Episode " : "Chapter ") + v.progress.number) : "Ready when you are"}${Number.isInteger(v.progress?.page) ? " · Page " + (v.progress.page + 1) : ""}</span></span><span class="journey-go">${icon(v.item.kind === "anime" ? "play" : "book")}</span></a>`).join("");
  main.innerHTML = `<div class="content profile-dashboard">
    <div class="profile-heading"><div><div class="eyebrow">Your corner of Yoru</div><h1>My profile<span>.</span></h1></div><span class="device-badge"><span></span>Saved on this device</span></div>
    <section class="profile-banner" aria-label="Your profile"><div class="profile-identity"><div class="profile-avatar" aria-hidden="true">${esc(initial)}</div><div><span class="tiny-label">THE NEXT CHAPTER IS YOURS</span><h2>${esc(profile.name)}</h2><p>${esc(profile.bio)}</p></div></div><a class="button secondary" href="#library">${icon("bookmark")}My library</a></section>
    <div class="profile-stats"><a href="#library"><span class="stat-icon">${icon("bookmark")}</span><div><strong>${entries.length}</strong><span>Saved stories</span></div>${icon("arrow")}</a><a href="#library?status=active"><span class="stat-icon">${icon("play")}</span><div><strong>${active.length}</strong><span>In progress</span></div>${icon("arrow")}</a><a href="#library?status=completed"><span class="stat-icon">${icon("check")}</span><div><strong>${completed.length}</strong><span>Completed</span></div>${icon("arrow")}</a></div>
    <div class="profile-columns"><div class="profile-main">
      <section class="profile-panel"><div class="section-head"><div><div class="eyebrow">Pick up where you left off</div><h2>Continue your journey</h2></div><a class="text-link" href="#library?status=active">View all →</a></div>${journey || `<div class="profile-empty"><span>${icon("book")}</span><h3>Your next adventure is waiting.</h3><p>Start a story or mark a saved title as in progress.<br>Your watch and reading progress will appear here.</p><a href="#home" class="button">Discover stories ${icon("arrow")}</a></div>`}</section>
      <section class="profile-panel"><div class="section-head"><h2>Your worlds</h2><span class="tiny-label">A home for every story</span></div><div class="profile-worlds">${["anime", "manga", "manhwa"].map((kind, i) => `<a href="#library?type=${kind}" class="profile-world world-${kind}"><span>0${i + 1} / ${icon(kind === "anime" ? "play" : "book")}</span><strong>${pretty(kind)}</strong><small>${entries.filter((v) => v.item.kind === kind).length} saved <span>↗</span></small></a>`).join("")}</div></section>
      <section class="profile-panel"><div class="section-head"><h2>Recently saved</h2><a class="text-link" href="#library">Open library →</a></div>${recent.length ? `<div class="profile-recent">${recent.map((v) => `<a href="${link(v.item)}"><img src="${esc(safeUrl(v.item.image))}" alt="${esc(v.item.title)} cover" loading="lazy"><strong>${esc(v.item.title)}</strong><span>${pretty(v.item.kind)}</span></a>`).join("")}</div>` : `<p class="profile-note">Tap + on any title to make it part of your collection.</p>`}</section>
    </div><aside class="profile-side">
      <section class="profile-panel"><div class="eyebrow">Make yourself at home</div><h2>Profile details</h2><form id="profile-form"><label class="field"><span>Display name</span><input type="text" id="profile-name" maxlength="32" required value="${esc(profile.name)}" autocomplete="nickname"></label><label class="field"><span>A little about you</span><textarea id="profile-bio" maxlength="120" rows="3">${esc(profile.bio)}</textarea></label><button type="submit" class="button">Save profile</button><p class="profile-note">A local profile, just for you. No account or cloud sync.</p></form></section>
      <section class="profile-panel"><h2>Playback</h2><label class="setting-line"><input type="checkbox" id="autoplay" ${prefs.autoplay ? "checked" : ""}><span>Autoplay next episode<small>Keep the story going automatically.</small></span></label></section>
      <section class="profile-panel profile-backup"><h2>Your library, kept safe</h2><p>Take your collection with you when changing browsers.</p><div class="backup-actions"><button class="button secondary" id="export-library">Export library ↓</button><button class="button secondary" id="import-library">Import backup ↑</button></div><input id="backup-file" type="file" accept="application/json,.json" hidden><details><summary>Manage saved data</summary><p>This only affects this browser. Export a backup first.</p><button class="button secondary" id="clear-library">Clear library</button></details></section>
    </aside></div></div>`;
  $("#profile-form").onsubmit = (e) => {
    e.preventDefault();
    const name = $("#profile-name").value.trim();
    if (!name) { $("#profile-name").setCustomValidity("Enter a display name."); $("#profile-name").reportValidity(); return; }
    profile = { name: name.slice(0, 32), bio: $("#profile-bio").value.trim().slice(0, 120) };
    persist("profile", profile);
    updateProfileAvatar();
    profilePage();
    toast("Profile saved");
  };
  $("#profile-name").oninput = (e) => e.target.setCustomValidity("");
  $("#autoplay").onchange = (e) => {
    prefs.autoplay = e.target.checked;
    persist("settings", { autoplay: prefs.autoplay });
    toast("Playback preference saved");
  };
  $("#export-library").onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, library }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "yoru-library.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $("#import-library").onclick = () => $("#backup-file").click();
  $("#backup-file").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2000000) throw new Error("This backup is too large.");
      const data = JSON.parse(await file.text());
      if (
        data.version !== 1 ||
        !data.library ||
        Array.isArray(data.library) ||
        typeof data.library !== "object"
      )
        throw new Error("Choose a Yoru library backup.");
      const clean = {};
      for (const [key, value] of Object.entries(data.library)) {
        if (
          ["__proto__", "prototype", "constructor"].includes(key) ||
          !value ||
          !value.item ||
          value.item.key !== key ||
          typeof value.item.title !== "string" ||
          !["anime", "manga", "manhwa"].includes(value.item.kind) ||
          !Array.isArray(value.item.genres)
        )
          throw new Error("This backup contains an invalid title.");
        clean[key] = {
          item: value.item,
          status: ["planned", "active", "completed"].includes(value.status)
            ? value.status
            : "planned",
          done: Array.isArray(value.done) ? value.done.map(String) : [],
          progress:
            value.progress && typeof value.progress === "object"
              ? value.progress
              : null,
          updatedAt: Number(value.updatedAt) || Date.now(),
        };
      }
      library = { ...library, ...clean };
      for (const v of Object.values(clean)) remember(v.item);
      persist("library", library);
      count();
      profilePage();
      toast("Library restored");
    } catch (e) {
      toast(e.message || "Could not read the backup.");
    }
  };
  $("#clear-library").onclick = () => $("#confirm-dialog").showModal();
}
function about() {
  main.innerHTML = `<div class="content settings-layout"><div class="page-head"><div class="eyebrow">The night is yours</div><h1>Welcome to Yoru.</h1><p>A home for your anime, manga, and manhwa adventures.</p></div><section class="settings-card"><h2>Find your next obsession</h2><p>Browse a handpicked collection, find editions through Yoru’s story service, and keep your favorites in one place. The video player supports compatible HLS and MP4 sources; the reader offers continuous scrolling and single-page modes.</p><h3>Artwork & sources</h3><p>Collection artwork and title metadata were retrieved from AniList. Artwork belongs to the respective creators and publishers. Featured selections are editorial picks, not live popularity rankings. Consumet supplies provider search and content references when connected; availability depends on the selected provider.</p><h3>Your data stays with you</h3><p>Your profile, favorites, and progress are stored in this browser, not a cloud account. Export your library from your profile for a backup. Search requests use Yoru’s managed story service. Video and chapter images load from the source URLs it returns.</p><div class="actions"><a href="#home" class="button">Explore Yoru ${icon("arrow")}</a><a href="#profile" class="button secondary">My profile</a></div></section></div>`;
}
async function render() {
  routeVersion++;
  const version = routeVersion;
  routeAbort?.abort();
  disposeEmbed?.();
  disposeEmbed = null;
  routeAbort = new AbortController();
  const oldVideo = $("#video");
  if (oldVideo) oldVideo.pause();
  if (hls) {
    hls.destroy();
    hls = null;
  }
  observer?.disconnect();
  observer = null;
  const hash = location.hash.slice(1) || "home",
    parts = hash.split("?"),
    [page, rawKey] = parts[0].split("/");
  let key;
  try {
    key = decodeURIComponent(rawKey || "");
  } catch {
    return missing();
  }
  const params = new URLSearchParams(parts.slice(1).join("?"));
  document.querySelectorAll("[data-nav]").forEach((a) => {
    const active = a.dataset.nav === page;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
  document.title =
    page === "home"
      ? "Yoru — Find your next obsession"
      : `${all.get(key)?.title || { anime: "Anime", manga: "Manga", manhwa: "Manhwa", library: "My library", search: "Search", profile: "My profile", settings: "My profile", about: "About" }[page] || "Yoru"} · Yoru`;
  try {
    if (["title", "watch", "read"].includes(page) && !all.has(key)) {
      main.innerHTML = `<div class="content">${loading("Loading story…")}</div>`;
      await resolveTitle(key);
      if (version !== routeVersion) return;
    }
    if (page === "home") home();
    else if (["anime", "manga", "manhwa"].includes(page)) await browse(page, params, version);
    else if (page === "library") libraryPage(params);
    else if (page === "search") await searchPage(params, version);
    else if (page === "title") await titlePage(key, version);
    else if (page === "watch") await watchPage(key, params, version);
    else if (page === "read") await readerPage(key, params, version);
    else if (page === "profile" || page === "settings") profilePage();
    else if (page === "about") about();
    else missing();
  } catch (e) {
    if (version === routeVersion)
      main.innerHTML = `<div class="content section">${empty("Something interrupted the story", esc(networkError(e)), `<a class="button" href="#home">Back to discover</a>`)}</div>`;
  }
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".skip")) {
    e.preventDefault();
    main.focus();
    main.scrollIntoView();
    return;
  }
  const saveButton = e.target.closest("[data-save]");
  if (saveButton) {
    const item = all.get(saveButton.dataset.save);
    if (item) save(item);
    if (location.hash.startsWith("#library")) render();
    return;
  }
  const homeButton = e.target.closest("[data-home-type]");
  if (homeButton) {
    homeType = homeButton.dataset.homeType;
    home();
    return;
  }
  const findButton = e.target.closest("[data-find]");
  if (findButton) findEdition(findButton.dataset.find);
});
document.addEventListener("change", (e) => {
  if (e.target.matches("[data-status]")) {
    const entry = library[e.target.dataset.status];
    if (entry) {
      entry.status = e.target.value;
      entry.updatedAt = Date.now();
      persist("library", library);
      toast("Library updated");
      render();
    }
  }
});
$("#header-search").onsubmit = (e) => {
  e.preventDefault();
  location.hash = "search?q=" + encodeURIComponent($("#search").value.trim());
  $("#search").blur();
};
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
  ) {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key === "Escape") document.activeElement.blur();
});
$("#confirm-dialog").addEventListener("close", () => {
  if ($("#confirm-dialog").returnValue === "clear") {
    library = {};
    persist("library", library);
    count();
    if (["#profile", "#settings", "#library"].some((route) => location.hash.startsWith(route))) render();
    toast("Library cleared");
  }
});
window.addEventListener("hashchange", render);
window.addEventListener("storage", (e) => {
  if (e.key === "yoru-library") {
    library = read("library", {});
    count();
    if (["#library", "#profile", "#settings"].some((route) => location.hash.startsWith(route))) render();
  }
  if (e.key === "yoru-profile") { const next = read("profile", {}); if (typeof next.name === "string" && typeof next.bio === "string") { profile = {name: next.name.slice(0, 32), bio: next.bio.slice(0, 120)}; updateProfileAvatar(); if (location.hash.startsWith("#profile")) render(); } }
});
updateProfileAvatar();
main.innerHTML = loading("Opening your next world…");
try {
  catalog = await loadCatalog();
  for (const item of catalog) all.set(item.key, item);
  for (const item of Object.values(remoteCache))
    if (item?.key) all.set(item.key, item);
  for (const entry of Object.values(library))
    if (entry?.item?.key) all.set(entry.item.key, entry.item);
  count();
  render();
} catch (e) {
  main.innerHTML = `<div class="content section">${empty("The collection could not load", esc(networkError(e)), `<button class="button" onclick="location.reload()">Try again</button>`)}</div>`;
}
