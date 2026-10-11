import { contentLabel, contentText, messageText, messageLabel, getLocale, t, label, localizeText, localizeAttribute, translateDOM, onLocaleChange, displayText, displayLabel } from "../i18n.js";
// play.js — the delve: canvas map, combat HUD, log, chat
import { api } from '../api.js';
import { esc, toast, state as appState, charObjective, campaignObjective } from '../app.js';
import { createMapRenderer } from '../map.js';
import { createMap3D, map3DResources } from '../map3d.js';
import { openSettingsModal } from './settings.js';
import { createPanels } from './play/panels.js';
import { createDelveTutorial } from './play/tutorial.js';
import { createDelveInventory } from './play/delve-inventory.js';
import { renderInitiativeRibbon } from './play/ribbon.js';
import { showDice } from '../dice.js';
import { sfx } from '../sfx.js';
import { tts } from '../tts.js';
import { initTooltips } from '../tooltip.js';
import { openLevelUpModal } from './levelup.js';
import { createPanelManager } from './play/panel-manager.js';
import { patchHud } from './play/hud-patch.js';
import { dismissModal } from '../modal.js';
import { createAdventureDirectory } from '../adventure-directory.js';
import { createFullscreenControls } from '../fullscreen.js';
import { packVisualFactory } from '../visual-packs.js';

// Level-up readiness comes from the server (game.levelUp) so the badge can never claim a
// level the level-up endpoint would refuse — see engine.levelUpInfo.

let game = null;
let selectedTarget = null;
/** @type {{ id: string, name: string, nameDisplay?: any } | null} */
let activeNpc = null;
let appearanceShown = null;
let appearanceLoading = null; // monsterId/npcId whose describe is waiting on the DM right now
// portrait cache is keyed by creature id and lives OUTSIDE the game object: an adopted
// state (server snapshot) never carries client-side caches, so keeping it on `game` would
// wipe the rendered portrait on every poll/act (T2 aux-display fix)
const portraitCache = {};
let summaryShown = false;
let questObjectiveFolded = false;
let pendingClarification = null;
let pendingConfirmation = null;
// last tile whose shared-object selection we cycled (click path in handleTileClick);
// module-level like the rest of the click state, reset by the next different tile
const tilePick = { key: '', idx: 0 };
// one token per playView mount — async callbacks drop their result when a newer view took
// over, so a response for save A can never land in a page that already shows save B (T2a)
let viewToken = 0;

// T2/T2a: the single gate for adopting a whole server state. Rejects a different save's
// snapshot and anything older than what is already on screen; the auxiliary result itself
// (appearance text, portrait) displays regardless. Equal rev is fine (a fresh GET of the
// same save). The initial load of a view assigns `game` directly — that is the
// initialization boundary, everything after it must go through here.
function adoptState(next) {
  if (!next || !game) return false;
  if (next.id !== game.id) return false;
  if ((next.rev || 0) < ((game && game.rev) || 0)) return false;
  game = next;
  // Entity selection follows its stable ID across confirmed snapshot replacement.
  // Keep the HUD/reticle consistent with the same entity the visual synchronizes.
  if (selectedTarget?.kind) selectedTarget=game.entities.find(e=>e.id===selectedTarget.id)||selectedTarget;
  return true;
}

