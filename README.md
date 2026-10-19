# Yoru

A responsive anime, manga, and manhwa website with a curated starter collection and self-hosted provider connections. Built with HTML, CSS, and browser JavaScript. The included Node server serves the site, Consumet, and an Aniwatch-compatible API using the official `aniwatch` npm package.

## Run locally

Requires Node.js 22 or later. From this folder:

```sh
npm install
npm start
```

Open http://127.0.0.1:4173. The local app connects automatically to `/api` on this server.

## Hosting the Consumet server

The private Sites deployment contains the static frontend. The Consumet adapter is configured at `https://aniwen-consumet.onrender.com/api` on a free Render web service in Singapore. Render builds the GitHub `main` branch using `npm ci --ignore-scripts` and runs `node server.mjs`. Its environment sets `HOST=0.0.0.0`, `NODE_ENV=production`, and `ALLOWED_ORIGINS=https://yoru-anime-manga-clint.yellowcrow11.chatgpt.site`; Render supplies `PORT`. Multiple origins can be comma-separated. Free hosting can sleep when idle, so the first request may take longer.

No paid host is provisioned automatically. Keep the local default binding (`127.0.0.1`) when running only on your computer. If exposing publicly, place rate limiting and access control at the host/reverse proxy. The bundled adapter limits concurrent work and caches short-lived responses, but CORS is not authentication.

API configuration belongs to the deployment: change `dist/config.js` and redeploy to change the HTTPS base URL or providers. Visitors have no API setup form, and old browser API settings are ignored. Local development automatically uses `/api`. A compatible separately hosted Consumet REST API can also be used by editing that configuration. Supported routes are:

- `GET /anime/{provider}/{query}`
- `GET /anime/{provider}/info?id=...`
- `GET /anime/{provider}/watch?episodeId=...`
- `GET /manga/{provider}/{query}`
- `GET /manga/{provider}/info?id=...`
- `GET /manga/{provider}/read?chapterId=...`

The local adapter also exposes `GET /api/health`. Health confirms the server is running, not that third-party providers work.

## MegaPlay anime playback (default)

