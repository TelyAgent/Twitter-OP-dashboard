# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Shape

This repo is a small multi-surface product made of static HTML pages plus a thin set of Twitter-proxy serverless functions:

- `pallax_weekly_dashboard.html` is the main weekly operations dashboard.
- `pallax_weekly_dashboard_preview.html` is a preview variant of the main dashboard.
- `weeklyreport/02-radar.html` is the hotspot radar view.
- `weeklyreport/07-templates.html` is the template library / template usage flow.
- `weeklyreport/08-sources.html` is the source management and source-sync flow.
- `api/**` are the Vercel serverless functions that proxy X/Twitter reads.
- `apps/api/server.js` is the legacy Fastify version of the same proxy, still deployable to the VPS via `deploy-api.sh`. It is no longer the recommended target — keep it in sync with `api/**` only as long as the VPS deployment is alive.

There is no root app framework, bundler, or router. Navigation is done with plain links between HTML files, and most frontend logic is inline in each page. `config.js` at the repo root is the single source of truth for `SUPABASE_URL`, `SUPABASE_KEY`, and `API_BASE`; every HTML page loads it via a `<script src="…/config.js">` tag right after the supabase-js CDN, and inline scripts read from `window.PALLAX_CONFIG`.

## Common Commands

### Local frontend work

There is no checked-in frontend build step. Pages are standalone HTML files.

- Serve the repo root locally with a simple static server:
  - `python3 -m http.server 8080`
- Then open:
  - `http://localhost:8080/pallax_weekly_dashboard.html`
  - `http://localhost:8080/pallax_weekly_dashboard_preview.html`
  - `http://localhost:8080/weeklyreport/02-radar.html`
  - `http://localhost:8080/weeklyreport/07-templates.html`
  - `http://localhost:8080/weeklyreport/08-sources.html`

A plain static server is enough for Supabase-only flows. Anything that hits `/api/twitter/*` (07-templates "记录使用", 08-sources "↻ 同步" and list import) needs `vercel dev` instead, which serves the static files **and** the Functions on the same origin.

### Local API work (Vercel Functions)

From the repo root:

- `npm install` — installs `twitter-api-v2` for the functions
- `npx vercel dev` — serves the static pages + `/api/*` on `http://localhost:3000` (or the next free port). First run prompts you to link a Vercel project.
- Local env: put `TWITTER_BEARER_TOKEN=…` into `.env.local` (gitignored via `.env.*`); `vercel dev` injects it into Function processes.

Sanity check:

- `curl http://localhost:3000/api/health`

### Local API work (legacy Fastify, only for VPS parity)

Run from `apps/api`:

- `npm install`, then `npm run dev` (watch) or `npm start` (once).
- Reads `TWITTER_BEARER_TOKEN`, `PORT` (default 8081), `HOST` (default 0.0.0.0) from `.env`.
- `curl http://localhost:8081/api/health`.

### Tests / linting

- There are currently no checked-in lint scripts.
- There are currently no checked-in automated test scripts.
- There is no repo-defined single-test command.

### Deployment

The repo supports two deploy targets in parallel.

#### Vercel (current target)

The whole repo is a Vercel project: static HTML at the root and serverless functions under `api/`.

- `vercel.json` — `cleanUrls: true`, plus rewrites that map `/` → `pallax_weekly_dashboard.html` and `/preview` → the preview HTML.
- Root `package.json` declares `twitter-api-v2` so Vercel installs it for the Functions runtime.
- `npx vercel --prod` deploys; the project URL is auto-generated under `*.vercel.app`. Custom domain is not configured.
- Required Vercel project env var: `TWITTER_BEARER_TOKEN`. The Functions return HTTP 503 with `TWITTER_BEARER_TOKEN not configured` if it is missing or still set to a `PLACEHOLDER_…` value.
- Function routes (Node.js, ESM, default-exported handler):
  - `GET /api/health`
  - `POST /api/twitter/tweet` — body `{ url | id }`
  - `POST /api/twitter/handle/[handle]/recent` — body `{ hours? }` (1–720, default 168)
  - `POST /api/twitter/list/[listId]/members`
- Shared helpers live at `api/_lib/twitter.js`. Path tip: imports use `../_lib/twitter.js` from `api/twitter/tweet.js`, and `../../../_lib/twitter.js` from the `[handle]` / `[listId]` nested routes.

Because Vercel serves over HTTPS at the same origin as the Functions, the frontend's `API_BASE` is `''` (relative) on Vercel — `config.js` picks that automatically. There is no Mixed-Content issue.

#### Legacy VPS (still works, kept in sync until retirement)

Both legacy deploy scripts target the same Tokyo VPS, hardcoded inside the scripts:

| Item | Value |
|---|---|
| Host | `43.163.198.237` (no DNS / custom domain) |
| SSH user | `root` |
| SSH key | `~/.ssh/tokyo_server` |
| Static remote dir | `/root/pallax-dashboard/` |
| API remote dir | `/root/pallax-api/` |
| API systemd unit | `pallax-api.service` |
| API log file | `/var/log/pallax-api.log` |

