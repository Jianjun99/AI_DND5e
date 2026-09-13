// settings.js — LLM (AI DM) configuration
import { api } from '../api.js';
import { tts } from '../tts.js';
import { esc, toast } from '../app.js';

export async function settingsView(main) {
  const { settings, presets, personas = {} } = await api.getSettings();
  const llm = settings.llm;
  const currentPersona = llm.persona || 'classic';

  main.innerHTML = `
    <h1>Dungeon Master Settings</h1>
    <p class="sub">Connect a local LLM to give the game a living DM voice: vivid narration of every scene, and NPCs
    you can actually talk to. The game engine always decides the mechanics — the LLM only narrates them, so the game
    stays fair (and fully playable with the AI turned off).</p>
    <div class="grid cols2">
      <div>
        <div class="card">
          <h3>AI Dungeon Master</h3>
          <div class="field">
            <label><input type="checkbox" id="llmEnabled" ${llm.enabled ? 'checked' : ''} style="width:auto"> Enable the AI DM</label>
          </div>
          <div class="field">
            <label>Server preset</label>
            <select id="preset">
              ${Object.entries(presets).map(([id, p]) => `<option value="${id}" ${llm.preset === id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
            <div class="preset-note" id="presetNote"></div>
          </div>
          <div class="field">
            <label>API base URL (OpenAI-compatible)</label>
            <input type="text" id="baseUrl" value="${esc(llm.baseUrl)}" placeholder="http://host.docker.internal:11434/v1">
          </div>
          <div class="field">
            <label>Model name</label>
            <input type="text" id="model" value="${esc(llm.model)}" placeholder="llama3.1:8b">
          </div>
          <div class="field">
            <label>API key (optional — most local servers don't need one)</label>
            <input type="password" id="apiKey" value="${esc(llm.apiKey || '')}" placeholder="leave empty">
          </div>
          <div class="grid" style="grid-template-columns: 1fr 1fr 1fr;">
            <div class="field">
              <label>Creativity (temp)</label>
              <input type="number" id="temperature" value="${llm.temperature}" min="0" max="2" step="0.1">
            </div>
            <div class="field">
              <label>Max tokens</label>
              <input type="number" id="maxTokens" value="${llm.maxTokens}" min="20" max="2000" step="10">
            </div>
            <div class="field">
              <label>Timeout (ms)</label>
              <input type="number" id="timeoutMs" value="${llm.timeoutMs}" min="3000" max="60000" step="1000">
            </div>
          </div>
          <div style="display:flex; gap:10px; margin-top:8px;">
            <button class="btn primary" id="saveBtn">Save Settings</button>
            <button class="btn" id="testBtn">Test Connection</button>
          </div>
          <div id="testResult"></div>
        </div>

        <div class="card" style="margin-top:12px;">
          <h3 style="margin-top:0;">🎭 AI DM Persona Presets</h3>
          <p class="small muted" style="margin-bottom:10px;">Select your AI Dungeon Master's narrative style. The engine always guarantees 100% fair and rules-accurate D&D 2024 outcomes — the persona styles the prose and dialogue atmosphere.</p>
          <div class="persona-grid" style="display:grid; gap:8px;">
            ${Object.entries(personas).map(([id, p]) => `
              <label class="persona-card" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; background:var(--bg); border:1.5px solid ${currentPersona === id ? 'var(--gold)' : 'var(--border)'}; border-radius:6px; cursor:pointer;">
                <input type="radio" name="dmPersona" value="${id}" ${currentPersona === id ? 'checked' : ''} style="margin-top:4px; width:auto;">
                <div style="flex:1;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:17px;">${p.icon || '🎲'}</span>
                    <b style="color:var(--text);">${esc(p.name)}</b>
                    <span class="chip blue" style="font-size:10px; padding:1px 5px;">${esc(p.tagline || '')}</span>
                  </div>
                  <div class="small muted" style="margin-top:3px; line-height:1.35;">${esc(p.blurb)}</div>
                </div>
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <h3>🖼 Creature Portraits</h3>
          <p class="small muted" style="margin-bottom:8px;">When you meet a creature, the game paints its portrait (AI image, cached per creature type — a crypt has ~10 faces, generated once ever).</p>
          <div class="field">
            <label><input type="checkbox" id="portraitsEnabled" ${settings.portraits && settings.portraits.enabled !== false ? 'checked' : ''} style="width:auto"> Enable portrait generation</label>
          </div>
          <div class="field">
            <label>Portrait provider chain: your Google key → optional local SD WebUI → procedural sigil (always works)</label>
            <input type="text" id="sdUrl" value="${esc((settings.portraits || {}).sdUrl || '')}" placeholder="http://host.docker.internal:7860 (optional Stable Diffusion URL)">
          </div>
          <p class="small muted">Google's free image quota is small — limited portraits may fall back to the procedural sigil and retry the next time you meet that creature.</p>
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>🗣 AI DM Voice-over</h3>
          <p class="small muted" style="margin-bottom:8px;">Let the DM speak its narration aloud. Toggle the 🗣 button inside a delve. Default voice is your browser's built-in speech — for a natural neural voice, run a Piper HTTP server locally and point this at it.</p>
          <div class="field">
            <label>Piper HTTP server URL (optional)</label>
            <input type="text" id="piperUrl" placeholder="http://localhost:5000/api/tts" value="">
          </div>
          <p class="small muted">Example: <code>docker run -p 5000:5000 fedirz/piper-http-server -m en_US-lessac-medium</code> — then paste the URL and toggle 🗣 in a delve.</p>
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>How to connect your local model</h3
        <p class="small muted" style="margin-bottom:10px;">The game talks to your LLM from the server side, so there are no
        CORS problems. When running in Docker, use <code>host.docker.internal</code> to reach servers on your own computer.</p>
        <h2 style="font-size:15px;">Ollama</h2>
        <p class="small muted">1. Install and start Ollama. 2. Pull a model: <code>ollama pull llama3.1:8b</code><br>
        3. Base URL: <code>http://host.docker.internal:11434/v1</code> (or <code>http://localhost:11434/v1</code> when running outside Docker)</p>
        <h2 style="font-size:15px;">LM Studio</h2>
        <p class="small muted">Start the server in the Developer tab, then use <code>http://host.docker.internal:1234/v1</code>.</p>
        <h2 style="font-size:15px;">Notes</h2>
        <p class="small muted">Small models (7–8B) work well for narration. Higher temperature = more colorful DM voice.
        If narration ever feels slow, lower the timeout for faster fallback to the built-in text.</p>
      </div>
    </div>
  `;

  const $ = id => document.getElementById(id);
  const presetNote = () => {
    const p = presets[$('preset').value];
    $('presetNote').textContent = p ? p.note : '';
  };
  presetNote();
  $('preset').addEventListener('change', () => {
    presetNote();
    const p = presets[$('preset').value];
    if (p && p.baseUrl) { $('baseUrl').value = p.baseUrl; $('model').value = p.model || ''; }
  });

  const piperInput = document.getElementById('piperUrl');
  if (piperInput) {
    piperInput.value = tts.getPiper();
    piperInput.addEventListener('change', () => { tts.setPiper(piperInput.value); toast('Voice-over server saved.'); });
  }

  document.querySelectorAll('input[name="dmPersona"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.persona-card').forEach(c => c.style.borderColor = 'var(--border)');
      const parent = radio.closest('.persona-card');
      if (parent) parent.style.borderColor = 'var(--gold)';
    });
  });

  const collect = () => {
    const personaPick = document.querySelector('input[name="dmPersona"]:checked');
    return {
      enabled: $('llmEnabled').checked,
      preset: $('preset').value,
      baseUrl: $('baseUrl').value.trim(),
      model: $('model').value.trim(),
      apiKey: $('apiKey').value,
      temperature: +$('temperature').value,
      maxTokens: +$('maxTokens').value,
      timeoutMs: +$('timeoutMs').value,
      persona: personaPick ? personaPick.value : 'classic'
    };
  };

  const collectPortraits = () => ({
    enabled: $('portraitsEnabled').checked,
    sdUrl: $('sdUrl').value.trim()
  });

  $('saveBtn').addEventListener('click', async () => {
    await api.saveSettings({ llm: collect(), portraits: collectPortraits() });
    toast('Settings saved.');
  });

  $('testBtn').addEventListener('click', async () => {
    const out = $('testResult');
    out.innerHTML = '<span class="spinner"></span> Testing connection...';
    const result = await api.testLlm(collect());
    if (result.ok) {
      out.innerHTML = `<div class="test-result ok">✔ Connected! Model replied: "${esc(result.sample || '')}"
        ${result.models.length ? `<br>Models found: ${esc(result.models.join(', '))}` : ''}</div>`;
    } else {
      out.innerHTML = `<div class="test-result bad">✖ Could not reach the model.<br>${esc(result.error || 'Unknown error')}
        ${result.models.length ? `<br><span class="muted">Models found: ${esc(result.models.join(', '))} — is the model name correct?</span>` : ''}</div>`;
    }
  });
}
