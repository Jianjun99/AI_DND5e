// overworld.js — Overworld Region Map & Oakhaven City Hub
import { api } from '../api.js';
import { esc, toast, state as appState } from '../app.js';
import { rollAnimated, showDice } from '../dice.js';
import { sfx } from '../sfx.js';
import { openLevelUpModal } from './levelup.js';

// Level-up readiness ships with the character from the server (character.levelUp) — the
// client no longer keeps its own XP table, which could drift from the engine's.

let activeChar = null;
let cityData = null;
let hallData = null;
let currentTab = 'map'; // 'map' or 'city'
let currentDistrict = 'tavern'; // 'tavern', 'armory', 'apothecary', 'guildhall', 'hall_of_heroes'
let selectedNodeId = 'oakhaven';

export async function overworldView(main, ...args) {
  // Parse query parameters
  const qStr = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const params = new URLSearchParams(qStr);
  const charIdFromUrl = params.get('char');
  const returnParam = params.get('return') || params.get('delveDone');

  const chars = await api.listCharacters();
  if (!chars.length) {
    main.innerHTML = `
      <div class="card" style="max-width:600px; margin:40px auto; text-align:center; padding:32px;">
        <h1>🏰 No Heroes Found</h1>
        <p class="muted" style="margin:16px 0;">You need a hero before setting foot in Oakhaven or exploring the realm.</p>
        <a class="btn primary big" href="#/create">✨ Create Your First Hero</a>
      </div>`;
    return;
  }

  // Pick active character
  activeChar = (charIdFromUrl ? chars.find(c => c.id === charIdFromUrl) : null) || chars[0];

  // Fetch city and map data
  await loadCityInfo();

  // If returning from a delve, display welcome banner
  if (returnParam) {
    toast(`⚔ Welcome back to Oakhaven, ${activeChar.name}! Your delve rewards have been secured.`);
  }

  // Start ambient soundscape for current tab
  sfx.startAmbient(currentTab === 'city' ? 'town' : 'hills');

  render(main, chars);

  return () => {
    sfx.stopAmbient();
  };
}

async function loadCityInfo() {
  try {
    cityData = await api.cityInfo(activeChar ? activeChar.id : null);
    if (cityData.character) {
      activeChar = cityData.character;
    }
  } catch (err) {
    console.error('Failed to load city info', err);
  }
}

function render(main, allChars) {
  main.innerHTML = `
    <div class="overworld-view">
      <!-- Header with Hero Strip -->
      <div class="overworld-header card">
        <div class="hero-strip">
          <div class="hero-avatar">
            <img src="${activeChar.portraitUrl || '/portraits/hero_' + activeChar.id + '.svg'}"
                 alt="${esc(activeChar.name)}"
                 onerror="this.src='/portraits/hero_${activeChar.id}.svg'; this.onerror=null;">
          </div>
          <div class="hero-meta">
            <div class="hero-name-row">
              <span class="hero-name">${esc(activeChar.name)}</span>
              <span class="chip">Level ${activeChar.level || 1} ${esc(activeChar.className || '')}</span>
              <span class="chip blue">${esc(activeChar.species || '')}</span>
              ${activeChar.companion ? `<span class="chip green">Companion: ${getCompanionName(activeChar.companion)}</span>` : ''}
              ${(() => {
                const lu = activeChar.levelUp || {};
                const nextLvl = lu.nextLevel || ((activeChar.level || 1) + 1);
                return lu.canLevelUp ? `<button class="btn small levelup-badge-btn" id="btnTownLevelUp" style="padding:2px 10px; margin-left:8px;" title="${lu.currentXp || 0} / ${lu.xpNeeded || '—'} XP">⚡ LEVEL UP (Lvl ${nextLvl})</button>` : '';
              })()}
            </div>
            <div class="hero-stats-row">
              <span>❤️ HP: <b>${activeChar.hp || activeChar.hpMax}/${activeChar.hpMax}</b></span>
              <span>🛡️ AC: <b>${activeChar.acBase || 10}</b></span>
              <span>💰 Gold: <b class="gold-text">${activeChar.gold || 0} GP</b></span>
              <span>⭐ XP: <b>${activeChar.xp || 0}</b></span>
            </div>
          </div>
        </div>

        <div class="header-actions">
          <div class="char-switch-wrap">
            <label class="small muted">Active Hero:</label>
            <select id="charSwitcher" style="min-width:140px;">
              ${allChars.map(c => `
                <option value="${c.id}" ${c.id === activeChar.id ? 'selected' : ''}>
                  ${esc(c.name)} (Lv ${c.level} ${esc(c.className)})
                </option>`).join('')}
            </select>
          </div>
          <div class="tab-switcher">
            <button class="btn ${currentTab === 'map' ? 'primary' : ''}" id="tabMapBtn">🗺️ Region Map</button>
            <button class="btn ${currentTab === 'city' ? 'primary' : ''}" id="tabCityBtn">🏰 Oakhaven Town</button>
          </div>
        </div>
      </div>

      <!-- Main Body: Map or City Hub -->
      <div class="overworld-body" id="overworldBody">
        ${currentTab === 'map' ? renderMapContent() : renderCityContent()}
      </div>
    </div>
  `;

  attachHeaderEvents(main, allChars);
  if (currentTab === 'map') attachMapEvents(main);
  else attachCityEvents(main);
}

