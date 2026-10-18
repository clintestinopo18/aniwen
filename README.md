# Yoru

A responsive anime, manga, and manhwa website with a curated starter collection and a Consumet connection. Built with HTML, CSS, and browser JavaScript. The included Node server serves the site and a small REST adapter around `@consumet/extensions`.

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

The former `api.consumet.org` endpoint returned HTTP 451 during this build. The npm library installs successfully, but individual providers may be unavailable or change their behavior. The site never reports a title as playable until its connected provider supplies entries and sources. Provider URLs requiring browser-incompatible headers or blocked by CORS may not play. No media proxy or DRM bypass is included.

Software access and content distribution rights are separate. Confirm rights and provider terms before monetizing content.

## Verification

Run `npm run check` for JavaScript syntax validation. See `VERIFICATION.md` for the checks performed on this build.
