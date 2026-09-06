// sheet.js — character sheet display
import { api } from '../api.js';
import { esc, state as appState } from '../app.js';

const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILL_ABILITY = { acrobatics:'dex', animal_handling:'wis', arcana:'int', athletics:'str', deception:'cha', history:'int', insight:'wis', intimidation:'cha', investigation:'int', medicine:'wis', nature:'int', perception:'wis', performance:'cha', persuasion:'cha', religion:'int', sleight_of_hand:'dex', stealth:'dex', survival:'wis' };

export function modOf(score) { return Math.floor((score - 10) / 2); }
export function fmtMod(m) { return (m >= 0 ? '+' : '') + m; }
export function skillName(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export async function sheetView(main, charId) {
  const rules = appState.rules;
  const char = await api.getCharacter(charId);
  const cls = rules.classes.find(c => c.id === char.className);
  const sp = rules.species.find(s => s.id === char.species);
  const bg = rules.backgrounds.find(b => b.id === char.background);

  const skillLines = Object.keys(SKILL_ABILITY).map(sk => {
    const prof = char.skills.includes(sk);
    const exp = char.expertise.includes(sk);
    let m = modOf(char.abilities[SKILL_ABILITY[sk]]);
    if (prof) m += char.profBonus * (exp ? 2 : 1);
    return `<div class="stat-line"><span>${exp ? '⭐ ' : prof ? '• ' : '&nbsp;&nbsp;'}${skillName(sk)} <span class="muted small">(${SKILL_ABILITY[sk]})</span></span><span>${fmtMod(m)}</span></div>`;
  }).join('');

  const attacks = (char.attacks || []).map(a =>
    `<div class="stat-line"><span>${a.name} <span class="muted small">${a.dmgDice}${a.dmgMod ? fmtMod(a.dmgMod) : ''} ${a.dmgType}${a.ranged ? ' · ranged ' + a.range + 'ft' : ''}</span></span><span>${fmtMod(a.bonus)}</span></div>`
  ).join('');

  const spells = char.spellcasting ? `
    <h2>Spellcasting</h2>
    <div class="stat-line"><span>Ability / Spell DC / Spell attack</span><span>${char.spellcasting.ability.toUpperCase()} / ${char.spellcasting.saveDc} / ${fmtMod(char.spellcasting.spellAttack)}</span></div>
    <div class="stat-line"><span>Cantrips</span><span>${char.spellcasting.cantrips.map(c => (rules.spells.find(s => s.id === c) || {}).name || c).join(', ') || '—'}</span></div>
    <div class="stat-line"><span>Spells</span><span>${char.spellcasting.spells.map(c => (rules.spells.find(s => s.id === c) || {}).name || c).join(', ') || '—'}</span></div>` : '';

  const features = (cls.features || []).filter(f => f.level <= char.level).map(f =>
    `<li><b>${f.name}</b> <span class="muted small">(level ${f.level})</span><br><span class="small muted">${esc(f.desc || '')}</span></li>`).join('');

  const speciesTraits = (sp.traits || []).map(t => `<li><b>${t.name}</b> — <span class="muted">${esc(t.desc)}</span></li>`).join('');
  const inventory = char.inventory.map(i => {
    const w = rules.weapons.find(x => x.id === i.itemId);
    const a = rules.armor.find(x => x.id === i.itemId);
    const g = rules.gear.find(x => x.id === i.itemId);
    const def = w || a || g;
    return `<div class="stat-line"><span>${def ? def.name : i.itemId}</span><span>×${i.qty}</span></div>`;
  }).join('');

  main.innerHTML = `
    <p><a href="#/">← All heroes</a></p>
    <h1>${esc(char.name)}</h1>
    <p class="sub">Level ${char.level} ${esc(sp.name)} ${esc(cls.name)} · ${esc(bg.name)} background · ${char.xp} XP</p>
    <div class="sheet-grid">
      <div>
        <div class="card">
          <h3>Abilities</h3>
          <div class="ability-grid">
            ${ABILS.map(a => `<div class="ability-box"><div class="abbr">${a.toUpperCase()}</div><div class="score">${char.abilities[a]}</div><div class="mod">${fmtMod(modOf(char.abilities[a]))}</div></div>`).join('')}
          </div>
          <div style="margin-top:10px;">
            <div class="stat-line"><span>Hit Points</span><span>${char.hpMax}</span></div>
            <div class="stat-line"><span>Armor Class</span><span>${char.acBase}</span></div>
            <div class="stat-line"><span>Speed</span><span>${char.speedFt} ft</span></div>
            <div class="stat-line"><span>Initiative</span><span>${fmtMod(char.initBonus)}</span></div>
            <div class="stat-line"><span>Proficiency Bonus</span><span>${fmtMod(char.profBonus)}</span></div>
            <div class="stat-line"><span>Passive Perception</span><span>${10 + skillProfMod(char, 'perception')}</span></div>
            <div class="stat-line"><span>Gold</span><span>${char.gold} gp</span></div>
          </div>
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>Attacks</h3>${attacks}
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>Inventory</h3>${inventory}
        </div>
      </div>
      <div>
        <div class="card">
          <h3>Skills</h3>
          <div class="grid" style="grid-template-columns:1fr 1fr;">${skillLines}</div>
        </div>
        ${spells ? `<div class="card" style="margin-top:12px;">${spells}</div>` : ''}
        <div class="card" style="margin-top:12px;">
          <h3>Class Features — ${cls.name}</h3>
          <ul class="trait-list">${features}</ul>
        </div>
        <div class="card" style="margin-top:12px;">
          <h3>Species Traits — ${sp.name}</h3>
          <ul class="trait-list">${speciesTraits}</ul>
          <p class="small muted" style="margin-top:8px;"><b>Origin feat:</b> ${esc(char.featNote || char.feat)}</p>
        </div>
        <div style="margin-top:14px;">
          ${saveFor(char) ? `<a class="btn primary" href="#/play/${saveFor(char)}">⚔ Resume delve</a>` : `<a class="btn primary" href="#/play/new?char=${char.id}">⚔ Begin delve</a>`}
        </div>
      </div>
    </div>
  `;
}

function skillProfMod(char, skill) {
  let m = modOf(char.abilities[SKILL_ABILITY[skill]]);
  if (char.skills.includes(skill)) { m += char.profBonus; if (char.expertise.includes(skill)) m += char.profBonus; }
  return m;
}

async function saveFor(char) {
  try {
    const saves = await api.listSaves();
    const s = saves.find(x => x.characterId === char.id);
    return s ? s.id : null;
  } catch { return null; }
}
