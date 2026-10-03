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
    toast('路遇数据缺失，请重试。');
    return;
  }

  // one modal at a time: replace any previous instance (same live encounter either way)
  document.querySelectorAll('#roadEncounterModal').forEach(m => m.remove());
  const modal = document.createElement('div');
  modal.className = 'modal-back';
  modal.id = 'roadEncounterModal';
  document.body.appendChild(modal);

  let resolved = !!enc.resolved;
  const initialResult = resolved && enc.result && enc.result.text ? enc.result.text.replace(/\n/g, '<br>') : '';

  const render = (resHtml = '') => {
    if (!alive() || !modal.isConnected) return;
    if (enc.id === 'peddler') {
      modal.innerHTML = `
        <div class="modal encounter-modal">
          <div class="encounter-header">
            <span style="font-size:32px;">${enc.icon}</span>
            <div>
              <h2 class="encounter-title">${esc(enc.title)}</h2>
              <span class="badge" style="color:var(--gold);">Roadside Encounter</span>
            </div>
          </div>
          <p class="encounter-blurb">${esc(enc.desc)}</p>
          <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--gold); padding:8px 12px; margin-bottom:14px; font-style:italic;" class="small">
            ${esc(enc.blurb)}
          </div>
          <p class="small">Your purse: <b style="color:var(--gold);">${char.gold || 0} GP</b></p>
          <div style="display:flex; flex-direction:column; gap:8px; margin:12px 0;">
            ${enc.wares.map(w => `
              <div class="stat-line" style="background:var(--bg-box); padding:8px 12px; border-radius:6px; border:1px solid var(--border);">
                <div>
                  <b>${esc(w.name)}</b> <span class="muted small">— ${esc(w.desc)}</span>
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
            <button class="btn primary big" id="continueDelveBtn">🚶 Bid Farewell & Enter Delve</button>
          </div>
        </div>
      `;

      (/** @type {NodeListOf<HTMLButtonElement>} */ (modal.querySelectorAll('[data-buy-item]'))).forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.getAttribute('data-buy-item');
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
            toast(`Purchased ${itemId} for ${price} GP from Garrick!`);
            render(`<span style="color:var(--green)">✓ Bought ${itemId}! Added to your inventory.</span>`);
          } catch (e) {
            if (!alive()) return;
            toast(e.message);
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
              toast(e.message);
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
              <h2 class="encounter-title">${esc(enc.title)}</h2>
              <span class="badge" style="color:var(--red);">Roadside Ambush!</span>
            </div>
          </div>
          <p class="encounter-blurb">${esc(enc.desc)}</p>
          <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--red); padding:8px 12px; margin-bottom:14px; font-style:italic;" class="small">
            ${esc(enc.blurb)}
          </div>
          ${!resolved ? `
            <div class="encounter-options">
              <button class="encounter-option-btn" id="optFight">
                <b>⚔️ Skirmish! (Attack Check DC 11)</b>
                <span class="small muted">Draw your weapon and charge.${fightMod != null ? ` Modifier: <b>${fmtMod(fightMod)}</b>.` : ''} Victory yields coins (+25 GP, +50 XP); defeat incurs an arrow wound.</span>
              </button>
              <button class="encounter-option-btn" id="optBribe" ${(char.gold || 0) >= 10 ? '' : 'disabled'}>
                <b>💰 Bribe Passage (10 GP)</b>
                <span class="small muted">Toss a coin purse into the weeds to distract them and slip past safely. (Your gold: ${char.gold || 0} GP)</span>
              </button>
              <button class="encounter-option-btn" id="optSneak">
                <b>🏃 Slip Past (Stealth DC 12)</b>
                <span class="small muted">Duck into the dense thicket.${sneakMod != null ? ` Modifier: <b>${fmtMod(sneakMod)}</b>.` : ''} Fail means fleeing under fire (-2 HP).</span>
              </button>
            </div>
          ` : ''}
          ${resHtml ? `<div class="encounter-res-box">${resHtml}</div>` : ''}
          ${resolved ? `
            <div style="margin-top:16px; text-align:right;">
              <button class="btn primary big" id="continueDelveBtn">⚔️ Proceed to Delve</button>
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
              await rollAnimated(20, choice === 'sneak' ? 'Stealth Check' : 'Ambush Skirmish', res.natural);
            }
            char.gold = res.gold != null ? res.gold : char.gold;
            char.hp = res.hp != null ? res.hp : char.hp;
            char.xp = res.xp != null ? res.xp : char.xp;
            render(res.text.replace(/\n/g, '<br>'));
          } catch (e) {
            // failed resolve: re-render with the options live again for an explicit retry
            if (!alive()) return;
            toast(e.message);
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
              <h2 class="encounter-title">${esc(enc.title)}</h2>
              <span class="badge" style="color:var(--blue);">Wayside Sanctuary</span>
            </div>
          </div>
          <p class="encounter-blurb">${esc(enc.desc)}</p>
          <div style="background:rgba(0,0,0,0.3); border-left:3px solid var(--blue); padding:8px 12px; margin-bottom:14px; font-style:italic;" class="small">
            ${esc(enc.blurb)}
          </div>
          ${!resolved ? `
            <div class="encounter-options">
              <button class="encounter-option-btn" id="optPray">
                <b>🙏 Kneel and Pray for Guidance</b>
                <span class="small muted">Receive the Dawnmother's vigor (+5 Temporary HP for the delve).</span>
              </button>
              <button class="encounter-option-btn" id="optOffer" ${(char.gold || 0) >= 5 ? '' : 'disabled'}>
                <b>🪙 Leave a 5 GP Offering</b>
                <span class="small muted">Drop coins into the consecrated font. Receive Heroic Inspiration (+2 to saves). (Your gold: ${char.gold || 0} GP)</span>
              </button>
              <button class="encounter-option-btn" id="optProceed">
                <b>🚶 Pay Respects & Proceed</b>
                <span class="small muted">Bow quietly and continue along the highway without lingering.</span>
              </button>
            </div>
          ` : ''}
          ${resHtml ? `<div class="encounter-res-box">${resHtml}</div>` : ''}
          ${resolved ? `
            <div style="margin-top:16px; text-align:right;">
              <button class="btn primary big" id="continueDelveBtn">⚔️ Enter Delve</button>
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
            render(res.text.replace(/\n/g, '<br>'));
          } catch (e) {
            if (!alive()) return;
            toast(e.message);
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
