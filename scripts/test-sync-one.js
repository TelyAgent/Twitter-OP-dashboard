// scripts/test-sync-one.js — one-shot single-source sync for testing.
// Usage: node scripts/test-sync-one.js <handle>
// Example: node scripts/test-sync-one.js _AiLab

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = process.cwd();
const handle = process.argv[2];

if (!handle) {
  console.error('Usage: node scripts/test-sync-one.js <handle>');
  console.error('Example: node scripts/test-sync-one.js _AiLab');
  process.exit(1);
}

// Read .env for Supabase + config
function readEnv() {
  const vars = { SUPABASE_URL: '', SUPABASE_KEY: '', SYNC_FETCH_LIMIT: 100, SYNC_TOP_ENGAGEMENT: 30 };
  const envPath = ROOT + '/.env';
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf-8');
    for (let line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      const hashIdx = v.search(/\s+#/);
      if (hashIdx !== -1) v = v.slice(0, hashIdx).trim();
      if (k in vars) { const n = Number(v); vars[k] = isNaN(n) ? v : n; }
    }
  }
  return vars;
}

const ENV = readEnv();

// Supabase REST helpers
async function sb(path, opts) {
  const url = ENV.SUPABASE_URL + '/rest/v1/' + path;
  const headers = {
    'apikey': ENV.SUPABASE_KEY,
    'Authorization': 'Bearer ' + ENV.SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
  if (opts && opts.prefer) headers['Prefer'] = opts.prefer;
  const res = await fetch(url, { method: opts?.method || 'GET', headers, body: opts?.body });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, json: text ? JSON.parse(text) : null };
}

console.log('Testing sync for @' + handle);
console.log('Fetch limit:', ENV.SYNC_FETCH_LIMIT, 'Top engagement:', ENV.SYNC_TOP_ENGAGEMENT);

// Step 1: Find source in DB
console.log('\n1. Looking up source...');
const srcRes = await sb('sources?select=id,handle&handle=eq.@' + handle + '&limit=1');
if (!srcRes.ok || !srcRes.json || !srcRes.json.length) {
  console.error('Source not found in DB:', handle);
  process.exit(1);
}
const source = srcRes.json[0];
console.log('   Found:', source.id, source.handle);

// Step 2: Fetch tweets via opencli
console.log('\n2. Fetching tweets via opencli...');
const args = ['opencli', 'twitter', 'tweets', handle, '--limit', String(ENV.SYNC_FETCH_LIMIT), '--format', 'json'];
if (ENV.SYNC_TOP_ENGAGEMENT > 0) args.push('--top-by-engagement', String(ENV.SYNC_TOP_ENGAGEMENT));
const cmd = args.join(' ');
console.log('   CMD:', cmd);

let tweets = [];
try {
  const result = execSync(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8' });
  const data = JSON.parse(result);
  tweets = Array.isArray(data) ? data : (data.tweets || data.result || []);
} catch (e) {
  const msg = e.stderr || e.stdout || e.message || '';
  const clean = String(msg).replace(/^\(node:\d+\) \[UNDICI-EHPA\][^\n]*\n?/gm, '').replace(/\(Use `node --trace-warnings.*?`\n?/g, '').trim();
  console.error('   FAIL:', clean.slice(0, 300));
  process.exit(1);
}

console.log('   Got', tweets.length, 'tweets');

if (tweets.length === 0) {
  console.log('   No tweets — source may be silent or protected');
  process.exit(0);
}

// Show top tweet
const top = tweets[0];
const isOpenCLI = typeof top.author === 'string';
const author = isOpenCLI ? top.author : (top.author?.username || top.author?.screen_name || '?');
const views = isOpenCLI ? (top.views || 0) : (top.metrics?.views || top.metrics?.viewCount || 0);
const likes = isOpenCLI ? (top.likes || 0) : (top.metrics?.likes || top.metrics?.likeCount || 0);
const rt = isOpenCLI ? (top.retweets || 0) : (top.metrics?.retweets || top.metrics?.retweetCount || 0);
const text = (top.text || '').slice(0, 100);
console.log('\n   Top tweet:');
console.log('   Author:', author);
console.log('   Views:', views, 'Likes:', likes, 'RT:', rt);
console.log('   Text:', text);

// Step 3: Update source last_active_at
console.log('\n3. Updating source last_active_at...');
const now = new Date();
now.setSeconds(0, 0);
const updRes = await sb('sources?id=eq.' + source.id, {
  method: 'PATCH',
  body: JSON.stringify({ last_active_at: now.toISOString() }),
});
console.log('   Status:', updRes.ok ? 'OK' : 'FAIL ' + updRes.status);

console.log('\n=== Test complete ===');
