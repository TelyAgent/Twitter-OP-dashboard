// src/provider.js — data sourcing abstraction (replaces Twitter API proxy).
// Load via <script src="src/provider.js">, exposes window.Provider.
// Uses OpenCLI Chrome Extension daemon at localhost:19825.

(function () {
  const OPENCLI_BASE = 'http://localhost:19825';

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
  async function opencli(path, params) {
    var url = new URL(path, OPENCLI_BASE);
    if (params) {
      var keys = Object.keys(params);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i], v = params[k];
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    var res = await fetch(url.toString());
    if (!res.ok) {
      var err = '';
      try { err = await res.text(); } catch (_) {}
      throw new Error('OpenCLI ' + res.status + ': ' + (err || res.statusText));
    }
    return res.json();
  }

  // ─── Tweet normalization ───────────────────────────────────────
  function normalizeTweet(t) {
    if (!t) return null;
    var author = t.author || {};
    var metrics = t.metrics || {};
    return {
      id: t.id || t.tweet_id || '',
      url: t.url || (author.username || author.userName
        ? 'https://x.com/' + (author.username || author.userName) + '/status/' + (t.id || '')
        : ''),
      text: t.text || '',
      author: {
        username: author.username || author.userName || author.screen_name || '',
        name: author.name || author.display_name || '',
      },
      created_at: t.created_at || t.createdAt || t.created || '',
      kind: t.kind || (t.is_retweet || t.isRetweet ? 'retweet'
        : (t.is_quote || t.isQuote ? 'quote'
        : (t.is_reply || t.isReply ? 'reply' : 'original'))),
      metrics: {
        views:     metrics.views     ?? metrics.impression_count ?? metrics.viewCount ?? 0,
        likes:     metrics.likes     ?? metrics.like_count      ?? metrics.likeCount  ?? 0,
        retweets:  metrics.retweets  ?? metrics.retweet_count   ?? metrics.retweetCount ?? 0,
        replies:   metrics.replies   ?? metrics.reply_count     ?? metrics.replyCount   ?? 0,
        quotes:    metrics.quotes    ?? metrics.quote_count     ?? metrics.quoteCount   ?? 0,
        bookmarks: metrics.bookmarks ?? metrics.bookmark_count  ?? metrics.bookmarkCount ?? 0,
      },
    };
  }

  // ─── Data fetching with availability gate ──────────────────────
  async function ensureAvailable() {
    var ok = await isAvailable();
    if (!ok) throw new Error('OpenCLI daemon not running at ' + OPENCLI_BASE);
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
        cmd: 'twitter user-timeline --handle ' + shellArg(raw) + ' --hours ' + hours + ' --format json',
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
