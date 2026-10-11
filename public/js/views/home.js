import { contentLabel,  t, label, localizeText, translateDOM, onLocaleChange, getLocale, displayLabel, displayText } from "../i18n.js";
// home.js — character portal: list characters, create, resume delves, packs, backup
import { esc, toast, navigate } from '../app.js';
import { api } from '../api.js';

/** @param {import('../navigation.js').Navigation} navigation */
export async function homeView(main, navigation) {
  const [chars, saves] = await Promise.all([apiListCharacters(), apiListSaves()]);
  if (!navigation.isCurrent()) return undefined;
  const savesByChar = {};
  saves.forEach(s => { (savesByChar[s.characterId] = savesByChar[s.characterId] || []).push(s); });
  Object.values(savesByChar).forEach(list => list.sort((a, b) => b.updatedAt - a.updatedAt));

  const presetList = (window.__rules && window.__rules.presets) || [];
  main.innerHTML = `
    <div class="hero">
      <h1>AI Dungeon</h1>
      <p>${label("ui.home.a_solo_d_d_2024_rules_delve")} <b>The Sunless Crypt</b> ${label("ui.home.and_beyond_create_a_hero_brave_the")}</p>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin: 18px 0 10px;">
      <h2 style="margin:0;">${label("ui.home.your_heroes")}</h2>
      <a class="btn primary" href="#/create">${label("ui.home.create_character")}</a>
    </div>
    ${chars.length ? `<div class="grid cols3">${chars.map(c => charCard(c, savesByChar[c.id] || [])).join('')}</div>`
      : ''}
    ${presetList.length ? quickStartHtml(presetList, chars.length === 0) : ''}
    ${!chars.length && !presetList.length ? `
      <div class="card" style="text-align:center; padding:40px;">
        <p class="muted">${label("ui.home.no_heroes_yet_every_legend_starts_with")}</p>
        <p style="margin-top:14px;"><a class="btn primary big" href="#/create">${label("ui.home.create_your_first_hero")}</a></p>
      </div>` : ''}

    <div class="card" style="margin-top:18px;">
      <h3>${label("ui.home.content_packs")}</h3>
      <p class="small muted" style="margin-bottom:10px;">${label("ui.home.add_community_made_dungeons_and_monsters_import")} <a href="https://github.com/Jianjun99/AI_DND5e/blob/main/MODDING.md" target="_blank">${label("ui.home.write_your_own")}</a>.</p>
      <div id="packList" class="small" style="margin-bottom:10px;"></div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="packImportBtn">${label("ui.home.import_pack")}</button>
        <a class="btn primary" href="#/author">${label('ui.home.author_studio')}</a>
        <a class="btn" href="#/visuals">${label('visual.title')}</a>
        <input type="file" id="packFile" hidden accept=".json,application/json">
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <h3 style="margin-bottom:2px;">${label("ui.home.backup_restore")}</h3>
          <p class="small muted" style="margin:0;">${label("ui.home.download_all_heroes_delves_and_settings_as")}</p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn" id="exportBtn">${label("ui.home.export_everything")}</button>
          <button class="btn" id="importBtn">${label("ui.home.import_backup")}</button>
          <input type="file" id="importFile" hidden accept=".json,application/json">
        </div>
      </div>
    </div>
  `;

  async function apiListCharacters() { return api.listCharacters(); }
  async function apiListSaves() { return api.listSaves(); }

  // ---- T5 quick start: pick a server-defined preset, name it, head to the prepare page ----
  let selectedPreset = presetList[0] ? presetList[0].id : null;
  const nameInput = /** @type {HTMLInputElement | null} */ (document.getElementById('quickName'));
  main.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => {
    selectedPreset = el.getAttribute('data-preset');
    main.querySelectorAll('[data-preset]').forEach(entryText => entryText.classList.toggle('selected', entryText === el));
    // follow the preset's default name unless the player already typed their own
    if (nameInput && (!nameInput.value.trim() || presetList.some(p => p.defaultName === nameInput.value.trim()))) {
      const p = presetList.find(x => x.id === selectedPreset);
      if (p) nameInput.value = p.defaultName;
    }
  }));
  if (nameInput && !nameInput.value) {
    const p = presetList.find(x => x.id === selectedPreset);
    if (p) nameInput.value = p.defaultName;
  }
  const quickBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('quickStartBtn'));
  if (quickBtn) quickBtn.addEventListener('click', async () => {
    const preset = presetList.find(p => p.id === selectedPreset);
    if (!preset) return;
    quickBtn.disabled = true;
    localizeText(quickBtn, () => t("ui.home.forging_hero"));
    try {
      const char = await api.createCharacter({
        presetId: preset.id,
        name: nameInput ? nameInput.value.trim() : ''
      });
      if (!navigation.isCurrent()) return;
      toast(() => t('ui.common.ready', { name: (char.nameDisplay || char.name) }));
      // straight to the SAME prepare entrance the guidance uses — the player still picks
      // difficulty / companion and presses Embark there (never auto-embark)
      const primary = char.guidance && char.guidance.primary;
      const node = primary && primary.kind === 'prepare' && primary.mapId ? '&node=' + encodeURIComponent(primary.mapId) : '';
      location.hash = `#/overworld?char=${char.id}${node}`;
    } catch (e) {
      if (!navigation.isCurrent()) return;
      toast(() => e.message);
      quickBtn.disabled = false;
      localizeText(quickBtn, () => t("ui.home.create_prepare"));
    }
  });

  main.querySelectorAll('[data-delsave]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(t("ui.home.abandon_this_delve_its_progress_will_be"))) return;
    await api.deleteGame(btn.dataset.delsave);
    if (!navigation.isCurrent()) return;
    toast(() => t("ui.home.delve_abandoned"));
    navigate();
  }));
  main.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm(t("ui.home.delete_this_hero_permanently_their_delves_are"))) return;
    await api.deleteCharacter(btn.dataset.del);
    if (!navigation.isCurrent()) return;
    toast(() => t("ui.home.hero_deleted"));
    navigate();
  }));

  // content packs
  (async () => {
    try {
      const c = await api.content();
      if (!navigation.isCurrent()) return;
      const list = document.getElementById('packList');
      if (!list) return;
      list.innerHTML = c.packs.map(p => `
        <div class="stat-line">
          <span><b>${contentLabel(p,"name")}</b> <span class="muted">${label("ui.home.by_values", {p1: p.author})}</span>
            <span class="muted small">— ${label("ui.home.packCounts", { maps: p.maps.length, monsters: p.monsters.length, items: p.gear.length })}${p.models?.length?' · '+label('visual.modelCount',{count:p.models.length}):''}</span></span>
          <span>${p.id !== 'core' ? `<button class="btn small" data-packexport="${esc(p.id)}">${label("ui.home.export")}</button>` : `<span class="chip">${label("ui.home.builtIn")}</span>`}</span>
        </div>`).join('');
      if (c.warnings && c.warnings.length) {
        list.innerHTML += `<p class="small" style="color:#d98a80;">⚠ ${esc(c.warnings.join(' · '))}</p>`;
      }
      list.querySelectorAll('[data-packexport]').forEach(/** @param {HTMLButtonElement} b */ b => b.addEventListener('click', async () => {
        const blob = await (await fetch(`/api/content/pack/${b.dataset.packexport}/export`, { headers: { 'X-Game-Locale': getLocale() } })).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${b.dataset.packexport}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }));
    } catch {}
  })();

  document.getElementById('packImportBtn').addEventListener('click', () => document.getElementById('packFile').click());
  document.getElementById('packFile').addEventListener('change', async e => {
    const file = /** @type {HTMLInputElement} */ (e.target).files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const out = await api.importContent(data);
      toast(() => t('ui.home.importedPack', { name: (out.pack.nameDisplay || out.pack.name), maps: out.pack.maps.length, monsters: out.pack.monsters.length }));
      navigate();
    } catch (err) {
      toast(() => err.message);
    }
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await api.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ai-dnd-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(() => t("ui.home.backup_downloaded"));
  });
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async e => {
    const file = /** @type {HTMLInputElement} */ (e.target).files[0];
    if (!file) return;
    if (!confirm(t("ui.home.importing_replaces_all_current_heroes_delves_and"))) return;
    try {
      const data = JSON.parse(await file.text());
      const out = await api.importData(data);
      toast(() => t('ui.home.importedBackup', { heroes: out.imported.characters, saves: out.imported.saves }));
      navigate();
    } catch (err) {
      toast(() => err.message);
    }
  });
  function refreshLocalizedText() { translateDOM(main); }
  const stopLocale = onLocaleChange(refreshLocalizedText);
  return navigation.onDispose(stopLocale);
}

