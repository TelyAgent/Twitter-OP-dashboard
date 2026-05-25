import { TwitterApi, ApiResponseError } from 'twitter-api-v2';

const BEARER = process.env.TWITTER_BEARER_TOKEN || '';

let xClient = null;
export function getClient() {
  if (!BEARER || BEARER.startsWith('PLACEHOLDER')) {
    throw new Error('TWITTER_BEARER_TOKEN not configured');
  }
  if (!xClient) xClient = new TwitterApi(BEARER).readOnly;
  return xClient;
}

export function hasToken() {
  return Boolean(BEARER) && !BEARER.startsWith('PLACEHOLDER');
}

export function extractTweetId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^\d{1,25}$/.test(s)) return s;
  const m = s.match(/(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d{1,25})/i);
  return m ? m[1] : null;
}

export function classifyTweetKind(referenced) {
  if (!Array.isArray(referenced) || referenced.length === 0) return 'original';
  const t = referenced[0]?.type;
  if (t === 'retweeted')  return 'retweet';
  if (t === 'quoted')     return 'quote';
  if (t === 'replied_to') return 'reply';
  return 'original';
}

export function sendTwitterError(res, err, fallback = 502) {
  if (err instanceof ApiResponseError) {
    const code = err.code || 500;
    const status = code === 429 ? 429 : code === 401 ? 401 : code === 404 ? 404 : fallback;
    res.status(status).json({
      ok: false,
      error: err.data?.detail || err.message || 'twitter api error',
      twitterCode: code,
    });
    return;
  }
  res.status(500).json({ ok: false, error: err?.message || 'internal' });
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}
