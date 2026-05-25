// src/ai/client.js — DeepSeek API client.
// Load via <script src="src/ai/client.js">, exposes window.AIClient.
// Reads DEEPSEEK_API_KEY + DEEPSEEK_BASE_URL from window.DEEPSEEK_CONFIG
// (injected by serve.js via /env.js).

(function () {
  const BASE_URL = (window.DEEPSEEK_CONFIG && window.DEEPSEEK_CONFIG.BASE_URL) || 'https://api.deepseek.com';
  const API_KEY = (window.DEEPSEEK_CONFIG && window.DEEPSEEK_CONFIG.API_KEY) || '';

  async function chat(messages, opts = {}) {
    if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not set — check .env');

    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: opts.model || 'deepseek-chat',
        messages,
        temperature: opts.temperature != null ? opts.temperature : 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`DeepSeek API ${res.status}: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    try { return JSON.parse(content); } catch { return { raw: content }; }
  }

  async function embed(texts) {
    if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not set — check .env');

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

  function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] ** 2;
      nb += b[i] ** 2;
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  window.AIClient = { chat, embed, cosineSimilarity };
})();
