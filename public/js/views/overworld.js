import { contentLabel,  t, label, localizeText, translateDOM, onLocaleChange, displayText, displayLabel } from "../i18n.js";
// overworld.js — Overworld Region Map & Oakhaven City Hub
import { api } from '../api.js';
import { esc, toast, state as appState } from '../app.js';
import { sfx } from '../sfx.js';
import { openLevelUpModal } from './levelup.js';
import { createDistricts } from './overworld/districts.js';
import { showRoadEncounterModal } from './overworld/road-encounter.js';
import { createAdventureDirectory } from '../adventure-directory.js';
import { createRegionMap, waypointSymbol } from '../region-map.js';
import { createFullscreenControls } from '../fullscreen.js';

// Level-up readiness ships with the character from the server (character.levelUp) — the
// client no longer keeps its own XP table, which could drift from the engine's.

let activeChar = null;
let cityData = null;
const hallFilter = { seen: 'all', cr: 'all', sort: 'cr' };
let currentTab = 'map'; // 'map' or 'city'
let currentDistrict = 'tavern'; // 'tavern', 'armory', 'apothecary', 'guildhall', 'hall_of_heroes'
let selectedNodeId = 'oakhaven';
let directoryUI = null;
let regionUI = null;
let fullscreenUI = null;
const directoryFilters = { query: '', source: '', scroll: 0 };
function dispatchNodes() { return [...(cityData?.mapNodes || []).filter(n => n.safe), ...(cityData?.adventures || [])]; }
// T7a: one token per overworld mount — async embark/restore callbacks drop their result
// when a newer view (or hero switch) took over, so a late response can never start a
// delve for the old hero or re-open a stale encounter modal.
let overworldToken = 0;
// one embark flow at a time (trigger → modal → resolve → startGame), shared by the
// Embark button and the restore modal's continue path
let embarkBusy = false;
/** @type {import('../navigation.js').Navigation | null} */
let overworldNavigation = null;

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
  loadCityInfo: async () => { await loadCityInfo(); },
  render,
  rerenderPanel,
  getCompanionName
});

// Own the lifetime before the first await, including the no-heroes branch.
/**
 * @param {import('../navigation.js').Navigation} navigation
 * @returns {Promise<(function(): void) | undefined>} optional view cleanup function
 */
export async function overworldView(main, navigation) {
  const myToken = ++overworldToken;
  overworldNavigation = navigation;
  let stopLocale = () => {}, ambientStarted = false;
  const cleanup = navigation.onDispose(() => {
    stopLocale();
    directoryUI?.dispose();
    directoryUI = null;
    regionUI?.dispose();
    regionUI = null;
    fullscreenUI = null;
    if (myToken === overworldToken) { overworldToken++; embarkBusy = false; }
    if (ambientStarted) sfx.stopAmbient();
  });
  embarkBusy = false;
  // Parse query parameters
  const qStr = location.hash.includes('?') ? location.hash.split('?')[1] : '';
  const params = new URLSearchParams(qStr);
  const charIdFromUrl = params.get('char');
  const returnParam = params.get('return') || params.get('delveDone');
  const nodeParam = params.get('node');

  const chars = await api.listCharacters();
  if (!navigation.isCurrent()) return undefined;
  if (!chars.length) {
    main.innerHTML = `
      <div class="card" style="max-width:600px; margin:40px auto; text-align:center; padding:32px;">
        <h1>${label("ui.overworld.no_heroes_found")}</h1>
        <p class="muted" style="margin:16px 0;">${label("ui.overworld.you_need_a_hero_before_setting_foot")}</p>
        <a class="btn primary big" href="#/create">${label("ui.overworld.create_your_first_hero")}</a>
      </div>`;
    stopLocale = onLocaleChange(() => translateDOM(main));
    return cleanup;
  }

  // Pick active character
  activeChar = (charIdFromUrl ? chars.find(c => c.id === charIdFromUrl) : null) || chars[0];

  // Fetch city and map data
  await loadCityInfo(navigation);
  if (!navigation.isCurrent()) return undefined;

  // The guidance's destination arrives as a map id (?node=<mapId>) from home/summary —
  // resolve it against the real nodes so a stale/unknown id simply leaves the selection
  // alone. A destination link always lands on the region map, never a memorised city tab.
  if (nodeParam) {
    currentTab = 'map';
    const target = dispatchNodes().find(n => n.mapId === nodeParam || n.id === nodeParam);
    if (target) selectedNodeId = target.id;
  }

  // If returning from a delve, display welcome banner
  if (returnParam) {
    toast(() => t('ui.overworld.welcome', { name: (activeChar.nameDisplay || activeChar.name) }));
  }

  // Start ambient soundscape for current tab
  sfx.startAmbient(currentTab === 'city' ? 'town' : 'hills');
  ambientStarted = true;

  render(main, chars);
  fullscreenUI = createFullscreenControls(main, navigation, toast);
  const topbar = document.querySelector('.topbar');
  const headerObserver = new ResizeObserver(() => main.style.setProperty('--overworld-topbar-height', topbar.getBoundingClientRect().height + 'px'));
  headerObserver.observe(topbar);
  navigation.onDispose(() => { headerObserver.disconnect(); main.style.removeProperty('--overworld-topbar-height'); });

  // T7a: restore an in-flight road encounter (unresolved, or resolved but not yet
  // consumed by a delve start) on (re-)entering the overworld — the server's live
  // instance is authoritative and the status query spends no RNG. No-op when the
  // character has nothing pending (the common case).
  restorePendingEncounter(myToken);
  function refreshLocalizedText() { translateDOM(main); directoryUI?.refreshLocale(); regionUI?.refresh(); }
  stopLocale = onLocaleChange(refreshLocalizedText);
  return cleanup;
}

