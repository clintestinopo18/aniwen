import test from "node:test";
import assert from "node:assert/strict";
import { chapterAvailability, availabilityLabel, checkAvailability } from "../dist/reading-availability.js";
test("missing, empty and partial chapter lists have distinct availability", () => {
  assert.equal(chapterAvailability({}).state, "unknown");
  assert.equal(chapterAvailability({ chapters: [], chapterPagination: { hasNextPage: true } }).state, "unknown");
  assert.equal(chapterAvailability({ chapters: [] }).state, "none");
  const partial = chapterAvailability({ chapters: [{ chapterNumber: "255" }], chapterPagination: { hasNextPage: true } });
  assert.deepEqual(partial, { state: "hosted", loaded: 1, first: "255", more: true });
  assert.equal(chapterAvailability({ chapters: [{ chapterNumber: "0" }] }).first, "0");
  assert.equal(availabilityLabel({ state: "none" }, true), "Publisher link available");
  assert.equal(availabilityLabel({ state: "hosted" }), "English chapters listed");
});
test("checks never turn errors into no-chapter results and keep at most two requests active", async () => {
  let active = 0, peak = 0;
  const results = new Map();
  await checkAvailability([1, 2, 3, 4], async id => {
    active++; peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    if (id === 2) throw new Error("429");
    return { chapters: id === 1 ? [{ id: "chapter" }] : [] };
  }, (id, value) => results.set(id, value.state), { wait: async () => {} });
  assert.equal(peak, 2);
  assert.deepEqual([...results.values()], ["hosted", "unknown", "none", "none"]);
});
test("navigation stops queued checks and ignores stale results", async () => {
  let current = true, loads = 0, updates = 0;
  await checkAvailability([1, 2, 3, 4], async () => {
    loads++; current = false; return { chapters: [] };
  }, () => updates++, { isCurrent: () => current, wait: async () => {} });
  assert.equal(loads, 1);
  assert.equal(updates, 0);
});
