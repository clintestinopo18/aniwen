# Build verification — 2026-10-18

## Hosted-provider correction — 2026-10-19

- Render 1.3.0 confirmed anime catalog/search 200, but WeebCentral info and read returned 502 despite passing locally. The new frontend was held rather than published with that default.
- Hosted fallback checks: ComicK Solo Leveling info and pages 200; MangaPill One Piece info returned 1,212 entries including extras, and chapter 1 returned 57 page URLs.
- Defaults corrected to MangaPill (manga) and ComicK (manhwa). ComicK English chapters are paginated explicitly; the original library only returned the first 60 uploads and included multiple languages.
- Local exact lookups for Solo Leveling chapters 1 and 200 returned the requested English chapter, including chapter 200's series-finale title. Chapter zero/decimals are retained, duplicate uploads grouped, and a partial list never marks a whole series completed.
- 19 offline tests cover both fallback adapters, safe IDs, English filtering, page metadata, exact-number filtering, and numeric order, in addition to existing playback tests.

## Expanded anime catalog and chapter provider — 2026-10-19

- Anime catalog returned 24 entries on each of pages 1 and 2 with different titles and a next-page flag. Browser navigation to page 2 succeeded. Search, genre and sorting are server-side AniList filters; no bulk catalog download is performed.
- Mangakakalot search returned HTTP 403 with a Cloudflare challenge. It is not enabled. A custom WeebCentral catalog query also returned 403 and was removed; the installed provider's ordinary search/info/read methods succeeded.
- WeebCentral Solo Leveling search returned 3 editions. Info returned 201 chapters in normalized ascending order (chapter 0 through 200). Browser chapter 1 loaded 22 page images, with the first images reporting real natural dimensions (720px wide).
- Single-page mode advanced to Page 2 of 22 and retained that position after reload. An uncached provider title link resolved directly to metadata and chapters.
- WeebCentral One Piece returned 1,196 chapters with Chapter 1 first. Browser Chapter 1 returned 57 pages; the first two images loaded at 1066×1600 and the cover rendered visibly.
- 15 offline tests pass, including catalog filter/pagination validation, chapter ID validation, chapter-zero ordering/deduplication, readable-page normalization and safe upstream error handling.
- The Anime page covers the provider's metadata catalog, not guaranteed streaming coverage. Manga/manhwa landing pages remain curated with broader provider search. Manga/manhwa format metadata is not supplied by all search results; category context is not authoritative country classification.

## MegaPlay provider — 2026-10-19

- Observed AniZen's One Piece HD-1 iframe using `megaplay.buzz/stream/s-2/2142/sub`. Integrated MegaPlay's documented AniList-ID embeds independently, not AniZen's internal endpoints or application code.
- Live AniList search returned Frieren and the info endpoint returned 28 episodes. Local HTTP health/info/embed route: 200; malformed episode ID: 400.
- Browser verified actual Frieren episode 1 sub video: 1920×1080, readyState 4, unpaused, time advanced from 61.86 to 68.53 seconds, duration 1559.92 seconds. This is real media playback, not only a loaded iframe.
- Next-episode navigation loaded episode 2 sub and video advanced. Switching to dub loaded the documented `/2/dub` iframe and played with duration 1560.04 seconds, currentTime 59.69 seconds.
- Profile showed saved Episode 2 after playback. Leaving the watch route removed the iframe. Continue links support editorial anime and preserve saved sub/dub mode; exact timestamp seeking is not promised.
- All 10 offline tests passed, covering the old adapter and the new URL validation, metadata mapping, aired episodes, exact-origin/current-frame progress validation, and upstream errors. JavaScript syntax checks passed.
- MegaPlay explicitly refuses sandboxed frames; the integration uses its standard cross-origin iframe. Third-party advertisements/pop-ups and incomplete title/audio mappings remain possible. No distribution/monetization rights are established by these checks.
- These checks supersede the older blanket statement that no video playback has been verified; legacy Aniwatch/Consumet failures and manga-reader limitations below still apply.

## Self-hosted Aniwatch adapter — 2026-10-19