/** @param {import('../navigation.js').Navigation} navigation */
export async function playView(main, saveRef, navigation) {
  const token = ++viewToken;
  summaryShown = false;
  let viewAlive = true; // async callbacks stop adopting once the view ended (T2a)
  navigation.onDispose(() => {
    viewAlive = false;
    if (token === viewToken) viewToken++;
  });
  let busy = false; // an old view's pending choice cannot lock/unlock another hero's view
  // Start a fresh delve: show the setup modal (map + difficulty + companion)
  if (saveRef === 'new') {
    const charId = new URLSearchParams(location.hash.split('?')[1] || '').get('char');
    if (!charId) { location.hash = '#/'; return undefined; }
    let char = null;
    try { char = await api.getCharacter(charId); } catch {}
    if (!navigation.isCurrent()) return undefined;
    if (!char) { location.hash = '#/'; return undefined; }
    const rules = appState.rules;
    let maps = [];
    try { maps = (await api.content()).adventures || []; } catch (error) { if (navigation.isCurrent()) toast(() => error.message); }
    if (!navigation.isCurrent()) return undefined;
    main.innerHTML = `
      <div class="modal-back" style="position:static; background:none; display:block; padding-top:30px;">
        <div class="modal" style="max-width:680px; margin:0 auto;">
          <h2>${label("ui.play.prepare_the_delve")}</h2>
          <p class="muted small">${label("ui.play.gathers_supplies_choose_where_to_descend_values", {p1: char ? char.name : t("ui.play.your_hero")})}</p>
          <div class="card" style="margin:12px 0;" data-prepare-adventures></div>
          <div class="card" style="margin:12px 0;">
            <h3>${label("ui.play.difficulty")}</h3>
            ${Object.entries(rules.difficulty || {}).map(([id, d]) => `
              <label style="display:block; margin:8px 0; color:var(--text);">
                <input type="radio" name="difficulty" value="${id}" ${id === 'normal' ? 'checked' : ''} style="width:auto">
                <b>${displayLabel(d.labelDisplay, d.label)}</b> <span class="muted small">— ${displayLabel(d.blurbDisplay, d.blurb)}</span>
              </label>`).join('')}
          </div>
          <div class="card" style="margin:12px 0;">
            <h3 style="margin-top:0;">${label("ui.play.mercenary_companion")}</h3>
            ${((rules.allies && rules.allies.length) ? rules.allies : [{ id: 'bram', name: 'Bram the Scout', role: 'Ranger / Archer', icon: '🏹', blurb: 'A wiry hunter who strikes from the dark with a longbow.' }]).map((a, i) => `
              <label style="display:block; margin:8px 0; color:var(--text); cursor:pointer;">
                <input type="radio" name="companionPick" value="${a.id}" ${i === 0 ? 'checked' : ''} style="width:auto">
                ${a.icon || '🏹'} <b>${contentLabel(a,"name")}</b> <span class="chip blue" style="font-size:11px; padding:1px 6px;">${displayLabel(a.roleDisplay,a.role || t("ui.play.companion"))}</span>
                <div class="muted small" style="margin-left:22px;">${displayLabel(a.blurbDisplay,a.blurb || '')}</div>
              </label>`).join('')}
            <label style="display:block; margin:8px 0; color:var(--text); cursor:pointer;">
              <input type="radio" name="companionPick" value="none" style="width:auto">
              👤 <b>${label("ui.play.solo_expedition")}</b> <span class="muted small">${label("ui.play.brave_the_crypt_alone_hardcore_challenge")}</span>
            </label>
          </div>
          <button class="btn primary big" id="beginBtn" style="width:100%;">${label("ui.play.descend")}</button>
          <p class="small" data-companion-note role="alert" hidden style="margin-top:8px; color:#e8b26a;"></p>
          <p class="small" data-history-note role="status" hidden style="margin-top:8px; color:#8ab4f8;"></p>
        </div>
      </div>`;
    const beginBtn = /** @type {HTMLButtonElement} */ (document.getElementById('beginBtn'));
    const companionNote = main.querySelector('[data-companion-note]');
    const historyNote = main.querySelector('[data-history-note]');
    const directory = createAdventureDirectory(main.querySelector('[data-prepare-adventures]'), {
      entries: maps, selectedId: maps[0]?.id, onSelect: () => syncCompanionRequirement(), onRefresh: refreshDirectory
    });
    navigation.onDispose(directory.dispose);
    // T12a: companion stories gate the descent on the real ally — visible reason,
    // no guessing why the button is dark, and the server still enforces the rule.
    function syncCompanionRequirement() {
      const selection = directory.getSelection();
      const need = selection?.requiresCompanion || null;
      const picked = (/** @type {HTMLInputElement} */ (document.querySelector('input[name="companionPick"]:checked')) || {}).value || 'bram';
      const blocked = !!need && picked !== need;
      beginBtn.disabled = !selection || blocked;
      if (companionNote) {
        companionNote.hidden = !blocked;
        if (blocked) companionNote.textContent = t('ui.play.requires_companion', { name: selection.requiresCompanionName ? contentText(selection, 'requiresCompanionName') : selection.requiresCompanion });
      }
      if (historyNote) {
        if (selection?.requiresHistory) {
          const targetStory = selection.requiresHistory.storyId;
          const hasHistory = (char?.settlements || []).some(s => s.mode === 'victory' && (s.encounterFacts || []).some(f => f.storyId === targetStory && f.ending))
            || (char?.encounterFacts || []).some(f => f.storyId === targetStory && f.ending);
          historyNote.hidden = !!hasHistory;
          if (!hasHistory) historyNote.textContent = t('ui.play.no_history_notice');
        } else {
          historyNote.hidden = true;
        }
      }
    }
    syncCompanionRequirement();
    main.querySelectorAll('input[name="companionPick"]').forEach(input => input.addEventListener('change', syncCompanionRequirement));
    async function refreshDirectory() {
      directory.setDisabled(true);
      beginBtn.disabled = true;
      const previous = directory.getSelection()?.id;
      try {
        const result = await api.content();
        if (!navigation.isCurrent()) return;
        const selected = directory.setEntries(result.adventures || []);
        toast(() => t(previous && previous !== selected?.id ? 'adventure.removed' : 'adventure.updated'));
      } catch (error) { if (navigation.isCurrent()) toast(() => error.message); }
      finally { if (navigation.isCurrent()) { directory.setDisabled(false); syncCompanionRequirement(); } }
    }
    beginBtn.addEventListener('click', async () => {
      if (beginBtn.disabled) return;
      const mapId = directory.getSelection()?.mapId;
      if (!mapId) return;
      const difficulty = /** @type {'easy' | 'normal' | 'hard'} */ ((/** @type {HTMLInputElement} */ (document.querySelector('input[name="difficulty"]:checked') || {})).value || 'normal');
      const companionChoice = (/** @type {HTMLInputElement} */ (document.querySelector('input[name="companionPick"]:checked') || {})).value || 'bram';
      const bringAlly = /** @type {false | 'bram' | 'valeria' | 'aldous'} */ (companionChoice === 'none' ? false : companionChoice);
      beginBtn.disabled = true;
      directory.setDisabled(true);
      localizeText(beginBtn, () => t("ui.play.descending"));
      try {
        const { state } = await api.startGame(charId, { bringAlly, difficulty, mapId });
        if (!navigation.isCurrent()) return;
        location.hash = `#/play/${state.id}`;
      } catch (e) {
        if (!navigation.isCurrent()) return;
        toast(() => e.message);
        beginBtn.disabled = false;
        directory.setDisabled(false);
        localizeText(beginBtn, () => t("ui.play.descend"));
        if (e.display?.key === 'api.unknownMap') await refreshDirectory();
      }
    });
    return navigation.onDispose(onLocaleChange(() => { translateDOM(main); directory.refreshLocale(); }));
  }
  const data = await api.getGame(saveRef);
  // initialization boundary: the only place a whole state is assigned without the rev/id
  // gate — a newer view may have mounted while this GET was in flight, in which case we
  // stand down and leave the board alone (T2a)
  if (!navigation.isCurrent() || token !== viewToken) return undefined;
  game = data.state;
  let visualCatalog=null;
  try{visualCatalog=await api.visuals();}catch(error){console.warn('Visual catalog unavailable; using procedural models',error);}
  if(!navigation.isCurrent()||token!==viewToken)return undefined;
  const mapTheme = (game.map && game.map.theme) || (game.mapId && game.mapId.includes('vault') ? 'vault' : game.mapId && game.mapId.includes('hills') ? 'hills' : 'crypt');
  if (game.mode === 'combat') {
    sfx.startAmbient('combat');
  } else {
    sfx.startAmbient(mapTheme);
  }
  selectedTarget = null; activeNpc = null; appearanceShown = null;
  pendingClarification = null; pendingConfirmation = null;

  main.innerHTML = `
    <div class="play-layout">
      ${game.isPlaytest ? `
        <div class="playtest-banner" style="grid-column:1 / -1; background:#3b1e54; color:#f3e8ff; padding:8px 110px 8px 16px; display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #7c3aed; z-index:100; font-size:13px; font-weight:500;">
          <span>🛠️ <b>${label("ui.play.playtest_mode")}</b> · ${label("ui.play.playtest_isolated_notice")}</span>
          <a href="#/author?draft=${esc(game.ownerDraftId || '')}" data-exit-playtest class="btn small" style="background:#6d28d9; color:#fff; border:1px solid #a78bfa; text-decoration:none;">${label("ui.play.exit_playtest")}</a>
        </div>
      ` : ''}
      <button class="btn small" id="immersiveBtn" data-i18n-title="ui.play.immersive_mode_hide_the_top_bar_maximize" title="${esc(t("ui.play.immersive_mode_hide_the_top_bar_maximize"))}">${label("ui.play.immersive")}</button>
      <button class="btn small" id="pauseMenuBtn" data-i18n-title="ui.play.menu_esc" title="${esc(t("ui.play.menu_esc"))}">${label("ui.play.menu")}</button>
      <button class="btn small" id="sidePanelBtn" data-i18n-title="ui.play.toggle_the_side_panel_overlay" title="${esc(t("ui.play.toggle_the_side_panel_overlay"))}">${label("ui.play.panel")}</button>
      <button class="btn small" id="fullscreenBtn" type="button" data-app-fullscreen>${label('ui.fullscreen.enter')}</button>
        <div class="pause-menu hidden" id="pauseMenu">
          <div class="pause-menu-card">
            <h3>${label("ui.play.paused")}</h3>
            ${game.isPlaytest ? `<a href="#/author?draft=${esc(game.ownerDraftId || '')}" data-exit-playtest style="color:#c084fc; font-weight:bold;">🛠️ ${label("ui.play.exit_playtest")}</a>` : ''}
            <a href="#/">${label("ui.play.characters")}</a>
            <a href="#/visuals">${label('visual.title')}</a>
            <a href="#/overworld">${label("ui.play.overworld")}</a>
            <a href="#/create">${label("ui.play.create_character")}</a>
            <button id="pauseSettingsBtn">${label("ui.play.settings")}</button>
            <button id="pauseExitImmersive">${label("ui.play.exit_immersive")}</button>
            <button type="button" data-app-fullscreen>${label('ui.fullscreen.enter')}</button>
          </div>
        </div>
        <div id="questTrackerHost" class="hidden"></div>
      <div class="map-main">
        <div class="map-wrap" id="mapWrap">
          <div id="map3d"></div>
          
          <!-- 2D Minimap (Corner overlay in 3D mode, full in 2D mode) -->
          <div id="minimapContainer" class="minimap-container">
            <div class="minimap-header">
              <span class="minimap-title">🧭 ${contentLabel(game,"mapName")}</span>
              <div class="minimap-controls">
                <button class="minimap-btn" id="cameraFollowBtn" data-i18n-title="ui.play.camera_follows_your_hero_click_for_a" title="${esc(t("ui.play.camera_follows_your_hero_click_for_a"))}">${label("ui.play.follow")}</button>
                <button class="minimap-btn" id="minimapExpandBtn" data-i18n-title="ui.play.toggle_minimap_size" title="${esc(t("ui.play.toggle_minimap_size"))}">⤢</button>
                <button class="minimap-btn" id="viewToggleMinimap" data-i18n-title="ui.play.switch_to_full_2d_view" title="${esc(t("ui.play.switch_to_full_2d_view"))}">${label("ui.play.2d_full")}</button>
              </div>
            </div>
            <div class="minimap-body">
              <canvas id="mapCanvas"></canvas>
            </div>
          </div>

          <div id="fctLayer" class="fct-layer"></div>
          <div class="map-top-hud" id="mapTopHud">
          <div id="heroHud" class="hero-hud"></div>
          <div class="delve-guidance-hud" id="delveGuidanceHud">
            <div class="guidance-main-row">
              <div class="guidance-status-group">
                <span class="guidance-mode-pill" id="guidanceModePill">${label("ui.play.exploration")}</span>
                <span class="guidance-movement-pill" id="guidanceMovementPill">${label("ui.play.30_ft_6_tiles")}</span>
                <span class="guidance-objective-pill" id="guidanceObjectivePill">🎯 ${esc(charObjective(game))}</span>
              </div>
            </div>
            <div class="guidance-hover-bar" id="guidanceHoverBar">
              <span class="guidance-hover-icon" id="guidanceHoverIcon">💡</span>
              <span class="guidance-hover-text" id="guidanceHoverText">${label("ui.play.click_a_highlighted_tile_to_move_click")}</span>
            </div>
          </div>
          <div class="initiative-ribbon-container" id="initiativeRibbonContainer" style="display:none;"></div>
          <div id="encounterTools" class="encounter-tools"></div>
          </div>
          <div id="coreHud" class="core-hud"></div>
          <button class="btn small" id="viewToggle2D" style="display:none; position:absolute; top:8px; right:10px; z-index:30;">${label("ui.play.3d_view")}</button>
        </div>
        <div class="log-panel" id="logPanel">
          <button class="btn small log-min-btn" id="logMinBtn" data-i18n-title="ui.play.minimize_expand_the_log" title="${esc(t("ui.play.minimize_expand_the_log"))}">▼</button>
          <div class="log-entries" id="logEntries"></div>
          <div class="chat-bar">
            <input type="text" id="chatInput" placeholder="${esc(activeNpc ? t("ui.play.speakTo", { name: (activeNpc.nameDisplay || activeNpc.name) }) : t("ui.play.describe_an_action_search_the_room_listen"))}">
            <button class="btn primary" id="chatSend">${label("ui.play.send")}</button>
            ${activeNpc ? `<button class="btn small" id="chatExit">${label("ui.play.end_chat")}</button>` : ''}
          </div>
        </div>
      </div>
      <div class="side-panel" id="sidePanel"></div>
      <button id="logPreview" class="log-preview" data-panel="log" aria-expanded="false"></button>
      <nav class="delve-tools" data-i18n-aria-label="ui.layout.tools" aria-label="${esc(t('ui.layout.tools'))}">
        <button class="btn small" data-panel="character">${label('ui.layout.character')}</button>
        <button class="btn small" data-panel="inventory">${label('ui.layout.backpack')}</button>
        <button class="btn small" data-panel="quests">${label('ui.layout.quests')}</button>
        <button class="btn small" data-panel="log">${label('ui.layout.log')}</button>
        <button class="btn small" data-panel="chat">${label('ui.layout.chat')}</button>
      </nav>
      <section id="delvePanel" class="delve-panel" hidden data-i18n-aria-label="ui.layout.panel" aria-label="${esc(t('ui.layout.panel'))}">
        <header><span>${label('ui.layout.panel')}</span><button class="btn small" id="delvePanelClose" data-i18n-aria-label="ui.layout.close" aria-label="${esc(t('ui.layout.close'))}">✕</button></header>
        <div class="delve-panel-content"></div>
      </section>
    </div>
  `;

  function computeReachableTiles(g) {
    if (!g || !g.map) return [];
    const p = (g.entities || []).find(e => e.kind === 'player');
    if (!p) return [];
    const maxTiles = g.mode === 'combat'
      ? Math.max(0, Math.floor((g.combat?.movementLeft ?? 30) / 5))
      : Math.max(1, Math.floor((p.speedFt || g.character?.speedFt || 30) / 5));
    if (maxTiles <= 0) return [];

    const map = g.map;
    const disc = new Set(g.discovered || []);
    const queue = [{ x: p.x, y: p.y, dist: 0 }];
    const visited = new Map();
    visited.set(p.x + ',' + p.y, 0);

    const blockingObjs = new Set();
    (g.objects || []).forEach(o => {
      if (o.type === 'door' && !o.open) blockingObjs.add(o.x + ',' + o.y);
      if (o.type === 'barrel' && !o.exploded) blockingObjs.add(o.x + ',' + o.y);
    });

    const blockingEnemies = new Set();
    (g.entities || []).forEach(e => {
      if (e.kind === 'monster' && e.alive !== false) blockingEnemies.add(e.x + ',' + e.y);
    });

    const res = [];
    while (queue.length) {
      const { x, y, dist } = queue.shift();
      if (dist > 0) res.push(x + ',' + y);
      if (dist >= maxTiles) continue;

      const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        const nkey = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        if (!disc.has(nkey)) continue;
        if (map.rows[ny] && map.rows[ny][nx] === '#') continue;
        if (blockingObjs.has(nkey)) continue;
        if (blockingEnemies.has(nkey)) continue;

        const newDist = dist + 1;
        if (!visited.has(nkey) || visited.get(nkey) > newDist) {
          visited.set(nkey, newDist);
          queue.push({ x: nx, y: ny, dist: newDist });
        }
      }
    }
    return res;
  }

  function isAreaCleared(g) {
    if (!g) return false;
    if (g.mode === 'victory' || g.mode === 'retreat' || (g.flags && g.flags.victory)) return true;
    const mons = (g.entities || []).filter(e => e.kind === 'monster' && e.alive !== false);
    return mons.length === 0;
  }

  // T4a: the retreat button must not claim completion — standing on the campfire tile with
  // the goal is what fires the victory (story advance); a retreat only settles current spoils.
  function retreatButtonKey() {
    if (game.mode === 'retreat' || game.mode === 'victory') return "ui.play.view_summary_return_to_town";
    if (game.guidance && game.guidance.stage === 'objective') return "ui.play.retreat_early_walk_to_campfire_for_victory";
    if (isAreaCleared(game)) return "ui.play.retreat_settle_current_gains_only";
    return "ui.play.retreat_to_oakhaven";
  }
  // the exit beacon highlights a safe way out; with the goal in hand the way forward is the
  // campfire, so the beacon yields to the objective guidance
  function retreatBeacon() {
    return game.mode !== 'retreat' && game.mode !== 'victory'
      && isAreaCleared(game) && !(game.guidance && game.guidance.stage === 'objective');
  }

  let currentHoverTile = null;
  function updateHoverCues(tile) {
    currentHoverTile = tile;
    const modePill = document.getElementById('guidanceModePill');
    const movePill = document.getElementById('guidanceMovementPill');
    const objPill = document.getElementById('guidanceObjectivePill');
    const hoverIcon = document.getElementById('guidanceHoverIcon');
    const hoverText = document.getElementById('guidanceHoverText');
    if (!modePill || !hoverText || !game) return;

    const cleared = isAreaCleared(game);

    if (game.mode === 'combat') {
      const myTurn = !game.combat || game.combat.order[game.combat.turnIdx]?.id === 'player';
      if (myTurn) {
        modePill.className = 'guidance-mode-pill combat-player';
        localizeText(modePill, () => t('ui.play.yourRound', { round: game.combat.round }));
      } else {
        modePill.className = 'guidance-mode-pill combat-enemy';
        localizeText(modePill, () => t('ui.play.enemyRound', { round: game.combat.round }));
      }
      const mvLeft = game.combat?.movementLeft ?? 0;
      localizeText(movePill, () => t('ui.play.movement', { ft: mvLeft, tiles: Math.floor(mvLeft / 5) }));
    } else if (game.mode === 'over') {
      modePill.className = 'guidance-mode-pill combat-enemy';
      localizeText(modePill, () => t("ui.play.defeated"));
      movePill.textContent = '👣 0 ft';
    } else if (game.mode === 'victory') {
      modePill.className = 'guidance-mode-pill';
      localizeText(modePill, () => t("ui.play.victorious"));
      localizeText(movePill, () => t("ui.play.complete"));
    } else if (game.guidance && game.guidance.stage === 'objective') {
      // goal in hand but still explore: the victory fires on the campfire tile, not before
      modePill.className = 'guidance-mode-pill';
      modePill.style.background = 'rgba(201, 169, 89, 0.25)';
      modePill.style.color = 'var(--gold)';
      modePill.style.borderColor = 'var(--gold)';
      localizeText(modePill, () => t("ui.play.goal_secured"));
      const sp = player()?.speedFt || game.character?.speedFt || 30;
      localizeText(movePill, () => t('ui.play.movement', { ft: sp, tiles: Math.floor(sp / 5) }));
    } else if (cleared) {
      // cleared ≠ victory — the goal may still be pending, so don't claim the delve is done
      modePill.className = 'guidance-mode-pill';
      modePill.style.background = 'rgba(201, 169, 89, 0.25)';
      modePill.style.color = 'var(--gold)';
      modePill.style.borderColor = 'var(--gold)';
      localizeText(modePill, () => t("ui.play.area_safe"));
      const sp = player()?.speedFt || game.character?.speedFt || 30;
      localizeText(movePill, () => t('ui.play.movement', { ft: sp, tiles: Math.floor(sp / 5) }));
    } else {
      modePill.className = 'guidance-mode-pill';
      modePill.style.background = '';
      modePill.style.color = '';
      modePill.style.borderColor = '';
      localizeText(modePill, () => t("ui.play.exploration"));
      const sp = player()?.speedFt || game.character?.speedFt || 30;
      localizeText(movePill, () => t('ui.play.movement', { ft: sp, tiles: Math.floor(sp / 5) }));
    }

    if (objPill) {
      const mainStep = campaignObjective(game);
      const guide = game.guidance || null;
      if (guide && guide.objective) {
        // the server's deterministic objective line leads (T4): it knows goal-vs-cleared
        // and the return-to-camp prompt without re-deriving map rules in the client
        localizeText(objPill, () => displayText(game.guidance.objectiveDisplay, game.guidance.objective));
      } else if (cleared && game.mode !== 'over') {
        objPill.innerHTML = `🌟 <b>${label("ui.play.delve_cleared")}</b> ${label("ui.play.backToCamp")}`;
      } else if (mainStep) {
        // the main story takes precedence over the local dungeon objective
        objPill.innerHTML = `📜 <b>${esc(game.campaign.actName || t("ui.play.main_story"))}</b> ${contentLabel(mainStep,"text")}`;
      } else {
        objPill.textContent = `🎯 ${charObjective(game)}`;
      }
    }

    if (!tile) {
      hoverIcon.textContent = '💡';
      if (game.guidance && game.guidance.hint) {
        localizeText(hoverText, () => displayText(game.guidance.hintDisplay, game.guidance.hint));
      } else if (cleared && game.mode !== 'combat' && game.mode !== 'over') {
        hoverIcon.textContent = '🌟';
        hoverText.innerHTML = `<b>${label("ui.play.delve_cleared_2")}</b> ${label("ui.play.all_monsters_slain_follow_the_golden_beacon")} <b>${label("ui.play.return_to_oakhaven")}</b>.`;
      } else if (game.mode === 'combat') {
        const myTurn = !game.combat || game.combat.order[game.combat.turnIdx]?.id === 'player';
        hoverText.innerHTML = myTurn
          ? `<b>${label("ui.play.your_turn")}</b> ${label("ui.play.click_a_blue_tile_to_move_click")} <span class="guidance-action-key">${label("ui.play.space")}</span> ${label("ui.play.endTurnHelp")}`
          : t("ui.play.enemies_are_currently_executing_their_actions");
      } else {
        hoverText.innerHTML = label("ui.play.moveHelp");
      }
      return;
    }

    const { x, y } = tile;
    const vis = new Set(game.visible || []);
    const isLit = vis.has(x + ',' + y);
    const p = player();

    const ent = (game.entities || []).find(e => e.x === x && e.y === y && e.alive !== false);
    if (ent && ent.kind === 'monster' && isLit) {
      hoverIcon.textContent = '⚔️';
      const dist = p ? Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) : 99;
      const inMelee = dist <= 1;
      hoverText.innerHTML = `<b>${contentLabel(ent,"name")}</b> (${ent.hp}/${ent.hpMax} HP, AC ${ent.ac || 10}) — ${inMelee ? `${label("ui.play.meleeRange")} <b>${label("ui.play.click_to_target_attack")}</b>` : `${label("ui.play.distance", { ft: dist * 5 })} <b>${label("ui.play.click_to_target")}</b>`}`;
      return;
    }

    if (ent && ent.kind === 'npc' && isLit) {
      hoverIcon.textContent = '🗣️';
      hoverText.innerHTML = `<b>${contentLabel(ent,"name")}</b> — ${label("ui.play.talkTrade")}`;
      return;
    }

    if (ent && ent.kind === 'ally') {
      hoverIcon.textContent = '🏹';
      hoverText.innerHTML = `<b>${contentLabel(ent,"name")}</b> (${ent.hp}/${ent.hpMax} HP) — ${label("ui.play.companion")}`;
      return;
    }

    const obj = (game.objects || []).find(o => o.x === x && o.y === y && o.type !== 'npcMarker');
    if (obj && isLit) {
      const dist = p ? Math.abs(p.x - x) + Math.abs(p.y - y) : 99;
      if (obj.type === 'door') {
        hoverIcon.textContent = '🚪';
        hoverText.innerHTML = `<b>${label("ui.play.door")} (${obj.open ? label("ui.play.open") : label("ui.play.closed")})</b> — ${dist <= 1 ? label("ui.play.click_to_open_close") : label("ui.play.move_closer_to_open")}`;
        return;
      }
      if (obj.type === 'chest') {
        hoverIcon.textContent = '🧰';
        if (obj.looted) hoverText.innerHTML = `<b>${label("ui.play.empty_chest")}</b> (${label("ui.play.looted")})`;
        else if (obj.locked && !obj.unlocked) hoverText.innerHTML = `<b>${label("ui.play.locked_chest")}</b> — ${dist <= 1 ? label("ui.play.click_to_pick_lock_or_force_open") : label("ui.play.move_closer_to_unlock")}`;
        else hoverText.innerHTML = `<b>${label("ui.play.unlocked_chest")}</b> — ${dist <= 1 ? label("ui.play.click_to_open_loot") : label("ui.play.move_closer_to_loot")}`;
        return;
      }
      if (obj.type === 'barrel') {
        hoverIcon.textContent = '🛢️';
        hoverText.innerHTML = obj.exploded ? `<b>${label("ui.play.shattered_barrel")}</b>` : `<b>${label("ui.play.explosive_powder_keg")}</b> — ${label("ui.play.detonate")}`;
        return;
      }
      if (obj.type === 'trap') {
        hoverIcon.textContent = '⚠️';
        hoverText.innerHTML = `<b>${label("ui.play.concealed_trap")}</b> — ${dist <= 1 ? label("ui.play.click_to_disarm_dc") + (obj.dc || 12) + ')' : label("ui.play.hazardous_mechanism")}`;
        return;
      }
      if (obj.type === 'font') {
        hoverIcon.textContent = '⛲';
        hoverText.innerHTML = `<b>${label("ui.play.ancient_shrine_font")}</b> — ${obj.used ? label("ui.play.depleted") : label("ui.play.click_to_drink_receive_blessing")}`;
        return;
      }
      if (obj.type === 'lever') {
        hoverIcon.textContent = '🕹️';
        hoverText.innerHTML = `<b>${label("ui.play.iron_lever")}</b> — ${label("ui.play.pull")}`;
        return;
      }
      if (obj.type === 'stairs') {
        hoverIcon.textContent = '🪜';
        hoverText.innerHTML = `<b>${label("ui.play.stone_stairway")}</b> — ${label("ui.play.descend")}`;
        return;
      }
    }

    const rSet = new Set(game.reachableTiles || []);
    if (rSet.has(x + ',' + y)) {
      hoverIcon.textContent = '👣';
      const steps = p ? Math.abs(x - p.x) + Math.abs(y - p.y) : 0;
      hoverText.innerHTML = `<b>${label("ui.play.move_to_values", {p0: x, p1: y})}</b> ${label("ui.play.ft_tiles_values", {p2: steps * 5, p3: steps})} <b>${label("ui.play.click_to_move")}</b>`;
      return;
    }

    if (game.map?.rows[y]?.[x] === '#') {
      hoverIcon.textContent = '🧱';
      hoverText.innerHTML = `<b>${label("ui.play.dungeon_wall")}</b> — ${label("ui.play.wall")}`;
      return;
    }

    hoverIcon.textContent = '🚫';
    hoverText.innerHTML = `<b>${label("ui.play.tile_values", {p0: x, p1: y})}</b> — ${label("ui.play.outOfRange")}`;
  }

  const panelManager = createPanelManager(main, () => delveInv.openDelveInventoryModal());
  createFullscreenControls(main, navigation, toast);
  let mapFirst = localStorage.getItem('dnd_delve_layout') !== 'tactical';
  function applyLayout() {
    document.body.classList.toggle('immersive', mapFirst);
    document.body.classList.toggle('map-first', mapFirst);
    panelManager.layout(mapFirst);
    relayoutTutorial();
    const btn = document.getElementById('immersiveBtn');
    localizeText(btn, () => t(mapFirst ? 'ui.layout.tactical' : 'ui.layout.mapFirst'));
    localizeText(document.getElementById('pauseExitImmersive'), () => t(mapFirst ? 'ui.layout.tactical' : 'ui.layout.mapFirst'));
    window.dispatchEvent(new Event('resize'));
  }
  applyLayout();
  function relayoutTutorial() {
    const coach = main.querySelector('.delve-tutorial-card');
    if (coach) main.querySelector(mapFirst ? '#mapTopHud' : '.play-layout').appendChild(coach);
  }
  // The former immersive shortcut now selects the same persisted layout.
  function toggleImmersive() {
    if (panelManager.blocked()) return;
    mapFirst = !mapFirst;
    localStorage.setItem('dnd_delve_layout', mapFirst ? 'map-first' : 'tactical');
    applyLayout();
    // Movers change containers on a layout toggle — rebuild the HUD the plain way
    // (no press can be in flight: the toggle click itself just completed).
    renderSide(true);
    relayoutQuestTracker();
  }
  // HUD layout: in immersive mode the quest tracker lives top-left as its own overlay
  function relayoutQuestTracker() {
    const host = document.getElementById('questTrackerHost');
    if (!host) return;
    const card = document.querySelector('.quest-objective-card'); // wherever it currently lives
    if (document.body.classList.contains('immersive')) {
      if (card) host.appendChild(card); // live node move — fold listeners stay wired
      host.classList.remove('hidden');
    } else {
      const sp = document.getElementById('sidePanel');
      if (card && sp && !sp.contains(card)) sp.appendChild(card);
      host.classList.add('hidden');
    }
  }

  const immersiveBtn = document.getElementById('immersiveBtn');
  if (immersiveBtn) immersiveBtn.onclick = toggleImmersive;
  const sidePanelBtn = document.getElementById('sidePanelBtn');
  if (sidePanelBtn) sidePanelBtn.onclick = () => {
    panelManager.open('character', sidePanelBtn);
  };
  function togglePauseMenu() {
    panelManager.togglePause();
  }
  const pauseMenuBtn = document.getElementById('pauseMenuBtn');
  if (pauseMenuBtn) pauseMenuBtn.onclick = togglePauseMenu;
  const pauseSettingsBtn = document.getElementById('pauseSettingsBtn');
  if (pauseSettingsBtn) pauseSettingsBtn.onclick = () => { togglePauseMenu(); openSettingsModal(); };
  const pauseExitImmersive = document.getElementById('pauseExitImmersive');
  if (pauseExitImmersive) pauseExitImmersive.onclick = () => { document.getElementById('pauseMenu').classList.add('hidden'); toggleImmersive(); };
  // Exiting a playtest is a server-side release of the temporary run, not just a hash change:
  // the anchor keeps its href so it degrades to plain navigation if the request never lands.
  main.querySelectorAll('[data-exit-playtest]').forEach(link => {
    link.addEventListener('click', async event => {
      if (!game.isPlaytest || !game.ownerDraftId || !game.id) return;
      event.preventDefault();
      const target = link.getAttribute('href') || '#/author';
      let failure = null;
      try { await api.exitPlaytest(game.ownerDraftId, game.id); }
      catch (error) { failure = error; }
      location.hash = target;
      if (failure) toast(() => `${t('ui.play.exit_playtest_failed')}: ${failure.message}`);
    });
  });
  const logMinBtn = document.getElementById('logMinBtn');
  if (logMinBtn) logMinBtn.onclick = () => {
    const lp = document.getElementById('logPanel');
    if (lp) lp.classList.toggle('log-min');
    logMinBtn.textContent = lp && lp.classList.contains('log-min') ? '▲' : '▼';
  };

  const canvas = document.getElementById('mapCanvas');
  const renderer = createMapRenderer(canvas, {
    isSelected: e => selectedTarget && e.id === selectedTarget.id,
    onTileHover: entryText => updateHoverCues(entryText)
  });
  let renderer3d = null;
  // Default to 3D mode unless explicitly configured otherwise
  const viewPref = localStorage.getItem('dnd_default_view') || localStorage.getItem('dnd_3d');
  let activeView = (viewPref === '2d' || viewPref === 'off') ? '2d' : '3d';

  function toggleView() {
    activeView = activeView === '3d' ? '2d' : '3d';
    localStorage.setItem('dnd_3d', activeView === '3d' ? 'on' : 'off');
    localStorage.setItem('dnd_default_view', activeView);
    if (game) activeRender(game);
  }

  const vt2D = document.getElementById('viewToggle2D');
  if (vt2D) vt2D.onclick = toggleView;

  const vtMini = document.getElementById('viewToggleMinimap');
  if (vtMini) vtMini.onclick = toggleView;

  const mmExp = document.getElementById('minimapExpandBtn');
  if (mmExp) {
    mmExp.onclick = () => {
      const container = document.getElementById('minimapContainer');
      if (container) {
        container.classList.toggle('minimap-expanded');
        mmExp.textContent = container.classList.contains('minimap-expanded') ? '⤡' : '⤢';
        if (game) renderer.render(game);
      }
    };
  }

  // Camera binding: the view rides the hero by default; the button frees it so the
  // player can survey the map, and re-centres when switched back on.
  let camFollow = localStorage.getItem('dnd_cam_follow') !== 'off';
  const followBtn = document.getElementById('cameraFollowBtn');
  function renderFollowBtn() {
    if (!followBtn) return;
    const wrap = document.getElementById('mapWrap');
    if (wrap) wrap.dataset.camFollow = camFollow ? 'on' : 'off';
    localizeText(followBtn, () => camFollow ? t("ui.play.follow") : t("ui.play.free"));
    followBtn.classList.toggle('active', camFollow);
    localizeAttribute(followBtn, "title", () => camFollow
      ? t("ui.play.camera_is_bound_to_your_hero_click")
      : t("ui.play.free_camera_right_drag_to_pan_wheel"));
    followBtn.style.display = activeView === '3d' ? '' : 'none';
  }
  function setFollow(next) {
    camFollow = !!next;
    localStorage.setItem('dnd_cam_follow', camFollow ? 'on' : 'off');
    if (renderer3d) renderer3d.setFollow(camFollow);
    renderFollowBtn();
  }
  if (followBtn) {
    followBtn.onclick = () => setFollow(!camFollow);
  }
  renderFollowBtn();

  function activeRender(gameState) {
    const wrap = document.getElementById('mapWrap');
    const map3dEl = document.getElementById('map3d');
    const btn2D = document.getElementById('viewToggle2D');

    gameState.reachableTiles = computeReachableTiles(gameState);
    gameState.selectedTarget = selectedTarget;
    updateHoverCues(currentHoverTile);

    if (activeView === '3d') {
      if (!renderer3d) {
        renderer3d = createMap3D(map3dEl, {
          visualFactory:packVisualFactory(visualCatalog,game.characterId),
          onTileClick: (x, y) => handleTileClick(x, y),
          onTileHover: entryText => updateHoverCues(entryText),
          isSelected: e => selectedTarget && e.id === selectedTarget.id,
          getSelected: () => selectedTarget,
          follow: camFollow,
          onFollowChange: v => { camFollow = v; localStorage.setItem('dnd_cam_follow', v ? 'on' : 'off'); renderFollowBtn(); }
        });
      }
      renderFollowBtn();
      if (wrap) {
        wrap.classList.remove('view-2d');
        wrap.classList.add('view-3d');
      }
      if (map3dEl) map3dEl.style.display = 'block';
      if (btn2D) btn2D.style.display = 'none';
      renderer3d.render(gameState);
      // Simultaneously render the 2D map inside the live minimap!
      renderer.render(gameState);
    } else {
      if (wrap) {
        wrap.classList.remove('view-3d');
        wrap.classList.add('view-2d');
      }
      if (renderer3d && map3dEl) map3dEl.style.display = 'none';
      if (btn2D) btn2D.style.display = 'block';
      if (followBtn) followBtn.style.display = 'none';   // the 2D board always shows the whole map
      renderer.render(gameState);
    }
  }

  canvas.addEventListener('click', ev => {
    const entryText = renderer.tileFromEvent(ev);
    if (entryText) handleTileClick(entryText.x, entryText.y);
  });

  // Test seam: the e2e suite inspects camera binding and the board through here.
  window.__dndDebug = {
    camera: () => (renderer3d && renderer3d.debugState ? renderer3d.debugState() : null),
    follow: () => camFollow,
    boardCount: () => (game && game.entities ? game.entities.filter(e => e.kind === 'player' || (e.alive !== false && !e.fled)).length : 0),
    playerTile: () => { const p = player(); return p ? { x: p.x + 0.5, z: p.y + 0.5 } : null; },
    levelUp: () => (game && game.levelUp) || null,
    badgeShown: () => !!document.getElementById('btnDelveLevelUp'),
    modelState: () => (renderer3d && renderer3d.modelState ? renderer3d.modelState() : null),
    rev: () => (game && game.rev) || null,
    portraits: () => Object.assign({}, portraitCache),
    appearance: () => appearanceShown,
    loadingAppearance: () => appearanceLoading,
    panel: () => panelManager.current(),
    resources: () => map3DResources(),
    tileToScreen: (x, y) => renderer3d?.tileToScreen(x, y),
    visuals: () => renderer3d?.visualState(),
    setVisualFactory: factory => renderer3d?.setVisualFactory(factory),
    playVisual: (id,action,eventId) => renderer3d?.playVisual(id,action,eventId),
    // Test seam (H1): select a creature exactly like a map click would — same
    // selectedTarget/update/fetchAppearance flow — without depending on overlay
    // geometry (the initiative ribbon floats over mid-map tiles in the 2D board).
    target: (id) => {
      const ent = game.entities.find(e => e.id === id && e.alive !== false && !e.fled);
      if (!ent || ent.kind !== 'monster') return false;
      selectedTarget = ent;
      appearanceShown = (game.appearances || {})[getLocale()+':'+ent.monsterId] || null;
      update();
      fetchAppearance(ent);
      return true;
    },
    clarification: () => pendingClarification,
    confirmation: () => pendingConfirmation
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      panelManager.escape();
      return;
    }
    if (document.activeElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || document.activeElement.closest('[contenteditable="true"]'))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (panelManager.blocked()) return;
    if (['c', 'q', 'l', 't'].includes(e.key.toLowerCase()) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); panelManager.open({ c:'character', q:'quests', l:'log', t:'chat' }[e.key.toLowerCase()]); return;
    }
    if (e.key === 'v' || e.key === 'V') { e.preventDefault(); toggleImmersive(); return; }
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
    const d = dirs[e.key];
    if (d) {
      e.preventDefault();
      const p = player();
      act({ type: 'move', x: p.x + d[0], y: p.y + d[1] });
    }
    if (e.key === ' ' && game.mode === 'combat') { e.preventDefault(); act({ type: 'endTurn' }); }
    if (['1', '2', '3', '4', '5'].includes(e.key)) {
      const idx = parseInt(e.key, 10) - 1;
      useQuickSlot(idx);
    }
    if (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      const existing = document.getElementById('delveInventoryModal');
      if (existing) dismissModal(existing);
      else panelManager.open('inventory');
    }
    if ((e.key === 'f' || e.key === 'F') && activeView === '3d') {
      e.preventDefault();
      setFollow(!camFollow);
    }
  };
  document.addEventListener('keydown', onKey);

  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  async function sendChat() {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('chatInput'));
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const res = activeNpc ? await act({ type: 'chat', npcId: activeNpc.id, text }) : await act({ type: 'freeform', text });
    if (res && res.events && res.events.some(e => e.type === 'error') && !input.value) {
      input.value = text;
      input.focus();
    }
  }

  function player() { return game.entities.find(e => e.kind === 'player'); }

  function atCampfire() {
    const camp = (game.map.victory && game.map.victory.campfire) || game.map.victoryTile;
    const p = player();
    return camp && Math.abs(p.x - camp.x) <= 1 && Math.abs(p.y - camp.y) <= 1;
  }

  function atEntrance() {
    const start = game.map.playerStart;
    const p = player();
    return start && Math.abs(p.x - start.x) <= 1 && Math.abs(p.y - start.y) <= 1;
  }

  // Fetch (and cache server-side) a vivid appearance description for a monster/NPC
  async function fetchAppearance(ent) {
    const key = getLocale()+':'+(ent.kind === 'monster' ? ent.monsterId : ent.npcId);
    game.appearances = game.appearances || {};
    if (game.appearances[key]) { appearanceShown = game.appearances[key]; update(); } else {
      appearanceLoading = key; // waiting feedback while the DM studies the creature
      update();
      try {
        const res = await api.gameAction(game.id, { type: 'describe', targetId: ent.id });
        if (!viewAlive) return;
        adoptState(res.state); // a move during the wait is newer — never adopt the older snapshot
        appearanceLoading = null;
        appearanceShown = res.appearance || (game.appearances || {})[key] || null;
        update();
      } catch {
        appearanceLoading = null;
        update();
      } /* appearance is optional flavor */
    }
    fetchPortrait(ent);
  }

  // Fetch (and cache server-side) a painted portrait: AI image → SD WebUI → procedural sigil
  async function fetchPortrait(ent) {
    const key = ent.kind === 'monster' ? ent.monsterId : ent.npcId;
    if (portraitCache[key]) { update(); return; }
    try {
      const res = await api.gameAction(game.id, { type: 'portrait', targetId: ent.id });
      adoptState(res.state);
      if (res.portrait && res.portrait.url) {
        portraitCache[key] = res.portrait;
        update();
      }
    } catch (e) {
      console.error('portrait fetch failed:', e); /* portraits are optional flavor */
    }
  }

  // Marla's shop
