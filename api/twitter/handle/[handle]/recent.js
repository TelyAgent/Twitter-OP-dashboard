import {
  getClient, classifyTweetKind, sendTwitterError, readJsonBody,
} from '../../../_lib/twitter.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const raw = String(req.query.handle || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) {
    res.status(400).json({ ok: false, error: 'invalid handle' });
    return;
  }

  const body = await readJsonBody(req);
  const hours = Math.min(Math.max(Number(body.hours || 168), 1), 720);
  const startTime = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  let client;
  try { client = getClient(); }
  catch (e) {
    res.status(503).json({ ok: false, error: e.message });
    return;
  }

  try {
    const user = await client.v2.userByUsername(raw, {
      'user.fields': ['username', 'name', 'public_metrics'],
    });
    if (!user?.data) {
      res.status(404).json({ ok: false, error: 'X user not found' });
      return;
    }
    const u = user.data;

    const tl = await client.v2.userTimeline(u.id, {
      max_results: 100,
      start_time: startTime,
      'tweet.fields': ['public_metrics', 'created_at', 'referenced_tweets', 'author_id', 'lang'],
      expansions:    ['referenced_tweets.id', 'author_id'],
      'user.fields': ['username', 'name'],
    });

    const tweets = (tl.data?.data || []).map(t => ({
      id: t.id,
      url: `https://x.com/${u.username}/status/${t.id}`,
      text: t.text,
      lang: t.lang,
      author: { username: u.username, name: u.name },
      created_at: t.created_at,
      kind: classifyTweetKind(t.referenced_tweets),
      referenced_tweet_id: t.referenced_tweets?.[0]?.id || null,
      metrics: {
        views:     t.public_metrics?.impression_count ?? null,
        likes:     t.public_metrics?.like_count        ?? 0,
        retweets:  t.public_metrics?.retweet_count     ?? 0,
        replies:   t.public_metrics?.reply_count       ?? 0,
        quotes:    t.public_metrics?.quote_count       ?? 0,
        bookmarks: t.public_metrics?.bookmark_count    ?? 0,
      },
    }));

    const meta = tl._rateLimit || {};
    res.setHeader('x-x-rate-remaining', meta.remaining ?? '');
    res.setHeader('x-x-rate-reset', meta.reset ?? '');

    res.status(200).json({
      ok: true,
      handle: '@' + u.username,
      user: { id: u.id, username: u.username, name: u.name },
      window: { hours, start_time: startTime, end_time: new Date().toISOString() },
      pulled: tweets.length,
      tweets,
      rate_limit: { remaining: meta.remaining, reset: meta.reset, limit: meta.limit },
    });
  } catch (err) {
    sendTwitterError(res, err);
  }
}
