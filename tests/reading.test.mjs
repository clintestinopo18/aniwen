import test from "node:test";
import assert from "node:assert/strict";
import { createComicKProvider, createMangaPillProvider, comicChapter, comicSlug, mergeChapters } from "../providers/reading.mjs";
test("ComicK validates safe English chapter identities", () => {
  assert.deepEqual(comicChapter("solo-leveling/abc_123-chapter-12.5-en"), { slug: "solo-leveling", number: "12.5" });
  for (const id of ["../x", "https://example.com", "a/b"]) assert.throws(() => comicSlug(id), { status: 400 });
  for (const id of ["a/b-chapter-1-fr", "a/b-chapter-1-en?x", "a/../b-chapter-1-en"]) assert.throws(() => comicChapter(id), { status: 400 });
});
test("ComicK retrieves English chapter pages and exact chapter filters", async () => {
  let query;
  const p = createComicKProvider({ _axios: () => ({ get: async (path, opts) => { query = opts.params; return { data: { data: [{ hid: "x", lang: "en", chap: "0" }, { hid: "y", lang: "en", chap: "0" }, { hid: "z", lang: "fr", chap: "1" }], pagination: { last_page: 30 } } }; } }), getComicData: async () => ({ title: "Test", country: "KR" }), search: async () => ({ results: [] }), fetchChapterPages: async () => [{ img: "https://example.com/page.png", page: 0 }] });
  const info = await p.fetchMangaInfo("test");
  assert.equal(info.chapters.length, 1);
  assert.equal(info.chapterPagination.hasNextPage, true);
  assert.equal(info.chapterPagination.totalPages, 30);
  const filtered = await p.chapters("test", 2, "12.5");
  assert.deepEqual(filtered.chapters, []);
  assert.deepEqual(query, { lang: "en", chapOrder: "asc", page: 2, chap: "12.5" });
  assert.equal((await p.fetchChapterPages("test/x-chapter-0-en")).length, 1);
  await assert.rejects(p.chapters("test", 0), { status: 400 });
  await assert.rejects(p.chapters("test", 1, "bad"), { status: 400 });
});
test("chapter merge retains zero and decimals without duplicate uploads", () => {
  assert.deepEqual(mergeChapters([{ id: "a", chapterNumber: "2" }], [{ id: "b", chapterNumber: "0" }, { id: "c", chapterNumber: "1.5" }, { id: "d", chapterNumber: "2" }]).map(c => c.id), ["b", "c", "a"]);
});
test("MangaPill normalizes chapter order and rejects invalid paths", async () => {
  const p = createMangaPillProvider({ search: async () => ({ results: [] }), fetchMangaInfo: async () => ({ chapters: [{ id: "2", chapter: "12.5" }, { id: "1", chapter: "1" }] }), fetchChapterPages: async () => [] });
  assert.deepEqual((await p.fetchMangaInfo("2/one-piece")).chapters.map(c => c.chapterNumber), ["1", "12.5"]);
  await assert.rejects(p.fetchMangaInfo("../secret"), { status: 400 });
  await assert.rejects(p.fetchChapterPages("2-10001000/one-piece-chapter-1"), { status: 404 });
});
