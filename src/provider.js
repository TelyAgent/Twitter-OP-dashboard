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

  async function fetchTweetsByHandle(handle, hours) {
    hours = hours || 168;
    var raw = validateHandle(handle);
    await ensureAvailable();
    try {
      var data = await opencli('/api/twitter/user-timeline', { handle: raw, hours: hours });
      return (data.tweets || []).map(normalizeTweet).filter(Boolean);
    } catch (e) {
      console.warn('[provider] primary fetchTweetsByHandle failed, trying fallback:', e.message);
      var data = await opencli('/exec', {
        cmd: 'twitter user-timeline --handle ' + shellArg(raw) + ' --hours ' + shellArg(hours) + ' --format json',
      });
      return (data.result || data.tweets || []).map(normalizeTweet).filter(Boolean);
    }
  }

  async function fetchSingleTweet(urlOrId) {
    var input = String(urlOrId || '').trim();
    if (!input) throw new Error('Empty tweet URL or ID');
    await ensureAvailable();
    try {
      var data = await opencli('/api/twitter/tweet', { url: input });
      return normalizeTweet(data.tweet || data);
    } catch (e) {
      console.warn('[provider] primary fetchSingleTweet failed, trying fallback:', e.message);
      var data = await opencli('/exec', {
        cmd: 'twitter tweet --url ' + shellArg(input) + ' --format json',
      });
      return normalizeTweet(data.result || data.tweet || data);
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
        cmd: 'twitter list-members --list-id ' + shellArg(id) + ' --format json',
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