// Shared embark flow (T7a): one live encounter lifecycle — trigger (reuses the server's
// pending instance), optional modal choice, then startGame. Guarded from the first click;
// failures surface as toasts and leave the encounter live for a retry; late responses
// after a hero switch / view change are dropped. `knownEncounter` skips the trigger when
// the caller already holds the live instance (restore-modal continue).
async function startEmbarkFlow(btn, myToken, mapId, difficulty, bringAlly, knownEncounter = null) {
  if (embarkBusy) return false;
  embarkBusy = true;
  directoryUI?.setDisabled(true);
  const char = activeChar;
  const alive = () => myToken === overworldToken && activeChar && activeChar.id === char.id;
  const resetLabel = () => {
    const node = dispatchNodes().find(n => n.mapId === mapId);
    return t('ui.overworld.embark_to_values', { p9: node?.nameDisplay || node?.name || mapId });
  };
  const reset = () => {
    embarkBusy = false;
    if (alive()) directoryUI?.setDisabled(false);
    if (btn && btn.isConnected) { btn.disabled = false; localizeText(btn, resetLabel); }
  };
  const embarkAction = async () => {
    // returns true when navigation happened, false when the player must retry
    if (!alive()) return false;
    if (btn && btn.isConnected) { btn.disabled = true; localizeText(btn, () => t("ui.overworld.embarking")); }
    try {
      const res = await api.startGame(char.id, {
        bringAlly: /** @type {false | 'bram' | 'valeria' | 'aldous'} */ (bringAlly),
        difficulty: /** @type {'easy' | 'normal' | 'hard'} */ (difficulty),
        mapId: mapId === 'endless_1' ? 'endless_1' : mapId
      });
      if (res && res.state && res.state.id) {
        if (alive()) location.hash = `#/play/${res.state.id}`;
        return true;
      }
      if (alive()) toast(() => t("ui.overworld.failed_to_start_delve_expedition"));
      return false;
    } catch (err) {
      if (alive()) toast(() => err.message || t("ui.overworld.error_starting_delve"));
      if (alive() && err.display?.key === 'api.unknownMap') {
        await loadCityInfo();
        if (alive()) {
          document.getElementById('roadEncounterModal')?.remove();
          render(document.getElementById('view'), [activeChar]);
        }
      }
      return false;
    } finally {
      if (btn && btn.isConnected && alive()) { btn.disabled = false; localizeText(btn, resetLabel); }
    }
  };

  try {
    // T7a: the knownEncounter path (restore-modal continue) must PROPAGATE the start
    // result — dropping the `false` made a failed start look successful and closed the
    // modal, leaving no in-place retry. With the result kept, the modal stays with its
    // continue button and the resolved instance is never re-resolved or re-awarded.
    if (knownEncounter) return await embarkAction();
    if (btn && btn.isConnected) { btn.disabled = true; localizeText(btn, () => t("ui.overworld.checking_the_road")); }
    let encRes;
    try {
      encRes = await api.triggerRoadEncounter(char.id);
    } catch (err) {
      // a failed trigger is NOT "no encounter" — never silently embark past it (T7a)
      if (alive()) toast(() => t('ui.overworld.roadFailure', { error: err.message || t('ui.overworld.network_error') }));
      return false;
    }
    if (!alive()) return false; // hero switched / view replaced while the request was in flight
    if (encRes && encRes.encounter) {
      showRoadEncounterModal(char, mapId, embarkAction, encRes.encounter, { alive });
      return null; // the modal's continue path reports the start result itself
    }
    return await embarkAction();
  } finally {
    reset();
  }
}

