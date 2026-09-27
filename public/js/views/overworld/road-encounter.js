// road-encounter.js — the random roadside encounter modal (wandering peddler,
// goblin ambush, wayside shrine) rolled at a 35% chance when embarking from the
// region map, extracted verbatim from overworld.js.
//
// Self-contained: it only touches its parameters plus shared helpers, so it is
// exported directly instead of through a ctx factory. It mutates the passed-in
// character object in place (gold / hp / xp / tempHp / blessed / inventory);
// overworld.js hands it the live activeChar.

import { api } from '../../api.js';
import { esc, toast } from '../../app.js';
import { rollAnimated } from '../../dice.js';

export function showRoadEncounterModal(char, mapId, embarkCallback) {
  let modal = document.getElementById('roadEncounterModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-back';
    modal.id = 'roadEncounterModal';
    document.body.appendChild(modal);
  }

  const encounters = [
    {
      id: 'peddler',
      icon: '🧳',
      title: 'Garrick the Wandering Peddler',
      blurb: '"Ho there, brave traveler! Before you delve into the damp tombs, consider a draught or charm from my pack. Genuine goods, modest coin!"',
      desc: 'A jovial halfling merchant with an overloaded pack mule stands by the sun-dappled roadside.',
      wares: [
        { id: 'potion_healing', name: 'Potion of Healing', price: 20, desc: 'Heals 2d4+2 hit points' },
        { id: 'potion_greater', name: 'Potion of Greater Healing', price: 45, desc: 'Heals 4d4+4 hit points' },
        { id: 'cloak_protection', name: 'Cloak of Protection', price: 65, desc: '+1 bonus to Armor Class' }
      ]
    },
    {
      id: 'ambush',
      icon: '🏹',
      title: 'Roadside Goblin Ambush',
      blurb: '"Drop the coin purse, tall-legs, or we skewer your knees!"',
      desc: 'Three snarling goblin brigands leap from the roadside brush, notched shortbows aimed right at your chest.',
      options: ['fight', 'bribe', 'sneak']
    },
    {
      id: 'shrine',
      icon: '⛩️',
      title: 'Shrine of the Dawnmother',
      blurb: '"May the golden rays illuminate your descent into the shadowed depths."',
      desc: 'An ancient carved marble waypoint at the crossroads bathed in radiant dawnlight. Soft hymns seem to whisper in the gentle breeze.',
      options: ['pray', 'offer', 'proceed']
    }
  ];

  const enc = encounters[Math.floor(Math.random() * encounters.length)];
  let resolved = false;

  const render = (resHtml = '') => {
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
            char.gold -= price;
            char.inventory = char.inventory || [];
            const ex = char.inventory.find(i => i.itemId === itemId);
            if (ex) ex.qty++; else char.inventory.push({ itemId, qty: 1 });
            toast(`Purchased ${itemId} for ${price} GP from Garrick!`);
            render(`<span style="color:var(--green)">✓ Bought ${itemId}! Added to your inventory.</span>`);
          } catch (e) {
            toast(e.message);
          }
        });
      });

      const continueBtn = document.getElementById('continueDelveBtn');
      if (continueBtn) continueBtn.addEventListener('click', () => {
        modal.remove();
        embarkCallback();
      });

    } else if (enc.id === 'ambush') {
      const dexMod = Math.floor(((char.abilities?.dex || 10) - 10) / 2);
      const strMod = Math.floor(((char.abilities?.str || 10) - 10) / 2);
      const profBonus = Math.floor(((char.level || 1) - 1) / 4) + 2;
      const stealthProf = (char.skills || []).includes('stealth');
      const stealthMod = dexMod + (stealthProf ? profBonus : 0);
      const fightMod = Math.max(strMod, dexMod) + profBonus;

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
                <span class="small muted">Draw your weapon and charge. Modifier: <b>${fightMod >= 0 ? '+'+fightMod : fightMod}</b>. Victory yields coins (+25 GP, +50 XP); defeat incurs an arrow wound.</span>
              </button>
              <button class="encounter-option-btn" id="optBribe" ${(char.gold || 0) >= 10 ? '' : 'disabled'}>
                <b>💰 Bribe Passage (10 GP)</b>
                <span class="small muted">Toss a coin purse into the weeds to distract them and slip past safely. (Your gold: ${char.gold || 0} GP)</span>
              </button>
              <button class="encounter-option-btn" id="optSneak">
                <b>🏃 Slip Past (Stealth DC 12)</b>
                <span class="small muted">Duck into the dense thicket. Modifier: <b>${stealthMod >= 0 ? '+'+stealthMod : stealthMod}</b>. Fail means fleeing under fire (-2 HP).</span>
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
        document.getElementById('optFight').addEventListener('click', async () => {
          resolved = true;
          const roll = await rollAnimated(20, 'Ambush Skirmish');
          const total = roll + fightMod;
          if (total >= 11) {
            char.gold = (char.gold || 0) + 25;
            char.xp = (char.xp || 0) + 50;
            render(`<b style="color:var(--green)">Victory! (Roll ${roll}+${fightMod} = ${total} vs DC 11)</b><br>You strike down their leader and send the survivors running into the dark trees. You loot <b>+25 GP</b> from their pouches and earn <b>+50 XP</b>!`);
          } else {
            char.hp = Math.max(1, (char.hp || char.hpMax) - 3);
            render(`<b style="color:var(--red)">Staggered! (Roll ${roll}+${fightMod} = ${total} vs DC 11)</b><br>The goblins shoot a volley as they scatter! You take a stinging arrow graze (<b>-3 HP</b>, current HP: ${char.hp}/${char.hpMax}) before driving them off.`);
          }
          wireContinue();
        });

        document.getElementById('optBribe').addEventListener('click', () => {
          if ((char.gold || 0) < 10) return;
          resolved = true;
          char.gold -= 10;
          render(`<b style="color:var(--gold)">Coins Scattered! (-10 GP)</b><br>The goblins eagerly scramble in the mud for the glittering coins, squabbling amongst themselves as you slip safely past.`);
          wireContinue();
        });

        document.getElementById('optSneak').addEventListener('click', async () => {
          resolved = true;
          const roll = await rollAnimated(20, 'Stealth Check');
          const total = roll + stealthMod;
          if (total >= 12) {
            render(`<b style="color:var(--green)">Unseen! (Roll ${roll}+${stealthMod} = ${total} vs DC 12)</b><br>You slide through the tall ferns like a phantom. The goblins stare down an empty road while you slip quietly into the dungeon entrance!`);
          } else {
            char.hp = Math.max(1, (char.hp || char.hpMax) - 2);
            render(`<b style="color:var(--red)">Spotted! (Roll ${roll}+${stealthMod} = ${total} vs DC 12)</b><br>A twig snaps loudly! A goblin shouts and looses an arrow that clips your shoulder (<b>-2 HP</b>, current HP: ${char.hp}/${char.hpMax}) as you dash for cover.`);
          }
          wireContinue();
        });
      }

      function wireContinue() {
        const cBtn = document.getElementById('continueDelveBtn');
        if (cBtn) {
          cBtn.addEventListener('click', () => {
            modal.remove();
            embarkCallback();
          });
        }
      }

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
        document.getElementById('optPray').addEventListener('click', () => {
          resolved = true;
          char.tempHp = (char.tempHp || 0) + 5;
          render(`<b style="color:var(--blue)">Dawnmother's Vitality!</b><br>A soothing solar warmth fills your chest. You feel invigorated and ready for battle. (<b>+5 Temp HP</b> added!)`);
          wireContinue();
        });

        document.getElementById('optOffer').addEventListener('click', () => {
          if ((char.gold || 0) < 5) return;
          resolved = true;
          char.gold -= 5;
          char.blessed = true;
          render(`<b style="color:var(--gold)">Divine Blessing Bestowed! (-5 GP)</b><br>The silver and gold coins gleam in the sacred bowl. A radiant aura settles upon your brow (<b>Heroic Inspiration</b> granted for the delve ahead!).`);
          wireContinue();
        });

        document.getElementById('optProceed').addEventListener('click', () => {
          resolved = true;
          render(`<b style="color:var(--muted)">Steady March.</b><br>You salute the sun crest and march purposefully toward the waiting dungeon.`);
          wireContinue();
        });
      }

      function wireContinue() {
        const cBtn = document.getElementById('continueDelveBtn');
        if (cBtn) {
          cBtn.addEventListener('click', () => {
            modal.remove();
            embarkCallback();
          });
        }
      }
    }
  };

  render();
}
