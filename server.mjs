import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ANIME, MANGA } from "@consumet/extensions";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || "127.0.0.1";
const allowed = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    "https://yoru-anime-manga-clint.yellowcrow11.chatgpt.site"
  )
    .split(",")
    .map((s) => s.trim()),
);
allowed.add(`http://127.0.0.1:${port}`);
allowed.add(`http://localhost:${port}`);
const providers = {
  anime: {
    hianime: new ANIME.Hianime(),
    animekai: new ANIME.AnimeKai(),
    animepahe: new ANIME.AnimePahe(),
  },
  manga: {
    mangadex: new MANGA.MangaDex(),
    mangapill: new MANGA.MangaPill(),
    comick: new MANGA.ComicK(),
    mangareader: new MANGA.MangaReader(),
    weebcentral: new MANGA.WeebCentral(),
  },
};
// Preserve country, English descriptions, and chapter credit from provider responses.
const mdRecords = new Map(),
  mdChapters = new Map();
const md = providers.manga.mangadex;
md.client.interceptors.request.use((config) => {
  if (config.url?.includes("/feed?"))
    config.url += "&includes[]=scanlation_group";
  return config;
});
md.client.interceptors.response.use((response) => {
  const data = response.data?.data;
  for (const item of Array.isArray(data) ? data : data ? [data] : []) {
    if (item.type === "manga") {
      if (mdRecords.size > 500) mdRecords.delete(mdRecords.keys().next().value);
      mdRecords.set(item.id, item);
    }
    if (item.type === "chapter") {
      if (mdChapters.size > 3000)
        mdChapters.delete(mdChapters.keys().next().value);
      mdChapters.set(item.id, item);
    }
  }
  return response;
});
function enrichManga(item) {
  const record = mdRecords.get(item.id),
    a = record?.attributes;
  if (!a) return item;
  return {
    ...item,
    title: a.title.en || a.altTitles?.find((t) => t.en)?.en || Object.values(a.title)[0] || item.title,
    description: a.description.en || item.description,
    countryOfOrigin:
      a.originalLanguage === "ko"
        ? "KR"
        : a.originalLanguage === "ja"
          ? "JP"
          : a.originalLanguage,
    genres: a.tags
      .filter((t) => t.attributes.group === "genre")
      .map((t) => t.attributes.name.en),
  };
}
const cache = new Map();
let inFlight = 0;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
async function getData(key, fn) {
  const old = cache.get(key);
  if (old && old.expires > Date.now()) return old.value;
  if (inFlight >= 6) fail("The server is busy. Please retry shortly.", 429);
  inFlight++;
  const operation = Promise.resolve()
    .then(fn)
    .finally(() => inFlight--);
  let timer;
  try {
    const result = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(
                new Error("The provider timed out. Try a different provider."),
                { status: 504 },
              ),
            ),
          18000,
        );
      }),
    ]);
    if (cache.size > 150) cache.delete(cache.keys().next().value);
    cache.set(key, { value: result, expires: Date.now() + 120000 });
    return result;
  } finally {
    clearTimeout(timer);
  }
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.writeHead(origin && !allowed.has(origin) ? 403 : 204);
    return res.end();
  }
  if (req.method !== "GET" && req.method !== "HEAD")
    return json(res, 405, { message: "Only GET requests are supported." });
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      if (origin && !allowed.has(origin))
        return json(res, 403, {
          message:
            "This website origin is not allowed. Set ALLOWED_ORIGINS on the server.",
        });
      if (url.pathname === "/api/health")
        return json(res, 200, {
          service: "Yoru Consumet adapter",
          version: "1.0.0",
          library: "@consumet/extensions@1.8.8",
          providers: Object.fromEntries(
            Object.entries(providers).map(([k, v]) => [k, Object.keys(v)]),
          ),
        });
      const parts = url.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      const [, kind, name, action] = parts;
      const provider = providers[kind]?.[name];
      if (!provider || parts.length !== 4)
        fail("Unknown provider or route.", 404);
      let operation;
      if (action === "info") {
        const id = url.searchParams.get("id");
        if (!id || id.length > 700) fail("A valid title id is required.");
        operation = () =>
          kind === "anime"
            ? provider.fetchAnimeInfo(id)
            : provider.fetchMangaInfo(id);
      } else if (action === "watch" && kind === "anime") {
        const id = url.searchParams.get("episodeId");
        if (!id || id.length > 700) fail("A valid episodeId is required.");
        operation = () => provider.fetchEpisodeSources(id);
      } else if (action === "read" && kind === "manga") {
        const id = url.searchParams.get("chapterId");
        if (!id || id.length > 700) fail("A valid chapterId is required.");
        operation = () => provider.fetchChapterPages(id);
      } else {
        if (!action || action.length > 150)
          fail("Search must contain between 1 and 150 characters.");
        const page = Math.max(
          1,
          Math.min(20, Number(url.searchParams.get("page")) || 1),
        );
        operation = () => provider.search(action, page);
      }
      let data = await getData(url.pathname + url.search, operation);
      if (name === "mangadex") {
        if (data.results)
          data = { ...data, results: data.results.map(enrichManga) };
        else if (action === "info")
          data = {
            ...enrichManga(data),
            sourceCredit: {
              name: "MangaDex",
              url: `https://mangadex.org/title/${data.id}`,
            },
            chapters: (data.chapters || [])
              .filter((c) => c.pages > 0)
              .map((c) => ({
                ...c,
                groups: (mdChapters.get(c.id)?.relationships || [])
                  .filter((r) => r.type === "scanlation_group")
                  .map((r) => ({
                    name: r.attributes?.name || "Scanlation group",
                    url: `https://mangadex.org/group/${r.id}`,
                  })),
              })),
          };
      }
      return json(res, 200, data);
    }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!file.startsWith(root + path.sep))
      return json(res, 403, { message: "Forbidden path." });
    const data = await fs.readFile(file);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (error.code === "ENOENT")
      return json(res, 404, { message: "Not found." });
    const status = error.status || 502;
    const message = error.status
      ? error.message
      : "The upstream provider is unavailable. Try another provider in Settings.";
    console.error(
      `[${new Date().toISOString()}] ${req.url?.split("?")[0]}: ${error.message}`,
    );
    json(res, status, { message });
  }
});
server.listen(port, host, () =>
  console.log(
    `Yoru Local: http://${host}:${port}\nConsumet API: http://${host}:${port}/api`,
  ),
);
