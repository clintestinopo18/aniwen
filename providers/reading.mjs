import { positiveId } from "../dist/megaplay.js";
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
async function guarded(fn) {
  try { return await fn(); } catch (e) {
    if (!e.isAxiosError && [400, 404].includes(e.status)) throw e;
    throw Object.assign(new Error("The chapter source could not respond. Please retry shortly."), { status: 502 });
  }
}
export function comicSlug(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,249}$/i.test(id)) invalid("Invalid comic ID.");
  return id;
}
export function comicChapter(id) {
  const match = /^([a-z0-9][a-z0-9-]{0,249})\/([a-z0-9_-]{1,80})-chapter-(\d+(?:\.\d+)?)-en$/i.exec(String(id));
  if (!match) invalid("Invalid English chapter ID.");
  return { slug: match[1], number: match[3] };
}
export function mergeChapters(old, added) {
  const byNumber = new Map();
  for (const c of [...old, ...added]) {
    const key = String(c.chapterNumber ?? c.id);
    if (!byNumber.has(key)) byNumber.set(key, c);
  }
  return [...byNumber.values()].sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
}
export function createComicKProvider(upstream) {
  const makeClient = upstream._axios.bind(upstream);
  upstream._axios = () => { const client = makeClient(); client.defaults ||= {}; client.defaults.timeout = 12000; return client; };
  async function chapters(id, page = 1, chapter) {
    comicSlug(id);
    const p = positiveId(page, 10000);
    if (chapter !== undefined && (typeof chapter !== "string" || !/^\d{1,7}(?:\.\d{1,5})?$/.test(chapter))) invalid("Enter a valid chapter number.");
    return guarded(async () => {
      const { data } = await upstream._axios().get(`/comics/${id}/chapter-list`, { timeout: 12000, params: { lang: "en", chapOrder: "asc", page: p, ...(chapter !== undefined ? { chap: chapter } : {}) } });
      if (!Array.isArray(data.data) || !data.pagination) throw new Error("Invalid chapter response");
      const items = data.data.filter(c => c.lang === "en" && /^\d+(?:\.\d+)?$/.test(String(c.chap)) && /^[a-z0-9_-]{1,80}$/i.test(c.hid) && (chapter === undefined || Number(c.chap) === Number(chapter))).map(c => ({ id: `${id}/${c.hid}-chapter-${c.chap}-en`, title: `Chapter ${c.chap}${c.title ? ` — ${c.title}` : ""}`, chapterNumber: String(c.chap), lang: "en", releaseDate: c.created_at }));
      const exactMatch = chapter !== undefined && items.length > 0;
      return { chapters: mergeChapters([], items), chapterPagination: { currentPage: p, totalPages: exactMatch ? p : data.pagination.last_page, hasNextPage: !exactMatch && p < data.pagination.last_page, ...(chapter !== undefined ? { chapter } : {}) } };
    });
  }
  return {
    chapters,
    search(query) {
      if (typeof query !== "string" || !query.trim() || query.length > 150) invalid("Enter a title up to 150 characters.");
      // ComicK uses opaque cursors, not numeric pages; its title search is not falsely paginated.
      return guarded(() => upstream.search(query.trim(), undefined));
    },
    async fetchMangaInfo(id) {
      comicSlug(id);
      return guarded(async () => {
        const [data, chapterData] = await Promise.all([upstream.getComicData(id), chapters(id)]);
        if (!data?.title) throw new Error("Missing comic");
        return { id, title: data.title, image: data.default_thumbnail, description: data.desc, genres: data.md_comic_md_genres?.map(g => g.md_genres.name) || [], countryOfOrigin: data.country, status: ({ 1: "Ongoing", 2: "Completed" })[data.status] || "Unknown", ...chapterData, sourceCredit: { name: "ComicK", url: `https://comick.art/comic/${id}` } };
      });
    },
    async fetchChapterPages(id) {
      comicChapter(id);
      return guarded(async () => {
        const pages = await upstream.fetchChapterPages(id);
        if (!pages?.length) throw Object.assign(new Error("No pages available for this chapter."), { status: 404 });
        return pages;
      });
    },
  };
}
export function createMangaPillProvider(upstream) {
  if (upstream.client?.defaults) upstream.client.defaults.timeout = 12000;
  return {
    search(query) {
      if (typeof query !== "string" || !query.trim() || query.length > 150) invalid("Enter a title up to 150 characters.");
      return guarded(() => upstream.search(query.trim()));
    },
    async fetchMangaInfo(id) {
      if (!/^\d+\/[a-z0-9][a-z0-9.-]{0,250}$/i.test(id)) invalid("Invalid manga ID.");
      return guarded(async () => {
        const data = await upstream.fetchMangaInfo(id);
        if (!data.image && data.title) {
          const matches = await upstream.search(data.title).catch(() => ({ results: [] }));
          data.image = matches.results?.find(r => r.id === id)?.image;
        }
        const chapters = (data.chapters || []).map(c => ({ ...c, chapterNumber: c.chapter ?? c.title?.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] ?? "" })).sort((a, b) => Number(a.chapterNumber) - Number(b.chapterNumber));
        return { ...data, chapters, totalChapters: chapters.length, sourceCredit: { name: "MangaPill", url: `https://mangapill.com/manga/${id}` } };
      });
    },
    async fetchChapterPages(id) {
      if (!/^\d+-\d+\/[a-z0-9][a-z0-9.-]{0,250}$/i.test(id)) invalid("Invalid manga chapter ID.");
      return guarded(async () => {
        const pages = await upstream.fetchChapterPages(id);
        if (!pages?.length) throw Object.assign(new Error("No pages available for this chapter."), { status: 404 });
        return pages;
      });
    },
  };
}
