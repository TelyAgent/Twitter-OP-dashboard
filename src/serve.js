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
let DEEPSEEK_API_KEY = '';
let DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

try {
  const envPath = ROOT + '/.env';
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (key === 'DEEPSEEK_API_KEY') DEEPSEEK_API_KEY = val;
      if (key === 'DEEPSEEK_BASE_URL') DEEPSEEK_BASE_URL = val;
    }
  }
} catch {}

const ENV_JS = `window.DEEPSEEK_CONFIG = {
  API_KEY: ${JSON.stringify(DEEPSEEK_API_KEY)},
  BASE_URL: ${JSON.stringify(DEEPSEEK_BASE_URL)},
};
`;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // /env.js — inject DeepSeek config into browser
  if (path === '/env.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    res.end(ENV_JS);
    return;
  }

  // Static file serving
  let file = path === '/' ? '/dashboard.html' : path;
  // Safety: prevent directory traversal
  if (file.includes('..')) { res.writeHead(403); res.end(); return; }

  try {
    const body = await readFile(ROOT + file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
}).listen(PORT, () => {
  console.log(`→ http://localhost:${PORT}`);
  console.log(`  DEEPSEEK: ${DEEPSEEK_API_KEY ? 'configured' : 'NOT SET — export DEEPSEEK_API_KEY=sk-xxx in .env'}`);
});
