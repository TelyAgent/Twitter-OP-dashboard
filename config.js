// Single source of truth for runtime config used by every static page.
// Loaded with a plain <script src="…/config.js"> before the page's own
// inline script that uses window.supabase.createClient(...).
//
// To switch Supabase projects: edit the two strings below and redeploy.
// Frontend-inlined keys are public (publishable / anon); RLS in the DB
// is what actually enforces access.

(function () {
  var SUPABASE_URL = 'https://dkwqvenghjjjzceucjov.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_HJSlxk0cXk1w7e0v9WRbqg_DFAhVZDc';

  // API_BASE rules:
  //   - Legacy VPS (static on :8080, Fastify on :8081)  → http://<host>:8081
  //   - Vercel (Functions live at /api/*, same origin)  → '' (relative)
  //   - Anything else (file://, vercel dev, etc.)       → '' (relative)
  var loc = window.location || {};
  var onLegacyVps = loc.port === '8080' || loc.hostname === '43.163.198.237';
  var API_BASE = onLegacyVps ? ('http://' + loc.hostname + ':8081') : '';

  window.PALLAX_CONFIG = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_KEY,
    API_BASE: API_BASE,
  };
})();
