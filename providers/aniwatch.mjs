// Adapter for the official aniwatch package. No copied AniProject application code.
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const titlePattern = /^[a-z0-9][a-z0-9-]*-\d+$/i;
export function titleId(value) {
  if (typeof value !== "string" || value.length > 300 || !titlePattern.test(value))
    throw badRequest("A valid Aniwatch title ID is required.");
  return value;
}
export function episodeId(value) {
  if (typeof value !== "string" || value.length > 350) throw badRequest("A valid Aniwatch episode ID is required.");
  const parts = value.split("?ep=");
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) throw badRequest("A valid Aniwatch episode ID is required.");
  titleId(parts[0]);
  return value;
}
export function searchInput(query, page = 1) {
  if (typeof query !== "string" || !query.trim() || query.length > 150)
    throw badRequest("Search must contain between 1 and 150 characters.");
  const n = Number(page);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw badRequest("Page must be an integer from 1 to 20.");
  return [query.trim(), n];
}
function playbackInput(id, server = "hd-1", category = "sub") {
  episodeId(id);
  if (!["hd-1", "hd-2"].includes(server)) throw badRequest("Server must be hd-1 or hd-2.");
  if (!["sub", "dub", "raw"].includes(category)) throw badRequest("Category must be sub, dub, or raw.");
  return [id, server, category];
}
const webUrl = (value) => {
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) ? u.href : ""; }
  catch { return ""; }
};
export function createAniwatchProvider(scraper) {
  // Upstream failures must not masquerade as empty searches or client errors.
  const upstream = async (operation) => {
    try { return await operation(); }
    catch (cause) { throw Object.assign(new Error("Aniwatch could not reach its upstream source. Please try again later.", { cause }), { status: 502 }); }
  };
  const native = {
    search(query, page) { const args = searchInput(query, page); return upstream(() => scraper.search(...args)); },
    info(id) { titleId(id); return upstream(() => scraper.getInfo(id)); },
    episodes(id) { titleId(id); return upstream(() => scraper.getEpisodes(id)); },
    servers(id) { episodeId(id); return upstream(() => scraper.getEpisodeServers(id)); },
    sources(id, server, category) { const args = playbackInput(id, server, category); return upstream(() => scraper.getEpisodeSources(...args)); },
  };
  return {
    native,
    async search(query, page = 1) {
      const data = await native.search(query, page);
      return {
        currentPage: data.currentPage, hasNextPage: !!data.hasNextPage,
        results: (data.animes || []).map((a) => ({
          id: a.id, title: a.name, image: webUrl(a.poster), type: a.type,
          totalEpisodes: a.episodes?.sub || a.episodes?.dub || 0,
          subOrDub: a.episodes?.sub ? "sub" : "dub",
        })),
      };
    },
    async fetchAnimeInfo(id) {
      const [data, listing] = await Promise.all([native.info(id), native.episodes(id)]);
      const info = data.anime?.info || {}, more = data.anime?.moreInfo || {};
      return {
        id, title: info.name, image: webUrl(info.poster), description: info.description,
        genres: more.genres || [], status: more.status, type: info.stats?.type,
        releaseDate: more.aired?.match(/\b(?:19|20)\d{2}\b/)?.[0],
        totalEpisodes: listing.totalEpisodes,
        episodes: (listing.episodes || []).map((e) => ({ id: e.episodeId, number: e.number, title: e.title, isFiller: !!e.isFiller })),
      };
    },
    async fetchEpisodeSources(id, server, category) {
      const data = await native.sources(id, server, category);
      return {
        sources: (data.sources || []).map((s) => ({ url: webUrl(s.url), isM3U8: !!s.isM3U8 || s.type === "hls", quality: s.quality || "Auto" })).filter((s) => s.url),
        subtitles: (data.subtitles || data.tracks || []).filter((s) => !s.kind || s.kind === "captions" || s.kind === "subtitles").map((s) => ({ url: webUrl(s.url || s.file), lang: s.lang || s.label || "Subtitles", default: !!s.default })).filter((s) => s.url),
        headers: data.headers || {}, intro: data.intro, outro: data.outro,
      };
    },
  };
}

// The subset of /api/v2/hianime used by the user's reference project.
export function aniwatchRoute(url, provider) {
  const base = "/api/v2/hianime", p = url.searchParams, path = url.pathname;
  if (path === base + "/search") return () => provider.native.search(p.get("q"), p.get("page") || 1);
  const match = path.match(/^\/api\/v2\/hianime\/anime\/([^/]+)(\/episodes)?$/);
  if (match) return () => provider.native[match[2] ? "episodes" : "info"](decodeURIComponent(match[1]));
  if (path === base + "/episode/servers") return () => provider.native.servers(p.get("animeEpisodeId"));
  if (path === base + "/episode/sources") return () => provider.native.sources(p.get("animeEpisodeId"), p.get("server") || "hd-1", p.get("category") || "sub");
  return null;
}
