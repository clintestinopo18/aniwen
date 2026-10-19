import test from "node:test";
import assert from "node:assert/strict";
import { embedUrl, playerEvent, MEGAPLAY_ORIGIN } from "../dist/megaplay.js";
import { createMegaPlayProvider, airedEpisodes } from "../providers/megaplay.mjs";

test("builds only documented, bounded AniList embeds", () => {
  assert.equal(embedUrl(154587, 1), "https://megaplay.buzz/stream/ani/154587/1/sub");
  assert.equal(embedUrl(154587, 2, "dub"), "https://megaplay.buzz/stream/ani/154587/2/dub");
  for (const id of ["../x", "https://example.com", 0, -1, 1.5, "1?x=y", 10000001]) assert.throws(() => embedUrl(id, 1), { status: 400 });
  assert.throws(() => embedUrl(1, 5001), { status: 400 });
  assert.throws(() => embedUrl(1, 1, "bad"), { status: 400 });
});
test("accepts progress only from the current trusted iframe", () => {
  const frame = {};
  const event = { source: frame, origin: MEGAPLAY_ORIGIN, data: { event: "time", time: 30, duration: 1400 } };
  assert.deepEqual(playerEvent(event, frame), { type: "progress", time: 30, duration: 1400 });
  assert.equal(playerEvent({ ...event, origin: MEGAPLAY_ORIGIN + ".evil.test" }, frame), null);
  assert.equal(playerEvent({ ...event, source: {} }, frame), null);
  assert.equal(playerEvent(event, null), null);
  for (const data of ["invalid", "x".repeat(10001), null, { event: "time", time: -1, duration: 3 }, { event: "time", time: 50, duration: 3 }, { event: "time", time: 1, duration: Infinity }]) assert.equal(playerEvent({ ...event, data }, frame), null);
  assert.deepEqual(playerEvent({ ...event, data: JSON.stringify({ type: "watching-log", currentTime: 2, duration: 100 }) }, frame), { type: "progress", time: 2, duration: 100 });
  assert.deepEqual(playerEvent({ ...event, data: { event: "complete" } }, frame), { type: "complete" });
  assert.deepEqual(playerEvent({ ...event, data: { event: "error" } }, frame), { type: "error" });
});
test("does not list future episodes as aired", () => {
  assert.equal(airedEpisodes({ status: "NOT_YET_RELEASED", episodes: 12 }), 0);
  assert.equal(airedEpisodes({ status: "RELEASING", episodes: 12, nextAiringEpisode: { episode: 4 } }), 3);
  assert.equal(airedEpisodes({ status: "RELEASING", episodes: 12 }), 0);
  assert.equal(airedEpisodes({ status: "FINISHED", episodes: 28 }), 28);
});
test("maps metadata to episodes without claiming extracted media streams", async () => {
  const media = { id: 154587, title: { english: "Frieren" }, status: "FINISHED", episodes: 28 };
  const calls = [];
  const p = createMegaPlayProvider(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ data: { Media: media, Page: { media: [media], pageInfo: { currentPage: 1, hasNextPage: false } } } }) };
  });
  assert.equal((await p.search(" Frieren ")).results[0].id, "154587");
  const info = await p.fetchAnimeInfo("154587");
  assert.equal(info.episodes.length, 28);
  assert.deepEqual(info.episodes[0], { id: "154587:1", number: 1, title: "Episode 1" });
  const watch = await p.fetchEpisodeSources("154587:2", "dub");
  assert.equal(watch.embed.url, embedUrl(154587, 2, "dub"));
  assert.deepEqual(watch.sources, []);
  assert.equal(calls[0].url, "https://graphql.anilist.co");
  assert.equal(calls[0].body.variables.search, "Frieren");
  for (const value of ["", " ", "x".repeat(151)]) await assert.rejects(p.search(value), { status: 400 });
  await assert.rejects(p.fetchAnimeInfo("../x"), { status: 400 });
  await assert.rejects(p.fetchEpisodeSources("1:2:3"), { status: 400 });
  assert.equal(calls.length, 2);
});
test("reports catalog failures clearly", async () => {
  await assert.rejects(createMegaPlayProvider(async () => { throw new Error("private"); }).search("test"), e => e.status === 502 && !e.message.includes("private"));
  await assert.rejects(createMegaPlayProvider(async () => ({ status: 429 })).search("test"), { status: 429 });
  await assert.rejects(createMegaPlayProvider(async () => ({ ok: true, json: async () => ({ data: { Media: null } }) })).fetchAnimeInfo(1), { status: 404 });
});
