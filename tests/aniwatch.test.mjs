import test from "node:test";
import assert from "node:assert/strict";
import { createAniwatchProvider, aniwatchRoute, titleId, episodeId, searchInput } from "../providers/aniwatch.mjs";

const id = "test-story-123", ep = id + "?ep=456";
function fixture(overrides = {}) {
  return createAniwatchProvider({
    search: async (q, page) => ({ animes: [{ id, name: q, poster: "https://example.com/cover.jpg", episodes: { sub: 2 }, type: "TV" }], currentPage: page, hasNextPage: false }),
    getInfo: async () => ({ anime: { info: { name: "Test story", poster: "https://example.com/cover.jpg", stats: { type: "TV" } }, moreInfo: { aired: "Sep 29, 2023", genres: ["Fantasy"] } } }),
    getEpisodes: async () => ({ totalEpisodes: 2, episodes: [{ episodeId: ep, number: 1, title: "Beginning" }] }),
    getEpisodeServers: async () => ({ sub: [{ serverName: "hd-1" }] }),
    getEpisodeSources: async (episode, server, category) => ({ sources: [{ url: "https://example.com/test.m3u8", type: "hls" }, { url: "javascript:bad" }], tracks: [{ file: "https://example.com/en.vtt", label: "English", kind: "captions" }, { file: "https://example.com/thumbs.vtt", kind: "thumbnails" }], headers: { Referer: "https://example.com" }, episode, server, category }),
    ...overrides,
  });
}
test("maps search and episode metadata to the existing player contract", async () => {
  const provider = fixture();
  const results = await provider.search(" Test story ", 2);
  assert.equal(results.currentPage, 2);
  assert.equal(results.results[0].title, "Test story");
  const info = await provider.fetchAnimeInfo(id);
  assert.equal(info.releaseDate, "2023");
  assert.equal(info.episodes[0].id, ep);
  assert.equal(info.totalEpisodes, 2);
});
test("normalizes sources and captions without treating thumbnails as subtitles", async () => {
  const data = await fixture().fetchEpisodeSources(ep);
  assert.equal(data.sources.length, 1);
  assert.equal(data.sources[0].isM3U8, true);
  assert.deepEqual(data.subtitles, [{ url: "https://example.com/en.vtt", lang: "English", default: false }]);
});
test("rejects malformed IDs and unbounded queries before upstream requests", async () => {
  for (const value of ["../secret", "https://example.com", "test-123?bad=1", "test-123/other"]) assert.throws(() => titleId(value), { status: 400 });
  for (const value of ["test-123", ep + "&url=x", "test-123?ep=abc"]) assert.throws(() => episodeId(value), { status: 400 });
  for (const value of ["", " ", "x".repeat(151)]) assert.throws(() => searchInput(value), { status: 400 });
  for (const page of [0, 21, 1.5, "bad"]) assert.throws(() => searchInput("test", page), { status: 400 });
  await assert.rejects(fixture().fetchEpisodeSources(ep, "https://example.com"), { status: 400 });
  await assert.rejects(fixture().fetchEpisodeSources(ep, "hd-1", "bad"), { status: 400 });
});
test("reports upstream failures instead of silently returning no episodes", async () => {
  const p = fixture({ search: async () => { throw new Error("private upstream detail"); } });
  await assert.rejects(p.search("test"), (e) => e.status === 502 && !e.message.includes("private"));
});
test("supports the reference project's versioned API routes and dub selection", async () => {
  const p = fixture();
  const url = (path) => new URL("http://localhost/api/v2/hianime" + path);
  const search = await aniwatchRoute(url("/search?q=Test&page=1"), p)();
  assert.equal(search.animes[0].name, "Test");
  assert.equal((await aniwatchRoute(url(`/anime/${id}/episodes`), p)()).totalEpisodes, 2);
  assert.equal((await aniwatchRoute(url(`/anime/${id}`), p)()).anime.info.name, "Test story");
  assert.equal((await aniwatchRoute(url(`/episode/servers?animeEpisodeId=${encodeURIComponent(ep)}`), p)()).sub.length, 1);
  const source = await aniwatchRoute(url(`/episode/sources?animeEpisodeId=${encodeURIComponent(ep)}&category=dub&server=hd-2`), p)();
  assert.equal(source.category, "dub");
  assert.equal(source.server, "hd-2");
  assert.equal(aniwatchRoute(url("/unknown"), p), null);
});