// Shop / journal / skill-check / summary panels live in play/panels.js —
  // they read live state through getGame and dispatch through act.
  const panels = createPanels({
    getGame: () => game,
    act,
    onShopTalk: (merchantId, merchantName) => {
      activeNpc = { id: merchantId, name: merchantName };
      update();
      panelManager.open('chat');
    },
    onSummaryRespawn: () => { summaryShown = false; act({ type: 'respawn' }); },
    onSummaryLock: (locked) => panelManager.setLocked(locked)
  });

  // T5 first-delve coach: observes server state/events only — see views/play/tutorial.js
  const tutorial = createDelveTutorial();

  const SFX_MAP = {
    attack: 'attack', attack_in: 'attack', spell_hit: 'spell', cast_flavor: 'spell', save: 'dice',
    combat_start: 'dice', miss: 'miss', heal: 'heal', levelup: 'levelup', subclass: 'levelup',
    travel: 'travel_stairs', equip: 'equip', level_ready: 'levelup',
    quest_done: 'quest', quest_offer: 'quest', loot: 'coin', magic_item: 'coin', trap: 'trap',
    trap_spotted: 'trap', trap_disarmed: 'victory', trap_disarm_failed: 'trap',
    chest_unlocked: 'chest_open', chest_locked: 'miss',
    dying: 'death', player_down: 'death', victory: 'victory', door: 'door', blessing: 'heal',
    barrel_detonate: 'barrel_boom', hazard_burn: 'hazard_burn', stealth: 'stealth', retreat: 'retreat'
  };

  function showFloorBanner(title, subtitle) {
    const existing = document.querySelector('.floor-banner-overlay');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'floor-banner-overlay';
    banner.innerHTML = `
      <div class="floor-banner-frame">
        <div class="floor-banner-depth">${label("ui.play.depth_transition")}</div>
        <div class="floor-banner-title">${esc(title)}</div>
        <div class="floor-banner-sub">${esc(subtitle || 'The darkness recedes as you step deeper into the ancient chambers.')}</div>
      </div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 3600);
  }

  function updateInitiativeRibbon() {
    renderInitiativeRibbon(game, (ent) => {
      selectedTarget = ent;
      appearanceShown = (game.appearances || {})[getLocale()+':'+ent.monsterId] || null;
      update();
      sfx.play('dice');
    });
  }

  function spawnFloatingText(tileX, tileY, text, kind = 'damage') {
    const layer = document.getElementById('fctLayer');
    if (!layer || tileX == null || tileY == null) return;
    const r = (activeView === '3d' && renderer3d) ? renderer3d : renderer;
    if (!r || !r.tileToScreen) return;
    const pos = r.tileToScreen(tileX, tileY);
    if (!pos || (!pos.x && !pos.y && tileX !== 0 && tileY !== 0)) return;

    const offsetX = (Math.random() - 0.5) * 16;
    const offsetY = (Math.random() - 0.5) * 10;

    const el = document.createElement('div');
    el.className = `fct-popup fct-${kind}`;
    el.textContent = text;
    el.style.left = `${Math.round(pos.x + offsetX)}px`;
    el.style.top = `${Math.round(pos.y + offsetY)}px`;
    layer.appendChild(el);

    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1250);
  }

  async function act(action) {
    if (!viewAlive || token !== viewToken || busy) return;
    busy = true;
    pendingClarification = null;
    pendingConfirmation = null;
    const logLen = game.log.length;
    const prevMode = game.mode;
    try {
      const res = await api.gameAction(game.id, action);
      if (!viewAlive || token !== viewToken) return res;
      const visualStateAccepted=adoptState(res.state); // T2: reject a stale whole-state snapshot, events still apply
      // Explicit player attack results only. Polls/localization never call playVisual,
      // and legacy events lacking attacker IDs are not guessed from narration.
      if(visualStateAccepted && res.visualEvents) {
        for(const event of res.visualEvents)renderer3d?.playVisual(event.entityId,event.animation,event.eventId);
      } else if(visualStateAccepted && action.type==='attack' && res.events.some(e=>['attack','miss'].includes(e.type)&&e.data?.targetId===action.targetId)) {
        renderer3d?.playVisual(player().id,'attack',`${game.id}:${res.state.rev}:player-attack`);
      }
      tutorial.observe(game, res.events, action); // T5 coach watches the server's answer
      // Ambient soundscape dynamic response to combat enter/exit
      const mapTheme = (game.map && game.map.theme) || (game.mapId && game.mapId.includes('vault') ? 'vault' : game.mapId && game.mapId.includes('hills') ? 'hills' : 'crypt');
      if (prevMode !== 'combat' && game.mode === 'combat') {
        sfx.startAmbient('combat');
      } else if (prevMode === 'combat' && game.mode !== 'combat') {
        sfx.startAmbient(mapTheme);
      }
      if (game.mode === 'victory' || game.mode === 'over') {
        sfx.stopAmbient();
      }
      if (action.type === 'item' && action.itemId && action.itemId.includes('potion')) {
        sfx.play('potion');
      } else if (action.type === 'retreat') {
        sfx.play('retreat');
      }
      // Floor travel / descent banner
      const travelEv = res.events.find(e => e.type === 'travel');
      if (travelEv) {
        showFloorBanner(contentText(game,"mapName") || t("ui.play.new_chamber"), messageText(travelEv));
        sfx.play('travel_stairs');
      }
      // dice flourish on notable rolls
      const dmg = res.events.find(e => ['attack', 'spell_hit', 'attack_in', 'save'].includes(e.type));
      if (dmg && dmg.data && dmg.data.dmg) showDice(20, dmg.data.dmg, t('ui.tooltip.damage'));
      // floating combat text popups for hits, crits, misses, heals, kills
      res.events.forEach((e, idx) => {
        let x = e.data?.targetX;
        let y = e.data?.targetY;
        if (x == null || y == null) {
          const ent = game.entities.find(en => en.id === e.data?.targetId);
          if (ent) { x = ent.x; y = ent.y; }
        }
        if (x == null || y == null) return;

        const delay = idx * 90;
        setTimeout(() => {
          if (['attack', 'attack_in', 'spell_hit'].includes(e.type) && e.data?.dmg) {
            spawnFloatingText(x, y, (e.data.crit ? t("ui.play.crit") : '-') + e.data.dmg, e.data.crit ? 'crit' : 'damage');
          } else if (e.type === 'save' && e.data?.dmg) {
            spawnFloatingText(x, y, `-${e.data.dmg}`, 'damage');
          } else if (e.type === 'miss') {
            spawnFloatingText(x, y, t("ui.play.miss"), 'miss');
          } else if (e.type === 'heal' && e.data?.heal) {
            spawnFloatingText(x, y, `+${e.data.heal} HP`, 'heal');
          } else if (e.type === 'kill') {
            spawnFloatingText(x, y, t("ui.play.defeated_2"), 'kill');
          }
        }, delay);
      });
      // sounds for the notable events of this action
      res.events.forEach(e => { if (SFX_MAP[e.type]) sfx.play(e.type === 'attack' && e.data && e.data.crit ? 'crit' : SFX_MAP[e.type]); });
      if (res.events.some(e => e.type === 'chat_open')) {
        const ev = res.events.find(e => e.type === 'chat_open');
        activeNpc = { id: ev.data.npcId, name: ev.data.name, nameDisplay:game.entities.find(e=>e.npcId===ev.data.npcId)?.nameDisplay };
        const sceneId = ev.data.sceneId || (game.scenes || []).find(scene => scene.npcId === ev.data.npcId)?.id;
        if (sceneId) panels.openScene(sceneId);
      }
      if (res.events.some(e => e.type === 'journal')) toast(() => t("ui.play.journal_updated"));
      if (res.chatReply) toast(() => t('ui.play.the_npc_answers'));
      // voice-over: speak the DM's new narration lines (chunked per sentence)
      if (tts.isEnabled()) {
        game.log.slice(logLen).filter(l => ['dm', 'system'].includes(l.kind)).slice(0, 2)
          .filter(l => l.messageKey || l.textDisplay || l.language)
          .forEach(l => tts.speak(messageText(l).slice(0,400),l.language || getLocale()));
      }
      if (selectedTarget && !game.entities.some(e => e.id === selectedTarget.id && e.alive !== false)) {
        selectedTarget = null;
        appearanceShown = null;
      }
      pendingClarification = (res.events || []).find(e => e.type === 'clarification') || null;
      pendingConfirmation = (res.events || []).find(e => e.type === 'confirmation') || null;
      update();
      return res;
    } catch (e) {
      if (viewAlive && token === viewToken) toast(() => e.message);
    } finally { busy = false; }
  }

  function handleTileClick(x, y) {
    if (busy || game.mode === 'over' || game.mode === 'victory') return;
    const ent = game.entities.find(e => e.x === x && e.y === y && e.alive !== false && !e.fled);
    const vis = new Set(game.visible || []);
    if (ent && ent.kind === 'monster' && vis.has(x + ',' + y)) {
      selectedTarget = ent;
      appearanceShown = (game.appearances || {})[getLocale()+':'+ent.monsterId] || null;
      update();
      fetchAppearance(ent);
      return;
    }
    if (ent && (ent.kind === 'npc')) {
      if (['marla', 'perra'].includes(ent.npcId) && Math.abs(player().x - x) + Math.abs(player().y - y) <= 3) {
        panels.openShop(ent.npcId === 'perra' ? 'Perra the Pack Trader' : 'Marla the Peddler');
        return;
      }
      act({ type: 'freeform', text: 'talk to ' + ent.name });
      return;
    }
    // Several interactables can share one tile (the crypt's Sunless Altar and the Relic
    // both sit on 12,22). `find` used to shadow every later object forever, so the relic
    // — the stage-0 objective — was unclickable in the UI. Repeated clicks on the same
    // tile now cycle through its objects so both stay reachable; targeting only, the
    // server still adjudicates by objectId.
    const atTile = (game.objects || []).filter(o => o.x === x && o.y === y && o.type !== 'npcMarker');
    let obj = atTile[0];
    if (atTile.length > 1) {
      const key = x + ',' + y;
      tilePick.idx = tilePick.key === key ? (tilePick.idx + 1) % atTile.length : 0;
      tilePick.key = key;
      obj = atTile[tilePick.idx];
    } else {
      tilePick.key = '';
    }
    if (obj) {
      const p = player();
      const dist = Math.abs(p.x - x) + Math.abs(p.y - y);
      if (vis.has(x + ',' + y) && ((obj.type === 'barrel' && !obj.exploded) || (obj.type === 'spores' && !obj.burst))) {
        if (game.mode === 'combat' || dist > 1) {
          selectedTarget = obj;
          appearanceShown = null;
          update();
          return;
        }
      }
      if (dist <= 1 && obj.type === 'trap' && obj.revealed && !obj.triggered && !obj.disarmed) {
        panels.openSkillCheckModal(obj);
        return;
      }
      if (dist <= 1 && obj.type === 'chest' && !obj.looted && obj.locked && !obj.unlocked) {
        panels.openSkillCheckModal(obj);
        return;
      }
      if (dist <= 1 && ['door', 'chest', 'stairs', 'barrel', 'font', 'lever', 'spores'].includes(obj.type)) { act({ type: 'interact', objectId: obj.id }); return; }
      if (dist <= 1 && ['relic', 'altar', 'campfire'].includes(obj.id)) { act({ type: 'interact', objectId: obj.id }); return; }
    }
    act({ type: 'move', x, y });
  }

  // ---------------- rendering ----------------
  function update() {
    activeRender(game);
    renderSide();
    panels.refreshScene();
    updateInitiativeRibbon();
    tutorial.observe(game); // T5 coach: state-driven steps (mode transitions, settle mirror)
    const invModal = document.getElementById('delveInventoryModal');
    if (invModal) {
      delveInv.renderDelveInventoryModal(invModal);
    }
    if ((game.mode === 'victory' || game.mode === 'over' || game.mode === 'retreat') && !summaryShown) {
      summaryShown = true;
      sfx.play((game.mode === 'victory' || game.mode === 'retreat') ? 'victory' : 'death');
      panels.openSummary();
    }
    renderLog();
    const hint = document.getElementById('mapHint');
    if (hint) {
      if (game.mode === 'combat') localizeText(hint, () => t('ui.play.combatMapHint', { round: game.combat.round, ft: game.combat.movementLeft }));
      else if (game.mode === 'over') localizeText(hint, () => t("ui.play.you_have_fallen"));
      else if (game.mode === 'victory') localizeText(hint, () => t("ui.play.victory"));
      else localizeText(hint, () => t("ui.play.click_to_move_click_a_monster_to"));
    }
    updateHoverCues(currentHoverTile);
  }

  const dmSettingsBtn = document.getElementById('dmSettingsBtn');
  if (dmSettingsBtn) dmSettingsBtn.addEventListener('click', () => openSettingsModal());

  // while delving, if there is a data-nav="settings" link, wire it to the modal
  const settingsLink = document.querySelector('[data-nav="settings"]');
  const onSettingsNav = (e) => { e.preventDefault(); e.stopPropagation(); openSettingsModal(); };
  if (settingsLink) settingsLink.addEventListener('click', onSettingsNav, true);

// Backpack & equipment modal lives in play/delve-inventory.js
  const delveInv = createDelveInventory({
    getGame: () => game,
    act,
    acNow,
    speedNow,
    getSelectedTarget: () => selectedTarget
  });

  function renderSide(rebuild = false) {
    // H1: the HUD is reconciled, not wiped. The four hosts keep their children until
    // the patch re-anchors them, so a button held down across an auxiliary describe/
    // portrait/poll response keeps its node, listeners, focus and pointer press.
    // A layout toggle passes rebuild=true: hosts are wiped and the panel rebuilt the
    // plain way, because movers must change containers and no press can be in flight.
    const hudHosts = [
      document.getElementById('coreHud'),
      document.getElementById('encounterTools'),
      document.getElementById('questTrackerHost')
    ];
    const char = game.character;
    const p = player();
    const rules = appState.rules;
    const cls = rules.classes.find(c => c.id === (char.className || char.class)) || rules.classes[0];
    const subDef = (cls?.subclass && char.subclass === cls.subclass.id) ? cls.subclass : null;
    const myTurn = game.mode !== 'combat' || game.combat.order[game.combat.turnIdx].id === 'player';
    const potCount = (game.character.inventory || [])
      .filter(i => ['potion_healing', 'potion_greater'].includes(i.itemId))
      .reduce((s, i) => s + i.qty, 0);

    const sideHtml = `
      <div class="card" data-card="hero">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
          <img src="${char.portraitUrl || '/portraits/hero_' + (char.id || game.characterId) + '.svg'}"
               data-i18n-alt="ui.portrait.hero" alt="${esc(t('ui.portrait.hero'))}"
               style="width:44px; height:50px; object-fit:cover; border-radius:6px; border:1.5px solid var(--border); background:#15120e; flex-shrink:0;"
               onerror="this.style.display='none'">
          <div style="min-width:0; flex:1;">
            <h3 style="margin:0 0 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${contentLabel(char,"name")}</h3>
            <div class="muted small">${label("ui.play.heroClass", { level: char.level, class: (cls.nameDisplay || cls.name) })}</div>
          </div>
        </div>
        <div style="margin-bottom:6px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
          <span class="chip ${game.difficulty === 'hard' ? 'red' : game.difficulty === 'easy' ? 'blue' : ''}">${displayLabel((appState.rules.difficulty || {})[game.difficulty]?.labelDisplay, (appState.rules.difficulty || {})[game.difficulty]?.label || t("ui.play.normal"))}</span>
          ${(() => {
            const allyEnt = (game.entities || []).find(e => e.kind === 'ally');
            if (!allyEnt) return '';
            const status = allyEnt.alive ? `${allyEnt.hp}/${allyEnt.hpMax} HP` : t("ui.play.downed");
            const loy = allyEnt.loyalty == null ? 50 : allyEnt.loyalty;
            const mood = loy >= 80 ? '😊' : loy >= 30 ? '😐' : '😠';
            return `<span class="chip blue" data-i18n-title="${allyEnt.alive ? 'ui.play.loyalty_100_values' : 'ui.play.loyaltyDowned'}" data-i18n-params="${esc(JSON.stringify({p0: allyEnt.nameDisplay || allyEnt.name, p1: status, p2: loy}))}" title="${esc(t("ui.play.loyalty_100_values", {p0: (allyEnt.nameDisplay || allyEnt.name), p1: status, p2: loy}))}">${mood} ${contentLabel(allyEnt)} (${allyEnt.hp} HP)</span>`;
          })()}
          ${subDef ? `<span class="chip">⚔ ${contentLabel(subDef,"name")}</span>` : ''}
          <span style="flex:1"></span>
          <button class="btn small" id="sfxBtn" data-i18n-title="ui.play.sound_effects" title="${esc(t("ui.play.sound_effects"))}">${sfx.isEnabled() ? '🔊' : '🔇'}</button>
          <button class="btn small" id="ttsBtn" data-i18n-title="ui.play.ai_dm_voice_over" title="${esc(t("ui.play.ai_dm_voice_over"))}">${tts.isEnabled() ? '🗣️' : '🤐'}</button>
          <input type="range" id="volSlider" min="0" max="100" value="${Math.round(sfx.getVolume() * 100)}" style="width:70px;" data-i18n-title="ui.play.volume" title="${esc(t("ui.play.volume"))}">
        </div>
        <div class="hp-bar"><div class="fill" style="width:${Math.max(0, (p.hp / p.hpMax) * 100)}%"></div></div>
        <div class="hp-text"><span>${p.hp}/${p.hpMax} HP${p.tempHp ? ` ${label("ui.play.tempHp", { hp: p.tempHp })}` : ''}</span><span>AC ${acNow()}</span></div>
        <div class="hp-text"><span>${label("ui.play.speed_ft_values", {p19: speedNow()})}</span><span>XP ${char.xp} · ${char.gold} gp</span></div>
        <div class="hp-text"><span>${label("ui.play.slots_values", {p22: slotText()})}</span><span>${label("ui.play.hd_left_values", {p23: char.level - (char.hdUsed || 0)})}</span></div>
        ${(() => {
          const lu = game.levelUp || {};
          const canLvl = !!lu.canLevelUp;
          const nextLvl = lu.nextLevel || ((char.level || 1) + 1);
          return canLvl ? `<button class="btn small levelup-badge-btn" id="btnDelveLevelUp" style="width:100%; margin-top:8px;" title="${lu.currentXp || char.xp || 0} / ${lu.xpNeeded || '—'} XP">${label("ui.play.level_up_available_ascend_to_lvl_values", {p2: nextLvl})}</button>` : '';
        })()}
        ${(p.conditions.length || (p.buffs || []).filter(b => b.id !== 'concentrating').length) ? `<div style="margin-top:6px;">${p.conditions.map(c => `<span class="chip red">${displayLabel({key:'content.condition.'+c,fallback:c})}</span>`).join('')}${(p.buffs || []).filter(b => b.id !== 'concentrating' && b.id !== 'cond_' ).map(b => `<span class="chip blue">${displayLabel({key:'content.buff.'+b.id,fallback:b.id})}</span>`).join('')}</div>` : ''}
        ${((game.flags && game.flags.restsBlocked) || (char.tempHpMod || 0) !== 0 || (char.inventory || []).some(i => i.delveOnly)) ? `
          <div style="margin-top:6px;">
            ${(game.flags && game.flags.restsBlocked) ? `<span class="chip red" data-i18n-title="ui.play.rest_was_taken_away_by_a_potion" title="${esc(t("ui.play.rest_was_taken_away_by_a_potion"))}">${label("ui.play.rest_blocked_values", {p1: game.flags.restsBlocked})}</span>` : ''}
            ${(char.tempHpMod || 0) < 0 ? `<span class="chip red" data-i18n-title="ui.play.maximum_hp_is_reduced_for_this_delve" title="${esc(t("ui.play.maximum_hp_is_reduced_for_this_delve"))}">${label("ui.play.maximum_hp_this_delve_values", {p1: char.tempHpMod})}</span>` : ''}
            ${(char.tempHpMod || 0) > 0 ? `<span class="chip blue" data-i18n-title="ui.play.maximum_hp_is_increased_for_this_delve" title="${esc(t("ui.play.maximum_hp_is_increased_for_this_delve"))}">${label("ui.play.maximum_hp_this_delve_values_16", {p1: char.tempHpMod})}</span>` : ''}
            ${(char.inventory || []).filter(i => i.delveOnly && i.kind === 'delve_token' && i.qty > 0).map(i => `<span class="chip gold-chip" title="${esc(i.desc || '')}">${contentLabel(i,"name")}</span>`).join('')}
          </div>` : ''}
        
        <div style="display:flex; gap:6px; margin-top:10px;">
          <button class="btn small" id="btnOpenDelveInventory" style="flex:1; background:var(--bg2); border-color:var(--gold-dim); color:var(--parchment); font-weight:600;" data-i18n-title="ui.play.open_inventory_and_manage_equipment_hotkey_b" title="${esc(t("ui.play.open_inventory_and_manage_equipment_hotkey_b"))}">
            ${label("ui.play.backpack_gear_values", {p28: (char.inventory || []).length})}
          </button>
          <a href="#/character/${game.characterId}" target="_blank" class="btn small" data-i18n-title="ui.play.open_full_character_sheet_in_new_tab" title="${esc(t("ui.play.open_full_character_sheet_in_new_tab"))}" style="text-decoration:none; padding:4px 8px;">${label("ui.play.sheet")}</a>
        </div>
      </div>

      ${pendingClarification ? `
      <div class="card" data-card="clarification" style="border-color:var(--gold); background:rgba(217, 119, 6, 0.1);">
        <h3 style="color:var(--gold); margin-top:0;">${label('ui.play.clarify_title')}</h3>
        <p class="small">${esc(pendingClarification.prompt)}</p>
        <div class="action-grid" style="margin-top:8px;">
          ${(pendingClarification.candidates || []).map((c, idx) => `<button class="btn small" data-clarify-idx="${idx}">${esc(c.label)}</button>`).join('')}
          <button class="btn small muted" data-clarify-cancel="1" style="grid-column:1 / -1;">${label('ui.play.cancel_action')}</button>
        </div>
      </div>` : ''}

      ${pendingConfirmation ? `
      <div class="card" data-card="confirmation" style="border-color:var(--gold); background:rgba(217, 119, 6, 0.1);">
        <h3 style="color:var(--gold); margin-top:0;">${label('ui.play.confirm_cost_title')}</h3>
        <p class="small">${esc(pendingConfirmation.prompt)}</p>
        ${pendingConfirmation.costWarning ? `<p class="small" style="color:#f59e0b; font-weight:bold; margin:4px 0;">⚠️ ${esc(pendingConfirmation.costWarning)}</p>` : ''}
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button class="btn primary small" data-confirm-action="1">${label('ui.play.confirm_action')}</button>
          <button class="btn small" data-confirm-cancel="1">${label('ui.play.cancel_action')}</button>
        </div>
      </div>` : ''}

      ${(game.scenes || []).map(scene => `<div class="card" data-card="scene:${esc(scene.id)}"><h3>${contentLabel(scene,"name")}</h3><p class="small">${contentLabel(scene,scene.phase === 'resolved' ? 'outcome' : 'prompt')}</p><button class="btn small" style="width:100%;white-space:normal;" data-scene-open="${esc(scene.id)}">${game.map.story ? label(scene.phase === 'resolved' ? 'story.review' : 'story.choose', {name:scene.nameDisplay || scene.name}) : (scene.phase === 'resolved' ? label("ui.play.hear_what_the_gatekeeper_remembers") : label("ui.play.view_encounter_choices"))}</button></div>`).join('')}

      ${(() => {
        const pk = selectedTarget ? (selectedTarget.monsterId || selectedTarget.npcId) : null;
        const port = pk ? portraitCache[pk] : null;
        if (!port) {
          // the DM is studying this creature right now — show the wait (T2)
          if (pk && appearanceLoading === pk) {
            return `<div class="card" data-card="portrait" style="border-color:var(--gold-dim); text-align:center;">
              <div class="spinner" style="margin:10px auto 6px;"></div>
              <p class="small muted" style="margin:2px 0 6px;">${label("ui.play.the_dm_studies_the_creature")}</p>
            </div>`;
          }
          return '';
        }
        return `
      <div class="card" data-card="portrait" style="border-color:var(--gold-dim); text-align:center;">
        <img src="${port.url}" data-i18n-alt="ui.portrait.creature" alt="${esc(t('ui.portrait.creature'))}" style="width:100%; max-width:180px; border-radius:8px;" onerror="this.style.display='none'">
        <p class="small" style="font-family:var(--font-serif); color:var(--parchment); margin:6px 0 0;">${esc(appearanceShown || (selectedTarget && selectedTarget.name) || '')}</p>
      </div>`;
      })()}

      ${p.conditions.includes('unconscious') ? `
      <div class="card" data-card="dying" style="border-color:#6b3a35;">
        <h3 style="color:#d98a80;">${label("ui.play.dying")}</h3>
        <p class="small">${label("ui.play.success_nbsp_nbsp_values", {p1: '●'.repeat(Math.min(3, Math.max(0, (p.deathSaves || {}).succ || 0))), p2: '○'.repeat(3 - Math.min(3, Math.max(0, (p.deathSaves || {}).succ || 0)))})}</p>
        <p class="small">${label("ui.play.failures_nbsp_nbsp_values", {p3: '●'.repeat(Math.min(3, Math.max(0, (p.deathSaves || {}).fail || 0))), p4: '○'.repeat(3 - Math.min(3, Math.max(0, (p.deathSaves || {}).fail || 0)))})}</p>
        <p class="small muted" style="margin-top:4px;">${label("ui.play.death_saves_roll_automatically_at_the_start")}</p>
      </div>` : ''}

      ${game.mode === 'over' ? `
      <div class="card" data-card="fallen" style="border-color:#6b3a35;">
        <h3 style="color:#d98a80;">${label("ui.play.you_have_fallen_2")}</h3>
        <p class="small muted">${label('content.fallen')}</p>
        <button class="btn primary" data-act="respawn">${label("ui.play.recover_at_camp_half_hp")}</button>
      </div>
      ` : game.mode === 'combat' ? combatHud(myTurn) : `
      ${renderQuickSlots(true)}
      <div class="card" data-card="actions">
        <h3>${label("ui.play.actions")}</h3>
        <div class="action-grid" data-hud="action-grid">
          <button class="btn" data-act="rest">${label("ui.play.short_rest")}</button>
          <button class="btn" data-act="longrest">${label("ui.play.long_rest")}</button>
          <button class="btn" data-act="potion">${label("ui.play.potion_values", {p4: potCount})}</button>
          ${atCampfire() ? `<button class="btn" data-act="recap" style="grid-column:1 / -1;">${label("ui.play.write_journal_entry")}</button>` : ''}
          ${(atCampfire() || atEntrance() || game.mode === 'retreat' || game.mode === 'victory' || isAreaCleared(game)) ? `<button class="btn primary ${retreatBeacon() ? 'cleared-beacon-btn' : ''}" data-act="retreat" style="grid-column:1 / -1; background:linear-gradient(180deg, #3d5a42, #29422e); border-color:#508059;" data-i18n-title="${esc(game.mode === 'retreat' || game.mode === 'victory' ? "ui.play.open_the_settle_summary" : "ui.play.retreat_settles_current_gains_without_story_advancement")}" title="${game.mode === 'retreat' || game.mode === 'victory' ? t("ui.play.open_the_settle_summary") : t("ui.play.retreat_settles_current_gains_without_story_advancement")}">${label(retreatButtonKey())}</button>` : `<button class="btn" data-act="retreat" style="grid-column:1 / -1;">${label("ui.play.retreat_to_oakhaven")}</button>`}
          <button class="btn" data-act="journal" style="grid-column:1 / -1;">${label("ui.play.journal_values", {p7: (game.journal || []).length ? ` (${game.journal.length})` : ''})}</button>
        </div>
        <div style="margin-top:8px;">${classActions()}</div>
      </div>`}

      <div class="card quest-objective-card" data-card="quest" style="border-color:var(--gold-dim);">
        <div class="quest-fold-header" id="toggleQuestFoldBtn" data-i18n-title="ui.play.click_to_fold_or_expand_quests_goals" title="${esc(t("ui.play.click_to_fold_or_expand_quests_goals"))}">
          <h3 style="margin:0; display:flex; align-items:center; gap:6px;">
            ${label("ui.play.quests_goals")}
            <span class="chip ${questObjectiveFolded ? '' : 'blue'}" style="font-size:10px; padding:1px 6px;">${questObjectiveFolded ? label("ui.play.folded") : label("ui.play.active")}</span>
          </h3>
          <button class="btn small" style="padding:2px 8px; font-size:11px;" id="btnQuestFoldToggle">
            ${questObjectiveFolded ? label("ui.play.expand") : label("ui.play.fold")}
          </button>
        </div>
        ${questObjectiveFolded ? `
          <div class="small muted" style="margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(game.guidance ? displayText(game.guidance.objectiveDisplay, game.guidance.objective) : charObjective(game))}">
            🎯 ${game.guidance ? displayLabel(game.guidance.objectiveDisplay, game.guidance.objective) : esc(charObjective(game))}
          </div>
        ` : `
          <div style="margin-top:8px;">
            <div style="font-size:12px; font-weight:600; color:var(--gold); margin-bottom:3px;">${label("ui.play.dungeon_objective")}</div>
            <p class="small muted" style="margin:0 0 8px;">${game.guidance ? displayLabel(game.guidance.objectiveDisplay, game.guidance.objective) : esc(charObjective(game))}</p>
            ${game.quests && game.quests.active ? `
              <div style="border-top:1px dashed var(--border); padding-top:6px; margin-top:6px;">
                <div style="font-size:12px; font-weight:600; color:var(--parchment); margin-bottom:2px;">📜 ${contentLabel(game.quests.active,"shortText")}</div>
                <p class="small muted" style="margin:0 0 6px;">${contentLabel(game.quests.active,"text")}</p>
                <div class="small"><span class="chip">💰 ${game.quests.active.reward.gold} gp</span> <span class="chip blue">✨ ${game.quests.active.reward.xp} XP</span></div>
              </div>
            ` : ''}
            ${game.companionQuest ? `
              <div style="border-top:1px dashed var(--border); padding-top:6px; margin-top:6px;">
                <div style="font-size:12px; font-weight:600; color:var(--parchment); margin-bottom:2px;">🤝 ${contentLabel(game.companionQuest,"name")}</div>
                <p class="small muted" style="margin:0 0 6px;">${label("ui.play.has_asked_for_your_help_a_values", {p1: (game.entities.find(e => e.kind === 'ally' && e.allyId === game.companionQuest.allyId) || {}).name || t("ui.play.your_companion")})}</p>
                <div class="small"><span class="chip blue">🎯 ${esc(game.companionQuest.targetName)} ${game.companionQuest.count}/${game.companionQuest.need}</span></div>
              </div>
            ` : ''}
          </div>
        `}
      </div>
    `;
    const patched = rebuild ? null : patchHud(document.getElementById('sidePanel'), sideHtml, hudHosts);
    if (rebuild) {
      for (const host of hudHosts) host.replaceChildren();
      document.getElementById('sidePanel').innerHTML = sideHtml;
    }

    wireSide(myTurn);
    initTooltips(document.getElementById('sidePanel'), appState.rules);
    relayoutQuestTracker();
    const coreHudEl = document.getElementById('coreHud');
    const encounterEl = document.getElementById('encounterTools');
    const trackerEl = document.getElementById('questTrackerHost');
    const keptCore = new Set(), keptEncounter = new Set();
    if (mapFirst) {
      const side = document.getElementById('sidePanel');
      // Existing controls move with their original listeners and disabled state.
      const grid = side.querySelector('.action-grid');
      if (grid) { coreHudEl.appendChild(grid); keptCore.add(grid); }
      else { const recovery = side.querySelector('[data-act="respawn"]')?.closest('.card'); if (recovery) { coreHudEl.appendChild(recovery); keptCore.add(recovery); } }
      const economy = side.querySelector('.turn-economy-bar');
      if (economy) { coreHudEl.prepend(economy); keptCore.add(economy); }
      const target = side.querySelector('.target-line');
      if (target) { coreHudEl.prepend(target); keptCore.add(target); }
      const clarifCard = side.querySelector('[data-card="clarification"]');
      if (clarifCard) { coreHudEl.prepend(clarifCard); keptCore.add(clarifCard); }
      const confirmCard = side.querySelector('[data-card="confirmation"]');
      if (confirmCard) { coreHudEl.prepend(confirmCard); keptCore.add(confirmCard); }
      side.querySelectorAll('[data-scene-open]').forEach(button => { encounterEl.appendChild(button); keptEncounter.add(button); });
    }
    // Hosts are no longer pre-wiped: the patch re-anchored or patched-in-place their
    // still-valid nodes, so only drop what the current layout did not place.
    if (patched) for (const node of patched.keptInHosts) {
      if (node.parentElement === coreHudEl) keptCore.add(node);
      else if (node.parentElement === encounterEl) keptEncounter.add(node);
    }
    const keptTracker = new Set(document.body.classList.contains('immersive')
      ? Array.from(trackerEl.children).filter(ch => ch.classList.contains('quest-objective-card'))
      : []);
    for (const entry of /** @type {[HTMLElement, Set<Element>][]} */ ([[coreHudEl, keptCore], [encounterEl, keptEncounter], [trackerEl, keptTracker]])) {
      const [host, kept] = entry;
      for (const child of Array.from(host.children)) {
        if (!kept.has(child)) child.remove();
      }
    }
    const hud = document.getElementById('heroHud');
    hud.innerHTML = `<span>${contentLabel(char,"name")} · <b>${p.hp}/${p.hpMax} HP</b>${p.tempHp ? ` +${p.tempHp}` : ''}</span>${game.mode === 'combat' ? `<span>${label('ui.play.round_values', {p0:game.combat.round})}</span>` : ''}${(p.conditions || []).map(c => `<span class="chip red">${displayLabel({key:'content.condition.'+c,fallback:c})}</span>`).join('')}`;
    const sfxBtn = document.getElementById('sfxBtn');
    if (sfxBtn && !sfxBtn.dataset.wired) {
      sfxBtn.dataset.wired = '1';
      sfxBtn.addEventListener('click', () => { sfx.toggle(); renderSide(); });
    }
    const volSlider = document.getElementById('volSlider');
    if (volSlider && !volSlider.dataset.wired) {
      volSlider.dataset.wired = '1';
      volSlider.addEventListener('input', (e) => { sfx.setVolume(+(/** @type {HTMLInputElement} */ (e.target).value) / 100); });
    }
    const vt = document.getElementById('viewToggle');
    if (vt) vt.onclick = toggleView;
    const ttsBtn = document.getElementById('ttsBtn');
    if (ttsBtn && !ttsBtn.dataset.wired) {
      ttsBtn.dataset.wired = '1';
      ttsBtn.addEventListener('click', () => { tts.toggle(); renderSide(); toast(() => tts.isEnabled() ? t("ui.play.ai_dm_voice_on") : t("ui.play.ai_dm_voice_off")); });
    }
  }

  function getConsumables() {
    const inv = game.character.inventory || [];
    const list = [];
    for (const it of inv) {
      if (!it.qty || it.qty <= 0) continue;
      const def = (appState.rules.weapons || []).find(w => w.id === it.itemId)
        || (appState.rules.armor || []).find(w => w.id === it.itemId)
        || (appState.rules.gear || []).find(w => w.id === it.itemId);
      const isPotion = (def && def.type === 'potion') || it.itemId.startsWith('potion_');
      const isScroll = (def && def.type === 'scroll') || it.itemId.startsWith('scroll_');
      if (isPotion || isScroll) {
        let shortName = def ? def.name : it.itemId;
        shortName = shortName.replace(/^Potion of /, '').replace(/^Scroll of /, '').replace(/ Potion$/, '');
        list.push({
          itemId: it.itemId,
          name: def ? def.name : it.itemId, nameDisplay:def?.nameDisplay,
          shortName,
          qty: it.qty,
          isPotion,
          isScroll,
          icon: isPotion ? '🧪' : '📜',
          def
        });
      }
    }
    return list;
  }

  function renderQuickSlots(myTurn = true) {
    const items = getConsumables().slice(0, 5);
    const slots = [];
    for (let i = 0; i < 5; i++) {
      const item = items[i];
      if (item) {
        const disClass = (game.mode === 'combat' && !myTurn) ? 'disabled' : '';
        slots.push(`
          <div class="quick-slot-card ${disClass}" data-quickslot="${i}" data-item-tooltip="${item.itemId}" data-i18n-title="ui.play.key_values" data-i18n-params="${esc(JSON.stringify({p3: item.nameDisplay || item.name, p4: i + 1}))}" title="${esc(t("ui.play.key_values", {p3: (item.nameDisplay || item.name), p4: i + 1}))}">
            <span class="slot-key-badge">${i + 1}</span>
            <span class="slot-icon">${item.icon}</span>
            <span class="slot-label">${contentLabel(item)}</span>
            <span class="slot-qty-badge">×${item.qty}</span>
          </div>
        `);
      } else {
        slots.push(`
          <div class="quick-slot-card slot-empty" data-i18n-title="ui.play.empty_quick_slot_key_values" data-i18n-params="${esc(JSON.stringify({p0: i + 1}))}" title="${esc(t("ui.play.empty_quick_slot_key_values", {p0: i + 1}))}">
            <span class="slot-key-badge">${i + 1}</span>
            <span style="opacity:0.35;">—</span>
          </div>
        `);
      }
    }
    return `
      <div class="quickbar-wrap" data-hud="quickbar">
        <div class="quickbar-header">
          <span>${label("ui.play.quick_slots_belt")}</span>
          <span class="muted" style="font-weight:normal; font-size:10px;">${label("ui.play.hotkeys_1_5")}</span>
        </div>
        <div class="quickbar-grid">
          ${slots.join('')}
        </div>
      </div>
    `;
  }

  function useQuickSlot(slotIdx) {
    if (busy) return;
    if (game.mode === 'combat') {
      const actor = game.combat && game.combat.order ? game.combat.order[game.combat.turnIdx] : null;
      if (!actor || actor.id !== 'player') return toast(() => t("ui.play.wait_for_your_turn_in_combat"));
    }
    const items = getConsumables();
    const item = items[slotIdx];
    if (!item) return;

    if (item.isScroll) {
      const def = item.def;
      if (def && def.spell) {
        const sp = (appState.rules.spells || []).find(x => x.id === def.spell);
        if (sp && ['enemy', 'burst'].includes(sp.target) && !selectedTarget) {
          return toast(() => t('ui.play.targetItem', { item: (item.nameDisplay || item.name) }));
        }
        act({ type: 'useItem', itemId: item.itemId, targetId: selectedTarget ? selectedTarget.id : 'player' });
      } else {
        act({ type: 'useItem', itemId: item.itemId });
      }
    } else {
      act({ type: 'useItem', itemId: item.itemId });
    }
  }

  function acNow() {
    let ac = game.character.acBase;
    if ((p_b()).some(b => b.id === 'mage_armor') && !game.character.inventory.some(i => i.itemId === 'leather' || i.itemId === 'chain_mail' || i.itemId === 'chain_shirt' || i.itemId === 'studded_leather' || i.itemId === 'shield')) ac = 13 + Math.floor((game.character.abilities.dex - 10) / 2);
    if ((p_b()).some(b => b.id === 'shield')) ac += 5;
    return ac;
  }
  function p_b() { return player().buffs || []; }
  function speedNow() {
    let s = player().speedFt;
    (p_b() || []).forEach(b => { if (b.id === 'longstrider') s += 10; });
    return s;
  }
  function slotText() {
    const s = game.character.slots || {};
    const entries = Object.entries(s).filter(([, v]) => v > 0);
    return entries.length ? entries.map(([k, v]) => `L${k}×${v}`).join(' ') : '—';
  }

  function combatHud(myTurn) {
    const c = game.combat;
    const targetLine = selectedTarget
      ? `${label("ui.play.target")}<b>${contentLabel(selectedTarget,"name")}</b> (${selectedTarget.hpMax ? selectedTarget.hp + '/' + selectedTarget.hpMax + ' HP, ' : label('ui.play.object')}AC ${selectedTarget.ac || 10})${selectedTarget.isElite ? ` <span class="elite-monster-label" style="--elite-color:${esc((selectedTarget.affix && selectedTarget.affix.color) || '#f59e0b')}" ${selectedTarget.affix?.desc ? '' : 'data-i18n-title="ui.play.elite_champion"'} title="${esc((selectedTarget.affix && selectedTarget.affix.desc) || t("ui.play.elite_champion"))}">${label('ui.play.elite')}${(selectedTarget.affix && selectedTarget.affix.desc) ? esc(selectedTarget.affix.desc) : label('ui.play.champion')}</span>` : ''}`
      : label("ui.play.click_a_monster_or_object_on_the");
    const p = player();
    const actionUsed = !!c.actionUsed;
    const bonusUsed = !!c.bonusUsed;
    const mvLeft = c.movementLeft ?? 0;
    const reactionUsed = !!(p && p.reactionUsed);

    const canAttack = myTurn && !actionUsed;
    const canCast = myTurn && !actionUsed;
    const canDodge = myTurn && !actionUsed;
    const canDash = myTurn && !actionUsed;
    const potCount = (game.character.inventory || []).filter(i => ['potion_healing', 'potion_greater'].includes(i.itemId)).reduce((s, i) => s + i.qty, 0);
    const canPotion = myTurn && !bonusUsed && potCount > 0;

    const allMainActionsSpent = myTurn && actionUsed && (bonusUsed || potCount === 0) && mvLeft === 0;

    return `
      <div class="combat-banner" data-card="combat-banner">
        <span class="round">${label("ui.play.round_values", {p0: c.round})}</span> — ${myTurn ? `<b style="color:var(--gold);">${label("ui.play.your_turn_2")}</b>` : `<span class="muted">${label("ui.play.enemies_act")}</span>`}
        <div class="init-chips">${c.order.map((o, i) => {
          const ent = game.entities.find(e => e.id === o.id);
          return `<span class="init-chip ${i === c.turnIdx ? 'active' : ''} ${ent && ent.alive === false ? 'dead' : ''}">${contentLabel(o,"name")} ${o.total}</span>`;
        }).join('')}</div>
      </div>
      <div class="card" data-card="combat">
        <p class="target-line" data-hud="target-line">${targetLine}</p>

        <div class="turn-economy-bar" data-hud="turn-economy" data-i18n-title="ui.play.turn_economy_action_bonus_action_movement_and" title="${esc(t("ui.play.turn_economy_action_bonus_action_movement_and"))}">
          <span class="economy-pill ${actionUsed ? 'spent' : 'ready'}" data-i18n-title="${esc(actionUsed ? "ui.play.action_spent_this_turn_cannot_attack_cast" : "ui.play.action_ready_use_for_attack_cast_spell")}" title="${actionUsed ? t("ui.play.action_spent_this_turn_cannot_attack_cast") : t("ui.play.action_ready_use_for_attack_cast_spell")}">
            <span class="economy-dot"></span> ${label("ui.play.action")}${actionUsed ? label("ui.play.spent") : label("ui.play.ready")}
          </span>
          <span class="economy-pill ${bonusUsed ? 'spent' : 'ready'}" data-i18n-title="${esc(bonusUsed ? "ui.play.bonus_action_spent_this_turn" : "ui.play.bonus_action_ready_use_for_potion_or")}" title="${bonusUsed ? t("ui.play.bonus_action_spent_this_turn") : t("ui.play.bonus_action_ready_use_for_potion_or")}">
            <span class="economy-dot"></span> ${label("ui.play.bonus")}${bonusUsed ? label("ui.play.spent") : label("ui.play.ready")}
          </span>
          <span class="economy-pill ${mvLeft > 0 ? 'ready' : 'spent'}" data-i18n-title="ui.play.movement_remaining_this_turn_click_tiles_or" title="${esc(t("ui.play.movement_remaining_this_turn_click_tiles_or"))}">
            ${label("ui.play.ft_sq_values", {p13: mvLeft, p14: Math.floor(mvLeft / 5)})}
          </span>
          <span class="economy-pill ${reactionUsed ? 'spent' : 'ready'}" data-i18n-title="${esc(reactionUsed ? "ui.play.reaction_spent_this_round" : "ui.play.reaction_ready_for_opportunity_attacks_shield")}" title="${reactionUsed ? t("ui.play.reaction_spent_this_round") : t("ui.play.reaction_ready_for_opportunity_attacks_shield")}">
            ⚡ ${label("ui.play.reaction")}${reactionUsed ? label("ui.play.spent") : label("ui.play.ready")}
          </span>
        </div>
        ${game.guidance && game.guidance.combat ? `<div class="guidance-combat-line" data-i18n-title="ui.play.available_actions_and_reasons_computed_by_the" title="${esc(t("ui.play.available_actions_and_reasons_computed_by_the"))}">${(game.guidance.combat.notesDisplay || []).length ? game.guidance.combat.notesDisplay.map(d => displayLabel(d)).join(' · ') : esc(game.guidance.combat.notes)}</div>` : ''}

        ${renderQuickSlots(myTurn)}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <h3 style="margin:0;">${label("ui.play.combat_actions")}</h3>
          ${myTurn && actionUsed ? `<span class="muted small" style="font-size:11px; color:#f87171;">${label("ui.play.action_spent")}</span>` : ''}
        </div>

        <div class="action-grid" data-hud="action-grid">
          <button class="btn" data-act="attack" ${canAttack ? '' : 'disabled'} data-i18n-title="${esc(actionUsed ? "ui.play.action_already_spent_this_turn" : "ui.play.perform_a_weapon_attack_on_the_targeted")}" title="${actionUsed ? t("ui.play.action_already_spent_this_turn") : t("ui.play.perform_a_weapon_attack_on_the_targeted")}">
            ${label("ui.play.attack")} <span class="action-cost-badge action">${label("ui.play.act")}</span>
          </button>
          <button class="btn" data-act="castmenu" ${canCast ? '' : 'disabled'} data-i18n-title="${esc(actionUsed ? "ui.play.action_already_spent_this_turn" : "ui.play.cast_a_cantrip_or_spell")}" title="${actionUsed ? t("ui.play.action_already_spent_this_turn") : t("ui.play.cast_a_cantrip_or_spell")}">
            ${label("ui.play.cast")} <span class="action-cost-badge action">${label("ui.play.act")}</span>
          </button>
          <button class="btn" data-act="dodge" ${canDodge ? '' : 'disabled'} data-i18n-title="${esc(actionUsed ? "ui.play.action_already_spent_this_turn" : "ui.play.take_dodge_action_attacks_against_you_have")}" title="${actionUsed ? t("ui.play.action_already_spent_this_turn") : t("ui.play.take_dodge_action_attacks_against_you_have")}">
            ${label("ui.play.dodge")} <span class="action-cost-badge action">${label("ui.play.act")}</span>
          </button>
          <button class="btn" data-act="dash" ${canDash ? '' : 'disabled'} data-i18n-title="${esc(actionUsed ? "ui.play.action_already_spent_this_turn" : "ui.play.take_dash_action_double_your_movement_speed")}" title="${actionUsed ? t("ui.play.action_already_spent_this_turn") : t("ui.play.take_dash_action_double_your_movement_speed")}">
            ${label("ui.play.dash")} <span class="action-cost-badge action">${label("ui.play.act")}</span>
          </button>
          <button class="btn" data-act="potion" ${canPotion ? '' : (potCount > 0 && !myTurn ? 'disabled' : (bonusUsed ? 'disabled' : ''))} data-i18n-title="${esc(bonusUsed ? "ui.play.bonus_action_already_spent_this_turn" : (potCount === 0 ? "ui.play.no_potions_left" : "ui.play.drink_a_healing_potion"))}" title="${bonusUsed ? t("ui.play.bonus_action_already_spent_this_turn") : (potCount === 0 ? t("ui.play.no_potions_left") : t("ui.play.drink_a_healing_potion"))}">
            ${label("ui.play.potion_values_29", {p40: potCount})} <span class="action-cost-badge bonus">${label("ui.play.bns")}</span>
          </button>
          <button class="btn primary" data-act="endturn" ${myTurn ? '' : 'disabled'} data-i18n-title="ui.play.finish_your_turn_and_let_other_combatants" title="${esc(t("ui.play.finish_your_turn_and_let_other_combatants"))}">
            ${label("ui.play.end_turn_2")}
          </button>
        </div>
        ${allMainActionsSpent ? `
          <div class="all-spent-notice">
            ${label("ui.play.all_actions_and_movement_spent_press")} <b>${label("ui.play.space_2")}</b> ${label("ui.play.or_click")} <b>${label("ui.play.end_turn")}</b>.
          </div>
        ` : ''}
        <div style="margin-top:8px;">${classActions(myTurn)}</div>
        <div id="castMenu"></div>
      </div>`;
  }

  function classActions(myTurn = true) {
    const char = game.character;
    const cls = appState.rules.classes.find(c => c.id === char.className);
    const uses = char.uses || {};
    const btns = [];
    (cls.features || []).filter(f => f.button && f.level <= char.level).forEach(f => {
      let actionLabel = contentLabel(f);
      let disabled = !myTurn;
      if (f.uses === 'cha/short') { const max = 2 + Math.floor((char.abilities.cha - 10) / 2); actionLabel += ` (${uses[f.id] ?? max}/${max})`; if ((uses[f.id] ?? max) <= 0) disabled = true; }
      else if (f.uses && f.uses !== 'pool5xlevel/long') { actionLabel += ` (${uses[f.id] ?? 0})`; if ((uses[f.id] ?? 0) <= 0) disabled = true; }
      else if (f.uses === 'pool5xlevel/long') { actionLabel += ` (${char.pools.lay_on_hands || 0})`; if ((char.pools.lay_on_hands || 0) <= 0) disabled = true; }
      btns.push(`<button class="btn small" data-classact="${f.id}" ${disabled}>${actionLabel}</button>`);
    });
    if (char.breathWeapon) btns.push(`<button class="btn small" data-classact="breath_weapon" ${myTurn ? '' : 'disabled'}>${label("ui.play.breath_weapon_values", {p1: uses.breath_weapon ?? 0})}</button>`);
    if (char.healingHands) btns.push(`<button class="btn small" data-classact="healing_hands" ${myTurn ? '' : 'disabled'}>${label("ui.play.healing_hands")}</button>`);
    if (char.className === 'ranger' && game.mode === 'combat') btns.push(`<button class="btn small" data-classact="hunters_mark_free" ${myTurn && (uses.hunters_mark_free ?? 0) > 0 ? '' : 'disabled'}>${label("ui.play.mark_prey_values", {p1: uses.hunters_mark_free ?? 0})}</button>`);
    if (char.feat === 'healer') btns.push(`<button class="btn small" data-classact="healer_feat" ${myTurn ? '' : 'disabled'}>${label("ui.play.healer_s_kit")}</button>`);
    if (char.className === 'barbarian' && char.level >= 2) btns.push(`<button class="btn small" data-classact="reckless_toggle" ${myTurn ? '' : 'disabled'}> ${label("ui.play.reckless_values", {p1: game.flags.reckless ? '☑' : '☐'})}</button>`);
    return btns.join(' ');
  }

  function wireSide(myTurn) {
    // H1: reconciled HUD nodes survive across renders carrying their listeners.
    // Every wiring below is marked data-wired so a reused node is never bound twice.
    document.querySelectorAll('[data-scene-open]').forEach(button => {
      const el = /** @type {HTMLElement} */ (button);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
        const scene = (game.scenes || []).find(s => s.id === /** @type {HTMLElement} */ (el).dataset.sceneOpen);
        if (!scene) return;
        const speakerEntity = game.entities.find(e => (scene.npcId && e.npcId === scene.npcId) || (scene.companion && e.allyId === scene.companion.id));
        activeNpc = { id: scene.npcId || scene.companion?.id || null, name: speakerEntity?.name || (scene.companion?.name) || scene.name, nameDisplay: speakerEntity?.nameDisplay || scene.companion?.nameDisplay || scene.nameDisplay };
        panels.openScene(scene.id);
      });
    });
    document.querySelectorAll('[data-quickslot]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.quickslot, 10);
        useQuickSlot(idx);
      });
    });

    document.querySelectorAll('[data-act]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
      const a = el.dataset.act;
      if (a === 'rest') act({ type: 'rest', kind: 'short' });
      if (a === 'longrest') act({ type: 'rest', kind: 'long' });
      if (a === 'potion') {
        const inv = game.character.inventory || [];
        const pot = inv.find(i => i.itemId === 'potion_healing' && i.qty > 0) || inv.find(i => i.itemId === 'potion_greater' && i.qty > 0);
        if (pot) act({ type: 'useItem', itemId: pot.itemId });
        else toast(() => t("ui.play.no_potions_left_marla_sells_more"));
      }
      if (a === 'search') act({ type: 'freeform', text: 'search the area carefully' });
      if (a === 'respawn') { summaryShown = false; act({ type: 'respawn' }); }
      if (a === 'journal') panels.openJournal();
      if (a === 'recap') act({ type: 'recap' });
      if (a === 'askwork') act({ type: 'quest' });
      if (a === 'retreat') {
        if (game.mode === 'retreat' || game.mode === 'victory') panels.openSummary();
        else act({ type: 'retreat' });
      }
      if (a === 'dodge') act({ type: 'dodge' });
      if (a === 'dash') act({ type: 'dash' });
      if (a === 'endturn') act({ type: 'endTurn' });
      if (a === 'attack') {
        if (!selectedTarget) return toast(() => t("ui.play.click_a_monster_or_object_first_to"));
        const char = game.character;
        const mainRef = (char.equipped || {}).mainHand;
        const mainAtk = char.attacks.find(x => x.weaponId === mainRef);
        const melee = (mainAtk && !mainAtk.ranged) ? mainAtk : char.attacks.find(x => !x.ranged && x.weaponId !== 'unarmed');
        const rangedAtk = (mainAtk && mainAtk.ranged) ? mainAtk : char.attacks.find(x => x.ranged);
        const atk = selectedTarget && Math.abs(player().x - selectedTarget.x) + Math.abs(player().y - selectedTarget.y) <= 1
          ? (melee || char.attacks[0])
          : (rangedAtk || char.attacks[0]);
        act({ type: 'attack', targetId: selectedTarget.id, weaponId: atk.weaponId });
      }
      if (a === 'castmenu') {
        renderCastMenu();
        if (mapFirst) {
          if (panelManager.current() !== 'character') panelManager.open('character', el);
          document.getElementById('castMenu')?.scrollIntoView({ block:'nearest' });
        }
      }
      });
    });
    document.querySelectorAll('[data-classact]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
      const id = el.dataset.classact;
      const action = { type: 'classAction', id, targetId: selectedTarget ? selectedTarget.id : null };
      if (id === 'cunning_action') {
        const mode = prompt(t("ui.play.cunning_action_type_dash_disengage_hide"), 'dash');
        if (!mode) return; action.mode = mode;
      }
      if (id === 'step_of_wind') {
        const mode = prompt(t("ui.play.step_of_the_wind_type_dash_disengage"), 'dash');
        if (!mode) return; action.mode = mode;
      }
      if (id === 'divine_spark') {
        const mode = prompt(t("ui.play.divine_spark_type_attack_heal"), 'attack');
        if (!mode) return; action.mode = mode;
        if (mode === 'attack' && !selectedTarget) return toast(() => t("ui.play.target_a_monster_first"));
      }
      if (id === 'hunters_mark_free' && !selectedTarget) return toast(() => t("ui.play.target_a_monster_first"));
      act(action);
      });
    });

    const btnLvl = document.getElementById('btnDelveLevelUp');
    if (btnLvl) {
      btnLvl.onclick = () => {
        openLevelUpModal(game.character.id, async (upd) => {
          if (!viewAlive) return;
          game.character = upd;
          // re-read the server's level-up verdict so the badge reflects the new level —
          // through adoptState: an older snapshot must not roll the board back (T2a)
          try {
            const fresh = await api.getGame(game.id);
            adoptState(fresh.state);
          } catch {}
          update();
          toast(() => t('ui.common.levelApplied', { level: upd.level }));
        });
      };
    }

    const btnOpenInv = document.getElementById('btnOpenDelveInventory');
    if (btnOpenInv && !btnOpenInv.dataset.wired) {
      btnOpenInv.dataset.wired = '1';
      btnOpenInv.addEventListener('click', () => delveInv.openDelveInventoryModal());
    }

    const toggleQuestFold = document.getElementById('toggleQuestFoldBtn');
    if (toggleQuestFold && !toggleQuestFold.dataset.wired) {
      toggleQuestFold.dataset.wired = '1';
      toggleQuestFold.addEventListener('click', () => {
        questObjectiveFolded = !questObjectiveFolded;
        renderSide();
      });
    }

    document.querySelectorAll('[data-clarify-idx]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.clarifyIdx, 10);
        const cand = pendingClarification?.candidates?.[idx];
        pendingClarification = null;
        update();
        if (cand?.action) act(cand.action);
      });
    });
    document.querySelectorAll('[data-clarify-cancel]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
        pendingClarification = null;
        update();
      });
    });
    document.querySelectorAll('[data-confirm-action]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
        const conf = pendingConfirmation;
        pendingConfirmation = null;
        update();
        if (conf?.action) act(conf.action);
      });
    });
    document.querySelectorAll('[data-confirm-cancel]').forEach(b => {
      const el = /** @type {HTMLElement} */ (b);
      if (el.dataset.wired) return;
      el.dataset.wired = '1';
      el.addEventListener('click', () => {
        pendingConfirmation = null;
        update();
      });
    });
  }

  function renderCastMenu() {
    const menu = document.getElementById('castMenu');
    const char = game.character;
    if (!char.spellcasting) return;
    const names = id => (appState.rules.spells.find(s => s.id === id) || {});
    const cantrips = char.spellcasting.cantrips.map(names).filter(Boolean);
    const spells = char.spellcasting.spells.map(names).filter(s => s.id);
    const free = char.spellcasting.freeSpell && char.spellcasting.freeSpell.id && char.freeSpellUses < char.spellcasting.freeSpell.max
      ? [names(char.spellcasting.freeSpell.id)] : [];
    menu.innerHTML = `
      <div style="margin-top:8px; border-top:1px solid var(--border); padding-top:8px;">
        <label>${label("ui.play.cantrips")}</label>
        <div class="action-grid">${cantrips.map(s => `<button class="btn small" data-cast="${s.id}">${contentLabel(s,"name")}</button>`).join('') || '<span class="muted small">' + label('ui.delve-inventory.none') + '</span>'}</div>
        ${spells.length || free.length ? `<label style="margin-top:6px;">${label(free.length ? "ui.play.spellSlotsFree" : "ui.play.spellSlots", { slots: char.slots[1] || 0 })}</label>
        <div class="action-grid">${[...free, ...spells].map(s => `<button class="btn small" data-cast="${s.id}">${contentLabel(s,"name")}${free.some(f => f.id === s.id) ? ' ✨' : ''}</button>`).join('')}</div>` : ''}
      </div>`;
    menu.querySelectorAll('[data-cast]').forEach(b => b.addEventListener('click', () => {
      const spell = appState.rules.spells.find(s => s.id === /** @type {HTMLButtonElement} */ (b).dataset.cast);
      if (['self', 'flavor'].includes(spell.target)) act({ type: 'cast', spellId: spell.id });
      else if (!selectedTarget) toast(() => t("ui.play.target_a_monster_or_object_first_or"));
      else act({ type: 'cast', spellId: spell.id, targetId: spell.target === 'ally' ? 'player' : selectedTarget.id });
      menu.innerHTML = '';
    }));
  }

  function renderLog() {
    const el = document.getElementById('logEntries');
    el.innerHTML = game.log.map(l => `<div class="log-entry ${esc(l.kind)}">${messageLabel(l)}${!l.messageKey && !l.textDisplay && !l.language ? ' <small class="muted">'+label('content.history')+'</small>' : ''}</div>`).join('');
    el.scrollTop = el.scrollHeight;
    localizeText(document.getElementById('logPreview'), () => (game.log || []).slice(-2).map(messageText).join(' · '));
    const input = /** @type {HTMLInputElement} */ (document.getElementById('chatInput'));
    localizeAttribute(input, "placeholder", () => activeNpc ? t("ui.play.speakTo", { name: (activeNpc.nameDisplay || activeNpc.name) }) : t("ui.play.describe_an_action_search_the_room_listen"));
  }

  update();
  renderLog();
  tutorial.maybeStart(game); // T5: attach the first-delve coach (no-op once done/skipped)
  relayoutTutorial();

  // poll while enemies might be acting (cheap: only in combat, 4s)
  const pollTimer = setInterval(async () => {
    if (busy || !game || !viewAlive) return;
    try {
      const data = await api.getGame(game.id);
      if (!viewAlive) return; // the view ended while this GET was in flight
      // rev changes on every persisted write — mechanics AND slow narration merges — so
      // the DM's late prose shows up here even when no entity has moved (T2).
      // adoptState, never a bare assign: a stale GET that lands after newer actions must
      // not roll the board back (T2a — the exact bug the review reproduced)
      if (data.state && adoptState(data.state)) update();
    } catch {}
  }, 4000);

  function refreshLocalizedText() { translateDOM(main); updateHoverCues(currentHoverTile); }
  const stopLocale = onLocaleChange(refreshLocalizedText);
  return navigation.onDispose(() => {
    stopLocale();
    viewAlive = false;
    clearInterval(pollTimer);
    tutorial.destroy(); // T5 coach goes down with the view (progress persists in localStorage)
    panelManager.destroy();
    document.removeEventListener('keydown', onKey);
    tts.stop();
    sfx.stopAmbient();
    document.body.classList.remove('immersive', 'map-first');
    if (renderer3d) renderer3d.dispose();
    if (settingsLink) settingsLink.removeEventListener('click', onSettingsNav, true);
    document.querySelectorAll('.modal-back').forEach(m => { m.dispatchEvent(new Event('game:dispose')); m.remove(); });
  });
}
