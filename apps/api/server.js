import Fastify from 'fastify';
import cors from '@fastify/cors';
import { TwitterApi, ApiResponseError } from 'twitter-api-v2';

const PORT = Number(process.env.PORT || 8081);
const HOST = process.env.HOST || '0.0.0.0';
const BEARER = process.env.TWITTER_BEARER_TOKEN || '';

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, {
  origin: true,
});

let xClient = null;
function getClient() {
  if (!BEARER || BEARER.startsWith('PLACEHOLDER')) {
    throw new Error('TWITTER_BEARER_TOKEN not configured');
  }
  if (!xClient) xClient = new TwitterApi(BEARER).readOnly;
  return xClient;
}

function extractTweetId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{1,25}$/.test(s)) return s;
  const m = s.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d{1,25})/i);
  return m ? m[1] : null;
}

app.get('/api/health', async () => ({
  ok: true,
  hasToken: Boolean(BEARER) && !BEARER.startsWith('PLACEHOLDER'),
  time: new Date().toISOString(),
}));

function classifyTweetKind(referenced) {
  if (!Array.isArray(referenced) || referenced.length === 0) return 'original';
  // X 的 type: retweeted / quoted / replied_to
  const t = referenced[0]?.type;
  if (t === 'retweeted') return 'retweet';
  if (t === 'quoted')    return 'quote';
  if (t === 'replied_to') return 'reply';
  return 'original';
}

// 拉某个 @handle 近 N 小时推文
app.post('/api/twitter/handle/:handle/recent', async (req, reply) => {
  const raw = String(req.params.handle || '').replace(/^@/, '').trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(raw)) {
    return reply.code(400).send({ ok: false, error: 'invalid handle' });
  }
  const hours = Math.min(Math.max(Number(req.body?.hours || 168), 1), 720); // 1h ~ 30d, default 168 = 7d
  const startTime = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  let client;
  try { client = getClient(); }
  catch (e) { return reply.code(503).send({ ok: false, error: e.message }); }

  try {
    // 1. handle → user_id
    const user = await client.v2.userByUsername(raw, { 'user.fields': ['username', 'name', 'public_metrics'] });
    if (!user?.data) return reply.code(404).send({ ok: false, error: 'X user not found' });
    const u = user.data;

    // 2. 拉时间线 (max 100, start_time = 7 天前)
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
        views: t.public_metrics?.impression_count ?? null,
        likes: t.public_metrics?.like_count ?? 0,
        retweets: t.public_metrics?.retweet_count ?? 0,
        replies: t.public_metrics?.reply_count ?? 0,
        quotes: t.public_metrics?.quote_count ?? 0,
        bookmarks: t.public_metrics?.bookmark_count ?? 0,
      },
    }));

    // rate limit 透传给前端
    const meta = tl._rateLimit || {};
    reply.header('x-x-rate-remaining', meta.remaining ?? '');
    reply.header('x-x-rate-reset', meta.reset ?? '');

    return {
      ok: true,
      handle: '@' + u.username,
      user: { id: u.id, username: u.username, name: u.name },
      window: { hours, start_time: startTime, end_time: new Date().toISOString() },
      pulled: tweets.length,
      tweets,
      rate_limit: { remaining: meta.remaining, reset: meta.reset, limit: meta.limit },
    };
  } catch (err) {
    if (err instanceof ApiResponseError) {
      const code = err.code || 500;
      return reply.code(code === 429 ? 429 : code === 401 ? 401 : 502).send({
        ok: false,
        error: err.data?.detail || err.message || 'twitter api error',
        twitterCode: code,
      });
    }
    req.log.error(err);
    return reply.code(500).send({ ok: false, error: err.message || 'internal' });
  }
});

app.post('/api/twitter/tweet', async (req, reply) => {
  const body = req.body || {};
  const id = extractTweetId(body.url || body.id);
  if (!id) {
    return reply.code(400).send({ ok: false, error: 'invalid tweet URL or id' });
  }

  let client;
  try {
    client = getClient();
  } catch (e) {
    return reply.code(503).send({ ok: false, error: e.message });
  }

  try {
    const { data: t, includes } = await client.v2.singleTweet(id, {
      'tweet.fields': ['public_metrics', 'created_at', 'author_id', 'text'],
      expansions: ['author_id'],
      'user.fields': ['username', 'name'],
    });
    if (!t) return reply.code(404).send({ ok: false, error: 'tweet not found' });

    const author = includes?.users?.[0];
    const m = t.public_metrics || {};
    return {
      ok: true,
      tweet: {
        id: t.id,
        url: author ? `https://x.com/${author.username}/status/${t.id}` : `https://x.com/i/status/${t.id}`,
        text: t.text,
        author: author ? { username: author.username, name: author.name } : null,
        created_at: t.created_at,
        metrics: {
          views: m.impression_count ?? null,
          likes: m.like_count ?? 0,
          retweets: m.retweet_count ?? 0,
          replies: m.reply_count ?? 0,
          quotes: m.quote_count ?? 0,
          bookmarks: m.bookmark_count ?? 0,
        },
      },
    };
  } catch (err) {
    if (err instanceof ApiResponseError) {
      const code = err.code || 500;
      return reply.code(code === 429 ? 429 : code === 401 ? 401 : 502).send({
        ok: false,
        error: err.data?.detail || err.message || 'twitter api error',
        twitterCode: code,
      });
    }
    req.log.error(err);
    return reply.code(500).send({ ok: false, error: err.message || 'internal' });
  }
});

app.listen({ port: PORT, host: HOST })
  .then(() => app.log.info(`pallax-api listening on ${HOST}:${PORT}, hasToken=${Boolean(BEARER) && !BEARER.startsWith('PLACEHOLDER')}`));