// Restore an in-flight encounter when the prepare page mounts (refresh / return). The
// modal shows the same instanceId the server holds; continuing embarks with the current
// on-screen options when present, else the guidance's default map.
async function restorePendingEncounter(myToken) {
  const char = activeChar;
  if (!char) return;
  let res;
  try {
    res = await api.roadEncounterStatus(char.id);
  } catch {
    return; // offline — nothing to restore, the embark click will surface the failure
  }
  if (myToken !== overworldToken || !activeChar || activeChar.id !== char.id) return; // late response
  const enc = res && res.currentRoadEncounter;
  if (!enc) return;
  if (document.getElementById('roadEncounterModal')) return; // already on screen

  const diffSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('dispatchDifficulty'));
  const compSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('dispatchCompanion'));
  const embarkBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('embarkBtn'));
  const difficulty = diffSel ? diffSel.value : 'normal';
  const compVal = compSel ? compSel.value : 'none';
  const bringAlly = compVal === 'none' ? false : compVal;
  const mapId = (embarkBtn && embarkBtn.getAttribute('data-map-id')) ||
    (cityData && cityData.guidance && cityData.guidance.primary && cityData.guidance.primary.mapId) || 'crypt';
  showRoadEncounterModal(char, mapId, () => startEmbarkFlow(embarkBtn, myToken, mapId, difficulty, bringAlly, enc), enc, { alive: () => myToken === overworldToken && activeChar && activeChar.id === char.id });
}

async function loadCityInfo(navigation = overworldNavigation) {
  const charId = activeChar ? activeChar.id : null;
  try {
    const result = await api.cityInfo(charId);
    if (!navigation?.isCurrent() || charId !== (activeChar ? activeChar.id : null)) return false;
    cityData = result;
    if (!dispatchNodes().some(n => n.id === selectedNodeId)) selectedNodeId = dispatchNodes()[0]?.id || 'oakhaven';
    if (cityData.character) {
      activeChar = cityData.character;
    }
    return true;
  } catch (err) {
    if (!navigation?.isCurrent()) return false;
    console.error('Failed to load city info', err);
    toast(() => err.message);
    return false;
  }
}