// T5 quick start: presets are server data (window.__rules.presets) — this only renders the
// cards and sends { presetId, name }. The build happens server-side via engine.buildCharacter.
function quickStartHtml(presets, prominent) {
  return `
    <div class="card quick-start${prominent ? ' prominent' : ''}" id="quickStartCard" style="margin-top:18px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;">${prominent ? label("ui.home.quick_start_pick_a_ready_hero_and") : label("ui.home.quick_hero_creation")}</h3>
        <a class="small" href="#/create">${label("ui.home.want_full_customization_open_the_seven_step")}</a>
      </div>
      <div class="quick-start-grid">
        ${presets.map(p => `
          <div class="card selectable preset-tile ${p.id === presets[0].id ? 'selected' : ''}" data-preset="${esc(p.id)}">
            <div class="preset-head"><b>${displayLabel(p.display?.label, p.label)}</b><span class="chip gold-chip">${displayLabel(p.display?.tagline, p.tagline)}</span></div>
            <p class="small muted" style="margin:6px 0;">${displayLabel(p.display?.blurb, p.blurb)}</p>
            <ul class="trait-list">${p.tips.map((entryText, index) => `<li>${displayLabel(p.display?.tips?.[index], entryText)}</li>`).join('')}</ul>
            <div class="small muted">${label("ui.home.default_name_editable_values", {p6: p.defaultName})}</div>
          </div>`).join('')}
      </div>
      <div class="quick-start-bar">
        <input type="text" id="quickName" maxlength="40" data-i18n-placeholder="ui.home.hero_name_leave_blank_for_default" placeholder="${esc(t("ui.home.hero_name_leave_blank_for_default"))}">
        <button class="btn primary" id="quickStartBtn">${label("ui.home.create_prepare")}</button>
      </div>
      <p class="muted small" style="margin:8px 0 0;">${label("ui.home.go_straight_to_story_preparation_after_creation")}</p>
    </div>`;
}

