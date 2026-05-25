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

  // /api/opencli/* — execute OpenCLI commands via CLI (handles auth automatically)
  if (path.startsWith('/api/opencli/')) {
    const sub = path.replace('/api/opencli', '');
    try {
      let args = [];
      // Map HTTP paths to opencli CLI commands
      if (sub === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      } else if (sub === '/api/twitter/user-timeline') {
        var h = url.searchParams.get('handle') || '';
        args = ['twitter', 'tweets', h, '--limit', '100', '--format', 'json'];
      } else if (sub === '/api/twitter/tweet') {
        var tweetUrl = url.searchParams.get('url') || '';
        // Extract username from URL, get recent tweets, client will filter by id
        var m = tweetUrl.match(/(?:x\.com|twitter\.com)\/([^/]+)/i);
        var user = m ? m[1] : '';
        args = ['twitter', 'tweets', user, '--limit', '100', '--format', 'json'];
      } else if (sub === '/api/twitter/list-members') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: 0, members: [], note: 'list members not available via OpenCLI — paste handles manually' }));
        return;
      } else if (sub === '/exec') {
        var cmd = url.searchParams.get('cmd') || '';
        args = cmd.split(' ');
      } else {
        res.writeHead(400); res.end(JSON.stringify({ error: 'unknown endpoint: ' + sub })); return;
      }

      const { execSync } = await import('node:child_process');
      const result = execSync('opencli ' + args.join(' '), {
        timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(result);
    } catch (e) {
      const msg = e.stderr || e.stdout || e.message || 'unknown error';
      res.writeHead(502);
      res.end(JSON.stringify({ ok: false, error: String(msg).slice(0, 500) }));
    }
    return;
  }

  // /config.js — inject all runtime config into browser
  if (path === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(CONFIG_JS);
    return;
  }

  // Static file serving — pages live in src/pages/, everything else under src/
  // Check raw URL for traversal (URL.pathname normalizes ../ away, so check req.url)
  if (req.url.includes('..')) { res.writeHead(403); res.end(); return; }
  // Block serving sensitive files
  if (path === '/.env' || path.startsWith('/.git')) { res.writeHead(403); res.end(); return; }

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
