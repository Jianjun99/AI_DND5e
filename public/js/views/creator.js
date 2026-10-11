import { displayLabel,  contentText, contentLabel,  t, label, localizeText, translateDOM, onLocaleChange } from "../i18n.js";
// creator.js — multi-step character builder (D&D 2024)
import { api } from '../api.js';
import { esc, toast, state as appState } from '../app.js';

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABIL_NAMES = { str: 'ui.creator.strength', dex: 'ui.creator.dexterity', con: 'ui.creator.constitution', int: 'ui.creator.intelligence', wis: 'ui.creator.wisdom', cha: 'ui.creator.charisma' };
const mod = s => Math.floor((s - 10) / 2);
const fmt = m => (m >= 0 ? '+' : '') + m;
const skillName = s => t('content.skill.'+s);

const STEPS = ['ui.creator.identity', 'ui.creator.species', 'ui.creator.class', 'ui.creator.background', 'ui.creator.ability_scores', 'ui.creator.equipment', 'ui.creator.review'];

/** @param {import('../navigation.js').Navigation} navigation */
export async function creatorView(main, navigation) {
  const rules = appState.rules;
  const draft = {
    name: '', species: null, speciesChoices: {}, className: null, background: null,
    bgPlus2: null, bgPlus1: null, skills: [], extraSkills: [],
    method: 'array', baseScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    fightingStyle: null, invocations: [], cantrips: [], spells: [],
    armorOption: null, weaponOption: null
  };
  let step = 0;

  function wizardHeader() {
    return `<div class="wizard-steps">${STEPS.map((s, i) =>
      `<span class="step ${i === step ? 'active' : i < step ? 'done' : ''}">${i + 1}. ${label(s)}</span>`).join('')}</div>`;
  }

  function render() {
    main.innerHTML = `
      <h1>${label("ui.creator.create_your_hero")}</h1>
      ${wizardHeader()}
      <div class="grid creator-layout">
        <div id="stepBody"></div>
        <div class="preview-panel">${previewHtml()}</div>
      </div>
      <div class="creator-footer">
        <button class="btn" id="backBtn" ${step === 0 ? 'disabled' : ''}>${label("ui.creator.back")}</button>
        ${step < STEPS.length - 1
          ? `<button class="btn primary" id="nextBtn">${label("ui.creator.next")}</button>`
          : `<button class="btn primary big" id="saveBtn">${label("ui.creator.forge_hero_enter_the_crypt")}</button>`}
      </div>`;

    const body = document.getElementById('stepBody');
    const renderers = [stepName, stepSpecies, stepClass, stepBackground, stepAbilities, stepEquipment, stepReview];
    renderers[step](body);
    wireCommon();
  }

  function wireCommon() {
    document.getElementById('backBtn').addEventListener('click', () => { step = Math.max(0, step - 1); render(); });
    const next = document.getElementById('nextBtn');
    if (next) next.addEventListener('click', () => {
      const err = validate(step);
      if (err) return toast(() => validate(step));
      step++; render();
    });
    const save = /** @type {HTMLButtonElement} */ (document.getElementById('saveBtn'));
    if (save) save.addEventListener('click', async () => {
      const err = validate(6);
      if (err) return toast(() => validate(6));
      save.disabled = true;
      localizeText(save, () => t("ui.creator.forging_hero"));
      try {
        const char = await api.createCharacter(draft);
        if (!navigation.isCurrent()) return;
        toast(() => t('ui.common.ready', { name: (char.nameDisplay || char.name) }));
        location.hash = `#/overworld?char=${char.id}`;
      } catch (e) {
        if (!navigation.isCurrent()) return;
        toast(() => e.message);
        save.disabled = false;
        localizeText(save, () => t("ui.creator.descend"));
      }
    });
  }

  function validate(s) {
    if (s === 0 && !draft.name.trim()) return t("ui.creator.give_your_hero_a_name");
    if (s === 1 && !draft.species) return t("ui.creator.choose_a_species");
    if (s === 2 && !draft.className) return t("ui.creator.choose_a_class");
    if (s === 3 && !draft.background) return t("ui.creator.choose_a_background");
    if (s === 5 && (!draft.armorOption || !draft.weaponOption)) return t("ui.creator.choose_your_starting_equipment");
    return null;
  }

  // ---------------- preview sidebar ----------------
  function previewHtml() {
    const scores = draft.baseScores;
    let a = { ...scores };
    if (draft.bgPlus2) a[draft.bgPlus2] += 2;
    if (draft.bgPlus1 === 'all3' && draft.background) {
      const bg = rules.backgrounds.find(b => b.id === draft.background);
      if (bg) bg.abilities.forEach(x => a[x] += 1);
    } else if (draft.bgPlus1) a[draft.bgPlus1] += 1;
    const cls = rules.classes.find(c => c.id === draft.className);
    const hp = cls ? Math.max(1, cls.hitDie + mod(a.con)) : '—';
    const armor = cls && (cls.armorOptions || []).find(o => o.id === draft.armorOption);
    return `
      <div class="card">
        <h3>${draft.name.trim() ? esc(draft.name) : label("ui.creator.your_hero")}</h3>
        <p class="muted small">${draft.className ? esc(rules.classes.find(c => c.id === draft.className).name) : label("ui.creator.class_2")} ·
           ${draft.species ? esc(rules.species.find(s => s.id === draft.species).name) : label("ui.creator.species_2")} ·
           ${draft.background ? esc(rules.backgrounds.find(b => b.id === draft.background).name) : label("ui.creator.background_2")}</p>
        <div class="ability-grid">
          ${ABILS.map(k => `<div class="ability-box"><div class="abbr">${k.toUpperCase()}</div><div class="score">${a[k]}</div><div class="mod">${fmt(mod(a[k]))}</div></div>`).join('')}
        </div>
        <div style="margin-top:10px;">
          <div class="stat-line"><span>${label("ui.creator.hit_points_l1")}</span><span>${hp}</span></div>
          <div class="stat-line"><span>${label("ui.creator.armor")}</span><span>${armor ? contentLabel(armor,'label') : '—'}</span></div>
          <div class="stat-line"><span>${label("ui.creator.skills")}</span><span>${(draft.skills.length + 2) || 2}+</span></div>
        </div>
      </div>`;
  }

  // ---------------- step 1: name ----------------
  function stepName(body) {
    body.innerHTML = `
      <div class="card">
        <h2>${label("ui.creator.what_is_your_hero_called")}</h2>
        <div class="field"><label>${label("ui.creator.character_name")}</label>
          <input type="text" id="nameInput" value="${esc(contentText(draft,"name"))}" maxlength="40" data-i18n-placeholder="ui.creator.e_g_kaelen_ashmoor" placeholder="${esc(t("ui.creator.e_g_kaelen_ashmoor"))}"></div>
        <p class="small muted">${label("ui.creator.you_ll_delve_into")} <b>The Sunless Crypt</b> ${label("ui.creator.alone_though_a_certain_scout_at_camp")}</p>
      </div>`;
    document.getElementById('nameInput').addEventListener('input', e => {
      draft.name = /** @type {HTMLInputElement} */ (e.target).value;
      localizeText(document.querySelector('.preview-panel h3'), () => draft.name.trim() || t("ui.creator.your_hero"));
    });
  }

  // ---------------- step 2: species ----------------
  function stepSpecies(body) {
    body.innerHTML = `<h2>${label("ui.creator.choose_your_species")}</h2><div class="grid cols3">
      ${rules.species.map(s => `
        <div class="card selectable ${draft.species === s.id ? 'selected' : ''}" data-species="${s.id}">
          <h3 style="margin-bottom:2px;">${contentLabel(s,"name")}</h3>
          <p class="small muted">${contentLabel(s,"blurb")}</p>
          <ul class="trait-list">${s.traits.map(entryText => `<li><b>${contentLabel(entryText,"name")}</b> — ${contentLabel(entryText,"desc")}</li>`).join('')}</ul>
          ${s.choices ? `<div class="small" style="margin-top:6px; color:var(--gold);">${s.choices.map(c => esc(c.label)).join(' · ')}</div>` : ''}
        </div>`).join('')}
    </div>
    <div id="speciesChoices"></div>`;
    body.querySelectorAll('[data-species]').forEach(el => el.addEventListener('click', () => {
      draft.species = el.dataset.species;
      draft.speciesChoices = {};
      render();
    }));
    renderSpeciesChoices(document.getElementById('speciesChoices'));
  }

  function renderSpeciesChoices(container) {
    if (!draft.species) { container.innerHTML = ''; return; }
    const sp = rules.species.find(s => s.id === draft.species);
    if (!sp.choices || !sp.choices.length) return;
    container.innerHTML = sp.choices.map(c => {
      if (c.type === 'skills') {
        const opts = c.options === 'any' ? Object.keys(SKILL_MAP) : c.options;
        return `<div class="card" style="margin-top:12px;"><h3>${displayLabel(c.labelDisplay,c.label)}</h3>
          <p class="small muted">${label("ui.creator.pick_skill_values", {p1: c.count, p2: ''})}</p>
          <select data-spchoice="${c.id}" multiple size="6">${opts.map(o => `<option value="${o}" data-i18n="content.skill.${o}">${esc(skillName(o))}</option>`).join('')}</select></div>`;
      }
      return `<div class="card" style="margin-top:12px;"><h3>${displayLabel(c.labelDisplay,c.label)}</h3>
        <select data-spchoice="${c.id}">${c.options.map(o => {
          const v = typeof o === 'string' ? o : o.value;
          const params = { name: typeof o === 'string' ? {key:'content.damage.'+o,fallback:o[0].toUpperCase()+o.slice(1)} : '' };
          const l = typeof o === 'string' ? t('ui.creator.ancestry', params) : o.label;
          return `<option value="${v}" ${(draft.speciesChoices[c.id] || '') === v ? 'selected' : ''} ${typeof o === 'string' ? `data-i18n="ui.creator.ancestry" data-i18n-params="${esc(JSON.stringify(params))}"` : `data-i18n-display="${esc(JSON.stringify(o.labelDisplay || {fallback:l}))}"`}>${esc(l)}</option>`;
        }).join('')}</select></div>`;
    }).join('');
    container.querySelectorAll('[data-spchoice]').forEach(sel => sel.addEventListener('change', () => {
      const key = sel.dataset.spchoice;
      const choice = sp.choices.find(c => c.id === key);
      if (choice.type === 'skills') {
        const picked = [...sel.selectedOptions].map(o => o.value).slice(0, choice.count);
        draft.speciesChoices[key] = picked;
      } else {
        draft.speciesChoices[key] = sel.value;
      }
      refreshPreview();
    }));
  }

  // ---------------- step 3: class ----------------
  function stepClass(body) {
    body.innerHTML = `<h2>${label("ui.creator.choose_your_class")}</h2><div class="grid cols3">
      ${rules.classes.map(c => `
        <div class="card selectable ${draft.className === c.id ? 'selected' : ''}" data-class="${c.id}">
          <h3 style="margin-bottom:2px;">${contentLabel(c,"name")} <span class="muted small">d${c.hitDie} · ${c.primary.toUpperCase()}</span></h3>
          <p class="small muted">${contentLabel(c,"blurb")}</p>
          <ul class="trait-list">${(c.features || []).filter(f => f.level <= 2).map(f => `<li><b>${contentLabel(f,"name")}</b> <span class="muted">${label("ui.creator.lv_values", {p1: f.level})}</span></li>`).join('')}</ul>
          ${c.spellcasting ? `<div class="chip blue">${c.spellcasting.cantrips ? label("ui.creator.cantripCount", { count: c.spellcasting.cantrips }) : ""}${label("ui.creator.caster", { ability: c.spellcasting.ability.toUpperCase() })}</div>` : ''}
        </div>`).join('')}
    </div>
    <div id="classOptions"></div>`;
    body.querySelectorAll('[data-class]').forEach(el => el.addEventListener('click', () => {
      draft.className = el.dataset.class;
      draft.fightingStyle = null; draft.invocations = []; draft.cantrips = []; draft.spells = [];
      draft.armorOption = null; draft.weaponOption = null;
      render();
    }));
    renderClassOptions(document.getElementById('classOptions'));
  }

  function renderClassOptions(container) {
    const cls = rules.classes.find(c => c.id === draft.className);
    if (!cls) { container.innerHTML = ''; return; }
    const clsSpells = rules.spells.filter(s => s.classes.includes(cls.id));
    const cantripList = clsSpells.filter(s => s.level === 0);
    const spellList = clsSpells.filter(s => s.level === 1);
    const sc = cls.spellcasting;
    container.innerHTML = `
      ${cls.fightingStyles ? `
      <div class="card" style="margin-top:12px;"><h3>${label("ui.creator.fighting_style")}</h3>
        <select id="styleSel"><option value="">${esc(t("ui.creator.choose"))}</option>
          ${cls.fightingStyles.map(s => `<option value="${s}" data-i18n="content.style.${s}" ${draft.fightingStyle === s ? 'selected' : ''}>${esc(styleName(s))}</option>`).join('')}
        </select></div>` : ''}
      ${cls.invocations ? `
      <div class="card" style="margin-top:12px;"><h3>${label("ui.creator.eldritch_invocations_pick_2")}</h3>
        ${cls.invocations.map(i => `<label style="display:block; margin:4px 0; color:var(--text);">
          <input type="checkbox" data-invoc="${i.id}" ${draft.invocations.includes(i.id) ? 'checked' : ''} style="width:auto"> <b>${contentLabel(i,"name")}</b> <span class="muted small">— ${contentLabel(i,"desc")}</span></label>`).join('')}
      </div>` : ''}
      ${sc && sc.cantrips ? `
      <div class="card" style="margin-top:12px;"><h3>${label("ui.creator.cantrips_pick_values", {p0: sc.cantrips})}</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;">
        ${cantripList.map(s => `<label style="display:block; color:var(--text); margin:3px 0;">
          <input type="checkbox" data-cantrip="${s.id}" ${draft.cantrips.includes(s.id) ? 'checked' : ''} style="width:auto"> <b>${contentLabel(s,"name")}</b> <span class="muted small">— ${contentLabel(s,"desc")}</span></label>`).join('')}
        </div></div>` : ''}
      ${sc && (sc.spellsKnown || sc.type === 'prepared') ? `
      <div class="card" style="margin-top:12px;"><h3>${label("ui.creator.first_level_spells_pick_values", {p0: sc.spellsKnown || 3})}</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;">
        ${spellList.map(s => `<label style="display:block; color:var(--text); margin:3px 0;">
          <input type="checkbox" data-spell="${s.id}" ${draft.spells.includes(s.id) ? 'checked' : ''} style="width:auto"> <b>${contentLabel(s,"name")}</b> <span class="muted small">— ${contentLabel(s,"desc")}</span></label>`).join('')}
        </div></div>` : ''}
    `;
    const styleSel = document.getElementById('styleSel');
    if (styleSel) styleSel.addEventListener('change', e => { draft.fightingStyle = /** @type {HTMLSelectElement} */ (e.target).value || null; });
    container.querySelectorAll('[data-invoc]').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) { if (draft.invocations.length < 2) draft.invocations.push(cb.dataset.invoc); else cb.checked = false; }
      else draft.invocations = draft.invocations.filter(x => x !== cb.dataset.invoc);
    }));
    container.querySelectorAll('[data-cantrip]').forEach(cb => cb.addEventListener('change', () => {
      const n = sc.cantrips;
      if (cb.checked) { if (draft.cantrips.length < n) draft.cantrips.push(cb.dataset.cantrip); else cb.checked = false; }
      else draft.cantrips = draft.cantrips.filter(x => x !== cb.dataset.cantrip);
    }));
    container.querySelectorAll('[data-spell]').forEach(cb => cb.addEventListener('change', () => {
      const n = sc.spellsKnown || 3;
      if (cb.checked) { if (draft.spells.length < n) draft.spells.push(cb.dataset.spell); else cb.checked = false; }
      else draft.spells = draft.spells.filter(x => x !== cb.dataset.spell);
    }));
  }

  // ---------------- step 4: background ----------------
  function stepBackground(body) {
    body.innerHTML = `<h2>${label("ui.creator.choose_your_background")}</h2><p class="small muted">${label("ui.creator.your_past_grants_ability_score_increases_2")}</p>
      <div class="grid cols3">
      ${rules.backgrounds.map(b => `
        <div class="card selectable ${draft.background === b.id ? 'selected' : ''}" data-bg="${b.id}">
          <h3 style="margin-bottom:2px;">${contentLabel(b,"name")}</h3>
          <p class="small muted">${contentLabel(b,"blurb")}</p>
          <div style="margin-top:6px;">
            <span class="chip">${b.abilities.map(a => a.toUpperCase()).join(' +2/+1')}</span>
          </div>
          <ul class="trait-list">
            <li><b>${label("ui.creator.skills_2")}</b> ${b.skills.map(s=>label('content.skill.'+s)).join(', ')}</li>
            <li><b>${label("ui.creator.feat")}</b> ${displayLabel(b.featNoteDisplay,b.featNote)}</li>
            <li><b>${label("ui.creator.tools")}</b> ${displayLabel(b.toolsDisplay,b.tools)}</li>
          </ul>
        </div>`).join('')}
      </div>
      <div id="bgOptions"></div>`;
    body.querySelectorAll('[data-bg]').forEach(el => el.addEventListener('click', () => {
      draft.background = el.dataset.bg;
      draft.bgPlus2 = null; draft.bgPlus1 = null; draft.extraSkills = [];
      render();
    }));
    renderBgOptions(document.getElementById('bgOptions'));
  }

  function renderBgOptions(container) {
    const bg = rules.backgrounds.find(b => b.id === draft.background);
    if (!bg) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="card" style="margin-top:12px;">
        <h3>${label("ui.creator.ability_score_increases")}</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label>${label("ui.creator.2_to")}</label>
            <select id="plus2"><option value="">—</option>${bg.abilities.map(a => `<option value="${a}" ${draft.bgPlus2 === a ? 'selected' : ''} data-i18n="${ABIL_NAMES[a]}">${esc(t(ABIL_NAMES[a]))}</option>`).join('')}</select></div>
          <div class="field"><label>${label("ui.creator.1_to")}</label>
            <select id="plus1"><option value="">—</option><option value="all3" ${draft.bgPlus1 === 'all3' ? 'selected' : ''} data-i18n="ui.creator.1_to_all_three">${esc(t("ui.creator.1_to_all_three"))}</option>${bg.abilities.filter(a => a !== draft.bgPlus2).map(a => `<option value="${a}" ${draft.bgPlus1 === a ? 'selected' : ''} data-i18n="${ABIL_NAMES[a]}">${esc(t(ABIL_NAMES[a]))}</option>`).join('')}</select></div>
        </div>
        ${rules.feats[bg.feat] && rules.feats[bg.feat].extraSkillPicks ? `
        <div class="field"><label>${label("ui.creator.pick_extra_skills_values", {p0: (rules.feats[bg.feat].nameDisplay || rules.feats[bg.feat].name), p1: rules.feats[bg.feat].extraSkillPicks})}</label>
          <select id="extraSkills" multiple size="6">${Object.keys(SKILL_MAP).map(s => `<option value="${s}" data-i18n="content.skill.${s}" ${draft.extraSkills.includes(s) ? 'selected' : ''}>${esc(skillName(s))}</option>`).join('')}</select></div>` : ''}
      </div>`;
    document.getElementById('plus2').addEventListener('change', e => { draft.bgPlus2 = /** @type {HTMLSelectElement} */ (e.target).value || null; if (draft.bgPlus1 === draft.bgPlus2) draft.bgPlus1 = null; renderBgOptions(container); refreshPreview(); });
    document.getElementById('plus1').addEventListener('change', e => { draft.bgPlus1 = /** @type {HTMLSelectElement} */ (e.target).value || null; refreshPreview(); });
    const es = /** @type {HTMLSelectElement} */ (document.getElementById('extraSkills'));
    if (es) es.addEventListener('change', () => { draft.extraSkills = [...es.selectedOptions].map(o => o.value).slice(0, rules.feats[bg.feat].extraSkillPicks || 2); });
  }

  // ---------------- step 5: abilities ----------------
  function stepAbilities(body) {
    body.innerHTML = `
      <div class="card">
        <h2>${label("ui.creator.ability_scores")}</h2>
        <div class="field">
          <label>${label("ui.creator.method")}</label>
          <select id="method">
            <option value="array" ${draft.method === 'array' ? 'selected' : ''} data-i18n="ui.creator.standard_array_15_14_13_12_10">${esc(t("ui.creator.standard_array_15_14_13_12_10"))}</option>
            <option value="roll" ${draft.method === 'roll' ? 'selected' : ''} data-i18n="ui.creator.roll_4d6_drop_lowest">${esc(t("ui.creator.roll_4d6_drop_lowest"))}</option>
            <option value="buy" ${draft.method === 'buy' ? 'selected' : ''} data-i18n="ui.creator.point_buy_27_points">${esc(t("ui.creator.point_buy_27_points"))}</option>
          </select>
        </div>
        <div id="rollRow" style="margin: 8px 0;"></div>
        <p class="small muted">${label("ui.creator.assign_each_score_to_an_ability_background")}</p>
        <div class="ability-grid" style="margin-top:10px;">
        ${ABILS.map(k => `
          <div class="ability-box">
            <div class="abbr">${k.toUpperCase()}</div>
            <select data-assign="${k}">${[15, 14, 13, 12, 11, 10, 9, 8].map(v => {
              const mine = draft.baseScores[k] === v;
              return `<option value="${v}" ${mine ? 'selected' : ''}>${v}</option>`;
            }).join('')}</select>
            <div class="mod">${fmt(mod(draft.baseScores[k] + bgBonus(k)))}</div>
          </div>`).join('')}
        </div>
        <p class="small muted" id="buyInfo" style="margin-top:8px;"></p>
      </div>`;
    const refreshValues = () => {
      localizeText(document.getElementById('buyInfo'), () => draft.method === 'buy' ? t('ui.creator.points', { points: pointCost() }) : '');
      refreshPreview();
    };
    document.getElementById('method').addEventListener('change', e => {
      draft.method = /** @type {HTMLSelectElement} */ (e.target).value;
      if (draft.method === 'array') draft.baseScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
      if (draft.method === 'buy') draft.baseScores = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      if (draft.method === 'roll') { draft.baseScores = roll4d6(); }
      render(); refreshValues();
    });
    const rollRow = document.getElementById('rollRow');
    if (draft.method === 'roll') {
      rollRow.innerHTML = `<button class="btn small" id="rerollBtn">${label("ui.creator.re_roll_4d6_drop_lowest_6")}</button>
        <span class="small muted" style="margin-left:8px;">${label("ui.creator.currentRoll")}${ABILS.map(k => draft.baseScores[k]).join(", ")}</span>`;
      document.getElementById('rerollBtn').addEventListener('click', () => { draft.baseScores = roll4d6(); render(); });
    }
    refreshValues();
    body.querySelectorAll('[data-assign]').forEach(sel => sel.addEventListener('change', e => {
      const k = e.target.dataset.assign;
      let v = +e.target.value;
      if (draft.method === 'buy') v = Math.max(8, Math.min(15, v));
      // swap with whoever had that value
      const holder = ABILS.find(o => draft.baseScores[o] === v && o !== k);
      const old = draft.baseScores[k];
      if (holder) draft.baseScores[holder] = old;
      draft.baseScores[k] = v;
      render();
    }));
  }

  function bgBonus(k) {
    if (!draft.background) return 0;
    const bg = rules.backgrounds.find(b => b.id === draft.background);
    if (!bg.abilities.includes(k)) return 0;
    if (draft.bgPlus2 === k) return 2;
    if (draft.bgPlus1 === 'all3') return 1;
    if (draft.bgPlus1 === k) return 1;
    return 0;
  }
  function roll4d6() {
    const rolls = ABILS.map(() => {
      const r = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => b - a);
      return r[0] + r[1] + r[2];
    }).sort((a, b) => b - a);
    const out = /** @type {{ str: number, dex: number, con: number, int: number, wis: number, cha: number }} */ ({}); ABILS.forEach((k, i) => out[k] = rolls[i]);
    return out;
  }
  function pointCost() {
    const costs = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    return ABILS.reduce((s, k) => s + (costs[draft.baseScores[k]] ?? 0), 0);
  }

  // ---------------- step 6: equipment ----------------
  function stepEquipment(body) {
    const cls = rules.classes.find(c => c.id === draft.className);
    body.innerHTML = `<h2>${label("ui.creator.starting_equipment")}</h2><p class="small muted">${label("ui.creator.startingItems")}${draft.background === 'crafter' ? label("ui.creator.crafter_adds_2_more_potions") : ''}.</p>
      <div class="grid cols2">
        <div><h3>${label("ui.creator.armor")}</h3><div class="grid">
          ${(cls.armorOptions || []).map(o => `<div class="card selectable ${draft.armorOption === o.id ? 'selected' : ''}" data-armor="${o.id}">
            <b>${displayLabel(o.labelDisplay,o.label)}</b></div>`).join('')}
        </div></div>
        <div><h3>${label("ui.creator.weapons")}</h3><div class="grid">
          ${(cls.weaponOptions || []).map(o => `<div class="card selectable ${draft.weaponOption === o.id ? 'selected' : ''}" data-weapon="${o.id}">
            <b>${displayLabel(o.labelDisplay,o.label)}</b></div>`).join('')}
        </div></div>
      </div>`;
    body.querySelectorAll('[data-armor]').forEach(el => el.addEventListener('click', () => { draft.armorOption = el.dataset.armor; render(); }));
    body.querySelectorAll('[data-weapon]').forEach(el => el.addEventListener('click', () => { draft.weaponOption = el.dataset.weapon; render(); }));
  }

  // ---------------- step 7: review ----------------
  function stepReview(body) {
    const a = { ...draft.baseScores };
    ABILS.forEach(k => a[k] += bgBonus(k));
    const cls = rules.classes.find(c => c.id === draft.className);
    const sp = rules.species.find(s => s.id === draft.species);
    const bg = rules.backgrounds.find(b => b.id === draft.background);
    const allSkills = [...new Set([...bg.skills, ...draft.skills, ...draft.extraSkills, ...(draft.speciesChoices.keen_senses || []), ...(draft.speciesChoices.versatility || [])])];
    body.innerHTML = `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h2 style="margin-bottom:2px;">${label("ui.creator.review_level_1_values", {p0: (draft.nameDisplay || draft.name), p1: (sp.nameDisplay || sp.name), p2: (cls.nameDisplay || cls.name)})}</h2>
            <p class="small muted" style="margin:0;">${label("ui.creator.background_feat_values", {p3: (bg.nameDisplay || bg.name), p4: bg.featNote})}</p>
          </div>
          <div style="display:flex; align-items:center; gap:8px; padding:4px 10px; border:1px solid var(--border); border-radius:8px; background:var(--bg2);">
            <span style="font-size:24px;">${{
              barbarian: '🪓', bard: '🪕', cleric: '✨', druid: '🌿', fighter: '🛡️',
              monk: '🥋', paladin: '⚔️', ranger: '🏹', rogue: '🗡️', sorcerer: '🔮',
              warlock: '👁️', wizard: '📜'
            }[draft.className] || '🗡️'}</span>
            <span class="small" style="color:var(--gold);">${label("ui.creator.portrait_ready")}</span>
          </div>
        </div>
        <div class="ability-grid" style="margin:10px 0;">
          ${ABILS.map(k => `<div class="ability-box"><div class="abbr">${k.toUpperCase()}</div><div class="score">${a[k]}</div><div class="mod">${fmt(mod(a[k]))}</div></div>`).join('')}
        </div>
        <div class="stat-line"><span>${label("ui.creator.hit_points")}</span><span>${label("ui.creator.species_feat_bonuses_values", {p9: Math.max(1, cls.hitDie + mod(a.con))})}</span></div>
        <div class="stat-line"><span>${label("ui.creator.equipment")}</span><span>${displayLabel(((cls.armorOptions || []).find(o => o.id === draft.armorOption) || {}).labelDisplay,((cls.armorOptions || []).find(o => o.id === draft.armorOption) || {}).label || '')} · ${displayLabel(((cls.weaponOptions || []).find(o => o.id === draft.weaponOption) || {}).labelDisplay,((cls.weaponOptions || []).find(o => o.id === draft.weaponOption) || {}).label || '')}</span></div>
        <div class="stat-line"><span>${label("ui.creator.skills")}</span><span>${allSkills.map(s=>label('content.skill.'+s)).join(', ')}</span></div>
        ${draft.cantrips.length ? `<div class="stat-line"><span>${label("ui.creator.cantrips_2")}</span><span>${draft.cantrips.map(c => (rules.spells.find(s => s.id === c) || {}).name).join(', ')}</span></div>` : ''}
        ${draft.spells.length ? `<div class="stat-line"><span>${label("ui.creator.spells")}</span><span>${draft.spells.map(c => (rules.spells.find(s => s.id === c) || {}).name).join(', ')}</span></div>` : ''}
        <p class="small muted" style="margin-top:10px;">${label("ui.creator.your_hero_s_unique_portrait_will_be")}</p>
      </div>`;
  }

  function refreshPreview() {
    document.querySelector('.preview-panel').innerHTML = previewHtml();
  }

  function refreshLocalizedText() { translateDOM(main); }
  const stopLocale = onLocaleChange(refreshLocalizedText);
  render();
  return navigation.onDispose(stopLocale);
}

const SKILL_MAP = {
  acrobatics: 1, animal_handling: 1, arcana: 1, athletics: 1, deception: 1, history: 1, insight: 1,
  intimidation: 1, investigation: 1, medicine: 1, nature: 1, perception: 1, performance: 1,
  persuasion: 1, religion: 1, sleight_of_hand: 1, stealth: 1, survival: 1
};

function styleName(s) {
  return t('content.style.'+s);
}
