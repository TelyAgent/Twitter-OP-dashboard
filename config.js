// Single source of truth for runtime config used by every static page.
// Loaded with a plain <script src="config.js"> before the page's own
// inline script that uses window.supabase.createClient(...).
//
// To switch Supabase projects: edit the two strings below and redeploy.
// Frontend-inlined keys are public (publishable / anon); RLS in the DB
// is what actually enforces access.
//
// DeepSeek config is injected by serve.js via /env.js → window.DEEPSEEK_CONFIG.
// Data sourcing goes through OpenCLI Chrome Extension daemon at localhost:19825.

(function () {
  var SUPABASE_URL = 'https://dkwqvenghjjjzceucjov.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_HJSlxk0cXk1w7e0v9WRbqg_DFAhVZDc';

  window.PALLAX_CONFIG = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_KEY,
  };
})();
