import { positiveId, embedUrl } from "../dist/megaplay.js";

const ANILIST_URL = "https://graphql.anilist.co";
const JIKAN_URL = "https://api.jikan.moe/v4";
const ANILIST_RETRY_MS = 10 * 60 * 1000;
const fields = `id title { english romaji native } coverImage { large } description genres startDate { year } episodes status format nextAiringEpisode { episode }`;

// Editorial titles can keep loading episodes while AniList is unavailable.
const editorialMalIds = new Map([
  [154587, 52991],
  [151807, 52299],
  [113415, 40748],
  [101922, 38000],
  [127230, 44511],
  [140960, 50265],
  [16498, 16498],
  [101348, 37521],
]);

const genreIds = {
  Action: 1,
  Adventure: 2,
  Comedy: 4,
  Mystery: 7,
  Drama: 8,
  Fantasy: 10,
  Horror: 14,
  "Slice of Life": 36,
  Supernatural: 37,
};

function failure(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

export function airedEpisodes(media) {
  if (media.status === "NOT_YET_RELEASED" || media.status === "CANCELLED") return 0;
  const count = media.status === "RELEASING" ? (media.nextAiringEpisode?.episode || 1) - 1 : media.episodes || 0;
  return Math.max(0, Math.min(5000, Math.floor(Number(count) || 0)));
}

function normalize(media) {
  return {
    id: String(media.id),
    title: media.title,
    image: media.coverImage?.large,
    description: media.description,
    genres: media.genres,
    releaseDate: media.startDate?.year,
    status: media.status,
    type: media.format,
    totalEpisodes: airedEpisodes(media),
    sourceCredit: { name: "AniList metadata · MegaPlay video", url: "https://megaplay.buzz/api" },
  };
}

function jikanStatus(status) {
  if (status === "Not yet aired") return "NOT_YET_RELEASED";
  if (status === "Currently Airing") return "RELEASING";
  if (status === "Finished Airing") return "FINISHED";
  return status || "UNKNOWN";
}

function normalizeJikan(media, airedCount) {
  const status = jikanStatus(media.status);
  let episodes = Number(media.episodes) || 0;
  if (status === "NOT_YET_RELEASED") episodes = 0;
  if (status === "RELEASING" && Number.isFinite(airedCount)) episodes = airedCount;
  const genres = [...(media.genres || []), ...(media.themes || []), ...(media.demographics || [])]
    .map((entry) => entry?.name)
    .filter(Boolean);
  return {
    id: `mal-${positiveId(media.mal_id)}`,
    title: {
      english: media.title_english || media.title,
      romaji: media.title,
      native: media.title_japanese,
    },
    image: media.images?.webp?.large_image_url || media.images?.jpg?.large_image_url,
    description: media.synopsis,
    genres: [...new Set(genres)],
    releaseDate: media.year || (media.aired?.from ? new Date(media.aired.from).getUTCFullYear() : null),
    status,
    type: media.type,
    totalEpisodes: Math.max(0, Math.min(5000, Math.floor(episodes))),
    sourceCredit: { name: "Jikan / MyAnimeList metadata · MegaPlay video", url: "https://jikan.moe/" },
  };
}

export function createMegaPlayProvider(fetcher = fetch) {
  let anilistRetryAt = 0;

  async function query(queryText, variables) {
    let response;
    try {
      response = await fetcher(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: queryText, variables }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw failure("The AniList catalog could not be reached.");
    }
    if (response.status === 429) throw failure("The AniList catalog is busy.", 429);
    let result;
    try { result = await response.json(); } catch { throw failure("The AniList catalog returned an invalid response."); }
    if (!response.ok || result.errors?.length || !result.data) throw failure("The AniList catalog is temporarily unavailable.");
    return result.data;
  }

  async function jikan(path) {
    let response;
    try {
      response = await fetcher(`${JIKAN_URL}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "Yoru/1.5 (+https://yoru-anime-manga-clint.yellowcrow11.chatgpt.site/)" },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw failure("The backup anime catalog could not be reached. Please retry shortly.");
    }
    if (response.status === 429) throw failure("The backup anime catalog is busy. Please retry in a minute.", 429);
    let result;
    try { result = await response.json(); } catch { throw failure("The backup anime catalog returned an invalid response."); }
    if (!response.ok || !result || (!("data" in result) && !("pagination" in result))) {
      throw failure(response.status === 404 ? "Anime not found." : "The backup anime catalog could not return this title.", response.status === 404 ? 404 : 502);
    }
    return result;
  }

  async function withCatalogFallback(primary, backup) {
    if (Date.now() < anilistRetryAt) return backup();
    try {
      return await primary();
    } catch (error) {
      if (![429, 502, 503, 504].includes(error?.status)) throw error;
      anilistRetryAt = Date.now() + ANILIST_RETRY_MS;
      return backup();
    }
  }

  async function jikanBrowse({ page, sort, genre, search, limit }) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sfw: "true" });
    if (search) params.set("q", search);
    if (genre !== "all") params.set("genres", String(genreIds[genre]));
    if (sort === "trending") {
      params.set("status", "airing");
      params.set("order_by", "popularity");
      params.set("sort", "asc");
    } else if (sort === "title") {
      params.set("order_by", "title");
      params.set("sort", "asc");
    } else if (sort === "year") {
      params.set("order_by", "start_date");
      params.set("sort", "desc");
    } else {
      params.set("order_by", "popularity");
      params.set("sort", "asc");
    }
    const result = await jikan(`/anime?${params}`);
    return {
      results: (result.data || []).map((item) => normalizeJikan(item)),
      currentPage: result.pagination?.current_page || page,
      hasNextPage: result.pagination?.has_next_page === true,
      catalogSource: "Jikan / MyAnimeList · MegaPlay",
    };
  }

  async function jikanInfo(malId) {
    const id = positiveId(malId);
    const result = await jikan(`/anime/${id}/full`);
    if (!result.data) throw failure("Anime not found.", 404);
    let airedCount;
    if (jikanStatus(result.data.status) === "RELEASING") {
      try {
        const episodeResult = await jikan(`/anime/${id}/episodes?page=1`);
        const total = Number(episodeResult.pagination?.items?.total);
        if (Number.isFinite(total)) airedCount = total;
      } catch {
        // The title still works when the optional episode-count request fails.
      }
    }
    const item = normalizeJikan(result.data, airedCount);
    return {
      ...item,
      episodes: Array.from({ length: item.totalEpisodes }, (_, i) => ({ id: `${item.id}:${i + 1}`, number: i + 1, title: `Episode ${i + 1}` })),
      playbackNotice: "Episode listings come from MyAnimeList. MegaPlay sub/dub availability varies by title and episode.",
    };
  }

  return {
    async search(search, page = 1) {
      if (typeof search !== "string" || !search.trim() || search.length > 150) throw failure("Enter a title up to 150 characters.", 400);
      const p = positiveId(page, 10000), term = search.trim();
      return withCatalogFallback(
        async () => {
          const data = await query(`query ($search:String!,$page:Int!) { Page(page:$page,perPage:20) { pageInfo { hasNextPage currentPage } media(search:$search,type:ANIME,isAdult:false,sort:SEARCH_MATCH) { ${fields} } } }`, { search: term, page: p });
          return { results: data.Page.media.map(normalize), ...data.Page.pageInfo, catalogSource: "AniList · MegaPlay" };
        },
        () => jikanBrowse({ page: p, sort: "popular", genre: "all", search: term, limit: 20 }),
      );
    },

    async browse({ page = 1, sort = "popular", genre = "all", search = "" } = {}) {
      const sorts = { popular: "POPULARITY_DESC", trending: "TRENDING_DESC", title: "TITLE_ROMAJI", year: "START_DATE_DESC" };
      if (!sorts[sort] || typeof genre !== "string" || genre.length > 40 || (genre !== "all" && !genreIds[genre]) || typeof search !== "string" || search.length > 150) throw failure("Invalid catalog filter.", 400);
      const p = positiveId(page, 10000), term = search.trim();
      return withCatalogFallback(
        async () => {
          const data = await query(`query ($page:Int!,$sort:[MediaSort],$genre:String,$search:String) { Page(page:$page,perPage:24) { pageInfo { hasNextPage currentPage } media(type:ANIME,isAdult:false,sort:$sort,genre:$genre,search:$search) { ${fields} } } }`, { page: p, sort: [sorts[sort]], genre: genre === "all" ? null : genre, search: term || null });
          return { results: data.Page.media.map(normalize), ...data.Page.pageInfo, catalogSource: "AniList · MegaPlay" };
        },
        () => jikanBrowse({ page: p, sort, genre, search: term, limit: 24 }),
      );
    },

    async fetchAnimeInfo(id) {
      const value = String(id);
      if (/^mal-\d+$/.test(value)) return jikanInfo(value.slice(4));
      const anilistId = positiveId(value);
      const fallbackMalId = editorialMalIds.get(anilistId);
      if (Date.now() < anilistRetryAt && fallbackMalId) return jikanInfo(fallbackMalId);
      try {
        const data = await query(`query ($id:Int!) { Media(id:$id,type:ANIME,isAdult:false) { ${fields} } }`, { id: anilistId });
        if (!data.Media) throw failure("Anime not found.", 404);
        const item = normalize(data.Media);
        return { ...item, episodes: Array.from({ length: item.totalEpisodes }, (_, i) => ({ id: `${item.id}:${i + 1}`, number: i + 1, title: `Episode ${i + 1}` })), playbackNotice: "Episode list is metadata, not a guarantee of a MegaPlay stream. Sub/dub availability varies." };
      } catch (error) {
        if (![429, 502, 503, 504].includes(error?.status) || !fallbackMalId) throw error;
        anilistRetryAt = Date.now() + ANILIST_RETRY_MS;
        return jikanInfo(fallbackMalId);
      }
    },

    async fetchEpisodeSources(id, language = "sub") {
      const match = /^(mal-)?(\d+):(\d+)$/.exec(String(id));
      if (!match) throw failure("Invalid episode ID.", 400);
      return { embed: { url: embedUrl(match[2], match[3], language, match[1] ? "mal" : "ani"), provider: "MegaPlay" }, sources: [] };
    },
  };
}