function getCompanionName(compVal) {
  if (!compVal) return 'None';
  const c = (cityData?.companions || []).find(x => x.id === compVal);
  return c ? c.name : compVal;
}

// -------------------------------------------------------------
// MAP VIEW RENDERING
// -------------------------------------------------------------
function renderMapContent() {
  const nodes = cityData?.mapNodes || [];
  const selectedNode = nodes.find(n => n.id === selectedNodeId) || nodes[0];

  return `
    <div class="region-map-container">
      <!-- SVG Map Canvas -->
      <div class="map-viewport card">
        <div class="map-title-overlay">
          <h2>Province of The Sunlit Vale</h2>
          <p class="muted small">Select a waypoint on the provincial road to dispatch an expedition or visit town.</p>
        </div>

        <svg class="region-svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
          <defs>
            <!-- Filters & Gradients -->
            <radialGradient id="mapBgGrad" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stop-color="#241e17" />
              <stop offset="60%" stop-color="#181410" />
              <stop offset="100%" stop-color="#0f0c09" />
            </radialGradient>
            <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2c241a" stroke-width="0.8" opacity="0.4"/>
            </pattern>
            <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <!-- Background Terrain -->
          <rect width="1000" height="600" fill="url(#mapBgGrad)" />
          <rect width="1000" height="600" fill="url(#gridPattern)" />

          <!-- Mountain ranges & landscape shapes -->
          <path d="M 450,80 L 520,30 L 600,90 L 680,40 L 740,110 L 820,60 L 920,130 L 980,180 L 1000,160 L 1000,0 L 400,0 Z"
                fill="#1f1a14" opacity="0.6" />
          <text x="700" y="70" fill="#544837" font-family="Georgia, serif" font-size="14" letter-spacing="4">THE BARREN RIDGES</text>

          <!-- Forest cluster in west -->
          <path d="M 40,240 Q 120,200 180,260 Q 220,330 170,400 Q 90,430 40,360 Z"
                fill="#162215" opacity="0.4" />
          <text x="80" y="320" fill="#3f583e" font-family="Georgia, serif" font-size="13" letter-spacing="3">WHISPERWOOD</text>

          <!-- Weeping Marsh in southeast -->
          <path d="M 620,440 Q 740,380 880,420 Q 980,500 890,580 Q 720,590 620,520 Z"
                fill="#142125" opacity="0.45" />
          <text x="730" y="520" fill="#3b5d63" font-family="Georgia, serif" font-size="13" letter-spacing="3">THE WEEPING MARSH</text>

          <!-- Highways and Roads -->
          <!-- Road: Oakhaven (220, 312) to Sunless Crypt (580, 156) -->
          <path class="map-road" d="M 220,312 C 340,300 440,230 580,156" stroke="#8a7440" stroke-width="4" stroke-dasharray="8 6" fill="none" />
          <text x="360" y="240" class="road-label" transform="rotate(-15 360 240)">Old King's Highway</text>

          <!-- Road: Oakhaven (220, 312) to Drowned Vault (780, 444) -->
          <path class="map-road" d="M 220,312 C 380,380 560,420 780,444" stroke="#5f7e6f" stroke-width="4" stroke-dasharray="8 6" fill="none" />
          <text x="460" y="395" class="road-label" transform="rotate(8 460 395)">Weeping Marsh Causeway</text>

          <!-- Road: Sunless Crypt (580, 156) to Drowned Vault (780, 444) -->
          <path class="map-road" d="M 580,156 C 680,240 730,340 780,444" stroke="#685542" stroke-width="3" stroke-dasharray="5 5" fill="none" />
          <text x="700" y="300" class="road-label" transform="rotate(50 700 300)">Sunken Barrow Path</text>

          <!-- Location Nodes -->
          ${nodes.map(n => {
            const cx = n.x * 10;
            const cy = n.y * 6;
            const isSel = n.id === selectedNodeId;
            const isCity = n.type === 'city';
            const color = isCity ? '#c9a959' : (n.id === 'crypt' ? '#b8433a' : '#5f8fb4');

            return `
              <g class="map-node-group ${isSel ? 'active' : ''}" data-node-id="${n.id}" style="cursor:pointer;">
                ${isSel ? `<circle cx="${cx}" cy="${cy}" r="34" fill="${color}" opacity="0.25" filter="url(#glowEffect)" />` : ''}
                <circle cx="${cx}" cy="${cy}" r="22" fill="#1b1712" stroke="${color}" stroke-width="${isSel ? '3' : '2'}" />
                <text x="${cx}" y="${cy + 6}" font-size="20" text-anchor="middle">${n.icon}</text>
                <!-- Name Banner Below -->
                <rect x="${cx - 65}" y="${cy + 30}" width="130" height="22" rx="4" fill="#14110e" stroke="${color}" stroke-width="1" opacity="0.9"/>
                <text x="${cx}" y="${cy + 45}" fill="${color}" font-family="Georgia, serif" font-size="12" font-weight="bold" text-anchor="middle">
                  ${esc(n.name)}
                </text>
              </g>
            `;
          }).join('')}
        </svg>
      </div>

      <!-- Expedition Dispatch Drawer / Sidebar -->
      <div class="map-sidebar card">
        <div class="sidebar-header">
          <span class="node-icon-large">${selectedNode.icon}</span>
          <div>
            <h2>${esc(selectedNode.name)}</h2>
            <div class="chip ${selectedNode.safe ? 'green' : 'blue'}">${esc(selectedNode.levelRange)}</div>
            <span class="muted small">· ${esc(selectedNode.region || 'The Sunlit Vale')}</span>
          </div>
        </div>

        <p class="node-blurb" style="margin:14px 0; color:var(--text);">${esc(selectedNode.blurb)}</p>

        ${selectedNode.safe ? renderCityDispatch() : renderDungeonDispatch(selectedNode)}
      </div>
    </div>
  `;
}

