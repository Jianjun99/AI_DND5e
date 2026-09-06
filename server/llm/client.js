// llm/client.js — minimal OpenAI-compatible chat client (works with Ollama, LM Studio, llama.cpp, vLLM...).
// All requests are made server-side, so browser CORS is never an issue.
const store = require('../store');

function normalizeBase(baseUrl) {
  let u = String(baseUrl || '').trim().replace(/\/+$/, '');
  return u;
}

async function chatOnce(url, model, messages, cfg) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(60000, cfg.timeoutMs || 25000));
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: cfg.temperature ?? 0.8,
        max_tokens: cfg.maxTokens ?? 300,
        stream: false
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    let text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    // reasoning models may spend the whole budget thinking; fall back to whatever they produced
    if (!text && data.choices && data.choices[0] && data.choices[0].message) {
      const m = data.choices[0].message;
      text = m.reasoning_content || m.reasoning || '';
    }
    if (!text) throw new Error('LLM returned empty response');
    // strip reasoning blocks some models inline in the content (gemma: <thought>, others: <think>)
    return String(text).replace(/<(think|thought)>[\s\S]*?<\/\1>/g, '').trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function chat(messages, overrides = {}) {
  const cfg = overrides.config || store.getSettings().llm;
  if (!cfg.enabled) throw new Error('LLM disabled');
  const base = normalizeBase(cfg.baseUrl);
  const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
  // Google's OpenAI-compat layer lists models as "models/gemini-..." — accept either form
  const model = String(cfg.model || '').replace(/^models\//, '');
  try {
    return await chatOnce(url, model, messages, cfg);
  } catch (e) {
    // free-tier cloud models occasionally return 429/5xx — one quick retry smooths it over
    if (e.status && [429, 500, 502, 503].includes(e.status)) {
      await new Promise(r => setTimeout(r, 2000));
      return await chatOnce(url, model, messages, cfg);
    }
    throw e;
  }
}

async function testConnection(cfg) {
  const base = normalizeBase(cfg.baseUrl);
  const out = { ok: false, models: [], error: null, sample: null };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const headers = {};
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const res = await fetch(base + '/models', { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      out.models = (data.data || []).map(m => String(m.id || '').replace(/^models\//, '')).slice(0, 40);
    }
  } catch (e) {
    out.error = 'Could not list models: ' + e.message;
  }
  try {
    const sample = await chat(
      [{ role: 'user', content: 'Reply with exactly: READY' }],
      { config: { ...cfg, maxTokens: 400, temperature: 0.1 } }
    );
    out.sample = sample;
    out.ok = /ready/i.test(sample);
  } catch (e) {
    out.ok = false;
    out.error = (out.error ? out.error + ' | ' : '') + e.message;
  }
  return out;
}

module.exports = { chat, testConnection, normalizeBase };
