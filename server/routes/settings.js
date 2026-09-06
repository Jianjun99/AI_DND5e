const express = require('express');
const store = require('../store');
const llm = require('../llm/client');

const router = express.Router();

const PRESETS = {
  ollama: { label: 'Ollama', baseUrl: 'http://host.docker.internal:11434/v1', model: 'llama3.1:8b', note: 'Run Ollama on your computer; pull a model first (e.g. `ollama pull llama3.1:8b`).' },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://host.docker.internal:1234/v1', model: 'local-model', note: 'In LM Studio, start the local server (Developer tab).' },
  llama_cpp: { label: 'llama.cpp server', baseUrl: 'http://host.docker.internal:8080/v1', model: 'local-model', note: 'Start llama-server with --host 0.0.0.0.' },
  custom: { label: 'Custom OpenAI-compatible', baseUrl: '', model: '', note: 'Any server exposing /v1/chat/completions.' }
};

router.get('/', (req, res) => {
  res.json({ settings: store.getSettings(), presets: PRESETS });
});

router.put('/', (req, res) => {
  const next = req.body || {};
  if (next.llm) {
    if (next.llm.temperature !== undefined) next.llm.temperature = Math.max(0, Math.min(2, +next.llm.temperature || 0));
    if (next.llm.maxTokens !== undefined) next.llm.maxTokens = Math.max(20, Math.min(2000, +next.llm.maxTokens || 300));
    if (next.llm.timeoutMs !== undefined) next.llm.timeoutMs = Math.max(3000, Math.min(60000, +next.llm.timeoutMs || 25000));
  }
  res.json({ settings: store.saveSettings(next) });
});

router.post('/test', async (req, res) => {
  // test with the submitted values regardless of the enabled checkbox
  const cfg = Object.assign({}, req.body && req.body.llm ? req.body.llm : store.getSettings().llm, { enabled: true });
  try {
    const result = await llm.testConnection(cfg);
    res.json(result);
  } catch (e) {
    res.json({ ok: false, error: e.message, models: [] });
  }
});

module.exports = router;
