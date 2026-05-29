// src/provider.js — data sourcing abstraction (replaces Twitter API proxy).
// Load via <script src="src/provider.js">, exposes window.Provider.
// Uses OpenCLI Chrome Extension via serve.js proxy (/api/opencli → localhost:19825).

(function () {
  const OPENCLI_BASE = '/api/opencli';   // proxied by serve.js (avoids CORS)

  // ─── Input validation ──────────────────────────────────────────
  var HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  var LIST_ID_RE = /^\d{1,25}$/;

  function validateHandle(raw) {
    var h = String(raw || '').replace(/^@/, '').trim();
    if (!HANDLE_RE.test(h)) throw new Error('Invalid handle: ' + h);
    return h;
  }

  function validateListId(id) {
    var s = String(id || '').trim();
    if (!LIST_ID_RE.test(s)) throw new Error('Invalid list ID: ' + s);
    return s;
  }

  // ─── Safe argument escaping for /exec fallback ─────────────────
  function shellArg(s) {
    // Single-quote wrapping prevents all shell expansion. Escape any
    // single-quotes that appear inside the value.
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  // ─── HTTP client ───────────────────────────────────────────────
  function buildUrl(path, params) {
    var qs = [];
    if (params) {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i], v = params[k];
        if (v != null) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }
    }
    return OPENCLI_BASE + path + (qs.length ? '?' + qs.join('&') : '');
  }

  async function opencli(path, params) {
    var res = await fetch(buildUrl(path, params));
    if (!res.ok) {
      var err = '';
      try { err = await res.text(); } catch (_) {}
      throw new Error('OpenCLI ' + res.status + ': ' + (err || res.statusText));
    }
    return res.json();
  }

  // ─── Tweet normalization ───────────────────────────────────────
  // Handles both OpenCLI flat format ({author:"x",likes:5,...}) and
  // legacy nested format ({author:{username:"x"},metrics:{likes:5},...})

  function normalizeTweet(t) {
    if (!t) return null;
    // OpenCLI: author is a string, metrics are flat on t
    var isOpenCLI = typeof t.author === 'string';
    return {
      id: t.id || t.tweet_id || '',
      url: t.url || (isOpenCLI
        ? 'https://x.com/' + t.author + '/status/' + t.id
        : (t.author && (t.author.username || t.author.userName)
          ? 'https://x.com/' + (t.author.username || t.author.userName) + '/status/' + t.id
          : '')),
      text: t.text || '',
      author: isOpenCLI
        ? { username: t.author || '', name: t.name || '' }
        : { username: (t.author && (t.author.username || t.author.userName || t.author.screen_name)) || '',
            name: (t.author && (t.author.name || t.author.display_name)) || '' },
      created_at: t.created_at || t.createdAt || t.created || '',
      kind: t.kind || (t.is_retweet || t.isRetweet ? 'retweet'
        : (t.is_quote || t.isQuote ? 'quote'
        : (t.is_reply || t.isReply ? 'reply' : 'original'))),
      has_media: t.has_media || (t.media_urls && t.media_urls.length > 0) || false,
      media_urls: t.media_urls || [],
      metrics: isOpenCLI
        ? { views: t.views || 0, likes: t.likes || 0, retweets: t.retweets || 0, replies: t.replies || 0, quotes: 0, bookmarks: t.bookmarks || 0 }
        : { views: (t.metrics && t.metrics.views) || (t.metrics && t.metrics.impression_count) || (t.metrics && t.metrics.viewCount) || 0,
            likes: (t.metrics && t.metrics.likes) || (t.metrics && t.metrics.like_count) || (t.metrics && t.metrics.likeCount) || 0,
            retweets: (t.metrics && t.metrics.retweets) || (t.metrics && t.metrics.retweet_count) || (t.metrics && t.metrics.retweetCount) || 0,
            replies: (t.metrics && t.metrics.replies) || (t.metrics && t.metrics.reply_count) || (t.metrics && t.metrics.replyCount) || 0,
            quotes: (t.metrics && t.metrics.quotes) || (t.metrics && t.metrics.quote_count) || (t.metrics && t.metrics.quoteCount) || 0,
            bookmarks: (t.metrics && t.metrics.bookmarks) || (t.metrics && t.metrics.bookmark_count) || (t.metrics && t.metrics.bookmarkCount) || 0 },
    };
  }

  // ─── Data fetching with availability gate ──────────────────────
  async function ensureAvailable() {
    var ok = await isAvailable();
    if (!ok) throw new Error('OpenCLI daemon not running — install the Chrome extension');
  }

  async function fetchTweetsByHandle(handle, hours, limit, topByEngagement) {
    hours = hours || 168;
    limit = limit || 100;
    topByEngagement = topByEngagement || 30;
    var raw = validateHandle(handle);
    await ensureAvailable();
    try {
      var data = await opencli('/api/twitter/user-timeline', {
        handle: raw, hours: hours, limit: limit, topByEngagement: topByEngagement
      });
      var tweets = Array.isArray(data) ? data : (data.tweets || data.result || []);
      return tweets.map(normalizeTweet).filter(Boolean);
    } catch (e) {
      console.warn('[provider] primary fetchTweetsByHandle failed, trying fallback:', e.message);
      var cmd2 = 'twitter tweets ' + shellArg(raw) +
        ' --limit ' + shellArg(limit) +
        ' --format json';
      if (topByEngagement && topByEngagement > 0) cmd2 += ' --top-by-engagement ' + shellArg(topByEngagement);
      var data2 = await opencli('/exec', { cmd: cmd2 });
      var tweets2 = Array.isArray(data2) ? data2 : (data2.result || data2.tweets || []);
      return tweets2.map(normalizeTweet).filter(Boolean);
    }
  }

  async function fetchSingleTweet(urlOrId) {
    var input = String(urlOrId || '').trim();
    if (!input) throw new Error('Empty tweet URL or ID');
    await ensureAvailable();
    try {
      var data = await opencli('/api/twitter/tweet', { url: input });
      var t = Array.isArray(data) ? data[0] : (data.tweet || data);
      return normalizeTweet(t);
    } catch (e) {
      console.warn('[provider] primary fetchSingleTweet failed, trying fallback:', e.message);
      var m2 = input.match(/(?:x\.com|twitter\.com)\/([^/]+)/i);
      var user2 = m2 ? m2[1] : '';
      var data2 = await opencli('/exec', {
        cmd: 'twitter tweets ' + shellArg(user2) + ' --limit 20 --format json',
      });
      var t2 = Array.isArray(data2) ? data2[0] : (data2.result || data2.tweet || data2);
      return normalizeTweet(t2);
    }
  }

  async function fetchListMembers(listId) {
    var id = validateListId(listId);
    await ensureAvailable();
    try {
      var data = await opencli('/api/twitter/list-members', { listId: id });
      return data.members || [];
    } catch (e) {
      console.warn('[provider] OpenCLI fetchListMembers failed, trying fallback:', e.message);
      var data = await opencli('/exec', {
        cmd: 'twitter lists --limit 50 --format json',
      });
      return data.result || data.members || [];
    }
  }

  // ─── Health check ──────────────────────────────────────────────
  var _checked = false;
  var _available = false;

  async function isAvailable() {
    if (_checked) return _available;
    try {
      var res = await fetch(OPENCLI_BASE + '/health');
      _available = res.ok;
    } catch (e) {
      _available = false;
    }
    _checked = true;
    return _available;
  }

  window.Provider = {
    fetchTweetsByHandle: fetchTweetsByHandle,
    fetchSingleTweet: fetchSingleTweet,
    fetchListMembers: fetchListMembers,
    isAvailable: isAvailable,
  };
})();