`./deploy.sh` pushes the static surface (`pallax_weekly_dashboard.html` → remote `index.html`, `…_preview.html` → `preview.html`, `weeklyreport/*.html|css`, **and `config.js`** since the pages now `<script src>` it). It uses `rsync` (diff-only), backs up the previous `index.html` to `index.html.bak-<TS>`, and md5-verifies after upload. **NOTE**: as of the Vercel migration, `deploy.sh` does not yet rsync `config.js` — when running the VPS deploy, either edit the script to include `config.js` in the `rsync` set or upload it manually, otherwise the pages will load with `window.PALLAX_CONFIG` undefined.

`./deploy-api.sh` uploads `apps/api/server.js` and `apps/api/package.json` to the VPS, runs `npm install --omit=dev`, and restarts `pallax-api.service`. First run also writes a placeholder `.env` (`TWITTER_BEARER_TOKEN=PLACEHOLDER_…`) — the real bearer token must be filled in by SSH and the unit restarted.

Live VPS URLs (plain HTTP):

- `http://43.163.198.237:8080/` — main dashboard (served as `index.html`)
- `http://43.163.198.237:8080/preview.html`
- `http://43.163.198.237:8080/weeklyreport/02-radar.html`
- `http://43.163.198.237:8080/weeklyreport/07-templates.html`
- `http://43.163.198.237:8080/weeklyreport/08-sources.html`
- `http://43.163.198.237:8081/api/health` — Fastify API

The `:8080` static server itself is **not** managed by `deploy.sh`; the script only writes files into `/root/pallax-dashboard/`. Whatever serves that directory on `:8080` (nginx / `python -m http.server` / similar) is provisioned outside this repo. Port `:8081` is the Fastify API managed by `pallax-api.service`.

`config.js` detects the VPS by `location.port === '8080'` or `location.hostname === '43.163.198.237'` and sets `API_BASE` to `http://<host>:8081`, so the legacy frontend keeps reaching the legacy Fastify API without per-page changes.


## Architecture

### Frontend structure

The frontend is not componentized. Each page is a mostly self-contained HTML document with:

- large inline CSS blocks
- large inline script blocks
- direct DOM querying and event listeners
- page-local mutable state
- occasional globals on `window` for cross-block coordination

`weeklyreport/styles.css` exists, but substantial page styling still lives inside each HTML file.

When editing UI behavior, read the whole page first. Logic is often spread across multiple IIFEs in the same file rather than separated into modules.

### State and persistence model

The main dashboard uses an offline-first pattern:

- local mutable JS objects hold the active state
- state is persisted to `localStorage`
- Supabase is used to sync that state to the cloud

The core dashboard entities are:

- `teams`
- `team_schemas`
- `team_api_configs`
- `weekly_data`

The dashboard stores week/team data in `localStorage` first, then mirrors it to Supabase.

The weeklyreport pages are more DB-first, but still rely on browser session/local storage behavior for auth reuse.

### Auth and shared session model

All product surfaces use the same Supabase project and publishable key in-page.

Important consequence:

- `weeklyreport/08-sources.html`, `weeklyreport/07-templates.html`, and `weeklyreport/02-radar.html` reuse the session established by the main dashboard because they share the same Supabase project in the same browser.

If a content-factory page appears to be "logged out," check whether the dashboard session exists first.

### Backend and data flow

The X/Twitter proxy lives in two parallel implementations that share the same wire contract:

- **`api/**` (Vercel Functions, current target)** — one function file per route, ESM, default-exported handler, with shared helpers in `api/_lib/twitter.js`.
- **`apps/api/server.js` (Fastify, legacy VPS)** — the original implementation, kept deployable while the VPS is alive.

Both expose:

- `GET /api/health`
- `POST /api/twitter/tweet`
- `POST /api/twitter/handle/<handle>/recent`
- `POST /api/twitter/list/<listId>/members`

The usual flow is:

1. browser page calls the proxy at whatever `window.PALLAX_CONFIG.API_BASE` resolves to (empty string on Vercel, `http://<host>:8081` on the legacy VPS — see `config.js`)
2. proxy fetches X/Twitter data via bearer token
3. browser page writes derived records into Supabase

If you change a route's request/response shape, change it in **both** implementations until the VPS is decommissioned.

## Data Model

The authoritative schema reference is `supabase_setup_v2.sql`.

### Supabase instance

The whole product (all 5 frontend pages) talks to a single hosted Supabase project. There is no self-hosted database and no migration tool — schema changes are made by hand in the Supabase SQL editor and mirrored back into `supabase_setup_v2.sql`.

| Item | Value |
|---|---|
| URL | `https://snflonpxmzkeytzytqpg.supabase.co` |
| Project ref | `snflonpxmzkeytzytqpg` |
| Publishable (anon) key | `sb_publishable_AIJ7GbAmcE0pqDjPGb5cfg_JZj01ZyD` |