AniZen's active HD-1 iframe was observed using MegaPlay. Aniwen now uses the same provider's [documented iframe API](https://megaplay.buzz/api), with AniList metadata fetched by the Node server. No AniZen code or private endpoint is copied. The frontend default is `anime: "megaplay"`; manga/manhwa use WeebCentral as described below.

- `/api/anime/megaplay/Frieren` searches AniList.
- `/api/anime/megaplay/info?id=154587` returns metadata and an aired-episode guide.
- `/api/anime/megaplay/watch?episodeId=154587%3A1&category=sub` returns an embed URL, not extracted video files.
- The browser loads `https://megaplay.buzz/stream/ani/{anilistId}/{episode}/{sub|dub}`. Episode selection, previous/next, and sub/dub controls are included.

The player is cross-origin and requires an ordinary, unsandboxed iframe; MegaPlay refuses sandboxed embeds. It may show third-party ads or pop-ups. No local library or profile data is sent to it. Progress messages are accepted only from the current iframe window and exact MegaPlay origin. Progress and episode completion are saved locally when reported, but the provider has no documented seek command for restoring a saved timestamp. Episode lists are metadata, not proof of playable streams: ID mappings, regional availability, and sub/dub coverage may vary. This integration does not establish distribution or monetization rights.

Render auto-deploy is disabled on the existing service: after pushing the GitHub `main` branch, trigger a manual deployment and verify it is live before publishing the frontend. No extra paid service is required.

## Live anime catalog and readable chapters

The Anime page now queries AniList in pages of 24, with popular/trending/title/year sorting, genre filtering, and title search. `GET /api/anime/megaplay/catalog?page=2&sort=popular&genre=all` exposes this catalog. It is no longer limited to the starter collection. Adult-tagged AniList entries are excluded. This is access to the available metadata catalog, not a promise that every anime has a MegaPlay mapping or playable video.

Manga and manhwa use the installed Consumet WeebCentral provider, with a validation/normalization adapter in `providers/chapters.mjs`. Their landing pages remain curated, and title search goes beyond the starter collection with pagination. Opening a curated comic automatically looks up matching editions; visitors choose the edition to see chapters. New provider title links can load directly without depending on a previous browser search.

Mangakakalot's public search returned a Cloudflare challenge (HTTP 403), so it was not enabled and no challenge bypass was added. A custom WeebCentral bulk-catalog request also failed; chapter search/info/reading use the existing provider's working methods instead. Formats in provider search may be mixed: the Manga/Manhwa search category is browsing context, not verified origin metadata when the provider omits it.

Chapter IDs are validated, duplicates removed, and chapter numbers sorted numerically, including chapter 0 and decimals. Pages load directly from the image host with no image proxy. Failed images show a readable error; upstream failures do not become fake empty chapter lists. Existing MangaDex, MangaPill, and other routes remain available for compatibility.

## Self-hosted Aniwatch API (legacy)

The same Node process now runs `aniwatch@2.27.9`; no separate API URL, database, or paid server is required. This is an independently written adapter, not a copy of AniProject's application. It implements the subset of Aniwatch v2 used in that reference project:

- `GET /api/v2/hianime/search?q=Frieren&page=1`
- `GET /api/v2/hianime/anime/{animeId}`
- `GET /api/v2/hianime/anime/{animeId}/episodes`
- `GET /api/v2/hianime/episode/servers?animeEpisodeId=...`
- `GET /api/v2/hianime/episode/sources?animeEpisodeId=...&server=hd-1&category=sub`

Versioned success responses wrap the upstream result in `{ "success": true, "data": ... }`. Errors have a non-2xx status and `{ "success": false, "message": ... }`. The normalized `/api/anime/aniwatch/{query}`, `/info?id=...`, and `/watch?episodeId=...` routes also fit Yoru's existing player. Episode IDs containing `?ep=` must be URL-encoded when used as query values. Supported source options are `hd-1`/`hd-2` and `sub`/`dub`/`raw`.

The deployment-owned `ANIWATCH_DOMAIN` defaults to `hianimez.to`, the domain advertised in the package documentation. The package's built-in `aniwatchtv.to` returned 404 in testing; the documented domain also failed from the local machine. This adapter remains available for compatibility, but is not the frontend default.

This API does not proxy media or add any custom decryption, geographic-block, or access-control bypass. Third-party source availability and browser-compatible playback are separate from a healthy API process.

## Features

- Separate Anime, Manga, Manhwa pages; genre filters; release-year and title sorting.
- Search the curated collection and the configured Consumet providers.
- Explicit edition selection, episode lists, HLS/MP4 playback, quality controls, and subtitle tracks when supplied by the provider.
- Scroll and single-page chapter readers.
- Favorites, planned/in-progress/completed statuses, automatic playback/reading progress, library export/import.
- Profile-icon dashboard with editable name/bio, library totals, continue links, recently saved stories, and playback preferences. Profiles and libraries are browser-local, not cloud accounts. The old `#settings` link opens the profile dashboard for compatibility.
- Responsive navigation, keyboard focus, reduced-motion support, and clear connection errors.

The curated collection is a limited editorial selection, not live rankings. Collection artwork and basic metadata are credited to AniList and the respective creators/publishers in the site. Original short descriptions are in `dist/catalog.js`. `fetch-artwork.mjs` is a one-time asset preparation utility; it is not used by the website at runtime.

## Availability

The former `api.consumet.org` endpoint returned HTTP 451 during this build. Individual providers may be unavailable or change their behavior. Episode guides do not guarantee playable videos. Provider URLs requiring browser-incompatible headers or blocked by CORS may not play. No media proxy or DRM bypass is included.

Software access and content distribution rights are separate. Confirm rights and provider terms before monetizing content.

## Verification

Run `npm run check` for JavaScript syntax validation and `npm test` for the Aniwatch and MegaPlay adapters' offline contract/validation tests. Fixture tests do not establish live playback. See `VERIFICATION.md` for live checks.
