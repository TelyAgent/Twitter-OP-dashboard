// scheduler.js — daily batch sync for imported Twitter accounts.
//
// Runs inside serve.js. Fetches tweets via opencli, clusters/scores
// (logic ported from content-ops.js), upserts hotspots + updates source
// metrics via Supabase REST API.
//
// Also exposes live syncState for the sync-admin.html management page,
// supports stop-via-API, breakpoint checkpointing, and 24h cooldown
// dedup (persisted to disk across restarts).
//
// Configuration (env vars, all optional):
//   SYNC_HOUR=2              hour of day to run (0-23, default 2)
//   SYNC_MAX_RETRIES=3       max retries per source on failure
//   SYNC_FETCH_LIMIT=100    tweets per source
//   SYNC_TOP_ENGAGEMENT=30   engagement cutoff
//   SYNC_BATCH_MAX=20        max sources per run
//   SYNC_DELAY_MIN=8000      min inter-source delay ms
//   SYNC_DELAY_MAX=25000     max inter-source delay ms

import { exec } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';

// ══════════════════════════════════════════════════════════════════════
// 1. INFRASTRUCTURE – config, logging, Supabase client
// ══════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();

function readEnv() {
  const vars = {
    SUPABASE_URL: '',
    SUPABASE_KEY: '',
    SYNC_HOUR: 2,
    SYNC_MAX_RETRIES: 3,
    SYNC_FETCH_LIMIT: 100,
    SYNC_TOP_ENGAGEMENT: 30,
    SYNC_BATCH_MAX: 20,
    SYNC_DELAY_MIN: 8000,
    SYNC_DELAY_MAX: 25000,
  };
  try {
    const envPath = ROOT + '/.env';
    if (existsSync(envPath)) {
      const raw = readFileSync(envPath, 'utf-8');
      for (let line of raw.split('\n')) {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        const hashIdx = val.search(/\s+#/);
        if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
        if (key in vars) {
          const num = Number(val);
          vars[key] = isNaN(num) ? val : num;
        }
      }
    }
  } catch {}
  return vars;
}

const ENV = readEnv();

// ── logging ──────────────────────────────────────────────────────────
const LOG_MAX = 200;

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = '[' + ts + '] ' + msg;
  console.log(line);
  if (syncState.logs) {
    syncState.logs.push(line);
    if (syncState.logs.length > LOG_MAX) syncState.logs.shift();
  }
}

function nowMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