- Added the official npm `aniwatch@2.27.9` package and an independent adapter for the reference project's `/api/v2/hianime` routes. Existing Consumet and MangaDex routes remain available.
- Five offline adapter tests pass: metadata normalization, video/caption normalization, input validation, upstream error handling, and versioned routing. These use fixtures, not live media.
- `npm run check`, `git diff --check`, and production dependency audit passed (zero reported vulnerabilities).
- Local HTTP: health 200; missing search, malformed title, and unsupported playback server 400; unknown Aniwatch route 404.
- Live Frieren search returned 502 from the documented upstream domain. The package's built-in default domain also failed when tested independently. No working episode video has been verified.
- Frontend provider selection is unchanged until search and playback can be verified. Server readiness alone is not proof of streaming availability.
- Hosted release verified: Render deployed commit `015b1d6` after switching the stale automatic trigger to manual deployment. The existing free instance was reused.
- Hosted health returned 200 with Aniwatch registered and the correct Sites CORS origin. Hosted Frieren search also returned upstream 502; MangaDex Solo Leveling search returned 200 with seven results. Playback remains unverified/unavailable through the tested Aniwatch search flow.

## Profile and hosted API update — 2026-10-19 (Asia/Manila)

- Profile icon opens the dashboard; name and bio survive a browser reload.
- Legacy `#settings` opens the same dashboard with no API URL/provider controls.
- Mobile profile checked at 390px viewport: no horizontal overflow (375px content), visible profile icon, stacked panels.
- Fixed API destination is deployment-owned; old stored API preferences are ignored. Local development keeps the same-origin adapter.
- Render service `aniwen-consumet` is live on the free plan in Singapore. `/api/health` returned 200 with the exact Sites origin in its CORS response.
- Hosted MangaDex Solo Leveling search returned seven results. Hosted Hianime search timed out with 504; AnimeKai and AnimePahe returned upstream 502. Server health does not mean anime playback is available.
- JavaScript syntax checks and `git diff --check` passed.

## Passed

- JavaScript syntax: server.mjs, dist/app.js, dist/catalog.js.
- npm installation: 135 packages, audit reported no vulnerabilities at installation.
- Browser: desktop and 390px mobile home layouts; no horizontal overflow at 375px available width on home and title detail.
- Browser: saved Frieren to library, changed status to Watching, reloaded and verified persistence.
- Browser: Manhwa Comedy filter narrowed the collection to Eleceed.
- Browser: live Consumet/MangaDex search for Solo Leveling displayed provider results separately from editorial collection results.
- HTTP smoke checks: home 200, health 200, invalid provider 404, missing title ID 400, disallowed Origin 403, unsupported POST 405.
- Live MangaDex search returned 200 and Korean country metadata with English title normalization.

## Limitations and outstanding checks

- Hianime timed out / returned an upstream 522. AnimeKai failed DNS resolution. AnimePahe timed out. These are provider availability failures, not verified playback.
- The tested Solo Leveling MangaDex edition returned zero available chapters. Not every searchable title has readable chapters.
- Video playback, quality switching, subtitles, reader page loading, and resume behavior are implemented but have not been verified end-to-end with working live media.
- Library import/export is implemented but was not end-to-end browser tested.
- The private static frontend connects to the separately hosted Render API. Free hosting may sleep when idle; provider availability is independent of server health.
- No load test, production security audit, cloud account synchronization, payments, advertising, or content licensing is included.

The 20-title collection is an editorial starter collection, not live trending data or a claim of streaming availability. The bundled server uses @consumet/extensions 1.8.8. Do not treat successful API health as proof that external providers work.
## Hosted reading verification — 2026-10-20

- Render release 1.3.1: health 200; anime catalog page 2 returned 24 titles.
- MangaPill One Piece info returned 1,212 chapter entries and chapter 1 returned 57 image references.
- ComicK Solo Leveling info and chapter page 2 returned English chapters; exact chapter 200 returned one matching entry and 89 image references.
- Browser verification found zero loaded ComicK images. Ordinary HTTP requests to the returned ComicK and MangaPill image URLs returned 403. Metadata/page-reference success is not proof of readable images; reading remains externally blocked in this environment.
- Fixed a duplicate image-error handler that suppressed the reader's failure notice. No challenge bypass, rotating proxies, or image-access workaround was added.
- 19 offline tests and JavaScript syntax checks passed.
