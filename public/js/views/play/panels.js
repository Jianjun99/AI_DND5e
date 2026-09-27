// panels.js — the delve screen's self-contained modal panels
// (shop / journal / skill-check / end-of-delve summary), extracted from play.js.
// The panels read live game state through ctx.getGame() and dispatch player
// actions through ctx.act, so play.js keeps owning all shared state.

import { esc } from '../../app.js';
import { api } from '../../api.js';
import { initTooltips } from '../../tooltip.js';
import { rollAnimated } from '../../dice.js';

/**
 * @typedef {Object} PanelsCtx
 * @property {() => any} getGame live delve-state getter (the state object is
 *   replaced on every action/poll, so never cache it)
 * @property {(action: any) => Promise<any>} act dispatch a player action
 * @property {(npcId: string, npcName: string) => void} onShopTalk switch the
 *   chat bar into "talk to this merchant" mode
 * @property {() => void} onSummaryRespawn called after the summary's respawn
 *   button dismisses the panel (play.js resets its summary guard + respawns)
 */

/** @param {PanelsCtx} ctx */
export function createPanels(ctx) {

  function openShop(merchantName = 'Marla the Peddler', merchantId = 'marla') {
    let modal = document.getElementById('shopModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'shopModal';
      document.body.appendChild(modal);
    }
    const items = appStateRules().shop || [];
    const render = () => {
      const g = ctx.getGame();
      modal.innerHTML = `
        <div class="modal">
          <h2>🧺 ${esc(merchantName)}</h2>
          <p class="muted small">"Potions, tools, and luck, dear — I sell the first two."</p>
          <p class="small">Your gold: <b style="color:var(--gold)">${g.character.gold} gp</b></p>
          ${items.map(i => `
            <div class="stat-line" data-item-tooltip="${i.id}" style="cursor:help;"><span>${i.name} <span class="muted small">— ${esc(i.desc)}</span></span>
              <span><button class="btn small" data-buy="${i.id}" ${g.character.gold >= i.price ? '' : 'disabled'}>${i.price} gp</button></span></div>`).join('')}
          <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
            <button class="btn small" id="talkMarla">💬 Talk to the trader</button>
            <button class="btn small" id="closeShop">Leave</button>
          </div>
        </div>`;
      initTooltips(modal, appStateRules());
      modal.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
        await ctx.act({ type: 'buy', itemId: /** @type {HTMLButtonElement} */ (b).dataset.buy });
        render();
      }));
      document.getElementById('closeShop').addEventListener('click', () => modal.remove());
      document.getElementById('talkMarla').addEventListener('click', () => {
        ctx.onShopTalk(merchantId, merchantName);
        modal.remove();
      });
    };
    render();
  }

  // The adventurer's journal (LLM-written recaps)
  function openJournal() {
    const g = ctx.getGame();
    const entries = g.journal || [];
    let modal = document.getElementById('journalModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'journalModal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="modal" style="text-align:left; max-height:80vh; overflow-y:auto;">
        <h2>📖 Adventurer's Journal</h2>
        ${entries.length ? entries.map(e2 => `
          <div class="card" style="margin:10px 0; background:var(--bg2);">
            <p class="small muted" style="margin-bottom:6px;">${new Date(e2.ts).toLocaleString()}</p>
            <p style="font-family:var(--font-serif); font-size:14.5px;">${esc(e2.text)}</p>
          </div>`).join('')
        : '<p class="muted" style="margin:14px 0;">Your journal is empty. Write an entry at the campfire — every long rest adds one.</p>'}
        ${(g.quests?.completed || []).length ? `
          <h3 style="margin-top:14px;">📜 Completed side quests</h3>
          ${g.quests.completed.map(q => `<div class="stat-line"><span>${esc(q.shortText)}</span><span>+${q.reward.gold} gp · +${q.reward.xp} XP</span></div>`).join('')}` : ''}
        <div style="text-align:center; margin-top:12px;">
          <button class="btn small" id="closeJournal">Close</button>
        </div>
      </div>`;
    document.getElementById('closeJournal').addEventListener('click', () => modal.remove());
  }

  function openSkillCheckModal(obj) {
    let modal = document.getElementById('skillCheckModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'skillCheckModal';
      document.body.appendChild(modal);
    }
    const char = ctx.getGame().character;
    const isTrap = obj.type === 'trap';
    const strMod = Math.floor(((char.abilities?.str || 10) - 10) / 2);
    const dexMod = Math.floor(((char.abilities?.dex || 10) - 10) / 2);
    const profBonus = Math.floor(((char.level || 1) - 1) / 4) + 2;
    const hasTools = (char.inventory || []).some(i => i.itemId === 'thieves_tools' || i.itemId === 'tool_thieves');
    const hasSleight = (char.skills || []).includes('sleight_of_hand');
    const hasAthletics = (char.skills || []).includes('athletics');

    const pickMod = dexMod + ((hasTools || hasSleight) ? profBonus : 0);
    const forceMod = strMod + (hasAthletics ? profBonus : 0);
    const disarmMod = dexMod + ((hasTools || hasSleight) ? profBonus : 0);

    const pickDc = obj.pickDc || 12;
    const forceDc = obj.forceDc || 14;
    const trapDc = obj.dc || 12;

    const render = () => {
      if (isTrap) {
        modal.innerHTML = `
          <div class="modal" style="max-width:440px;">
            <h2>⚠️ ${esc(obj.name || 'Concealed Trap')}</h2>
            <p class="small muted">A mechanical hazard is revealed before you. You can attempt to disable its triggers, but tripping it will detonate the mechanism.</p>
            <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px; margin:12px 0;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span><b>Disarm Mechanism</b></span>
                <span class="badge" style="color:var(--accent);">DC ${trapDc}</span>
              </div>
              <p class="small muted" style="margin:0 0 10px 0;">Sleight of Hand: DEX (${dexMod >= 0 ? '+'+dexMod : dexMod})${hasTools ? ' + ' + profBonus + ' Tools' : hasSleight ? ' + ' + profBonus + ' Prof' : ''} = <b>${disarmMod >= 0 ? '+'+disarmMod : disarmMod}</b></p>
              <button class="btn primary" id="btnDisarm" style="width:100%;">🎲 Roll d20 Disarm Check</button>
            </div>
            <div style="text-align:center; margin-top:8px;">
              <button class="btn small" id="closeSkillModal">Step Away</button>
            </div>
          </div>`;
      } else {
        modal.innerHTML = `
          <div class="modal" style="max-width:460px;">
            <h2>🔒 ${esc(obj.name || 'Locked Chest')}</h2>
            <p class="small muted">The iron hinges and lock hold firm against casual inspection. Choose an approach to crack the lock.</p>
            <div style="display:flex; flex-direction:column; gap:10px; margin:14px 0;">
              <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span>🗝️ <b>Pick Tumbler Lock</b></span>
                  <span class="badge" style="color:var(--accent);">DC ${pickDc}</span>
                </div>
                <p class="small muted" style="margin:0 0 10px 0;">Sleight of Hand: DEX (${dexMod >= 0 ? '+'+dexMod : dexMod})${hasTools ? ' + ' + profBonus + ' Tools' : hasSleight ? ' + ' + profBonus + ' Prof' : ''} = <b>${pickMod >= 0 ? '+'+pickMod : pickMod}</b></p>
                <button class="btn" id="btnPick" style="width:100%;">🎲 Pick Lock (Roll d20 + ${pickMod})</button>
              </div>

              <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span>🔨 <b>Pry / Shatter Lock</b></span>
                  <span class="badge" style="color:var(--accent);">DC ${forceDc}</span>
                </div>
                <p class="small muted" style="margin:0 0 10px 0;">Athletics / Force: STR (${strMod >= 0 ? '+'+strMod : strMod})${hasAthletics ? ' + ' + profBonus + ' Prof' : ''} = <b>${forceMod >= 0 ? '+'+forceMod : forceMod}</b></p>
                <button class="btn" id="btnForce" style="width:100%;">🔨 Force Open (Roll d20 + ${forceMod})</button>
              </div>
            </div>
            <div style="text-align:center; margin-top:8px;">
              <button class="btn small" id="closeSkillModal">Leave Chest</button>
            </div>
          </div>`;
      }

      document.getElementById('closeSkillModal').addEventListener('click', () => modal.remove());

      if (isTrap) {
        document.getElementById('btnDisarm').addEventListener('click', async () => {
          /** @type {HTMLButtonElement} */ (document.getElementById('btnDisarm')).disabled = true;
          const nat = await rollAnimated(20, 'Disarm Trap');
          const total = nat + disarmMod;
          modal.remove();
          await ctx.act({ type: 'skillCheckObject', objectId: obj.id, rollTotal: total });
        });
      } else {
        document.getElementById('btnPick').addEventListener('click', async () => {
          /** @type {HTMLButtonElement} */ (document.getElementById('btnPick')).disabled = true;
          const nat = await rollAnimated(20, 'Pick Lock');
          const total = nat + pickMod;
          modal.remove();
          await ctx.act({ type: 'skillCheckObject', objectId: obj.id, method: 'pick', rollTotal: total });
        });
        document.getElementById('btnForce').addEventListener('click', async () => {
          /** @type {HTMLButtonElement} */ (document.getElementById('btnForce')).disabled = true;
          const nat = await rollAnimated(20, 'Force Lock');
          const total = nat + forceMod;
          modal.remove();
          await ctx.act({ type: 'skillCheckObject', objectId: obj.id, method: 'force', rollTotal: total });
        });
      }
    };
    render();
  }

  function openSummary() {
    const g = ctx.getGame();
    const st = g.stats || { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
    const won = g.mode === 'victory';
    const retreated = g.mode === 'retreat';
    let modal = document.getElementById('summaryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'summaryModal';
      document.body.appendChild(modal);
    }
    const dismiss = () => {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    };

    modal.innerHTML = `
      <div class="modal" style="position:relative; max-width:520px;">
        <button class="btn small" id="closeSummaryX" style="position:absolute; top:12px; right:12px; min-width:32px; padding:4px 8px; font-weight:bold; cursor:pointer;" title="Close summary">✕</button>
        <h2>${won ? '🏆 Delve Complete!' : (retreated ? '🏃 Retreated to Safety' : '💀 The Delve Ends… for now')}</h2>
        <p class="muted small">${esc(g.character.name)} · ${esc(g.mapName)} · level ${g.character.level}</p>
        <div class="stat-line"><span>⚔ Monsters slain</span><span>${st.kills || 0}</span></div>
        <div class="stat-line"><span>🗡 Damage dealt</span><span>${st.dmgDealt || 0}</span></div>
        <div class="stat-line"><span>🩸 Damage taken</span><span>${st.dmgTaken || 0}</span></div>
        <div class="stat-line"><span>💰 Gold banked</span><span>${g.character.gold || 0} gp (+${st.goldFound || 0} found)</span></div>
        <div class="stat-line"><span>⏱ Combat rounds</span><span>${st.rounds || 0}</span></div>
        <div class="stat-line"><span>📜 Side quests done</span><span>${(g.quests && g.quests.completed || []).length}</span></div>
        <div style="margin-top:16px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          ${(won || retreated)
            ? `<a class="btn primary sumNavBtn" href="#/overworld?char=${g.characterId}&return=${won ? 'victory' : 'retreat'}">🏰 Return to Oakhaven</a>
               <a class="btn sumNavBtn" href="#/overworld?char=${g.characterId}">🗺️ Region Map</a>
               <button class="btn" id="closeSummaryBtn">🔍 Review Delve</button>
               <a class="btn sumNavBtn" href="#/">Home</a>`
            : `<button class="btn primary" id="sumRespawn">🌅 Recover at camp</button>
               <a class="btn sumNavBtn" href="#/overworld?char=${g.characterId}">🏰 Retreat to Town</a>
               <button class="btn" id="closeSummaryBtn">🔍 Review Delve</button>
               <a class="btn sumNavBtn" href="#/">Home</a>`}
        </div>
      </div>`;

    // Automatically commit delve loot and progression back to persistent character
    if (g.characterId && g.id) {
      api.citySyncDelve({ charId: g.characterId, delveStateId: g.id }).catch(() => {});
    }

    modal.querySelectorAll('.sumNavBtn').forEach(btn => btn.addEventListener('click', dismiss));
    const closeX = document.getElementById('closeSummaryX');
    if (closeX) closeX.addEventListener('click', dismiss);
    const closeBtn = document.getElementById('closeSummaryBtn');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) dismiss();
    });

    const rr = document.getElementById('sumRespawn');
    if (rr) rr.addEventListener('click', () => { dismiss(); ctx.onSummaryRespawn(); });
  }

  return { openShop, openJournal, openSkillCheckModal, openSummary };
}

// the shared rules catalog (app.js publishes it on window.__rules)
function appStateRules() {
  return /** @type {any} */ (window).__rules || {};
}
