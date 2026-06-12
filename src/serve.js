// serve.js — minimal static server + env injection.
// Reads .env at startup, serves /env.js for browser-side config.
// Start: node serve.js

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';
import { runSync, syncState, stopSync } from './scheduler.js';

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
  IS_VERCEL: false,
};
window.DEEPSEEK_CONFIG = {
  API_KEY: ${JSON.stringify(DEEPSEEK_API_KEY)},
  BASE_URL: ${JSON.stringify(DEEPSEEK_BASE_URL)},
};
`;

function log(method, path, status, detail) {
  var now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log('[' + now + '] ' + method + ' ' + path + ' → ' + status + (detail ? ' | ' + detail : ''));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // /api/sources/* — mock API endpoints for sources page
  if (path === '/api/sources/review-summary') {
    try {
      const body = await readFile(ROOT + '/src/api/review-summary.json');
      log(req.method, path, 200);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch { res.writeHead(404); res.end('404'); }
    return;
  }
  if (path === '/api/sources/ai-recommendations') {
    try {
      const body = await readFile(ROOT + '/src/api/ai-recommendations.json');
      log(req.method, path, 200);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } catch { res.writeHead(404); res.end('404'); }
    return;
  }

  // /api/media-proxy — proxy Twitter media through local server (bypasses CDN blocks)
  if (path === '/api/media-proxy') {
    const target = url.searchParams.get('url');
    if (!target) { res.writeHead(400); res.end('missing url'); return; }
    try {
      const https = await import('node:https');
      const doFetch = (href) => new Promise((resolve, reject) => {
        https.get(href, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
          if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
            doFetch(r.headers.location).then(resolve).catch(reject);
            return;
          }
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => resolve({ body: Buffer.concat(chunks), ct: r.headers['content-type'] || 'image/jpeg' }));
          r.on('error', reject);
        }).on('error', reject);
      });
      const body = await doFetch(target);
      log(req.method, path, 200, target.slice(0, 60));
      res.writeHead(200, {
        'Content-Type': body.ct,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body.body);
    } catch (e) {
      log(req.method, path, 502, String(e.message).slice(0, 60));
      res.writeHead(502);
      res.end('proxy error');
    }
    return;
  }

  // /api/opencli/* — execute OpenCLI commands via CLI (handles auth automatically)
  if (path.startsWith('/api/opencli/')) {
    const sub = path.replace('/api/opencli', '');
    try {
      let args = [];
      // Map HTTP paths to opencli CLI commands
      if (sub === '/health') {
        log(req.method, path, 200);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      } else if (sub === '/api/twitter/user-timeline') {
        var h = url.searchParams.get('handle') || '';
        var lim = url.searchParams.get('limit') || '100';
        var topEng = url.searchParams.get('topByEngagement') || '0';
        args = ['twitter', 'tweets', h, '--limit', lim, '--format', 'json'];
        if (topEng !== '0') args.push('--top-by-engagement', topEng);
      } else if (sub === '/api/twitter/tweet') {
        var tweetUrl = url.searchParams.get('url') || '';
        // Extract username from URL, get recent tweets, client will filter by id
        var m = tweetUrl.match(/(?:x\.com|twitter\.com)\/([^/]+)/i);
        var user = m ? m[1] : '';
        args = ['twitter', 'tweets', user, '--limit', '20', '--format', 'json'];
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

      const cliCmd = 'opencli ' + args.join(' ');
      log(req.method, path, '…', cliCmd);
      const { execSync } = await import('node:child_process');
      const result = execSync(cliCmd, {
        timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8',
      });
      var count = 1;
      try { var parsed = JSON.parse(result); count = Array.isArray(parsed) ? parsed.length : 1; } catch (_) {}
      log(req.method, path, 200, count + ' items');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(result);
    } catch (e) {
      const msg = e.stderr || e.stdout || e.message || 'unknown error';
      log(req.method, path, 502, String(msg).slice(0, 80));
      res.writeHead(502);
      res.end(JSON.stringify({ ok: false, error: String(msg).slice(0, 500) }));
    }
    return;
  }

  // /api/sync — trigger a full sync run
  if (path === '/api/sync' && req.method === 'POST') {
    log(req.method, path, '…', 'triggered');
    try {
      const result = await runSync();
      log(req.method, path, 200, JSON.stringify(result));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      log(req.method, path, 500, String(e.message).slice(0, 80));
      res.writeHead(500);
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  // /api/sync/status — poll current sync state
  if (path === '/api/sync/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(syncState));
    return;
  }

  // /api/sync/stop — request stop
  if (path === '/api/sync/stop' && req.method === 'POST') {
    stopSync();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // /api/sync/env — environment check
  if (path === '/api/sync/env' && req.method === 'GET') {
    const result = { opencli: false, daemon: false, supabase: false, env: false, sourcesCount: 0, errors: {} };

    // Check .env
    result.env = !!(SUPABASE_URL && SUPABASE_KEY);

    // Check opencli CLI
    try {
      const { execSync } = await import('node:child_process');
      execSync('opencli --version', { timeout: 5000, stdio: 'pipe' });
      result.opencli = true;
    } catch (e) {
      result.errors.opencli = String(e.stderr || e.message).slice(0, 100);
    }

    // Check opencli daemon
    try {
      const dc = await fetch('http://localhost:19825', { signal: AbortSignal.timeout(3000) });
      result.daemon = dc.ok || dc.status < 500;
    } catch (e) {
      result.errors.daemon = String(e.message).slice(0, 100);
    }

    // Check Supabase
    if (result.env) {
      try {
        const r = await fetch(SUPABASE_URL + '/rest/v1/sources?select=id&type=eq.twitter&status=neq.retired', {
          headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: 'count=exact' },
          signal: AbortSignal.timeout(5000),
        });
        result.supabase = r.ok;
        if (r.ok) {
          const cnt = r.headers.get('content-range');
          result.sourcesCount = cnt ? parseInt(cnt.split('/')[1]) : 0;
        }
      } catch (e) {
        result.errors.supabase = String(e.message).slice(0, 100);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // /config.js — inject all runtime config into browser
  if (path === '/config.js') {
    log(req.method, path, 200);
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(CONFIG_JS);
    return;
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(CONFIG_JS);
    return;
  }

  // Static file serving — pages live in src/pages/, everything else under src/
  // Check raw URL for traversal (URL.pathname normalizes ../ away, so check req.url)
  if (req.url.includes('..')) { log(req.method, path, 403, 'blocked'); res.writeHead(403); res.end(); return; }
  // Block serving sensitive files
  if (path === '/.env' || path.startsWith('/.git')) { log(req.method, path, 403, 'blocked'); res.writeHead(403); res.end(); return; }

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
    var kind = path.endsWith('.html') ? 'page' : 'static';
    log(req.method, path, 200, kind);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    log(req.method, path, 404);
    res.writeHead(404);
    res.end('404');
  }
}).listen(PORT, () => {
  console.log('──────────────────────────────────────────');
  console.log('  OP Dashboard');
  console.log('  → http://localhost:' + PORT);
  console.log('');
  console.log('  Supabase : ' + (SUPABASE_URL ? SUPABASE_URL.replace(/https?:\/\//,'') : 'NOT SET'));
  console.log('  DeepSeek : ' + (DEEPSEEK_API_KEY ? 'configured' : 'NOT SET'));
  console.log('  OpenCLI  : http://localhost:19825 (CLI bridge)');
  console.log('──────────────────────────────────────────');
});
