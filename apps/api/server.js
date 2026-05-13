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
  if (/^\d{10,25}$/.test(s)) return s;
  const m = s.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d{10,25})/i);
  return m ? m[1] : null;
}

app.get('/api/health', async () => ({
  ok: true,
  hasToken: Boolean(BEARER) && !BEARER.startsWith('PLACEHOLDER'),
  time: new Date().toISOString(),
}));

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
