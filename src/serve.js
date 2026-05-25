// serve.js — minimal static server + env injection.
// Reads .env at startup, serves /env.js for browser-side config.
// Start: node serve.js

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const PORT = process.env.PORT || 8080;
const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};

// Read .env into memory
let SUPABASE_URL = '';
let SUPABASE_KEY = '';
let DEEPSEEK_API_KEY = '';
let DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

try {
  const envPath = ROOT + '/.env';
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key === 'SUPABASE_URL') SUPABASE_URL = val;
      else if (key === 'SUPABASE_KEY') SUPABASE_KEY = val;
      else if (key === 'DEEPSEEK_API_KEY') DEEPSEEK_API_KEY = val;
      else if (key === 'DEEPSEEK_BASE_URL') DEEPSEEK_BASE_URL = val;
    }
  }
} catch {}

const CONFIG_JS = `window.PALLAX_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(SUPABASE_URL)},
  SUPABASE_KEY: ${JSON.stringify(SUPABASE_KEY)},
};
window.DEEPSEEK_CONFIG = {
  API_KEY: ${JSON.stringify(DEEPSEEK_API_KEY)},
  BASE_URL: ${JSON.stringify(DEEPSEEK_BASE_URL)},
};
`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // /config.js — inject all runtime config into browser
  if (path === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(CONFIG_JS);
    return;
  }

  // Static file serving — pages live in src/pages/, everything else under src/
  let file;
  if (path === '/') {
    file = 'src/pages/dashboard.html';
  } else if (path.endsWith('.html')) {
    file = 'src/pages' + path;
  } else {
    file = path;
  }
  if (file.includes('..')) { res.writeHead(403); res.end(); return; }

  try {
    const body = await readFile(ROOT + '/' + file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
}).listen(PORT, () => {
  console.log(`→ http://localhost:${PORT}`);
  if (!SUPABASE_URL) console.log('  WARN: SUPABASE_URL not set in .env');
  if (!DEEPSEEK_API_KEY) console.log('  WARN: DEEPSEEK_API_KEY not set in .env');
});
