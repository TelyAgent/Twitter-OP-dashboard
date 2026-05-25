import {
  getClient, extractTweetId, sendTwitterError, readJsonBody,
} from '../_lib/twitter.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const body = await readJsonBody(req);
  const id = extractTweetId(body.url || body.id);
  if (!id) {
    res.status(400).json({ ok: false, error: 'invalid tweet URL or id' });
    return;
  }

  let client;
  try { client = getClient(); }
  catch (e) {
    res.status(503).json({ ok: false, error: e.message });
    return;
  }

  try {
    const { data: t, includes } = await client.v2.singleTweet(id, {
      'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'text'],
      expansions: ['author_id'],
      'user.fields': ['username', 'name'],
    });
    if (!t) {
      res.status(404).json({ ok: false, error: 'tweet not found' });
      return;
    }
    const author = includes?.users?.[0];
    const m = t.public_metrics || {};
    res.status(200).json({
      ok: true,
      tweet: {
        id: t.id,
        url: author ? `https://x.com/${author.username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
        text: t.text,
        author: author ? { username: author.username, name: author.name } : null,
        created_at: t.created_at,
        metrics: {
          views:     m.impression_count ?? null,
          likes:     m.like_count        ?? 0,
          retweets:  m.retweet_count     ?? 0,
          replies:   m.reply_count       ?? 0,
          quotes:    m.quote_count       ?? 0,
          bookmarks: m.bookmark_count    ?? 0,
        },
      },
    });
  } catch (err) {
    sendTwitterError(res, err);
  }
}