function charCard(c, saveList) {
  const rules = window.__rules || {};
  const cls = (rules.classes || []).find(x => x.id === c.className);
  const sp = (rules.species || []).find(x => x.id === c.species);
  const clsName = cls ? cls.name : c.className;
  const spName = sp ? sp.name : c.species;
  const slots = saveList.slice(0, 3);
  const g = c.guidance || null;
  const primaryHref = guidanceHref(c, g && g.primary);
  return `
    <div class="card char-card">
      <div style="display:flex; gap:12px; align-items:center; margin-bottom:8px;">
        <img src="${c.portraitUrl || '/portraits/hero_' + c.id + '.svg'}"
             data-i18n-alt="ui.portrait.hero" alt="${esc(t('ui.portrait.hero'))}"
             style="width:48px; height:56px; object-fit:cover; border-radius:6px; border:1.5px solid var(--border); background:#15120e; flex-shrink:0;"
             onerror="this.src='/portraits/hero_${c.id}.svg'">
        <div style="min-width:0; flex:1;">
          <div class="name" style="margin:0 0 2px;">${contentLabel(c,"name")}</div>
          <div class="meta">${label("ui.home.level_xp_values", {p3: c.level, p4: spName, p5: clsName, p6: c.xp})}</div>
        </div>
      </div>
      ${g ? `
      <div class="char-guidance">
        <div class="small"><span class="chip gold-chip" data-i18n-title="ui.home.story_progress" title="${esc(t("ui.home.story_progress"))}">📜 ${displayLabel(g.labelDisplay, g.label || '')}</span>
          <span class="char-objective">🎯 ${contentLabel(g.objective,'text')}</span></div>
        <a class="btn primary" style="width:100%; margin-top:8px;" href="${primaryHref}">${g.primary ? displayLabel(g.primary.textDisplay, g.primary.text) : label("ui.home.continue_adventure")}</a>
        ${g.primary && g.primary.reason ? `<p class="muted small" style="margin:4px 0 0;">${displayLabel(g.primary.reasonDisplay, g.primary.reason)}</p>` : ''}
      </div>` : ''}
      <div class="stats">
        <span><b>${c.hpMax}</b> HP</span>
        <span><b>${c.acBase}</b> AC</span>
        <span><b>${c.gold ?? 50}</b> gp</span>
      </div>
      ${slots.length ? slots.map(sv => {
        const st = saveStatus(sv);
        return `
        <div class="stat-line" style="align-items:center;">
          <span class="muted small">${contentLabel(sv,"mapName")} · ${new Date(sv.updatedAt).toLocaleDateString()} <span class="chip ${st.cls}" style="font-size:10px; padding:0 6px;">${contentLabel(st,"text")}</span></span>
          <span style="display:flex; gap:4px;">
            <a class="btn small primary" href="#/play/${sv.id}" data-i18n-title="${st.titleKey}" title="${esc(t(st.titleKey))}">⚔</a>
            <button class="btn danger small" data-delsave="${sv.id}" data-i18n-title="ui.home.abandon_delve" title="${esc(t("ui.home.abandon_delve"))}">✕</button>
          </span>
        </div>`; }).join('') : ''}
        ${saveList.length > 3 ? `<div class="meta small muted">${label("ui.home.older_delve_s_values", {p0: saveList.length - 3})}</div>` : ''}
      ${g && (g.options || []).length ? `
      <div class="char-options">${g.options.map(o => `<a class="btn small" href="${guidanceHref(c, o)}" ${o.reasonDisplay ? `data-i18n-title="${esc(o.reasonDisplay.key)}" data-i18n-params="${esc(JSON.stringify(o.reasonDisplay.params || {}))}"` : ''} title="${esc(displayText(o.reasonDisplay, o.reason || ''))}">${displayLabel(o.textDisplay, o.text)}</a>`).join('')}</div>` : ''}
      <div class="actions">
        <a class="btn" href="#/overworld?char=${c.id}">${label("ui.home.region_map")}</a>
        <a class="btn" href="#/character/${c.id}">${label("ui.home.sheet")}</a>
        <button class="btn danger small" data-del="${c.id}">${label("ui.home.delete")}</button>
      </div>
    </div>`;
}

// Guidance actions are server data — this only maps them to hash routes.
function guidanceHref(c, action) {
  if (!action) return `#/overworld?char=${c.id}`;
  if (action.kind === 'resume' && action.saveId) return `#/play/${action.saveId}`;
  if (action.kind === 'campaign') return `#/campaign/${c.id}`;
  if (action.mapId) return `#/overworld?char=${c.id}&node=${encodeURIComponent(action.mapId)}`;
  return `#/overworld?char=${c.id}`;
}

// A delve save's state chip on the character card: running / ended-unsettled / settled.
function saveStatus(s) {
  const ended = s.mode === 'victory' || s.mode === 'retreat' || s.mode === 'over';
  if (ended && !s.settled) return { text: label("ui.home.awaiting_settlement"), cls: 'gold-chip', titleKey: "ui.home.rewards_are_not_saved_yet_open_the" };
  if (ended) return { text: label("ui.home.settled"), cls: 'green', titleKey: "ui.home.completed_and_settled_available_to_review" };
  return { text: label("ui.home.in_progress"), cls: 'blue', titleKey: "ui.home.active_delve_continue_from_your_current_position" };
}
