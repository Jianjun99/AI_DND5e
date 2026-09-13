// settings.js — Unified Settings Hub with Multi-Channel Audio Mixer, AI DM Personas, Voice (TTS), and Gameplay options.
import { api } from '../api.js';
import { tts } from '../tts.js';
import { sfx } from '../sfx.js';
import { esc, toast } from '../app.js';

let activeTab = 'audio';

export async function openSettingsModal(defaultTab = 'audio') {
  activeTab = defaultTab || 'audio';
  let modal = document.getElementById('unifiedSettingsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-back';
    modal.id = 'unifiedSettingsModal';
    document.body.appendChild(modal);
  }
  await renderSettings(modal, true);
}

export async function settingsView(main) {
  await renderSettings(main, false);
}

async function renderSettings(container, isModal = false) {
  let settings = {}, presets = {}, personas = {};
  try {
    const res = await api.getSettings();
    settings = res.settings || {};
    presets = res.presets || {};
    personas = res.personas || {};
  } catch (e) {
    console.warn('Failed to load server settings, using defaults', e);
  }

  const llm = settings.llm || { enabled: false, preset: 'ollama', baseUrl: 'http://host.docker.internal:11434/v1', model: 'llama3.1:8b', temperature: 0.8, maxTokens: 180, timeoutMs: 12000, persona: 'classic' };
  const currentPersona = llm.persona || 'classic';
  const portraits = settings.portraits || { enabled: true, sdUrl: '' };

  const levels = sfx.getMixerLevels();
  const defaultView = localStorage.getItem('dnd_default_view') || '3d';
  const showMinimap = localStorage.getItem('dnd_show_minimap') !== 'false';

  const contentHtml = `
    <div class="settings-hub ${isModal ? 'settings-modal-card' : 'card'}" style="max-width:960px; margin:0 auto;">
      <div class="settings-header">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:26px;">⚙️</span>
          <div>
            <h2 style="margin:0; font-size:20px;">Game & DM Settings</h2>
            <p class="small muted" style="margin:2px 0 0;">Audio mixer, AI Dungeon Master, voice narration, and interface controls.</p>
          </div>
        </div>
        ${isModal ? `<button class="btn small" id="closeSettingsModalBtn">Done ✕</button>` : ''}
      </div>

      <!-- Tab Navigation -->
      <div class="settings-tabs">
        <button class="settings-tab-btn ${activeTab === 'audio' ? 'active' : ''}" data-tab="audio">🎚️ Audio Mixer</button>
        <button class="settings-tab-btn ${activeTab === 'dm' ? 'active' : ''}" data-tab="dm">🧙 AI DM & Personas</button>
        <button class="settings-tab-btn ${activeTab === 'voice' ? 'active' : ''}" data-tab="voice">🗣️ Voice (TTS)</button>
        <button class="settings-tab-btn ${activeTab === 'gameplay' ? 'active' : ''}" data-tab="gameplay">🎮 Gameplay</button>
        <button class="settings-tab-btn ${activeTab === 'art' ? 'active' : ''}" data-tab="art">🖼️ Portraits</button>
        <button class="settings-tab-btn ${activeTab === 'data' ? 'active' : ''}" data-tab="data">💾 Backups</button>
      </div>

      <!-- TAB 1: AUDIO MIXER -->
      <div class="settings-panel ${activeTab === 'audio' ? 'active' : ''}" data-panel="audio">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">🔊 Multi-Channel Audio Mixer</h3>
            <p class="small muted" style="margin-bottom:16px;">Independent procedural audio channels synthesized in Web Audio. 100% offline, zero assets required.</p>

            <!-- Master Channel -->
            <div class="mixer-channel-card">
              <div class="mixer-header">
                <span><b>🎚️ Master Volume</b></span>
                <span id="valMasterText" class="badge gold">${Math.round(levels.master * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderMaster" min="0" max="100" value="${Math.round(levels.master * 100)}">
                <button class="btn small ${levels.muted.master ? 'danger' : ''}" id="muteMasterBtn">
                  ${levels.muted.master ? '🔇 Unmute' : '🔊 Mute'}
                </button>
              </div>
            </div>

            <!-- Ambience / Music Channel -->
            <div class="mixer-channel-card" style="margin-top:12px;">
              <div class="mixer-header">
                <span><b>🎵 Ambience & Music</b></span>
                <span id="valAmbientText" class="badge blue">${Math.round(levels.ambient * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderAmbient" min="0" max="100" value="${Math.round(levels.ambient * 100)}">
                <button class="btn small ${levels.muted.ambient ? 'danger' : ''}" id="muteAmbientBtn">
                  ${levels.muted.ambient ? '🔇 Unmute' : '🔊 Mute'}
                </button>
              </div>
            </div>

            <!-- SFX Channel -->
            <div class="mixer-channel-card" style="margin-top:12px;">
              <div class="mixer-header">
                <span><b>💥 Sound Effects (SFX)</b></span>
                <span id="valSfxText" class="badge green">${Math.round(levels.sfx * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderSfx" min="0" max="100" value="${Math.round(levels.sfx * 100)}">
                <button class="btn small ${levels.muted.sfx ? 'danger' : ''}" id="muteSfxBtn">
                  ${levels.muted.sfx ? '🔇 Unmute' : '🔊 Mute'}
                </button>
              </div>
            </div>

            <!-- Voice / Narration Channel -->
            <div class="mixer-channel-card" style="margin-top:12px;">
              <div class="mixer-header">
                <span><b>🗣️ Voice Narration</b></span>
                <span id="valVoiceText" class="badge purple">${Math.round(levels.voice * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderVoice" min="0" max="100" value="${Math.round(levels.voice * 100)}">
                <button class="btn small ${levels.muted.voice ? 'danger' : ''}" id="muteVoiceBtn">
                  ${levels.muted.voice ? '🔇 Unmute' : '🔊 Mute'}
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">🎶 Soundscape Theme Previews</h3>
            <p class="small muted">Click any atmospheric theme to preview its real-time synthesis.</p>
            <div class="soundscape-selector-grid">
              <button class="btn small soundscape-btn" data-theme="town">🏰 Oakhaven Tavern (Hearth & Chords)</button>
              <button class="btn small soundscape-btn" data-theme="crypt">💀 Sunless Crypt (Drips & Sub-Drone)</button>
              <button class="btn small soundscape-btn" data-theme="hills">🏔️ Howling Hills (Mountain Wind Gusts)</button>
              <button class="btn small soundscape-btn" data-theme="vault">🌊 Drowned Vault (Flooded Sluice & Water)</button>
              <button class="btn small soundscape-btn" data-theme="combat">⚔️ Battle Tension (War-Drums & Saw)</button>
              <button class="btn small danger soundscape-btn" data-theme="stop">⏹️ Stop Soundscape</button>
            </div>

            <h3 style="margin-top:20px;">🎲 Test Sound Effects</h3>
            <p class="small muted">Audition synthesized sound effects across combat, exploration, and dice.</p>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              <button class="btn small" data-test-sfx="dice">🎲 Roll Dice</button>
              <button class="btn small" data-test-sfx="hit">⚔️ Sword Strike</button>
              <button class="btn small" data-test-sfx="parry">🛡️ Shield Block</button>
              <button class="btn small" data-test-sfx="potion">🧪 Uncork Potion</button>
              <button class="btn small" data-test-sfx="coin">🪙 Gold Coins</button>
              <button class="btn small" data-test-sfx="barrel_boom">💥 Barrel Boom</button>
              <button class="btn small" data-test-sfx="levelup">🌟 Level Up Fanfare</button>
              <button class="btn small" id="testVoiceBtn">🗣️ Test Voice</button>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: AI DM & PERSONAS -->
      <div class="settings-panel ${activeTab === 'dm' ? 'active' : ''}" data-panel="dm">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <div class="field">
              <label><input type="checkbox" id="llmEnabled" ${llm.enabled ? 'checked' : ''} style="width:auto"> <b>Enable the AI Dungeon Master</b></label>
              <span class="small muted">When enabled, the DM narrates combat, scene entrances, and speaks with NPCs dynamically.</span>
            </div>
            <div class="field">
              <label>Server preset</label>
              <select id="preset">
                ${Object.entries(presets).map(([id, p]) => `<option value="${id}" ${llm.preset === id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
              </select>
              <div class="preset-note small muted" id="presetNote" style="margin-top:4px;"></div>
            </div>
            <div class="field">
              <label>API Base URL (OpenAI-compatible)</label>
              <input type="text" id="baseUrl" value="${esc(llm.baseUrl)}" placeholder="http://host.docker.internal:11434/v1">
            </div>
            <div class="field">
              <label>Model name</label>
              <input type="text" id="model" value="${esc(llm.model)}" placeholder="llama3.1:8b">
            </div>
            <div class="field">
              <label>API key (optional)</label>
              <input type="password" id="apiKey" value="${esc(llm.apiKey || '')}" placeholder="leave blank for local servers">
            </div>
            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap:10px;">
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
            <div style="display:flex; gap:10px; margin-top:14px;">
              <button class="btn primary" id="saveDmBtn">💾 Save DM Settings</button>
              <button class="btn" id="testDmBtn">🔌 Test Connection</button>
            </div>
            <div id="testResult" style="margin-top:10px;"></div>
          </div>

          <div>
            <h3 style="margin-top:0;">🎭 AI DM Persona Presets</h3>
            <p class="small muted" style="margin-bottom:10px;">Select your preferred narrator personality. D&D 2024 mechanics are always resolved strictly by the engine; the persona shapes prose, flair, and dialogue.</p>
            <div class="persona-grid" style="display:grid; gap:8px;">
              ${Object.entries(personas).map(([id, p]) => `
                <label class="persona-card" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; background:var(--bg); border:1.5px solid ${currentPersona === id ? 'var(--gold)' : 'var(--border)'}; border-radius:6px; cursor:pointer;">
                  <input type="radio" name="dmPersona" value="${id}" ${currentPersona === id ? 'checked' : ''} style="margin-top:4px; width:auto;">
                  <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span style="font-size:18px;">${p.icon || '🎲'}</span>
                      <b style="color:var(--text);">${esc(p.name)}</b>
                      <span class="chip blue" style="font-size:10px; padding:1px 6px;">${esc(p.tagline || '')}</span>
                    </div>
                    <div class="small muted" style="margin-top:3px; line-height:1.35;">${esc(p.blurb)}</div>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 3: VOICE (TTS) -->
      <div class="settings-panel ${activeTab === 'voice' ? 'active' : ''}" data-panel="voice">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">🗣️ Spoken Narration (Text-to-Speech)</h3>
            <p class="small muted">Hear the Dungeon Master voice scene descriptions and monster banter aloud.</p>
            <div class="field">
              <label><input type="checkbox" id="ttsEnabled" ${tts.isEnabled() ? 'checked' : ''} style="width:auto"> <b>Enable Voice-Over by Default</b></label>
            </div>
            <div class="field">
              <label>Browser System Voice</label>
              <select id="browserVoiceSelect">
                <option value="">Default System Voice</option>
              </select>
            </div>
            <div class="grid" style="grid-template-columns: 1fr 1fr; gap:10px;">
              <div class="field">
                <label>Speech Rate</label>
                <input type="range" id="voiceRateSlider" min="0.75" max="1.5" step="0.05" value="${tts.getRate()}">
              </div>
              <div class="field">
                <label>Speech Pitch</label>
                <input type="range" id="voicePitchSlider" min="0.7" max="1.3" step="0.05" value="${tts.getPitch()}">
              </div>
            </div>
            <div style="margin-top:14px;">
              <button class="btn primary" id="speakSampleBtn">🗣️ Speak Sample Line</button>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">⚡ Neural Offline Voice (Piper HTTP)</h3>
            <p class="small muted">For cinema-quality neural voices, run a lightweight Piper TTS container locally.</p>
            <div class="field">
              <label>Piper HTTP Server URL (optional)</label>
              <input type="text" id="piperUrl" placeholder="http://localhost:5000/api/tts" value="${esc(tts.getPiper())}">
            </div>
            <div class="card small muted" style="background:rgba(0,0,0,0.3); border:1px solid var(--border); padding:10px; margin-top:10px;">
              <b>Quick Docker Setup:</b><br>
              <code>docker run -p 5000:5000 fedirz/piper-http-server -m en_US-lessac-medium</code>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 4: GAMEPLAY & INTERFACE -->
      <div class="settings-panel ${activeTab === 'gameplay' ? 'active' : ''}" data-panel="gameplay">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">👁️ Delve Camera & Display</h3>
            <div class="field">
              <label>Default Delve View Mode</label>
              <select id="defaultViewSelect">
                <option value="3d" ${defaultView === '3d' ? 'selected' : ''}>2.5D Diorama View (Isometric Tilt & Lighting)</option>
                <option value="2d" ${defaultView === '2d' ? 'selected' : ''}>2D Top-Down View (Classic Tactical Grid)</option>
              </select>
              <span class="small muted">Choose which perspective is active when embarking on a dungeon delve.</span>
            </div>

            <div class="field" style="margin-top:14px;">
              <label><input type="checkbox" id="showMinimapCheck" ${showMinimap ? 'checked' : ''} style="width:auto"> <b>Show 2D Radar Minimap in 2.5D Mode</b></label>
              <span class="small muted">Displays the live corner tactical minimap with your hero's pulsating locator ring.</span>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">⌨️ Hotkeys & Quick Controls</h3>
            <div class="card" style="background:var(--bg); border:1px solid var(--border); padding:12px;">
              <div class="stat-line"><span><b>1, 2, 3, 4, 5</b></span><span>Use Consumable Quick-Slots</span></div>
              <div class="stat-line"><span><b>Spacebar</b></span><span>End Combat Turn</span></div>
              <div class="stat-line"><span><b>WASD / Arrow Keys</b></span><span>Step 1 tile in cardinal directions</span></div>
              <div class="stat-line"><span><b>Click on Creature</b></span><span>Target for Attack / Spells</span></div>
              <div class="stat-line"><span><b>Click on Chest / Trap</b></span><span>Interactive Skill Check / Disarm</span></div>
              <div class="stat-line"><span><b>V Key</b></span><span>Toggle 2.5D / 2D Perspective</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 5: PORTRAITS & ART -->
      <div class="settings-panel ${activeTab === 'art' ? 'active' : ''}" data-panel="art">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">🎨 Creature Portraits</h3>
            <p class="small muted">When discovering a monster or NPC, the game renders atmospheric character art.</p>
            <div class="field">
              <label><input type="checkbox" id="portraitsEnabled" ${portraits.enabled !== false ? 'checked' : ''} style="width:auto"> <b>Enable Portrait Generation</b></label>
            </div>
            <div class="field">
              <label>Stable Diffusion WebUI URL (optional)</label>
              <input type="text" id="sdUrl" value="${esc(portraits.sdUrl || '')}" placeholder="http://host.docker.internal:7860">
              <span class="small muted">If provided, portraits will be rendered locally via your SD installation. Falls back gracefully to Google AI and procedural sigils.</span>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">🖼️ Portrait Provider Priority</h3>
            <ol class="small muted" style="padding-left:18px; line-height:1.6;">
              <li><b>Google Gemini Imagen</b> (High quality, uses your API key)</li>
              <li><b>Local Stable Diffusion</b> (Automated offline rendering)</li>
              <li><b>Procedural Fantasy SVG Sigils</b> (Instant, offline, zero quota needed)</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- TAB 6: DATA & BACKUPS -->
      <div class="settings-panel ${activeTab === 'data' ? 'active' : ''}" data-panel="data">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">📦 Export Save Data</h3>
            <p class="small muted">Download a complete JSON backup containing all your characters, inventory, and active delve states.</p>
            <button class="btn primary" id="exportDataBtn">📥 Download Backup JSON</button>
          </div>

          <div>
            <h3 style="margin-top:0;">📂 Restore Backup</h3>
            <p class="small muted">Restore characters and delve saves from a previous backup file.</p>
            <input type="file" id="importFileInput" accept=".json" style="display:none;">
            <button class="btn" id="importDataBtn">📤 Select Backup File to Restore</button>
            <div id="importStatus" class="small muted" style="margin-top:8px;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = contentHtml;

  // -----------------------------------------------------------
  // Event Attachments
  // -----------------------------------------------------------
  const $ = id => container.querySelector('#' + id);

  // Close modal
  const closeBtn = $('closeSettingsModalBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const modalBack = document.getElementById('unifiedSettingsModal');
      if (modalBack) modalBack.remove();
    });
  }

  // Tab switching
  container.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      activeTab = tab;
      container.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = container.querySelector(`.settings-panel[data-panel="${tab}"]`);
      if (panel) panel.classList.add('active');
    });
  });

  // 1. Audio Mixer Sliders & Mutes
  const updateMixerDisplay = () => {
    const l = sfx.getMixerLevels();
    if ($('valMasterText')) $('valMasterText').textContent = l.muted.master ? 'MUTED' : `${Math.round(l.master * 100)}%`;
    if ($('valAmbientText')) $('valAmbientText').textContent = l.muted.ambient ? 'MUTED' : `${Math.round(l.ambient * 100)}%`;
    if ($('valSfxText')) $('valSfxText').textContent = l.muted.sfx ? 'MUTED' : `${Math.round(l.sfx * 100)}%`;
    if ($('valVoiceText')) $('valVoiceText').textContent = l.muted.voice ? 'MUTED' : `${Math.round(l.voice * 100)}%`;

    if ($('muteMasterBtn')) $('muteMasterBtn').textContent = l.muted.master ? '🔇 Unmute' : '🔊 Mute';
    if ($('muteAmbientBtn')) $('muteAmbientBtn').textContent = l.muted.ambient ? '🔇 Unmute' : '🔊 Mute';
    if ($('muteSfxBtn')) $('muteSfxBtn').textContent = l.muted.sfx ? '🔇 Unmute' : '🔊 Mute';
    if ($('muteVoiceBtn')) $('muteVoiceBtn').textContent = l.muted.voice ? '🔇 Unmute' : '🔊 Mute';
  };

  $('sliderMaster')?.addEventListener('input', (e) => {
    sfx.setMasterVolume(e.target.value / 100);
    updateMixerDisplay();
  });
  $('sliderAmbient')?.addEventListener('input', (e) => {
    sfx.setAmbientVolume(e.target.value / 100);
    updateMixerDisplay();
  });
  $('sliderSfx')?.addEventListener('input', (e) => {
    sfx.setSfxVolume(e.target.value / 100);
    updateMixerDisplay();
  });
  $('sliderVoice')?.addEventListener('input', (e) => {
    const v = e.target.value / 100;
    sfx.setVoiceVolume(v);
    tts.setVolume(v);
    updateMixerDisplay();
  });

  $('muteMasterBtn')?.addEventListener('click', () => { sfx.toggleMute('master'); updateMixerDisplay(); });
  $('muteAmbientBtn')?.addEventListener('click', () => { sfx.toggleMute('ambient'); updateMixerDisplay(); });
  $('muteSfxBtn')?.addEventListener('click', () => { sfx.toggleMute('sfx'); updateMixerDisplay(); });
  $('muteVoiceBtn')?.addEventListener('click', () => { sfx.toggleMute('voice'); updateMixerDisplay(); });

  // Soundscape preview
  container.querySelectorAll('.soundscape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      if (theme === 'stop') {
        sfx.stopAmbient();
        toast('Soundscape stopped.');
      } else {
        sfx.startAmbient(theme);
        toast(`Playing ${theme.toUpperCase()} soundscape.`);
      }
    });
  });

  // Test SFX
  container.querySelectorAll('[data-test-sfx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sound = btn.getAttribute('data-test-sfx');
      sfx.play(sound);
    });
  });

  // Test Voice
  const testVoiceAction = () => {
    tts.speak("A cold wind whispers through the ancient archway. Roll for initiative!");
    toast('Playing voice test...');
  };
  $('testVoiceBtn')?.addEventListener('click', testVoiceAction);
  $('speakSampleBtn')?.addEventListener('click', testVoiceAction);

  // 2. DM Settings
  const presetNote = () => {
    const p = presets[$('preset').value];
    if ($('presetNote')) $('presetNote').textContent = p ? p.note : '';
  };
  presetNote();
  $('preset')?.addEventListener('change', () => {
    presetNote();
    const p = presets[$('preset').value];
    if (p && p.baseUrl) {
      $('baseUrl').value = p.baseUrl;
      $('model').value = p.model || '';
    }
  });

  container.querySelectorAll('input[name="dmPersona"]').forEach(radio => {
    radio.addEventListener('change', () => {
      container.querySelectorAll('.persona-card').forEach(c => c.style.borderColor = 'var(--border)');
      const parent = radio.closest('.persona-card');
      if (parent) parent.style.borderColor = 'var(--gold)';
    });
  });

  const collectLlm = () => {
    const personaPick = container.querySelector('input[name="dmPersona"]:checked');
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

  $('saveDmBtn')?.addEventListener('click', async () => {
    try {
      await api.saveSettings({
        llm: collectLlm(),
        portraits: { enabled: $('portraitsEnabled').checked, sdUrl: $('sdUrl').value.trim() }
      });
      toast('DM & Portrait settings saved!');
    } catch (e) {
      toast(e.message);
    }
  });

  $('testDmBtn')?.addEventListener('click', async () => {
    const out = $('testResult');
    out.innerHTML = '<span class="spinner"></span> Testing model connection...';
    try {
      const res = await api.testLlm(collectLlm());
      if (res.ok) {
        out.innerHTML = `<div class="card" style="border-color:var(--green); background:rgba(111,163,86,0.1); margin-top:8px;">
          <b style="color:var(--green)">✔ Connected successfully!</b><br>
          <span class="small">Model reply: "${esc(res.sample || '')}"</span>
          ${res.models && res.models.length ? `<br><span class="small muted">Models found: ${esc(res.models.join(', '))}</span>` : ''}
        </div>`;
      } else {
        out.innerHTML = `<div class="card" style="border-color:var(--red); background:rgba(217,83,79,0.1); margin-top:8px;">
          <b style="color:var(--red)">✖ Connection failed:</b> ${esc(res.error || 'Unknown error')}
        </div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="card" style="border-color:var(--red);">${esc(e.message)}</div>`;
    }
  });

  // 3. Voice (TTS)
  $('piperUrl')?.addEventListener('change', (e) => {
    tts.setPiper(e.target.value);
    toast('Piper URL updated.');
  });
  $('ttsEnabled')?.addEventListener('change', (e) => {
    if (e.target.checked !== tts.isEnabled()) tts.toggle();
    toast(`Voice-over ${tts.isEnabled() ? 'enabled' : 'disabled'}.`);
  });

  // Populate browser voices
  const populateVoices = () => {
    const select = $('browserVoiceSelect');
    if (!select) return;
    const voices = tts.getAvailableVoices();
    const curVoice = tts.getVoice();
    select.innerHTML = '<option value="">Default System Voice</option>' +
      voices.map(v => `<option value="${esc(v.name)}" ${v.name === curVoice ? 'selected' : ''}>${esc(v.name)} (${v.lang})</option>`).join('');
  };
  populateVoices();
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = populateVoices;
  }
  $('browserVoiceSelect')?.addEventListener('change', (e) => {
    tts.setVoice(e.target.value);
    toast('Voice preference saved.');
  });
  $('voiceRateSlider')?.addEventListener('input', (e) => {
    tts.setRate(e.target.value);
  });
  $('voicePitchSlider')?.addEventListener('input', (e) => {
    tts.setPitch(e.target.value);
  });

  // 4. Gameplay
  $('defaultViewSelect')?.addEventListener('change', (e) => {
    localStorage.setItem('dnd_default_view', e.target.value);
    toast(`Default delve view set to ${e.target.options[e.target.selectedIndex].text}.`);
  });
  $('showMinimapCheck')?.addEventListener('change', (e) => {
    localStorage.setItem('dnd_show_minimap', String(e.target.checked));
    toast(`Minimap ${e.target.checked ? 'enabled' : 'hidden'}.`);
  });

  // 5. Data Export & Import
  $('exportDataBtn')?.addEventListener('click', async () => {
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-dnd-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup exported successfully!');
    } catch (e) {
      toast('Export failed: ' + e.message);
    }
  });

  const importInput = $('importFileInput');
  $('importDataBtn')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await api.importData(json);
      if ($('importStatus')) $('importStatus').innerHTML = `<span style="color:var(--green)">✔ Restored ${res.imported.characters} heroes and ${res.imported.saves} saves!</span>`;
      toast('Backup imported successfully!');
    } catch (err) {
      if ($('importStatus')) $('importStatus').innerHTML = `<span style="color:var(--red)">✖ Import failed: ${esc(err.message)}</span>`;
    }
  });
}
