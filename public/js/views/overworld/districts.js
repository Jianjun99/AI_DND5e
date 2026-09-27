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
        <h2>🍺 The Boar & Lantern Tavern</h2>
        <p class="sub">Hearth smoke curls toward timber rafters as laughter and tavern songs echo across heavy oak tables.</p>
      </div>

      <div class="grid cols2" style="margin-bottom:20px;">
        <!-- Rest Facilities -->
        <div class="card" style="background:var(--bg2);">
          <h3>🛌 Rest & Lodging</h3>
          <p class="muted small" style="margin-bottom:12px;">Spend gold to recover your health and abilities between delves.</p>
          
          <div style="display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:10px 14px; border-radius:6px; border:1px solid var(--border);">
              <div>
                <b>Short Rest & Warm Stew</b>
                <div class="muted small">Spend hit dice to bandage wounds and catch breath (+HP).</div>
              </div>
              <button class="btn" id="btnRestShort">5 GP</button>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:10px 14px; border-radius:6px; border:1px solid var(--border);">
              <div>
                <b class="gold-text">Long Rest & Private Room</b>
                <div class="muted small">Hot bath, hearty venison feast, and deep sleep. Full HP, spell slots & abilities restored!</div>
              </div>
              <button class="btn primary" id="btnRestLong">20 GP</button>
            </div>
          </div>
        </div>

        <!-- Tavern Gossip & Rumors -->
        <div class="card" style="background:var(--bg2);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h3>🗣️ Hearth Rumors</h3>
            <button class="btn small" id="btnNewRumor">🎲 Ask Tavern Keeper</button>
          </div>
          <div id="rumorBox" style="font-style:italic; color:var(--parchment); background:var(--panel); padding:14px; border-radius:6px; border-left:3px solid var(--gold); min-height:80px; display:flex; align-items:center;">
            "${esc(rumors[0] || 'Keep your torch lit and your sword drawn.')}"
          </div>
        </div>
      </div>

      <!-- Mercenary Companions Roster -->
      <div class="card" style="background:var(--bg2);">
        <h3>🛡️ Mercenary Companion Roster</h3>
        <p class="muted small" style="margin-bottom:14px;">Recruit an ally to accompany you on perilous delves. Your active companion enters combat at your side.</p>

        <div class="grid cols3">
          ${companions.map(c => {
            const isActive = activeChar.companion === c.id;
            return `
              <div class="card companion-card ${isActive ? 'selected' : ''}" style="background:var(--panel);">
                <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px;">
                  <span style="font-size:32px;">${c.icon}</span>
                  <div>
                    <h4 style="margin:0; font-size:16px; color:var(--parchment);">${esc(c.name)}</h4>
                    <span class="chip blue" style="font-size:11px; padding:1px 6px;">${esc(c.role)}</span>
                  </div>
                </div>

                <div class="stat-line"><span>Armor Class</span><span>${c.ac}</span></div>
                <div class="stat-line"><span>Hit Points</span><span>${c.hp}</span></div>
                <div class="stat-line"><span>Speed</span><span>${c.speed} ft</span></div>
                <div class="stat-line"><span>Combat Style</span><span>${(c.attacks || []).join(', ') || 'Melee'}</span></div>
                <p class="muted small" style="margin:8px 0 12px; min-height:36px;">${esc(c.blurb)}</p>

                <button class="btn ${isActive ? 'primary' : ''} companion-btn" data-comp-id="${c.id}" style="width:100%;">
                  ${isActive ? '✓ Active Companion' : 'Recruit Companion'}
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
        <span>${esc(b.name)} <span class="muted small">${esc(b.blurb)}</span></span>
      </label>`).join('');

    const sicboBets = (tables.sicbo?.bets || []).map(b => `
      <label class="gamble-bet-option">
        <input type="radio" name="sicboBet" value="${b.id}" ${gambleSicBoBet === b.id ? 'checked' : ''}>
        <span>${esc(b.name)} <span class="muted small">${esc(b.blurb)}</span></span>
      </label>`).join('');

    const slotTiers = (tables.slots?.tiers || []).map(t => `
      <button class="btn small slots-tier-btn ${gambleSlotsTier === t.id ? 'primary' : ''}" data-tier="${t.id}"
              ${gold < t.stake ? 'disabled' : ''} title="${esc(t.blurb)}">${esc(t.name)} · ${t.stake} gp</button>`).join('');

    const reelRow = (tables.slots?.symbols || []).map(s => `<span class="slot-symbol" title="${esc(s.name)}">${s.icon}</span>`).join('');

    return `
      <div class="card gamble-table" style="background:var(--bg2); border-color:var(--gold-dim); margin-top:16px;">
        <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
          <h3 style="margin:0;">🎲 赌桌 · The Lantern Tables</h3>
          <span class="muted small">庄家优势写在明面上 —— 长期一定是亏的，但今晚你也许能赢个传说。</span>
        </div>

        <div class="gamble-tabs" style="margin:10px 0;">
          <button class="btn small ${gambleGame === 'roulette' ? 'primary' : ''}" data-gamble-tab="roulette">🎡 轮盘</button>
          <button class="btn small ${gambleGame === 'sicbo' ? 'primary' : ''}" data-gamble-tab="sicbo">🎲 骰宝</button>
          <button class="btn small ${gambleGame === 'slots' ? 'primary' : ''}" data-gamble-tab="slots">🎰 老虎机</button>
        </div>

        <div class="gamble-panel">
          ${gambleGame === 'roulette' ? `
            <p class="muted small">单零轮盘：押红/黑或一打赔率固定，押单号 35:1。理论返还 <b>${((tables.roulette?.rtp || 0.973) * 100).toFixed(1)}%</b>。</p>
            <div class="gamble-bets">${rouletteBets}</div>
            <label class="small" style="display:flex; align-items:center; gap:6px; margin:8px 0;">
              单号（0–36）：<input id="rouletteNumber" type="number" min="0" max="36" value="17"
                style="width:70px; background:var(--bg); color:var(--parchment); border:1px solid var(--border); border-radius:4px; padding:3px 6px;">
            </label>
          ` : ''}

          ${gambleGame === 'sicbo' ? `
            <p class="muted small">三颗骰子：押大/小赔 1:1（三同通吃），押豹子赔 30:1。</p>
            <div class="gamble-bets">${sicboBets}</div>
          ` : ''}

          ${gambleGame === 'slots' ? `
            <p class="muted small">五符号三转轮：三同得大奖，对子小奖。${gambleSlotsTier === 'devil'
              ? '<b style="color:#f87171;">恶魔契约档：三个 💀 会给你下一场地牢上诅咒。</b>'
              : '普通档：三个 💀 只是空手而归。'}</p>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">${slotTiers}</div>
            <div class="slot-reels">${reelRow}</div>
          ` : ''}

          ${gambleGame === 'slots' ? '' : `
            <div style="margin:10px 0;">
              <div class="muted small" style="margin-bottom:4px;">赌注</div>
              <div style="display:flex; gap:6px; flex-wrap:wrap;">${stakeChips}</div>
            </div>`}
        </div>

        <div id="gambleResult" class="gamble-result ${gambleResult ? '' : 'muted'} small">${gambleResult
          ? `${esc(gambleResult.text)} <span style="color:${gambleResult.net >= 0 ? 'var(--gold)' : '#f87171'};">（本注 ${gambleResult.net >= 0 ? '+' : ''}${gambleResult.net} gp）</span>`
          : '选择赌注，然后下注。'}</div>

        <div style="display:flex; gap:8px; align-items:center; margin-top:10px; flex-wrap:wrap;">
          <button class="btn primary" id="gambleRollBtn" ${gold < 5 ? 'disabled' : ''}>🎲 下注</button>
          <span class="muted small">💰 ${gold} gp</span>
        </div>

        ${pending.length ? `
          <div class="card" style="margin-top:12px; background:var(--bg); border-color:var(--gold-dim);">
            <h4 style="margin:0 0 6px;">🎁 待带入地牢（离场作废）</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${pending.map(p => `<span class="chip gold-chip" title="${esc(p.desc || '')}">${esc(p.name)}</span>`).join('')}
            </div>
          </div>` : ''}

        ${curses.length ? `
          <div class="card" style="margin-top:12px; background:var(--bg); border-color:#6b3a35;">
            <h4 style="margin:0 0 6px; color:#d98a80;">💀 下一场地牢的诅咒</h4>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${curses.map(id => `<span class="chip red">${esc(id === 'frailty' ? '衰朽之咒（最大生命 -5）' : '不安之咒（少一段休息）')}</span>`).join('')}
            </div>
          </div>` : ''}

        <details style="margin-top:12px;">
          <summary class="muted small" style="cursor:pointer;">赌场能赢到的地牢道具</summary>
          <div class="muted small" style="margin-top:6px; display:grid; gap:4px;">
            ${tokenDefs.map(t => `<div>${t.icon} <b>${esc(t.name)}</b> — ${esc(t.desc)}</div>`).join('')}
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
        <h2>⚔️ Ironforge Armory & Smithy</h2>
        <p class="sub">Master Torvin hammers glowing steel atop an obsidian anvil. Heavy weapons and forged chainmail line the stone racks.</p>
      </div>

      <div class="shop-tabs" style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
        <button class="btn primary" id="armoryBuyTabBtn">Purchase Arms & Armor</button>
        <button class="btn" id="armorySellTabBtn">Sell Loot (${charInventory.length} items)</button>
        <button class="btn" id="armoryForgeTabBtn">🔨 锻造台 (${forgeable.length})</button>
      </div>

      <!-- Buy Section -->
      <div id="armoryBuySection">
        <div class="shop-grid">
          ${armoryItems.map(item => `
            <div class="shop-item-card card" style="background:var(--bg2);">
              <div class="shop-item-header">
                <span class="shop-item-name"><b>${esc(item.name)}</b></span>
                <span class="chip ${item.type === 'shield' ? 'green' : (item.type === 'armor' ? 'blue' : 'gold')}">${esc(item.type)}</span>
              </div>
              <p class="muted small" style="margin:6px 0 10px; min-height:28px;">${esc(item.desc)}</p>
              <div class="shop-item-footer">
                <span class="gold-text"><b>${item.cost} GP</b></span>
                <button class="btn small primary buy-item-btn" data-item-id="${item.id}" data-item-cost="${item.cost}" ${activeChar.gold < item.cost ? 'disabled' : ''}>
                  Buy
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
            <h3 style="margin:0;">🔥 熔炉与铁砧</h3>
            <span class="chip gold-chip" title="熔解魔法装备、击杀精英与首领都能得到精华">余烬精华 ×${essence}</span>
          </div>
          <p class="muted small" style="margin:6px 0 0;">
            熔解不要的词缀装备可得精华；花金币 + 精华就能<b>重铸词缀</b>或<b>升阶品质</b>。装备中的东西要先脱下来。
          </p>
        </div>

        ${!forgeable.length ? `
          <p class="muted" style="padding:20px; text-align:center;">还没有可以改造的装备。去地牢里打倒精英怪或首领吧。</p>
        ` : `
          <div class="shop-grid" style="margin-top:12px;">
            ${forgeable.map(i => {
              const isWorn = equippedRefs.includes(i.uniqueId);
              const reroll = forgeCosts.reroll?.[i.rarity] || null;
              const upgrade = forgeCosts.upgrade?.[i.rarity] || null;
              const canAfford = (c) => c && (activeChar.gold || 0) >= c.gold && essence >= c.essence;
              const costText = (c) => c ? `${c.gold} gp + ${c.essence} 精华` : '—';
              return `
                <div class="shop-item-card card forge-card rarity-${i.rarity}" style="background:var(--bg2);">
                  <div class="shop-item-header">
                    <span class="shop-item-name"><b>${esc(i.name)}</b></span>
                    <span class="chip">${i.rarity === 'legendary' ? '🟠 传奇' : i.rarity === 'rare' ? '🟣 稀有' : '🔵 魔法'}</span>
                  </div>
                  <p class="muted small" style="margin:6px 0 8px; min-height:28px;">${esc(i.desc || '')}</p>
                  ${isWorn ? '<div class="muted small" style="margin-bottom:6px;">⚠️ 装备中：改造前请先脱下</div>' : ''}
                  <div style="display:flex; flex-direction:column; gap:6px;">
                    <button class="btn small forge-action-btn" data-forge-action="reroll" data-unique="${i.uniqueId}"
                            ${(!reroll || isWorn || !canAfford(reroll)) ? 'disabled' : ''}
                            title="换一条同稀有度的新词缀">
                      🎲 重铸词缀 · ${costText(reroll)}
                    </button>
                    <button class="btn small forge-action-btn" data-forge-action="upgrade" data-unique="${i.uniqueId}"
                            ${(!upgrade || isWorn || !canAfford(upgrade)) ? 'disabled' : ''}
                            title="提升一档品质（附魔加值与词缀效果同步提升）">
                      ⬆️ 升阶 · ${upgrade ? costText(upgrade) : '已是传奇'}
                    </button>
                    <button class="btn small forge-action-btn" data-forge-action="salvage" data-unique="${i.uniqueId}"
                            ${isWorn ? 'disabled' : ''}
                            title="熔解成余烬精华（不可撤销）">
                      🔥 熔解 · +${(cityData?.forge?.salvage?.[i.rarity]) || 1} 精华
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          ${worn.length ? `<p class="muted small" style="margin-top:10px;">已装备的 ${worn.length} 件需要先脱下才能改造（在角色页或地牢背包里操作）。</p>` : ''}
        `}
      </div>

      <!-- Sell Section (hidden by default) -->
      <div id="armorySellSection" class="hidden">
        ${!charInventory.length ? '<p class="muted" style="padding:20px; text-align:center;">Your inventory is empty. Complete delves to find valuable loot!</p>' : `
          <div class="shop-grid">
            ${charInventory.map(i => {
              const sellValue = getSellPrice(i.itemId);
              return `
                <div class="shop-item-card card" style="background:var(--bg2);">
                  <div class="shop-item-header">
                    <span class="shop-item-name"><b>${esc(formatItemName(i.itemId))}</b></span>
                    <span class="chip">Qty: ${i.qty}</span>
                  </div>
                  <div class="shop-item-footer" style="margin-top:12px;">
                    <span class="gold-text">+${sellValue} GP / unit</span>
                    <button class="btn small sell-item-btn" data-item-id="${i.itemId}">
                      Sell 1
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
        <h2>🧪 Willow & Wick Apothecary</h2>
        <p class="sub">Fragrant bundles of dried lavender and rowan hang from cedar beams. Alchemical alembics bubble with shimmering concoctions.</p>
      </div>

      <div class="shop-grid">
        ${apothecaryItems.map(item => `
          <div class="shop-item-card card" style="background:var(--bg2);">
            <div class="shop-item-header">
              <span class="shop-item-name"><b>${esc(item.name)}</b></span>
              <span class="chip">${item.cost} GP</span>
            </div>
            <p class="muted small" style="margin:6px 0 10px; min-height:28px;">${esc(item.desc)}</p>
            <div class="shop-item-footer">
              <span class="gold-text"><b>${item.cost} GP</b></span>
              <button class="btn small primary buy-item-btn" data-item-id="${item.id}" data-item-cost="${item.cost}" ${activeChar.gold < item.cost ? 'disabled' : ''}>
                Purchase
              </button>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="card" style="margin-top:18px; background:var(--bg2); border-color:var(--gold-dim);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
          <h3 style="margin:0;">⚗️ 柜台底下 · 实验性魔药</h3>
          <span class="muted small">效果在你买下的那一刻已经注定——只是没人告诉你。可以用智力（奥秘）鉴定一次。</span>
        </div>

        <div class="shop-grid" style="margin-top:12px;">
          ${brews.map(item => `
            <div class="shop-item-card card" style="background:var(--bg);">
              <div class="shop-item-header">
                <span class="shop-item-name"><b>${esc(item.name)}</b></span>
                <span class="chip">${item.cost} GP</span>
              </div>
              <p class="muted small" style="margin:6px 0 10px; min-height:28px;">${esc(item.desc)}</p>
              <div class="shop-item-footer">
                <span class="gold-text"><b>${item.cost} GP</b></span>
                <button class="btn small primary buy-item-btn" data-item-id="${item.id}" data-item-cost="${item.cost}" ${activeChar.gold < item.cost ? 'disabled' : ''}>
                  买一瓶
                </button>
              </div>
            </div>
          `).join('')}
        </div>

        ${bottles.length ? `
          <div style="margin-top:14px;">
            <div class="muted small" style="margin-bottom:6px;">你手上的瓶子（${bottles.length}）</div>
            <div style="display:flex; flex-direction:column; gap:6px;">
              ${bottles.map(b => `
                <div class="stat-line potion-row ${b.identified ? 'rarity-' + (b.effect.kind === 'good' ? 'magic' : b.effect.kind === 'bad' ? 'rare' : 'legendary') : 'potion-unknown'}"
                     style="padding:6px 8px; align-items:center;">
                  <div style="min-width:0; flex:1;">
                    <span class="item-affix-tag ${b.identified ? '' : 'rarity-common-tag'}">${b.identified
                      ? (b.effect.kind === 'good' ? '🔵 有益' : b.effect.kind === 'bad' ? '🟣 有害' : '🟠 复杂')
                      : '❓ 未鉴定'}</span>
                    <b>${esc(b.name)}</b>
                    <span class="muted small" style="margin-left:6px;">${b.identified
                      ? esc(b.effect.name + ' — ' + b.effect.desc)
                      : esc((b.clues || []).join(' · '))}</span>
                  </div>
                  <button class="btn small identify-potion-btn" data-unique="${b.uniqueId}" ${b.identifyFailed || b.identified ? 'disabled' : ''}>
                    ${b.identified ? '已鉴定' : b.identifyFailed ? '鉴定失败' : '🔍 鉴定'}
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
        <h2>📜 Delvers' Guildhall</h2>
        <p class="sub">The official provincial notice board of Oakhaven. Brave adventurers take contracts here to purge foul dungeon threats.</p>
      </div>

      <div class="bounty-grid grid cols3">
        ${bounties.map(b => {
          const isClaimed = claimed.includes(b.id);
          return `
            <div class="card bounty-card ${isClaimed ? 'claimed' : ''}" style="background:var(--bg2); border:1px solid ${isClaimed ? 'var(--green)' : 'var(--border)'};">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-size:26px;">${b.icon}</span>
                <span class="chip ${isClaimed ? 'green' : 'blue'}">${esc(b.target)}</span>
              </div>

              <h3 style="margin:0 0 6px; color:var(--parchment);">${esc(b.title)}</h3>
              <p class="muted small" style="min-height:44px; margin-bottom:12px;">${esc(b.desc)}</p>

              <div style="background:var(--panel); padding:8px 10px; border-radius:6px; margin-bottom:12px;">
                <div class="stat-line"><span>💰 Reward</span><span class="gold-text"><b>+${b.rewardGold} GP</b></span></div>
                <div class="stat-line"><span>⭐ Experience</span><span style="color:var(--gold);"><b>+${b.rewardXp} XP</b></span></div>
              </div>

              <button class="btn ${isClaimed ? '' : 'primary'} claim-bounty-btn" data-bounty-id="${b.id}" ${isClaimed ? 'disabled' : ''} style="width:100%;">
                ${isClaimed ? '✓ Contract Claimed' : 'Accept & Claim Bounty'}
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
          <h2>🏛️ Hall of Heroes & Trophy Room</h2>
          <p class="sub">Etched in white marble and polished brass, the grand deeds of Oakhaven's adventurers endure forever.</p>
        </div>
        <div style="text-align:center; padding:40px;"><div class="spinner"></div></div>
      `;
    }

    const { bestiary = [], trophies = [], champions = [], bestiaryProgress = null, campaign = null, endlessRunners = [] } = hallData;
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
        <h2>🏛️ Hall of Heroes & Trophy Room</h2>
        <p class="sub">Etched in white marble and polished brass, the grand deeds of Oakhaven's adventurers endure forever.</p>
      </div>

      ${campaign ? `
        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">
          <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px;">
            <h3 style="margin:0;">📜 主线进度 · ${campaign.progress.label}</h3>
            <a class="btn small" href="#/campaign/${activeChar.id}">查看四幕与结局 ↗</a>
          </div>
          <div class="campaign-track" style="margin-top:8px;">
            ${campaign.acts.map(a => `
              <span class="campaign-step ${a.done ? 'done' : ''}" title="${esc(a.mapName)}">
                ${a.icon} ${esc(a.name.replace(/^第.幕 · /, ''))}
              </span>`).join('<span class="campaign-arrow">→</span>')}
          </div>
        </div>` : ''}

      ${(endlessRunners && endlessRunners.length) ? `
        <div class="card" style="margin-bottom:14px; border-color:var(--gold-dim); background:var(--bg2);">
          <h3 style="margin:0 0 6px;">🕯️ 深渊远征榜 · Endless Depths</h3>
          ${endlessRunners.map((r, i) => `
            <div class="stat-line">
              <span>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🕯️'} ${esc(r.name)} <span class="muted small">Lv ${r.level} ${esc(r.className)}</span></span>
              <span style="color:var(--gold); font-weight:600;">第 ${r.depth} 层</span>
            </div>`).join('')}
        </div>` : ''}

      <div class="hall-container">
        <div class="hall-nav-tabs">
          <button class="hall-tab-btn active" data-hall-tab="bestiary">🐲 Monster Bestiary (${bestiaryProgress ? bestiaryProgress.seen : bestiary.filter(m => m.unlocked).length}/${bestiary.length})</button>
          <button class="hall-tab-btn" data-hall-tab="trophies">🏆 Trophy Showcase (${trophies.filter(t => t.unlocked).length}/${trophies.length})</button>
          <button class="hall-tab-btn" data-hall-tab="champions">👑 Hall of Champions (${champions.length})</button>
        </div>

        <!-- Bestiary Tab -->
        <div id="hallSecBestiary">
          ${bestiaryProgress ? `
            <div class="bestiary-toolbar">
              <span class="muted small">已收录 <b>${bestiaryProgress.seen}/${bestiaryProgress.total}</b> 怪种 · 精英变体 <b>${bestiaryProgress.variantsSeen}/${bestiaryProgress.variantsTotal}</b></span>
              <div class="bestiary-filters">
                <select id="bestiarySeenFilter" class="small">
                  <option value="all" ${hallFilter.seen === 'all' ? 'selected' : ''}>全部</option>
                  <option value="seen" ${hallFilter.seen === 'seen' ? 'selected' : ''}>已收录</option>
                  <option value="unseen" ${hallFilter.seen === 'unseen' ? 'selected' : ''}>未收录</option>
                </select>
                <select id="bestiaryCrFilter" class="small">
                  <option value="all" ${crFilter === 'all' ? 'selected' : ''}>所有 CR</option>
                  ${[...new Set(bestiary.map(m => String(m.cr)))].sort().map(cr => `<option value="${cr}" ${String(crFilter) === cr ? 'selected' : ''}>CR ${cr}</option>`).join('')}
                </select>
                <select id="bestiarySortFilter" class="small">
                  <option value="cr" ${sortBy === 'cr' ? 'selected' : ''}>按 CR</option>
                  <option value="kills" ${sortBy === 'kills' ? 'selected' : ''}>按击杀</option>
                  <option value="name" ${sortBy === 'name' ? 'selected' : ''}>按名称</option>
                </select>
              </div>
            </div>` : ''}
          <div class="bestiary-grid">
          ${shown.map(m => {
            const isUnlocked = m.unlocked || m.kills > 0 || m.globalKills > 0;
            const detailRows = [];
            if (m.traits?.length) detailRows.push(['特性', m.traits.join('、')]);
            if (m.attacks?.length) detailRows.push(['攻击', m.attacks.join(' / ')]);
            if (m.resistances?.length) detailRows.push(['抗性', m.resistances.join('、')]);
            if (m.vulnerabilities?.length) detailRows.push(['易伤', m.vulnerabilities.join('、')]);
            if (m.immunities?.length) detailRows.push(['免疫', m.immunities.join('、')]);
            if (m.boss) detailRows.push(['身份', '首领 · 击杀必掉稀有或传奇装备']);
            if (m.loot?.gold) detailRows.push(['掉落', `金币 ${m.loot.gold}${m.loot.items ? ` + ${m.loot.items} 种物品` : ''}`]);
            return `
              <div class="bestiary-card ${isUnlocked ? '' : 'locked'}">
                <div class="bestiary-card-header">
                  <div class="bestiary-title-group">
                    <span class="bestiary-icon">${isUnlocked ? (m.boss ? '👹' : '👾') : '❓'}</span>
                    <span class="bestiary-name">${isUnlocked ? esc(m.name) : 'Unknown Beast'}</span>
                    ${m.boss ? '<span class="chip" style="font-size:10px;">BOSS</span>' : ''}
                  </div>
                  <span class="bestiary-cr-badge">CR ${m.cr}</span>
                </div>
                <div class="bestiary-stats-row">
                  <span>HP: <b>${isUnlocked ? m.hp : '???'}</b></span>
                  <span>AC: <b>${isUnlocked ? m.ac : '??'}</b></span>
                  <span>XP: <b>${m.xp}</b></span>
                </div>
                <div class="bestiary-lore">
                  ${isUnlocked ? esc(m.lore) : 'Encounter and defeat this creature in the deep dungeons to reveal its traits and vulnerabilities.'}
                </div>
                ${isUnlocked && detailRows.length ? `
                  <div class="bestiary-detail">
                    ${detailRows.map(([k, v]) => `<div><span class="muted">${k}</span> <span>${esc(v)}</span></div>`).join('')}
                  </div>` : ''}
                ${isUnlocked ? `
                  <div class="bestiary-variants">
                    <span class="muted small">精英变体：</span>
                    ${Object.keys({ blazing: 1, stone_skinned: 1, vampiric: 1, venomous: 1, storm_charged: 1 }).map(affixId => {
                      const seen = (m.eliteVariants || []).find(v => v.id === affixId);
                      const label = { blazing: '炽炎', stone_skinned: '石肤', vampiric: '嗜血', venomous: '剧毒', storm_charged: '狂雷' }[affixId] || affixId;
                      return seen
                        ? `<span class="chip" style="font-size:10px; color:${seen.color}; border-color:${seen.color};" title="${esc(seen.desc)}">${label} ×${seen.kills}</span>`
                        : '<span class="chip" style="font-size:10px; opacity:0.45;" title="还没遇到过这种变体">???</span>';
                    }).join('')}
                  </div>` : ''}
                <div class="bestiary-kill-footer">
                  <span>Weakness: <i>${isUnlocked ? esc(m.weakness) : '???'}</i></span>
                  <span>${m.firstKillRewarded ? '📖 已收录 · ' : ''}Slain: <b>${m.kills || 0}</b>${m.globalKills ? ` <span class="muted small">(全队 ${m.globalKills})</span>` : ''}</span>
                </div>
              </div>
            `;
          }).join('')}
          </div>
        </div>

        <!-- Trophies Tab -->
        <div class="trophy-grid" id="hallSecTrophies" style="display:none;">
          ${trophies.map(t => `
            <div class="trophy-card ${t.unlocked ? 'unlocked' : 'locked'}">
              <div class="trophy-icon-box">${t.unlocked ? t.icon : '🔒'}</div>
              <div class="trophy-info">
                <div class="trophy-title">${esc(t.name)}</div>
                <div class="trophy-desc">${esc(t.desc)}</div>
                <div style="margin-top:4px;">
                  <span class="chip ${t.unlocked ? 'green' : ''}" style="font-size:10.5px;">${t.unlocked ? '✔ Acquired' : 'Locked'}</span>
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
                <th>Rank</th>
                <th>Hero</th>
                <th>Class & Origin</th>
                <th>Level</th>
                <th>Delves Completed</th>
                <th>Monsters Slain</th>
                <th>Gold Amassed</th>
              </tr>
            </thead>
            <tbody>
              ${champions.map((c, i) => {
                const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other';
                return `
                  <tr>
                    <td><span class="champion-rank-badge ${rankClass}">${i + 1}</span></td>
                    <td><b>${esc(c.name)}</b></td>
                    <td>${esc(c.species)} ${esc(c.className)}${c.subclass ? ` (${esc(c.subclass)})` : ''}</td>
                    <td><b style="color:var(--gold);">Level ${c.level}</b></td>
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
        const tier = (ctx.getCityData()?.tables?.slots?.tiers || []).find(t => t.id === gambleSlotsTier) || { stake: 10 };
        const stake = gambleGame === 'slots' ? tier.stake : selectedStake;
        if ((ctx.getActiveChar().gold || 0) < stake) return toast('金币不足。');

        rollBtn.disabled = true;
        if (out) out.innerHTML = '🎲 掷……';
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
          if (r.game === 'roulette') showDice(37, r.number, `轮盘 · ${r.color}`);
          else if (r.game === 'sicbo') showDice(6, r.total, '骰宝');
          else if (r.game === 'slots') showDice(6, (r.symbols || []).length, '老虎机');

          await new Promise(res => setTimeout(res, 700));
          sfx.play(res.netGold > 0 ? 'coin' : (res.netGold < 0 ? 'miss' : 'dice'));
          if (r.payout > 0 || res.netGold > 0) sfx.play('trophy_unlock');
          // kept module-side so the result survives the re-render below
          gambleResult = { text: res.message, net: res.netGold };
          toast(res.message);
          await ctx.loadCityInfo();
          ctx.render(main, [ctx.getActiveChar()]);
        } catch (e) {
          if (out) out.innerHTML = `<span style="color:#f87171;">${esc(e.message)}</span>`;
          toast(e.message);
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
          toast(res.message || 'Short rest completed.');
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(e.message);
        }
      });
    }

    if (btnRestLong) {
      btnRestLong.addEventListener('click', async () => {
        try {
          const res = await api.cityRest(ctx.getActiveChar().id, 'long');
          ctx.setActiveChar(res.char);
          sfx.play('heal');
          toast(res.message || 'Long rest completed! Fully rejuvenated.');
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(e.message);
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
          toast(isAlready ? 'Dismissed companion.' : `Recruited ${ctx.getCompanionName(compId)}!`);
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(e.message);
        }
      });
    });

    // Tavern rumor
    const rumorBtn = document.getElementById('btnNewRumor');
    if (rumorBtn) {
      rumorBtn.addEventListener('click', async () => {
        const rumorBox = document.getElementById('rumorBox');
        if (rumorBox) rumorBox.textContent = 'Listening to tavern whispers...';
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
        if (action === 'salvage' && !confirm('熔解后这件装备就没了（换回精华）。确定？')) return;
        b.disabled = true;
        try {
          const res = await api.cityForge(ctx.getActiveChar().id, action, uniqueId);
          ctx.setActiveChar(res.char);
          sfx.play(action === 'salvage' ? 'hazard_burn' : 'equip');
          if (action !== 'salvage') sfx.play('trophy_unlock');
          toast(res.message);
          await ctx.loadCityInfo();
          ctx.render(main, [ctx.getActiveChar()]);
        } catch (e) {
          toast(e.message);
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
        const roll = await rollAnimated(20, 'Arcana');
        try {
          const res = await api.cityIdentify(ctx.getActiveChar().id, uniqueId);
          ctx.setActiveChar(res.char);
          sfx.play(res.success ? 'trophy_unlock' : 'miss');
          toast(`${roll}${engineModText(ctx.getActiveChar(), 'arcana')} — ${res.message}`);
          await ctx.loadCityInfo();
          ctx.render(main, [ctx.getActiveChar()]);
        } catch (e) {
          toast(e.message);
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
            toast(`${res.message}`);
          } else {
            toast(res.message);
          }
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(e.message);
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
          toast(res.message);
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(e.message);
        }
      });
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
          toast(res.message);
          await ctx.loadCityInfo();
          const chars = [ctx.getActiveChar()];
          ctx.render(main, chars);
        } catch (e) {
          toast(e.message);
        }
      });
    });

    // Hall of Heroes tabs
    const hallTabs = main.querySelectorAll('.hall-tab-btn');
    hallTabs.forEach(t => {
      t.addEventListener('click', () => {
        const targetTab = t.getAttribute('data-hall-tab');
        hallTabs.forEach(x => x.classList.remove('active'));
        t.classList.add('active');
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
