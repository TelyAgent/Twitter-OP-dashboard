// Vercel serverless handler — catch-all for all routes.
// Adapted from src/serve.js for Vercel's serverless runtime.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};

const CONFIG_JS = `window.PALLAX_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(process.env.SUPABASE_URL || '')},
  SUPABASE_KEY: ${JSON.stringify(process.env.SUPABASE_KEY || '')},
};
window.DEEPSEEK_CONFIG = {
  API_KEY: ${JSON.stringify(process.env.DEEPSEEK_API_KEY || '')},
  BASE_URL: ${JSON.stringify(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com')},
};
`;

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let path = url.pathname;

  // When invoked via catch-all rewrite, req.url may be the rewritten
  // /api/index rather than the original request path. Recover original.
  if (path === '/api/index') {
    const original = req.headers['x-forwarded-path']
      || req.headers['x-forwarded-uri']
      || req.headers['x-original-uri'];
    path = original || '/';
  }

  try {
    // /config.js — inject runtime config
    if (path === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(CONFIG_JS);
      return;
    }

    // /api/sources/* — mock API endpoints
    if (path === '/api/sources/review-summary') {
      const body = await readFile('src/api/review-summary.json');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    if (path === '/api/sources/ai-recommendations') {
      const body = await readFile('src/api/ai-recommendations.json');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }

    // /api/media-proxy — proxy Twitter media
    if (path === '/api/media-proxy') {
      const target = url.searchParams.get('url');
      if (!target) { res.writeHead(400); res.end('missing url'); return; }
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
      res.writeHead(200, {
        'Content-Type': body.ct,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body.body);
      return;
    }

    // /api/opencli/* — not available on Vercel (requires local CLI)
    if (path.startsWith('/api/opencli/')) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'OpenCLI proxy unavailable on Vercel. Use local dev server.' }));
      return;
    }

    // Security: block sensitive paths
    if (path === '/.env' || path.startsWith('/.git')) {
      res.writeHead(403); res.end('403'); return;
    }

    // Static file serving
    let file;
    if (path === '/') {
      file = 'src/pages/dashboard.html';
    } else if (path.endsWith('.html')) {
      file = 'src/pages' + path;
    } else {
      file = path;
    }

    // Block path traversal
    if (file.includes('..')) { res.writeHead(403); res.end('403'); return; }

    const body = await readFile(file);
    const ct = MIME[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404);
      res.end('404');
    } else {
      res.writeHead(500);
      res.end('500: ' + e.message);
    }
  }
}
