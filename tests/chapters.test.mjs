import test from "node:test";
import assert from "node:assert/strict";
import { createChapterProvider, chaptersInOrder, chapterId, seriesId } from "../providers/chapters.mjs";
const id = "01J76XYCPSY3C4BNPBRY8JMCBE/Solo-Leveling";
const first = "01J76XYXYZGGRVGEGATYQWFTD8", last = "01J76XZ666GREP4DQDKEP1YDZG";
test("restricts chapter and series requests to provider IDs", () => {
  assert.equal(seriesId(id), id);
  assert.equal(chapterId(first), first);
  for (const input of ["../secret", "https://example.com/", id + "?url=x", id + "/more", "abc"]) assert.throws(() => seriesId(input), { status: 400 });
  for (const input of [id, first + "/..", first + "?x=1"]) assert.throws(() => chapterId(input), { status: 400 });
});
test("orders chapters numerically, preserves chapter zero, and deduplicates IDs", () => {
  const result = chaptersInOrder([{ id: last, title: "Chapter 200" }, { id: first, title: "Chapter 0" }, { id: last, title: "Chapter 200" }, { id: "invalid", title: "Chapter 1" }]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(c => c.chapterNumber), ["0", "200"]);
});
test("returns provider chapters and pages without fabricating content", async () => {
  const p = createChapterProvider({ search: async (q, page) => ({ results: [{ id, title: q }], currentPage: page, hasNextPage: true }), fetchMangaInfo: async () => ({ id, title: "Solo Leveling", chapters: [{ id: last, title: "Chapter 200" }, { id: first, title: "Chapter 0" }] }), fetchChapterPages: async () => [{ img: "https://example.com/page.png", page: 1 }, { img: "javascript:bad", page: 2 }] });
  assert.equal((await p.search(" Solo Leveling ", 2)).currentPage, 2);
  const info = await p.fetchMangaInfo(id);
  assert.equal(info.totalChapters, 2);
  assert.equal(info.chapters[0].id, first);
  assert.equal((await p.fetchChapterPages(first)).length, 1);
  assert.throws(() => p.search(" "), { status: 400 });
  assert.throws(() => p.search("test", 0), { status: 400 });
});
test("handles upstream failure and empty chapters honestly", async () => {
  const p = createChapterProvider({ search: async () => { throw Object.assign(new Error("secret upstream details"), { isAxiosError: true, status: 403 }); }, fetchChapterPages: async () => [] });
  await assert.rejects(p.search("test"), e => e.status === 502 && !e.message.includes("secret"));
  await assert.rejects(p.fetchChapterPages(first), { status: 404 });
});