// ── Supabase REST client ─────────────────────────────────────────────
function sb(path, opts) {
  const url = ENV.SUPABASE_URL + '/rest/v1/' + path;
  const headers = {
    'apikey': ENV.SUPABASE_KEY,
    'Authorization': 'Bearer ' + ENV.SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
  if (opts && opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(url, { method: opts && opts.method || 'GET', headers, body: opts && opts.body });
}

async function sbJSON(path, opts) {
  const res = await sb(path, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Supabase ' + res.status + ': ' + txt.slice(0, 200));
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ══════════════════════════════════════════════════════════════════════
// 2. DATA PROCESSING – opencli, tweet normalization, clustering/scoring
//    (pure functions ported from src/content-ops.js)
// ══════════════════════════════════════════════════════════════════════

// ── OpenCLI (async, so event loop stays free for stop requests) ─────
let activeOpenCLIProcess = null;

async function opencliTweets(handle, limit, topEng) {
  const args = ['opencli', 'twitter', 'tweets', handle, '--limit', String(limit), '--format', 'json'];
  if (topEng > 0) args.push('--top-by-engagement', String(topEng));
  const cmd = args.join(' ');
  log('  opencli: ' + cmd);
  return new Promise((resolve, reject) => {
    activeOpenCLIProcess = exec(cmd, {
      timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8',
    }, (err, stdout, stderr) => {
      activeOpenCLIProcess = null;
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      try {
        const data = JSON.parse(stdout);
        resolve(Array.isArray(data) ? data : (data.tweets || data.result || []));
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ── Tweet normalization ──────────────────────────────────────────────
function normalizeTweet(t) {
  if (!t) return null;
  const isOpenCLI = typeof t.author === 'string';
  return {
    id: t.id || t.tweet_id || '',
    url: t.url || (isOpenCLI
      ? 'https://x.com/' + t.author + '/status/' + t.id
      : ''),
    text: t.text || '',
    author: isOpenCLI
      ? { username: t.author || '', name: t.name || '' }
      : { username: (t.author && (t.author.username || t.author.userName || t.author.screen_name)) || '',
          name: (t.author && (t.author.name || t.author.display_name)) || '' },
    created_at: t.created_at || t.createdAt || t.created || '',
    kind: t.kind || (t.is_retweet || t.isRetweet ? 'retweet'
      : (t.is_quote || t.isQuote ? 'quote'
      : (t.is_reply || t.isReply ? 'reply' : 'original'))),
    metrics: isOpenCLI
      ? { views: t.views || 0, likes: t.likes || 0, retweets: t.retweets || 0,
          replies: t.replies || 0, quotes: 0, bookmarks: t.bookmarks || 0 }
      : { views: (t.metrics && t.metrics.views) || 0,
          likes: (t.metrics && t.metrics.likes) || 0,
          retweets: (t.metrics && t.metrics.retweets) || 0,
          replies: (t.metrics && t.metrics.replies) || 0,
          quotes: (t.metrics && t.metrics.quotes) || 0,
          bookmarks: (t.metrics && t.metrics.bookmarks) || 0 },
  };
}

// ── Clustering & scoring (ported from src/content-ops.js) ────────────
const CLUSTER_KEYS = [
  'telegram','telegram bot','tg bot','telegram mini app','ton','ton blockchain',
  'ai agent','ai agents','agent framework','agent sdk','agent api',
  'autonomous agent','multi-agent','agent swarm','agent orchestration',
  'llm','large language model','gpt','claude','gemini','deepseek',
  'openai','anthropic','google ai','mistral','llama','grok','groq',
  'chatbot','conversational ai','copilot','assistant',
  'eliza','elizaos','virtuals','agent starter kit','crewai','autogen',
  'openclaw','claw','openhuman','hermas','piagent',
  'rag','retrieval augmented','function calling','tool use',
  'no-code agent','low-code agent','agent marketplace','agent platform',
  'agent token','agent economy','crypto agent','defi agent','trading agent',
  'web3 agent','social agent','gaming agent','nft agent',
  'open source agent','agent launch','agent launchpad',
  'ai safety','agent safety','agent alignment',
  'benchmark','sota','funding round','partnership',
];

const CAT_KW = {
  A: ['telegram','tg','telegram bot','mini app','ton','ton blockchain','telegram channel','telegram group','fragment','wallet bot'],
  C: ['ai agent','agent builder','agent sdk','agent api','agent platform','agent marketplace','agent launch','agent token','eliza','elizaos','virtuals','agent starter kit','crewai','autogen','openclaw','claw','openhuman','hermas','piagent','no-code agent'],
  D: ['llm','rag','function calling','tool use','multi-agent','agent swarm','agent orchestration','autonomous','reasoning','chain of thought','prompt engineering','fine tuning','embedding','vector database','context window','token limit'],
  E: ['openai','anthropic','google ai','deepseek','mistral','llama','grok','groq','funding round','valuation','acquisition','partnership','benchmark','sota','open source','api pricing','rate limit'],
};

const ALL_KW = Object.values(CAT_KW).flat();

function classifyCategory(text) {
  const lower = String(text || '').toLowerCase();
  for (const cat in CAT_KW) {
    if (CAT_KW[cat].some(kw => lower.indexOf(kw) !== -1)) return cat;
  }
  return 'E';
}

function extractKey(text) {
  const lower = (text || '').toLowerCase();
  for (const kw of CLUSTER_KEYS) {
    if (lower.indexOf(kw) !== -1) return kw;
  }
  const m = (text || '').match(/\$[\d,.]+[kKmMbB]?/);
  return m ? m[0].toLowerCase() : null;
}

function clusterTweets(tweets, windowMs) {
  windowMs = windowMs || (4 * 3600e3);
  const byKey = {};
  const orphans = [];
  for (const t of tweets) {
    const k = extractKey(t.text);
    if (k) {
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(t);
    } else {
      orphans.push(t);
    }
  }
  const clusters = [];
  for (const key in byKey) {
    const group = byKey[key];
    group.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let curr = [group[0]];
    for (let j = 1; j < group.length; j++) {
      const dt = new Date(group[j].created_at) - new Date(curr[curr.length - 1].created_at);
      if (dt <= windowMs) curr.push(group[j]);
      else { clusters.push({ key, tweets: curr }); curr = [group[j]]; }
    }
    clusters.push({ key, tweets: curr });
  }
  for (const t of orphans) clusters.push({ key: 'misc', tweets: [t] });
  return clusters;
}

function scoreCluster(tweets) {
  const allText = tweets.map(t => t.text || '').join(' ').toLowerCase();
  let matches = 0;
  for (const kw of ALL_KW) {
    if (allText.indexOf(kw) !== -1) matches++;
  }
  const fit = Math.min(1, matches / Math.max(tweets.length * 3, 3));

  let totalEng = 0, totalViews = 0;
  for (const t of tweets) {
    const m = t.metrics || {};
    totalEng += (m.likes || 0) + (m.retweets || 0) + (m.replies || 0);
    totalViews += m.views || 0;
  }
  const avgEng = totalEng / tweets.length;
  const avgViews = totalViews / tweets.length;
  const viral = avgViews > 0
    ? Math.min(1, avgEng / Math.max(avgViews * 0.02, 50))
    : Math.min(1, avgEng / 200);

  let newest = 0;
  for (const t of tweets) {
    const ts = new Date(t.created_at).getTime() || 0;
    if (ts > newest) newest = ts;
  }
  const hoursOld = (Date.now() - newest) / 3.6e6;
  const fresh = Math.max(0, 1 - hoursOld / 72);

  let score = fit * 0.3 + viral * 0.4 + fresh * 0.3;
  if (totalEng < 10) score = 0;
  else if (viral < 0.05) score *= 0.3;

  return {
    fit: +fit.toFixed(2), viral: +viral.toFixed(2), fresh: +fresh.toFixed(2),
    score: +score.toFixed(3),
    cluster_size: tweets.length, total_views: totalViews, total_engagement: totalEng,
    avg_views: Math.round(avgViews), avg_engagement: Math.round(avgEng),
  };
}

function buildHotspotFromCluster(cluster, opts) {
  opts = opts || {};
  const windowMs = opts.windowMs || (4 * 3600e3);
  const hotThreshold = opts.hotThreshold != null ? opts.hotThreshold : 0.35;
  const hotMinViews = opts.hotMinViews != null ? opts.hotMinViews : 10000;
  const hotMinEng = opts.hotMinEng != null ? opts.hotMinEng : 200;

  const tweets = cluster.tweets.slice().sort((a, b) =>
    (b.metrics && b.metrics.views || 0) - (a.metrics && a.metrics.views || 0));
  const top = tweets[0];
  const allText = tweets.map(t => t.text || '').join(' ');
  const cat = classifyCategory(allText);
  const sc = scoreCluster(tweets);

  let earliest = Infinity;
  for (const t of tweets) {
    const ts = new Date(t.created_at).getTime() || Date.now();
    if (ts < earliest) earliest = ts;
  }
  const bucket = Math.floor(earliest / (windowMs || 14400000));
  const keySlug = cluster.key.replace(/[^a-z0-9]+/gi, '_').slice(0, 30);

  const passAbs = (sc.total_views >= hotMinViews) || (sc.total_engagement >= hotMinEng);
  const isHot = sc.score >= hotThreshold && passAbs;

  return {
    id: 'hs_c_' + keySlug + '_' + bucket,
    title: (top.text || '').slice(0, 120),
    category: cat,
    hot_signal: isHot,
    tweets: tweets,
    metrics: sc,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 3. RUNTIME CONTROL – rate limiting, delays, graceful stop
// ══════════════════════════════════════════════════════════════════════

// ── Rate limiting ────────────────────────────────────────────────────
let backoffUntil = 0;
let consecutive429 = 0;

function isInBackoff() { return Date.now() < backoffUntil; }

function applyBackoff(status) {
  if (status === 429 || status === 403) {
    consecutive429++;
    backoffUntil = Date.now() + 10 * 60e3; // 10 min fixed backoff
    return '触发限流, 退避 10 分钟';
  }
  return null;
}

// ── Delays ───────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Interruptible: checks stopRequested every second so admin stop is responsive
async function interruptibleSleep(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (syncState.stopRequested) return;         // forward ref, safe – init'd before use
    const chunk = Math.min(1000, deadline - Date.now());
    await sleep(chunk);
  }
}

function randomDelay() {
  return ENV.SYNC_DELAY_MIN + Math.floor(Math.random() * (ENV.SYNC_DELAY_MAX - ENV.SYNC_DELAY_MIN));
}

// ── Graceful stop ────────────────────────────────────────────────────
// kill() the active opencli child process so stop takes effect immediately
function stopActiveProcess() {
  if (activeOpenCLIProcess) {
    activeOpenCLIProcess.kill('SIGTERM');
    log('已终止当前 OpenCLI 进程');
  }
}

// ══════════════════════════════════════════════════════════════════════
// 4. STATE PERSISTENCE – cooldown, checkpoint, live syncState
// ══════════════════════════════════════════════════════════════════════

// ── 4a. Cooldown cache (24h per-source dedup, disk-backed) ───────────
//      Prevents the daily cron from re-syncing a source that was already
//      synced today.  Manual sync from sources.html bypasses this
//      (it uses a separate /api/opencli/* code path).
const COOLDOWN_PATH = ROOT + '/.sync_cooldown.json';
const lastSyncCache = new Map();

(function loadCooldowns() {
  try {
    if (existsSync(COOLDOWN_PATH)) {
      const raw = readFileSync(COOLDOWN_PATH, 'utf-8');
      const data = JSON.parse(raw);
      for (const [k, v] of Object.entries(data)) {
        lastSyncCache.set(k, v);
      }
      if (lastSyncCache.size > 0) log('加载冷却记录: ' + lastSyncCache.size + ' 个源');
    }
  } catch {}
})();

function saveCooldowns() {
  try {
    const obj = {};
    const cutoff = Date.now() - 24 * 3600e3;
    for (const [k, v] of lastSyncCache) {
      if (v > cutoff) obj[k] = v;             // prune expired entries
    }
    writeFileSync(COOLDOWN_PATH, JSON.stringify(obj, null, 2));
  } catch (e) {
    log('保存冷却文件失败: ' + e.message);
  }
}

// ── 4b. Checkpoint (in-run progress, survives crashes/restarts) ──────
//      Written after each source completes.  Cleared only when ALL
//      sources in the batch finish naturally (not stopped / backoff).
const CHECKPOINT_PATH = ROOT + '/.sync_checkpoint.json';

function loadCheckpoint() {
  try {
    if (existsSync(CHECKPOINT_PATH)) {
      const raw = readFileSync(CHECKPOINT_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    log('读取断点文件失败: ' + e.message);
  }
  return null;
}

function saveCheckpoint() {
  try {
    const doneHandles = syncState.entries
      .filter(e => e.status === 'ok' || e.status === 'failed' ||
        (e.status === 'skipped' && e.error !== 'stopped' && e.error !== 'backoff'))
      .map(e => ({ handle: e.handle, status: e.status, time: e.time || 0, note: e.note || '' }));
    writeFileSync(CHECKPOINT_PATH, JSON.stringify({
      done: doneHandles,
      updatedAt: Date.now(),
    }, null, 2));
  } catch (e) {
    log('写断点文件失败: ' + e.message);
  }
}

function clearCheckpoint() {
  try { if (existsSync(CHECKPOINT_PATH)) unlinkSync(CHECKPOINT_PATH); } catch {}
}

// ── 4c. Live sync state (polled by admin page & sync-admin.html) ────
//      done / failed / skipped are getters computed from entries[] —
//      entries is the single source of truth, no manual counters.
const syncState = {
  running: false,
  stopRequested: false,
  current: null,
  total: 0,
  entries: [],
  logs: [],
  startTime: null,

  get done()    { return this.entries.filter(e => e.status === 'ok').length; },
  get failed()  { return this.entries.filter(e => e.status === 'failed').length; },
  get skipped() { return this.entries.filter(e => e.status === 'skipped').length; },
};

function resetSyncState(queue) {
  syncState.running = true;
  syncState.stopRequested = false;
  syncState.current = null;
  syncState.total = queue.length;
  syncState.entries = queue.map(s => ({
    handle: s.handle.replace(/^@/, ''),
    sourceId: s.id,
    status: 'pending',
  }));
  syncState.startTime = Date.now();
}

function stopSync() {
  syncState.stopRequested = true;
  stopActiveProcess();
}

// ══════════════════════════════════════════════════════════════════════
// 5. SYNC LOGIC – per-source & main loop
// ══════════════════════════════════════════════════════════════════════

// ── Concurrency guard ────────────────────────────────────────────────
let syncing = false;

// ── Sync one source ──────────────────────────────────────────────────
//    fetch → normalize → cluster → score → filter → upsert → metrics
async function syncOneSource(source, retriesLeft) {
  const handle = source.handle.replace(/^@/, '');
  const sourceId = source.id;

  // Cooldown check (24h, disk-persisted)
  const lastSync = lastSyncCache.get(sourceId) || 0;
  if (Date.now() - lastSync < 24 * 3600e3) {
    log('  SKIP @' + handle + ' — 24h 内已同步');
    return { status: 'skipped', reason: 'cooldown', note: '24h 内已同步' };
  }

  // Global backoff check
  if (isInBackoff()) {
    const remain = Math.ceil((backoffUntil - Date.now()) / 60e3);
    log('  SKIP @' + handle + ' — 全局限流退避中 (~' + remain + 'min)');
    return { status: 'skipped', reason: 'backoff', note: '限流退避中' };
  }

  log('  SYNC @' + handle + ' (重试剩余 ' + retriesLeft + ' 次)');

  // Fetch tweets
  let tweets = [];
  try {
    tweets = await opencliTweets(handle, ENV.SYNC_FETCH_LIMIT, ENV.SYNC_TOP_ENGAGEMENT);
    consecutive429 = 0;
    if (syncState.stopRequested) {
      log('  STOP @' + handle + ' — 收到停止请求，跳过聚类入库');
      return { status: 'skipped', reason: 'stopped', note: '收到停止请求' };
    }
  } catch (e) {
    if (syncState.stopRequested) {
      log('  STOP @' + handle + ' — 收到停止请求');
      return { status: 'skipped', reason: 'stopped', note: '收到停止请求' };
    }
    const msg = e.stderr || e.stdout || e.message || '';
    const clean = String(msg)
      .replace(/^\(node:\d+\) \[UNDICI-EHPA\][^\n]*\n?/gm, '')
      .replace(/\(Use `node --trace-warnings.*?\)\n?/g, '')
      .trim();
    const statusMatch = clean.match(/(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;
    const backoffMsg = applyBackoff(status);

    log('  FAIL @' + handle + ': ' + (clean || String(msg).trim()).slice(0, 100) + (backoffMsg ? ' — ' + backoffMsg : ''));

    if (retriesLeft > 0 && !isInBackoff() && !syncState.stopRequested) {
      const waitMs = Math.min(60000, 5000 * Math.pow(2, ENV.SYNC_MAX_RETRIES - retriesLeft));
      log('  RETRY @' + handle + ' in ' + Math.round(waitMs / 1000) + 's…');
      await interruptibleSleep(waitMs);
      if (syncState.stopRequested) {
        log('  STOP @' + handle + ' — 收到停止请求，取消重试');
        return { status: 'skipped', reason: 'stopped', note: '收到停止请求' };
      }
      return syncOneSource(source, retriesLeft - 1);
    }
    return { status: 'failed', error: String(msg).slice(0, 200), note: clean.slice(0, 60) };
  }

  // Normalize
  const normalized = tweets.map(normalizeTweet).filter(Boolean);
  if (normalized.length === 0) {
    lastSyncCache.set(sourceId, Date.now());
    saveCooldowns();
    log('  DONE @' + handle + ': 0 条推文 (可能沉默/保护)');
    return { status: 'ok', tweets: 0, hotspots: 0, note: '0 条推文 (可能沉默/保护)' };
  }

  // Record cooldown
  lastSyncCache.set(sourceId, Date.now());
  saveCooldowns();

  // Cluster → score → filter
  const CLUSTER_WINDOW_MS = 4 * 3600e3;
  const MIN_CLUSTER_SCORE = 0.10;
  const HOT_THRESHOLD = 0.35;
  const HOT_MIN_VIEWS = 10000;
  const HOT_MIN_ENG = 200;

  const clusters = clusterTweets(normalized, CLUSTER_WINDOW_MS);
  const candidates = clusters.map(c => buildHotspotFromCluster(c, {
    windowMs: CLUSTER_WINDOW_MS,
    hotThreshold: HOT_THRESHOLD,
    hotMinViews: HOT_MIN_VIEWS,
    hotMinEng: HOT_MIN_ENG,
  }));
  const kept = candidates.filter(h => h.metrics.score >= MIN_CLUSTER_SCORE);

  // Upsert hotspots
  let inserted = 0, errors = 0;
  for (const h of kept) {
    try {
      const body = JSON.stringify({
        id: h.id,
        title: h.title,
        category: h.category,
        hot_signal: h.hot_signal,
        status: h.hot_signal ? 'hot' : 'pool',
        sources: [sourceId],
        tweets: h.tweets,
        metrics: h.metrics,
        created_at: nowMinute(),
      });
      const res = await sb('hotspots?id=eq.' + encodeURIComponent(h.id), {
        method: 'GET',
        prefer: '',
      });
      let method = 'POST', upsertBody = body;
      if (res.ok) {
        const existing = await res.json();
        if (existing && existing.length > 0) {
          method = 'PATCH';
          upsertBody = JSON.stringify({
            title: h.title,
            category: h.category,
            hot_signal: h.hot_signal,
            status: h.hot_signal ? 'hot' : 'pool',
            tweets: h.tweets,
            metrics: h.metrics,
            updated_at: nowMinute(),
          });
        }
      }
      const upsertRes = await sb(method === 'POST' ? 'hotspots' : 'hotspots?id=eq.' + encodeURIComponent(h.id), {
        method,
        body: upsertBody,
        prefer: method === 'POST' ? 'return=representation' : '',
      });
      if (!upsertRes.ok && upsertRes.status !== 409) {
        const errText = await upsertRes.text().catch(() => '');
        throw new Error(errText.slice(0, 100));
      }
      inserted++;
    } catch (e) {
      errors++;
      log('    upsert fail ' + h.id + ': ' + String(e.message).slice(0, 80));
    }
  }

  // Update source metrics (7-day window)
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600e3).toISOString();
    const hsRes = await sb('hotspots?select=id,hot_signal,sources,created_at&created_at=gte.' + encodeURIComponent(since));
    if (hsRes.ok) {
      const hsRows = await hsRes.json();
      const mine = (hsRows || []).filter(h =>
        Array.isArray(h.sources) && h.sources.includes(sourceId));
      const hits = mine.length;
      const fire = mine.filter(h => h.hot_signal).length;
      const now = Date.now();
      const spark = [0, 0, 0, 0, 0, 0, 0];
      for (const h of mine) {
        const days = Math.floor((now - new Date(h.created_at).getTime()) / (24 * 3600e3));
        if (days >= 0 && days < 7) spark[6 - days]++;
      }
      const maxV = Math.max(1, ...spark);
      const sparkPx = spark.map(c => Math.round(3 + (c / maxV) * 15));

      await sb('sources?id=eq.' + encodeURIComponent(sourceId), {
        method: 'PATCH',
        body: JSON.stringify({
          metrics_4w: { hits, fire, spark: sparkPx },
          last_active_at: nowMinute(),
        }),
      });
    }
  } catch (e) {
    log('    metrics update fail: ' + String(e.message).slice(0, 80));
  }

  const doneNote = normalized.length + ' 推 → ' + kept.length + ' 簇 (入库 ' + inserted + ', 失败 ' + errors + ')';
  log('  DONE @' + handle + ': ' + doneNote);
  return { status: 'ok', tweets: normalized.length, hotspots: inserted, errors, note: doneNote };
}

// ── Main sync run ────────────────────────────────────────────────────
async function runSync() {
  if (!ENV.SUPABASE_URL || !ENV.SUPABASE_KEY) {
    log('SKIP: Supabase 未配置 (检查 .env)');
    return { ok: 0, failed: 0, skipped: 0, error: 'Supabase 未配置' };
  }

  if (syncing) {
    log('SKIP: 已有同步任务在运行');
    return { ok: 0, failed: 0, skipped: 0, error: '已有同步任务在运行' };
  }

  syncing = true;
  log('=== 开始同步 ===');

  let sourcesTotal = 0;
  try {
    // 1. Load sources from Supabase
    let sources = [];
    try {
      sources = await sbJSON('sources?select=id,handle,type,status,metrics_4w&type=eq.twitter&status=neq.retired&order=handle.asc');
      log('加载到 ' + (sources ? sources.length : 0) + ' 个 twitter 源');
    } catch (e) {
      log('加载源失败: ' + e.message);
      syncing = false;
      syncState.running = false;
      return { ok: 0, failed: 0, skipped: 0, error: e.message };
    }

    if (!sources || sources.length === 0) {
      log('没有待同步的源');
      syncing = false;
      syncState.running = false;
      return { ok: 0, failed: 0, skipped: 0 };
    }

    sourcesTotal = sources.length;

    // 2. Build queue (truncate + checkpoint filter)
    let queue = sources;
    if (queue.length > ENV.SYNC_BATCH_MAX) {
      queue = queue.slice(0, ENV.SYNC_BATCH_MAX);
      log('截断至 ' + queue.length + ' 个源 (上限 ' + ENV.SYNC_BATCH_MAX + ')');
    }

    const cp = loadCheckpoint();
    if (cp && cp.done && cp.done.length > 0) {
      const doneSet = new Set(cp.done.map(d => d.handle));
      const before = queue.length;
      queue = queue.filter(s => !doneSet.has(s.handle.replace(/^@/, '')));
      if (before !== queue.length) {
        log('断点恢复: 跳过 ' + (before - queue.length) + ' 个已完成源, 剩余 ' + queue.length);
      }
    }

    resetSyncState(queue);

    // Show checkpoint history in admin page (skip temporary errors that will retry)
    if (cp && cp.done && cp.done.length > 0) {
      for (const d of cp.done) {
        if (d.status === 'skipped' && (d.error === 'stopped' || d.error === 'backoff')) continue;
        syncState.entries.unshift({ handle: d.handle, status: d.status, tweets: 0, hotspots: 0, time: d.time, note: d.note || '', error: '' });
      }
    }

    // 3. Process queue sequentially
    let seq = 0;
    for (const s of queue) {
      // ── Stop check ──
      if (syncState.stopRequested) {
        log('收到停止请求, 终止同步');
        for (const e of syncState.entries) {
          if (e.status === 'pending') { e.status = 'skipped'; e.error = 'stopped'; }
        }
        break;
      }

      seq++;
      log('[' + seq + '/' + queue.length + '] ' + s.handle);

      const handle = s.handle.replace(/^@/, '');
      syncState.current = handle;
      const entry = syncState.entries.find(e => e.handle === handle && e.status === 'pending');
      if (entry) entry.status = 'running';

      // ── Backoff check ──
      if (isInBackoff()) {
        for (const e of syncState.entries) {
          if (e.status === 'pending' || e.status === 'running') { e.status = 'skipped'; e.error = 'backoff'; }
        }
        log('触发全局限流, 剩余 ' + (queue.length - seq + 1) + ' 个源跳过');
        break;
      }

      // ── Process source ──
      const t0 = Date.now();
      const result = await syncOneSource(s, ENV.SYNC_MAX_RETRIES);
      if (entry) {
        entry.status = result.status;
        entry.tweets = result.tweets || 0;
        entry.hotspots = result.hotspots || 0;
        entry.error = result.error || '';
        entry.note = result.note || result.reason || result.error || '';
        entry.time = Date.now() - t0;
      }

      saveCheckpoint();

      // ── Inter-source delay ──
      if (seq < queue.length && !isInBackoff() && !syncState.stopRequested) {
        const delay = randomDelay();
        log('  等待 ' + Math.round(delay / 1000) + 's…');
        await interruptibleSleep(delay);
      }
    }

    // 4. Cleanup
    syncState.current = null;
    syncState.running = false;

    const wasStopped = syncState.stopRequested;
    const hasPending = syncState.entries.some(e => e.status === 'pending');
    if (!wasStopped && !hasPending) {
      clearCheckpoint();               // all done — clean start next time
    } else {
      saveCheckpoint();                // interrupted — resume next time
    }

    log('=== 同步完成: ' + syncState.done + ' 成功, ' + syncState.failed + ' 失败, ' + syncState.skipped + ' 跳过 ===');
    return { ok: syncState.done, failed: syncState.failed, skipped: syncState.skipped, sources_total: sourcesTotal };
  } finally {
    syncing = false;
  }
}

// ══════════════════════════════════════════════════════════════════════
// 6. EXPORTS
// ══════════════════════════════════════════════════════════════════════

export { runSync, syncState, stopSync };
