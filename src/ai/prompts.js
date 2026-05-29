// src/ai/prompts.js
// All prompt templates for DeepSeek API calls.
// Each export is a function that returns { system, user } messages.

// ─── Hotspot Scoring ────────────────────────────────────────────
export function scoringPrompt(tweets) {
  const tweetsBlock = tweets.map((t, i) =>
    `[${i}] views=${t.metrics?.views ?? 0} likes=${t.metrics?.likes ?? 0} rt=${t.metrics?.retweets ?? 0} replies=${t.metrics?.replies ?? 0}\n"${(t.text || '').slice(0, 300)}"`
  ).join('\n\n');

  return {
    system: `你是 Telegram Agent 生态内容分析器。对一批推文 cluster 做三维评分 (0-1)。

评分维度:
- fit (0.3 权重): 与 Telegram/Agent 产品/Agent 技术/AI 市场动态的关联密度
- viral (0.4 权重): 互动量(like+rt+reply) / views 比值，views 越高 viral 基线越低
- fresh (0.3 权重): 时效性，越新越高，72h 半衰

HOT 判定: score >= 0.35 且 (total_views >= 10000 或 total_engagement >= 200)

输出严格 JSON:
{
  "score": 0.0,
  "fit": 0.0,
  "viral": 0.0,
  "fresh": 0.0,
  "isHot": false,
  "hot_reason": ""
}`,
    user: tweetsBlock,
  };
}

// ─── Angle Classification ───────────────────────────────────────
export function classifyPrompt(tweet) {
  return {
    system: `将推文归入以下 7 类之一:

- 反直觉: 挑衅性开头(destroyed/killed/nobody knows/reality is)、全大写词、挑战共识
- 数据驱动: 含 %、n=x、回测、ROI、胜率等量化数据
- 案例: 某人赚了$X、翻了X倍、利润$X 等具体案例
- KOL 蹭点: 引用/转发/回复他人，含 2+ @提及
- 深度: 长原文(>200字)，非转发，深度分析
- 教程: step-by-step、guide、tutorial、how to
- Thread: 🧵 或 1/ 标记

输出 JSON: { "angle": "数据驱动" }`,
    user: (tweet.text || '').slice(0, 500),
  };
}

// ─── Semantic Clustering (batch classify) ───────────────────────
export function batchClassifyPrompt(tweets) {
  const items = tweets.map((t, i) =>
    `[${i}] ${(t.text || '').slice(0, 200)}`
  ).join('\n---\n');

  return {
    system: `将以下推文分别归入 7 类之一: 反直觉 / 数据驱动 / 案例 / KOL 蹭点 / 深度 / 教程 / Thread。
输出 JSON 数组: [{ "index": 0, "angle": "数据驱动" }, ...]`,
    user: items,
  };
}

// ─── Intel Generation (HOT only) ─────────────────────────────────
export function intelPrompt(clusterTitle, tweets) {
  const tweetsBlock = tweets.map((t, i) =>
    `推文 ${i + 1} (@${t.author?.username || '?'}, views=${t.metrics?.views ?? 0}, likes=${t.metrics?.likes ?? 0}):\n${(t.text || '').slice(0, 500)}`
  ).join('\n\n---\n\n');

  return {
    system: `你是 Telegram Agent 行业分析师。对以下热点 cluster 做深度分析，生成:

1. summary (2-3 句中文摘要，说清"发生了什么 + 为什么对 Agent 生态重要")
2. facts (3-5 个关键事实，每个一句话，含关键数字)
3. opportunity (为什么这是推广 Telegram Agent 工具的内容机会或传播切入点，60 字以内)
4. dissent (如果推文中有分歧观点，提取反方 handle + 立场)
5. timeline (按时间排的事件线，最多 8 条)

输出严格 JSON:
{
  "summary": "",
  "facts": ["", "", ""],
  "opportunity": "",
  "dissent": { "handle": "", "stance": "", "detail": "" },
  "timeline": [{ "time": "", "event": "" }]
}`,
    user: `热点: ${clusterTitle}\n\n${tweetsBlock}`,
  };
}

// ─── Template Extraction ────────────────────────────────────────
export function extractTemplatePrompt(tweets) {
  const items = tweets.map((t, i) =>
    `[${i}] @${t.author?.username || '?'} · ${t.metrics?.views ?? 0} views\n${(t.text || '').slice(0, 400)}`
  ).join('\n\n---\n\n');

  return {
    system: `从以下爆款推文中提炼可复用的模板骨架。

规则:
- 将具体的产品名/人名/数字/金额/链接替换为 {slot} 槽位
- 保留推文结构和句式节奏
- 槽位用中文命名: {产品名} {指标} {增长率} {时间窗} {竞品} {版本号} {账号} {链接} {数据} 等
- 每个模板输出 skeleton (含 {slot} 的文本) 和 slots (槽位名列表)

输出 JSON:
{
  "templates": [
    { "skeleton": "...{产品名} 在 {时间窗} 内 {指标} 从 {数据} 增长到 {数据}...", "slots": ["产品名", "时间窗", "指标", "数据"] }
  ]
}`,
    user: items,
  };
}

// ─── Template Filling ───────────────────────────────────────────
export function fillTemplatePrompt(skeleton, slots, material, angle, category) {
  return {
    system: `你是 Telegram Agent 产品内容写手。目标是为 Agent 工具做推广传播。根据模板骨架 + 素材，填入具体内容生成一条推文。

角度: ${angle || '数据驱动'}
类别: ${category || '通用'}

规则:
- 保持骨架的句式结构
- 用素材中的具体数字/事实替换槽位
- 结果应是一条可独立发布的推文 (中文为主，关键术语可保留英文)
- 200 字以内

输出 JSON: { "text": "" }`,
    user: `骨架:\n${skeleton}\n\n槽位: ${slots.join(', ')}\n\n素材:\n${material}`,
  };
}
