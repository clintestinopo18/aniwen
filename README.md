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

The private Sites deployment contains the static frontend. It does not run the Node server. Deploy this project to a Node-compatible host with `npm ci` as the install command and `npm start` as the start command. Set `HOST=0.0.0.0`, your host's `PORT`, and `ALLOWED_ORIGINS=https://yoru-anime-manga-clint.yellowcrow11.chatgpt.site`. Multiple origins can be comma-separated. Use HTTPS on the host, then enter `https://YOUR-SERVER/api` in Yoru's Connection & settings page and save it.

No paid host is provisioned automatically. Keep the local default binding (`127.0.0.1`) when running only on your computer. If exposing publicly, place rate limiting and access control at the host/reverse proxy. The bundled adapter limits concurrent work and caches short-lived responses, but CORS is not authentication.

A compatible separately hosted Consumet REST API can also be used. Enter its actual base URL, which may omit `/api`. Supported routes are:

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
- Responsive navigation, keyboard focus, reduced-motion support, and clear connection errors.

The curated collection is a limited editorial selection, not live rankings. Collection artwork and basic metadata are credited to AniList and the respective creators/publishers in the site. Original short descriptions are in `dist/catalog.js`. `fetch-artwork.mjs` is a one-time asset preparation utility; it is not used by the website at runtime.

## Availability

The former `api.consumet.org` endpoint returned HTTP 451 during this build. The npm library installs successfully, but individual providers may be unavailable or change their behavior. The site never reports a title as playable until its connected provider supplies entries and sources. Provider URLs requiring browser-incompatible headers or blocked by CORS may not play. No media proxy or DRM bypass is included.

Software access and content distribution rights are separate. Confirm rights and provider terms before monetizing content.

## Verification

Run `npm run check` for JavaScript syntax validation. See `VERIFICATION.md` for the checks performed on this build.
