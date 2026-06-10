// src/scheduler.js — daily sync scheduler for imported Twitter accounts.
// Runs in serve.js process. Fetches tweets via opencli, clusters/scoring
// (ported from content-ops.js), upserts hotspots + updates source metrics via
// Supabase REST API.
//
// Configuration (env vars, all optional):
//   SYNC_HOUR=2              hour of day to run (0-23, default 2 = 2 AM)
//   SYNC_MAX_RETRIES=3       max retries per source on failure
//   SYNC_FETCH_LIMIT=100     tweets per source
//   SYNC_TOP_ENGAGEMENT=30   engagement cutoff
//   SYNC_BATCH_MAX=20        max sources per run
//   SYNC_DELAY_MIN=8000      min inter-source delay ms
//   SYNC_DELAY_MAX=25000     max inter-source delay ms

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// ─── Config from env ────────────────────────────────────────────────
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
        // Strip inline comments (space+# followed by comment). Safe for URLs/numbers.
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

// ─── Logging ────────────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log('[scheduler ' + ts + '] ' + msg);
}

function nowMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString();
}

// ─── Supabase REST client ───────────────────────────────────────────
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

// ─── OpenCLI ────────────────────────────────────────────────────────
function opencliTweets(handle, limit, topEng) {
  const args = ['opencli', 'twitter', 'tweets', handle, '--limit', String(limit), '--format', 'json'];
  if (topEng > 0) args.push('--top-by-engagement', String(topEng));
  const cmd = args.join(' ');
  log('  opencli: ' + cmd);
  const result = execSync(cmd, {
    timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: 'utf-8',
  });
  const data = JSON.parse(result);
  return Array.isArray(data) ? data : (data.tweets || data.result || []);
}

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

// ─── Content ops (ported from src/content-ops.js) ───────────────────
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

// ─── Rate limiting ──────────────────────────────────────────────────
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomDelay() {
  return ENV.SYNC_DELAY_MIN + Math.floor(Math.random() * (ENV.SYNC_DELAY_MAX - ENV.SYNC_DELAY_MIN));
}

// ─── 24h cooldown cache (in-memory, survives across runs in same process) ──
const lastSyncCache = new Map();

// ─── Sync one source ────────────────────────────────────────────────
async function syncOneSource(source, retriesLeft) {
  const handle = source.handle.replace(/^@/, '');
  const sourceId = source.id;

  // Check cooldown
  const lastSync = lastSyncCache.get(sourceId) || 0;
  if (Date.now() - lastSync < 24 * 3600e3) {
    log('  SKIP @' + handle + ' — 24h 内已同步');
    return { status: 'skipped', reason: 'cooldown' };
  }

  if (isInBackoff()) {
    const remain = Math.ceil((backoffUntil - Date.now()) / 60e3);
    log('  SKIP @' + handle + ' — 全局限流退避中 (~' + remain + 'min)');
    return { status: 'skipped', reason: 'backoff' };
  }

  log('  SYNC @' + handle + ' (重试剩余 ' + retriesLeft + ' 次)');

  let tweets = [];
  try {
    tweets = opencliTweets(handle, ENV.SYNC_FETCH_LIMIT, ENV.SYNC_TOP_ENGAGEMENT);
    consecutive429 = 0;
  } catch (e) {
    const msg = e.stderr || e.stdout || e.message || '';
    // Filter out Node.js warning noise
    const clean = String(msg)
      .replace(/^\(node:\d+\) \[UNDICI-EHPA\][^\n]*\n?/gm, '')
      .replace(/\(Use `node --trace-warnings.*?\)\n?/g, '')
      .trim();
    const statusMatch = clean.match(/(\d{3})/);
    const status = statusMatch ? parseInt(statusMatch[1]) : 0;
    const backoffMsg = applyBackoff(status);

    log('  FAIL @' + handle + ': ' + (clean || String(msg).trim()).slice(0, 100) + (backoffMsg ? ' — ' + backoffMsg : ''));

    if (retriesLeft > 0 && !isInBackoff()) {
      const waitMs = Math.min(60000, 5000 * Math.pow(2, ENV.SYNC_MAX_RETRIES - retriesLeft));
      log('  RETRY @' + handle + ' in ' + Math.round(waitMs / 1000) + 's…');
      await sleep(waitMs);
      return syncOneSource(source, retriesLeft - 1);
    }
    return { status: 'failed', error: String(msg).slice(0, 200) };
  }

  const normalized = tweets.map(normalizeTweet).filter(Boolean);
  if (normalized.length === 0) {
    lastSyncCache.set(sourceId, Date.now());
    log('  DONE @' + handle + ': 0 条推文 (可能沉默/保护)');
    return { status: 'ok', tweets: 0, hotspots: 0 };
  }

  // Record sync time
  lastSyncCache.set(sourceId, Date.now());

  // Cluster → score → filter → upsert hotspots
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

  // Update source metrics_4w (7-day window)
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

  log('  DONE @' + handle + ': ' + normalized.length + ' 推 → ' + kept.length + ' 簇 (入库 ' + inserted + ', 失败 ' + errors + ')');
  return { status: 'ok', tweets: normalized.length, hotspots: inserted, errors };
}

// ─── Concurrency guard ──────────────────────────────────────────────
let syncing = false;

// ─── Main sync run ──────────────────────────────────────────────────
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

  let ok = 0, failed = 0, skipped = 0, sourcesTotal = 0;
  try {
    // 1. Load all non-retired twitter sources
    let sources = [];
    try {
      sources = await sbJSON('sources?select=id,handle,type,status,metrics_4w&type=eq.twitter&status=neq.retired&order=handle.asc');
      log('加载到 ' + (sources ? sources.length : 0) + ' 个 twitter 源');
    } catch (e) {
      log('加载源失败: ' + e.message);
      return { ok: 0, failed: 0, skipped: 0, error: e.message };
    }

    if (!sources || sources.length === 0) {
      log('没有待同步的源');
      return { ok: 0, failed: 0, skipped: 0 };
    }

    sourcesTotal = sources.length;

    // 2. Truncate to batch max
    let queue = sources;
    if (queue.length > ENV.SYNC_BATCH_MAX) {
      queue = queue.slice(0, ENV.SYNC_BATCH_MAX);
      log('截断至 ' + queue.length + ' 个源 (上限 ' + ENV.SYNC_BATCH_MAX + ')');
    }

    // 3. Sequential sync with delays
    let done = 0;
    for (const s of queue) {
      done++;
      log('[' + done + '/' + queue.length + '] ' + s.handle);

      if (isInBackoff()) {
        skipped = queue.length - done + 1;
        log('触发全局限流, 剩余 ' + skipped + ' 个源跳过');
        break;
      }

      const result = await syncOneSource(s, ENV.SYNC_MAX_RETRIES);
      if (result.status === 'ok') ok++;
      else if (result.status === 'failed') failed++;
      else skipped++;

      // Inter-source delay (skip after last)
      if (done < queue.length && !isInBackoff()) {
        const delay = randomDelay();
        log('  等待 ' + Math.round(delay / 1000) + 's…');
        await sleep(delay);
      }
    }

    log('=== 同步完成: ' + ok + ' 成功, ' + failed + ' 失败, ' + skipped + ' 跳过 ===');
    return { ok, failed, skipped, sources_total: sourcesTotal };
  } finally {
    syncing = false;
  }
}

export { runSync };
