// overworld.js — Overworld Region Map & Oakhaven City Hub
import { api } from '../api.js';
import { esc, toast, state as appState } from '../app.js';
import { sfx } from '../sfx.js';
import { openLevelUpModal } from './levelup.js';
import { createDistricts } from './overworld/districts.js';
import { showRoadEncounterModal } from './overworld/road-encounter.js';

// Level-up readiness ships with the character from the server (character.levelUp) — the
// client no longer keeps its own XP table, which could drift from the engine's.

let activeChar = null;
let cityData = null;
const hallFilter = { seen: 'all', cr: 'all', sort: 'cr' };
let currentTab = 'map'; // 'map' or 'city'
let currentDistrict = 'tavern'; // 'tavern', 'armory', 'apothecary', 'guildhall', 'hall_of_heroes'
let selectedNodeId = 'oakhaven';

// The town-district subsystem (tavern, gamble tables, armory, apothecary,
// guildhall, hall of heroes) lives in overworld/districts.js. Its renderers and
// event wiring reach the shared state of this file through the accessors below;
// this file keeps owning activeChar / cityData / hallFilter / currentDistrict and
// mounts the district panel via renderCurrentDistrict + rerenderPanel.
const {
  renderTavern,
  renderArmory,
  renderApothecary,
  renderGuildhall,
  renderHallOfHeroes,
  attachDistrictSpecificEvents
} = createDistricts({
  getActiveChar: () => activeChar,
  setActiveChar: (char) => { activeChar = char; },
  getCityData: () => cityData,
  getHallFilter: () => hallFilter,
  getCurrentDistrict: () => currentDistrict,
  loadCityInfo,
  render,
  rerenderPanel,
  getCompanionName
});

// The early "no heroes" path returns undefined; the normal path returns a cleanup
// (stops the ambient soundscape). The router only calls the cleanup when truthy.
/**
 * @returns {Promise<(function(): void) | undefined>} optional view cleanup function
 */
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
    return undefined; // no cleanup — matches the normal path's "cleanup or undefined" contract
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
  const camp = cityData?.campaign || null;
  const campObjective = camp?.objective || null;
  const campProgress = camp?.progress || null;
  const actByMap = camp?.actByMap || {};

  return `
    ${campObjective ? `
      <div class="card campaign-banner ${campObjective.done ? 'campaign-done' : ''}" style="margin-bottom:14px; border-color:var(--gold-dim);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <h3 style="margin:0;">📜 主线 · ${campObjective.done ? '已完成' : (campObjective.act ? `第 ${campObjective.act} 幕` : '')}</h3>
          <span class="chip gold-chip" title="四幕主线进度">${campProgress ? campProgress.label : ''}</span>
        </div>
        <p class="small" style="margin:6px 0 0; color:var(--gold);">${esc(campObjective.text)}</p>
        ${campObjective.done ? `<p class="muted small" style="margin:6px 0 0;">想看收场词？<a href="#/campaign/${activeChar.id}">打开结局面板 ↗</a></p>` : ''}
      </div>
    ` : ''}

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
            // the next campaign step gets a golden ring so the story is always findable
            const isCampaignStep = !!(camp?.currentActId && actByMap[n.mapId] === camp.currentActId);

            return `
              <g class="map-node-group ${isSel ? 'active' : ''}" data-node-id="${n.id}" style="cursor:pointer;">
                ${isSel ? `<circle cx="${cx}" cy="${cy}" r="34" fill="${color}" opacity="0.25" filter="url(#glowEffect)" />` : ''}
                ${isCampaignStep ? `<circle class="campaign-ring" cx="${cx}" cy="${cy}" r="28" fill="none" stroke="#f5c451" stroke-width="2" stroke-dasharray="5 4" opacity="0.95" />` : ''}
                <circle cx="${cx}" cy="${cy}" r="22" fill="#1b1712" stroke="${isCampaignStep ? '#f5c451' : color}" stroke-width="${isSel ? '3' : '2'}" />
                <text x="${cx}" y="${cy + 6}" font-size="20" text-anchor="middle">${n.icon}</text>
                <!-- Name Banner Below -->
                <rect x="${cx - 65}" y="${cy + 30}" width="130" height="22" rx="4" fill="#14110e" stroke="${isCampaignStep ? '#f5c451' : color}" stroke-width="1" opacity="0.9"/>
                <text x="${cx}" y="${cy + 45}" fill="${isCampaignStep ? '#f5c451' : color}" font-family="Georgia, serif" font-size="12" font-weight="bold" text-anchor="middle">
                  ${esc(n.name)}
                </text>
                ${isCampaignStep ? `<text x="${cx}" y="${cy - 28}" fill="#f5c451" font-size="11" font-weight="bold" text-anchor="middle">📜 主线</text>` : ''}
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

// -------------------------------------------------------------
// EVENT HANDLERS
// -------------------------------------------------------------
function attachHeaderEvents(main, allChars) {
  // Character switcher dropdown
  const switcher = /** @type {HTMLSelectElement | null} */ (document.getElementById('charSwitcher'));
  if (switcher) {
    switcher.addEventListener('change', async (e) => {
      const selectedId = /** @type {HTMLSelectElement} */ (e.target).value;
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

  // Bestiary filters
  const seenSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('bestiarySeenFilter'));
  const crSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('bestiaryCrFilter'));
  const sortSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('bestiarySortFilter'));
  [seenSel, crSel, sortSel].forEach(sel => {
    if (!sel) return;
    sel.addEventListener('change', () => {
      if (seenSel) hallFilter.seen = seenSel.value;
      if (crSel) hallFilter.cr = crSel.value;
      if (sortSel) hallFilter.sort = sortSel.value;
      rerenderPanel(main);
    });
  });

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
  const embarkBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('embarkBtn'));
  if (embarkBtn) {
    embarkBtn.addEventListener('click', async () => {
      const mapId = embarkBtn.getAttribute('data-map-id') || 'crypt';
      const diffSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('dispatchDifficulty'));
      const compSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('dispatchCompanion'));
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

