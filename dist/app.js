import { loadCatalog, normalize, safeUrl } from "./catalog.js";
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
let prefs = {
  base: isLocal ? location.origin + "/api" : "",
  anime: "hianime",
  manga: "mangadex",
  manhwa: "mangadex",
  autoplay: false,
  ...read("settings", {}),
};
let library = read("library", {}),
  remoteCache = read("remote", {}),
  catalog = [],
  all = new Map(),
  detailCache = new Map();
let routeVersion = 0,
  routeAbort = null,
  hls = null,
  observer = null,
  toastTimer,
  libraryFilter = "all",
  searchType = "all",
  homeType = "all";
let activeUnits = [],
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
  if (activeUnits.length && entry.done.length >= activeUnits.length)
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
  if (!base)
    throw new Error(
      "Connect a Consumet server in Settings to load episodes and chapters.",
    );
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
        "The source took too long to respond. Try again or choose another provider.",
      );
    throw new Error(
      "Cannot reach the Consumet server. Check the URL, HTTPS, and the server’s allowed origins.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server did not return API data. Check the API base URL.",
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
async function searchProvider(query, kind) {
  const provider = providerFor(kind),
    base = prefs.base;
  const result = await api(
    `${groupFor(kind)}/${encodeURIComponent(provider)}/${encodeURIComponent(query)}`,
    base,
  );
  return (result.results || [])
    .filter((r) => r.id)
    .map((r) => {
      const x = normalize(r, kind, provider, base);
      remember(x);
      return x;
    }).filter((x) => x.kind === kind);
}
async function details(item) {
  const id = item.key;
  if (detailCache.has(id)) return detailCache.get(id);
  const data = await api(
    `${groupFor(item.kind)}/${item.provider}/info?id=${encodeURIComponent(item.id)}`,
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
  return `<div class="notice">Episodes and chapters need a connected Consumet server. <a href="#settings">Open connection settings ${icon("arrow")}</a></div>`;
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
function browse(kind, params) {
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
    )}</select></label><span class="result-count">${list.length} curated titles</span></div><div class="collection-grid">${list.length ? list.map((i) => card(i)).join("") : empty("No stories in this filter", "Try another genre to discover something new.")}</div><div class="notice">Looking for something else? <a href="#search?type=${kind}">Search your connected ${title.toLowerCase()} provider.</a></div></div>`;
  ["genre-filter", "sort-filter"].forEach((id) =>
    $("#" + id).addEventListener("change", () => {
      location.hash = `${kind}?genre=${encodeURIComponent($("#genre-filter").value)}&sort=${$("#sort-filter").value}`;
    }),
  );
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
    )}</select></label></div><div class="collection-grid">${entries.length ? entries.map((v) => card(v.item, true)).join("") : empty("Your next chapter starts here", "Save a title with the + button and it will have a home right here.", `<a href="#home" class="button">Discover stories ${icon("arrow")}</a>`)}</div><p class="tiny-label" style="margin-top:25px">Your library is saved in this browser. Export a backup from Settings to move it to another device.</p></div>`;
  $("#library-filter").onchange = (e) => {
    location.hash = `library?type=${libraryFilter}&status=${e.target.value}`;
  };
}
async function searchPage(params, version) {
  const q = params.get("q") || "";
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
    )}</div></div><p class="source-label">From the Yoru collection</p><div class="collection-grid">${local.length ? local.map((i) => card(i)).join("") : empty("No matches in the collection", "Try another title, or search the connected provider below.")}</div><section class="section"><div class="section-head"><h2>Beyond the collection</h2></div><div id="remote-results">${!q ? empty("A bigger world awaits", "Search a title above to explore your connected Consumet provider.") : !prefs.base ? connectionNotice() : loading("Searching your provider…")}</div></section></div>`;
  $("#search-page-form").onsubmit = (e) => {
    e.preventDefault();
    location.hash = `search?q=${encodeURIComponent($("#page-query").value.trim())}&type=${searchType}`;
  };
  if (!q || !prefs.base) return;
  try {
    const kinds =
      searchType === "all" ? ["anime", "manga", "manhwa"] : [searchType];
    const results = await Promise.allSettled(
      kinds.map((k) => searchProvider(q, k)),
    );
    if (version !== routeVersion) return;
    let html = "";
    results.forEach((r, i) => {
      html += `<p class="source-label" style="margin-top:25px">${pretty(kinds[i])} · ${esc(providerFor(kinds[i]))}</p>`;
      html +=
        r.status === "fulfilled"
          ? r.value.length
            ? `<div class="collection-grid">${r.value.map((i) => card(i)).join("")}</div>`
            : empty(
                "No results from this provider",
                "Try a shorter title or choose another provider in Settings.",
              )
          : `<div class="notice error">${esc(networkError(r.reason))}</div>`;
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
        "Try searching an alternate title or selecting another provider in Settings.",
        `<a class="button secondary" href="#settings">Connection settings</a>`,
      );
}
function sourceCredits(data, unit) {
  const credits = [data.sourceCredit, ...(unit?.groups || [])].filter((c) => c?.name && safeUrl(c.url));
  return credits.length ? `<p class="source-credits">Source & credits: ${credits.map((c) => `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>`).join(" · ")}</p>` : "";
}
function unitList(item, data, selected = "") {
  let units = item.kind === "anime" ? data.episodes || [] : data.chapters || [];
  activeUnits = units;
  activeItem = item;
  const done = new Set(library[item.key]?.done || []);
  if (!units.length)
    return empty(
      item.kind === "anime" ? "No episodes returned" : "No chapters returned",
      "This provider has no available entries for this edition. You can try a different result or provider.",
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
  if (!item.editorial) {
    try {
      const data = await details(item);
      if (version !== routeVersion) return;
      $("#units-panel").innerHTML = unitList(item, data);
    } catch (e) {
      if (version === routeVersion)
        $("#units-panel").innerHTML = errorPanel(e, key);
    }
  }
}
function errorPanel(error, key) {
  return `<div class="notice error">${esc(networkError(error))}</div><div class="actions"><button class="button secondary" data-find="${esc(key)}">Try again</button><a class="button secondary" href="#settings">Connection settings</a></div>`;
}
async function findEdition(key) {
  const item = all.get(key),
    panel = $("#units-panel"),
    version = routeVersion;
  if (!item || !panel) return;
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
      if (version === routeVersion) panel.innerHTML = unitList(item, data);
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
  if (!item || item.editorial) return missing();
  const unitId = params.get("unit");
  main.innerHTML = `<div class="content"><a class="breadcrumb" href="${link(item)}">${icon("back")}Back to ${esc(item.title)}</a><h1 class="watch-title">${esc(item.title)}</h1><div class="player" id="player">${loading("Finding video sources…")}</div><div id="video-message"></div><div id="player-controls"></div><section class="section"><div class="section-head"><h2>Episodes</h2></div><div id="watch-episodes">${loading()}</div></section></div>`;
  try {
    const data = await details(item);
    if (version !== routeVersion) return;
    const unit =
      data.episodes?.find((u) => String(u.id) === unitId) || data.episodes?.[0];
    if (!unit) throw new Error("This edition has no episodes available.");
    $("#watch-episodes").innerHTML = unitList(item, data, String(unit.id));
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
async function readerPage(key, params, version) {
  const item = all.get(key);
  if (!item || item.editorial) return missing();
  main.innerHTML = `<div class="reader-toolbar"><a href="${link(item)}">← ${esc(item.title)}</a><h2 id="chapter-title">Loading chapter…</h2></div><div id="reader-body">${loading("Loading chapter pages…")}</div>`;
  try {
    const data = await details(item);
    if (version !== routeVersion) return;
    activeUnits = data.chapters || [];
    activeItem = item;
    const unit =
      activeUnits.find((u) => String(u.id) === params.get("unit")) ||
      activeUnits[0];
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
    $("#reader-pages")
      .querySelectorAll("img")
      .forEach(
        (img) =>
          (img.onerror = () => {
            img.alt =
              "Page could not load. The image source may be unavailable.";
            img.style.minHeight = "160px";
          }),
      );
  } catch (e) {
    if (version === routeVersion)
      $("#reader-body").innerHTML =
        `<div class="content section">${empty("Chapter unavailable", esc(networkError(e)), `<a href="${link(item)}" class="button secondary">Back to chapters</a>`)}</div>`;
  }
}
function providerOptions(kind) {
  const options =
    kind === "anime"
      ? ["hianime", "animekai", "animepahe"]
      : ["mangadex", "mangapill", "comick", "mangareader", "weebcentral"];
  return options
    .map(
      (p) =>
        `<option ${prefs[kind] === p ? "selected" : ""} value="${p}">${p}</option>`,
    )
    .join("");
}
function settings() {
  main.innerHTML = `<div class="content settings-layout"><div class="page-head"><div class="eyebrow">Make it yours</div><h1>A little fine-tuning.</h1><p>Your connection, your library, your reading rhythm.</p></div><section class="settings-card"><h2>Consumet connection</h2><p>Connect a hosted Consumet API to search beyond the collection and load episodes and chapters. The included local server works when you run Yoru on your computer.</p><form id="connection-form"><label class="field"><span>API base URL</span><input id="api-base" type="url" value="${esc(prefs.base)}" placeholder="https://your-consumet-server.example/api"><small>Use your server’s API root. Hosted websites require an HTTPS endpoint with CORS access for this site. Leave blank to browse the curated collection.</small></label><div class="field-pair"><label class="field"><span>Anime provider</span><select id="anime-provider">${providerOptions("anime")}</select></label><label class="field"><span>Manga provider</span><select id="manga-provider">${providerOptions("manga")}</select></label></div><label class="field"><span>Manhwa provider</span><select id="manhwa-provider">${providerOptions("manhwa")}</select><small>Manga providers may include Korean comics. Check the matching edition when searching.</small></label><div class="actions"><button class="button" type="submit">Save connection</button><button class="button secondary" type="button" id="test-connection">Test connection</button></div><div id="connection-result" role="status"></div></form></section><section class="settings-card"><h2>Playback</h2><label class="setting-line"><input type="checkbox" id="autoplay" ${prefs.autoplay ? "checked" : ""}>Automatically play and advance to the next episode</label><p>Playback position and reading progress are saved automatically on this browser.</p></section><section class="settings-card"><h2>Keep your library close</h2><p>Save a backup before changing browsers. Your library lives on this device; there’s no account to sign into.</p><div class="actions"><button class="button secondary" id="export-library">Export library</button><button class="button secondary" id="import-library">Import backup</button><input id="backup-file" type="file" accept="application/json,.json" hidden><button class="button secondary" id="clear-library">Clear library</button></div></section></div>`;
  const formPrefs = () => {
    const raw = $("#api-base").value.trim().replace(/\/+$/, "");
    if (raw) {
      const u = new URL(raw);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      if (u.username || u.password || u.search || u.hash)
        throw new Error(
          "Use a plain API base URL without credentials, query parameters, or a fragment.",
        );
      if (
        u.protocol !== "https:" &&
        !(u.protocol === "http:" && local && isLocal)
      )
        throw new Error(
          "Use an HTTPS API URL. Local HTTP is supported only in the local version.",
        );
    }
    return {
      base: raw,
      anime: $("#anime-provider").value,
      manga: $("#manga-provider").value,
      manhwa: $("#manhwa-provider").value,
      autoplay: prefs.autoplay,
    };
  };
  $("#connection-form").onsubmit = (e) => {
    e.preventDefault();
    try {
      prefs = formPrefs();
      persist("settings", prefs);
      detailCache.clear();
      $("#connection-result").innerHTML =
        '<div class="notice success">Connection settings saved.</div>';
      toast("Connection saved");
    } catch (e) {
      $("#connection-result").innerHTML =
        `<div class="notice error">${esc(e.message)}</div>`;
    }
  };
  $("#test-connection").onclick = async () => {
    const button = $("#test-connection"),
      out = $("#connection-result");
    button.disabled = true;
    out.innerHTML = loading("Testing the selected providers…");
    try {
      const config = formPrefs();
      const checks = [["Anime", `anime/${config.anime}/frieren`], ["Manga", `manga/${config.manga}/one%20piece`], ["Manhwa", `manga/${config.manhwa}/solo%20leveling`]];
      const results = await Promise.allSettled(checks.map(async ([label, path]) => {
        const result = await api(path, config.base);
        if (!Array.isArray(result.results)) throw new Error("Incompatible API response.");
        return `${label}: provider responded with ${result.results.length} results.`;
      }));
      out.innerHTML = results.map((r, i) => `<div class="notice ${r.status === "fulfilled" ? "success" : "error"}">${esc(r.status === "fulfilled" ? r.value : `${checks[i][0]}: ${networkError(r.reason)}`)}</div>`).join("");
    } catch (e) {
      out.innerHTML = `<div class="notice error">${esc(networkError(e))}</div>`;
    } finally {
      button.disabled = false;
    }
  };
  $("#autoplay").onchange = (e) => {
    prefs.autoplay = e.target.checked;
    persist("settings", prefs);
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
      toast("Library restored");
    } catch (e) {
      toast(e.message || "Could not read the backup.");
    }
  };
  $("#clear-library").onclick = () => $("#confirm-dialog").showModal();
}
function about() {
  main.innerHTML = `<div class="content settings-layout"><div class="page-head"><div class="eyebrow">The night is yours</div><h1>Welcome to Yoru.</h1><p>A home for your anime, manga, and manhwa adventures.</p></div><section class="settings-card"><h2>Find your next obsession</h2><p>Browse a handpicked collection, find editions through your connected Consumet server, and keep your favorites in one place. The video player supports compatible HLS and MP4 sources; the reader offers continuous scrolling and single-page modes.</p><h3>Artwork & sources</h3><p>Collection artwork and title metadata were retrieved from AniList. Artwork belongs to the respective creators and publishers. Featured selections are editorial picks, not live popularity rankings. Consumet supplies provider search and content references when connected; availability depends on the selected provider.</p><h3>Your data stays with you</h3><p>Favorites, progress, and connection preferences are stored in your browser. Export your library from Settings for a backup. Connecting a server sends search requests to that server. Video and chapter images load from the source URLs it returns.</p><div class="actions"><a href="#home" class="button">Explore Yoru ${icon("arrow")}</a><a href="#settings" class="button secondary">Connection settings</a></div></section></div>`;
}
async function render() {
  routeVersion++;
  const version = routeVersion;
  routeAbort?.abort();
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
      : `${all.get(key)?.title || { anime: "Anime", manga: "Manga", manhwa: "Manhwa", library: "My library", search: "Search", settings: "Settings", about: "About" }[page] || "Yoru"} · Yoru`;
  try {
    if (page === "home") home();
    else if (["anime", "manga", "manhwa"].includes(page)) browse(page, params);
    else if (page === "library") libraryPage(params);
    else if (page === "search") await searchPage(params, version);
    else if (page === "title") await titlePage(key, version);
    else if (page === "watch") await watchPage(key, params, version);
    else if (page === "read") await readerPage(key, params, version);
    else if (page === "settings") settings();
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
    toast("Library cleared");
  }
});
window.addEventListener("hashchange", render);
window.addEventListener("storage", (e) => {
  if (e.key === "yoru-library") {
    library = read("library", {});
    count();
    if (location.hash.startsWith("#library")) render();
  }
});
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
