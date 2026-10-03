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

  let sceneModal = null, sceneId = null, sceneBusy = false, sceneError = '';
  function refreshScene() {
    if (!sceneModal?.isConnected) return;
    const scene = (ctx.getGame().scenes || []).find(s => s.id === sceneId);
    if (!scene || scene.phase === 'fighting') { sceneModal.remove(); return; }
    sceneModal.innerHTML = `
      <div class="modal" style="text-align:left;max-height:85vh;overflow-y:auto;">
        <h2>${esc(scene.name)}</h2>
        ${scene.phase === 'resolved' ? '' : `<p>${esc(scene.prompt)}</p>`}
        ${scene.memory ? `<p data-scene-memory class="card">${esc(scene.memory)}</p>` : ''}
        ${scene.outcome ? `<p data-scene-outcome>${esc(scene.outcome)}</p>` : ''}
        ${sceneError ? `<p role="alert">${esc(sceneError)}</p>` : ''}
        ${scene.phase === 'resolved' ? '' : scene.choices.map(c => `
          <div style="margin:12px 0;">
            <button class="btn" style="width:100%;white-space:normal;" data-scene-choice="${esc(c.id)}" ${sceneBusy || !c.available ? 'disabled' : ''}>${esc(c.label)}</button>
            ${c.reason ? `<p class="small muted" style="margin-top:4px;">${esc(c.reason)}</p>` : ''}
          </div>`).join('')}
        <button class="btn small" data-scene-close>${scene.phase === 'resolved' ? '继续探索' : '先去探索'}</button>
      </div>`;
    sceneModal.querySelector('[data-scene-close]').addEventListener('click', () => sceneModal.remove());
    sceneModal.querySelectorAll('[data-scene-choice]').forEach(button => button.addEventListener('click', async () => {
      if (sceneBusy) return;
      const modal = sceneModal, saveId = ctx.getGame().id;
      sceneBusy = true; sceneError = ''; refreshScene();
      try {
        const result = await ctx.act({ type: 'sceneChoice', sceneId, choiceId: /** @type {HTMLElement} */ (button).dataset.sceneChoice });
        if (modal !== sceneModal || !modal.isConnected || ctx.getGame().id !== saveId) return;
        sceneError = result ? (result.events || []).filter(e => e.type === 'error').map(e => e.text).join(' ') : '选择未完成，请重试。';
      } finally {
        sceneBusy = false;
        if (modal === sceneModal && modal.isConnected && ctx.getGame().id === saveId) refreshScene();
      }
    }));
  }
  function openScene(id) {
    sceneModal?.remove();
    sceneId = id; sceneError = ''; sceneBusy = false;
    sceneModal = document.createElement('div');
    sceneModal.className = 'modal-back'; sceneModal.id = 'sceneModal';
    document.body.appendChild(sceneModal);
    refreshScene();
  }

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

  // T7a: every number in this modal comes from the server's read-only check preview
  // (`POST /api/game/:id/preview`) — the client keeps NO copy of proficiency/expertise/
  // tools math, which is exactly how the old local +6 drifted from the engine's +8.
  // If the preview can't be fetched, the modal still offers the methods but promises no
  // numbers (the resolve event remains the only authority anyway).
  function openSkillCheckModal(obj) {
    let modal = document.getElementById('skillCheckModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'skillCheckModal';
      document.body.appendChild(modal);
    }
    const isTrap = obj.type === 'trap';
    const fmt = (m) => (m >= 0 ? '+' + m : String(m));

    const render = (preview) => {
      const methods = preview && Array.isArray(preview.methods) ? preview.methods : [];
      const byId = {};
      methods.forEach(m => { byId[m.id] = m; });
      const notes = (preview && preview.notes) || [];
      const notesHtml = notes.length
        ? `<p class="small muted" style="margin:10px 0 0;">${notes.map(n => `※ ${esc(n)}`).join('<br>')}</p>` : '';
      const methodBlock = (id, icon, name, noToolsHint) => {
        const m = byId[id];
        const dcHtml = m ? `<span class="badge" style="color:var(--accent);">DC ${m.dc}</span>` : '';
        const desc = m
          ? `d20 <b>${fmt(m.modifier)}</b>${m.requiresTools && !m.hasTools ? ` <span style="color:var(--gold);">⚠️ Requires thieves' tools</span>` : ''}`
          : (noToolsHint || '数值以实际裁决为准');
        const btn = m
          ? `<button class="btn" id="btn${id[0].toUpperCase() + id.slice(1)}" style="width:100%;">🎲 ${esc(m.label)} (d20 ${fmt(m.modifier)})</button>`
          : `<button class="btn" id="btn${id[0].toUpperCase() + id.slice(1)}" style="width:100%;">🎲 ${esc(name)}</button>`;
        return `
          <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span>${icon} <b>${esc(name)}</b></span>
              ${dcHtml}
            </div>
            <p class="small muted" style="margin:0 0 10px 0;">${desc}</p>
            ${btn}
          </div>`;
      };

      const title = isTrap
        ? `⚠️ ${esc(obj.name || 'Concealed Trap')}`
        : `🔒 ${esc(obj.name || 'Locked Chest')}`;
      const blurb = isTrap
        ? 'A mechanical hazard is revealed before you. You can attempt to disable its triggers, but tripping it will detonate the mechanism.'
        : 'The iron hinges and lock hold firm against casual inspection. Choose an approach to crack the lock.';
      modal.innerHTML = `
        <div class="modal" style="max-width:460px;">
          <h2>${title}</h2>
          <p class="small muted">${blurb}</p>
          <div style="display:flex; flex-direction:column; gap:10px; margin:14px 0;">
            ${isTrap
              ? methodBlock('disarm', '🛠️', 'Disarm Mechanism')
              : methodBlock('pick', '🗝️', 'Pick Tumbler Lock') + methodBlock('force', '🔨', 'Pry / Shatter Lock')}
          </div>
          ${notesHtml}
          <div style="text-align:center; margin-top:8px;">
            <button class="btn small" id="closeSkillModal">${isTrap ? 'Step Away' : 'Leave Chest'}</button>
          </div>
        </div>`;

      document.getElementById('closeSkillModal').addEventListener('click', () => modal.remove());

      const actWithDice = (id, btnId, method, diceLabel) => {
        const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById(btnId));
        if (!btn) return;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          modal.remove();
          const res = await ctx.act({ type: 'skillCheckObject', objectId: obj.id, method });
          const ev = res?.events?.find(e => e.type === 'chest_unlocked' || e.type === 'chest_locked' || e.type === 'trap_disarmed' || e.type === 'trap_disarm_failed');
          if (ev && ev.data && ev.data.natural != null) {
            await rollAnimated(20, diceLabel, ev.data.natural);
          }
        });
      };
      actWithDice('disarm', 'btnDisarm', undefined, 'Disarm Trap');
      actWithDice('pick', 'btnPick', 'pick', 'Pick Lock');
      actWithDice('force', 'btnForce', 'force', 'Force Lock');
    };

    // loading state, then the server's preview (or the no-numbers fallback)
    modal.innerHTML = `<div class="modal" style="max-width:460px;"><h2>${isTrap ? '⚠️ ' + esc(obj.name || 'Concealed Trap') : '🔒 ' + esc(obj.name || 'Locked Chest')}</h2><p class="small muted">正在读取检定参数…</p></div>`;
    ctx.getGame && api.gamePreview(ctx.getGame().id, { type: 'skillCheckObject', objectId: obj.id })
      .then((res) => render(res && res.preview))
      .catch(() => render(null));
  }

  // End-of-delve summary. The settlement POST is part of the panel: the nav actions stay
  // locked until the server confirms the spoils are banked (T3), a failure offers a retry,
  // and a replayed settle (reopened summary) returns the stored receipt — read-only, no
  // rewards are ever re-processed.
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
        <div id="summaryGains" class="summary-gains small muted">结算确认后显示本局收获。</div>
        <div id="summaryStory" class="small" style="margin-top:6px;"></div>
        <div id="summaryNext" class="small" style="margin-top:6px;"></div>
        <div class="stat-line" style="margin-top:8px;"><span id="summaryGoldLabel">💰 Gold this delve</span><span>${g.character.gold || 0} gp (+${st.goldFound || 0} found)</span></div>
        <details class="summary-details">
          <summary>📊 详细统计</summary>
          <div class="stat-line"><span>⚔ Monsters slain</span><span>${st.kills || 0}</span></div>
          <div class="stat-line"><span>🗡 Damage dealt</span><span>${st.dmgDealt || 0}</span></div>
          <div class="stat-line"><span>🩸 Damage taken</span><span>${st.dmgTaken || 0}</span></div>
          <div class="stat-line"><span>⏱ Combat rounds</span><span>${st.rounds || 0}</span></div>
          <div class="stat-line"><span>📜 Side quests done</span><span>${(g.quests && g.quests.completed || []).length}</span></div>
        </details>
        <div id="summarySaveState" class="small" style="margin-top:10px; text-align:center;"></div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
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

    const statusEl = document.getElementById('summarySaveState');
    const gainsEl = document.getElementById('summaryGains');
    const storyEl = document.getElementById('summaryStory');
    const nextEl = document.getElementById('summaryNext');
    const goldLabelEl = document.getElementById('summaryGoldLabel');
    const navBtns = Array.from(modal.querySelectorAll('.sumNavBtn'));
    const respawnBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('sumRespawn'));
    // the return links stay inert until the server confirms the settle — the flag backs the
    // click guard below, because .locked's pointer-events:none only stops the mouse
    let navLocked = true;
    const setNavEnabled = (on) => {
      navLocked = !on;
      navBtns.forEach(a => {
        a.classList.toggle('locked', !on);
        a.setAttribute('aria-disabled', String(!on));
        if (on) a.removeAttribute('tabindex'); else a.setAttribute('tabindex', '-1');
      });
      if (respawnBtn) respawnBtn.disabled = !on;
    };
    const receiptLine = (r) => `Receipt ${esc(r.id)} · ${esc(r.mode)} · ${new Date(r.ts).toLocaleString()}`;
    // T4 — after the server confirms: what this delve actually paid, whether the story
    // moved, and the (server-computed) next objective. Reopenings skip the story line.
    const renderOutcome = (info) => {
      const r = info && info.receipt;
      if (gainsEl && r) {
        const gains = r.gains;
        if (gains) {
          const parts = [];
          if (gains.gold) parts.push(`${gains.gold > 0 ? '+' : ''}${gains.gold} gp`);
          if (gains.xp) parts.push(`${gains.xp > 0 ? '+' : ''}${gains.xp} XP`);
          if (gains.levels > 0) parts.push(`等级 +${gains.levels}`);
          gainsEl.classList.remove('muted');
          gainsEl.innerHTML = `<b>本次结算：</b>${parts.length ? parts.join(' · ') : '没有新的战利品'}`;
        } else {
          gainsEl.innerHTML = `<b>本局已入账</b>（旧收据未记录增量）：金币 ${r.gold || 0} gp · XP ${r.xp || 0}`;
        }
      }
      if (storyEl) {
        const log = (info && info.char && info.char.campaignLog) || [];
        const last = log.length ? log[log.length - 1] : null;
        if (!info.duplicate && r && r.campaignAdvanced) {
          storyEl.innerHTML = `<span class="gold-text">📜 故事推进：</span>${esc((last && last.text) || '主线向前了一步。')}`;
        }
      }
      if (nextEl) {
        const guide = info && info.guidance;
        if (guide && guide.objective && !guide.objective.done) {
          nextEl.innerHTML = `<span class="muted">🎯 下一目标：</span>${esc(guide.objective.text)}` +
            (guide.primary ? `<br><span class="muted small">${esc(guide.primary.text)}${guide.primary.reason ? ' — ' + esc(guide.primary.reason) : ''}</span>` : '');
        } else if (guide && guide.objective && guide.objective.done) {
          nextEl.innerHTML = `<span class="muted">🎯 </span>${esc(guide.objective.text)} <a href="#/campaign/${esc(g.characterId)}">查看收场词 ↗</a>`;
        }
      }
    };
    const renderStatus = (state, info) => {
      if (!statusEl) return;
      if (state === 'saving') {
        statusEl.innerHTML = `<span class="muted">💾 Saving your spoils to ${esc(g.character.name)}…</span>`;
      } else if (state === 'saved') {
        const dup = info && info.duplicate;
        const line = info && info.receipt ? `<span class="muted small" style="display:block; margin-top:2px;">${receiptLine(info.receipt)}</span>` : '';
        statusEl.innerHTML = `<span style="color:var(--accent);">✅ ${dup ? 'Already settled — receipt confirmed, no double rewards.' : 'Spoils banked — saved to your hero.'}</span>${line}`;
        if (goldLabelEl) goldLabelEl.textContent = '💰 Gold banked';
        renderOutcome(info);
      } else if (state === 'failed') {
        const msg = info && info.message ? esc(String(info.message || '').slice(0, 120)) : 'unknown error';
        statusEl.innerHTML = `<span style="color:#e06c5a;">⚠️ Save failed — spoils not banked yet (${msg}).</span>
          <button class="btn small" id="summaryRetryBtn" style="margin-left:8px;">🔄 Retry save</button>`;
        const retry = document.getElementById('summaryRetryBtn');
        if (retry) retry.addEventListener('click', () => settle());
      }
    };

    let saving = false;
    const settle = async () => {
      if (saving || !g.characterId || !g.id) return;
      saving = true;
      renderStatus('saving');
      setNavEnabled(false);
      try {
        const r = await api.citySyncDelve({ charId: g.characterId, delveStateId: g.id });
        renderStatus('saved', r);
        setNavEnabled(true);
      } catch (e) {
        renderStatus('failed', e);
      } finally {
        saving = false;
      }
    };

    if (g.characterId && g.id) settle(); else setNavEnabled(true);

    modal.querySelectorAll('.sumNavBtn').forEach(btn => btn.addEventListener('click', (e) => {
      // a real mouse click on a .locked link never lands (pointer-events:none), but a
      // focused link's Enter and a scripted .click() both fire here — hold navigation
      // until the settle confirms so the spoils can't be abandoned mid-save
      if (navLocked) { e.preventDefault(); e.stopPropagation(); return; }
      dismiss();
    }));
    const closeX = document.getElementById('closeSummaryX');
    if (closeX) closeX.addEventListener('click', dismiss);
    const closeBtn = document.getElementById('closeSummaryBtn');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) dismiss();
    });

    const rr = /** @type {HTMLButtonElement | null} */ (document.getElementById('sumRespawn'));
    if (rr) rr.addEventListener('click', () => { if (rr.disabled) return; dismiss(); ctx.onSummaryRespawn(); });
  }

  return { openShop, openJournal, openSkillCheckModal, openSummary, openScene, refreshScene };
}

// the shared rules catalog (app.js publishes it on window.__rules)
function appStateRules() {
  return /** @type {any} */ (window).__rules || {};
}
