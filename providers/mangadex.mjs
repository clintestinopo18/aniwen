const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function uuid(id) { if (!UUID.test(String(id))) fail("Invalid MangaDex ID."); return id; }
export function publisherLinks(links = {}) {
  // engtl is the source's official English translation link. Never invent a title URL.
  const hosts = ["webtoons.com", "tapas.io", "tappytoon.com", "pocketcomics.com", "webnovel.com", "manta.net", "lezhinus.com", "lezhin.com", "viz.com", "mangaplus.shueisha.co.jp", "yenpress.com", "sevenseasentertainment.com", "kodansha.us", "global.bookwalker.jp", "inkr.com", "comikey.com"];
  try {
    const url = new URL(links?.engtl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hosts.some(h => url.hostname === h || url.hostname.endsWith("." + h))) return [];
    return [{ name: url.hostname.replace(/^www\./, ""), url: url.href }];
  } catch { return []; }
}
function pageNumber(value, limit) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n * limit > 10000) fail("This catalog page is outside the source limit. Narrow your search.");
  return n;
}
export function mangaRecord(record) {
  const a = record.attributes;
  const cover = record.relationships?.find(r => r.type === "cover_art")?.attributes?.fileName;
  return {
    id: record.id, title: a.title.en || a.altTitles?.find(t => t.en)?.en || Object.values(a.title)[0],
    altTitles: a.altTitles, description: a.description?.en || "", genres: a.tags?.filter(t => t.attributes.group === "genre").map(t => t.attributes.name.en) || [],
    image: cover ? `https://uploads.mangadex.org/covers/${record.id}/${encodeURIComponent(cover)}.256.jpg` : "",
    countryOfOrigin: a.originalLanguage === "ko" ? "KR" : a.originalLanguage === "ja" ? "JP" : a.originalLanguage,
    releaseDate: a.year, status: a.status, sourceCredit: { name: "MangaDex", url: `https://mangadex.org/title/${record.id}` },
    readingLinks: publisherLinks(a.links),
  };
}
function chapterRecord(c) {
  return { id: c.id, title: `${c.attributes.chapter == null ? "Extra" : `Chapter ${c.attributes.chapter}`}${c.attributes.title ? ` — ${c.attributes.title}` : ""}`,
    chapterNumber: c.attributes.chapter, pages: c.attributes.pages,
    groups: (c.relationships || []).filter(r => r.type === "scanlation_group").map(r => ({ name: r.attributes?.name || "Scanlation group", url: `https://mangadex.org/group/${r.id}` })) };
}
export function createMangaDexProvider(fetcher = fetch) {
  let tags;
  async function get(path, params = {}) {
    const url = new URL(path, "https://api.mangadex.org");
    for (const [key, value] of Object.entries(params)) for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined) url.searchParams.append(key, String(v));
    let response;
    try { response = await fetcher(url.href, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) }); }
    catch { fail("MangaDex could not be reached. Please retry shortly.", 502); }
    if (response.status === 429) fail("MangaDex is busy. Please retry in a minute.", 429);
    if (response.status === 404) fail("This title or chapter is no longer available.", 404);
    if (!response.ok) fail("MangaDex could not return this request.", 502);
    const data = await response.json();
    if (data.result !== "ok") fail("MangaDex returned an invalid response.", 502);
    return data;
  }
  async function browse({ page = 1, kind = "manga", sort = "popular", genre = "all", search = "" } = {}) {
    const sorts = { popular: "followedCount", updated: "latestUploadedChapter", title: "title", year: "year" };
    if (!["manga", "manhwa"].includes(kind) || !sorts[sort] || typeof search !== "string" || search.length > 150 || typeof genre !== "string" || genre.length > 40) fail("Invalid catalog filter.");
    const currentPage = pageNumber(page, 24);
    let tag;
    if (genre !== "all") {
      tags ||= (await get("/manga/tag")).data;
      tag = tags.find(t => t.attributes.name.en === genre)?.id;
      if (!tag) fail("Unknown genre.");
    }
    const data = await get("/manga", { limit: 24, offset: (currentPage - 1) * 24, "includes[]": "cover_art", "originalLanguage[]": kind === "manhwa" ? "ko" : "ja",
      "contentRating[]": ["safe", "suggestive"], [`order[${sorts[sort]}]`]: sort === "title" ? "asc" : "desc", title: search.trim() || undefined, "includedTags[]": tag });
    return { results: data.data.map(mangaRecord), currentPage, total: data.total, hasNextPage: currentPage * 24 < Math.min(data.total, 9984) };
  }
  async function chapters(id, page = 1, chapter) {
    uuid(id);
    const currentPage = pageNumber(page, 100);
    if (chapter !== undefined && !/^\d{1,7}(?:\.\d{1,5})?$/.test(chapter)) fail("Enter a valid chapter number.");
    const data = await get(chapter === undefined ? `/manga/${id}/feed` : "/chapter", { limit: 100, offset: (currentPage - 1) * 100, "translatedLanguage[]": "en", "order[chapter]": "asc", "order[createdAt]": "asc",
      "includes[]": "scanlation_group", includeExternalUrl: 0, includeEmptyPages: 0, includeFuturePublishAt: 0, "contentRating[]": ["safe", "suggestive"], chapter, manga: chapter === undefined ? undefined : id });
    return { chapters: data.data.filter(c => c.attributes.pages > 0 && !c.attributes.externalUrl).map(chapterRecord),
      chapterPagination: { currentPage, totalPages: Math.max(1, Math.ceil(Math.min(data.total, 10000) / 100)), hasNextPage: currentPage * 100 < Math.min(data.total, 10000), ...(chapter !== undefined ? { chapter } : {}) } };
  }
  return {
    browse, chapters,
    search(search, page = 1, { kind = "manga" } = {}) {
      if (typeof search !== "string" || !search.trim()) fail("Enter a title.");
      return browse({ search, page, kind });
    },
    async fetchMangaInfo(id) {
      uuid(id);
      const [data, feed] = await Promise.all([get(`/manga/${id}`, { "includes[]": "cover_art" }), chapters(id)]);
      if (!["safe", "suggestive"].includes(data.data.attributes.contentRating)) fail("This title is outside this catalog.", 404);
      const record = mangaRecord(data.data);
      if (!record.readingLinks.length && !feed.chapters.length) {
        // External entries are reading links, never in-site chapters. Failure here must not hide metadata.
        try {
          const external = await get(`/manga/${id}/feed`, { limit: 100, "translatedLanguage[]": "en", "order[chapter]": "asc", includeExternalUrl: 1, includeEmptyPages: 1, includeFuturePublishAt: 0, "contentRating[]": ["safe", "suggestive"] });
          const links = external.data.flatMap(c => publisherLinks({ engtl: c.attributes.externalUrl }));
          const firstByPublisher = new Map();
          for (const link of links) if (!firstByPublisher.has(link.name)) firstByPublisher.set(link.name, link);
          record.readingLinks = [...firstByPublisher.values()];
        } catch { /* Publisher lookup is optional; never fabricate links or chapters. */ }
      }
      return { ...record, ...feed, playbackNotice: "Only currently hosted English chapters are listed. Missing or removed chapters cannot be supplied by this source." };
    },
    async chapter(id, chapterId) {
      uuid(id); uuid(chapterId);
      const { data } = await get(`/chapter/${chapterId}`, { "includes[]": "scanlation_group" });
      if (!data.relationships.some(r => r.type === "manga" && r.id === id) || data.attributes.translatedLanguage !== "en" || !data.attributes.pages || data.attributes.externalUrl) fail("This chapter is not available for this edition.", 404);
      return chapterRecord(data);
    },
    async fetchChapterPages(id) {
      uuid(id);
      const data = await get(`/at-home/server/${id}`);
      const base = new URL(data.baseUrl);
      if (base.protocol !== "https:" || !data.chapter?.data?.length) fail("No readable pages were returned.", 404);
      // Page order is supplied by the API, not inferred from arbitrary image filenames.
      return data.chapter.data.map((file, i) => ({ img: `${base.origin}/data/${encodeURIComponent(data.chapter.hash)}/${encodeURIComponent(file)}`, page: i + 1 }));
    },
  };
}