function render(main, allChars) {
  regionUI?.dispose();
  regionUI = null;
  if (!overworldNavigation?.isCurrent()) return;
  directoryUI?.dispose();
  directoryUI = null;
  main.innerHTML = `
    <div class="overworld-view">
      <!-- Header with Hero Strip -->
      <div class="overworld-header card">
        <div class="hero-strip">
          <div class="hero-avatar">
            <img src="${activeChar.portraitUrl || '/portraits/hero_' + activeChar.id + '.svg'}"
                 alt="${contentLabel(activeChar,"name")}"
                 onerror="this.src='/portraits/hero_${activeChar.id}.svg'; this.onerror=null;">
          </div>
          <div class="hero-meta">
            <div class="hero-name-row">
              <span class="hero-name">${contentLabel(activeChar,"name")}</span>
              <span class="chip" data-hero-class>${label("ui.overworld.level_values", {p4: activeChar.level || 1, p5: activeChar.classNameDisplay || activeChar.className || ''})}</span>
              <span class="chip blue" data-hero-species>${contentLabel(activeChar,'species')}</span>
              ${activeChar.companion ? `<span class="chip green">${label("ui.overworld.companion_values", {p0: getCompanionName(activeChar.companion)})}</span>` : ''}
              ${(() => {
                const lu = activeChar.levelUp || {};
                const nextLvl = lu.nextLevel || ((activeChar.level || 1) + 1);
                return lu.canLevelUp ? `<button class="btn small levelup-badge-btn" id="btnTownLevelUp" style="padding:2px 10px; margin-left:8px;" title="${lu.currentXp || 0} / ${lu.xpNeeded || '—'} XP">${label("ui.overworld.level_up_lvl_values", {p2: nextLvl})}</button>` : '';
              })()}
            </div>
            <div class="hero-stats-row">
              <span>❤️ HP: <b>${activeChar.hp || activeChar.hpMax}/${activeChar.hpMax}</b></span>
              <span>🛡️ AC: <b>${activeChar.acBase || 10}</b></span>
              <span>${label("ui.overworld.gold")} <b class="gold-text">${activeChar.gold || 0} GP</b></span>
              <span>⭐ XP: <b>${activeChar.xp || 0}</b></span>
            </div>
          </div>
        </div>

        <div class="header-actions">
          <div class="char-switch-wrap">
            <label class="small muted">${label("ui.overworld.active_hero")}</label>
            <select id="charSwitcher" style="min-width:140px;">
              ${allChars.map(c => `
                <option value="${c.id}" ${c.id === activeChar.id ? 'selected' : ''}>
                  ${label("ui.overworld.lv_values", {p2: (c.nameDisplay || c.name), p3: c.level, p4: (c.classNameDisplay || c.className)})}
                </option>`).join('')}
            </select>
          </div>
          <div class="tab-switcher">
            <button class="btn" type="button" data-app-fullscreen>${label('ui.fullscreen.enter')}</button>
            <button class="btn ${currentTab === 'map' ? 'primary' : ''}" id="tabMapBtn">${label("ui.overworld.region_map")}</button>
            <button class="btn ${currentTab === 'city' ? 'primary' : ''}" id="tabCityBtn">${label("ui.overworld.oakhaven_town")}</button>
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
  fullscreenUI?.refresh();
}

function getCompanionName(compVal) {
  if (!compVal) return t("ui.overworld.none");
  const c = (cityData?.companions || []).find(x => x.id === compVal);
  return c ? c.name : compVal;
}

// -------------------------------------------------------------
// MAP VIEW RENDERING
// -------------------------------------------------------------
function renderMapContent() {
  const nodes = cityData?.mapNodes || [];
  const selectedNode = dispatchNodes().find(n => n.id === selectedNodeId) || nodes[0];
  const camp = cityData?.campaign || null;
  const campObjective = camp?.objective || null;
  const campProgress = camp?.progress || null;
  const actByMap = camp?.actByMap || {};
  // server-computed "what next": one primary action + reason (T4)
  const guide = cityData?.guidance || null;
  const guidePrimary = guide && guide.primary ? guide.primary : null;
  const nodeByMapId = {};
  dispatchNodes().forEach(n => { if (n.mapId) nodeByMapId[n.mapId] = n; });
  const guideNode = guidePrimary && guidePrimary.mapId ? nodeByMapId[guidePrimary.mapId] : null;

  return `
    ${campObjective ? `
      <div class="card campaign-banner ${campObjective.done ? 'campaign-done' : ''}" style="margin-bottom:14px; border-color:var(--gold-dim);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <h3 style="margin:0;">${label("ui.overworld.story")}${campObjective.done ? label("ui.overworld.complete") : (campObjective.act ? label("ui.overworld.act", { act: campObjective.act }) : "")}</h3>
          <span class="chip gold-chip" data-i18n-title="ui.overworld.four_act_story_progress" title="${esc(t("ui.overworld.four_act_story_progress"))}">${campProgress ? displayLabel(campProgress.labelDisplay, campProgress.label) : ''}</span>
        </div>
        <p class="small" style="margin:6px 0 0; color:var(--gold);">${contentLabel(campObjective,"text")}</p>
        ${guidePrimary ? `
        <div class="guidance-banner-row">
          ${guidePrimary.kind === 'resume' && guidePrimary.saveId
            ? `<a class="btn primary small" href="#/play/${guidePrimary.saveId}">▶ ${displayLabel(guidePrimary.textDisplay, guidePrimary.text)}</a>`
            : (guideNode ? `<button class="btn primary small" data-guidance-node="${guideNode.id}">▶ ${displayLabel(guidePrimary.textDisplay, guidePrimary.text)}</button>` : '')}
          ${guidePrimary.reason ? `<span class="muted small">${displayLabel(guidePrimary.reasonDisplay, guidePrimary.reason)}</span>` : ''}
        </div>` : ''}
        ${campObjective.done ? `<p class="muted small" style="margin:6px 0 0;">${label("ui.overworld.read_the_epilogue")}<a href="#/campaign/${activeChar.id}">${label("ui.overworld.open_the_ending_panel")}</a></p>` : ''}
      </div>
    ` : ''}

    <div class="overworld-map-layout">
    <div class="card" data-town-adventures></div>
    <div class="region-map-container">
      <!-- SVG Map Canvas -->
      <div class="map-viewport card">
        <div class="region-map-heading">
          <h2>${label("ui.overworld.province_of_the_sunlit_vale")}</h2>
          <p class="muted small">${label("ui.overworld.select_a_waypoint_on_the_provincial_road")}</p>
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
          <text x="700" y="70" fill="#544837" font-family="Georgia, serif" font-size="14" letter-spacing="4" data-i18n="ui.overworld.the_barren_ridges">${esc(t("ui.overworld.the_barren_ridges"))}</text>

          <!-- Forest cluster in west -->
          <path d="M 40,240 Q 120,200 180,260 Q 220,330 170,400 Q 90,430 40,360 Z"
                fill="#162215" opacity="0.4" />
          <text x="80" y="320" fill="#3f583e" font-family="Georgia, serif" font-size="13" letter-spacing="3" data-i18n="ui.overworld.whisperwood">${esc(t("ui.overworld.whisperwood"))}</text>

          <!-- Weeping Marsh in southeast -->
          <path d="M 620,440 Q 740,380 880,420 Q 980,500 890,580 Q 720,590 620,520 Z"
                fill="#142125" opacity="0.45" />
          <text x="730" y="520" fill="#3b5d63" font-family="Georgia, serif" font-size="13" letter-spacing="3" data-i18n="ui.overworld.the_weeping_marsh">${esc(t("ui.overworld.the_weeping_marsh"))}</text>

          <!-- Highways and Roads -->
          ${(cityData?.mapRoads || []).map(road => {
            const from = nodes.find(n => n.id === road.from), to = nodes.find(n => n.id === road.to);
            if (!from || !to) return '';
            const x1 = from.x * 10, y1 = from.y * 6, x2 = to.x * 10, y2 = to.y * 6;
            return `<path class="map-road" data-road-from="${esc(road.from)}" data-road-to="${esc(road.to)}" d="M ${x1},${y1} L ${x2},${y2}" stroke="#8a7440" stroke-width="2" stroke-dasharray="8 6" fill="none"><title data-i18n-display="${esc(JSON.stringify(road.labelDisplay))}" data-i18n-fallback="${esc(road.label)}">${esc(displayText(road.labelDisplay,road.label))}</title></path>`;
          }).join('')}

          <!-- Location Nodes -->
          ${nodes.map(n => {
            const isSel = n.id === selectedNodeId;
            const isCity = n.type === 'city';
            const color = isCity ? '#c9a959' : (n.id === 'crypt' ? '#b8433a' : '#5f8fb4');
            // the next campaign step gets a golden ring so the story is always findable
            const isCampaignStep = !!(camp?.currentActId && actByMap[n.mapId] === camp.currentActId);

            return `
              <g class="map-node-group ${isSel ? 'active' : ''}" data-node-id="${esc(n.id)}" tabindex="0" role="button" aria-pressed="${isSel}" style="color:${isCampaignStep ? '#f5c451' : color};cursor:pointer;">
                <title data-i18n-display="${esc(JSON.stringify(n.nameDisplay))}" data-i18n-fallback="${esc(n.name)}">${esc(displayText(n.nameDisplay,n.name))}</title>
                <line class="waypoint-leader" x1="0" y1="0" x2="0" y2="0" stroke="currentColor" stroke-width="1" opacity="0.6"/>
                ${isCampaignStep ? '<circle class="campaign-ring" cx="0" cy="0" r="28" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/>' : ''}
                <circle class="waypoint-hit" cx="0" cy="0" r="22" fill="#1b1712" stroke="currentColor" stroke-width="${isSel ? '3' : '2'}" />
                ${waypointSymbol(n.marker || n.type)}
                <rect class="waypoint-label-box" rx="5" fill="#14110e" stroke="currentColor" stroke-width="1"/>
                <text fill="currentColor" font-family="Georgia, serif" font-weight="600" text-anchor="middle" data-i18n-display="${esc(JSON.stringify(n.nameDisplay || { fallback:n.name }))}" data-i18n-fallback="${esc(n.name)}">${esc(displayText(n.nameDisplay,n.name))}</text>
              </g>
            `;
          }).join('')}
        </svg>
      </div>

      <!-- Expedition Dispatch Drawer / Sidebar -->
      <div class="map-sidebar card">
        <div class="sidebar-header">
          <svg class="node-icon-large" viewBox="-20 -20 40 40" aria-hidden="true">${waypointSymbol(selectedNode.marker || selectedNode.type)}</svg>
          <div>
            <h2>${contentLabel(selectedNode,"name")}</h2>
            <div class="chip ${selectedNode.safe ? 'green' : 'blue'}">${contentLabel(selectedNode,"levelRange")}</div>
            ${selectedNode.region ? `<span class="muted small">· ${contentLabel(selectedNode,"region")}</span>` : ''}
          </div>
        </div>

        <p class="node-blurb" style="margin:14px 0; color:var(--text);">${contentLabel(selectedNode,"blurb")}</p>

        ${selectedNode.safe ? renderCityDispatch() : renderDungeonDispatch(selectedNode)}
      </div>
    </div>
    </div>
  `;
}

function renderCityDispatch() {
  return `
    <div class="city-dispatch-box">
      <div class="card" style="background:var(--bg2); margin-bottom:14px;">
        <h3>${label("ui.overworld.oakhaven_amenities")}</h3>
        <ul class="trait-list">
          <li>🍺 <b>${label("ui.overworld.the_boar_lantern")}</b> ${label("ui.overworld.rest_recover_hp_spells_hire_mercenaries")}</li>
          <li>⚔️ <b>${label("ui.overworld.ironforge_smithy")}</b> ${label("ui.overworld.weapons_shields_forged_heavy_armor_sales")}</li>
          <li>🧪 <b>${label("ui.overworld.willow_wick")}</b> ${label("ui.overworld.healing_potions_reagents_spell_scrolls")}</li>
          <li>📜 <b>${label("ui.overworld.delvers_guildhall")}</b> ${label("ui.overworld.high_stake_bounties_rewards")}</li>
        </ul>
      </div>
      <button class="btn primary big" id="enterCityFromMapBtn" style="width:100%;">
        ${label("ui.overworld.enter_oakhaven_town")}
      </button>
    </div>
  `;
}

function renderDungeonDispatch(node) {
  const rules = appState.rules || {};
  const diffs = rules.difficulty || {
    easy: { label: t("ui.overworld.easy"), blurb: t("ui.overworld.monsters_have_25_less_hp") },
    normal: { label: t("ui.overworld.normal"), blurb: t("ui.overworld.the_crypt_as_intended") },
    hard: { label: t("ui.overworld.hard"), blurb: t("ui.overworld.monsters_are_mighty_25_hp_and_damage") }
  };
  const companions = cityData?.companions || [];
  // the story's recommended destination gets its reason spelled out next to the options
  const guide = cityData?.guidance || null;
  const rec = guide && guide.primary && guide.primary.mapId === node.mapId ? guide.primary : null;

  return `
    <div class="dungeon-dispatch-box">
      ${rec ? `<div class="recommend-box">${label("ui.overworld.story")}${displayLabel(rec.reasonDisplay, rec.reason || "")}</div>` : ''}
      <div class="field">
        <label><b>${label("ui.overworld.select_expedition_difficulty")}</b></label>
        <select id="dispatchDifficulty">
          ${Object.entries(diffs).map(([k, d]) => `
            <option value="${k}" ${k === 'normal' ? 'selected' : ''} data-i18n="difficulty.${k}.option">${esc(displayText(d.labelDisplay, d.label))} (${esc(displayText(d.blurbDisplay, d.blurb))})</option>
          `).join('')}
        </select>
      </div>

      <div class="field" style="margin-top:10px;">
        <label><b>${label("ui.overworld.assigned_mercenary_companion")}</b></label>
        <select id="dispatchCompanion">
          <option value="none" ${!activeChar.companion ? 'selected' : ''} data-i18n="ui.overworld.solo_expedition_no_companion">${esc(t("ui.overworld.solo_expedition_no_companion"))}</option>
          ${companions.map(c => `
            <option value="${c.id}" ${activeChar.companion === c.id ? 'selected' : ''}>
              ${c.icon} ${contentLabel(c,"name")} — ${contentLabel(c,"role")} (AC ${c.ac}, HP ${c.hp})
            </option>
          `).join('')}
        </select>
        <p class="muted small" style="margin-top:4px;">
          ${label("ui.overworld.hire_companions_at_the_tavern_or_pick")}
        </p>
      </div>

      <div class="dispatch-actions" style="margin-top:18px;">
        <button class="btn primary big" id="embarkBtn" style="width:100%;" data-map-id="${node.mapId}">
          ${label("ui.overworld.embark_to_values", {p9: (node.nameDisplay || node.name)})}
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
            <span class="district-pill-name">${displayLabel(d.nameDisplay, d.name)}</span>
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
        toast(() => t('ui.common.levelApplied', { level: activeChar.level }));
      });
    });
  }
}

