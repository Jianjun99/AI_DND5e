import { displayText, displayLabel,  contentText, contentLabel,  t, label } from "../../i18n.js";
// delve-inventory.js — the in-delve backpack & equipment modal, extracted from play.js.
// Live state comes in through ctx (the state object is replaced on every action/poll,
// so it is re-read on every render); equipping and using items dispatch through ctx.act.

import { esc, toast, state as appState } from '../../app.js';
import { initTooltips } from '../../tooltip.js';
import { sfx } from '../../sfx.js';
import { presentModal, dismissModal } from '../../modal.js';
import { patchHud } from './hud-patch.js';

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
      if (!presentModal(modal)) return;
    }
    renderDelveInventoryModal(modal);
  }

  function renderDelveInventoryModal(modal) {
    if (!modal) modal = document.getElementById('delveInventoryModal');
    if (!modal) return;
    const focused = document.activeElement;
    const restoreFocus = modal.contains(focused);
    const focusedId = focused?.id;
    const g = ctx.getGame();
    const char = g.character;
    const eq = char.equipped || {};
    const rules = appState.rules;

    const getItemName = (id) => {
      if (!id || id === 'none') return null;
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.name) return own.nameDisplay || own.name;
      const w = rules.weapons.find(x => x.id === id);
      const a = rules.armor.find(x => x.id === id);
      const gear = rules.gear.find(x => x.id === id);
      return (w || a || gear)?.nameDisplay || (w || a || gear)?.name || id;
    };

    const getItemDesc = (id) => {
      if (!id || id === 'none') return '';
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.desc) return own.descDisplay || own.desc;
      const w = rules.weapons.find(x => x.id === id);
      if (w) return {parts:[w.damage,' ',{key:'content.damage.'+w.damageType,fallback:w.damageType || ''}],fallback:`${w.damage} ${w.damageType || ''}`};
      const a = rules.armor.find(x => x.id === id);
      if (a) return `AC ${a.ac}`;
      const gear = rules.gear.find(x => x.id === id);
      if (gear) return gear.descDisplay || gear.desc || (gear.acBonus ? `+${gear.acBonus} AC` : '');
      return '';
    };

    const tooltipPayload = (id) => {
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.rarity) return esc(JSON.stringify({ ...(rules.weapons.find(x => x.id === own.itemId) || {}), ...own }));
      return id;
    };

    const slots = [
      { key: 'armor', label: label("ui.delve-inventory.armor"), item: eq.armor, emptyText: label("ui.delve-inventory.unarmored") },
      { key: 'mainHand', label: label("ui.delve-inventory.main_hand"), item: eq.mainHand, emptyText: label("ui.delve-inventory.unarmed") },
      { key: 'offHand', label: label("ui.delve-inventory.off_hand"), item: eq.offHand, emptyText: label("ui.delve-inventory.empty") },
      { key: 'cloak', label: label("ui.delve-inventory.cloak"), item: eq.cloak, emptyText: label("ui.delve-inventory.none") },
      { key: 'ring1', label: label("ui.delve-inventory.ring"), item: eq.ring1, emptyText: label("ui.delve-inventory.none") },
    ];

    // H1: reconcile the still-open modal instead of innerHTML — polls and late
    // auxiliary responses keep valid buttons, focus and in-progress presses.
    patchHud(modal, `
      <div class="modal delve-inventory-modal" style="position:relative; max-width:680px; width:94%; max-height:86vh; display:flex; flex-direction:column; text-align:left; padding:20px 24px;">
        <button class="btn small" id="closeDelveInvX" style="position:absolute; top:14px; right:14px; min-width:32px; padding:4px 8px; font-weight:bold; cursor:pointer;" data-i18n-title="ui.delve-inventory.close" title="${esc(t("ui.delve-inventory.close"))}">✕</button>
        <h2 style="margin:0 0 4px; display:flex; align-items:center; gap:8px;">
          ${label("ui.delve-inventory.backpack_equipment")}
        </h2>
        <div class="muted small" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <span>${label("ui.delve-inventory.level_ac_speed_ft_values", {p2: (char.nameDisplay || char.name), p3: char.level, p4: ctx.acNow(), p5: ctx.speedNow()})}</span>
          <span style="color:var(--gold); font-weight:600;">💰 ${char.gold || 0} gp</span>
        </div>

        <div style="font-size:12px; font-weight:700; color:var(--gold); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
          ${label("ui.delve-inventory.equipped_loadout")}
        </div>
        <div class="delve-inv-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(115px, 1fr)); gap:8px; margin-bottom:14px;">
          ${slots.map(s => {
            const hasItem = Boolean(s.item && s.item !== 'none');
            return `
              <div class="delve-inv-slot ${hasItem ? 'occupied' : ''}" style="background:var(--bg2); border:1px solid ${hasItem ? 'var(--gold-dim)' : 'var(--border)'}; border-radius:6px; padding:6px 8px; min-height:64px; display:flex; flex-direction:column; justify-content:space-between;" ${hasItem ? `data-item-tooltip="${tooltipPayload(s.item)}" style="cursor:help;"` : ''}>
                <div>
                  <div style="font-size:10px; text-transform:uppercase; color:var(--muted); font-weight:600;">${s.label}</div>
                  <div style="font-size:12px; font-weight:600; color:${hasItem ? 'var(--gold)' : 'var(--muted)'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${hasItem ? displayLabel(getItemName(s.item)) : s.emptyText}
                  </div>
                  ${hasItem && getItemDesc(s.item) ? `<div style="font-size:10px; color:var(--muted);">${displayLabel(getItemDesc(s.item))}</div>` : ''}
                </div>
                ${hasItem ? `
                  <button class="btn small" data-delve-inv-unequip="${s.key}" style="padding:1px 5px; font-size:10px; align-self:flex-start; margin-top:4px;">${label("ui.delve-inventory.doff_stow")}</button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size:12px; font-weight:700; color:var(--gold); text-transform:uppercase; letter-spacing:0.5px;">
            ${label("ui.delve-inventory.backpack_inventory_items_values", {p9: (char.inventory || []).length})}
          </div>
          <span class="muted small">${label("ui.delve-inventory.click_an_item_or_button_to_use")}</span>
        </div>

        <div class="delve-inv-scroll-list" style="flex:1; overflow-y:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg); padding:6px 10px; max-height:280px;">
          ${(char.inventory || []).length === 0 ? `
            <div class="muted small" style="padding:16px; text-align:center;">${label("ui.delve-inventory.backpack_is_empty")}</div>
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
            const worn = (slot) => eq[slot] === ref;

            let actionHtml = '';
            if (isWeapon) {
              if (worn('mainHand')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">${label("ui.delve-inventory.wielded")}</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="mainHand" data-item="${ref}">${label("ui.delve-inventory.wield")}</button>`;
              }
            } else if (isArmor) {
              if (worn('armor')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">${label("ui.delve-inventory.worn")}</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="armor" data-item="${ref}">${label("ui.delve-inventory.wear")}</button>`;
              }
            } else if (isShield) {
              if (worn('offHand')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">${label("ui.delve-inventory.shielded")}</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="offHand" data-item="${ref}">${label("ui.delve-inventory.hold")}</button>`;
              }
            } else if (isCloak) {
              if (worn('cloak')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">${label("ui.delve-inventory.donned")}</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="cloak" data-item="${ref}">${label("ui.delve-inventory.don")}</button>`;
              }
            } else if (isRing) {
              if (worn('ring1')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">${label("ui.delve-inventory.attuned")}</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="ring1" data-item="${ref}">${label("ui.delve-inventory.attune")}</button>`;
              }
            }

            const meta = i.rarity ? null : def;
            const detail = i.desc || (meta && (meta.damage || meta.ac || meta.desc)
              ? (meta.damage ? `${meta.damage} ${meta.damageType || ''}` : (meta.ac ? `AC ${meta.ac}` : meta.desc))
              : '');

            // experimental brews: hidden until identified or drunk
            if (i.kind === 'mystery_potion') {
              const kindTag = i.identified
                ? (i.effect.kind === 'good' ? label("ui.delve-inventory.beneficial") : i.effect.kind === 'bad' ? label("ui.delve-inventory.harmful") : label("ui.delve-inventory.mixed"))
                : label("ui.delve-inventory.unidentified");
              const row = i.identified
                ? `${contentText(i.effect,"name")} — ${contentText(i.effect,"desc")}`
                : (i.clues || []).join(' · ');
              return `
                <div class="stat-line item-row potion-row ${i.identified ? 'rarity-' + (i.effect.kind === 'good' ? 'magic' : i.effect.kind === 'bad' ? 'rare' : 'legendary') : 'potion-unknown'}"
                     data-item-tooltip='${esc(JSON.stringify({ ...entry, rarity: i.identified ? (i.effect.kind === 'good' ? 'magic' : i.effect.kind === 'bad' ? 'rare' : 'legendary') : 'common' }))}' style="cursor:help; padding:6px 2px; align-items:center;">
                  <div style="min-width:0; flex:1; padding-right:8px;">
                    <span class="item-affix-tag ${i.identified ? 'rarity-magic-tag' : 'rarity-common-tag'}">${kindTag}</span>
                    <span style="font-weight:600;">${contentLabel(i,"name")}</span>
                    <span class="muted small" style="margin-left:6px;">(${i.identified ? contentLabel(i.effect)+' — '+contentLabel(i.effect,'desc') : displayLabel(i.cluesDisplay,row)})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <button class="btn small primary" data-delve-inv-use="${ref}">${i.identified ? label("ui.delve-inventory.drink") : label("ui.delve-inventory.drink_unknown")}</button>
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
                    <span class="item-affix-tag rarity-legendary-tag">${label("ui.delve-inventory.this_delve_only")}</span>
                    <span style="font-weight:600;">${contentLabel(i,"name")}</span>
                    <span class="muted small" style="margin-left:6px;">(${displayLabel(i.descDisplay,i.desc || '')})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <button class="btn small primary" data-delve-inv-use="${ref}">${label("ui.delve-inventory.use")}</button>
                    <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                  </div>
                </div>
              `;
            }

            return `
              <div class="stat-line item-row ${i.rarity ? 'rarity-' + i.rarity : ''}" data-item-tooltip='${i.rarity ? esc(JSON.stringify(entry)) : i.itemId}' style="cursor:help; padding:6px 2px; align-items:center;">
                <div style="min-width:0; flex:1; padding-right:8px;">
                  ${i.rarity ? `<span class="item-affix-tag rarity-${i.rarity}-tag">${i.rarity === 'legendary' ? label("ui.delve-inventory.legendary") : i.rarity === 'rare' ? label("ui.delve-inventory.rare") : label("ui.delve-inventory.magic")}</span>` : ''}
                  <span style="font-weight:600;">${displayLabel(i.nameDisplay,i.name || (def ? def.name : i.itemId))}</span>
                  ${detail ? `<span class="muted small" style="margin-left:6px;">(${i.descDisplay ? displayLabel(i.descDisplay,detail) : meta?.descDisplay ? contentLabel(meta,'desc') : meta?.damageType ? esc(meta.damage)+' '+label('content.damage.'+meta.damageType) : esc(detail)})</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                  ${usable && i.qty > 0 ? `<button class="btn small primary" data-delve-inv-use="${i.itemId}">${label("ui.delve-inventory.use")}</button>` : ''}
                  ${actionHtml}
                  <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
          <a href="#/character/${g.characterId}" target="_blank" class="btn small" data-i18n-title="ui.delve-inventory.open_full_character_sheet_in_new_tab" title="${esc(t("ui.delve-inventory.open_full_character_sheet_in_new_tab"))}">${label("ui.delve-inventory.full_character_sheet")}</a>
          <button class="btn primary" id="closeDelveInvDone">${label("ui.delve-inventory.done")}</button>
        </div>
      </div>
    `);

    initTooltips(modal, rules);

    const dismiss = () => {
      dismissModal(modal);
    };

    const closeX = modal.querySelector('#closeDelveInvX');
    if (closeX && !closeX.dataset.wired) {
      closeX.dataset.wired = '1';
      closeX.addEventListener('click', dismiss);
    }
    const closeDone = modal.querySelector('#closeDelveInvDone');
    if (closeDone && !closeDone.dataset.wired) {
      closeDone.dataset.wired = '1';
      closeDone.addEventListener('click', dismiss);
    }
    modal.onclick = (e) => {
      if (e.target === modal) dismiss();
    };

    modal.querySelectorAll('[data-delve-inv-equip]').forEach(b => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', async () => {
        const slot = b.dataset.delveInvEquip;
        const itemId = b.dataset.item;
        const itemDisplay = getItemName(itemId);
        sfx.play('equip');
        await ctx.act({ type: 'equip', slot, itemId });
        toast(() => t('ui.common.equipped', { item: displayText(itemDisplay, itemId) }));
      });
    });

    modal.querySelectorAll('[data-delve-inv-unequip]').forEach(b => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', async () => {
        const slot = b.dataset.delveInvUnequip;
        const slotKey = {armor:'armor',mainHand:'main_hand',offHand:'off_hand',cloak:'cloak',ring1:'ring'}[slot];
        sfx.play('equip');
        await ctx.act({ type: 'unequip', slot });
        toast(() => t('ui.common.unequipped', { slot: slotKey ? t('ui.delve-inventory.' + slotKey) : slot }));
      });
    });

    modal.querySelectorAll('[data-delve-inv-use]').forEach(b => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', async () => {
        const itemId = b.dataset.delveInvUse;
        const def = (rules.gear || []).find(gear => gear.id === itemId);
        if (def && def.type === 'scroll' && def.spell) {
          const sp = (rules.spells || []).find(x => x.id === def.spell);
          const sel = ctx.getSelectedTarget();
          if (sp && ['enemy', 'burst'].includes(sp.target) && !sel) {
            return toast(() => t("ui.delve-inventory.target_a_creature_first_on_the_map"));
          }
          await ctx.act({ type: 'useItem', itemId, targetId: sel ? sel.id : 'player' });
        } else {
          await ctx.act({ type: 'useItem', itemId });
        }
      });
    });
    // A late appearance/state response can refresh this still-open inventory.
    // Replacing its contents must not leave keyboard focus on the document body.
    if (restoreFocus && modal.isConnected && !modal.contains(document.activeElement)) {
      const target = focusedId ? document.getElementById(focusedId) : null;
      const next = target && modal.contains(target) ? target : closeX;
      /** @type {HTMLElement} */ (next || modal).focus({preventScroll:true});
    }
  }

  return { openDelveInventoryModal, renderDelveInventoryModal };
}
