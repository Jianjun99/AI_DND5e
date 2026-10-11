import { contentLabel,  t, label } from "../../i18n.js";
// road-encounter.js — the roadside encounter modal (wandering peddler, goblin ambush,
// wayside shrine). T7a lifecycle rules:
//   - the modal NEVER triggers an encounter itself; callers pass the server's engine-built
//     view (template + instanceId + resolution state). No encounter data → nothing to do.
//   - restore mode: a resolved-but-unconsumed instance renders its stored result with the
//     continue button, so a refresh / failed start can pick the choice back up without
//     re-resolving or re-awarding anything.
//   - async callbacks check `opts.alive()` before touching the DOM, so a response that
//     lands after a hero switch / view change cannot act on the old page.
//   - ambush option modifiers come from `enc.checks` (engine-computed, same figures the
//     server rolls with). When absent the modal omits the number instead of guessing.

import { api } from '../../api.js';
import { esc, toast } from '../../app.js';
import { rollAnimated } from '../../dice.js';

export async function showRoadEncounterModal(char, mapId, embarkCallback, encounterData, opts = {}) {
  const alive = opts.alive || (() => true);
  const enc = encounterData;
  if (!enc) {
    // never silently "continue past" a missing encounter — the caller's failure toast owns this
    toast(() => t("ui.road-encounter.road_encounter_data_missing_please_retry"));
    return;
  }

  // one modal at a time: replace any previous instance (same live encounter either way)
  document.querySelectorAll('#roadEncounterModal').forEach(m => m.remove());
  const modal = document.createElement('div');
  modal.className = 'modal-back';
  modal.id = 'roadEncounterModal';
  document.body.appendChild(modal);

  let resolved = !!enc.resolved;
  const resultLabel = result => '<span style="white-space:pre-line">' + contentLabel(result,'text') + '</span>';
  const initialResult = resolved && enc.result && enc.result.text ? resultLabel(enc.result) : '';

  const render = (resHtml = '') => {
    if (!alive() || !modal.isConnected) return;
    if (enc.id === 'peddler') {
      modal.innerHTML = `
        <div class="modal encounter-modal">
          <div class="encounter-header">
            <span style="font-size:32px;">${enc.icon}</span>
            <div>
              <h2 class="encounter-title">${contentLabel(enc,"title")}</h2>
              <span class="badge" style="color:var(--gold);">${label("ui.road-encounter.roadside_encounter")}</span>
            </div>
          </div>
          <p class="encounter-blurb">${contentLabel(enc,"desc")}</p>
          <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--gold); padding:8px 12px; margin-bottom:14px; font-style:italic;" class="small">
            ${contentLabel(enc,"blurb")}
          </div>
          <p class="small">${label("ui.road-encounter.your_purse")} <b style="color:var(--gold);">${char.gold || 0} GP</b></p>
          <div style="display:flex; flex-direction:column; gap:8px; margin:12px 0;">
            ${enc.wares.map(w => `
              <div class="stat-line" style="background:var(--bg-box); padding:8px 12px; border-radius:6px; border:1px solid var(--border);">
                <div>
                  <b>${contentLabel(w,"name")}</b> <span class="muted small">— ${contentLabel(w,"desc")}</span>
                </div>
                <div>
                  <button class="btn small" data-buy-item="${w.id}" data-price="${w.price}" ${(char.gold || 0) >= w.price ? '' : 'disabled'}>
                    💰 ${w.price} GP
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          ${resHtml ? `<div class="encounter-res-box">${resHtml}</div>` : ''}
          <div style="margin-top:16px; text-align:right;">
            <button class="btn primary big" id="continueDelveBtn">${label("ui.road-encounter.bid_farewell_enter_delve")}</button>
          </div>
        </div>
      `;

      (/** @type {NodeListOf<HTMLButtonElement>} */ (modal.querySelectorAll('[data-buy-item]'))).forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.getAttribute('data-buy-item');
          const ware = enc.wares.find(w => w.id === itemId);
          const itemDisplay = ware?.nameDisplay || ware?.name || itemId;
          const price = parseInt(btn.getAttribute('data-price'), 10);
          if ((char.gold || 0) < price) return;
          try {
            btn.disabled = true;
            await api.cityBuy(char.id, itemId, 1);
            if (!alive()) return;
            char.gold -= price;
            char.inventory = char.inventory || [];
            const ex = char.inventory.find(i => i.itemId === itemId);
            if (ex) ex.qty++; else char.inventory.push({ itemId, qty: 1 });
            toast(() => t('ui.road.purchased', { item: itemDisplay, price }));
            render(`<span style="color:var(--green)">${label("ui.road-encounter.bought_added_to_your_inventory_values", {p0: itemDisplay})}</span>`);
          } catch (e) {
            if (!alive()) return;
            toast(() => e.message);
            btn.disabled = false;
          }
        });
      });

      wirePeddlerContinue();

      function wirePeddlerContinue() {
        const continueBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('continueDelveBtn'));
        if (!continueBtn) return;
        continueBtn.addEventListener('click', async () => {
          if (continueBtn.disabled) return;
          continueBtn.disabled = true;
          if (!resolved) {
            try {
              await api.resolveRoadEncounter(char.id, 'leave', enc.instanceId);
              if (!alive()) return;
              resolved = true;
            } catch (e) {
              // resolve failed — keep the modal open so the choice can be retried (T7a)
              if (!alive()) return;
              toast(() => e.message);
              render(`<b style="color:var(--red)">${esc(e.message)}</b>`);
              return;
            }
          }
          const ok = await embarkCallback();
          if (ok === false) {
            // start failed — encounter stays live; keep the modal so continue can retry
            continueBtn.disabled = false;
            return;
          }
          modal.remove();
        });
      }

    } else if (enc.id === 'ambush') {
      const fightMod = enc.checks && enc.checks.fight ? enc.checks.fight.modifier : null;
      const sneakMod = enc.checks && enc.checks.sneak ? enc.checks.sneak.modifier : null;
      const fmtMod = m => (m >= 0 ? '+' + m : String(m));

      modal.innerHTML = `
        <div class="modal encounter-modal">
          <div class="encounter-header">
            <span style="font-size:32px;">${enc.icon}</span>
            <div>
              <h2 class="encounter-title">${contentLabel(enc,"title")}</h2>
              <span class="badge" style="color:var(--red);">${label("ui.road-encounter.roadside_ambush")}</span>
            </div>
          </div>
          <p class="encounter-blurb">${contentLabel(enc,"desc")}</p>
          <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--red); padding:8px 12px; margin-bottom:14px; font-style:italic;" class="small">
            ${contentLabel(enc,"blurb")}
          </div>
          ${!resolved ? `
            <div class="encounter-options">
              <button class="encounter-option-btn" id="optFight">
                <b>${label("ui.road-encounter.skirmish_attack_check_dc_11")}</b>
                <span class="small muted">${label("ui.road.fightHelp")}${fightMod != null ? label("ui.road.modifier", { modifier: fmtMod(fightMod) }) : ""}</span>
              </button>
              <button class="encounter-option-btn" id="optBribe" ${(char.gold || 0) >= 10 ? '' : 'disabled'}>
                <b>${label("ui.road-encounter.bribe_passage_10_gp")}</b>
                <span class="small muted">${label("ui.road-encounter.toss_a_coin_purse_into_the_values", {p4: char.gold || 0})}</span>
              </button>
              <button class="encounter-option-btn" id="optSneak">
                <b>${label("ui.road-encounter.slip_past_stealth_dc_12")}</b>
                <span class="small muted">${label("ui.road.sneakHelp")}${sneakMod != null ? label("ui.road.modifier", { modifier: fmtMod(sneakMod) }) : ""}</span>
              </button>
            </div>
          ` : ''}
          ${resHtml ? `<div class="encounter-res-box">${resHtml}</div>` : ''}
          ${resolved ? `
            <div style="margin-top:16px; text-align:right;">
              <button class="btn primary big" id="continueDelveBtn">${label("ui.road-encounter.proceed_to_delve")}</button>
            </div>
          ` : ''}
        </div>
      `;

      if (!resolved) {
        const choose = (choice) => async () => {
          /** @type {HTMLButtonElement} */ (document.getElementById(choice === 'fight' ? 'optFight' : choice === 'bribe' ? 'optBribe' : 'optSneak')).disabled = true;
          try {
            const res = await api.resolveRoadEncounter(char.id, choice, enc.instanceId);
            if (!alive()) return;
            resolved = true;
            if (res.natural != null) {
              await rollAnimated(20, choice === 'sneak' ? t("ui.road-encounter.stealth_check") : t("ui.road-encounter.ambush_skirmish"), res.natural);
            }
            char.gold = res.gold != null ? res.gold : char.gold;
            char.hp = res.hp != null ? res.hp : char.hp;
            char.xp = res.xp != null ? res.xp : char.xp;
            render(resultLabel(res));
          } catch (e) {
            // failed resolve: re-render with the options live again for an explicit retry
            if (!alive()) return;
            toast(() => e.message);
            render(`<b style="color:var(--red)">${esc(e.message)}</b>`);
          }
          wireContinue();
        };
        document.getElementById('optFight').addEventListener('click', choose('fight'));
        document.getElementById('optBribe').addEventListener('click', choose('bribe'));
        document.getElementById('optSneak').addEventListener('click', choose('sneak'));
      }

      function wireContinue() {
        const cBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('continueDelveBtn'));
        if (cBtn) cBtn.addEventListener('click', async () => {
          if (cBtn.disabled) return;
          cBtn.disabled = true;
          const ok = await embarkCallback();
          if (ok === false) { cBtn.disabled = false; return; } // start failed — retry here
          modal.remove();
        });
      }
      if (resolved) wireContinue();

    } else if (enc.id === 'shrine') {
      modal.innerHTML = `
        <div class="modal encounter-modal">
          <div class="encounter-header">
            <span style="font-size:32px;">${enc.icon}</span>
            <div>
              <h2 class="encounter-title">${contentLabel(enc,"title")}</h2>
              <span class="badge" style="color:var(--blue);">${label("ui.road-encounter.wayside_sanctuary")}</span>
            </div>
          </div>
          <p class="encounter-blurb">${contentLabel(enc,"desc")}</p>
          <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--blue); padding:8px 12px; margin-bottom:14px; font-style:italic;" class="small">
            ${contentLabel(enc,"blurb")}
          </div>
          ${!resolved ? `
            <div class="encounter-options">
              <button class="encounter-option-btn" id="optPray">
                <b>${label("ui.road-encounter.kneel_and_pray_for_guidance")}</b>
                <span class="small muted">${label("ui.road-encounter.receive_the_dawnmother_s_vigor_5_temporary")}</span>
              </button>
              <button class="encounter-option-btn" id="optOffer" ${(char.gold || 0) >= 5 ? '' : 'disabled'}>
                <b>${label("ui.road-encounter.leave_a_5_gp_offering")}</b>
                <span class="small muted">${label("ui.road-encounter.drop_coins_into_the_consecrated_font_values", {p4: char.gold || 0})}</span>
              </button>
              <button class="encounter-option-btn" id="optProceed">
                <b>${label("ui.road-encounter.pay_respects_proceed")}</b>
                <span class="small muted">${label("ui.road-encounter.bow_quietly_and_continue_along_the_highway")}</span>
              </button>
            </div>
          ` : ''}
          ${resHtml ? `<div class="encounter-res-box">${resHtml}</div>` : ''}
          ${resolved ? `
            <div style="margin-top:16px; text-align:right;">
              <button class="btn primary big" id="continueDelveBtn">${label("ui.road-encounter.enter_delve")}</button>
            </div>
          ` : ''}
        </div>
      `;

      if (!resolved) {
        const choose = (choice, apply) => async () => {
          /** @type {HTMLButtonElement} */ (document.getElementById(choice === 'pray' ? 'optPray' : choice === 'offer' ? 'optOffer' : 'optProceed')).disabled = true;
          try {
            const res = await api.resolveRoadEncounter(char.id, choice, enc.instanceId);
            if (!alive()) return;
            resolved = true;
            if (apply) apply(res);
            render(resultLabel(res));
          } catch (e) {
            if (!alive()) return;
            toast(() => e.message);
            render(`<b style="color:var(--red)">${esc(e.message)}</b>`);
          }
          wireContinue();
        };
        document.getElementById('optPray').addEventListener('click', choose('pray', (res) => {
          char.tempHp = res.tempHp != null ? res.tempHp : (char.tempHp || 0) + 5;
        }));
        document.getElementById('optOffer').addEventListener('click', choose('offer', (res) => {
          char.gold = res.gold != null ? res.gold : char.gold;
          char.blessed = true;
        }));
        document.getElementById('optProceed').addEventListener('click', choose('proceed', null));
      }

      function wireContinue() {
        const cBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('continueDelveBtn'));
        if (cBtn) cBtn.addEventListener('click', async () => {
          if (cBtn.disabled) return;
          cBtn.disabled = true;
          const ok = await embarkCallback();
          if (ok === false) { cBtn.disabled = false; return; }
          modal.remove();
        });
      }
      if (resolved) wireContinue();
    }
  };

  render(initialResult);
}