function renderCityDispatch() {
  return `
    <div class="city-dispatch-box">
      <div class="card" style="background:var(--bg2); margin-bottom:14px;">
        <h3>Oakhaven Amenities</h3>
        <ul class="trait-list">
          <li>🍺 <b>The Boar & Lantern</b> — Rest, recover HP & spells, hire mercenaries</li>
          <li>⚔️ <b>Ironforge Smithy</b> — Weapons, shields, forged heavy armor & sales</li>
          <li>🧪 <b>Willow & Wick</b> — Healing potions, reagents, spell scrolls</li>
          <li>📜 <b>Delvers' Guildhall</b> — High-stake bounties & rewards</li>
        </ul>
      </div>
      <button class="btn primary big" id="enterCityFromMapBtn" style="width:100%;">
        🏰 Enter Oakhaven Town
      </button>
    </div>
  `;
}

function renderDungeonDispatch(node) {
  const rules = appState.rules || {};
  const diffs = rules.difficulty || {
    easy: { label: 'Easy', blurb: 'Monsters have 25% less HP' },
    normal: { label: 'Normal', blurb: 'The crypt as intended' },
    hard: { label: 'Hard', blurb: 'Monsters are mighty (+25% HP and damage)' }
  };
  const companions = cityData?.companions || [];

  return `
    <div class="dungeon-dispatch-box">
      <div class="field">
        <label><b>Select Expedition Difficulty:</b></label>
        <select id="dispatchDifficulty">
          ${Object.entries(diffs).map(([k, d]) => `
            <option value="${k}" ${k === 'normal' ? 'selected' : ''}>${esc(d.label)} (${esc(d.blurb)})</option>
          `).join('')}
        </select>
      </div>

      <div class="field" style="margin-top:10px;">
        <label><b>Assigned Mercenary Companion:</b></label>
        <select id="dispatchCompanion">
          <option value="none" ${!activeChar.companion ? 'selected' : ''}>Solo Expedition (No Companion)</option>
          ${companions.map(c => `
            <option value="${c.id}" ${activeChar.companion === c.id ? 'selected' : ''}>
              ${c.icon} ${esc(c.name)} — ${esc(c.role)} (AC ${c.ac}, HP ${c.hp})
            </option>
          `).join('')}
        </select>
        <p class="muted small" style="margin-top:4px;">
          Hire companions at the Tavern or pick an ally above.
        </p>
      </div>

      <div class="dispatch-actions" style="margin-top:18px;">
        <button class="btn primary big" id="embarkBtn" style="width:100%;" data-map-id="${node.mapId}">
          ⚔️ Embark to ${esc(node.name)}
        </button>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// CITY HUB VIEW RENDERING
// -------------------------------------------------------------
function renderCityContent() {
  const districts = cityData?.districts || [];

  return `
    <div class="city-hub-container">
      <!-- District Navigation Pills -->
      <div class="district-nav">
        ${districts.map(d => `
          <button class="district-pill ${currentDistrict === d.id ? 'active' : ''}" data-district="${d.id}">
            <span class="district-pill-icon">${d.icon}</span>
            <span class="district-pill-name">${esc(d.name)}</span>
          </button>
        `).join('')}
      </div>

      <!-- District Content Card -->
      <div class="district-panel card">
        ${renderCurrentDistrict()}
      </div>
    </div>
  `;
}

function renderCurrentDistrict() {
  switch (currentDistrict) {
    case 'tavern': return renderTavern();
    case 'armory': return renderArmory();
    case 'apothecary': return renderApothecary();
    case 'guildhall': return renderGuildhall();
    case 'hall_of_heroes': return renderHallOfHeroes();
    default: return renderTavern();
  }
}

// 1. TAVERN DISTRICT
function renderTavern() {
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
  const armoryItems = cityData?.shops?.armory || [];
  const charInventory = activeChar.inventory || [];

  return `
    <div class="district-header">
      <h2>⚔️ Ironforge Armory & Smithy</h2>
      <p class="sub">Master Torvin hammers glowing steel atop an obsidian anvil. Heavy weapons and forged chainmail line the stone racks.</p>
    </div>

    <div class="shop-tabs" style="display:flex; gap:8px; margin-bottom:14px;">
      <button class="btn primary" id="armoryBuyTabBtn">Purchase Arms & Armor</button>
      <button class="btn" id="armorySellTabBtn">Sell Loot (${charInventory.length} items)</button>
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
  if (!hallData) {
    api.hallOfHeroes(activeChar ? activeChar.id : null).then(d => {
      hallData = d;
      const panel = document.querySelector('.district-panel');
      if (panel && currentDistrict === 'hall_of_heroes') {
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

  const { bestiary = [], trophies = [], champions = [], stats = {} } = hallData;

  return `
    <div class="district-header">
      <h2>🏛️ Hall of Heroes & Trophy Room</h2>
      <p class="sub">Etched in white marble and polished brass, the grand deeds of Oakhaven's adventurers endure forever.</p>
    </div>

    <div class="hall-container">
      <div class="hall-nav-tabs">
        <button class="hall-tab-btn active" data-hall-tab="bestiary">🐲 Monster Bestiary (${bestiary.filter(m => m.unlocked).length}/${bestiary.length})</button>
        <button class="hall-tab-btn" data-hall-tab="trophies">🏆 Trophy Showcase (${trophies.filter(t => t.unlocked).length}/${trophies.length})</button>
        <button class="hall-tab-btn" data-hall-tab="champions">👑 Hall of Champions (${champions.length})</button>
      </div>

      <!-- Bestiary Tab -->
      <div class="bestiary-grid" id="hallSecBestiary">
        ${bestiary.map(m => {
          const isUnlocked = m.unlocked || m.kills > 0 || m.globalKills > 0;
          return `
            <div class="bestiary-card ${isUnlocked ? '' : 'locked'}">
              <div class="bestiary-card-header">
                <div class="bestiary-title-group">
                  <span class="bestiary-icon">${isUnlocked ? '👾' : '❓'}</span>
                  <span class="bestiary-name">${isUnlocked ? esc(m.name) : 'Unknown Beast'}</span>
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
              <div class="bestiary-kill-footer">
                <span>Weakness: <i>${isUnlocked ? esc(m.weakness) : '???'}</i></span>
                <span>Party Slain: <b>${m.globalKills || m.kills || 0}</b></span>
              </div>
            </div>
          `;
        }).join('')}
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
  const arm = cityData?.shops?.armory?.find(i => i.id === itemId);
  if (arm) return Math.max(1, Math.floor(arm.cost * 0.5));
  const apo = cityData?.shops?.apothecary?.find(i => i.id === itemId);
  if (apo) return Math.max(1, Math.floor(apo.cost * 0.5));
  return 5;
}

function formatItemName(id) {
  return String(id || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// -------------------------------------------------------------
// EVENT HANDLERS
// -------------------------------------------------------------
function attachHeaderEvents(main, allChars) {
  // Character switcher dropdown
  const switcher = document.getElementById('charSwitcher');
  if (switcher) {
    switcher.addEventListener('change', async (e) => {
      const selectedId = e.target.value;
      activeChar = allChars.find(c => c.id === selectedId) || allChars[0];
      await loadCityInfo();
      render(main, allChars);
    });
  }

  // Tab switcher
  const tabMap = document.getElementById('tabMapBtn');
  const tabCity = document.getElementById('tabCityBtn');

  if (tabMap) {
    tabMap.addEventListener('click', () => {
      currentTab = 'map';
      sfx.startAmbient('hills');
      render(main, allChars);
    });
  }

  if (tabCity) {
    tabCity.addEventListener('click', () => {
      currentTab = 'city';
      sfx.startAmbient('town');
      render(main, allChars);
    });
  }

  const lvlBtn = document.getElementById('btnTownLevelUp');
  if (lvlBtn) {
    lvlBtn.addEventListener('click', () => {
      openLevelUpModal(activeChar.id, async () => {
        const chars = await api.listCharacters();
        const updated = await api.getCharacter(activeChar.id);
        activeChar = updated;
        await loadCityInfo();
        render(main, chars);
        toast(`⚡ Level Up applied: Level ${activeChar.level}!`);
      });
    });
  }
}

function attachMapEvents(main) {
  // Node selection on SVG
  const nodeGroups = main.querySelectorAll('.map-node-group');
  nodeGroups.forEach(g => {
    g.addEventListener('click', () => {
      const nodeId = g.getAttribute('data-node-id');
      selectedNodeId = nodeId;
      const chars = [activeChar];
      render(main, chars);
    });
  });

  // Enter city button from map sidebar
  const enterCityBtn = document.getElementById('enterCityFromMapBtn');
  if (enterCityBtn) {
    enterCityBtn.addEventListener('click', () => {
      currentTab = 'city';
      sfx.startAmbient('town');
      const chars = [activeChar];
      render(main, chars);
    });
  }

  // Embark button
  const embarkBtn = document.getElementById('embarkBtn');
  if (embarkBtn) {
    embarkBtn.addEventListener('click', async () => {
      const mapId = embarkBtn.getAttribute('data-map-id') || 'crypt';
      const diffSel = document.getElementById('dispatchDifficulty');
      const compSel = document.getElementById('dispatchCompanion');
      const difficulty = diffSel ? diffSel.value : 'normal';
      const compVal = compSel ? compSel.value : 'none';
      const bringAlly = compVal === 'none' ? false : compVal;

      const embarkAction = async () => {
        try {
          embarkBtn.disabled = true;
          embarkBtn.textContent = '⚔️ Embarking...';
          const res = await api.startGame(activeChar.id, bringAlly, difficulty, mapId === 'endless_1' ? 'endless_1' : mapId);
          if (res && res.state && res.state.id) {
            location.hash = `#/play/${res.state.id}`;
          } else {
            toast('Failed to start delve expedition.');
            embarkBtn.disabled = false;
          }
        } catch (err) {
          console.error('Error embarking', err);
          toast(err.message || 'Error starting delve.');
          embarkBtn.disabled = false;
        }
      };

      if (Math.random() < 0.35) {
        showRoadEncounterModal(activeChar, mapId, embarkAction);
      } else {
        await embarkAction();
      }
    });
  }
}

