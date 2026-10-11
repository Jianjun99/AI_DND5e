import { contentLabel,  t, label, localizeText, displayLabel, getLocale } from "../../i18n.js";
// panels.js — the delve screen's self-contained modal panels
// (shop / journal / skill-check / end-of-delve summary), extracted from play.js.
// The panels read live game state through ctx.getGame() and dispatch player
// actions through ctx.act, so play.js keeps owning all shared state.

import { esc } from '../../app.js';
import { api } from '../../api.js';
import { initTooltips } from '../../tooltip.js';
import { rollAnimated } from '../../dice.js';
import { presentModal, dismissModal } from '../../modal.js';

/**
 * @typedef {Object} PanelsCtx
 * @property {() => any} getGame live delve-state getter (the state object is
 *   replaced on every action/poll, so never cache it)
 * @property {(action: any) => Promise<any>} act dispatch a player action
 * @property {(npcId: string, npcName: string) => void} onShopTalk switch the
 *   chat bar into "talk to this merchant" mode
 * @property {() => void} onSummaryRespawn called after the summary's respawn
 *   button dismisses the panel (play.js resets its summary guard + respawns)
 * @property {(locked: boolean) => void} onSummaryLock coordinate all return entries
 */

/** @param {PanelsCtx} ctx */
export function createPanels(ctx) {

  let sceneModal = null, sceneId = null, sceneBusy = false, sceneError = '', sceneErrorKey = '';
  let sceneErrors=[];
  let sceneRenderKey = '';
  function refreshScene() {
    if (!sceneModal?.isConnected) return;
    const scene = (ctx.getGame().scenes || []).find(s => s.id === sceneId);
    if (!scene || scene.phase === 'fighting') { dismissModal(sceneModal); return; }
    // Equal-revision polling still updates the board, but must not replace focused
    // choices or reset the reading position when their server context is unchanged.
    const renderKey = JSON.stringify([scene, sceneBusy, sceneError, sceneErrorKey, sceneErrors]);
    if (renderKey === sceneRenderKey && sceneModal.firstElementChild) return;
    sceneRenderKey = renderKey;
    const previousBody = sceneModal.querySelector('.modal');
    const focused = document.activeElement;
    const restoreFocus = previousBody?.contains(focused);
    const focusedChoice = focused?.getAttribute('data-scene-choice');
    const scrollTop = previousBody?.scrollTop || 0;
    sceneModal.innerHTML = `
      <div class="modal" style="text-align:left;max-height:85vh;overflow-y:auto;">
        <h2>${contentLabel(scene,"name")}</h2>
        ${scene.companion?.speaks && scene.phase !== 'resolved' ? `<p class="small muted">${esc(scene.companion.icon || '')} ${displayLabel(scene.companion.nameDisplay, scene.companion.name)}</p>` : ''}
        ${scene.phase === 'resolved' ? '' : `<p>${contentLabel(scene,"prompt")}</p>`}
        ${scene.memory ? `<p data-scene-memory class="card">${contentLabel(scene,"memory")}</p>` : ''}
        ${scene.outcome ? `<p data-scene-outcome>${contentLabel(scene,"outcome")}</p>` : ''}
        ${scene.companion?.reaction ? `<p data-scene-companion class="card">${esc(scene.companion.icon || '🏹')} ${displayLabel(scene.companion.reactionDisplay, scene.companion.reaction)}</p>` : ''}
        ${sceneError || sceneErrorKey ? `<p role="alert">${sceneErrorKey ? label(sceneErrorKey) : displayLabel({parts:sceneErrors.map(e=>e.textDisplay || (e.messageKey?e:e.text)),separator:' '},sceneError)}</p>` : ''}
        ${scene.phase === 'resolved' ? '' : scene.choices.map(c => `
          <div style="margin:12px 0;">
            <button class="btn" style="width:100%;white-space:normal;" data-scene-choice="${esc(c.id)}" ${sceneBusy || !c.available ? 'disabled' : ''}>${displayLabel(c.labelDisplay,c.label)}</button>
            ${c.riskDisplay ? `<p class="small muted" data-scene-risk style="margin-top:4px;">${displayLabel(c.riskDisplay)}</p>` : ''}
            ${c.reason ? `<p class="small muted" style="margin-top:4px;">${displayLabel(c.reasonDisplay,c.reason)}</p>` : ''}
          </div>`).join('')}
        ${scene.result ? `<p class="small" data-scene-cost>${label('story.result.cost', {gold: scene.result.costGold})}${scene.result.loyaltyDelta ? '<br>' + label('story.loyalty', {delta: (scene.result.loyaltyDelta > 0 ? '+' : '') + scene.result.loyaltyDelta}) : ''}${scene.result.check ? '<br>' + label('story.result.check', {...scene.result.check, outcome: t(scene.result.check.success ? 'story.success' : 'story.failure')}) : ''}</p>` : ''}
        <button class="btn small" data-scene-close>${scene.phase === 'resolved' ? label("ui.panels.continue_exploring") : label("ui.panels.explore_first")}</button>
      </div>`;
    sceneModal.querySelector('[data-scene-close]').addEventListener('click', () => dismissModal(sceneModal));
    sceneModal.querySelectorAll('[data-scene-choice]').forEach(button => button.addEventListener('click', async () => {
      if (sceneBusy) return;
      const modal = sceneModal, saveId = ctx.getGame().id;
      sceneBusy = true; sceneError = ''; sceneErrorKey = ''; refreshScene();
      try {
        const result = await ctx.act({ type: 'sceneChoice', sceneId, choiceId: /** @type {HTMLElement} */ (button).dataset.sceneChoice });
        if (modal !== sceneModal || !modal.isConnected || ctx.getGame().id !== saveId) return;
        sceneErrors = result ? (result.events || []).filter(e => e.type === 'error') : [];
        sceneError = sceneErrors.map(e=>e.text).join(' ');
        sceneErrorKey = result ? '' : 'ui.panels.choice_did_not_complete_please_retry';
      } finally {
        sceneBusy = false;
        if (modal === sceneModal && modal.isConnected && ctx.getGame().id === saveId) refreshScene();
      }
    }));
    sceneModal.querySelector('.modal').scrollTop = scrollTop;
    if (restoreFocus) {
      const selector = focusedChoice ? '[data-scene-choice="' + CSS.escape(focusedChoice) + '"]:not(:disabled)' : '[data-scene-close]';
      const control = /** @type {HTMLElement} */ (sceneModal.querySelector(selector) || sceneModal.querySelector('[data-scene-close]'));
      control?.focus({preventScroll:true});
    }
  }
  function openScene(id) {
    if (sceneModal) dismissModal(sceneModal);
    sceneId = id; sceneError = ''; sceneErrorKey = ''; sceneBusy = false;
    sceneRenderKey = '';
    sceneModal = document.createElement('div');
    sceneModal.className = 'modal-back'; sceneModal.id = 'sceneModal';
    if (!presentModal(sceneModal)) return;
    refreshScene();
  }

  function openShop(merchantName = 'Marla the Peddler', merchantId = 'marla') {
    let modal = document.getElementById('shopModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'shopModal';
      if (!presentModal(modal)) return;
    }
    const items = appStateRules().shop || [];
    const render = () => {
      const g = ctx.getGame();
      modal.innerHTML = `
        <div class="modal">
          <h2>🧺 ${esc(merchantName)}</h2>
          <p class="muted small">"Potions, tools, and luck, dear — I sell the first two."</p>
          <p class="small">${label("ui.panels.your_gold")} <b style="color:var(--gold)">${g.character.gold} gp</b></p>
          ${items.map(i => `
            <div class="stat-line" data-item-tooltip="${i.id}" style="cursor:help;"><span>${contentLabel(i,"name")} <span class="muted small">— ${contentLabel(i,"desc")}</span></span>
              <span><button class="btn small" data-buy="${i.id}" ${g.character.gold >= i.price ? '' : 'disabled'}>${i.price} gp</button></span></div>`).join('')}
          <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
            <button class="btn small" id="talkMarla">${label("ui.panels.talk_to_the_trader")}</button>
            <button class="btn small" id="closeShop">${label("ui.panels.leave")}</button>
          </div>
        </div>`;
      initTooltips(modal, appStateRules());
      modal.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
        await ctx.act({ type: 'buy', itemId: /** @type {HTMLButtonElement} */ (b).dataset.buy });
        render();
      }));
      document.getElementById('closeShop').addEventListener('click', () => dismissModal(modal));
      document.getElementById('talkMarla').addEventListener('click', () => {
        dismissModal(modal);
        ctx.onShopTalk(merchantId, merchantName);
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
      if (!presentModal(modal)) return;
    }
    modal.innerHTML = `
      <div class="modal" style="text-align:left; max-height:80vh; overflow-y:auto;">
        <h2>${label("ui.panels.adventurer_s_journal")}</h2>
        ${entries.length ? entries.map(e2 => `
          <div class="card" style="margin:10px 0; background:var(--bg2);">
            <p class="small muted" style="margin-bottom:6px;">${new Date(e2.ts).toLocaleString()}</p>
            <p style="font-family:var(--font-serif); font-size:14.5px;">${contentLabel(e2,"text")}</p>
          </div>`).join('')
        : `<p class="muted" style="margin:14px 0;">${label("ui.panels.your_journal_is_empty_write_an_entry")}</p>`}
        ${(g.quests?.completed || []).length ? `
          <h3 style="margin-top:14px;">${label("ui.panels.completed_side_quests")}</h3>
          ${g.quests.completed.map(q => `<div class="stat-line"><span>${contentLabel(q,"shortText")}</span><span>+${q.reward.gold} gp · +${q.reward.xp} XP</span></div>`).join('')}` : ''}
        <div style="text-align:center; margin-top:12px;">
          <button class="btn small" id="closeJournal">${label("ui.panels.close")}</button>
        </div>
      </div>`;
    document.getElementById('closeJournal').addEventListener('click', () => dismissModal(modal));
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
      if (!presentModal(modal)) return;
    }
    const isTrap = obj.type === 'trap';
    const fmt = (m) => (m >= 0 ? '+' + m : String(m));

    const render = (preview) => {
      const methods = preview && Array.isArray(preview.methods) ? preview.methods : [];
      const byId = {};
      methods.forEach(m => { byId[m.id] = m; });
      const notes = (preview && preview.notes) || [];
      const notesDisplay = preview?.notesDisplay || [];
      const notesHtml = notes.length
        ? `<p class="small muted" style="margin:10px 0 0;">${notes.map((n, index) => `※ ${displayLabel(notesDisplay[index], n)}`).join('<br>')}</p>` : '';
      const methodBlock = (id, icon, nameKey, noToolsHint) => {
        const name = label(nameKey);
        const m = byId[id];
        const dcHtml = m ? `<span class="badge" style="color:var(--accent);">DC ${m.dc}</span>` : '';
        const desc = m
          ? `d20 <b>${fmt(m.modifier)}</b>${m.requiresTools && !m.hasTools ? ` <span style="color:var(--gold);">${label("ui.panels.requires_thieves_tools")}</span>` : ''}`
          : (noToolsHint || label("ui.panels.numbers_come_from_the_actual_ruling"));
        const btn = m
          ? `<button class="btn" id="btn${id[0].toUpperCase() + id.slice(1)}" style="width:100%;">🎲 ${displayLabel(m.labelDisplay, m.label)} (d20 ${fmt(m.modifier)})</button>`
          : `<button class="btn" id="btn${id[0].toUpperCase() + id.slice(1)}" style="width:100%;">🎲 ${name}</button>`;
        return `
          <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span>${icon} <b>${name}</b></span>
              ${dcHtml}
            </div>
            <p class="small muted" style="margin:0 0 10px 0;">${desc}</p>
            ${btn}
          </div>`;
      };

      const title = isTrap
        ? `⚠️ ${obj.name ? contentLabel(obj, 'name') : label("ui.panels.concealed_trap")}`
        : `🔒 ${obj.name ? contentLabel(obj, 'name') : label("ui.panels.locked_chest")}`;
      const blurb = isTrap
        ? label("ui.panels.a_mechanical_hazard_is_revealed_before_you")
        : label("ui.panels.the_iron_hinges_and_lock_hold_firm");
      modal.innerHTML = `
        <div class="modal" style="max-width:460px;">
          <h2>${title}</h2>
          <p class="small muted">${blurb}</p>
          <div style="display:flex; flex-direction:column; gap:10px; margin:14px 0;">
            ${isTrap
              ? methodBlock('disarm', '🛠️', "ui.panels.disarm_mechanism")
              : methodBlock('pick', '🗝️', "ui.panels.pick_tumbler_lock") + methodBlock('force', '🔨', "ui.panels.pry_shatter_lock")}
          </div>
          ${notesHtml}
          <div style="text-align:center; margin-top:8px;">
            <button class="btn small" id="closeSkillModal">${isTrap ? label("ui.panels.step_away") : label("ui.panels.leave_chest")}</button>
          </div>
        </div>`;

      document.getElementById('closeSkillModal').addEventListener('click', () => dismissModal(modal));

      const actWithDice = (id, btnId, method, diceLabel) => {
        const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById(btnId));
        if (!btn) return;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          dismissModal(modal);
          const res = await ctx.act({ type: 'skillCheckObject', objectId: obj.id, method });
          const ev = res?.events?.find(e => e.type === 'chest_unlocked' || e.type === 'chest_locked' || e.type === 'trap_disarmed' || e.type === 'trap_disarm_failed');
          if (ev && ev.data && ev.data.natural != null) {
            await rollAnimated(20, t(diceLabel), ev.data.natural);
          }
        });
      };
      actWithDice('disarm', 'btnDisarm', undefined, "ui.panels.disarm_trap");
      actWithDice('pick', 'btnPick', 'pick', "ui.panels.pick_lock");
      actWithDice('force', 'btnForce', 'force', "ui.panels.force_lock");
    };

    // loading state, then the server's preview (or the no-numbers fallback)
    modal.innerHTML = `<div class="modal" style="max-width:460px;"><h2>${isTrap ? '⚠️ ' : '🔒 '}${obj.name ? contentLabel(obj, 'name') : label(isTrap ? "ui.panels.concealed_trap" : "ui.panels.locked_chest")}</h2><p class="small muted">${label("ui.panels.loading_check_parameters")}</p></div>`;
    const saveId = ctx.getGame().id;
    const current = () => modal.isConnected && ctx.getGame().id === saveId;
    api.gamePreview(saveId, { type: 'skillCheckObject', objectId: obj.id })
      .then((res) => { if (current()) render(res && res.preview); })
      .catch(() => { if (current()) render(null); });
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
      if (!presentModal(modal)) return;
    }
    const dismiss = () => {
      if (!navLocked) dismissModal(modal);
    };

    modal.innerHTML = `
      <div class="modal" style="position:relative; max-width:520px;">
        <button class="btn small" id="closeSummaryX" style="position:absolute; top:12px; right:12px; min-width:32px; padding:4px 8px; font-weight:bold; cursor:pointer;" data-i18n-title="ui.panels.close_summary" title="${esc(t("ui.panels.close_summary"))}">✕</button>
        <h2>${won ? label("ui.panels.delve_complete") : (retreated ? label("ui.panels.retreated_to_safety") : label("ui.panels.the_delve_ends_for_now"))}</h2>
        <p class="muted small">${label("ui.panels.level_values", {p2: (g.character.nameDisplay || g.character.name), p3: (g.mapNameDisplay || g.mapName), p4: g.character.level})}</p>
        <div id="summaryGains" class="summary-gains small muted">${label("ui.panels.delve_gains_will_appear_after_settlement_is")}</div>
        <div id="summaryStory" class="small" style="margin-top:6px;"></div>
        <div id="summaryAdventure" class="small" style="margin-top:8px;"></div>
        <div id="summaryNext" class="small" style="margin-top:6px;"></div>
        <div class="stat-line" style="margin-top:8px;"><span id="summaryGoldLabel">${label("ui.panels.gold_this_delve")}</span><span>${label("ui.panels.gp_found_values", {p7: g.character.gold || 0, p8: st.goldFound || 0})}</span></div>
        <details class="summary-details">
          <summary>${label("ui.panels.detailed_statistics")}</summary>
          <div class="stat-line"><span>${label("ui.panels.monsters_slain")}</span><span>${st.kills || 0}</span></div>
          <div class="stat-line"><span>${label("ui.panels.damage_dealt")}</span><span>${st.dmgDealt || 0}</span></div>
          <div class="stat-line"><span>${label("ui.panels.damage_taken")}</span><span>${st.dmgTaken || 0}</span></div>
          <div class="stat-line"><span>${label("ui.panels.combat_rounds")}</span><span>${st.rounds || 0}</span></div>
          <div class="stat-line"><span>${label("ui.panels.side_quests_done")}</span><span>${(g.quests && g.quests.completed || []).length}</span></div>
        </details>
        <div id="summarySaveState" class="small" style="margin-top:10px; text-align:center;"></div>
        <div style="margin-top:12px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          ${g.isPlaytest
            ? `<a class="btn primary sumNavBtn" href="#/author?draft=${esc(g.ownerDraftId || '')}">${label("ui.panels.return_to_author")}</a>
               <button class="btn" id="closeSummaryBtn">${label("ui.panels.review_delve")}</button>`
            : ((won || retreated)
              ? `<a class="btn primary sumNavBtn" href="#/overworld?char=${g.characterId}&return=${won ? 'victory' : 'retreat'}">${label("ui.panels.return_to_oakhaven")}</a>
                 <a class="btn sumNavBtn" href="#/overworld?char=${g.characterId}">${label("ui.panels.region_map")}</a>
                 <button class="btn" id="closeSummaryBtn">${label("ui.panels.review_delve")}</button>
                 <a class="btn sumNavBtn" href="#/">${label("ui.panels.home")}</a>`
              : `<button class="btn primary" id="sumRespawn">${label("ui.panels.recover_at_camp")}</button>
                 <a class="btn sumNavBtn" href="#/overworld?char=${g.characterId}">${label("ui.panels.retreat_to_town")}</a>
                 <button class="btn" id="closeSummaryBtn">${label("ui.panels.review_delve")}</button>
                 <a class="btn sumNavBtn" href="#/">${label("ui.panels.home")}</a>`)}
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
      ctx.onSummaryLock(!on);
      navBtns.forEach(a => {
        a.classList.toggle('locked', !on);
        a.setAttribute('aria-disabled', String(!on));
        if (on) a.removeAttribute('tabindex'); else a.setAttribute('tabindex', '-1');
      });
      if (respawnBtn) respawnBtn.disabled = !on;
      modal.querySelectorAll('#closeSummaryX, #closeSummaryBtn').forEach(button => {
        /** @type {HTMLButtonElement} */ (button).disabled = !on;
      });
    };
    const receiptText = (r) => t('ui.panels.receipt', {
      id: r.id, mode: ['retreat', 'victory', 'over'].includes(r.mode) ? t('ui.panels.mode.' + r.mode) : r.mode,
      date: new Date(r.ts).toLocaleString(getLocale())
    });
    // T4 — after the server confirms: what this delve actually paid, whether the story
    // moved, and the (server-computed) next objective. Reopenings skip the story line.
    const renderOutcome = (info) => {
      const r = info && info.receipt;
      const adventure = r?.story;
      const adventureEl = document.getElementById('summaryAdventure');
      if (adventureEl && adventure) {
        adventureEl.innerHTML = `<h3>${contentLabel(adventure, 'name')}</h3><p>${adventure.ending ? contentLabel(adventure, 'outcome') : label('story.incomplete')}</p>` +
          adventure.choices.map(c => `<p data-story-choice><b>${contentLabel(c, 'name')}</b><br>${contentLabel(c, 'label')}<br>${label('story.result.cost', {gold:c.costGold})}${c.consumedItem ? '<br>' + displayLabel({key:'story.risk.consume',params:{item:c.consumedItemDisplay || c.consumedItem}}) : ''}${c.check ? '<br>' + label('story.result.check', {...c.check,outcome:t(c.check.success?'story.success':'story.failure')}) : ''}</p>`).join('');
      }
      if (gainsEl && r) {
        const gains = r.gains;
        if (gains) {
          const parts = [];
          if (gains.gold) parts.push(`${gains.gold > 0 ? '+' : ''}${gains.gold} gp`);
          if (gains.xp) parts.push(`${gains.xp > 0 ? '+' : ''}${gains.xp} XP`);
          if (gains.levels > 0) parts.push(label("ui.panels.levelGain", { levels: gains.levels }));
          gainsEl.classList.remove('muted');
          gainsEl.innerHTML = `<b>${label("ui.panels.settlement")}</b>${parts.length ? parts.join(' · ') : label("ui.panels.no_new_loot")}`;
        } else {
          gainsEl.innerHTML = `<b>${label("ui.panels.gains_saved")}</b> ${label("ui.panels.legacyGains", { gold: r.gold || 0, xp: r.xp || 0 })}`;
        }
      }
      if (storyEl) {
        const log = (info && info.char && info.char.campaignLog) || [];
        const last = log.length ? log[log.length - 1] : null;
        if (!info.duplicate && r && r.campaignAdvanced) {
          storyEl.innerHTML = `<span class="gold-text">${label("ui.panels.story_advancement")}</span>${last?.text ? contentLabel(last, 'text') : label("ui.panels.the_story_moved_forward")}`;
        }
      }
      if (nextEl) {
        const guide = info && info.guidance;
        if (guide && guide.objective && !guide.objective.done) {
          nextEl.innerHTML = `<span class="muted">${label("ui.panels.next_objective")}</span>${contentLabel(guide.objective,"text")}` +
            (guide.primary ? `<br><span class="muted small">${displayLabel(guide.primary.textDisplay, guide.primary.text)}${guide.primary.reason ? ' — ' + displayLabel(guide.primary.reasonDisplay, guide.primary.reason) : ''}</span>` : '');
        } else if (guide && guide.objective && guide.objective.done) {
          nextEl.innerHTML = `<span class="muted">🎯 </span>${contentLabel(guide.objective,"text")} <a href="#/campaign/${esc(g.characterId)}">${label("ui.panels.read_epilogue")}</a>`;
        }
      }
    };
    const renderStatus = (state, info) => {
      if (!statusEl) return;
      if (state === 'saving') {
        statusEl.innerHTML = `<span class="muted">${label("ui.panels.saving_your_spoils_to_values", {p0: (g.character.nameDisplay || g.character.name)})}</span>`;
      } else if (state === 'saved') {
        const dup = info && info.duplicate;
        const line = info && info.receipt ? '<span class="summary-receipt muted small" style="display:block; margin-top:2px;"></span>' : '';
        const savedLabel = info?.isPlaytest
          ? label("ui.panels.playtest_settled_safe")
          : (dup ? label("ui.panels.already_settled_receipt_confirmed_no_double_rewards") : label("ui.panels.spoils_banked_saved_to_your_hero"));
        statusEl.innerHTML = `<span style="color:var(--accent);">✅ ${savedLabel}</span>${line}`;
        if (info?.receipt) localizeText(statusEl.querySelector('.summary-receipt'), () => receiptText(info.receipt));
        if (goldLabelEl) localizeText(goldLabelEl, () => t(info?.isPlaytest ? "ui.panels.playtest_gold" : "ui.panels.gold_banked"));
        renderOutcome(info);
      } else if (state === 'failed') {
        statusEl.innerHTML = `<span id="summaryFailure" style="color:#e06c5a;"></span>
          <button class="btn small" id="summaryRetryBtn" style="margin-left:8px;">${label("ui.panels.retry_save")}</button>`;
        localizeText(document.getElementById('summaryFailure'), () => t('ui.panels.save_failed_spoils_not_banked_yet_values', {
          p0: info && info.message ? String(info.message).slice(0, 120) : t('ui.panels.unknown_error')
        }));
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
        if (!modal.isConnected) return;
        renderStatus('saved', r);
        setNavEnabled(true);
      } catch (e) {
        if (modal.isConnected) renderStatus('failed', e);
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
