// src/content-ops.js — shared content operations.
// Load via <script src="src/content-ops.js">, exposes window.ContentOps.
// All functions are pure: take input, return output. No DOM or I/O.

(function () {
  // ─── Constants ────────────────────────────────────────────────
  const CLUSTER_KEYS = [
    'polymarket','kalshi','manifold','metaculus','predictit',
    'fomc','cpi','nfp','pce','gdp','payroll',
    'powell','trump','biden','harris','musk','lagarde','yellen','sbf',
    'bitcoin','btc','ethereum','eth','solana','sol','xrp','bnb',
    'smart money','whale','on-chain','onchain','defi','tvl',
    'inflation','interest rate','rate cut','rate hike',
    'election','congress','senate',
    'hack','exploit','rug','scam',
  ];

  const CAT_KW = {
    A: ['odds','polymarket','kalshi','manifold','prediction market','bet','probability','resolves','contract','yes/no'],
    C: ['smart money','whale','wallet','0x','on-chain','onchain','defi','position','buys','sells','moves funds'],
    D: ['new market','new contract','launching','listed','just added','first trade','new listing'],
    E: ['fomc','fed','cpi','inflation','rate cut','rate hike','election','trump','powell','bitcoin','btc','crypto'],
  };

  const ALL_KW = Object.values(CAT_KW).flat();

  const POLY_KW = [
    'polymarket','kalshi','manifold','predictit','metaculus',
    'prediction market','binary market','event contract','odds','probability',
    'yes/no','resolves','bet on','betting market',
    'fomc','rate cut','rate hike','election','whale','smart money',
    'fed','cpi','powell','trump',
  ];

  // ─── Utility ──────────────────────────────────────────────────
  function fmt(n) {
    if (n == null) return '—';
    n = Number(n);
    if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3.6e6) return Math.floor(diff/60000) + ' min';
    if (diff < 8.64e7) return Math.floor(diff/3.6e6) + ' h';
    return Math.floor(diff/8.64e7) + ' d';
  }

  // ─── Category classification ──────────────────────────────────
  function classifyCategory(text) {
    var lower = String(text || '').toLowerCase();
    for (var cat in CAT_KW) {
      if (CAT_KW[cat].some(function (kw) { return lower.indexOf(kw) !== -1; })) {
        return cat;
      }
    }
    return 'E';
  }

  // ─── Angle classification (7 types) ────────────────────────────
  function classifyAngle(t) {
    if (!t) return 'Other';
    var text = String(t.text || '');
    if (!text) return 'Other';

    if (/🧵|^\s*1\/|\(1\/\d+\)|\bthread\b/i.test(text)) return 'Thread';
    if (/\b(full guide|step.?by.?step|tutorial|how to|here'?s how|hour guide|guide:|complete guide|walkthrough)\b/i.test(text)) return '教程';
    if (/(this guy|made \$[\d,]+|turned \$[\d,.]+ ?into|flipped \$[\d,.]+|\$\d{2,}\s?k\/?(month|day)|profit of \$)/i.test(text)) return '案例';
    if (/\b(destroyed|killed|finally|everyone (thinks|expects)|nobody (knows|talks|sees)|reality is|truth is|wrong about|but actually|the real |secret|exposed)\b/i.test(text)
        || /\b[A-Z]{5,}\b/.test(text)) return '反直觉';
    if (/\d{1,3}%|\b\d+x\s+(return|gain|profit)|\bwin rate|\broi\b|n\s*=\s*\d+|backtest/i.test(text)) return '数据驱动';
    if (t.kind === 'quote' || t.kind === 'reply' || t.kind === 'retweet'
        || (text.match(/@\w+/g) || []).length >= 2) return 'KOL 蹭点';
    if (text.length > 200 && t.kind === 'original') return '深度';
    return 'Other';
  }

  // ─── Clustering ───────────────────────────────────────────────
  function extractKey(text) {
    var lower = (text || '').toLowerCase();
    for (var i = 0; i < CLUSTER_KEYS.length; i++) {
      if (lower.indexOf(CLUSTER_KEYS[i]) !== -1) return CLUSTER_KEYS[i];
    }
    var m = (text || '').match(/\$[\d,.]+[kKmMbB]?/);
    return m ? m[0].toLowerCase() : null;
  }

  function clusterTweets(tweets, windowMs) {
    windowMs = windowMs || (4 * 3600e3);
    var byKey = {};
    var orphans = [];
    for (var i = 0; i < tweets.length; i++) {
      var t = tweets[i];
      var k = extractKey(t.text);
      if (k) {
        if (!byKey[k]) byKey[k] = [];
        byKey[k].push(t);
      } else {
        orphans.push(t);
      }
    }
    var clusters = [];
    for (var key in byKey) {
      var group = byKey[key];
      group.sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
      var curr = [group[0]];
      for (var j = 1; j < group.length; j++) {
        var dt = new Date(group[j].created_at) - new Date(curr[curr.length - 1].created_at);
        if (dt <= windowMs) curr.push(group[j]);
        else { clusters.push({ key: key, tweets: curr }); curr = [group[j]]; }
      }
      clusters.push({ key: key, tweets: curr });
    }
    for (var o = 0; o < orphans.length; o++) {
      clusters.push({ key: 'misc', tweets: [orphans[o]] });
    }
    return clusters;
  }

  // ─── Scoring ──────────────────────────────────────────────────
  function scoreCluster(tweets) {
    var allText = tweets.map(function (t) { return t.text || ''; }).join(' ').toLowerCase();
    var matches = 0;
    for (var i = 0; i < ALL_KW.length; i++) {
      if (allText.indexOf(ALL_KW[i]) !== -1) matches++;
    }
    var fit = Math.min(1, matches / Math.max(tweets.length * 3, 3));

    var totalEng = 0, totalViews = 0;
    for (var j = 0; j < tweets.length; j++) {
      var m = tweets[j].metrics || {};
      totalEng += (m.likes || 0) + (m.retweets || 0) + (m.replies || 0);
      totalViews += m.views || 0;
    }
    var avgEng = totalEng / tweets.length;
    var avgViews = totalViews / tweets.length;
    var viral = avgViews > 0
      ? Math.min(1, avgEng / Math.max(avgViews * 0.02, 50))
      : Math.min(1, avgEng / 200);

    var newest = 0;
    for (var k = 0; k < tweets.length; k++) {
      var ts = new Date(tweets[k].created_at).getTime() || 0;
      if (ts > newest) newest = ts;
    }
    var hoursOld = (Date.now() - newest) / 3.6e6;
    var fresh = Math.max(0, 1 - hoursOld / 72);

    var score = fit * 0.3 + viral * 0.4 + fresh * 0.3;
    if (totalEng < 10) score = 0;
    else if (viral < 0.05) score *= 0.3;
    score = +score.toFixed(3);

    return {
      fit: +fit.toFixed(2), viral: +viral.toFixed(2), fresh: +fresh.toFixed(2), score: score,
      cluster_size: tweets.length, total_views: totalViews, total_engagement: totalEng,
      avg_views: Math.round(avgViews), avg_engagement: Math.round(avgEng),
    };
  }

  // ─── Build hotspot row ────────────────────────────────────────
  function buildHotspotFromCluster(cluster, opts) {
    opts = opts || {};
    var windowMs = opts.windowMs || (4 * 3600e3);
    var hotThreshold = opts.hotThreshold != null ? opts.hotThreshold : 0.35;
    var hotMinViews = opts.hotMinViews != null ? opts.hotMinViews : 10000;
    var hotMinEng = opts.hotMinEng != null ? opts.hotMinEng : 200;

    var tweets = cluster.tweets.slice().sort(function (a, b) {
      return (b.metrics && b.metrics.views || 0) - (a.metrics && a.metrics.views || 0);
    });
    var top = tweets[0];
    var allText = tweets.map(function (t) { return t.text || ''; }).join(' ');
    var cat = classifyCategory(allText);
    var sc = scoreCluster(tweets);

    var earliest = Infinity;
    for (var i = 0; i < tweets.length; i++) {
      var t = new Date(tweets[i].created_at).getTime() || Date.now();
      if (t < earliest) earliest = t;
    }
    var bucket = Math.floor(earliest / windowMs);
    var keySlug = cluster.key.replace(/[^a-z0-9]+/gi, '_').slice(0, 30);

    var passAbs = (sc.total_views >= hotMinViews) || (sc.total_engagement >= hotMinEng);
    var isHot = sc.score >= hotThreshold && passAbs;

    return {
      id: 'hs_c_' + keySlug + '_' + bucket,
      title: (top.text || '').slice(0, 120),
      category: cat,
      hot_signal: isHot,
      tweets: tweets,
      metrics: sc,
    };
  }

  // ─── Template skeleton extraction ─────────────────────────────
  function extractSkeleton(text) {
    var t = String(text || '');
    t = t.replace(/https?:\/\/\S+/g, '{链接}');
    t = t.replace(/@\w+/g, '{账号}');
    t = t.replace(/\$[\d,.]+\s?[kKmMbB]?(\/(month|day|hour|hr))?/g, '{金额}');
    t = t.replace(/\b\d{1,3}%/g, '{比例}');
    t = t.replace(/\b\d+x\b/g, '{倍数}');
    t = t.replace(/\b\d{4,}\b/g, '{数据}');
    return t;
  }

  function slotsOf(skeleton) {
    return Array.from(new Set((skeleton.match(/\{[^}]+\}/g) || []).map(function (m) { return m.slice(1, -1); })));
  }

  // ─── PM relevance ─────────────────────────────────────────────
  function pmRelevance(tweets) {
    if (!tweets || tweets.length === 0) return { score: 0, matches: 0, total: 0 };
    var matched = 0;
    for (var i = 0; i < tweets.length; i++) {
      var text = (tweets[i].text || '').toLowerCase();
      for (var j = 0; j < POLY_KW.length; j++) {
        if (text.indexOf(POLY_KW[j]) !== -1) { matched++; break; }
      }
    }
    var ratio = matched / tweets.length;
    return { score: +Math.min(1, ratio / 0.2).toFixed(2), matches: matched, total: tweets.length };
  }

  // ─── Exports ──────────────────────────────────────────────────
  window.ContentOps = {
    CAT_KW: CAT_KW,
    ALL_KW: ALL_KW,
    CLUSTER_KEYS: CLUSTER_KEYS,
    POLY_KW: POLY_KW,
    fmt: fmt,
    timeAgo: timeAgo,
    classifyCategory: classifyCategory,
    classifyAngle: classifyAngle,
    extractKey: extractKey,
    clusterTweets: clusterTweets,
    scoreCluster: scoreCluster,
    buildHotspotFromCluster: buildHotspotFromCluster,
    extractSkeleton: extractSkeleton,
    slotsOf: slotsOf,
    pmRelevance: pmRelevance,
  };
})();
