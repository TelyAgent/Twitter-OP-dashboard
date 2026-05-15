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

// ====== AI 工具 ======
async function callLLM(prompt, maxTokens = 800) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const deepseekKey  = process.env.DEEPSEEK_API_KEY;
  if (!anthropicKey && !deepseekKey) {
    const err = new Error('AI key not configured. Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY in /root/pallax-api/.env then restart pallax-api.service');
    err.code = 503;
    throw err;
  }
  if (anthropicKey) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const json = await resp.json();
    if (!resp.ok) {
      const err = new Error(json.error?.message || 'anthropic error');
      err.code = 502;
      err.upstream = json;
      throw err;
    }
    return {
      text: (json.content || []).map(b => b.text || '').join('').trim(),
      model: json.model || 'claude',
    };
  }
  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${deepseekKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json.error?.message || 'deepseek error');
    err.code = 502;
    err.upstream = json;
    throw err;
  }
  return {
    text: json.choices?.[0]?.message?.content?.trim() || '',
    model: json.model || 'deepseek-chat',
  };
}

// ====== AI 提炼金模板 (从爆款推文里抽象出可复用骨架) ======
app.post('/api/ai/extract-template', async (req, reply) => {
  const { tweets, angle, category } = req.body || {};
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return reply.code(400).send({ ok: false, error: 'tweets array required' });
  }
  const sample = tweets.slice(0, 5).map((t, i) => `${i + 1}. ${(t.text || '').replace(/\s+/g, ' ').trim()}`).join('\n');

  const prompt = `你是 Twitter 营销文案的"金模板"提炼专家. 给你 ${tweets.length} 条爆款推文 (都属于角度: ${angle || '未指定'}, 分类: ${category || '未指定'}), 请抽象出对应数量的可复用金模板骨架.

抽象原则:
- 把具体实体 (产品名/平台名/项目名) 替换为类别占位, 例如 "Polymarket" → {预测市场平台}, "Claude" → {AI 产品}, "Hollywood" → {目标行业}
- 把具体数字/时间/金额/比例 替换为占位, 例如 "$2.4M" → {结果金额}, "2 Hours" → {时长}, "$300" → {起始金额}
- 把具体人名 / @handle 替换为 {KOL} / {用户}
- 保留原句式结构、语气、情绪转折
- 占位用中文方括号: {xxx}, 名字要表达"这一格放什么", 越具体越好 (不要写 {数据}, 写 {成交量} / {账号数} / {互动量})

举例:
原推: "Claude Bot on Polymarket - 2 Hours Full Guide. The same setup turned $300 into $2.4M."
骨架: "{AI 产品} on {预测市场平台} - {时长} {内容类型}. {同款配置} turned {起始金额} into {结果金额}."

原推: "FOMC 前夜赔率从 0.42 跳到 0.38, 38 min 内振幅 9.5%."
骨架: "{事件} 前夜赔率从 {起赔率} 跳到 {终赔率}, {时间窗口} 内振幅 {振幅比例}."

【${tweets.length} 条爆款推文】
${sample}

【输出要求】
输出**严格的 JSON 数组**, 每条对应一个推文, 顺序一致. 每个对象包含:
- "skeleton": 抽象后的模板骨架字符串
- "slots": ["xxx", "yyy", ...] 出现的所有占位符名字 (不带 {})

不要输出 markdown 代码块标记, 不要解释, 只输出可被 JSON.parse 的纯 JSON 数组.`;

  try {
    const out = await callLLM(prompt, 1500);
    // 尝试解析 JSON
    let parsed;
    try {
      // 容错: 剥掉 ```json ... ``` 包裹
      let raw = out.text.trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(raw);
    } catch (e) {
      return reply.code(502).send({ ok: false, error: 'LLM returned non-JSON', raw: out.text });
    }
    if (!Array.isArray(parsed)) {
      return reply.code(502).send({ ok: false, error: 'LLM returned non-array', raw: out.text });
    }
    // 校正: 给每个对象补齐 slots
    const templates = parsed.map(p => {
      const skel = String(p.skeleton || '');
      const slots = Array.isArray(p.slots) && p.slots.length > 0
        ? p.slots.map(String)
        : Array.from(new Set((skel.match(/\{([^}]+)\}/g) || []).map(m => m.slice(1, -1))));
      return { skeleton: skel, slots };
    });
    return { ok: true, model: out.model, templates };
  } catch (err) {
    return reply.code(err.code || 500).send({ ok: false, error: err.message, upstream: err.upstream });
  }
});

// ====== AI 套模板填充 ======
app.post('/api/ai/fill-template', async (req, reply) => {
  const { skeleton, slots, material, angle, category } = req.body || {};
  if (!skeleton || !material) return reply.code(400).send({ ok: false, error: 'skeleton + material required' });

  const slotsText = Array.isArray(slots) && slots.length > 0
    ? '骨架槽位: ' + slots.map(s => '{' + s + '}').join(' · ')
    : '骨架无显式槽位, 里面的具体名词/数据可被替换';

  const prompt = `你是 Polymarket / 预测市场 / 加密 Twitter 营销文案专家. 给你一个金模板骨架和原始素材, 请用素材里的具体信息填充骨架写一条可发布推文.

【模板骨架】
${skeleton}

【${slotsText}】

【角度】 ${angle || '未指定'}   【分类】 ${category || '未指定'}

【原始素材】
${material}

【输出要求】
1. 保持骨架的句式结构和叙事节奏
2. 用素材中的具体数字/名词/事件替换骨架里的 {占位} 或泛指词
3. 推文独立成立, 不要 "以下是" 之类前缀
4. 控制 280 字符以内
5. emoji 克制使用 (一两个)
6. 直接给最终推文, 不解释

【填充后的推文】:`;

  try {
    const out = await callLLM(prompt, 600);
    return { ok: true, text: out.text, model: out.model };
  } catch (err) {
    return reply.code(err.code || 500).send({ ok: false, error: err.message, upstream: err.upstream });
  }
});

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

// 拉一个 X List 的所有成员 (不限数量, 安全上限 2000)
app.post('/api/twitter/list/:listId/members', async (req, reply) => {
  const listId = String(req.params.listId || '').trim();
  if (!/^\d{1,25}$/.test(listId)) {
    return reply.code(400).send({ ok: false, error: 'invalid list id' });
  }
  let client;
  try { client = getClient(); }
  catch (e) { return reply.code(503).send({ ok: false, error: e.message }); }

  const HARD_CAP = 2000;
  try {
    const paginator = await client.v2.listMembers(listId, {
      max_results: 100,
      'user.fields': ['username', 'name', 'description', 'public_metrics'],
    });
    const members = [];
    for await (const u of paginator) {
      members.push({
        id: u.id,
        username: u.username,
        name: u.name,
        bio: u.description || null,
        followers: u.public_metrics?.followers_count ?? null,
      });
      if (members.length >= HARD_CAP) break;
    }
    return { ok: true, list_id: listId, count: members.length, members };
  } catch (err) {
    if (err instanceof ApiResponseError) {
      const code = err.code || 500;
      return reply.code(code === 429 ? 429 : code === 401 ? 401 : code === 404 ? 404 : 502).send({
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