function attachCityEvents(main) {
  // District pill switching
  const pills = main.querySelectorAll('.district-pill');
  pills.forEach(p => {
    p.addEventListener('click', () => {
      currentDistrict = p.getAttribute('data-district');
      rerenderPanel(main);
      pills.forEach(x => x.classList.remove('active'));
      p.classList.add('active');
    });
  });

  attachDistrictSpecificEvents(main);
}

// redraw just the district panel (keeps the selected tab, stakes and scroll position intact)
function rerenderPanel(main) {
  const panel = main.querySelector('.district-panel');
  if (panel) {
    panel.innerHTML = renderCurrentDistrict();
    attachDistrictSpecificEvents(main);
  }
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
    const def = Array.from(stakeButtons).find(b => Number(b.getAttribute('data-stake')) <= (activeChar.gold || 0));
    if (def) { def.classList.add('primary'); selectedStake = Number(def.getAttribute('data-stake')); }
  }

  main.querySelectorAll('[data-gamble-tab]').forEach(b => b.addEventListener('click', () => {
    gambleGame = b.getAttribute('data-gamble-tab');
    rerenderPanel(main);
  }));
  main.querySelectorAll('.slots-tier-btn').forEach(b => b.addEventListener('click', () => {
    gambleSlotsTier = b.getAttribute('data-tier');
    rerenderPanel(main);
  }));
  main.querySelectorAll('input[name="rouletteBet"]').forEach(r => r.addEventListener('change', () => { gambleRouletteBet = r.value; }));
  main.querySelectorAll('input[name="sicboBet"]').forEach(r => r.addEventListener('change', () => { gambleSicBoBet = r.value; }));

  const rollBtn = document.getElementById('gambleRollBtn');
  if (rollBtn) {
    rollBtn.addEventListener('click', async () => {
      const out = document.getElementById('gambleResult');
      const tier = (cityData?.tables?.slots?.tiers || []).find(t => t.id === gambleSlotsTier) || { stake: 10 };
      const stake = gambleGame === 'slots' ? tier.stake : selectedStake;
      if ((activeChar.gold || 0) < stake) return toast('金币不足。');

      rollBtn.disabled = true;
      if (out) out.innerHTML = '🎲 掷……';
      sfx.play('dice');

      const payload = { charId: activeChar.id, game: gambleGame, stake };
      if (gambleGame === 'roulette') {
        payload.bet = { id: gambleRouletteBet };
        if (gambleRouletteBet === 'straight') {
          const n = Number(document.getElementById('rouletteNumber')?.value);
          payload.bet.number = Number.isInteger(n) ? n : 17;
        }
      }
      if (gambleGame === 'sicbo') payload.bet = { id: gambleSicBoBet };
      if (gambleGame === 'slots') payload.tier = gambleSlotsTier;

      try {
        const res = await api.cityGamble(payload);
        activeChar = res.char;
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
        await loadCityInfo();
        render(main, [activeChar]);
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
        const res = await api.cityRest(activeChar.id, 'short');
        activeChar = res.char;
        sfx.play('heal');
        toast(res.message || 'Short rest completed.');
        await loadCityInfo();
        const chars = [activeChar];
        render(main, chars);
      } catch (e) {
        toast(e.message);
      }
    });
  }

  if (btnRestLong) {
    btnRestLong.addEventListener('click', async () => {
      try {
        const res = await api.cityRest(activeChar.id, 'long');
        activeChar = res.char;
        sfx.play('heal');
        toast(res.message || 'Long rest completed! Fully rejuvenated.');
        await loadCityInfo();
        const chars = [activeChar];
        render(main, chars);
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
      const isAlready = activeChar.companion === compId;
      const newComp = isAlready ? 'none' : compId;
      try {
        const res = await api.cityCompanion(activeChar.id, newComp);
        activeChar = res.char;
        sfx.play('levelup');
        toast(isAlready ? 'Dismissed companion.' : `Recruited ${getCompanionName(compId)}!`);
        const chars = [activeChar];
        render(main, chars);
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
  const buySec = document.getElementById('armoryBuySection');
  const sellSec = document.getElementById('armorySellSection');

  if (armoryBuyTab && armorySellTab) {
    armoryBuyTab.addEventListener('click', () => {
      armoryBuyTab.classList.add('primary');
      armorySellTab.classList.remove('primary');
      buySec?.classList.remove('hidden');
      sellSec?.classList.add('hidden');
    });
    armorySellTab.addEventListener('click', () => {
      armorySellTab.classList.add('primary');
      armoryBuyTab.classList.remove('primary');
      sellSec?.classList.remove('hidden');
      buySec?.classList.add('hidden');
    });
  }

  // Shop item purchases (Armory & Apothecary)
  // Identify an experimental brew: one INT (Arcana) check, rolled on the server
  main.querySelectorAll('.identify-potion-btn').forEach(b => {
    b.addEventListener('click', async () => {
      const uniqueId = b.getAttribute('data-unique');
      b.disabled = true;
      const roll = await rollAnimated(20, 'Arcana');
      try {
        const res = await api.cityIdentify(activeChar.id, uniqueId);
        activeChar = res.char;
        sfx.play(res.success ? 'trophy_unlock' : 'miss');
        toast(`${roll}${engineModText(activeChar, 'arcana')} — ${res.message}`);
        await loadCityInfo();
        render(main, [activeChar]);
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
        const res = await api.cityBuy(activeChar.id, itemId, 1);
        activeChar = res.char;
        sfx.play('coin');
        if (res.opened && res.opened.length) {
          sfx.play('potion');
          toast(`${res.message}`);
        } else {
          toast(res.message);
        }
        await loadCityInfo();
        const chars = [activeChar];
        render(main, chars);
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
        const res = await api.citySell(activeChar.id, itemId, 1);
        activeChar = res.char;
        sfx.play('coin');
        toast(res.message);
        await loadCityInfo();
        const chars = [activeChar];
        render(main, chars);
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
        const res = await api.cityClaimBounty(activeChar.id, bId);
        activeChar = res.char;
        sfx.play('quest');
        toast(res.message);
        await loadCityInfo();
        const chars = [activeChar];
        render(main, chars);
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

function showRoadEncounterModal(char, mapId, embarkCallback) {
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

      modal.querySelectorAll('[data-buy-item]').forEach(btn => {
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

      document.getElementById('continueDelveBtn').addEventListener('click', () => {
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

