// delve-inventory.js — the in-delve backpack & equipment modal, extracted from play.js.
// Live state comes in through ctx (the state object is replaced on every action/poll,
// so it is re-read on every render); equipping and using items dispatch through ctx.act.

import { esc, toast, state as appState } from '../../app.js';
import { initTooltips } from '../../tooltip.js';
import { sfx } from '../../sfx.js';

/**
 * @typedef {Object} DelveInvCtx
 * @property {() => any} getGame live delve-state getter
 * @property {(action: any) => Promise<any>} act dispatch a player action
 * @property {() => number} acNow current computed AC
 * @property {() => number} speedNow current computed speed in ft
 * @property {() => any} getSelectedTarget currently locked target (or null)
 */

/** @param {DelveInvCtx} ctx */
export function createDelveInventory(ctx) {

  function openDelveInventoryModal() {
    let modal = document.getElementById('delveInventoryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'delveInventoryModal';
      document.body.appendChild(modal);
    }
    renderDelveInventoryModal(modal);
  }

  function renderDelveInventoryModal(modal) {
    if (!modal) modal = document.getElementById('delveInventoryModal');
    if (!modal) return;
    const g = ctx.getGame();
    const char = g.character;
    const eq = char.equipped || {};
    const rules = appState.rules;

    const getItemName = (id) => {
      if (!id || id === 'none') return null;
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.name) return own.name;
      const w = rules.weapons.find(x => x.id === id);
      const a = rules.armor.find(x => x.id === id);
      const gear = rules.gear.find(x => x.id === id);
      return (w || a || gear)?.name || id;
    };

    const getItemDesc = (id) => {
      if (!id || id === 'none') return '';
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.desc) return own.desc;
      const w = rules.weapons.find(x => x.id === id);
      if (w) return `${w.damage} ${w.damageType || ''}`;
      const a = rules.armor.find(x => x.id === id);
      if (a) return `AC ${a.ac}`;
      const gear = rules.gear.find(x => x.id === id);
      if (gear) return gear.desc || (gear.acBonus ? `+${gear.acBonus} AC` : '');
      return '';
    };

    const tooltipPayload = (id) => {
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.rarity) return esc(JSON.stringify({ ...own, ...(rules.weapons.find(x => x.id === own.itemId) || {}) }));
      return id;
    };

    const slots = [
      { key: 'armor', label: '🦺 Armor', item: eq.armor, emptyText: 'Unarmored' },
      { key: 'mainHand', label: '🗡️ Main Hand', item: eq.mainHand, emptyText: 'Unarmed' },
      { key: 'offHand', label: '🛡️ Off-Hand', item: eq.offHand, emptyText: 'Empty' },
      { key: 'cloak', label: '🧥 Cloak', item: eq.cloak, emptyText: 'None' },
      { key: 'ring1', label: '💍 Ring', item: eq.ring1, emptyText: 'None' },
    ];

    modal.innerHTML = `
      <div class="modal delve-inventory-modal" style="position:relative; max-width:680px; width:94%; max-height:86vh; display:flex; flex-direction:column; text-align:left; padding:20px 24px;">
        <button class="btn small" id="closeDelveInvX" style="position:absolute; top:14px; right:14px; min-width:32px; padding:4px 8px; font-weight:bold; cursor:pointer;" title="Close">✕</button>
        <h2 style="margin:0 0 4px; display:flex; align-items:center; gap:8px;">
          🎒 Backpack & Equipment
        </h2>
        <div class="muted small" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <span>${esc(char.name)} · Level ${char.level} · AC ${ctx.acNow()} · Speed ${ctx.speedNow()} ft</span>
          <span style="color:var(--gold); font-weight:600;">💰 ${char.gold || 0} gp</span>
        </div>

        <div style="font-size:12px; font-weight:700; color:var(--gold); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
          ⚔️ Equipped Loadout
        </div>
        <div class="delve-inv-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(115px, 1fr)); gap:8px; margin-bottom:14px;">
          ${slots.map(s => {
            const hasItem = Boolean(s.item && s.item !== 'none');
            return `
              <div class="delve-inv-slot ${hasItem ? 'occupied' : ''}" style="background:var(--bg2); border:1px solid ${hasItem ? 'var(--gold-dim)' : 'var(--border)'}; border-radius:6px; padding:6px 8px; min-height:64px; display:flex; flex-direction:column; justify-content:space-between;" ${hasItem ? `data-item-tooltip="${tooltipPayload(s.item)}" style="cursor:help;"` : ''}>
                <div>
                  <div style="font-size:10px; text-transform:uppercase; color:var(--muted); font-weight:600;">${s.label}</div>
                  <div style="font-size:12px; font-weight:600; color:${hasItem ? 'var(--gold)' : 'var(--muted)'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${hasItem ? esc(getItemName(s.item)) : s.emptyText}
                  </div>
                  ${hasItem && getItemDesc(s.item) ? `<div style="font-size:10px; color:var(--muted);">${esc(getItemDesc(s.item))}</div>` : ''}
                </div>
                ${hasItem ? `
                  <button class="btn small" data-delve-inv-unequip="${s.key}" style="padding:1px 5px; font-size:10px; align-self:flex-start; margin-top:4px;">Doff / Stow</button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size:12px; font-weight:700; color:var(--gold); text-transform:uppercase; letter-spacing:0.5px;">
            📦 Backpack Inventory (${(char.inventory || []).length} items)
          </div>
          <span class="muted small">Click an item or button to use / equip</span>
        </div>

        <div class="delve-inv-scroll-list" style="flex:1; overflow-y:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg); padding:6px 10px; max-height:280px;">
          ${(char.inventory || []).length === 0 ? `
            <div class="muted small" style="padding:16px; text-align:center;">Backpack is empty.</div>
          ` : (char.inventory || []).map(i => {
            const def = (rules.weapons || []).find(w => w.id === i.itemId)
              || (rules.armor || []).find(w => w.id === i.itemId)
              || (rules.gear || []).find(w => w.id === i.itemId);
            const entry = { ...(def || {}), ...i }; // rolled affix gear keeps its own name, rarity and modifiers
            const usable = def && (def.type === 'potion' || def.type === 'scroll');
            const isWeapon = (rules.weapons || []).some(w => w.id === i.itemId);
            const isArmor = (rules.armor || []).some(a => a.id === i.itemId && a.type !== 'shield');
            const isShield = i.itemId === 'shield' || (def && def.type === 'shield') || i.type === 'shield';
            const isCloak = i.itemId.includes('cloak');
            const isRing = i.itemId.includes('ring');
            const ref = i.uniqueId || i.itemId; // rolled items are addressed by unique id
            const worn = (slot) => eq[slot] === ref || eq[slot] === i.itemId;

            let actionHtml = '';
            if (isWeapon) {
              if (worn('mainHand')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Wielded</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="mainHand" data-item="${ref}">Wield</button>`;
              }
            } else if (isArmor) {
              if (worn('armor')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Worn</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="armor" data-item="${ref}">Wear</button>`;
              }
            } else if (isShield) {
              if (worn('offHand')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Shielded</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="offHand" data-item="${ref}">Hold</button>`;
              }
            } else if (isCloak) {
              if (worn('cloak')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Donned</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="cloak" data-item="${ref}">Don</button>`;
              }
            } else if (isRing) {
              if (worn('ring1')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Attuned</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="ring1" data-item="${ref}">Attune</button>`;
              }
            }

            const meta = i.rarity ? null : def;
            const detail = i.desc || (meta && (meta.damage || meta.ac || meta.desc)
              ? (meta.damage ? `${meta.damage} ${meta.damageType || ''}` : (meta.ac ? `AC ${meta.ac}` : meta.desc))
              : '');

            // experimental brews: hidden until identified or drunk
            if (i.kind === 'mystery_potion') {
              const kindTag = i.identified
                ? (i.effect.kind === 'good' ? '🔵 有益' : i.effect.kind === 'bad' ? '🟣 有害' : '🟠 复杂')
                : '❓ 未鉴定';
              const row = i.identified
                ? `${i.effect.name} — ${i.effect.desc}`
                : (i.clues || []).join(' · ');
              return `
                <div class="stat-line item-row potion-row ${i.identified ? 'rarity-' + (i.effect.kind === 'good' ? 'magic' : i.effect.kind === 'bad' ? 'rare' : 'legendary') : 'potion-unknown'}"
                     data-item-tooltip='${esc(JSON.stringify({ ...entry, rarity: i.identified ? (i.effect.kind === 'good' ? 'magic' : i.effect.kind === 'bad' ? 'rare' : 'legendary') : 'common' }))}' style="cursor:help; padding:6px 2px; align-items:center;">
                  <div style="min-width:0; flex:1; padding-right:8px;">
                    <span class="item-affix-tag ${i.identified ? 'rarity-magic-tag' : 'rarity-common-tag'}">${kindTag}</span>
                    <span style="font-weight:600;">${esc(i.name)}</span>
                    <span class="muted small" style="margin-left:6px;">(${esc(row)})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <button class="btn small primary" data-delve-inv-use="${ref}">${i.identified ? '饮下' : '盲饮'}</button>
                    <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                  </div>
                </div>
              `;
            }

            // delve-only prize tokens won at the tavern
            if (i.kind === 'delve_token') {
              return `
                <div class="stat-line item-row rarity-legendary" data-item-tooltip='${esc(JSON.stringify(entry))}' style="cursor:help; padding:6px 2px; align-items:center;">
                  <div style="min-width:0; flex:1; padding-right:8px;">
                    <span class="item-affix-tag rarity-legendary-tag">⏳ 仅本场地牢</span>
                    <span style="font-weight:600;">${esc(i.name)}</span>
                    <span class="muted small" style="margin-left:6px;">(${esc(i.desc || '')})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <button class="btn small primary" data-delve-inv-use="${ref}">使用</button>
                    <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                  </div>
                </div>
              `;
            }

            return `
              <div class="stat-line item-row ${i.rarity ? 'rarity-' + i.rarity : ''}" data-item-tooltip='${i.rarity ? esc(JSON.stringify(entry)) : i.itemId}' style="cursor:help; padding:6px 2px; align-items:center;">
                <div style="min-width:0; flex:1; padding-right:8px;">
                  ${i.rarity ? `<span class="item-affix-tag rarity-${i.rarity}-tag">${i.rarity === 'legendary' ? '🟠 传奇' : i.rarity === 'rare' ? '🟣 稀有' : '🔵 魔法'}</span>` : ''}
                  <span style="font-weight:600;">${esc(i.name || (def ? def.name : i.itemId))}</span>
                  ${detail ? `<span class="muted small" style="margin-left:6px;">(${esc(detail)})</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                  ${usable && i.qty > 0 ? `<button class="btn small primary" data-delve-inv-use="${i.itemId}">Use</button>` : ''}
                  ${actionHtml}
                  <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
          <a href="#/sheet/${g.characterId}" target="_blank" class="btn small" title="Open full character sheet in new tab">📜 Full Character Sheet ↗</a>
          <button class="btn primary" id="closeDelveInvDone">Done</button>
        </div>
      </div>
    `;

    initTooltips(modal, rules);

    const dismiss = () => {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    };

    const closeX = modal.querySelector('#closeDelveInvX');
    if (closeX) closeX.addEventListener('click', dismiss);
    const closeDone = modal.querySelector('#closeDelveInvDone');
    if (closeDone) closeDone.addEventListener('click', dismiss);
    modal.onclick = (e) => {
      if (e.target === modal) dismiss();
    };

    modal.querySelectorAll('[data-delve-inv-equip]').forEach(b => b.addEventListener('click', async () => {
      const slot = b.dataset.delveInvEquip;
      const itemId = b.dataset.item;
      sfx.play('equip');
      await ctx.act({ type: 'equip', slot, itemId });
      toast(`Equipped ${itemId}!`);
    }));

    modal.querySelectorAll('[data-delve-inv-unequip]').forEach(b => b.addEventListener('click', async () => {
      const slot = b.dataset.delveInvUnequip;
      sfx.play('equip');
      await ctx.act({ type: 'unequip', slot });
      toast(`Unequipped ${slot}!`);
    }));

    modal.querySelectorAll('[data-delve-inv-use]').forEach(b => b.addEventListener('click', async () => {
      const itemId = b.dataset.delveInvUse;
      const def = (rules.gear || []).find(gear => gear.id === itemId);
      if (def && def.type === 'scroll' && def.spell) {
        const sp = (rules.spells || []).find(x => x.id === def.spell);
        const sel = ctx.getSelectedTarget();
        if (sp && ['enemy', 'burst'].includes(sp.target) && !sel) {
          return toast('Target a creature first on the map.');
        }
        await ctx.act({ type: 'useItem', itemId, targetId: sel ? sel.id : 'player' });
      } else {
        await ctx.act({ type: 'useItem', itemId });
      }
    }));
  }

  return { openDelveInventoryModal, renderDelveInventoryModal };
}