URL + key + `API_BASE` live in **one place**: `config.js` at the repo root, exposing `window.PALLAX_CONFIG`. Each HTML page loads it via `<script src="config.js">` (or `../config.js` from `weeklyreport/`) right after the supabase-js CDN, and inline scripts read `const { SUPABASE_URL, SUPABASE_KEY } = window.PALLAX_CONFIG;` (and `API_BASE` for the Twitter-touching pages).

To switch Supabase projects:

1. Edit `SUPABASE_URL` / `SUPABASE_KEY` in `config.js`.
2. In the new Supabase project's SQL editor, run `supabase_setup_v2.sql` (and optionally `seed_user_profiles.sql` / `seed_hotspots.sql`).
3. In the new project's Authentication → URL Configuration, whitelist whatever origin will host the static pages (your `*.vercel.app`, `http://localhost:3000`, `http://localhost:8080`, and `http://43.163.198.237:8080` if the VPS is still alive).
4. Redeploy. Existing browser sessions tied to the old project ref live in `localStorage` under `sb-<old-project-ref>-auth-token`; clear it after switching, since the SDK keys session storage by project ref.

### Schema

`supabase_setup_v2.sql` combines two connected domains:

1. weekly ops dashboard tables
   - `teams`
   - `team_schemas`
   - `team_api_configs`
   - `weekly_data`
2. content factory tables
   - `user_profiles`
   - `sources`
   - `hotspots`
   - `templates`
   - `template_uses`

Also important in that file:

- RLS policies assume authenticated users have full access to the business tables.
- `set_updated_at()` and trigger wiring maintain `updated_at` fields.
- `bump_template_stats()` updates `templates.uses`, `avg_views`, `fire_count`, and status from `template_uses` inserts.
- cross-domain views provide derived reporting:
  - `v_weekly_hotspot_stats`
  - `v_template_perf`
  - `v_source_contribution`

Seed/reference SQL files:

- `seed_hotspots.sql`
- `seed_user_profiles.sql`

Use these when you need example record shapes or want to understand intended semantics.

## Feature Boundaries

The main business areas map cleanly by page:

- `pallax_weekly_dashboard.html`: weekly review, team metrics, schemas, retros, auth entrypoint
- `weeklyreport/08-sources.html`: monitored account/source management, list import, source syncing, PM relevance scoring
- `weeklyreport/02-radar.html`: hotspot review, scoring, evidence display, radar-style prioritization
- `weeklyreport/07-templates.html`: template library, angle classification, template usage tracking against tweet performance

A lot of behavior is coupled through the database rather than through shared frontend code.

## Working Conventions For This Repo

- Prefer small, surgical edits inside the existing HTML pages rather than introducing new abstractions.
- Preserve the current page-local style: direct DOM updates, inline scripts, and incremental changes.
- Check `supabase_setup_v2.sql` before changing any field names or assumptions used in the weeklyreport pages.
- If you touch X/Twitter-related flows, inspect both the page logic and `apps/api/server.js`; the browser/API boundary is part of the feature.
- If you touch auth-dependent content-factory behavior, verify whether the page is reusing the dashboard session rather than implementing its own login flow.

## Hosting Migration Notes

Two migrations have been discussed but not executed. Capturing the constraints here so future edits don't accidentally break them.

### Switching Supabase projects

See "Supabase instance" above for the full list of inlined `SUPABASE_URL` / `SUPABASE_KEY` pairs that must change together. The schema bootstrap (`supabase_setup_v2.sql`) and seeds (`seed_user_profiles.sql`, `seed_hotspots.sql`) need to be applied to the new project before the frontend will function. Existing browser sessions tied to the old project ref live in `localStorage` under `sb-snflonpxmzkeytzytqpg-auth-token` — clear it after switching, since the SDK keys session storage by project ref.

### Switching the static frontend to Vercel

Two things are tightly coupled to the current "static + API on the same box" assumption and will need attention:

1. **`API_BASE` is computed as `http://${location.hostname}:8081`** in 3 places — `weeklyreport/07-templates.html` (1) and `weeklyreport/08-sources.html` (2). On Vercel `location.hostname` becomes the Vercel domain, which has no `:8081`. These need to be replaced with an absolute URL pointing at wherever the API lives.
2. **Mixed Content**: Vercel serves HTTPS; the API on `43.163.198.237:8081` is plain HTTP. Browsers will block HTTPS-page → HTTP-API requests. Either front the API with HTTPS (reverse proxy + Let's Encrypt on a subdomain) or move the API itself off the VPS (Vercel Functions / equivalent).

If the API is rewritten as Vercel Functions, the Fastify routes in `apps/api/server.js` (`/api/twitter/tweet`, `/api/twitter/handle/:handle/recent`, `/api/twitter/list/:listId/members`) map 1:1 to function files; the `app.listen` call disappears and `TWITTER_BEARER_TOKEN` moves to Vercel env vars. `deploy-api.sh` and the `pallax-api.service` systemd unit become obsolete in that case.
