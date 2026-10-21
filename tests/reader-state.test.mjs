import test from "node:test";
import assert from "node:assert/strict";
import { nextProgress, pageIndex, readerKey } from "../dist/reader-state.js";
test("new chapters and episodes do not inherit old page or playback positions", () => {
  const old = { id: "old", page: 30, time: 200, audio: "dub" };
  assert.deepEqual(nextProgress(old, { id: "new", chapterNumber: 0 }), { id: "new", number: 0 });
  assert.deepEqual(nextProgress(old, { id: "old", chapterNumber: 2 }, { page: 31 }), { ...old, number: 2, page: 31 });
  assert.equal(old.page, 30);
});
test("resume positions stay inside the available page range", () => {
  assert.equal(pageIndex(-9, 10), 0);
  assert.equal(pageIndex(100, 10), 9);
  assert.equal(pageIndex("4", 10), 4);
  assert.equal(pageIndex(2.9, 10), 2);
  for (const bad of [NaN, Infinity, "oops", undefined]) assert.equal(pageIndex(bad, 10), 0);
});
test("reader shortcuts respect input focus and modifiers", () => {
  assert.equal(readerKey({ key: "ArrowRight" }, "paged"), 1);
  assert.equal(readerKey({ key: "ArrowLeft" }, "paged"), -1);
  assert.equal(readerKey({ key: "ArrowRight" }, "scroll"), 0);
  assert.equal(readerKey({ key: "ArrowRight", ctrlKey: true }, "paged"), 0);
  assert.equal(readerKey({ key: "ArrowRight", target: { closest: () => ({}) } }, "paged"), 0);
});
