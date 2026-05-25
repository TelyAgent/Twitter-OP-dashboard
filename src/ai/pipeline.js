// src/ai/pipeline.js — AI analysis pipeline (scoring, classification, intel, templates).
// Load via <script src="src/ai/pipeline.js">, exposes window.AIPipeline.
// Depends on window.AIClient (loaded from src/ai/client.js).

(function () {
  const { chat, embed, cosineSimilarity } = window.AIClient || {};

  // ─── Prompt builders ──────────────────────────────────────

  function scoringPrompt(tweets) {
    var block = tweets.map(function (t, i) {
      var m = t.metrics || {};
      return '[' + i + '] views=' + (m.views || 0) + ' likes=' + (m.likes || 0) +
        ' rt=' + (m.retweets || 0) + ' replies=' + (m.replies || 0) +
        '\n"' + (t.text || '').slice(0, 300) + '"';
    }).join('\n\n');

    return {
      system: '你是预测市场内容分析器。对一批推文 cluster 做三维评分 (0-1)。\n\n' +
        '评分维度:\n' +
        '- fit (0.3): 与预测市场/Polymarket/Kalshi/赔率/链上/宏观事件的关联密度\n' +
        '- viral (0.4): 互动量(like+rt+reply)/views 比值\n' +
        '- fresh (0.3): 时效性，越新越高，72h 半衰\n\n' +
        'HOT: score>=0.35 且 (total_views>=10000 或 total_engagement>=200)\n\n' +
        '输出 JSON: {"score":0,"fit":0,"viral":0,"fresh":0,"isHot":false,"hot_reason":""}',
      user: block,
    };
  }

  function batchClassifyPrompt(tweets) {
    var items = tweets.map(function (t, i) {
      return '[' + i + '] ' + (t.text || '').slice(0, 200);
    }).join('\n---\n');
    return {
      system: '将推文归入 7 类: 反直觉/数据驱动/案例/KOL 蹭点/深度/教程/Thread。输出 JSON 数组: [{"index":0,"angle":"数据驱动"},...]',
      user: items,
    };
  }

  function intelPrompt(clusterTitle, tweets) {
    var block = tweets.map(function (t, i) {
      return '推文 ' + (i + 1) + ' (@' + ((t.author && t.author.username) || '?') +
        ', views=' + ((t.metrics && t.metrics.views) || 0) + '):\n' + (t.text || '').slice(0, 500);
    }).join('\n\n---\n\n');
    return {
      system: '你是预测市场情报分析师。对热点 cluster 做深度分析。\n\n' +
        '输出 JSON: {"summary":"","facts":[],"opportunity":"","dissent":{"handle":"","stance":"","detail":""},"timeline":[{"time":"","event":""}]}',
      user: '热点: ' + clusterTitle + '\n\n' + block,
    };
  }

  function extractTemplatePrompt(tweets) {
    var items = tweets.map(function (t, i) {
      return '[' + i + '] @' + ((t.author && t.author.username) || '?') +
        ' · ' + ((t.metrics && t.metrics.views) || 0) + ' views\n' + (t.text || '').slice(0, 400);
    }).join('\n\n---\n\n');
    return {
      system: '从爆款推文中提炼可复用模板骨架。规则:\n' +
        '- 具体合约名/人名/数字/金额/链接 → {slot} 槽位\n' +
        '- 保留句式结构\n' +
        '- 槽位中文命名: {合约名} {金额} {比例} {时间窗} {起赔率} {终赔率} {账号}\n\n' +
        '输出 JSON: {"templates":[{"skeleton":"...","slots":["合约名","时间窗"]}]}',
      user: items,
    };
  }

  function fillTemplatePrompt(skeleton, slots, material, angle, category) {
    return {
      system: '你是预测市场内容写手。根据模板骨架+素材，填入具体内容生成一条推文。\n' +
        '角度: ' + (angle || '数据驱动') + '\n类别: ' + (category || '通用') + '\n' +
        '规则: 保持骨架句式、用素材中的事实替换槽位、中文为主、200字内。\n\n输出 JSON: {"text":""}',
      user: '骨架:\n' + skeleton + '\n\n槽位: ' + (slots || []).join(', ') + '\n\n素材:\n' + material,
    };
  }

  // ─── Pipeline functions ───────────────────────────────────

  async function scoreCluster(tweets) {
    var p = scoringPrompt(tweets);
    try {
      return await chat([
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ]);
    } catch (e) {
      console.warn('[pipeline] scoring failed:', e.message);
      return { score: 0, fit: 0, viral: 0, fresh: 0, isHot: false, hot_reason: 'error' };
    }
  }

  async function classifyBatch(tweets) {
    var p = batchClassifyPrompt(tweets);
    try {
      var result = await chat([
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ]);
      return Array.isArray(result) ? result : (result.classifications || []);
    } catch (e) {
      console.warn('[pipeline] classify failed:', e.message);
      return tweets.map(function (_, i) { return { index: i, angle: 'Other' }; });
    }
  }

  async function generateIntel(clusterTitle, tweets) {
    var p = intelPrompt(clusterTitle, tweets);
    try {
      return await chat([
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ]);
    } catch (e) {
      console.warn('[pipeline] intel failed:', e.message);
      return { summary: '', facts: [], opportunity: '', dissent: null, timeline: [] };
    }
  }

  async function extractTemplates(tweets) {
    var p = extractTemplatePrompt(tweets);
    try {
      var result = await chat([
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ]);
      return result.templates || [];
    } catch (e) {
      console.warn('[pipeline] extract templates failed:', e.message);
      return [];
    }
  }

  async function fillTemplate(skeleton, slots, material, angle, category) {
    var p = fillTemplatePrompt(skeleton, slots, material, angle, category);
    try {
      var result = await chat([
        { role: 'system', content: p.system },
        { role: 'user', content: p.user },
      ]);
      return result.text || '';
    } catch (e) {
      console.warn('[pipeline] fill template failed:', e.message);
      return '';
    }
  }

  // ─── Full pipeline: tweets → scored + classified clusters ──

  function groupBySimilarity(embeddings, threshold) {
    threshold = threshold || 0.75;
    var groups = [];
    var used = {};
    for (var i = 0; i < embeddings.length; i++) {
      if (used[i]) continue;
      var group = [i];
      used[i] = true;
      for (var j = i + 1; j < embeddings.length; j++) {
        if (used[j]) continue;
        if (cosineSimilarity(embeddings[i].embedding, embeddings[j].embedding) >= threshold) {
          group.push(j);
          used[j] = true;
        }
      }
      groups.push(group);
    }
    return groups;
  }

  async function runPipeline(tweets) {
    if (!tweets || tweets.length === 0) return [];

    var texts = tweets.map(function (t) { return t.text || ''; });
    var embeddingResults;
    try {
      embeddingResults = await embed(texts);
    } catch (e) {
      console.warn('[pipeline] embedding failed, treating each tweet as own cluster');
      var results = [];
      for (var i = 0; i < tweets.length; i++) {
        results.push({ tweets: [tweets[i]], score: 0, fit: 0, viral: 0, fresh: 0, isHot: false, angle: 'Other' });
      }
      return results;
    }

    var groups = groupBySimilarity(embeddingResults);

    var results = [];
    for (var g = 0; g < groups.length; g++) {
      var indices = groups[g];
      var clusterTweets = indices.map(function (idx) { return tweets[idx]; });
      var headTweet = clusterTweets[0];

      var classifyP = batchClassifyPrompt([headTweet]);
      var scoreP = scoringPrompt(clusterTweets);

      var scoreResult, classifyResult;
      try {
        var pResults = await Promise.all([
          chat([{ role: 'system', content: scoreP.system }, { role: 'user', content: scoreP.user }]),
          chat([{ role: 'system', content: classifyP.system }, { role: 'user', content: classifyP.user }]),
        ]);
        scoreResult = pResults[0];
        classifyResult = pResults[1];
      } catch (e) {
        scoreResult = { score: 0, fit: 0, viral: 0, fresh: 0, isHot: false };
        classifyResult = [{ index: 0, angle: 'Other' }];
      }

      var angle = 'Other';
      if (Array.isArray(classifyResult) && classifyResult.length > 0) angle = classifyResult[0].angle;
      else if (classifyResult.angle) angle = classifyResult.angle;

      results.push({
        tweets: clusterTweets,
        score: scoreResult.score || 0,
        fit: scoreResult.fit || 0,
        viral: scoreResult.viral || 0,
        fresh: scoreResult.fresh || 0,
        isHot: scoreResult.isHot || false,
        angle: angle,
      });
    }

    return results;
  }

  window.AIPipeline = {
    scoreCluster: scoreCluster,
    classifyBatch: classifyBatch,
    generateIntel: generateIntel,
    extractTemplates: extractTemplates,
    fillTemplate: fillTemplate,
    runPipeline: runPipeline,
  };
})();
