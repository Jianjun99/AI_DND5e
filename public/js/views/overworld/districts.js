import { contentLabel, contentText,  t, label, localizeText, displayText, displayLabel } from "../../i18n.js";
// districts.js — the Oakhaven town-district subsystem, extracted from overworld.js:
// the tavern (rests, rumors, mercenary companions), the Lantern Tables gamble
// mini-game, the armory & forge, the apothecary, the guildhall and the hall of
// heroes, plus all of their event wiring (attachDistrictSpecificEvents).
//
// The shared live state stays owned by overworld.js and is reached through the
// ctx accessors below: activeChar (read + write-back), cityData, the hallFilter
// object (overworld.js header events mutate it in place), the currently selected
// district, and the render / loadCityInfo / rerenderPanel trio. The gamble-table
// state and the hall of heroes cache are only ever touched by this subsystem, so
// they moved in here as factory-local state.

import { api } from '../../api.js';
import { esc, toast } from '../../app.js';
import { rollAnimated, showDice } from '../../dice.js';
import { sfx } from '../../sfx.js';

/**
 * @typedef {Object} DistrictsCtx
 * @property {() => any} getActiveChar live active-character getter (re-read it
 *   after every await — overworld.js may swap or refresh the character)
 * @property {(char: any) => void} setActiveChar write the character back after a
 *   server mutation (rest / forge / buy / sell / bounty / gamble / identify)
 * @property {() => any} getCityData live city-hub data getter (replaced on every
 *   loadCityInfo call — never cache it across awaits)
 * @property {() => any} getHallFilter the shared hallFilter object; overworld.js
 *   header events write its fields in place, so hold this one reference
 * @property {() => string} getCurrentDistrict currently selected district id
 * @property {() => Promise<void>} loadCityInfo re-fetch city info (also refreshes
 *   activeChar when the server returns the character)
 * @property {(main: HTMLElement, chars: any[]) => void} render full overworld-view re-render
 * @property {(main: HTMLElement) => void} rerenderPanel redraw just the district panel
 * @property {(compVal: any) => string} getCompanionName resolve a companion id to
 *   its display name
 */

