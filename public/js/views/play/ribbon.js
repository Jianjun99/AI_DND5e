// ribbon.js — the tactical initiative ribbon across the top of the delve screen
// (combatant queue, two-tier HP bars, active-turn glow, dead skulls, elite tags).
// Pure render: reads the live game state, delegates target selection to the caller.

import { esc } from '../../app.js';
import { t, label, contentLabel, contentText } from '../../i18n.js';
import { patchHud } from './hud-patch.js';

/**
 * Re-render the ribbon. Hidden outside combat.
 * @param {any} game live delve state
 * @param {(ent: any) => void} onSelectTarget called when a non-player card is
 *   clicked — play.js owns target locking, portrait lookup, re-render and sfx
 */
export function renderInitiativeRibbon(game, onSelectTarget) {
  const container = document.getElementById('initiativeRibbonContainer');
  if (!container) return;
  if (game.mode !== 'combat' || !game.combat || !game.combat.order || !game.combat.order.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  const c = game.combat;
  const cardsHtml = c.order.map((o, idx) => {
    const isPlayer = o.id === 'player';
    const ent = isPlayer ? game.entities.find(e => e.kind === 'player') : game.entities.find(e => e.id === o.id);
    const hp = ent ? (ent.hp ?? 1) : 1;
    const hpMax = ent ? (ent.hpMax ?? 1) : 1;
    const pct = Math.max(0, Math.min(100, Math.round((hp / hpMax) * 100)));
    const isDead = ent && ent.alive === false;
    const isActive = idx === c.turnIdx;
    const fillClass = pct < 25 ? 'danger' : pct < 50 ? 'warn' : '';
    const avatar = isPlayer ? '🧙' : (ent?.icon || (isDead ? '💀' : '👾'));
    const elite = !isPlayer && ent && ent.isElite;
    const eliteTag = elite
      ? `<span class="elite-monster-label" style="--elite-color:${esc((ent.affix && ent.affix.color) || '#f59e0b')}" ${ent.affix?.desc ? '' : 'data-i18n-title="ui.play.elite_champion"'} title="${esc(contentText(ent.affix,"desc") || t('ui.play.elite_champion'))}">★ ${contentLabel(ent.affix)}</span>`
      : '';
    return `
      <div class="initiative-card ${isActive ? 'active' : ''} ${isDead ? 'dead' : ''} ${elite ? 'elite' : ''}" data-target-id="${o.id}" data-i18n-title="ui.ribbon.hp_ac_init_values" data-i18n-params="${esc(JSON.stringify({p4: ent?.nameDisplay || o.name, p5: hp, p6: hpMax, p7: ent?.ac || 10, p8: o.total, p9: elite && ent.affix?.desc ? ' — ' + ent.affix.desc : ''}))}" title="${esc(t("ui.ribbon.hp_ac_init_values", {p4: (ent?.nameDisplay || o.name), p5: hp, p6: hpMax, p7: ent?.ac || 10, p8: o.total, p9: elite && ent.affix?.desc ? ' — ' + ent.affix.desc : ''}))}">
        <div class="init-avatar-token">${isDead ? '💀' : avatar}</div>
        <div class="init-info-col">
          <div class="init-name-row">
            <span class="init-combatant-name">${contentLabel(ent || o)}</span>
            ${eliteTag}
            <span class="init-score-badge">${o.total}</span>
          </div>
          <div class="init-hp-track">
            <div class="init-hp-fill ${fillClass}" style="width:${pct}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // H1: reconcile instead of innerHTML so a combatant card pressed across a poll/
  // auxiliary response keeps its node (onclick is reassigned below, which is idempotent).
  patchHud(container, `
    <div class="initiative-ribbon">
      <div class="initiative-round-tag">${label("ui.ribbon.rnd_values", {p0: c.round})}</div>
      ${cardsHtml}
    </div>
  `);

  container.querySelectorAll('.initiative-card:not(.dead)').forEach(card => {
    /** @type {HTMLElement} */ (card).onclick = () => {
      const targetId = /** @type {HTMLElement} */ (card).dataset.targetId;
      if (targetId && targetId !== 'player') {
        const ent = game.entities.find(e => e.id === targetId);
        if (ent && ent.alive !== false) onSelectTarget(ent);
      }
    };
  });
}
