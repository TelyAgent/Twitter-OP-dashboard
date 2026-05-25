// src/ai/pipeline.js
// Orchestration: batch score → classify → cluster → intel.
// All analysis calls go through DeepSeek API.

import { chat, embed, cosineSimilarity } from './client.js';
import {
  scoringPrompt,
  batchClassifyPrompt,
  intelPrompt,
  extractTemplatePrompt,
  fillTemplatePrompt,
} from './prompts.js';

// ─── Cluster tweets by embedding similarity ──────────────────────
// Returns grouped arrays of tweet indices
function groupBySimilarity(embeddings, threshold = 0.75) {
  const groups = [];
  const used = new Set();

  for (let i = 0; i < embeddings.length; i++) {
    if (used.has(i)) continue;
    const group = [i];
    used.add(i);
    for (let j = i + 1; j < embeddings.length; j++) {
      if (used.has(j)) continue;
      if (cosineSimilarity(embeddings[i].embedding, embeddings[j].embedding) >= threshold) {
        group.push(j);
        used.add(j);
      }
    }
    groups.push(group);
  }
  return groups;
}

// ─── Batch score a tweet cluster ─────────────────────────────────
async function scoreCluster(tweets) {
  const { system, user } = scoringPrompt(tweets);
  try {
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return result;
  } catch (e) {
    console.warn('[pipeline] scoring failed, using fallback:', e.message);
    return { score: 0, fit: 0, viral: 0, fresh: 0, isHot: false, hot_reason: 'scoring error' };
  }
}

// ─── Batch classify tweets ───────────────────────────────────────
async function classifyBatch(tweets) {
  const { system, user } = batchClassifyPrompt(tweets);
  try {
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return Array.isArray(result) ? result : (result.classifications || []);
  } catch (e) {
    console.warn('[pipeline] classification failed:', e.message);
    return tweets.map((_, i) => ({ index: i, angle: 'Other' }));
  }
}

// ─── Generate intel for a HOT cluster ────────────────────────────
async function generateIntel(clusterTitle, tweets) {
  const { system, user } = intelPrompt(clusterTitle, tweets);
  try {
    return await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
  } catch (e) {
    console.warn('[pipeline] intel generation failed:', e.message);
    return { summary: '', facts: [], opportunity: '', dissent: null, timeline: [] };
  }
}

// ─── Extract templates from viral tweets ─────────────────────────
async function extractTemplates(tweets) {
  const { system, user } = extractTemplatePrompt(tweets);
  try {
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return result.templates || [];
  } catch (e) {
    console.warn('[pipeline] template extraction failed:', e.message);
    return [];
  }
}

// ─── Fill a template ─────────────────────────────────────────────
async function fillTemplate(skeleton, slots, material, angle, category) {
  const { system, user } = fillTemplatePrompt(skeleton, slots, material, angle, category);
  try {
    const result = await chat([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    return result.text || '';
  } catch (e) {
    console.warn('[pipeline] template fill failed:', e.message);
    return '';
  }
}

// ─── Full pipeline: tweets → scored + classified clusters ────────
async function runPipeline(tweets) {
  if (!tweets || tweets.length === 0) return [];

  // 1. Embedding + clustering
  const texts = tweets.map(t => t.text || '');
  let embeddings;
  try {
    embeddings = await embed(texts);
  } catch {
    // Embedding failed — treat each tweet as its own cluster
    return tweets.map((t, i) => ({
      index: i,
      tweets: [t],
      score: 0,
      isHot: false,
      angle: 'Other',
    }));
  }

  const groups = groupBySimilarity(embeddings);

  // 2. For each group: score + classify head tweet
  const results = [];
  for (const indices of groups) {
    const clusterTweets = indices.map(i => tweets[i]);
    const headTweet = clusterTweets[0];

    const [scoreResult, classifyResult] = await Promise.all([
      scoreCluster(clusterTweets),
      chat([
        { role: 'system', content: batchClassifyPrompt([headTweet]).system },
        { role: 'user', content: batchClassifyPrompt([headTweet]).user },
      ]).catch(() => ({ angle: 'Other' })),
    ]);

    results.push({
      tweets: clusterTweets,
      ...scoreResult,
      angle: classifyResult.angle || (Array.isArray(classifyResult) ? classifyResult[0]?.angle : 'Other'),
    });
  }

  return results;
}

export {
  runPipeline,
  scoreCluster,
  classifyBatch,
  generateIntel,
  extractTemplates,
  fillTemplate,
};