/** @param {DistrictsCtx} ctx */
export function createDistricts(ctx) {
  // Hall of Heroes cache — only this subsystem ever reads or writes it, so it
  // moved here from overworld.js.
  let hallData = null;
  // Shared bestiary filter object owned by overworld.js; its header events
  // mutate the fields in place, so keep referencing this one object.
  const hallFilter = ctx.getHallFilter();

  // 1. TAVERN DISTRICT
  function renderTavern() {
    // renderers are synchronous — one live read of the shared state at the top is enough
    const activeChar = ctx.getActiveChar();
    const cityData = ctx.getCityData();
    const companions = cityData?.companions || [];
    const rumors = cityData?.rumors || [];

    return `
      <div class="district-header">
        <h2>${label("ui.districts.the_boar_lantern_tavern")}</h2>
        <p class="sub">${label("ui.districts.hearth_smoke_curls_toward_timber_rafters_as")}</p>
      </div>

      <div class="grid cols2" style="margin-bottom:20px;">
        <!-- Rest Facilities -->
        <div class="card" style="background:var(--bg2);">
          <h3>${label("ui.districts.rest_lodging")}</h3>
          <p class="muted small" style="margin-bottom:12px;">${label("ui.districts.spend_gold_to_recover_your_health_and")}</p>
          
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:10px 14px; border-radius:6px; border:1px solid var(--border);">
              <div>
                <b>${label("ui.districts.short_rest_warm_stew")}</b>
                <div class="muted small">${label("ui.districts.spend_hit_dice_to_bandage_wounds_and")}</div>
              </div>
              <button class="btn" id="btnRestShort">5 GP</button>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:10px 14px; border-radius:6px; border:1px solid var(--border);">
              <div>
                <b class="gold-text">${label("ui.districts.long_rest_private_room")}</b>
                <div class="muted small">${label("ui.districts.hot_bath_hearty_venison_feast_and_deep")}</div>
              </div>
              <button class="btn primary" id="btnRestLong">20 GP</button>
            </div>
          </div>
        </div>

        <!-- Tavern Gossip & Rumors -->
        <div class="card" style="background:var(--bg2);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h3>${label("ui.districts.hearth_rumors")}</h3>
            <button class="btn small" id="btnNewRumor">${label("ui.districts.ask_tavern_keeper")}</button>
          </div>
          <div id="rumorBox" style="font-style:italic; color:var(--parchment); background:var(--panel); padding:14px; border-radius:6px; border-left:3px solid var(--gold); min-height:80px; display:flex; align-items:center;">
            "${displayLabel(cityData.rumorsDisplay?.[0],rumors[0] || '')}"
          </div>
        </div>
      </div>

      <!-- Mercenary Companions Roster -->
      <div class="card" style="background:var(--bg2);">
        <h3>${label("ui.districts.mercenary_companion_roster")}</h3>
        <p class="muted small" style="margin-bottom:14px;">${label("ui.districts.recruit_an_ally_to_accompany_you_on")}</p>

        <div class="grid cols3">
          ${companions.map(c => {
            const isActive = activeChar.companion === c.id;
            return `
              <div class="card companion-card ${isActive ? 'selected' : ''}" style="background:var(--panel);">
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                  <span style="font-size:32px;">${c.icon}</span>
                  <div>
                    <h4 style="margin:0; font-size:16px; color:var(--parchment);">${contentLabel(c,"name")}</h4>
                    <span class="chip blue" style="font-size:11px; padding:1px 6px;">${contentLabel(c,"role")}</span>
                  </div>
                </div>

                <div class="stat-line"><span>${label("ui.districts.armor_class")}</span><span>${c.ac}</span></div>
                <div class="stat-line"><span>${label("ui.districts.hit_points")}</span><span>${c.hp}</span></div>
                <div class="stat-line"><span>${label("ui.districts.speed")}</span><span>${c.speed} ft</span></div>
                <div class="stat-line"><span>${label("ui.districts.combat_style")}</span><span>${(c.attacksDisplay || c.attacks || []).map(a=>displayLabel(a)).join(', ') || label("ui.districts.melee")}</span></div>
                <p class="muted small" style="margin:8px 0 12px; min-height:36px;">${contentLabel(c,"blurb")}</p>

                <button class="btn ${isActive ? 'primary' : ''} companion-btn" data-comp-id="${c.id}" style="width:100%;">
                  ${isActive ? label("ui.districts.active_companion") : label("ui.districts.recruit_companion")}
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      ${renderGambleTable()}
    `;
  }

  // 1b. GAMBLING TABLE — the real odds, an opt-in curse tier, and delve-only prize tokens
  let gambleGame = 'roulette';
  let gambleSlotsTier = 'standard';
  let gambleRouletteBet = 'red';
  let gambleSicBoBet = 'small';
  let gambleResult = null;   // last spin, kept across re-renders

  function renderGambleTable() {
    const activeChar = ctx.getActiveChar();
    const cityData = ctx.getCityData();
    const tables = cityData?.tables || {};
    const gold = activeChar.gold || 0;
    const pending = activeChar.pendingDelveItems || [];
    const curses = activeChar.pendingCurses || [];
    const tokenDefs = tables.tokens || [];

    const stakeChips = [5, 10, 25, 50, 100].map(v =>
      `<button class="btn small gamble-stake-btn" data-stake="${v}" ${gold < v ? 'disabled' : ''}>${v}</button>`).join('');

    const rouletteBets = (tables.roulette?.bets || []).map(b => `
      <label class="gamble-bet-option">
        <input type="radio" name="rouletteBet" value="${b.id}" ${gambleRouletteBet === b.id ? 'checked' : ''}>
        <span>${displayLabel(b.nameDisplay, b.name)} <span class="muted small">${displayLabel(b.blurbDisplay, b.blurb)}</span></span>
      </label>`).join('');

    const sicboBets = (tables.sicbo?.bets || []).map(b => `
      <label class="gamble-bet-option">
        <input type="radio" name="sicboBet" value="${b.id}" ${gambleSicBoBet === b.id ? 'checked' : ''}>
        <span>${displayLabel(b.nameDisplay, b.name)} <span class="muted small">${displayLabel(b.blurbDisplay, b.blurb)}</span></span>
      </label>`).join('');

    const slotTiers = (tables.slots?.tiers || []).map(entryText => `
      <button class="btn small slots-tier-btn ${gambleSlotsTier === entryText.id ? 'primary' : ''}" data-tier="${entryText.id}"
              ${gold < entryText.stake ? 'disabled' : ''} data-i18n-title="${entryText.blurbDisplay?.key || ""}" title="${esc(displayText(entryText.blurbDisplay, entryText.blurb))}">${displayLabel(entryText.nameDisplay, entryText.name)} · ${entryText.stake} gp</button>`).join('');

    const reelRow = (tables.slots?.symbols || []).map(s => `<span class="slot-symbol" title="${esc(contentText(s,"name"))}">${s.icon}</span>`).join('');

    return `
      <div class="card gamble-table" style="background:var(--bg2); border-color:var(--gold-dim); margin-top:16px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
          <h3 style="margin:0;">${label("ui.districts.the_lantern_tables")}</h3>
          <span class="muted small">${label("ui.districts.the_house_edge_is_visible_you_lose")}</span>
        </div>

        <div class="gamble-tabs" style="margin:10px 0;">
          <button class="btn small ${gambleGame === 'roulette' ? 'primary' : ''}" data-gamble-tab="roulette">${label("ui.districts.roulette")}</button>
          <button class="btn small ${gambleGame === 'sicbo' ? 'primary' : ''}" data-gamble-tab="sicbo">${label("ui.districts.sic_bo")}</button>
          <button class="btn small ${gambleGame === 'slots' ? 'primary' : ''}" data-gamble-tab="slots">${label("ui.districts.slots")}</button>
        </div>

        <div class="gamble-panel">
          ${gambleGame === 'roulette' ? `
            <p class="muted small">${label("ui.districts.single_zero_roulette_red_black_and_dozen")} <b>${((tables.roulette?.rtp || 0.973) * 100).toFixed(1)}%</b>。</p>
            <div class="gamble-bets">${rouletteBets}</div>
            <label class="small" style="display:flex; align-items:center; gap:6px; margin:8px 0;">
              ${label("ui.districts.straight_number_0_36")}<input id="rouletteNumber" type="number" min="0" max="36" value="17"
                style="width:70px; background:var(--bg); color:var(--parchment); border:1px solid var(--border); border-radius:4px; padding:3px 6px;">
            </label>
          ` : ''}

          ${gambleGame === 'sicbo' ? `
            <p class="muted small">${label("ui.districts.three_dice_big_small_pay_1_1")}</p>
            <div class="gamble-bets">${sicboBets}</div>
          ` : ''}

          ${gambleGame === 'slots' ? `
            <p class="muted small">${label("ui.districts.slotHelp")}${gambleSlotsTier === 'devil'
              ? `<b style="color:#f87171;">${label("ui.districts.devil_pact_three_curse_your_next_delve")}</b>`
              : label("ui.districts.standard_three_give_no_reward")}</p>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">${slotTiers}</div>
            <div class="slot-reels">${reelRow}</div>
          ` : ''}

          ${gambleGame === 'slots' ? '' : `
            <div style="margin:10px 0;">
              <div class="muted small" style="margin-bottom:4px;">${label("ui.districts.stake")}</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">${stakeChips}</div>
            </div>`}
        </div>

        <div id="gambleResult" class="gamble-result ${gambleResult ? '' : 'muted'} small">${gambleResult
          ? `${contentLabel(gambleResult,"text")} <span style="color:${gambleResult.net >= 0 ? 'var(--gold)' : '#f87171'};">${label("ui.districts.this_bet_gp_values", {p2: gambleResult.net >= 0 ? '+' : '', p3: gambleResult.net})}</span>`
          : label("ui.districts.choose_a_stake_then_place_your_bet")}</div>

        <div style="display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;">
          <button class="btn primary" id="gambleRollBtn" ${gold < 5 ? 'disabled' : ''}>${label("ui.districts.place_bet")}</button>
          <span class="muted small">💰 ${gold} gp</span>
        </div>

        ${pending.length ? `
          <div class="card" style="margin-top:12px; background:var(--bg); border-color:var(--gold-dim);">
            <h4 style="margin:0 0 6px;">${label("ui.districts.ready_for_the_next_delve_expires_on")}</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${pending.map(p => `<span class="chip gold-chip" title="${esc(p.desc || '')}">${contentLabel(p,"name")}</span>`).join('')}
            </div>
          </div>` : ''}

        ${curses.length ? `
          <div class="card" style="margin-top:12px; background:var(--bg); border-color:#6b3a35;">
            <h4 style="margin:0 0 6px; color:#d98a80;">${label("ui.districts.curses_for_the_next_delve")}</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${curses.map(id => `<span class="chip red">${esc(id === 'frailty' ? t("ui.districts.decay_curse_maximum_hp_5") : t("ui.districts.restless_curse_one_fewer_rest"))}</span>`).join('')}
            </div>
          </div>` : ''}

        <details style="margin-top:12px;">
          <summary class="muted small" style="cursor:pointer;">${label("ui.districts.delve_items_available_at_the_tables")}</summary>
          <div class="muted small" style="margin-top:6px; display:grid; gap:4px;">
            ${tokenDefs.map(entryText => `<div>${entryText.icon} <b>${contentLabel(entryText,"name")}</b> — ${contentLabel(entryText,"desc")}</div>`).join('')}
          </div>
        </details>
      </div>
    `;
  }

  // 2. ARMORY DISTRICT
  function renderArmory() {
    const activeChar = ctx.getActiveChar();
    const cityData = ctx.getCityData();
    const armoryItems = cityData?.shops?.armory || [];
    const charInventory = activeChar.inventory || [];
    const forgeCosts = cityData?.forge?.costs || {};
    const essence = activeChar.essence || 0;
    const equippedRefs = Object.values(activeChar.equipped || {});
    const forgeable = charInventory.filter(i => isForgeableItem(i));
    const worn = forgeable.filter(i => equippedRefs.includes(i.uniqueId));

    return `
      <div class="district-header">
        <h2>${label("ui.districts.ironforge_armory_smithy")}</h2>
        <p class="sub">${label("ui.districts.master_torvin_hammers_glowing_steel_atop_an")}</p>
      </div>

      <div class="shop-tabs" style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
        <button class="btn primary" id="armoryBuyTabBtn">${label("ui.districts.purchase_arms_armor")}</button>
        <button class="btn" id="armorySellTabBtn">${label("ui.districts.sell_loot_items_values", {p3: charInventory.length})}</button>
        <button class="btn" id="armoryForgeTabBtn">${label("ui.districts.forge_values", {p4: forgeable.length})}</button>
      </div>

      <!-- Buy Section -->
      <div id="armoryBuySection">
        <div class="shop-grid">
          ${armoryItems.map(item => `
            <div class="shop-item-card card" style="background:var(--bg2);">
              <div class="shop-item-header">
                <span class="shop-item-name"><b>${contentLabel(item,"name")}</b></span>
                <span class="chip ${item.type === 'shield' ? 'green' : (item.type === 'armor' ? 'blue' : 'gold')}">${esc(item.type)}</span>
              </div>
              <p class="muted small" style="margin:6px 0 10px; min-height:28px;">${contentLabel(item,"desc")}</p>
              <div class="shop-item-footer">
                <span class="gold-text"><b>${item.cost} GP</b></span>
                <button class="btn small primary buy-item-btn" data-item-id="${item.id}" data-item-cost="${item.cost}" ${activeChar.gold < item.cost ? 'disabled' : ''}>
                  ${label("ui.districts.buy")}
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Forge Section (hidden by default) -->
      <div id="armoryForgeSection" class="hidden">
        <div class="card" style="background:var(--bg2); border-color:var(--gold-dim);">
          <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
            <h3 style="margin:0;">${label("ui.districts.forge_anvil")}</h3>
            <span class="chip gold-chip" data-i18n-title="ui.districts.essence_comes_from_salvaging_magic_gear_and" title="${esc(t("ui.districts.essence_comes_from_salvaging_magic_gear_and"))}">${label("ui.districts.ember_essence_values", {p8: essence})}</span>
          </div>
          <p class="muted small" style="margin:6px 0 0;">
            ${label("ui.districts.salvage_unwanted_affix_gear_for_essence_spend")}<b>${label("ui.districts.reroll_affixes")}</b>${label("ui.districts.or")}<b>${label("ui.districts.upgrade_rarity")}</b>${label("ui.districts.unequip_gear_before_modifying_it")}
          </p>
        </div>

        ${!forgeable.length ? `
          <p class="muted" style="padding:20px; text-align:center;">${label("ui.districts.no_gear_to_modify_yet_defeat_elite")}</p>
        ` : `
          <div class="shop-grid" style="margin-top:12px;">
            ${forgeable.map(i => {
              const isWorn = equippedRefs.includes(i.uniqueId);
              const reroll = forgeCosts.reroll?.[i.rarity] || null;
              const upgrade = forgeCosts.upgrade?.[i.rarity] || null;
              const canAfford = (c) => c && (activeChar.gold || 0) >= c.gold && essence >= c.essence;
              const costText = (c) => c ? label("ui.districts.goldCost", { gold: c.gold, essence: c.essence }) : "—";
              return `
                <div class="shop-item-card card forge-card rarity-${i.rarity}" style="background:var(--bg2);">
                  <div class="shop-item-header">
                    <span class="shop-item-name"><b>${contentLabel(i,"name")}</b></span>
                    <span class="chip">${i.rarity === 'legendary' ? label("ui.districts.legendary") : i.rarity === 'rare' ? label("ui.districts.rare") : label("ui.districts.magic")}</span>
                  </div>
                  <p class="muted small" style="margin:6px 0 8px; min-height:28px;">${displayLabel(i.descDisplay,i.desc || '')}</p>
                  ${isWorn ? `<div class="muted small" style="margin-bottom:6px;">${label("ui.districts.equipped_unequip_before_modifying")}</div>` : ''}
                  <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="btn small forge-action-btn" data-forge-action="reroll" data-unique="${i.uniqueId}"
                            ${(!reroll || isWorn || !canAfford(reroll)) ? 'disabled' : ''}
                            data-i18n-title="ui.districts.reroll_an_affix_at_the_same_rarity" title="${esc(t("ui.districts.reroll_an_affix_at_the_same_rarity"))}">
                      ${label("ui.districts.reroll_affix_values", {p8: ''})}${costText(reroll)}
                    </button>
                    <button class="btn small forge-action-btn" data-forge-action="upgrade" data-unique="${i.uniqueId}"
                            ${(!upgrade || isWorn || !canAfford(upgrade)) ? 'disabled' : ''}
                            data-i18n-title="ui.districts.upgrade_rarity_enchantment_and_affix_effects_improve" title="${esc(t("ui.districts.upgrade_rarity_enchantment_and_affix_effects_improve"))}">
                      ${label("ui.districts.upgrade_values", {p12: ''})}${upgrade ? costText(upgrade) : label("ui.districts.already_legendary")}
                    </button>
                    <button class="btn small forge-action-btn" data-forge-action="salvage" data-unique="${i.uniqueId}"
                            ${isWorn ? 'disabled' : ''}
                            data-i18n-title="ui.districts.salvage_into_ember_essence_irreversible" title="${esc(t("ui.districts.salvage_into_ember_essence_irreversible"))}">
                      ${label("ui.districts.salvage_essence_values", {p16: (cityData?.forge?.salvage?.[i.rarity]) || 1})}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${worn.length ? `<p class="muted small" style="margin-top:10px;">${label("ui.districts.unequip_worn_items_before_modifying_on_values", {p0: worn.length})}</p>` : ''}
        `}
      </div>

      <!-- Sell Section (hidden by default) -->
      <div id="armorySellSection" class="hidden">
        ${!charInventory.length ? `<p class="muted" style="padding:20px; text-align:center;">${label("ui.districts.your_inventory_is_empty_complete_delves_to")}</p>` : `
          <div class="shop-grid">
            ${charInventory.map(i => {
              const sellValue = getSellPrice(i.itemId);
              return `
                <div class="shop-item-card card" style="background:var(--bg2);">
                  <div class="shop-item-header">
                    <span class="shop-item-name"><b>${esc(formatItemName(i.itemId))}</b></span>
                    <span class="chip">${label("ui.districts.qty_values", {p1: i.qty})}</span>
                  </div>
                  <div class="shop-item-footer" style="margin-top:12px;">
                    <span class="gold-text">${label("ui.districts.gp_unit_values", {p2: sellValue})}</span>
                    <button class="btn small sell-item-btn" data-item-id="${i.itemId}">
                      ${label("ui.districts.sell_1")}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;
  }

  // 3. APOTHECARY DISTRICT
  function renderApothecary() {
    const activeChar = ctx.getActiveChar();
    const cityData = ctx.getCityData();
    const apothecaryItems = (cityData?.shops?.apothecary || []).filter(i => i.type !== 'mystery');
    const brews = (cityData?.shops?.apothecary || []).filter(i => i.type === 'mystery');
    const bottles = (activeChar.inventory || []).filter(i => i.kind === 'mystery_potion');

    return `
      <div class="district-header">
        <h2>${label("ui.districts.willow_wick_apothecary")}</h2>
        <p class="sub">${label("ui.districts.fragrant_bundles_of_dried_lavender_and_rowan")}</p>
      </div>

      <div class="shop-grid">
        ${apothecaryItems.map(item => `
          <div class="shop-item-card card" style="background:var(--bg2);">
            <div class="shop-item-header">
              <span class="shop-item-name"><b>${contentLabel(item,"name")}</b></span>
              <span class="chip">${item.cost} GP</span>
            </div>
            <p class="muted small" style="margin:6px 0 10px; min-height:28px;">${contentLabel(item,"desc")}</p>
            <div class="shop-item-footer">
              <span class="gold-text"><b>${item.cost} GP</b></span>
              <button class="btn small primary buy-item-btn" data-item-id="${item.id}" data-item-cost="${item.cost}" ${activeChar.gold < item.cost ? 'disabled' : ''}>
                ${label("ui.districts.purchase")}
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card" style="margin-top:18px; background:var(--bg2); border-color:var(--gold-dim);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
          <h3 style="margin:0;">${label("ui.districts.under_the_counter_experimental_potions")}</h3>
          <span class="muted small">${label("ui.districts.the_effect_is_fixed_at_purchase_but")}</span>
        </div>

        <div class="shop-grid" style="margin-top:12px;">
          ${brews.map(item => `
            <div class="shop-item-card card" style="background:var(--bg);">
              <div class="shop-item-header">
                <span class="shop-item-name"><b>${contentLabel(item,"name")}</b></span>
                <span class="chip">${item.cost} GP</span>
              </div>
              <p class="muted small" style="margin:6px 0 10px; min-height:28px;">${contentLabel(item,"desc")}</p>
              <div class="shop-item-footer">
                <span class="gold-text"><b>${item.cost} GP</b></span>
                <button class="btn small primary buy-item-btn" data-item-id="${item.id}" data-item-cost="${item.cost}" ${activeChar.gold < item.cost ? 'disabled' : ''}>
                  ${label("ui.districts.buy_one")}
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        ${bottles.length ? `
          <div style="margin-top:14px;">
            <div class="muted small" style="margin-bottom:6px;">${label("ui.districts.your_bottles_values", {p0: bottles.length})}</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${bottles.map(b => `
                <div class="stat-line potion-row ${b.identified ? 'rarity-' + (b.effect.kind === 'good' ? 'magic' : b.effect.kind === 'bad' ? 'rare' : 'legendary') : 'potion-unknown'}"
                     style="padding:6px 8px; align-items:center;">
                  <div style="min-width:0; flex:1;">
                    <span class="item-affix-tag ${b.identified ? '' : 'rarity-common-tag'}">${b.identified
                      ? (b.effect.kind === 'good' ? label("ui.districts.beneficial") : b.effect.kind === 'bad' ? label("ui.districts.harmful") : label("ui.districts.mixed"))
                      : label("ui.districts.unidentified")}</span>
                    <b>${contentLabel(b,"name")}</b>
                    <span class="muted small" style="margin-left:6px;">${b.identified
                      ? contentLabel(b.effect)+' — '+contentLabel(b.effect,'desc')
                      : displayLabel(b.cluesDisplay,(b.clues || []).join(' · '))}</span>
                  </div>
                  <button class="btn small identify-potion-btn" data-unique="${b.uniqueId}" ${b.identifyFailed || b.identified ? 'disabled' : ''}>
                    ${b.identified ? label("ui.districts.identified") : b.identifyFailed ? label("ui.districts.identification_failed") : label("ui.districts.identify")}
                  </button>
                </div>
              `).join('')}
            </div>
          </div>` : ''}
      </div>
    `;
  }

  // 4. GUILDHALL DISTRICT
  function renderGuildhall() {
    const activeChar = ctx.getActiveChar();
    const cityData = ctx.getCityData();
    const bounties = cityData?.bounties || [];
    const claimed = activeChar.claimedBounties || [];

    return `
      <div class="district-header">
        <h2>${label("ui.districts.delvers_guildhall")}</h2>
        <p class="sub">${label("ui.districts.the_official_provincial_notice_board_of_oakhaven")}</p>
      </div>

      ${(cityData && cityData.weekly) ? `
        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">
          <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
            <h3 style="margin:0;">${label("ui.districts.weekly_trial_values", {p0: cityData.weekly.label})}</h3>
            <span class="chip blue">${label("ui.districts.depth_values", {p1: cityData.weekly.depth})}</span>
          </div>
          <p class="muted small" style="margin:8px 0;">${label("ui.districts.all_heroes_share_this_week_s_seed")}</p>
          ${(activeChar.weekly && activeChar.weekly.label === cityData.weekly.label) ? `<div class="small" style="color:var(--green); margin-bottom:8px;">${label("ui.districts.wins_this_week_best_kills_values", {p0: activeChar.weekly.wins, p1: activeChar.weekly.best ? activeChar.weekly.best.kills : '-'})}</div>` : ''}
          <button class="btn primary" id="weeklyEmbarkBtn" ${activeChar ? '' : 'disabled'}>${label("ui.districts.accept_weekly_trial")}</button>
        </div>` : ''}

      <div class="bounty-grid grid cols3">
        ${bounties.map(b => {
          const isClaimed = claimed.includes(b.id);
          return `
            <div class="card bounty-card ${isClaimed ? 'claimed' : ''}" style="background:var(--bg2); border:1px solid ${isClaimed ? 'var(--green)' : 'var(--border)'};">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:26px;">${b.icon}</span>
                <span class="chip ${isClaimed ? 'green' : 'blue'}">${esc(b.target)}</span>
              </div>

              <h3 style="margin:0 0 6px; color:var(--parchment);">${contentLabel(b,"title")}</h3>
              <p class="muted small" style="min-height:44px; margin-bottom:12px;">${contentLabel(b,"desc")}</p>

              <div style="background:var(--panel); padding:8px 10px; border-radius:6px; margin-bottom:12px;">
                <div class="stat-line"><span>${label("ui.districts.reward")}</span><span class="gold-text"><b>+${b.rewardGold} GP</b></span></div>
                <div class="stat-line"><span>${label("ui.districts.experience")}</span><span style="color:var(--gold);"><b>+${b.rewardXp} XP</b></span></div>
              </div>

              <button class="btn ${isClaimed ? '' : 'primary'} claim-bounty-btn" data-bounty-id="${b.id}" ${isClaimed ? 'disabled' : ''} style="width:100%;">
                ${isClaimed ? label("ui.districts.contract_claimed") : label("ui.districts.accept_claim_bounty")}
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  // 5. HALL OF HEROES & TROPHY ROOM
  function renderHallOfHeroes() {
    const activeChar = ctx.getActiveChar();
    if (!hallData) {
      api.hallOfHeroes(activeChar ? activeChar.id : null).then(d => {
        hallData = d;
        const panel = document.querySelector('.district-panel');
        if (panel && ctx.getCurrentDistrict() === 'hall_of_heroes') {
          panel.innerHTML = renderHallOfHeroes();
          attachDistrictSpecificEvents(document);
        }
      }).catch(err => console.error('Failed to load hall of heroes', err));

      return `
        <div class="district-header">
          <h2>${label("ui.districts.hall_of_heroes_trophy_room")}</h2>
          <p class="sub">${label("ui.districts.etched_in_white_marble_and_polished_brass")}</p>
        </div>
        <div style="text-align:center; padding:40px;"><div class="spinner"></div></div>
      `;
    }

    const { bestiary = [], trophies = [], champions = [], bestiaryProgress = null, campaign = null, endlessRunners = [], weeklyRunners = [], weeklyLabel = null } = hallData;
    const crFilter = hallFilter.cr || 'all';
    const sortBy = hallFilter.sort || 'cr';
    const shown = bestiary
      .filter(m => hallFilter.seen === 'all' || (hallFilter.seen === 'seen' ? m.unlocked : !m.unlocked))
      .filter(m => crFilter === 'all' || String(m.cr) === String(crFilter))
      .slice()
      .sort((a, b) => {
        if (sortBy === 'kills') return (b.kills || 0) - (a.kills || 0);
        if (sortBy === 'name') return String(a.name).localeCompare(String(b.name));
        return (parseFloat(String(b.cr)) || 0) - (parseFloat(String(a.cr)) || 0);
      });

    return `
      <div class="district-header">
        <h2>${label("ui.districts.hall_of_heroes_trophy_room")}</h2>
        <p class="sub">${label("ui.districts.etched_in_white_marble_and_polished_brass")}</p>
      </div>

      ${campaign ? `
        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">
          <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
            <h3 style="margin:0;">${label("ui.districts.story_progress_values", {p0: campaign.progress.label})}</h3>
            <a class="btn small" href="#/campaign/${activeChar.id}">${label("ui.districts.view_four_acts_ending")}</a>
          </div>
          <div class="campaign-track" style="margin-top:8px;">
            ${campaign.acts.map(a => `
              <span class="campaign-step ${a.done ? 'done' : ''}" title="${esc(contentText(a,"mapName"))}">
                ${a.icon} ${esc(a.name.replace(/^第.幕 · /, ''))}
              </span>`).join('<span class="campaign-arrow">→</span>')}
          </div>
        </div>` : ''}

      ${(weeklyRunners && weeklyRunners.length) ? `
        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">
          <h3 style="margin:0 0 6px;">${label("ui.districts.weekly_leaderboard_values", {p0: weeklyLabel})}</h3>
          ${weeklyRunners.map((r, i) => `
            <div class="stat-line">
              <span>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅'} ${contentLabel(r,"name")} <span class="muted small">Lv ${r.level} ${contentLabel(r,"className")}</span></span>
              <span style="color:var(--gold); font-weight:600;">${label("ui.districts.wins_best_kills_values", {p4: r.wins, p5: r.best ? r.best.kills : '-'})}</span>
            </div>`).join('')}
        </div>` : ''}

      ${(endlessRunners && endlessRunners.length) ? `
        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">
          <h3 style="margin:0 0 6px;">${label("ui.districts.endless_depths_leaderboard")}</h3>
          ${endlessRunners.map((r, i) => `
            <div class="stat-line">
              <span>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🕯️'} ${contentLabel(r,"name")} <span class="muted small">Lv ${r.level} ${contentLabel(r,"className")}</span></span>
              <span style="color:var(--gold); font-weight:600;">${label("ui.districts.depth_values_24", {p4: r.depth})}</span>
            </div>`).join('')}
        </div>` : ''}

      <div class="hall-container">
        <div class="hall-nav-tabs">
          <button class="hall-tab-btn active" data-hall-tab="bestiary">${label("ui.districts.monster_bestiary_values", {p5: bestiaryProgress ? bestiaryProgress.seen : bestiary.filter(m => m.unlocked).length, p6: bestiary.length})}</button>
          <button class="hall-tab-btn" data-hall-tab="trophies">${label("ui.districts.trophy_showcase_values", {p7: trophies.filter(entryText => entryText.unlocked).length, p8: trophies.length})}</button>
          <button class="hall-tab-btn" data-hall-tab="champions">${label("ui.districts.hall_of_champions_values", {p9: champions.length})}</button>
        </div>

        <!-- Bestiary Tab -->
        <div id="hallSecBestiary">
          ${bestiaryProgress ? `
            <div class="bestiary-toolbar">
              <span class="muted small">${label("ui.districts.recorded")} <b>${bestiaryProgress.seen}/${bestiaryProgress.total}</b> ${label("ui.districts.creatures_elite_variants")} <b>${bestiaryProgress.variantsSeen}/${bestiaryProgress.variantsTotal}</b></span>
              <div class="bestiary-filters">
                <select id="bestiarySeenFilter" class="small">
                  <option value="all" ${hallFilter.seen === 'all' ? 'selected' : ''} data-i18n="ui.districts.all">${esc(t("ui.districts.all"))}</option>
                  <option value="seen" ${hallFilter.seen === 'seen' ? 'selected' : ''} data-i18n="ui.districts.recorded">${esc(t("ui.districts.recorded"))}</option>
                  <option value="unseen" ${hallFilter.seen === 'unseen' ? 'selected' : ''} data-i18n="ui.districts.unrecorded">${esc(t("ui.districts.unrecorded"))}</option>
                </select>
                <select id="bestiaryCrFilter" class="small">
                  <option value="all" ${crFilter === 'all' ? 'selected' : ''} data-i18n="ui.districts.all_cr">${esc(t("ui.districts.all_cr"))}</option>
                  ${[...new Set(bestiary.map(m => String(m.cr)))].sort().map(cr => `<option value="${cr}" ${String(crFilter) === cr ? 'selected' : ''}>CR ${cr}</option>`).join('')}
                </select>
                <select id="bestiarySortFilter" class="small">
                  <option value="cr" ${sortBy === 'cr' ? 'selected' : ''} data-i18n="ui.districts.by_cr">${esc(t("ui.districts.by_cr"))}</option>
                  <option value="kills" ${sortBy === 'kills' ? 'selected' : ''} data-i18n="ui.districts.by_kills">${esc(t("ui.districts.by_kills"))}</option>
                  <option value="name" ${sortBy === 'name' ? 'selected' : ''} data-i18n="ui.districts.by_name">${esc(t("ui.districts.by_name"))}</option>
                </select>
              </div>
            </div>` : ''}
          <div class="bestiary-grid">
          ${shown.map(m => {
            const isUnlocked = m.unlocked || m.kills > 0 || m.globalKills > 0;
            const detailRows = [];
            if (m.traits?.length) detailRows.push([label("ui.districts.traits"), displayLabel(m.traitsDisplay,m.traits.join('、'))]);
            if (m.attacks?.length) detailRows.push([label("ui.districts.attacks"), esc(m.attacks.join(' / '))]);
            if (m.resistances?.length) detailRows.push([label("ui.districts.resistances"), esc(m.resistances.join('、'))]);
            if (m.vulnerabilities?.length) detailRows.push([label("ui.districts.vulnerabilities"), esc(m.vulnerabilities.join('、'))]);
            if (m.immunities?.length) detailRows.push([label("ui.districts.immunities"), esc(m.immunities.join('、'))]);
            if (m.boss) detailRows.push([label("ui.districts.identity"), label("ui.districts.boss_guaranteed_rare_or_legendary_gear")]);
            if (m.loot?.gold) detailRows.push([label("ui.districts.loot"), label('ui.districts.goldCount', { sign: '', gold: m.loot.gold }) + (m.loot.items ? ' ' + label('ui.districts.itemKinds', { count: m.loot.items }) : '')]);
            return `
              <div class="bestiary-card ${isUnlocked ? '' : 'locked'}">
                <div class="bestiary-card-header">
                  <div class="bestiary-title-group">
                    <span class="bestiary-icon">${isUnlocked ? (m.boss ? '👹' : '👾') : '❓'}</span>
                    <span class="bestiary-name">${isUnlocked ? esc(m.name) : label("ui.districts.unknown_beast")}</span>
                    ${m.boss ? `<span class="chip" style="font-size:10px;">${label("ui.districts.boss")}</span>` : ''}
                  </div>
                  <span class="bestiary-cr-badge">CR ${m.cr}</span>
                </div>
                <div class="bestiary-stats-row">
                  <span>HP: <b>${isUnlocked ? m.hp : '???'}</b></span>
                  <span>AC: <b>${isUnlocked ? m.ac : '??'}</b></span>
                  <span>XP: <b>${m.xp}</b></span>
                </div>
                <div class="bestiary-lore">
                  ${isUnlocked ? esc(m.lore) : label("ui.districts.encounter_and_defeat_this_creature_in_the")}
                </div>
                ${isUnlocked && detailRows.length ? `
                  <div class="bestiary-detail">
                    ${detailRows.map(([k, v]) => `<div><span class="muted">${k}</span> <span>${v}</span></div>`).join('')}
                  </div>` : ''}
                ${isUnlocked ? `
                  <div class="bestiary-variants">
                    <span class="muted small">${label("ui.districts.elite_variants")}</span>
                    ${Object.keys({ blazing: 1, stone_skinned: 1, vampiric: 1, venomous: 1, storm_charged: 1 }).map(affixId => {
                      const seen = (m.eliteVariants || []).find(v => v.id === affixId);
                      const actionLabel = { blazing: '炽炎', stone_skinned: '石肤', vampiric: '嗜血', venomous: '剧毒', storm_charged: '狂雷' }[affixId] || affixId;
                      return seen
                        ? `<span class="chip" style="font-size:10px; color:${seen.color}; border-color:${seen.color};" title="${esc(contentText(seen,"desc"))}">${actionLabel} ×${seen.kills}</span>`
                        : `<span class="chip" style="font-size:10px; opacity:0.45;" data-i18n-title="ui.districts.this_variant_has_not_been_encountered_yet" title="${esc(t("ui.districts.this_variant_has_not_been_encountered_yet"))}">???</span>`;
                    }).join('')}
                  </div>` : ''}
                <div class="bestiary-kill-footer">
                  <span>${label("ui.districts.weakness")} <i>${isUnlocked ? esc(m.weakness) : '???'}</i></span>
                  <span>${m.firstKillRewarded ? label("ui.districts.recorded_2") : ''}${label("ui.districts.slain_values", {p13: ''})} <b>${m.kills || 0}</b>${m.globalKills ? ` <span class="muted small">${label("ui.districts.all_heroes_values", {p0: m.globalKills})}</span>` : ''}</span>
                </div>
              </div>
            `;
          }).join('')}
          </div>
        </div>

        <!-- Trophies Tab -->
        <div class="trophy-grid" id="hallSecTrophies" style="display:none;">
          ${trophies.map(entryText => `
            <div class="trophy-card ${entryText.unlocked ? 'unlocked' : 'locked'}">
              <div class="trophy-icon-box">${entryText.unlocked ? entryText.icon : '🔒'}</div>
              <div class="trophy-info">
                <div class="trophy-title">${contentLabel(entryText,"name")}</div>
                <div class="trophy-desc">${contentLabel(entryText,"desc")}</div>
                <div style="margin-top:4px;">
                  <span class="chip ${entryText.unlocked ? 'green' : ''}" style="font-size:10.5px;">${entryText.unlocked ? label("ui.districts.acquired") : label("ui.districts.locked")}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Champions Tab -->
        <div class="card" id="hallSecChampions" style="display:none; background:rgba(18,22,32,0.8); overflow-x:auto;">
          <table class="champions-table">
            <thead>
              <tr>
                <th>${label("ui.districts.rank")}</th>
                <th>${label("ui.districts.hero")}</th>
                <th>${label("ui.districts.class_origin")}</th>
                <th>${label("ui.districts.level")}</th>
                <th>${label("ui.districts.delves_completed")}</th>
                <th>${label("ui.districts.monsters_slain")}</th>
                <th>${label("ui.districts.gold_amassed")}</th>
              </tr>
            </thead>
            <tbody>
              ${champions.map((c, i) => {
                const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
                return `
                  <tr>
                    <td><span class="champion-rank-badge ${rankClass}">${i + 1}</span></td>
                    <td><b>${contentLabel(c,"name")}</b></td>
                    <td>${contentLabel(c,"species")} ${contentLabel(c,"className")}${c.subclass ? ` (${esc(c.subclass)})` : ''}</td>
                    <td><b style="color:var(--gold);">${label("ui.districts.level_values", {p6: c.level})}</b></td>
                    <td>${c.delvesCompleted}</td>
                    <td>${c.kills}</td>
                    <td><span class="gold-text">${c.gold} GP</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function getSellPrice(itemId) {
    const cityData = ctx.getCityData();
    const arm = cityData?.shops?.armory?.find(i => i.id === itemId);
    if (arm) return Math.max(1, Math.floor(arm.cost * 0.5));
    const apo = cityData?.shops?.apothecary?.find(i => i.id === itemId);
    if (apo) return Math.max(1, Math.floor(apo.cost * 0.5));
    return 5;
  }

  function formatItemName(id) {
    return String(id || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // A rolled magic item (dropped loot) can be forged; plain shop gear and quest items cannot.
  function isForgeableItem(i) {
    return !!(i && i.rarity && i.affix && ['weapon', 'armor', 'shield'].includes(i.type));
  }

  // the toast shows the roll and the check total, mirroring the sheet's skill modifiers
  function engineModText(char, skill) {
    const abilityMap = { arcana: 'int' };
    const mod = Math.floor(((char.abilities?.[abilityMap[skill]] || 10) - 10) / 2) + (char.profBonus || 2);
    return mod >= 0 ? ` + ${mod}` : ` - ${Math.abs(mod)}`;
  }

  function attachDistrictSpecificEvents(main) {
    // ---- Gambling table ----
    let selectedStake = 10;
    const stakeButtons = main.querySelectorAll('.gamble-stake-btn');
    stakeButtons.forEach(b => b.addEventListener('click', () => {
      selectedStake = Number(b.getAttribute('data-stake'));
      stakeButtons.forEach(x => x.classList.remove('primary'));
      b.classList.add('primary');
    }));
    if (stakeButtons.length && !main.querySelector('.gamble-stake-btn.primary')) {
      const def = Array.from(stakeButtons).find(b => Number(b.getAttribute('data-stake')) <= (ctx.getActiveChar().gold || 0));
      if (def) { def.classList.add('primary'); selectedStake = Number(def.getAttribute('data-stake')); }
    }

    main.querySelectorAll('[data-gamble-tab]').forEach(b => b.addEventListener('click', () => {
      gambleGame = b.getAttribute('data-gamble-tab');
      ctx.rerenderPanel(main);
    }));
    main.querySelectorAll('.slots-tier-btn').forEach(b => b.addEventListener('click', () => {
      gambleSlotsTier = b.getAttribute('data-tier');
      ctx.rerenderPanel(main);
    }));
    main.querySelectorAll('input[name="rouletteBet"]').forEach(r => r.addEventListener('change', () => { gambleRouletteBet = r.value; }));
    main.querySelectorAll('input[name="sicboBet"]').forEach(r => r.addEventListener('change', () => { gambleSicBoBet = r.value; }));

    const rollBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('gambleRollBtn'));
    if (rollBtn) {
      rollBtn.addEventListener('click', async () => {
        const out = document.getElementById('gambleResult');
        const tier = (ctx.getCityData()?.tables?.slots?.tiers || []).find(entryText => entryText.id === gambleSlotsTier) || { stake: 10 };
        const stake = gambleGame === 'slots' ? tier.stake : selectedStake;
        if ((ctx.getActiveChar().gold || 0) < stake) return toast(() => t("ui.districts.not_enough_gold"));

        rollBtn.disabled = true;
        if (out) out.innerHTML = label("ui.districts.rolling");
        sfx.play('dice');

        const payload = { charId: ctx.getActiveChar().id, game: gambleGame, stake };
        if (gambleGame === 'roulette') {
          payload.bet = { id: gambleRouletteBet };
          if (gambleRouletteBet === 'straight') {
            const n = Number((/** @type {HTMLInputElement | null} */ (document.getElementById('rouletteNumber')))?.value);
            payload.bet.number = Number.isInteger(n) ? n : 17;
          }
        }
        if (gambleGame === 'sicbo') payload.bet = { id: gambleSicBoBet };
        if (gambleGame === 'slots') payload.tier = gambleSlotsTier;

        try {
          const res = await api.cityGamble(payload);
          ctx.setActiveChar(res.char);
          const r = res.result || {};

          // animate the server's actual roll
          if (r.game === 'roulette') showDice(37, r.number, t('ui.districts.rouletteRoll', { color: r.color }));
          else if (r.game === 'sicbo') showDice(6, r.total, t('ui.districts.sicboRoll'));
          else if (r.game === 'slots') showDice(6, (r.symbols || []).length, t('ui.districts.slotsRoll'));

          await new Promise(res => setTimeout(res, 700));
          sfx.play(res.netGold > 0 ? 'coin' : (res.netGold < 0 ? 'miss' : 'dice'));
          if (r.payout > 0 || res.netGold > 0) sfx.play('trophy_unlock');
          // kept module-side so the result survives the re-render below
          gambleResult = { text: res.message, net: res.netGold };
          toast(() => displayText(res.messageDisplay, res.message));
          await ctx.loadCityInfo();
          ctx.render(main, [ctx.getActiveChar()]);
        } catch (e) {
          if (out) {
            out.innerHTML = '<span style="color:#f87171;" data-gamble-error></span>';
            localizeText(out.querySelector('[data-gamble-error]'), () => e.message);
          }
          toast(() => e.message);
          rollBtn.disabled = false;
        }
      });
    }

    // ---- Tavern rests ----
    const btnRestShort = document.getElementById('btnRestShort');
    const btnRestLong = document.getElementById('btnRestLong');

    if (btnRestShort) {
      btnRestShort.addEventListener('click', async () => {
        try {
          const res = await api.cityRest(ctx.getActiveChar().id, 'short');
          ctx.setActiveChar(res.char);
          sfx.play('heal');
          toast(() => displayText(res.messageDisplay, res.message || t("ui.districts.short_rest_completed")));
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(() => e.message);
        }
      });
    }

    if (btnRestLong) {
      btnRestLong.addEventListener('click', async () => {
        try {
          const res = await api.cityRest(ctx.getActiveChar().id, 'long');
          ctx.setActiveChar(res.char);
          sfx.play('heal');
          toast(() => displayText(res.messageDisplay, res.message || t("ui.districts.long_rest_completed_fully_rejuvenated")));
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(() => e.message);
        }
      });
    }

    // Tavern companion recruitment
    const compBtns = main.querySelectorAll('.companion-btn');
    compBtns.forEach(b => {
      b.addEventListener('click', async () => {
        const compId = b.getAttribute('data-comp-id');
        const isAlready = ctx.getActiveChar().companion === compId;
        const newComp = isAlready ? 'none' : compId;
        try {
          const res = await api.cityCompanion(ctx.getActiveChar().id, newComp);
          ctx.setActiveChar(res.char);
          sfx.play('levelup');
          toast(() => isAlready ? t("ui.districts.dismissed_companion") : t('ui.common.recruited', { name: ctx.getCompanionName(compId) }));
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(() => e.message);
        }
      });
    });

    // Tavern rumor
    const rumorBtn = document.getElementById('btnNewRumor');
    if (rumorBtn) {
      rumorBtn.addEventListener('click', async () => {
        const rumorBox = document.getElementById('rumorBox');
        if (rumorBox) localizeText(rumorBox, () => t("ui.districts.listening_to_tavern_whispers"));
        sfx.play('dice');
        try {
          const res = await api.cityRumor();
          if (rumorBox) rumorBox.textContent = `"${res.rumor}"`;
        } catch (e) {
          if (rumorBox) rumorBox.textContent = '"Keep your steel sharp and your purse hidden."';
        }
      });
    }

    // Armory tabs (Buy vs Sell)
    const armoryBuyTab = document.getElementById('armoryBuyTabBtn');
    const armorySellTab = document.getElementById('armorySellTabBtn');
    const armoryForgeTab = document.getElementById('armoryForgeTabBtn');
    const buySec = document.getElementById('armoryBuySection');
    const sellSec = document.getElementById('armorySellSection');
    const forgeSec = document.getElementById('armoryForgeSection');

    if (armoryBuyTab && armorySellTab) {
      const showSection = (which) => {
        (/** @type {[string, HTMLElement | null, HTMLElement | null][]} */ ([['buy', armoryBuyTab, buySec], ['sell', armorySellTab, sellSec], ['forge', armoryForgeTab, forgeSec]])).forEach(([, btn, sec]) => {
          if (!btn) return;
          btn.classList.toggle('primary', btn === which);
          sec?.classList.toggle('hidden', sec !== (which === armoryBuyTab ? buySec : which === armorySellTab ? sellSec : forgeSec));
        });
      };
      armoryBuyTab.addEventListener('click', () => showSection(armoryBuyTab));
      armorySellTab.addEventListener('click', () => showSection(armorySellTab));
      if (armoryForgeTab) armoryForgeTab.addEventListener('click', () => showSection(armoryForgeTab));
    }

    // Forge: salvage / reroll / upgrade a magic item
    main.querySelectorAll('.forge-action-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const action = b.getAttribute('data-forge-action');
        const uniqueId = b.getAttribute('data-unique');
        if (action === 'salvage' && !confirm(t("ui.districts.salvaging_destroys_this_item_in_exchange_for"))) return;
        b.disabled = true;
        try {
          const res = await api.cityForge(ctx.getActiveChar().id, action, uniqueId);
          ctx.setActiveChar(res.char);
          sfx.play(action === 'salvage' ? 'hazard_burn' : 'equip');
          if (action !== 'salvage') sfx.play('trophy_unlock');
          toast(() => displayText(res.messageDisplay, res.message));
          await ctx.loadCityInfo();
          ctx.render(main, [ctx.getActiveChar()]);
        } catch (e) {
          toast(() => e.message);
          b.disabled = false;
        }
      });
    });

    // Shop item purchases (Armory & Apothecary)
    // Identify an experimental brew: one INT (Arcana) check, rolled on the server
    main.querySelectorAll('.identify-potion-btn').forEach(b => {
      b.addEventListener('click', async () => {
        const uniqueId = b.getAttribute('data-unique');
        b.disabled = true;
        const roll = await rollAnimated(20, t("ui.districts.arcana"));
        try {
          const res = await api.cityIdentify(ctx.getActiveChar().id, uniqueId);
          ctx.setActiveChar(res.char);
          sfx.play(res.success ? 'trophy_unlock' : 'miss');
          toast(() => `${roll}${engineModText(ctx.getActiveChar(), 'arcana')} — ${res.message}`);
          await ctx.loadCityInfo();
          ctx.render(main, [ctx.getActiveChar()]);
        } catch (e) {
          toast(() => e.message);
          b.disabled = false;
        }
      });
    });

    const buyBtns = main.querySelectorAll('.buy-item-btn');
    buyBtns.forEach(b => {
      b.addEventListener('click', async () => {
        const itemId = b.getAttribute('data-item-id');
        try {
          const res = await api.cityBuy(ctx.getActiveChar().id, itemId, 1);
          ctx.setActiveChar(res.char);
          sfx.play('coin');
          if (res.opened && res.opened.length) {
            sfx.play('potion');
            toast(() => displayText(res.messageDisplay, res.message));
          } else {
            toast(() => displayText(res.messageDisplay, res.message));
          }
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(() => e.message);
        }
      });
    });

    // Shop item sales
    const sellBtns = main.querySelectorAll('.sell-item-btn');
    sellBtns.forEach(b => {
      b.addEventListener('click', async () => {
        const itemId = b.getAttribute('data-item-id');
        try {
          const res = await api.citySell(ctx.getActiveChar().id, itemId, 1);
          ctx.setActiveChar(res.char);
          sfx.play('coin');
          toast(() => displayText(res.messageDisplay, res.message));
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(() => e.message);
        }
      });
    });

    // Weekly challenge embark
    const weeklyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('weeklyEmbarkBtn'));
    if (weeklyBtn) weeklyBtn.addEventListener('click', async () => {
      const me = ctx.getActiveChar();
      if (!me) return toast(() => t("ui.districts.select_a_hero_first"));
      weeklyBtn.disabled = true;
      try {
        sfx.play('quest');
        const res = await api.startGame(me.id, { bringAlly: false, difficulty: 'normal', mapId: 'weekly' });
        toast(() => t("ui.districts.weekly_trial_begins") + (res.state.weeklyLabel || 'weekly'));
        ctx.rerenderPanel(main);
        location.hash = '#/play/' + res.state.id;
      } catch (e) {
        weeklyBtn.disabled = false;
        toast(() => e.message);
      }
    });

    // Guildhall bounty claims
    const bountyBtns = main.querySelectorAll('.claim-bounty-btn');
    bountyBtns.forEach(b => {
      b.addEventListener('click', async () => {
        const bId = b.getAttribute('data-bounty-id');
        try {
          const res = await api.cityClaimBounty(ctx.getActiveChar().id, bId);
          ctx.setActiveChar(res.char);
          sfx.play('quest');
          toast(() => displayText(res.messageDisplay, res.message));
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(() => e.message);
        }
      });
    });

    // Hall of Heroes tabs
    const hallTabs = main.querySelectorAll('.hall-tab-btn');
    hallTabs.forEach(entryText => {
      entryText.addEventListener('click', () => {
        const targetTab = entryText.getAttribute('data-hall-tab');
        hallTabs.forEach(x => x.classList.remove('active'));
        entryText.classList.add('active');
        const bestiarySec = main.querySelector('#hallSecBestiary');
        const trophiesSec = main.querySelector('#hallSecTrophies');
        const championsSec = main.querySelector('#hallSecChampions');
        if (bestiarySec) bestiarySec.style.display = targetTab === 'bestiary' ? 'grid' : 'none';
        if (trophiesSec) trophiesSec.style.display = targetTab === 'trophies' ? 'grid' : 'none';
        if (championsSec) championsSec.style.display = targetTab === 'champions' ? 'block' : 'none';
        sfx.play('dice');
      });
    });
  }

  return {
    renderTavern,
    renderArmory,
    renderApothecary,
    renderGuildhall,
    renderHallOfHeroes,
    attachDistrictSpecificEvents
  };
}
