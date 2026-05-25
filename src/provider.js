// src/provider.js — data sourcing abstraction (replaces Twitter API proxy).
// Load via <script src="src/provider.js">, exposes window.Provider.
// Uses OpenCLI Chrome Extension daemon at localhost:19825.

(function () {
  const OPENCLI_BASE = 'http://localhost:19825';

  async function opencli(path, params) {
    const url = new URL(path, OPENCLI_BASE);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`OpenCLI ${res.status}: ${err || res.statusText}`);
    }
    return res.json();
  }

  function normalizeTweet(t) {
    if (!t) return null;
    return {
      id: t.id || '',
      url: t.url || (t.author && t.author.username ? `https://x.com/${t.author.username}/status/${t.id}` : ''),
      text: t.text || '',
      author: { username: (t.author && t.author.username) || '', name: (t.author && t.author.name) || '' },
      created_at: t.created_at || '',
      kind: t.kind || 'original',
      metrics: {
        views: t.metrics && t.metrics.views != null ? t.metrics.views : 0,
        likes: t.metrics && t.metrics.likes != null ? t.metrics.likes : 0,
        retweets: t.metrics && t.metrics.retweets != null ? t.metrics.retweets : 0,
        replies: t.metrics && t.metrics.replies != null ? t.metrics.replies : 0,
        quotes: t.metrics && t.metrics.quotes != null ? t.metrics.quotes : 0,
        bookmarks: t.metrics && t.metrics.bookmarks != null ? t.metrics.bookmarks : 0,
      },
    };
  }

  async function fetchTweetsByHandle(handle, hours) {
    hours = hours || 168;
    var raw = handle.replace(/^@/, '');
    try {
      var data = await opencli('/api/twitter/user-timeline', { handle: raw, hours: hours });
      return (data.tweets || []).map(normalizeTweet).filter(Boolean);
    } catch (e) {
      console.warn('[provider] OpenCLI fetchTweetsByHandle failed, trying fallback:', e.message);
      var data = await opencli('/exec', { cmd: 'twitter user-timeline --handle ' + raw + ' --hours ' + hours + ' --format json' });
      return (data.result || data.tweets || []).map(normalizeTweet).filter(Boolean);
    }
  }

  async function fetchSingleTweet(urlOrId) {
    try {
      var data = await opencli('/api/twitter/tweet', { url: urlOrId });
      return normalizeTweet(data.tweet || data);
    } catch (e) {
      console.warn('[provider] OpenCLI fetchSingleTweet failed, trying fallback:', e.message);
      var data = await opencli('/exec', { cmd: 'twitter tweet --url "' + urlOrId + '" --format json' });
      return normalizeTweet(data.result || data.tweet || data);
    }
  }

  async function fetchListMembers(listId) {
    try {
      var data = await opencli('/api/twitter/list-members', { listId: listId });
      return data.members || [];
    } catch (e) {
      console.warn('[provider] OpenCLI fetchListMembers failed, trying fallback:', e.message);
      var data = await opencli('/exec', { cmd: 'twitter list-members --list-id ' + listId + ' --format json' });
      return data.result || data.members || [];
    }
  }

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
