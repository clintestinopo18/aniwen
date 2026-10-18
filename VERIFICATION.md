# Build verification — 2026-10-18

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
- Library import/export and connection diagnostics are implemented but were not end-to-end browser tested.
- This private static deployment does not host the Node/Consumet service. A separately hosted HTTPS API is required for live online search, reading, and playback.
- No load test, production security audit, cloud account synchronization, payments, advertising, or content licensing is included.

The 20-title collection is an editorial starter collection, not live trending data or a claim of streaming availability. The bundled server uses @consumet/extensions 1.8.8. Do not treat successful API health as proof that external providers work.
