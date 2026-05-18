# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Shape

This repo is a small multi-surface product made of static HTML pages plus one Node API:

- `pallax_weekly_dashboard.html` is the main weekly operations dashboard.
- `pallax_weekly_dashboard_preview.html` is a preview variant of the main dashboard.
- `weeklyreport/02-radar.html` is the hotspot radar view.
- `weeklyreport/07-templates.html` is the template library / template usage flow.
- `weeklyreport/08-sources.html` is the source management and source-sync flow.
- `apps/api/server.js` is the only backend service; it proxies X/Twitter API reads for the frontend.

There is no root app framework, bundler, or router. Navigation is done with plain links between HTML files, and most frontend logic is inline in each page.

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

### Local API work

Run commands from `apps/api`:

- Install dependencies: `npm install`
- Start in watch mode: `npm run dev`
- Start once: `npm start`

The API expects `.env` values for:

- `TWITTER_BEARER_TOKEN`
- `PORT` (defaults to `8081`)
- `HOST` (defaults to `0.0.0.0`)

Useful local check:

- `curl http://localhost:8081/api/health`

### Tests / linting

- There are currently no checked-in lint scripts.
- There are currently no checked-in automated test scripts.
- There is no repo-defined single-test command.

### Deployment

Repo-level static page deploy:

- `./deploy.sh`

This pushes:

- `pallax_weekly_dashboard.html` -> remote `index.html`
- `pallax_weekly_dashboard_preview.html` -> remote `preview.html`
- `weeklyreport/*.html` and `weeklyreport/*.css` -> remote `weeklyreport/`

API deploy:

- `./deploy-api.sh`

This uploads `apps/api/server.js` and `apps/api/package.json`, installs production deps remotely, provisions a `systemd` unit, and restarts `pallax-api.service`.

Both deploy scripts are server-specific and assume the existing SSH key, host, and remote directory values checked into those scripts.

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

`apps/api/server.js` is a thin Fastify service used only for X/Twitter enrichment. It exposes:

- `GET /api/health`
- `POST /api/twitter/tweet`
- `POST /api/twitter/handle/:handle/recent`
- `POST /api/twitter/list/:listId/members`

The usual flow is:

1. browser page calls the local/remote API on port `8081`
2. API fetches X/Twitter data via bearer token
3. browser page writes derived records into Supabase

The frontend computes `API_BASE` as `http://${location.hostname}:8081`, so the static pages and API are expected to run on the same host.

## Data Model

The authoritative schema reference is `supabase_setup_v2.sql`.

It combines two connected domains:

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
