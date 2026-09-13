// sheet.js — character sheet display
import { api } from '../api.js';
import { esc, toast, state as appState } from '../app.js';

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

  const saves = await api.listSaves().catch(() => []);
  const currentSave = saves.find(x => x.characterId === char.id);
  const saveId = currentSave ? currentSave.id : null;

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

  const getItemName = (id) => {
    if (!id || id === 'none') return null;
    const w = rules.weapons.find(x => x.id === id);
    const a = rules.armor.find(x => x.id === id);
    const g = rules.gear.find(x => x.id === id);
    return (w || a || g)?.name || id;
  };

  const getItemDesc = (id) => {
    if (!id || id === 'none') return '';
    const w = rules.weapons.find(x => x.id === id);
    if (w) return `${w.damage} ${w.damageType || ''}`;
    const a = rules.armor.find(x => x.id === id);
    if (a) return `AC: ${a.ac}`;
    const g = rules.gear.find(x => x.id === id);
    if (g) return g.desc || '';
    return '';
  };

  const equipped = char.equipped || {};
  const currentArmor = equipped.armor !== undefined ? equipped.armor : (char.inventory.map(i => rules.armor.find(a => a.id === i.itemId && a.type !== 'shield')).find(Boolean)?.id || null);
  const currentMainHand = equipped.mainHand !== undefined ? equipped.mainHand : (char.inventory.map(i => rules.weapons.find(w => w.id === i.itemId)).find(Boolean)?.id || null);
  const currentOffHand = equipped.offHand !== undefined ? equipped.offHand : (char.inventory.some(i => i.itemId === 'shield') ? 'shield' : null);
  const currentCloak = equipped.cloak || null;
  const currentAmulet = equipped.amulet || null;
  const currentRing1 = equipped.ring1 || null;

  const paperdollCard = `
    <div class="card" style="margin-top:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0;">⚔️ Equipped Loadout</h3>
        <span class="small muted">Click slot to change</span>
      </div>
      <div class="paperdoll-grid">
        <div class="paperdoll-slot" data-slot="armor">
          <div class="slot-label">🦺 Armor</div>
          <div class="slot-name ${currentArmor ? '' : 'empty'}">${getItemName(currentArmor) || 'Unarmored'}</div>
          <div class="slot-val small muted">${getItemDesc(currentArmor)}</div>
        </div>
        <div class="paperdoll-slot" data-slot="mainHand">
          <div class="slot-label">🗡️ Main Hand</div>
          <div class="slot-name ${currentMainHand ? '' : 'empty'}">${getItemName(currentMainHand) || 'Unarmed'}</div>
          <div class="slot-val small muted">${getItemDesc(currentMainHand)}</div>
        </div>
        <div class="paperdoll-slot" data-slot="offHand">
          <div class="slot-label">🛡️ Off-Hand</div>
          <div class="slot-name ${currentOffHand ? '' : 'empty'}">${getItemName(currentOffHand) || 'Empty'}</div>
          <div class="slot-val small muted">${getItemDesc(currentOffHand)}</div>
        </div>
        <div class="paperdoll-slot" data-slot="cloak">
          <div class="slot-label">🧥 Cloak</div>
          <div class="slot-name ${currentCloak ? '' : 'empty'}">${getItemName(currentCloak) || 'Empty'}</div>
          <div class="slot-val small muted">${getItemDesc(currentCloak)}</div>
        </div>
        <div class="paperdoll-slot" data-slot="amulet">
          <div class="slot-label">📿 Amulet</div>
          <div class="slot-name ${currentAmulet ? '' : 'empty'}">${getItemName(currentAmulet) || 'Empty'}</div>
          <div class="slot-val small muted">${getItemDesc(currentAmulet)}</div>
        </div>
        <div class="paperdoll-slot" data-slot="ring1">
          <div class="slot-label">💍 Ring</div>
          <div class="slot-name ${currentRing1 ? '' : 'empty'}">${getItemName(currentRing1) || 'Empty'}</div>
          <div class="slot-val small muted">${getItemDesc(currentRing1)}</div>
        </div>
      </div>
    </div>
  `;

  main.innerHTML = `
    <p><a href="#/">← All heroes</a></p>
    <div style="display:flex; gap:16px; align-items:center; margin-bottom:14px; flex-wrap:wrap;">
      <div style="width:90px; height:104px; flex-shrink:0;">
        <img id="heroPortraitImg" src="${char.portraitUrl || '/portraits/hero_' + char.id + '.svg'}"
             alt="Hero portrait"
             style="width:90px; height:104px; object-fit:cover; border-radius:8px; border:2px solid var(--border); background:#15120e;"
             onerror="this.src='/portraits/hero_${char.id}.svg'">
      </div>
      <div>
        <h1 style="margin:0 0 4px;">${esc(char.name)}</h1>
        <p class="sub" style="margin:0 0 8px;">Level ${char.level} ${esc(sp.name)} ${esc(cls.name)} · ${esc(bg.name)} background · ${char.xp} XP</p>
        <button class="btn small" id="regenPortraitBtn" title="Re-roll or generate portrait with AI">🎨 Regenerate Portrait</button>
      </div>
    </div>
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
        ${paperdollCard}
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
        <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
          ${saveId ? `<a class="btn primary" href="#/play/${saveId}">⚔ Resume delve</a>` : ''}
          <a class="btn ${saveId ? '' : 'primary'}" href="#/overworld?char=${char.id}">🗺️ Overworld & Delves</a>
        </div>
      </div>
    </div>
  `;

  function openEquipModal(slot) {
    let modal = document.getElementById('equipModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'equipModal';
      document.body.appendChild(modal);
    }

    const slotLabels = {
      armor: 'Body Armor',
      mainHand: 'Main Hand Weapon',
      offHand: 'Off-Hand (Shield / Secondary)',
      cloak: 'Cloak / Mantle',
      amulet: 'Amulet / Neck',
      ring1: 'Ring'
    };

    const invItems = char.inventory || [];
    let matching = [];

    if (slot === 'armor') {
      matching = invItems.map(i => {
        const a = rules.armor.find(x => x.id === i.itemId && x.type !== 'shield');
        return a ? { ...a, qty: i.qty } : null;
      }).filter(Boolean);
    } else if (slot === 'mainHand') {
      matching = invItems.map(i => {
        const w = rules.weapons.find(x => x.id === i.itemId);
        return w ? { ...w, qty: i.qty } : null;
      }).filter(Boolean);
    } else if (slot === 'offHand') {
      matching = invItems.map(i => {
        const s = rules.armor.find(x => x.id === i.itemId && x.type === 'shield');
        const w = rules.weapons.find(x => x.id === i.itemId && (x.props || []).includes('light'));
        const it = s || w;
        return it ? { ...it, qty: i.qty } : null;
      }).filter(Boolean);
    } else if (slot === 'cloak') {
      matching = invItems.filter(i => i.itemId.includes('cloak')).map(i => ({
        id: i.itemId,
        name: getItemName(i.itemId),
        desc: getItemDesc(i.itemId) || '+1 AC & Saves',
        qty: i.qty
      }));
    } else if (slot === 'amulet') {
      matching = invItems.filter(i => i.itemId.includes('amulet') || i.itemId.includes('necklace') || i.itemId.includes('periapt')).map(i => ({
        id: i.itemId,
        name: getItemName(i.itemId),
        desc: getItemDesc(i.itemId),
        qty: i.qty
      }));
    } else if (slot === 'ring1') {
      matching = invItems.filter(i => i.itemId.includes('ring')).map(i => ({
        id: i.itemId,
        name: getItemName(i.itemId),
        desc: getItemDesc(i.itemId),
        qty: i.qty
      }));
    }

    modal.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <h2>Equip ${slotLabels[slot] || slot}</h2>
        <p class="small muted">Select an item from your pack to equip in this slot, or unequip it.</p>
        <div style="display:flex; flex-direction:column; gap:8px; margin:14px 0; max-height:280px; overflow-y:auto;">
          ${matching.length ? matching.map(item => `
            <div class="stat-line" style="background:var(--bg-box); padding:10px 12px; border-radius:6px; border:1px solid var(--border);">
              <div>
                <b>${esc(item.name)}</b> <span class="muted small">(×${item.qty})</span>
                <div class="small muted">${esc(item.desc || item.damage || (item.ac ? 'AC '+item.ac : ''))}</div>
              </div>
              <button class="btn small primary" data-equip-id="${item.id}">Equip</button>
            </div>
          `).join('') : '<p class="muted small" style="text-align:center; padding:16px;">No compatible items in your backpack.</p>'}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
          <button class="btn small" id="unequipBtn" style="color:var(--red);">❌ Unequip Slot</button>
          <button class="btn small" id="closeEquipModal">Cancel</button>
        </div>
      </div>
    `;

    modal.querySelectorAll('[data-equip-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.getAttribute('data-equip-id');
        try {
          btn.disabled = true;
          await api.equipCharacter(char.id, slot, itemId);
          modal.remove();
          toast(`Equipped ${getItemName(itemId)}!`);
          sheetView(main, char.id);
        } catch (e) {
          toast(e.message);
          btn.disabled = false;
        }
      });
    });

    document.getElementById('unequipBtn').addEventListener('click', async () => {
      try {
        await api.equipCharacter(char.id, slot, 'none');
        modal.remove();
        toast('Slot unequipped.');
        sheetView(main, char.id);
      } catch (e) {
        toast(e.message);
      }
    });

    document.getElementById('closeEquipModal').addEventListener('click', () => modal.remove());
  }

  main.querySelectorAll('.paperdoll-slot').forEach(slotEl => {
    slotEl.addEventListener('click', () => {
      openEquipModal(slotEl.getAttribute('data-slot'));
    });
  });

  const regenBtn = document.getElementById('regenPortraitBtn');
  if (regenBtn) {
    regenBtn.addEventListener('click', async () => {
      regenBtn.disabled = true;
      regenBtn.textContent = 'Generating…';
      try {
        const port = await api.characterPortrait(char.id, true);
        const img = document.getElementById('heroPortraitImg');
        if (img && port && port.url) img.src = port.url;
        regenBtn.textContent = '🎨 Regenerated!';
      } catch (e) {
        regenBtn.textContent = '🎨 Failed';
      } finally {
        setTimeout(() => {
          regenBtn.disabled = false;
          regenBtn.textContent = '🎨 Regenerate Portrait';
        }, 2000);
      }
    });
  }
}

function skillProfMod(char, skill) {
  let m = modOf(char.abilities[SKILL_ABILITY[skill]]);
  if (char.skills.includes(skill)) { m += char.profBonus; if (char.expertise.includes(skill)) m += char.profBonus; }
  return m;
}
