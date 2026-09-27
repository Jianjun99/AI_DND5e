// ribbon.js — the tactical initiative ribbon across the top of the delve screen
// (combatant queue, two-tier HP bars, active-turn glow, dead skulls, elite tags).
// Pure render: reads the live game state, delegates target selection to the caller.

import { esc } from '../../app.js';

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
      ? `<span class="elite-monster-label" style="--elite-color:${esc((ent.affix && ent.affix.color) || '#f59e0b')}" title="${esc((ent.affix && ent.affix.desc) || 'Elite Champion')}">★ ${esc((ent.affix && ent.affix.name) || '')}</span>`
      : '';
    return `
      <div class="initiative-card ${isActive ? 'active' : ''} ${isDead ? 'dead' : ''} ${elite ? 'elite' : ''}" data-target-id="${o.id}" title="${esc(o.name)} (${hp}/${hpMax} HP, AC ${ent?.ac || 10}, Init ${o.total})${elite ? ' — ' + esc((ent.affix && ent.affix.desc) || 'Elite Champion') : ''}">
        <div class="init-avatar-token">${isDead ? '💀' : avatar}</div>
        <div class="init-info-col">
          <div class="init-name-row">
            <span class="init-combatant-name">${esc(o.name.split(' ')[0])}</span>
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

  container.innerHTML = `
    <div class="initiative-ribbon">
      <div class="initiative-round-tag">⚔ Rnd ${c.round}</div>
      ${cardsHtml}
    </div>
  `;

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
