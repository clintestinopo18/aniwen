# Build verification — 2026-10-18

## Self-hosted Aniwatch adapter — 2026-10-19

- Added the official npm `aniwatch@2.27.9` package and an independent adapter for the reference project's `/api/v2/hianime` routes. Existing Consumet and MangaDex routes remain available.
- Five offline adapter tests pass: metadata normalization, video/caption normalization, input validation, upstream error handling, and versioned routing. These use fixtures, not live media.
- `npm run check`, `git diff --check`, and production dependency audit passed (zero reported vulnerabilities).
- Local HTTP: health 200; missing search, malformed title, and unsupported playback server 400; unknown Aniwatch route 404.
- Live Frieren search returned 502 from the documented upstream domain. The package's built-in default domain also failed when tested independently. No working episode video has been verified.
- Frontend provider selection is unchanged until search and playback can be verified. Server readiness alone is not proof of streaming availability.
- Hosted release pending: Render remains on its initial deployment despite repository updates; dashboard sign-in is needed to inspect its deployment configuration.

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