function attachMapEvents(main) {
  const select = id => {
    selectedNodeId = id;
    render(main, [activeChar]);
    const input = [...main.querySelectorAll('[data-adventure-id]')].find(el => el.getAttribute('data-adventure-id') === id)?.querySelector('input');
    input?.focus({ preventScroll: true });
  };
  directoryUI = createAdventureDirectory(main.querySelector('[data-town-adventures]'), {
    entries: cityData?.adventures || [], selectedId: selectedNodeId, filterState: directoryFilters, allowEmptySelection: true,
    onSelect: entry => select(entry.id),
    onRefresh: async () => {
      const token = overworldToken, previous = selectedNodeId;
      directoryUI.setDisabled(true);
      const loaded = await loadCityInfo();
      if (!overworldNavigation?.isCurrent() || token !== overworldToken) return;
      render(main, [activeChar]);
      if (loaded) toast(() => t(previous === selectedNodeId ? 'adventure.updated' : 'adventure.removed'));
      main.querySelector('[data-adventure-refresh]')?.focus();
    }
  });
  directoryUI.setDisabled(embarkBusy);
  regionUI = createRegionMap(main.querySelector('.region-svg'), cityData?.mapNodes || []);
  // Node selection on SVG
  const nodeGroups = main.querySelectorAll('.map-node-group');
  nodeGroups.forEach(g => {
    g.addEventListener('click', () => {
      const nodeId = g.getAttribute('data-node-id');
      selectedNodeId = nodeId;
      const chars = [activeChar];
      render(main, chars);
    });
    g.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      const id = g.getAttribute('data-node-id');
      select(id);
      [...main.querySelectorAll('[data-node-id]')].find(el => el.getAttribute('data-node-id') === id)?.focus({ preventScroll: true });
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

  // Guidance button in the campaign banner: select the recommended node (no auto-embark —
  // the player still reviews difficulty/companion and presses Embark themselves)
  main.querySelectorAll('[data-guidance-node]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedNodeId = btn.getAttribute('data-guidance-node') || selectedNodeId;
      render(main, [activeChar]);
    });
  });

  // Embark button (T7a: guarded flow in startEmbarkFlow — double clicks, trigger
  // failures and late responses are all handled there)
  const embarkBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('embarkBtn'));
  if (embarkBtn) {
    const myToken = overworldToken;
    embarkBtn.addEventListener('click', () => {
      const mapId = embarkBtn.getAttribute('data-map-id') || 'crypt';
      const diffSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('dispatchDifficulty'));
      const compSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('dispatchCompanion'));
      const difficulty = diffSel ? diffSel.value : 'normal';
      const compVal = compSel ? compSel.value : 'none';
      const bringAlly = compVal === 'none' ? false : compVal;
      startEmbarkFlow(embarkBtn, myToken, mapId, difficulty, bringAlly);
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
  if (!overworldNavigation?.isCurrent()) return;
  const panel = main.querySelector('.district-panel');
  if (panel) {
    panel.innerHTML = renderCurrentDistrict();
    attachDistrictSpecificEvents(main);
  }
}

