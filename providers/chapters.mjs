import { positiveId } from "../dist/megaplay.js";
const origin = "https://weebcentral.com";
function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
export function seriesId(value) {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}(?:\/[A-Za-z0-9-]{1,200})?$/.test(value)) invalid("Invalid series ID.");
  return value;
}
export function chapterId(value) {
  if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) invalid("Invalid chapter ID.");
  return value;
}
export function chaptersInOrder(chapters = []) {
  const unique = new Map();
  for (const c of chapters) {
    try { chapterId(c.id); } catch { continue; }
    const number = String(c.title || "").match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1];
    unique.set(c.id, { ...c, chapterNumber: number ?? "" });
  }
  return [...unique.values()].sort((a, b) => (a.chapterNumber === "" ? Infinity : Number(a.chapterNumber)) - (b.chapterNumber === "" ? Infinity : Number(b.chapterNumber)));
}
export function createChapterProvider(upstream) {
  if (upstream.client?.defaults) upstream.client.defaults.timeout = 12000;
  async function guarded(operation) {
    try { return await operation(); }
    catch (e) { if (!e.isAxiosError && e.status) throw e; throw Object.assign(new Error("The chapter provider is temporarily unavailable. Please try again shortly."), { status: 502 }); }
  }
  return {
    search(search, page = 1) {
      if (typeof search !== "string" || !search.trim() || search.length > 150) invalid("Enter a title up to 150 characters.");
      const p = positiveId(page, 10000);
      return guarded(() => upstream.search(search.trim(), p));
    },
    async fetchMangaInfo(id) {
      seriesId(id);
      return guarded(async () => {
        const data = await upstream.fetchMangaInfo(id);
        if (!data.title) throw new Error("Missing series");
        const chapters = chaptersInOrder(data.chapters);
        return { ...data, chapters, totalChapters: chapters.length, sourceCredit: { name: "WeebCentral", url: `${origin}/series/${id}` } };
      });
    },
    async fetchChapterPages(id) {
      chapterId(id);
      return guarded(async () => {
        const pages = (await upstream.fetchChapterPages(id)).filter(p => { try { return new URL(p.img).protocol === "https:"; } catch { return false; } });
        if (!pages.length) throw Object.assign(new Error("No readable pages are available for this chapter."), { status: 404 });
        return pages;
      });
    },
  };
}
