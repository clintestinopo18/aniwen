import { positiveId, embedUrl } from "../dist/megaplay.js";
const fields = `id title { english romaji native } coverImage { large } description genres startDate { year } episodes status format nextAiringEpisode { episode }`;
export function airedEpisodes(media) {
  if (media.status === "NOT_YET_RELEASED" || media.status === "CANCELLED") return 0;
  const count = media.status === "RELEASING" ? (media.nextAiringEpisode?.episode || 1) - 1 : media.episodes || 0;
  return Math.max(0, Math.min(5000, Math.floor(Number(count) || 0)));
}
function normalize(media) {
  return { id: String(media.id), title: media.title, image: media.coverImage?.large,
    description: media.description, genres: media.genres, releaseDate: media.startDate?.year,
    status: media.status, type: media.format, totalEpisodes: airedEpisodes(media),
    sourceCredit: { name: "AniList metadata · MegaPlay video", url: "https://megaplay.buzz/api" } };
}
export function createMegaPlayProvider(fetcher = fetch) {
  async function query(query, variables) {
    let response;
    try {
      response = await fetcher("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(12000) });
    } catch { throw Object.assign(new Error("The anime catalog could not be reached. Please retry shortly."), { status: 502 }); }
    if (response.status === 429) throw Object.assign(new Error("The anime catalog is busy. Please retry in a minute."), { status: 429 });
    const result = await response.json();
    if (!response.ok || result.errors?.length || !result.data) throw Object.assign(new Error("The anime catalog could not return this title."), { status: 502 });
    return result.data;
  }
  return {
    async search(search, page = 1) {
      if (typeof search !== "string" || !search.trim() || search.length > 150) throw Object.assign(new Error("Enter a title up to 150 characters."), { status: 400 });
      const p = positiveId(page, 20);
      const data = await query(`query ($search:String!,$page:Int!) { Page(page:$page,perPage:20) { pageInfo { hasNextPage currentPage } media(search:$search,type:ANIME,isAdult:false,sort:SEARCH_MATCH) { ${fields} } } }`, { search: search.trim(), page: p });
      return { results: data.Page.media.map(normalize), ...data.Page.pageInfo };
    },
    async fetchAnimeInfo(id) {
      const data = await query(`query ($id:Int!) { Media(id:$id,type:ANIME,isAdult:false) { ${fields} } }`, { id: positiveId(id) });
      if (!data.Media) throw Object.assign(new Error("Anime not found."), { status: 404 });
      const item = normalize(data.Media);
      return { ...item, episodes: Array.from({ length: item.totalEpisodes }, (_, i) => ({ id: `${item.id}:${i + 1}`, number: i + 1, title: `Episode ${i + 1}` })), playbackNotice: "Episode list is metadata, not a guarantee of a MegaPlay stream. Sub/dub availability varies." };
    },
    async fetchEpisodeSources(id, language = "sub") {
      const parts = String(id).split(":");
      if (parts.length !== 2) throw Object.assign(new Error("Invalid episode ID."), { status: 400 });
      return { embed: { url: embedUrl(parts[0], parts[1], language), provider: "MegaPlay" }, sources: [] };
    },
  };
}
