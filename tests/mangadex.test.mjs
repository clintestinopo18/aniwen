import test from "node:test";
import assert from "node:assert/strict";
import { createMangaDexProvider, mangaRecord } from "../providers/mangadex.mjs";
const id = "11111111-1111-1111-1111-111111111111", cid = "22222222-2222-2222-2222-222222222222";
const record = { id, attributes: { title: { ja: "原作" }, altTitles: [{ en: "English title" }], originalLanguage: "ko", contentRating: "safe", tags: [], description: { en: "Story" } },
  relationships: [{ type: "cover_art", attributes: { fileName: "cover.jpg" } }] };
const chapter = { id: cid, attributes: { chapter: "0", pages: 3, translatedLanguage: "en", title: "Start" }, relationships: [{ type: "manga", id }] };
const reply = data => ({ ok: true, status: 200, json: async () => ({ result: "ok", ...data }) });
test("MangaDex uses the image CDN and English titles without extra cover lookups", () => {
  const item = mangaRecord(record);
  assert.equal(item.image, `https://uploads.mangadex.org/covers/${id}/cover.jpg.256.jpg`);
  assert.equal(item.title, "English title");
  assert.equal(item.countryOfOrigin, "KR");
});
test("catalog paginates and separates Korean and Japanese originals", async () => {
  let url;
  const p = createMangaDexProvider(async u => { url = new URL(u); return reply({ data: [record], total: 60 }); });
  const data = await p.browse({ kind: "manhwa", page: 2, sort: "updated", search: "Test" });
  assert.equal(url.searchParams.get("originalLanguage[]"), "ko");
  assert.equal(url.searchParams.get("offset"), "24");
  assert.equal(url.searchParams.get("order[latestUploadedChapter]"), "desc");
  assert.deepEqual(url.searchParams.getAll("contentRating[]"), ["safe", "suggestive"]);
  assert.equal(data.hasNextPage, true);
  await p.browse({ kind: "manga" });
  assert.equal(url.searchParams.get("originalLanguage[]"), "ja");
  await assert.rejects(p.browse({ page: 417 }), { status: 400 });
  await assert.rejects(p.browse({ sort: "invalid" }), { status: 400 });
});
test("genre filtering resolves real source tag IDs", async () => {
  const urls = [];
  const p = createMangaDexProvider(async u => { const url = new URL(u); urls.push(url); return url.pathname.endsWith("/tag") ? reply({ data: [{ id, attributes: { name: { en: "Action" } } }] }) : reply({ data: [], total: 0 }); });
  await p.browse({ genre: "Action" });
  assert.equal(urls[1].searchParams.get("includedTags[]"), id);
  await assert.rejects(p.browse({ genre: "Not a genre" }), { status: 400 });
});
test("chapter lists exclude external and empty entries, retain zero, and paginate", async () => {
  let url;
  const p = createMangaDexProvider(async u => { url = new URL(u); return reply({ total: 201, data: [chapter, { ...chapter, attributes: { ...chapter.attributes, pages: 0 } }, { ...chapter, attributes: { ...chapter.attributes, externalUrl: "https://publisher.example" } }] }); });
  const data = await p.chapters(id, 2, "0");
  assert.equal(data.chapters.length, 1);
  assert.equal(data.chapters[0].chapterNumber, "0");
  assert.equal(data.chapterPagination.totalPages, 3);
  assert.equal(data.chapterPagination.chapter, "0");
  assert.equal(url.searchParams.get("offset"), "100");
  assert.equal(url.searchParams.get("includeExternalUrl"), "0");
  assert.equal(url.pathname, "/chapter");
  assert.equal(url.searchParams.get("manga"), id);
  assert.equal(url.searchParams.get("chapter"), "0");
  await p.chapters(id);
  assert.equal(url.pathname, `/manga/${id}/feed`);
  await assert.rejects(p.chapters("../x"), { status: 400 });
});
test("uncached reader deep links validate the chapter belongs to the title", async () => {
  const p = createMangaDexProvider(async () => reply({ data: chapter }));
  assert.equal((await p.chapter(id, cid)).id, cid);
  await assert.rejects(p.chapter(cid, cid), { status: 404 });
});
test("page order follows the API array rather than filenames", async () => {
  const p = createMangaDexProvider(async () => reply({ baseUrl: "https://example.mangadex.network", chapter: { hash: "abc", data: ["100.jpg", "001.jpg"] } }));
  assert.deepEqual((await p.fetchChapterPages(cid)).map(p => p.page), [1, 2]);
  await assert.rejects(p.fetchChapterPages("https://example.com"), { status: 400 });
});
test("rate limits and removed chapters produce honest errors", async () => {
  const p = createMangaDexProvider(async () => ({ ok: false, status: 429 }));
  await assert.rejects(p.browse(), { status: 429 });
  const missing = createMangaDexProvider(async () => ({ ok: false, status: 404 }));
  await assert.rejects(missing.fetchChapterPages(cid), { status: 404 });
});
