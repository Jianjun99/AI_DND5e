// settings.js — Unified Settings Hub with Multi-Channel Audio Mixer, AI DM Personas, Voice (TTS), and Gameplay options.
import { api } from '../api.js';
import { tts } from '../tts.js';
import { sfx } from '../sfx.js';
import { esc, toast } from '../app.js';
import { contentText, contentLabel,  getLocale, setLocale, translateDOM, t, label, localizeText, onLocaleChange, displayText, displayLabel } from '../i18n.js';
import { presentModal, dismissModal } from '../modal.js';

let activeTab = 'audio';
const settingsDisposers = new WeakMap();
const settingsRenders = new WeakMap();

export async function openSettingsModal(defaultTab = 'audio') {
  activeTab = defaultTab || 'audio';
  let modal = document.getElementById('unifiedSettingsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-back';
    modal.id = 'unifiedSettingsModal';
    if (!presentModal(modal)) return;
  }
  await renderSettings(modal, true);
}

/** @param {import('../navigation.js').Navigation} navigation */
export async function settingsView(main, navigation) {
  return renderSettings(main, false, navigation);
}

async function renderSettings(container, isModal = false, navigation = null) {
  const renderId = {};
  const route = location.hash;
  settingsRenders.set(container, renderId);
  let settings = {}, presets = {}, personas = {};
  try {
    const res = await api.getSettings();
    settings = res.settings || {};
    presets = res.presets || {};
    personas = res.personas || {};
  } catch (e) {
    if (navigation && !navigation.isCurrent()) return;
    console.warn('Failed to load server settings, using defaults', e);
  }
  if ((navigation && !navigation.isCurrent()) || !container.isConnected || settingsRenders.get(container) !== renderId || location.hash !== route) return undefined;

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
            <h2 style="margin:0; font-size:20px;" data-i18n="settings.title">Game & DM Settings</h2>
            <p class="small muted" style="margin:2px 0 0;" data-i18n="settings.subtitle">Audio mixer, AI Dungeon Master, voice narration, and interface controls.</p>
          </div>
        </div>
        ${isModal ? `<button class="btn small" id="closeSettingsModalBtn" data-i18n="settings.done">Done ✕</button>` : ''}
      </div>

      <!-- Tab Navigation -->
      <div class="settings-tabs">
        <button class="settings-tab-btn ${activeTab === 'audio' ? 'active' : ''}" data-tab="audio" data-i18n="settings.audio">🎚️ Audio Mixer</button>
        <button class="settings-tab-btn ${activeTab === 'dm' ? 'active' : ''}" data-tab="dm" data-i18n="settings.dm">🧙 AI DM & Personas</button>
        <button class="settings-tab-btn ${activeTab === 'voice' ? 'active' : ''}" data-tab="voice" data-i18n="settings.voice">🗣️ Voice (TTS)</button>
        <button class="settings-tab-btn ${activeTab === 'gameplay' ? 'active' : ''}" data-tab="gameplay" data-i18n="settings.gameplay">🎮 Gameplay</button>
        <button class="settings-tab-btn ${activeTab === 'art' ? 'active' : ''}" data-tab="art" data-i18n="settings.art">🖼️ Portraits</button>
        <button class="settings-tab-btn ${activeTab === 'data' ? 'active' : ''}" data-tab="data" data-i18n="settings.data">💾 Backups</button>
      </div>

      <!-- TAB 1: AUDIO MIXER -->
      <div class="settings-panel ${activeTab === 'audio' ? 'active' : ''}" data-panel="audio">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">${label("ui.settings.multi_channel_audio_mixer")}</h3>
            <p class="small muted" style="margin-bottom:16px;">${label("ui.settings.independent_procedural_audio_channels_synthesized_in_web")}</p>

            <!-- Master Channel -->
            <div class="mixer-channel-card">
              <div class="mixer-header">
                <span><b>${label("ui.settings.master_volume")}</b></span>
                <span id="valMasterText" class="badge gold">${Math.round(levels.master * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderMaster" min="0" max="100" value="${Math.round(levels.master * 100)}">
                <button class="btn small ${levels.muted.master ? 'danger' : ''}" id="muteMasterBtn">
                  ${levels.muted.master ? label("ui.settings.unmute") : label("ui.settings.mute")}
                </button>
              </div>
            </div>

            <!-- Ambience / Music Channel -->
            <div class="mixer-channel-card" style="margin-top:12px;">
              <div class="mixer-header">
                <span><b>${label("ui.settings.ambience_music")}</b></span>
                <span id="valAmbientText" class="badge blue">${Math.round(levels.ambient * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderAmbient" min="0" max="100" value="${Math.round(levels.ambient * 100)}">
                <button class="btn small ${levels.muted.ambient ? 'danger' : ''}" id="muteAmbientBtn">
                  ${levels.muted.ambient ? label("ui.settings.unmute") : label("ui.settings.mute")}
                </button>
              </div>
            </div>

            <!-- SFX Channel -->
            <div class="mixer-channel-card" style="margin-top:12px;">
              <div class="mixer-header">
                <span><b>${label("ui.settings.sound_effects_sfx")}</b></span>
                <span id="valSfxText" class="badge green">${Math.round(levels.sfx * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderSfx" min="0" max="100" value="${Math.round(levels.sfx * 100)}">
                <button class="btn small ${levels.muted.sfx ? 'danger' : ''}" id="muteSfxBtn">
                  ${levels.muted.sfx ? label("ui.settings.unmute") : label("ui.settings.mute")}
                </button>
              </div>
            </div>

            <!-- Voice / Narration Channel -->
            <div class="mixer-channel-card" style="margin-top:12px;">
              <div class="mixer-header">
                <span><b>${label("ui.settings.voice_narration")}</b></span>
                <span id="valVoiceText" class="badge purple">${Math.round(levels.voice * 100)}%</span>
              </div>
              <div class="mixer-controls">
                <input type="range" class="mixer-slider" id="sliderVoice" min="0" max="100" value="${Math.round(levels.voice * 100)}">
                <button class="btn small ${levels.muted.voice ? 'danger' : ''}" id="muteVoiceBtn">
                  ${levels.muted.voice ? label("ui.settings.unmute") : label("ui.settings.mute")}
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">${label("ui.settings.soundscape_theme_previews")}</h3>
            <p class="small muted">${label("ui.settings.click_any_atmospheric_theme_to_preview_its")}</p>
            <div class="soundscape-selector-grid">
              <button class="btn small soundscape-btn" data-theme="town">${label("ui.settings.oakhaven_tavern_hearth_chords")}</button>
              <button class="btn small soundscape-btn" data-theme="crypt">${label("ui.settings.sunless_crypt_drips_sub_drone")}</button>
              <button class="btn small soundscape-btn" data-theme="hills">${label("ui.settings.howling_hills_mountain_wind_gusts")}</button>
              <button class="btn small soundscape-btn" data-theme="vault">${label("ui.settings.drowned_vault_flooded_sluice_water")}</button>
              <button class="btn small soundscape-btn" data-theme="combat">${label("ui.settings.battle_tension_war_drums_saw")}</button>
              <button class="btn small danger soundscape-btn" data-theme="stop">${label("ui.settings.stop_soundscape")}</button>
            </div>

            <h3 style="margin-top:20px;">${label("ui.settings.test_sound_effects")}</h3>
            <p class="small muted">${label("ui.settings.audition_synthesized_sound_effects_across_combat_exploration")}</p>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              <button class="btn small" data-test-sfx="dice">${label("ui.settings.roll_dice")}</button>
              <button class="btn small" data-test-sfx="hit">${label("ui.settings.sword_strike")}</button>
              <button class="btn small" data-test-sfx="parry">${label("ui.settings.shield_block")}</button>
              <button class="btn small" data-test-sfx="potion">${label("ui.settings.uncork_potion")}</button>
              <button class="btn small" data-test-sfx="coin">${label("ui.settings.gold_coins")}</button>
              <button class="btn small" data-test-sfx="barrel_boom">${label("ui.settings.barrel_boom")}</button>
              <button class="btn small" data-test-sfx="levelup">${label("ui.settings.level_up_fanfare")}</button>
              <button class="btn small" id="testVoiceBtn">${label("ui.settings.test_voice")}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: AI DM & PERSONAS -->
      <div class="settings-panel ${activeTab === 'dm' ? 'active' : ''}" data-panel="dm">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <div class="field">
              <label><input type="checkbox" id="llmEnabled" ${llm.enabled ? 'checked' : ''} style="width:auto"> <b>${label("ui.settings.enable_the_ai_dungeon_master")}</b></label>
              <span class="small muted">${label("ui.settings.when_enabled_the_dm_narrates_combat_scene")}</span>
            </div>
            <div class="field">
              <label>${label("ui.settings.server_preset")}</label>
              <select id="preset">
                ${Object.entries(presets).map(([id, p]) => `<option value="${id}" ${llm.preset === id ? 'selected' : ''} data-i18n="${p.labelDisplay?.key || ""}">${esc(displayText(p.labelDisplay, p.label))}</option>`).join('')}
              </select>
              <div class="preset-note small muted" id="presetNote" style="margin-top:4px;"></div>
            </div>
            <div class="field">
              <label>${label("ui.settings.api_base_url_openai_compatible")}</label>
              <input type="text" id="baseUrl" value="${esc(llm.baseUrl)}" placeholder="http://host.docker.internal:11434/v1">
            </div>
            <div class="field">
              <label>${label("ui.settings.model_name")}</label>
              <input type="text" id="model" value="${esc(llm.model)}" placeholder="llama3.1:8b">
            </div>
            <div class="field">
              <label>${label("ui.settings.api_key_optional")}</label>
              <input type="password" id="apiKey" value="${esc(llm.apiKey || '')}" data-i18n-placeholder="ui.settings.leave_blank_for_local_servers" placeholder="${esc(t("ui.settings.leave_blank_for_local_servers"))}">
            </div>
            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap:10px;">
              <div class="field">
                <label>${label("ui.settings.creativity_temp")}</label>
                <input type="number" id="temperature" value="${llm.temperature}" min="0" max="2" step="0.1">
              </div>
              <div class="field">
                <label>${label("ui.settings.max_tokens")}</label>
                <input type="number" id="maxTokens" value="${llm.maxTokens}" min="20" max="2000" step="10">
              </div>
              <div class="field">
                <label>${label("ui.settings.timeout_ms")}</label>
                <input type="number" id="timeoutMs" value="${llm.timeoutMs}" min="3000" max="60000" step="1000">
              </div>
            </div>
            <div style="display:flex; gap:10px; margin-top:14px;">
              <button class="btn primary" id="saveDmBtn">${label("ui.settings.save_dm_settings")}</button>
              <button class="btn" id="testDmBtn">${label("ui.settings.test_connection")}</button>
            </div>
            <div id="testResult" style="margin-top:10px;"></div>
          </div>

          <div>
            <h3 style="margin-top:0;">${label("ui.settings.ai_dm_persona_presets")}</h3>
            <p class="small muted" style="margin-bottom:10px;">${label("ui.settings.select_your_preferred_narrator_personality_d_d")}</p>
            <div class="persona-grid" style="display:grid; gap:8px;">
              ${Object.entries(personas).map(([id, p]) => `
                <label class="persona-card" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; background:var(--bg); border:1.5px solid ${currentPersona === id ? 'var(--gold)' : 'var(--border)'}; border-radius:6px; cursor:pointer;">
                  <input type="radio" name="dmPersona" value="${id}" ${currentPersona === id ? 'checked' : ''} style="margin-top:4px; width:auto;">
                  <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <span style="font-size:18px;">${p.icon || '🎲'}</span>
                      <b style="color:var(--text);">${displayLabel(p.nameDisplay, p.name)}</b>
                      <span class="chip blue" style="font-size:10px; padding:1px 6px;">${displayLabel(p.taglineDisplay, p.tagline || "")}</span>
                    </div>
                    <div class="small muted" style="margin-top:3px; line-height:1.35;">${displayLabel(p.blurbDisplay, p.blurb)}</div>
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
            <h3 style="margin-top:0;">${label("ui.settings.spoken_narration_text_to_speech")}</h3>
            <p class="small muted">${label("ui.settings.hear_the_dungeon_master_voice_scene_descriptions")}</p>
            <div class="field">
              <label><input type="checkbox" id="ttsEnabled" ${tts.isEnabled() ? 'checked' : ''} style="width:auto"> <b>${label("ui.settings.enable_voice_over_by_default")}</b></label>
            </div>
            <div class="field">
              <label>${label("ui.settings.browser_system_voice")}</label>
              <select id="browserVoiceSelect">
                <option value="" data-i18n="ui.settings.default_system_voice">${esc(t("ui.settings.default_system_voice"))}</option>
              </select>
            </div>
            <div class="grid" style="grid-template-columns: 1fr 1fr; gap:10px;">
              <div class="field">
                <label>${label("ui.settings.speech_rate")}</label>
                <input type="range" id="voiceRateSlider" min="0.75" max="1.5" step="0.05" value="${tts.getRate()}">
              </div>
              <div class="field">
                <label>${label("ui.settings.speech_pitch")}</label>
                <input type="range" id="voicePitchSlider" min="0.7" max="1.3" step="0.05" value="${tts.getPitch()}">
              </div>
            </div>
            <div style="margin-top:14px;">
              <button class="btn primary" id="speakSampleBtn">${label("ui.settings.speak_sample_line")}</button>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">${label("ui.settings.neural_offline_voice_piper_http")}</h3>
            <p class="small muted">${label("ui.settings.for_cinema_quality_neural_voices_run_a")}</p>
            <div class="field">
              <label>${label("ui.settings.piper_http_server_url_optional")}</label>
              <input type="text" id="piperUrl" placeholder="http://localhost:5000/api/tts" value="${esc(tts.getPiper())}">
            </div>
            <div class="field"><label>${label('content.piperLanguage')}</label>
              <select id="piperLanguage"><option value="" data-i18n="content.piperUnknown">${t('content.piperUnknown')}</option><option value="en">English</option><option value="zh-CN">简体中文</option></select>
              <p class="small muted">${label('content.voiceFallback')}</p>
            </div>
            <div class="card small muted" style="background:rgba(0,0,0,0.3); border:1px solid var(--border); padding:10px; margin-top:10px;">
              <b>${label("ui.settings.quick_docker_setup")}</b><br>
              <code>docker run -p 5000:5000 fedirz/piper-http-server -m en_US-lessac-medium</code>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 4: GAMEPLAY & INTERFACE -->
      <div class="settings-panel ${activeTab === 'gameplay' ? 'active' : ''}" data-panel="gameplay">
        <div class="field">
          <label for="gameLocale" data-i18n="locale.label">Language</label>
          <select id="gameLocale" data-locale-select>
            <option value="zh-CN" ${getLocale() === 'zh-CN' ? 'selected' : ''}>简体中文</option>
            <option value="en" ${getLocale() === 'en' ? 'selected' : ''}>English</option>
          </select>
          <span class="small muted" data-i18n="locale.help"></span>
          <p class="small muted" data-i18n="locale.progress" style="margin:6px 0 14px;"></p>
        </div>
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;" data-i18n="settings.display">👁️ Delve Camera & Display</h3>
            <div class="field">
              <label data-i18n="settings.defaultView">Default Delve View Mode</label>
              <select id="defaultViewSelect">
                <option value="3d" data-i18n="settings.view3d" ${defaultView === '3d' ? 'selected' : ''}>2.5D Diorama View (Isometric Tilt & Lighting)</option>
                <option value="2d" data-i18n="settings.view2d" ${defaultView === '2d' ? 'selected' : ''}>2D Top-Down View (Classic Tactical Grid)</option>
              </select>
              <span class="small muted" data-i18n="settings.viewHelp">Choose which perspective is active when embarking on a dungeon delve.</span>
            </div>

            <div class="field" style="margin-top:14px;">
              <label><input type="checkbox" id="showMinimapCheck" ${showMinimap ? 'checked' : ''} style="width:auto"> <b data-i18n="settings.minimap">Show 2D Radar Minimap in 2.5D Mode</b></label>
              <span class="small muted" data-i18n="settings.minimapHelp">Displays the live corner tactical minimap with your hero's pulsating locator ring.</span>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">${label("ui.settings.hotkeys_quick_controls")}</h3>
            <div class="card" style="background:var(--bg); border:1px solid var(--border); padding:12px;">
              <div class="stat-line"><span><b>1, 2, 3, 4, 5</b></span><span>${label("ui.settings.use_consumable_quick_slots")}</span></div>
              <div class="stat-line"><span><b>${label("ui.settings.spacebar")}</b></span><span>${label("ui.settings.end_combat_turn")}</span></div>
              <div class="stat-line"><span><b>${label("ui.settings.wasd_arrow_keys")}</b></span><span>${label("ui.settings.step_1_tile_in_cardinal_directions")}</span></div>
              <div class="stat-line"><span><b>${label("ui.settings.click_on_creature")}</b></span><span>${label("ui.settings.target_for_attack_spells")}</span></div>
              <div class="stat-line"><span><b>${label("ui.settings.click_on_chest_trap")}</b></span><span>${label("ui.settings.interactive_skill_check_disarm")}</span></div>
              <div class="stat-line"><span><b>${label("ui.settings.v_key")}</b></span><span>${label('ui.layout.mapFirst')} / ${label('ui.layout.tactical')}</span></div>
              <div class="stat-line"><span><b>C / Q / L / T</b></span><span>${label('ui.layout.character')} / ${label('ui.layout.quests')} / ${label('ui.layout.log')} / ${label('ui.layout.chat')}</span></div>
              <div class="stat-line"><span><b>F</b></span><span>${label('ui.settings.followHotkey')}</span></div>
              <div class="stat-line"><span><b>2D / 3D</b></span><span>${label('ui.settings.viewButtons')}</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 5: PORTRAITS & ART -->
      <div class="settings-panel ${activeTab === 'art' ? 'active' : ''}" data-panel="art">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">${label("ui.settings.creature_portraits")}</h3>
            <p class="small muted">${label("ui.settings.when_discovering_a_monster_or_npc_the")}</p>
            <div class="field">
              <label><input type="checkbox" id="portraitsEnabled" ${portraits.enabled !== false ? 'checked' : ''} style="width:auto"> <b>${label("ui.settings.enable_portrait_generation")}</b></label>
            </div>
            <div class="field">
              <label>${label("ui.settings.stable_diffusion_webui_url_optional")}</label>
              <input type="text" id="sdUrl" value="${esc(portraits.sdUrl || '')}" placeholder="http://host.docker.internal:7860">
              <span class="small muted">${label("ui.settings.if_provided_portraits_will_be_rendered_locally")}</span>
            </div>
          </div>

          <div>
            <h3 style="margin-top:0;">${label("ui.settings.portrait_provider_priority")}</h3>
            <ol class="small muted" style="padding-left:18px; line-height:1.6;">
              <li><b>Google Gemini Imagen</b> ${label("ui.settings.high_quality_uses_your_api_key")}</li>
              <li><b>${label("ui.settings.local_stable_diffusion")}</b> ${label("ui.settings.automated_offline_rendering")}</li>
              <li><b>${label("ui.settings.procedural_fantasy_svg_sigils")}</b> ${label("ui.settings.instant_offline_zero_quota_needed")}</li>
            </ol>
          </div>
        </div>
      </div>

      <!-- TAB 6: DATA & BACKUPS -->
      <div class="settings-panel ${activeTab === 'data' ? 'active' : ''}" data-panel="data">
        <div class="grid cols2" style="gap:20px;">
          <div>
            <h3 style="margin-top:0;">${label("ui.settings.export_save_data")}</h3>
            <p class="small muted">${label("ui.settings.download_a_complete_json_backup_containing_all")}</p>
            <button class="btn primary" id="exportDataBtn">${label("ui.settings.download_backup_json")}</button>
          </div>

          <div>
            <h3 style="margin-top:0;">${label("ui.settings.restore_backup")}</h3>
            <p class="small muted">${label("ui.settings.restore_characters_and_delve_saves_from_a")}</p>
            <input type="file" id="importFileInput" accept=".json" style="display:none;">
            <button class="btn" id="importDataBtn">${label("ui.settings.select_backup_file_to_restore")}</button>
            <div id="importStatus" class="small muted" style="margin-top:8px;"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  settingsDisposers.get(container)?.();
  container.innerHTML = contentHtml;
  function refreshLocalizedText() { translateDOM(container); }
  const stopLocale = onLocaleChange(refreshLocalizedText);
  settingsDisposers.set(container, stopLocale);
  if (isModal) container.addEventListener("game:dispose", stopLocale, { once: true });
  translateDOM(container);

  // -----------------------------------------------------------
  // Event Attachments
  // -----------------------------------------------------------
  const $ = id => container.querySelector('#' + id);

  // Close modal
  const closeBtn = $('closeSettingsModalBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const modalBack = document.getElementById('unifiedSettingsModal');
      if (modalBack) { stopLocale(); dismissModal(modalBack); }
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
    if ($('valMasterText')) localizeText($('valMasterText'), () => l.muted.master ? t("ui.settings.muted") : `${Math.round(l.master * 100)}%`);
    if ($('valAmbientText')) localizeText($('valAmbientText'), () => l.muted.ambient ? t("ui.settings.muted") : `${Math.round(l.ambient * 100)}%`);
    if ($('valSfxText')) localizeText($('valSfxText'), () => l.muted.sfx ? t("ui.settings.muted") : `${Math.round(l.sfx * 100)}%`);
    if ($('valVoiceText')) localizeText($('valVoiceText'), () => l.muted.voice ? t("ui.settings.muted") : `${Math.round(l.voice * 100)}%`);

    if ($('muteMasterBtn')) localizeText($('muteMasterBtn'), () => l.muted.master ? t("ui.settings.unmute") : t("ui.settings.mute"));
    if ($('muteAmbientBtn')) localizeText($('muteAmbientBtn'), () => l.muted.ambient ? t("ui.settings.unmute") : t("ui.settings.mute"));
    if ($('muteSfxBtn')) localizeText($('muteSfxBtn'), () => l.muted.sfx ? t("ui.settings.unmute") : t("ui.settings.mute"));
    if ($('muteVoiceBtn')) localizeText($('muteVoiceBtn'), () => l.muted.voice ? t("ui.settings.unmute") : t("ui.settings.mute"));
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
        toast(() => t("ui.settings.soundscape_stopped"));
      } else {
        sfx.startAmbient(theme);
        toast(() => t('ui.settings.playing', { theme: theme.toUpperCase() }));
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
    tts.speak(t("ui.settings.a_cold_wind_whispers_through_the_ancient"));
    toast(() => t("ui.settings.playing_voice_test"));
  };
  $('testVoiceBtn')?.addEventListener('click', testVoiceAction);
  $('speakSampleBtn')?.addEventListener('click', testVoiceAction);

  // 2. DM Settings
  const presetNote = () => {
    const p = presets[$('preset').value];
    if ($('presetNote')) localizeText($('presetNote'), () => displayText(p?.noteDisplay, p?.note || ''));
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
      toast(() => t("ui.settings.dm_portrait_settings_saved"));
    } catch (e) {
      toast(() => e.message);
    }
  });

  $('testDmBtn')?.addEventListener('click', async () => {
    const out = $('testResult');
    out.innerHTML = `<span class="spinner"></span> ${label("ui.settings.testing")}`;
    try {
      const res = await api.testLlm(collectLlm());
      if (res.ok) {
        out.innerHTML = `<div class="card" style="border-color:var(--green); background:rgba(111,163,86,0.1); margin-top:8px;">
          <b style="color:var(--green)">${label("ui.settings.connected_successfully")}</b><br>
          <span class="small">${label("ui.settings.model_reply_values", {p1: res.sample || ''})}</span>
          ${res.models && res.models.length ? `<br><span class="small muted">${label("ui.settings.models")}${esc(res.models.join(", "))}</span>` : ''}
        </div>`;
      } else {
        out.innerHTML = `<div class="card" style="border-color:var(--red); background:rgba(217,83,79,0.1); margin-top:8px;">
          <b style="color:var(--red)">${label("ui.settings.connection_failed")}</b> ${esc(res.error || t("ui.settings.unknown_error"))}
        </div>`;
      }
    } catch (e) {
      out.innerHTML = `<div class="card" style="border-color:var(--red);">${esc(e.message)}</div>`;
    }
  });

  // 3. Voice (TTS)
  $('piperUrl')?.addEventListener('change', (e) => {
    tts.setPiper(e.target.value);
    toast(() => t("ui.settings.piper_url_updated"));
  });
  if ($('piperLanguage')) {
    $('piperLanguage').value = tts.getPiperLanguage();
    $('piperLanguage').addEventListener('change', e=>tts.setPiperLanguage(e.target.value));
  }
  $('ttsEnabled')?.addEventListener('change', (e) => {
    if (e.target.checked !== tts.isEnabled()) tts.toggle();
    toast(() => t('ui.settings.voiceState', { state: t(tts.isEnabled() ? 'ui.settings.enabled' : 'ui.settings.disabled') }));
  });

  // Populate browser voices
  const populateVoices = () => {
    const select = $('browserVoiceSelect');
    if (!select) return;
    const voices = tts.getAvailableVoices();
    const curVoice = tts.getVoice();
    select.innerHTML = `<option value="" data-i18n="ui.settings.default_system_voice">${esc(t("ui.settings.default_system_voice"))}</option>` +
      voices.map(v => `<option value="${esc(contentText(v,"name"))}" ${v.name === curVoice ? 'selected' : ''}>${contentLabel(v,"name")} (${v.lang})</option>`).join('');
  };
  populateVoices();
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = populateVoices;
  }
  $('browserVoiceSelect')?.addEventListener('change', (e) => {
    tts.setVoice(e.target.value);
    toast(() => t("ui.settings.voice_preference_saved"));
  });
  $('voiceRateSlider')?.addEventListener('input', (e) => {
    tts.setRate(e.target.value);
  });
  $('voicePitchSlider')?.addEventListener('input', (e) => {
    tts.setPitch(e.target.value);
  });

  // 4. Gameplay
  $('gameLocale')?.addEventListener('change', event => {
    setLocale(/** @type {HTMLSelectElement} */ (event.target).value);
  });
  $('defaultViewSelect')?.addEventListener('change', (e) => {
    localStorage.setItem('dnd_default_view', e.target.value);
    toast(() => t('ui.settings.viewSet', { view: (e.target.options[e.target.selectedIndex].textDisplay || e.target.options[e.target.selectedIndex].text) }));
  });
  $('showMinimapCheck')?.addEventListener('change', (e) => {
    localStorage.setItem('dnd_show_minimap', String(e.target.checked));
    toast(() => t('ui.settings.minimapState', { state: t(e.target.checked ? 'ui.settings.enabled' : 'ui.settings.hidden') }));
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
      toast(() => t("ui.settings.backup_exported_successfully"));
    } catch (e) {
      toast(() => t("ui.settings.export_failed") + e.message);
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
      if ($('importStatus')) $('importStatus').innerHTML = `<span style="color:var(--green)">${label("ui.settings.restored_heroes_and_saves_values", {p0: res.imported.characters, p1: res.imported.saves})}</span>`;
      toast(() => t("ui.settings.backup_imported_successfully"));
    } catch (err) {
      if ($('importStatus')) $('importStatus').innerHTML = `<span style="color:var(--red)">${label("ui.settings.import_failed_values", {p0: err.message})}</span>`;
    }
  });
  return navigation ? navigation.onDispose(stopLocale) : stopLocale;
}
