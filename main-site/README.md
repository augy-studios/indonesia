# Indonesia Bisa

A small, free directory of Indonesia-focused tools and data, built on public and community APIs. Part of [UwU Apps](https://uwuapps.org).

Deployed at [indonesia.uwuapps.org](https://indonesia.uwuapps.org).

## What's here

The homepage (`/`) is a searchable directory of every page on the site. Each data-bearing page proxies a single public API through a small Vercel serverless function in `/api`, which adds input validation, response-shape checks, short-lived caching and a per-IP rate limit before handing the data to the page.

| Page | Source | Notes |
| --- | --- | --- |
| `/weather` | [BMKG prakiraan cuaca](https://data.bmkg.go.id/prakiraan-cuaca/) | Weather forecast by adm4 area code |
| `/quake` | [BMKG TEWS](https://data.bmkg.go.id/gempabumi/) | Latest felt quake plus recent M5.0+ quakes |
| `/crypto` | [Indodax](https://indodax.com/) | Rupiah-denominated crypto ticker |
| `/emsifa` | [Emsifa API Wilayah Indonesia](https://github.com/emsifa/api-wilayah-indonesia) | Province to village picker |
| `/kodepos` | [KodePos Indonesia](https://kodepos.vercel.app/) | Postal code search |
| `/holidays` | [libur.deno.dev](https://libur.deno.dev/) | National holidays and cuti bersama |
| `/quran` | [EQuran.id](https://equran.id/) | Quran text, translation and audio |

None of these upstream APIs require a key. Indonesia Bisa is an independent project and is not affiliated with BMKG, Indodax, or any other provider it links to.

## Stack

- Static HTML/CSS/JS, no build step or framework.
- Vercel serverless functions (`/api/*.js`) for API proxying.
- No database - every page reads from a stateless public API, so there's nothing to persist server-side.
- A service worker (`sw.js`) precaches the app shell and caches API responses with a stale-while-revalidate strategy, so previously-visited pages keep working offline.

## Structure

```text
css/       shared theme + per-page stylesheets
js/        shared theme/icon scripts + per-page scripts
api/       Vercel serverless functions (one per external API)
weather/   /weather page
quake/     /quake page
crypto/    /crypto page
emsifa/    /emsifa page
kodepos/   /kodepos page
holidays/  /holidays page
quran/     /quran page
```

## Theming

Seven light themes are available from the palette button in the header (persisted in `localStorage`). All use flat brand colours with a glassmorphism surface treatment - no gradients, orbs, or blobs. See `css/theme.css`.

## Local development

There's no build step. Serve the `main-site` directory with any static file server, e.g.:

```sh
npx serve main-site
```

The `/api` routes only work when run through the Vercel CLI (`vercel dev`) or once deployed, since they're serverless functions rather than static files.

## Deployment

Deploy `main-site` as the Vercel project root. No environment variables or database are required.
