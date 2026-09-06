// creator.js — multi-step character builder (D&D 2024)
import { api } from '../api.js';
import { esc, toast, state as appState, navigate } from '../app.js';

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABIL_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const mod = s => Math.floor((s - 10) / 2);
const fmt = m => (m >= 0 ? '+' : '') + m;
const skillName = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

const STEPS = ['Identity', 'Species', 'Class', 'Background', 'Ability Scores', 'Equipment', 'Review'];

export async function creatorView(main) {
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
      `<span class="step ${i === step ? 'active' : i < step ? 'done' : ''}">${i + 1}. ${s}</span>`).join('')}</div>`;
  }

  function render() {
    main.innerHTML = `
      <h1>Create Your Hero</h1>
      ${wizardHeader()}
      <div class="grid" style="grid-template-columns: 1fr 300px; align-items:start;">
        <div id="stepBody"></div>
        <div class="preview-panel">${previewHtml()}</div>
      </div>
      <div class="creator-footer">
        <button class="btn" id="backBtn" ${step === 0 ? 'disabled' : ''}>← Back</button>
        ${step < STEPS.length - 1
          ? '<button class="btn primary" id="nextBtn">Next →</button>'
          : '<button class="btn primary big" id="saveBtn">⚔ Forge Hero & Enter the Crypt</button>'}
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
      if (err) return toast(err);
      step++; render();
    });
    const save = document.getElementById('saveBtn');
    if (save) save.addEventListener('click', async () => {
      const err = validate(6);
      if (err) return toast(err);
      try {
        const char = await api.createCharacter(draft);
        toast(`${char.name} is ready!`);
        location.hash = `#/play/new?char=${char.id}`;
      } catch (e) { toast(e.message); }
    });
  }

  function validate(s) {
    if (s === 0 && !draft.name.trim()) return 'Give your hero a name.';
    if (s === 1 && !draft.species) return 'Choose a species.';
    if (s === 2 && !draft.className) return 'Choose a class.';
    if (s === 3 && !draft.background) return 'Choose a background.';
    if (s === 5 && (!draft.armorOption || !draft.weaponOption)) return 'Choose your starting equipment.';
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
        <h3>${draft.name.trim() ? esc(draft.name) : 'Your Hero'}</h3>
        <p class="muted small">${draft.className ? esc(rules.classes.find(c => c.id === draft.className).name) : 'class?'} ·
           ${draft.species ? esc(rules.species.find(s => s.id === draft.species).name) : 'species?'} ·
           ${draft.background ? esc(rules.backgrounds.find(b => b.id === draft.background).name) : 'background?'}</p>
        <div class="ability-grid">
          ${ABILS.map(k => `<div class="ability-box"><div class="abbr">${k.toUpperCase()}</div><div class="score">${a[k]}</div><div class="mod">${fmt(mod(a[k]))}</div></div>`).join('')}
        </div>
        <div style="margin-top:10px;">
          <div class="stat-line"><span>Hit Points (L1)</span><span>${hp}</span></div>
          <div class="stat-line"><span>Armor</span><span>${armor ? esc(armor.label.split(' (')[0]) : '—'}</span></div>
          <div class="stat-line"><span>Skills</span><span>${(draft.skills.length + 2) || 2}+</span></div>
        </div>
      </div>`;
  }

  // ---------------- step 1: name ----------------
  function stepName(body) {
    body.innerHTML = `
      <div class="card">
        <h2>What is your hero called?</h2>
        <div class="field"><label>Character name</label>
          <input type="text" id="nameInput" value="${esc(draft.name)}" maxlength="40" placeholder="e.g. Kaelen Ashmoor"></div>
        <p class="small muted">You'll delve into <b>The Sunless Crypt</b> alone — though a certain scout at camp may join you, if you ask nicely.</p>
      </div>`;
    document.getElementById('nameInput').addEventListener('input', e => {
      draft.name = e.target.value;
      document.querySelector('.preview-panel h3').textContent = draft.name.trim() || 'Your Hero';
    });
  }

  // ---------------- step 2: species ----------------
  function stepSpecies(body) {
    body.innerHTML = `<h2>Choose your species</h2><div class="grid cols3">
      ${rules.species.map(s => `
        <div class="card selectable ${draft.species === s.id ? 'selected' : ''}" data-species="${s.id}">
          <h3 style="margin-bottom:2px;">${s.name}</h3>
          <p class="small muted">${esc(s.blurb)}</p>
          <ul class="trait-list">${s.traits.map(t => `<li><b>${t.name}</b> — ${esc(t.desc)}</li>`).join('')}</ul>
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
        return `<div class="card" style="margin-top:12px;"><h3>${esc(c.label)}</h3>
          <p class="small muted">Pick ${c.count} skill${c.count > 1 ? 's' : ''}.</p>
          <select data-spchoice="${c.id}" multiple size="6">${opts.map(o => `<option value="${o}">${skillName(o)}</option>`).join('')}</select></div>`;
      }
      return `<div class="card" style="margin-top:12px;"><h3>${esc(c.label)}</h3>
        <select data-spchoice="${c.id}">${c.options.map(o => {
          const v = typeof o === 'string' ? o : o.value;
          const l = typeof o === 'string' ? `${o[0].toUpperCase() + o.slice(1)} ancestry` : o.label;
          return `<option value="${v}" ${(draft.speciesChoices[c.id] || '') === v ? 'selected' : ''}>${esc(l)}</option>`;
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
    const cls = rules.classes.find(c => c.id === draft.className);
    body.innerHTML = `<h2>Choose your class</h2><div class="grid cols3">
      ${rules.classes.map(c => `
        <div class="card selectable ${draft.className === c.id ? 'selected' : ''}" data-class="${c.id}">
          <h3 style="margin-bottom:2px;">${c.name} <span class="muted small">d${c.hitDie} · ${c.primary.toUpperCase()}</span></h3>
          <p class="small muted">${esc(c.blurb)}</p>
          <ul class="trait-list">${(c.features || []).filter(f => f.level <= 2).map(f => `<li><b>${f.name}</b> <span class="muted">(lv ${f.level})</span></li>`).join('')}</ul>
          ${c.spellcasting ? `<div class="chip blue">${c.spellcasting.cantrips ? c.spellcasting.cantrips + ' cantrips · ' : ''}spellcaster (${c.spellcasting.ability.toUpperCase()})</div>` : ''}
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
      <div class="card" style="margin-top:12px;"><h3>Fighting Style</h3>
        <select id="styleSel"><option value="">— choose —</option>
          ${cls.fightingStyles.map(s => `<option value="${s}" ${draft.fightingStyle === s ? 'selected' : ''}>${styleName(s)}</option>`).join('')}
        </select></div>` : ''}
      ${cls.invocations ? `
      <div class="card" style="margin-top:12px;"><h3>Eldritch Invocations — pick 2</h3>
        ${cls.invocations.map(i => `<label style="display:block; margin:4px 0; color:var(--text);">
          <input type="checkbox" data-invoc="${i.id}" ${draft.invocations.includes(i.id) ? 'checked' : ''} style="width:auto"> <b>${i.name}</b> <span class="muted small">— ${esc(i.desc)}</span></label>`).join('')}
      </div>` : ''}
      ${sc && sc.cantrips ? `
      <div class="card" style="margin-top:12px;"><h3>Cantrips — pick ${sc.cantrips}</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;">
        ${cantripList.map(s => `<label style="display:block; color:var(--text); margin:3px 0;">
          <input type="checkbox" data-cantrip="${s.id}" ${draft.cantrips.includes(s.id) ? 'checked' : ''} style="width:auto"> <b>${s.name}</b> <span class="muted small">— ${esc(s.desc)}</span></label>`).join('')}
        </div></div>` : ''}
      ${sc && (sc.spellsKnown || sc.type === 'prepared') ? `
      <div class="card" style="margin-top:12px;"><h3>First-level spells — pick ${sc.spellsKnown || 3}</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;">
        ${spellList.map(s => `<label style="display:block; color:var(--text); margin:3px 0;">
          <input type="checkbox" data-spell="${s.id}" ${draft.spells.includes(s.id) ? 'checked' : ''} style="width:auto"> <b>${s.name}</b> <span class="muted small">— ${esc(s.desc)}</span></label>`).join('')}
        </div></div>` : ''}
    `;
    const styleSel = document.getElementById('styleSel');
    if (styleSel) styleSel.addEventListener('change', e => { draft.fightingStyle = e.target.value || null; });
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
    body.innerHTML = `<h2>Choose your background</h2><p class="small muted">Your past grants ability score increases (+2 and +1 from its three abilities, or +1 to all three), two skills, tools, and an origin feat.</p>
      <div class="grid cols3">
      ${rules.backgrounds.map(b => `
        <div class="card selectable ${draft.background === b.id ? 'selected' : ''}" data-bg="${b.id}">
          <h3 style="margin-bottom:2px;">${b.name}</h3>
          <p class="small muted">${esc(b.blurb)}</p>
          <div style="margin-top:6px;">
            <span class="chip">${b.abilities.map(a => a.toUpperCase()).join(' +2/+1')}</span>
          </div>
          <ul class="trait-list">
            <li><b>Skills:</b> ${b.skills.map(skillName).join(', ')}</li>
            <li><b>Feat:</b> ${esc(b.featNote)}</li>
            <li><b>Tools:</b> ${esc(b.tools)}</li>
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
        <h3>Ability Score Increases</h3>
        <div class="grid" style="grid-template-columns:1fr 1fr;">
          <div class="field"><label>+2 to…</label>
            <select id="plus2"><option value="">—</option>${bg.abilities.map(a => `<option value="${a}" ${draft.bgPlus2 === a ? 'selected' : ''}>${ABIL_NAMES[a]}</option>`).join('')}</select></div>
          <div class="field"><label>+1 to…</label>
            <select id="plus1"><option value="">—</option><option value="all3" ${draft.bgPlus1 === 'all3' ? 'selected' : ''}>+1 to all three</option>${bg.abilities.filter(a => a !== draft.bgPlus2).map(a => `<option value="${a}" ${draft.bgPlus1 === a ? 'selected' : ''}>${ABIL_NAMES[a]}</option>`).join('')}</select></div>
        </div>
        ${rules.feats[bg.feat] && rules.feats[bg.feat].extraSkillPicks ? `
        <div class="field"><label>${rules.feats[bg.feat].name}: pick ${rules.feats[bg.feat].extraSkillPicks} extra skills</label>
          <select id="extraSkills" multiple size="6">${Object.keys(SKILL_MAP).map(s => `<option value="${s}" ${draft.extraSkills.includes(s) ? 'selected' : ''}>${skillName(s)}</option>`).join('')}</select></div>` : ''}
      </div>`;
    document.getElementById('plus2').addEventListener('change', e => { draft.bgPlus2 = e.target.value || null; if (draft.bgPlus1 === draft.bgPlus2) draft.bgPlus1 = null; renderBgOptions(container); refreshPreview(); });
    document.getElementById('plus1').addEventListener('change', e => { draft.bgPlus1 = e.target.value || null; refreshPreview(); });
    const es = document.getElementById('extraSkills');
    if (es) es.addEventListener('change', () => { draft.extraSkills = [...es.selectedOptions].map(o => o.value).slice(0, 2); });
  }

  // ---------------- step 5: abilities ----------------
  function stepAbilities(body) {
    const ARR = [15, 14, 13, 12, 10, 8];
    const used = Object.values(draft.baseScores);
    body.innerHTML = `
      <div class="card">
        <h2>Ability Scores</h2>
        <div class="field">
          <label>Method</label>
          <select id="method">
            <option value="array" ${draft.method === 'array' ? 'selected' : ''}>Standard array (15, 14, 13, 12, 10, 8)</option>
            <option value="roll" ${draft.method === 'roll' ? 'selected' : ''}>Roll 4d6, drop lowest</option>
            <option value="buy" ${draft.method === 'buy' ? 'selected' : ''}>Point buy (27 points)</option>
          </select>
        </div>
        <div id="rollRow" style="margin: 8px 0;"></div>
        <p class="small muted">Assign each score to an ability. Background bonuses are applied on top (see preview).</p>
        <div class="ability-grid" style="margin-top:10px;">
        ${ABILS.map(k => `
          <div class="ability-box">
            <div class="abbr">${k.toUpperCase()}</div>
            <select data-assign="${k}">${[15, 14, 13, 12, 11, 10, 9, 8].map(v => {
              const taken = used.filter(x => x === v).length;
              const mine = draft.baseScores[k] === v;
              return `<option value="${v}" ${mine ? 'selected' : ''} ${!mine && taken >= used.filter(x => x === draft.baseScores[k]).length && draft.method !== 'buy' ? '' : ''}>${v}</option>`;
            }).join('')}</select>
            <div class="mod">${fmt(mod(draft.baseScores[k] + bgBonus(k)))}</div>
          </div>`).join('')}
        </div>
        <p class="small muted" id="buyInfo" style="margin-top:8px;"></p>
      </div>`;
    const refreshValues = () => {
      document.getElementById('buyInfo').textContent = draft.method === 'buy'
        ? `Points spent: ${pointCost()} / 27 (costs: 8→0, 9→1, 10→2, 11→3, 12→4, 13→5, 14→7, 15→9)`
        : '';
      refreshPreview();
    };
    document.getElementById('method').addEventListener('change', e => {
      draft.method = e.target.value;
      if (draft.method === 'array') draft.baseScores = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
      if (draft.method === 'buy') draft.baseScores = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
      if (draft.method === 'roll') { draft.baseScores = roll4d6(); }
      render(); refreshValues();
    });
    const rollRow = document.getElementById('rollRow');
    if (draft.method === 'roll') {
      rollRow.innerHTML = `<button class="btn small" id="rerollBtn">🎲 Re-roll (4d6 drop lowest ×6)</button>
        <span class="small muted" style="margin-left:8px;">Current roll: ${ABILS.map(k => draft.baseScores[k]).join(', ')}</span>`;
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
    const out = {}; ABILS.forEach((k, i) => out[k] = rolls[i]);
    return out;
  }
  function pointCost() {
    const costs = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    return ABILS.reduce((s, k) => s + (costs[draft.baseScores[k]] ?? 0), 0);
  }

  // ---------------- step 6: equipment ----------------
  function stepEquipment(body) {
    const cls = rules.classes.find(c => c.id === draft.className);
    body.innerHTML = `<h2>Starting equipment</h2><p class="small muted">You also carry 2 Potions of Healing and 50 gold pieces${draft.background === 'crafter' ? ' (Crafter adds 2 more potions)' : ''}.</p>
      <div class="grid cols2">
        <div><h3>Armor</h3><div class="grid">
          ${(cls.armorOptions || []).map(o => `<div class="card selectable ${draft.armorOption === o.id ? 'selected' : ''}" data-armor="${o.id}">
            <b>${esc(o.label)}</b></div>`).join('')}
        </div></div>
        <div><h3>Weapons</h3><div class="grid">
          ${(cls.weaponOptions || []).map(o => `<div class="card selectable ${draft.weaponOption === o.id ? 'selected' : ''}" data-weapon="${o.id}">
            <b>${esc(o.label)}</b></div>`).join('')}
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
        <h2>Review: ${esc(draft.name)} — Level 1 ${sp.name} ${cls.name}</h2>
        <p class="small muted">${bg.name} background · feat: ${esc(bg.featNote)}</p>
        <div class="ability-grid" style="margin:10px 0;">
          ${ABILS.map(k => `<div class="ability-box"><div class="abbr">${k.toUpperCase()}</div><div class="score">${a[k]}</div><div class="mod">${fmt(mod(a[k]))}</div></div>`).join('')}
        </div>
        <div class="stat-line"><span>Hit Points</span><span>${Math.max(1, cls.hitDie + mod(a.con))} + species/feat bonuses</span></div>
        <div class="stat-line"><span>Equipment</span><span>${esc(((cls.armorOptions || []).find(o => o.id === draft.armorOption) || {}).label || '')} · ${esc(((cls.weaponOptions || []).find(o => o.id === draft.weaponOption) || {}).label || '')}</span></div>
        <div class="stat-line"><span>Skills</span><span>${allSkills.map(skillName).join(', ')}</span></div>
        ${draft.cantrips.length ? `<div class="stat-line"><span>Cantrips</span><span>${draft.cantrips.map(c => (rules.spells.find(s => s.id === c) || {}).name).join(', ')}</span></div>` : ''}
        ${draft.spells.length ? `<div class="stat-line"><span>Spells</span><span>${draft.spells.map(c => (rules.spells.find(s => s.id === c) || {}).name).join(', ')}</span></div>` : ''}
        <p class="small muted" style="margin-top:10px;">Everything is final once you descend — the crypt does not offer respecs.</p>
      </div>`;
  }

  function refreshPreview() {
    document.querySelector('.preview-panel').innerHTML = previewHtml();
  }

  render();
}

const SKILL_MAP = {
  acrobatics: 1, animal_handling: 1, arcana: 1, athletics: 1, deception: 1, history: 1, insight: 1,
  intimidation: 1, investigation: 1, medicine: 1, nature: 1, perception: 1, performance: 1,
  persuasion: 1, religion: 1, sleight_of_hand: 1, stealth: 1, survival: 1
};

function styleName(s) {
  return {
    archery: 'Archery (+2 to hit at range)', defense: 'Defense (+1 AC)',
    dueling: 'Dueling (+2 damage, one-handed weapon)', great_weapon: 'Great Weapon Fighting (reroll 1s & 2s on damage)',
    two_weapon: 'Two-Weapon Fighting (add ability mod to off-hand damage)'
  }[s] || s;
}
