// src/ai/client.js
// DeepSeek API client wrapper (chat + embedding).
// Reads config injected by serve.js via window.DEEPSEEK_CONFIG.

const DEEPSEEK_CONFIG = window.DEEPSEEK_CONFIG || {};
const BASE_URL = DEEPSEEK_CONFIG.BASE_URL || 'https://api.deepseek.com';
const API_KEY = DEEPSEEK_CONFIG.API_KEY || '';

async function chat(messages, { model = 'deepseek-chat', temperature = 0.3 } = {}) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not set');

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`DeepSeek API ${res.status}: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

async function embed(texts) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not set');

  const input = Array.isArray(texts) ? texts : [texts];

  const res = await fetch(`${BASE_URL}/v1/embeddings`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'deepseek-embedding', input }),
  });

  if (!res.ok) throw new Error(`Embedding API ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// Simple cosine similarity
function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export { chat, embed, cosineSimilarity };
