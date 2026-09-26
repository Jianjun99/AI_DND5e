// play.js — the delve: canvas map, combat HUD, log, chat
import { api } from '../api.js';
import { esc, toast, state as appState, charObjective, campaignObjective } from '../app.js';
import { createMapRenderer } from '../map.js';
import { createMap3D } from '../map3d.js';
import { openSettingsModal } from './settings.js';
import { showDice, rollAnimated } from '../dice.js';
import { sfx } from '../sfx.js';
import { tts } from '../tts.js';
import { initTooltips } from '../tooltip.js';
import { openLevelUpModal } from './levelup.js';

// Level-up readiness comes from the server (game.levelUp) so the badge can never claim a
// level the level-up endpoint would refuse — see engine.levelUpInfo.

let game = null;
let selectedTarget = null;
let activeNpc = null;
let appearanceShown = null;
let summaryShown = false;
let questObjectiveFolded = false;
let busy = false;

export async function playView(main, saveRef) {
  // Start a fresh delve: show the setup modal (map + difficulty + companion)
  if (saveRef === 'new') {
    const charId = new URLSearchParams(location.hash.split('?')[1] || '').get('char');
    if (!charId) { location.hash = '#/'; return; }
    const chars = await api.listCharacters();
    const char = chars.find(c => c.id === charId);
    const rules = appState.rules;
    let maps = [];
    try { maps = (await (await fetch('/api/content')).json()).maps || []; } catch {}
    main.innerHTML = `
      <div class="modal-back" style="position:static; background:none; display:block; padding-top:30px;">
        <div class="modal" style="max-width:680px; margin:0 auto;">
          <h2>Prepare the delve</h2>
          <p class="muted small">${esc(char ? char.name : 'Your hero')} gathers supplies. Choose where to descend:</p>
          <div class="card" style="margin:12px 0;">
            <h3>Destination</h3>
            ${maps.map((m, i) => `
              <label style="display:block; margin:8px 0; color:var(--text); cursor:pointer;">
                <input type="radio" name="mapPick" value="${esc(m.id)}" ${i === 0 ? 'checked' : ''} style="width:auto">
                <b>${esc(m.name)}</b> <span class="chip">${esc(m.pack)}</span>
                ${m.recommended ? `<span class="chip blue">${esc(m.recommended)}</span>` : ''}
                <span class="muted small">— ${esc(m.blurb || m.objectiveText || '')}</span>
              </label>`).join('')}
          </div>
          <div class="card" style="margin:12px 0;">
            <h3>Difficulty</h3>
            ${Object.entries(rules.difficulty || {}).map(([id, d]) => `
              <label style="display:block; margin:8px 0; color:var(--text);">
                <input type="radio" name="difficulty" value="${id}" ${id === 'normal' ? 'checked' : ''} style="width:auto">
                <b>${d.label}</b> <span class="muted small">— ${esc(d.blurb)}</span>
              </label>`).join('')}
          </div>
          <div class="card" style="margin:12px 0;">
            <h3 style="margin-top:0;">Mercenary Companion</h3>
            ${((rules.allies && rules.allies.length) ? rules.allies : [{ id: 'bram', name: 'Bram the Scout', role: 'Ranger / Archer', icon: '🏹', blurb: 'A wiry hunter who strikes from the dark with a longbow.' }]).map((a, i) => `
              <label style="display:block; margin:8px 0; color:var(--text); cursor:pointer;">
                <input type="radio" name="companionPick" value="${a.id}" ${i === 0 ? 'checked' : ''} style="width:auto">
                ${a.icon || '🏹'} <b>${esc(a.name)}</b> <span class="chip blue" style="font-size:11px; padding:1px 6px;">${esc(a.role || 'Companion')}</span>
                <div class="muted small" style="margin-left:22px;">${esc(a.blurb || '')}</div>
              </label>`).join('')}
            <label style="display:block; margin:8px 0; color:var(--text); cursor:pointer;">
              <input type="radio" name="companionPick" value="none" style="width:auto">
              👤 <b>Solo Expedition</b> <span class="muted small">— Brave the crypt alone (hardcore challenge)</span>
            </label>
          </div>
          <button class="btn primary big" id="beginBtn" style="width:100%;">⚔ Descend</button>
        </div>
      </div>`;
    document.getElementById('beginBtn').addEventListener('click', async () => {
      const mapId = (document.querySelector('input[name="mapPick"]:checked') || {}).value || 'crypt';
      const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
      const companionChoice = (document.querySelector('input[name="companionPick"]:checked') || {}).value || 'bram';
      const bringAlly = companionChoice === 'none' ? false : companionChoice;
      try {
        const { state } = await api.startGame(charId, { bringAlly, difficulty, mapId });
        location.hash = `#/play/${state.id}`;
      } catch (e) { toast(e.message); }
    });
    return () => {};
  }
  const data = await api.getGame(saveRef);
  game = data.state;
  const mapTheme = (game.map && game.map.theme) || (game.mapId && game.mapId.includes('vault') ? 'vault' : game.mapId && game.mapId.includes('hills') ? 'hills' : 'crypt');
  if (game.mode === 'combat') {
    sfx.startAmbient('combat');
  } else {
    sfx.startAmbient(mapTheme);
  }
  selectedTarget = null; activeNpc = null; appearanceShown = null;

  main.innerHTML = `
    <div class="play-layout">
      <div>
        <div class="map-wrap" id="mapWrap">
          <div id="map3d"></div>
          
          <!-- 2D Minimap (Corner overlay in 3D mode, full in 2D mode) -->
          <div id="minimapContainer" class="minimap-container">
            <div class="minimap-header">
              <span class="minimap-title">🧭 ${esc(game.mapName)}</span>
              <div class="minimap-controls">
                <button class="minimap-btn" id="cameraFollowBtn" title="Camera follows your hero (click for a free camera · right-drag to pan · F)">🎥 跟随</button>
                <button class="minimap-btn" id="minimapExpandBtn" title="Toggle Minimap Size">⤢</button>
                <button class="minimap-btn" id="viewToggleMinimap" title="Switch to Full 2D View">2D Full</button>
              </div>
            </div>
            <div class="minimap-body">
              <canvas id="mapCanvas"></canvas>
            </div>
          </div>

          <!-- Tactical Combat Initiative Tracker Ribbon -->
          <div class="initiative-ribbon-container" id="initiativeRibbonContainer" style="display:none;"></div>

          <div id="fctLayer" class="fct-layer"></div>
          <div class="delve-guidance-hud" id="delveGuidanceHud">
            <div class="guidance-main-row">
              <div class="guidance-status-group">
                <span class="guidance-mode-pill" id="guidanceModePill">🧭 Exploration</span>
                <span class="guidance-movement-pill" id="guidanceMovementPill">👣 30 ft (6 tiles)</span>
                <span class="guidance-objective-pill" id="guidanceObjectivePill">🎯 ${esc(charObjective(game))}</span>
              </div>
            </div>
            <div class="guidance-hover-bar" id="guidanceHoverBar">
              <span class="guidance-hover-icon" id="guidanceHoverIcon">💡</span>
              <span class="guidance-hover-text" id="guidanceHoverText">Click a highlighted tile to move · Click a monster or chest to interact · WASD to step</span>
            </div>
          </div>
          <button class="btn small" id="viewToggle2D" style="display:none; position:absolute; top:8px; right:10px; z-index:5;">🏰 3D View</button>
        </div>
        <div class="log-panel">
          <div class="log-entries" id="logEntries"></div>
          <div class="chat-bar">
            <input type="text" id="chatInput" placeholder="${activeNpc ? 'Speak to ' + esc(activeNpc.name) + '…' : 'Describe an action — "search the room", "listen at the door", "hide in the shadows"…'}">
            <button class="btn primary" id="chatSend">Send</button>
            ${activeNpc ? '<button class="btn small" id="chatExit">End chat</button>' : ''}
          </div>
        </div>
      </div>
      <div class="side-panel" id="sidePanel"></div>
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
        modePill.textContent = `⚔️ Your Turn (Rnd ${game.combat.round})`;
      } else {
        modePill.className = 'guidance-mode-pill combat-enemy';
        modePill.textContent = `🛡️ Enemies Acting (Rnd ${game.combat.round})`;
      }
      const mvLeft = game.combat?.movementLeft ?? 0;
      movePill.textContent = `👣 ${mvLeft} ft (${Math.floor(mvLeft / 5)} tiles)`;
    } else if (game.mode === 'over') {
      modePill.className = 'guidance-mode-pill combat-enemy';
      modePill.textContent = '💀 Defeated';
      movePill.textContent = '👣 0 ft';
    } else if (game.mode === 'victory') {
      modePill.className = 'guidance-mode-pill';
      modePill.textContent = '🏆 Victorious';
      movePill.textContent = '👣 Complete';
    } else if (cleared) {
      modePill.className = 'guidance-mode-pill';
      modePill.style.background = 'rgba(201, 169, 89, 0.25)';
      modePill.style.color = 'var(--gold)';
      modePill.style.borderColor = 'var(--gold)';
      modePill.textContent = '🏆 Delve Cleared!';
      const sp = player()?.speedFt || game.character?.speedFt || 30;
      movePill.textContent = `👣 ${sp} ft (${Math.floor(sp / 5)} tiles)`;
    } else {
      modePill.className = 'guidance-mode-pill';
      modePill.style.background = '';
      modePill.style.color = '';
      modePill.style.borderColor = '';
      modePill.textContent = '🧭 Exploration';
      const sp = player()?.speedFt || game.character?.speedFt || 30;
      movePill.textContent = `👣 ${sp} ft (${Math.floor(sp / 5)} tiles)`;
    }

    if (objPill) {
      const mainStep = campaignObjective(game);
      if (cleared && game.mode !== 'over') {
        objPill.innerHTML = `🌟 <b>Delve Cleared:</b> Head to Campfire / Entrance to Return to Town`;
      } else if (mainStep) {
        // the main story takes precedence over the local dungeon objective
        objPill.innerHTML = `📜 <b>${esc(game.campaign.actName || '主线')}</b> ${esc(mainStep.text)}`;
      } else {
        objPill.textContent = `🎯 ${charObjective(game)}`;
      }
    }

    if (!tile) {
      hoverIcon.textContent = '💡';
      if (cleared && game.mode !== 'combat' && game.mode !== 'over') {
        hoverIcon.textContent = '🌟';
        hoverText.innerHTML = '<b>Delve Cleared!</b> All monsters slain. Follow the golden beacon light back to the Campfire or click <b>"Return to Oakhaven"</b>.';
      } else if (game.mode === 'combat') {
        const myTurn = !game.combat || game.combat.order[game.combat.turnIdx]?.id === 'player';
        hoverText.innerHTML = myTurn
          ? '<b>Your Turn!</b> Click a blue tile to move, click a monster to target, or select an action. Press <span class="guidance-action-key">SPACE</span> to end turn.'
          : 'Enemies are currently executing their actions...';
      } else {
        hoverText.innerHTML = 'Click any floor tile or use <span class="guidance-action-key">WASD</span> to move. Click monsters, chests, or doors to interact.';
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
      hoverText.innerHTML = `<b>${esc(ent.name)}</b> (${ent.hp}/${ent.hpMax} HP, AC ${ent.ac || 10}) — ${inMelee ? 'In Melee Range! <b>Click to Target / Attack</b>' : `Distance: ${dist * 5} ft. <b>Click to Target</b>`}`;
      return;
    }

    if (ent && ent.kind === 'npc' && isLit) {
      hoverIcon.textContent = '🗣️';
      hoverText.innerHTML = `<b>${esc(ent.name)}</b> — Click to Talk / Trade`;
      return;
    }

    if (ent && ent.kind === 'ally') {
      hoverIcon.textContent = '🏹';
      hoverText.innerHTML = `<b>${esc(ent.name)}</b> (${ent.hp}/${ent.hpMax} HP) — Companion`;
      return;
    }

    const obj = (game.objects || []).find(o => o.x === x && o.y === y && o.type !== 'npcMarker');
    if (obj && isLit) {
      const dist = p ? Math.abs(p.x - x) + Math.abs(p.y - y) : 99;
      if (obj.type === 'door') {
        hoverIcon.textContent = '🚪';
        hoverText.innerHTML = `<b>Door (${obj.open ? 'Open' : 'Closed'})</b> — ${dist <= 1 ? 'Click to Open / Close' : 'Move closer to open'}`;
        return;
      }
      if (obj.type === 'chest') {
        hoverIcon.textContent = '🧰';
        if (obj.looted) hoverText.innerHTML = `<b>Empty Chest</b> (Already looted)`;
        else if (obj.locked && !obj.unlocked) hoverText.innerHTML = `<b>Locked Chest</b> — ${dist <= 1 ? 'Click to Pick Lock or Force Open' : 'Move closer to unlock'}`;
        else hoverText.innerHTML = `<b>Unlocked Chest</b> — ${dist <= 1 ? 'Click to Open & Loot' : 'Move closer to loot'}`;
        return;
      }
      if (obj.type === 'barrel') {
        hoverIcon.textContent = '🛢️';
        hoverText.innerHTML = obj.exploded ? `<b>Shattered Barrel</b>` : `<b>Explosive Powder Keg</b> — Click to Target / Detonate with Attack`;
        return;
      }
      if (obj.type === 'trap') {
        hoverIcon.textContent = '⚠️';
        hoverText.innerHTML = `<b>Concealed Trap</b> — ${dist <= 1 ? 'Click to Disarm (DC ' + (obj.dc || 12) + ')' : 'Hazardous mechanism'}`;
        return;
      }
      if (obj.type === 'font') {
        hoverIcon.textContent = '⛲';
        hoverText.innerHTML = `<b>Ancient Shrine Font</b> — ${obj.used ? 'Depleted' : 'Click to Drink & receive blessing'}`;
        return;
      }
      if (obj.type === 'lever') {
        hoverIcon.textContent = '🕹️';
        hoverText.innerHTML = `<b>Iron Lever</b> — Click to Pull`;
        return;
      }
      if (obj.type === 'stairs') {
        hoverIcon.textContent = '🪜';
        hoverText.innerHTML = `<b>Stone Stairway</b> — Descend deeper into the dungeon`;
        return;
      }
    }

    const rSet = new Set(game.reachableTiles || []);
    if (rSet.has(x + ',' + y)) {
      hoverIcon.textContent = '👣';
      const steps = p ? Math.abs(x - p.x) + Math.abs(y - p.y) : 0;
      hoverText.innerHTML = `<b>Move to (${x}, ${y})</b> — ${steps * 5} ft (${steps} tiles). <b>Click to Move</b>`;
      return;
    }

    if (game.map?.rows[y]?.[x] === '#') {
      hoverIcon.textContent = '🧱';
      hoverText.innerHTML = `<b>Dungeon Wall</b> — Impassable solid stone`;
      return;
    }

    hoverIcon.textContent = '🚫';
    hoverText.innerHTML = `<b>Tile (${x}, ${y})</b> — Beyond current movement range this turn`;
  }

  const canvas = document.getElementById('mapCanvas');
  const renderer = createMapRenderer(canvas, {
    isSelected: e => selectedTarget && e.id === selectedTarget.id,
    onTileHover: t => updateHoverCues(t)
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
    followBtn.textContent = camFollow ? '🎥 跟随' : '🎥 自由';
    followBtn.classList.toggle('active', camFollow);
    followBtn.title = camFollow
      ? 'Camera is bound to your hero — click to free it (right-drag to pan, F)'
      : 'Free camera — right-drag to pan, wheel to zoom, click to re-centre on your hero (F)';
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
          onTileClick: (x, y) => handleTileClick(x, y),
          onTileHover: t => updateHoverCues(t),
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
    const t = renderer.tileFromEvent(ev);
    if (t) handleTileClick(t.x, t.y);
  });

  // Test seam: the e2e suite inspects camera binding and the board through here.
  window.__dndDebug = {
    camera: () => (renderer3d && renderer3d.debugState ? renderer3d.debugState() : null),
    follow: () => camFollow,
    boardCount: () => (game && game.entities ? game.entities.filter(e => e.kind === 'player' || (e.alive !== false && !e.fled)).length : 0),
    playerTile: () => { const p = player(); return p ? { x: p.x + 0.5, z: p.y + 0.5 } : null; },
    levelUp: () => (game && game.levelUp) || null,
    badgeShown: () => !!document.getElementById('btnDelveLevelUp'),
    modelState: () => (renderer3d && renderer3d.modelState ? renderer3d.modelState() : null)
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      const openModals = document.querySelectorAll('.modal-back');
      if (openModals.length > 0) {
        e.preventDefault();
        openModals.forEach(m => m.remove());
        return;
      }
    }
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
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
      if (existing) existing.remove();
      else openDelveInventoryModal();
    }
    if ((e.key === 'f' || e.key === 'F') && activeView === '3d') {
      e.preventDefault();
      setFollow(!camFollow);
    }
  };
  document.addEventListener('keydown', onKey);

  document.getElementById('chatSend').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

  function sendChat() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (activeNpc) act({ type: 'chat', npcId: activeNpc.id, text });
    else act({ type: 'freeform', text });
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
    const key = ent.kind === 'monster' ? ent.monsterId : ent.npcId;
    game.appearances = game.appearances || {};
    if (game.appearances[key]) { appearanceShown = game.appearances[key]; update(); } else {
      try {
        const res = await api.gameAction(game.id, { type: 'describe', targetId: ent.id });
        game = res.state;
        appearanceShown = res.appearance || null;
        update();
      } catch { /* appearance is optional flavor */ }
    }
    fetchPortrait(ent);
  }

  // Fetch (and cache server-side) a painted portrait: AI image → SD WebUI → procedural sigil
  async function fetchPortrait(ent) {
    const key = ent.kind === 'monster' ? ent.monsterId : ent.npcId;
    game.portraits = game.portraits || {};
    if (game.portraits[key]) { update(); return; }
    try {
      const res = await api.gameAction(game.id, { type: 'portrait', targetId: ent.id });
      game = res.state;
      if (res.portrait && res.portrait.url) {
        game.portraits[key] = res.portrait;
        update();
      }
    } catch { /* portraits are optional flavor */ }
  }

  // Marla's shop
  function openShop(merchantName = 'Marla the Peddler', merchantId = 'marla') {
    let modal = document.getElementById('shopModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'shopModal';
      document.body.appendChild(modal);
    }
    const items = appState.rules.shop || [];
    const render = () => {
      modal.innerHTML = `
        <div class="modal">
          <h2>🧺 ${esc(merchantName)}</h2>
          <p class="muted small">"Potions, tools, and luck, dear — I sell the first two."</p>
          <p class="small">Your gold: <b style="color:var(--gold)">${game.character.gold} gp</b></p>
          ${items.map(i => `
            <div class="stat-line" data-item-tooltip="${i.id}" style="cursor:help;"><span>${i.name} <span class="muted small">— ${esc(i.desc)}</span></span>
              <span><button class="btn small" data-buy="${i.id}" ${game.character.gold >= i.price ? '' : 'disabled'}>${i.price} gp</button></span></div>`).join('')}
          <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
            <button class="btn small" id="talkMarla">💬 Talk to the trader</button>
            <button class="btn small" id="closeShop">Leave</button>
          </div>
        </div>`;
      initTooltips(modal, appState.rules);
      modal.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
        await act({ type: 'buy', itemId: b.dataset.buy });
        render();
      }));
      document.getElementById('closeShop').addEventListener('click', () => modal.remove());
      document.getElementById('talkMarla').addEventListener('click', () => {
        activeNpc = { id: merchantId, name: merchantName };
        modal.remove();
        update();
        document.getElementById('chatInput')?.focus();
      });
    };
    render();
  }

  // The adventurer's journal (LLM-written recaps)
  function openJournal() {
    const entries = game.journal || [];
    let modal = document.getElementById('journalModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'journalModal';
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="modal" style="text-align:left; max-height:80vh; overflow-y:auto;">
        <h2>📖 Adventurer's Journal</h2>
        ${entries.length ? entries.map(e2 => `
          <div class="card" style="margin:10px 0; background:var(--bg2);">
            <p class="small muted" style="margin-bottom:6px;">${new Date(e2.ts).toLocaleString()}</p>
            <p style="font-family:var(--font-serif); font-size:14.5px;">${esc(e2.text)}</p>
          </div>`).join('')
        : '<p class="muted" style="margin:14px 0;">Your journal is empty. Write an entry at the campfire — every long rest adds one.</p>'}
        ${(game.quests?.completed || []).length ? `
          <h3 style="margin-top:14px;">📜 Completed side quests</h3>
          ${game.quests.completed.map(q => `<div class="stat-line"><span>${esc(q.shortText)}</span><span>+${q.reward.gold} gp · +${q.reward.xp} XP</span></div>`).join('')}` : ''}
        <div style="text-align:center; margin-top:12px;">
          <button class="btn small" id="closeJournal">Close</button>
        </div>
      </div>`;
    document.getElementById('closeJournal').addEventListener('click', () => modal.remove());
  }

  function openSkillCheckModal(obj) {
    let modal = document.getElementById('skillCheckModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'skillCheckModal';
      document.body.appendChild(modal);
    }
    const char = game.character;
    const isTrap = obj.type === 'trap';
    const strMod = Math.floor(((char.abilities?.str || 10) - 10) / 2);
    const dexMod = Math.floor(((char.abilities?.dex || 10) - 10) / 2);
    const profBonus = Math.floor(((char.level || 1) - 1) / 4) + 2;
    const hasTools = (char.inventory || []).some(i => i.itemId === 'thieves_tools' || i.itemId === 'tool_thieves');
    const hasSleight = (char.skills || []).includes('sleight_of_hand');
    const hasAthletics = (char.skills || []).includes('athletics');

    const pickMod = dexMod + ((hasTools || hasSleight) ? profBonus : 0);
    const forceMod = strMod + (hasAthletics ? profBonus : 0);
    const disarmMod = dexMod + ((hasTools || hasSleight) ? profBonus : 0);

    const pickDc = obj.pickDc || 12;
    const forceDc = obj.forceDc || 14;
    const trapDc = obj.dc || 12;

    const render = () => {
      if (isTrap) {
        modal.innerHTML = `
          <div class="modal" style="max-width:440px;">
            <h2>⚠️ ${esc(obj.name || 'Concealed Trap')}</h2>
            <p class="small muted">A mechanical hazard is revealed before you. You can attempt to disable its triggers, but tripping it will detonate the mechanism.</p>
            <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px; margin:12px 0;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span><b>Disarm Mechanism</b></span>
                <span class="badge" style="color:var(--accent);">DC ${trapDc}</span>
              </div>
              <p class="small muted" style="margin:0 0 10px 0;">Sleight of Hand: DEX (${dexMod >= 0 ? '+'+dexMod : dexMod})${hasTools ? ' + ' + profBonus + ' Tools' : hasSleight ? ' + ' + profBonus + ' Prof' : ''} = <b>${disarmMod >= 0 ? '+'+disarmMod : disarmMod}</b></p>
              <button class="btn primary" id="btnDisarm" style="width:100%;">🎲 Roll d20 Disarm Check</button>
            </div>
            <div style="text-align:center; margin-top:8px;">
              <button class="btn small" id="closeSkillModal">Step Away</button>
            </div>
          </div>`;
      } else {
        modal.innerHTML = `
          <div class="modal" style="max-width:460px;">
            <h2>🔒 ${esc(obj.name || 'Locked Chest')}</h2>
            <p class="small muted">The iron hinges and lock hold firm against casual inspection. Choose an approach to crack the lock.</p>
            <div style="display:flex; flex-direction:column; gap:10px; margin:14px 0;">
              <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span>🗝️ <b>Pick Tumbler Lock</b></span>
                  <span class="badge" style="color:var(--accent);">DC ${pickDc}</span>
                </div>
                <p class="small muted" style="margin:0 0 10px 0;">Sleight of Hand: DEX (${dexMod >= 0 ? '+'+dexMod : dexMod})${hasTools ? ' + ' + profBonus + ' Tools' : hasSleight ? ' + ' + profBonus + ' Prof' : ''} = <b>${pickMod >= 0 ? '+'+pickMod : pickMod}</b></p>
                <button class="btn" id="btnPick" style="width:100%;">🎲 Pick Lock (Roll d20 + ${pickMod})</button>
              </div>

              <div style="background:var(--bg-box); border:1px solid var(--border); border-radius:8px; padding:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span>🔨 <b>Pry / Shatter Lock</b></span>
                  <span class="badge" style="color:var(--accent);">DC ${forceDc}</span>
                </div>
                <p class="small muted" style="margin:0 0 10px 0;">Athletics / Force: STR (${strMod >= 0 ? '+'+strMod : strMod})${hasAthletics ? ' + ' + profBonus + ' Prof' : ''} = <b>${forceMod >= 0 ? '+'+forceMod : forceMod}</b></p>
                <button class="btn" id="btnForce" style="width:100%;">🔨 Force Open (Roll d20 + ${forceMod})</button>
              </div>
            </div>
            <div style="text-align:center; margin-top:8px;">
              <button class="btn small" id="closeSkillModal">Leave Chest</button>
            </div>
          </div>`;
      }

      document.getElementById('closeSkillModal').addEventListener('click', () => modal.remove());

      if (isTrap) {
        document.getElementById('btnDisarm').addEventListener('click', async () => {
          document.getElementById('btnDisarm').disabled = true;
          const nat = await rollAnimated(20, 'Disarm Trap');
          const total = nat + disarmMod;
          modal.remove();
          await act({ type: 'skillCheckObject', objectId: obj.id, rollTotal: total });
        });
      } else {
        document.getElementById('btnPick').addEventListener('click', async () => {
          document.getElementById('btnPick').disabled = true;
          const nat = await rollAnimated(20, 'Pick Lock');
          const total = nat + pickMod;
          modal.remove();
          await act({ type: 'skillCheckObject', objectId: obj.id, method: 'pick', rollTotal: total });
        });
        document.getElementById('btnForce').addEventListener('click', async () => {
          document.getElementById('btnForce').disabled = true;
          const nat = await rollAnimated(20, 'Force Lock');
          const total = nat + forceMod;
          modal.remove();
          await act({ type: 'skillCheckObject', objectId: obj.id, method: 'force', rollTotal: total });
        });
      }
    };
    render();
  }

  const SFX_MAP = {
    attack: 'attack', attack_in: 'attack', spell_hit: 'spell', cast_flavor: 'spell', save: 'dice',
    combat_start: 'dice', miss: 'miss', heal: 'heal', levelup: 'levelup', subclass: 'levelup',
    travel: 'travel_stairs', equip: 'equip', level_ready: 'levelup',
    quest_done: 'quest', quest_offer: 'quest', loot: 'coin', magic_item: 'coin', trap: 'trap',
    trap_spotted: 'trap', trap_disarmed: 'victory', trap_disarm_failed: 'trap',
    chest_unlocked: 'chest_open', chest_locked: 'miss',
    dying: 'death', player_down: 'death', victory: 'victory', door: 'door', blessing: 'heal',
    barrel_detonate: 'barrel_boom', hazard_burn: 'hazard_burn', parry: 'parry', stealth: 'stealth', retreat: 'retreat'
  };

  function showFloorBanner(title, subtitle) {
    const existing = document.querySelector('.floor-banner-overlay');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'floor-banner-overlay';
    banner.innerHTML = `
      <div class="floor-banner-frame">
        <div class="floor-banner-depth">DEPTH TRANSITION</div>
        <div class="floor-banner-title">${esc(title)}</div>
        <div class="floor-banner-sub">${esc(subtitle || 'The darkness recedes as you step deeper into the ancient chambers.')}</div>
      </div>
    `;
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.remove(); }, 3600);
  }

  function updateInitiativeRibbon() {
    const container = document.getElementById('initiativeRibbonContainer');
    if (!container) return;
    if (game.mode !== 'combat' || !game.combat || !game.combat.order || !game.combat.order.length) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    const c = game.combat;
    const cardsHtml = c.order.map((o, idx) => {
      const isPlayer = o.id === 'player';
      const ent = isPlayer ? game.entities.find(e => e.kind === 'player') : game.entities.find(e => e.id === o.id);
      const hp = ent ? (ent.hp ?? 1) : 1;
      const hpMax = ent ? (ent.hpMax ?? 1) : 1;
      const pct = Math.max(0, Math.min(100, Math.round((hp / hpMax) * 100)));
      const isDead = ent && ent.alive === false;
      const isActive = idx === c.turnIdx;
      const fillClass = pct < 25 ? 'danger' : pct < 50 ? 'warn' : '';
      const avatar = isPlayer ? '🧙' : (ent?.icon || (isDead ? '💀' : '👾'));
      const elite = !isPlayer && ent && ent.isElite;
      const eliteTag = elite
        ? `<span class="elite-monster-label" style="--elite-color:${esc((ent.affix && ent.affix.color) || '#f59e0b')}" title="${esc((ent.affix && ent.affix.desc) || 'Elite Champion')}">★ ${esc((ent.affix && ent.affix.name) || '')}</span>`
        : '';
      return `
        <div class="initiative-card ${isActive ? 'active' : ''} ${isDead ? 'dead' : ''} ${elite ? 'elite' : ''}" data-target-id="${o.id}" title="${esc(o.name)} (${hp}/${hpMax} HP, AC ${ent?.ac || 10}, Init ${o.total})${elite ? ' — ' + esc((ent.affix && ent.affix.desc) || 'Elite Champion') : ''}">
          <div class="init-avatar-token">${isDead ? '💀' : avatar}</div>
          <div class="init-info-col">
            <div class="init-name-row">
              <span class="init-combatant-name">${esc(o.name.split(' ')[0])}</span>
              ${eliteTag}
              <span class="init-score-badge">${o.total}</span>
            </div>
            <div class="init-hp-track">
              <div class="init-hp-fill ${fillClass}" style="width:${pct}%;"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="initiative-ribbon">
        <div class="initiative-round-tag">⚔ Rnd ${c.round}</div>
        ${cardsHtml}
      </div>
    `;

    container.querySelectorAll('.initiative-card:not(.dead)').forEach(card => {
      card.onclick = () => {
        const targetId = card.dataset.targetId;
        if (targetId && targetId !== 'player') {
          const ent = game.entities.find(e => e.id === targetId);
          if (ent && ent.alive !== false) {
            selectedTarget = ent;
            appearanceShown = (game.appearances || {})[ent.monsterId] || null;
            update();
            sfx.play('dice');
          }
        }
      };
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
    if (busy) return;
    busy = true;
    const logLen = game.log.length;
    const prevMode = game.mode;
    try {
      const res = await api.gameAction(game.id, action);
      game = res.state;
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
        showFloorBanner(game.mapName || 'New Chamber', travelEv.text);
        sfx.play('travel_stairs');
      }
      // dice flourish on notable rolls
      const dmg = res.events.find(e => ['attack', 'spell_hit', 'attack_in', 'save'].includes(e.type));
      if (dmg && dmg.data && dmg.data.dmg) showDice(20, dmg.data.dmg, 'damage');
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
            spawnFloatingText(x, y, (e.data.crit ? '💥 CRIT! -' : '-') + e.data.dmg, e.data.crit ? 'crit' : 'damage');
          } else if (e.type === 'save' && e.data?.dmg) {
            spawnFloatingText(x, y, `-${e.data.dmg}`, 'damage');
          } else if (e.type === 'miss') {
            spawnFloatingText(x, y, 'MISS', 'miss');
          } else if (e.type === 'heal' && e.data?.heal) {
            spawnFloatingText(x, y, `+${e.data.heal} HP`, 'heal');
          } else if (e.type === 'kill') {
            spawnFloatingText(x, y, '💀 DEFEATED', 'kill');
          }
        }, delay);
      });
      // sounds for the notable events of this action
      res.events.forEach(e => { if (SFX_MAP[e.type]) sfx.play(e.type === 'attack' && e.data && e.data.crit ? 'crit' : SFX_MAP[e.type]); });
      if (res.events.some(e => e.type === 'chat_open')) {
        const ev = res.events.find(e => e.type === 'chat_open');
        activeNpc = { id: ev.data.npcId, name: ev.data.name };
      }
      if (res.events.some(e => e.type === 'journal')) toast('📖 Journal updated');
      if (res.chatReply) toast('The NPC answers…');
      // voice-over: speak the DM's new narration lines (chunked per sentence)
      if (tts.isEnabled()) {
        game.log.slice(logLen).filter(l => ['dm', 'system'].includes(l.kind)).slice(0, 2)
          .forEach(l => tts.speak(l.text.replace(/ dice? results?/i, '').slice(0, 400)));
      }
      if (selectedTarget && !game.entities.some(e => e.id === selectedTarget.id && e.alive !== false)) {
        selectedTarget = null;
        appearanceShown = null;
      }
      update();
      return res;
    } catch (e) {
      toast(e.message);
    } finally { busy = false; }
  }

  function handleTileClick(x, y) {
    if (busy || game.mode === 'over' || game.mode === 'victory') return;
    const ent = game.entities.find(e => e.x === x && e.y === y && e.alive !== false);
    const vis = new Set(game.visible || []);
    if (ent && ent.kind === 'monster' && vis.has(x + ',' + y)) {
      selectedTarget = ent;
      appearanceShown = (game.appearances || {})[ent.monsterId] || null;
      update();
      fetchAppearance(ent);
      return;
    }
    if (ent && (ent.kind === 'npc')) {
      if (['marla', 'perra'].includes(ent.npcId) && Math.abs(player().x - x) + Math.abs(player().y - y) <= 3) {
        openShop(ent.npcId === 'perra' ? 'Perra the Pack Trader' : 'Marla the Peddler');
        return;
      }
      act({ type: 'freeform', text: 'talk to ' + ent.name });
      return;
    }
    const obj = (game.objects || []).find(o => o.x === x && o.y === y && o.type !== 'npcMarker');
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
        openSkillCheckModal(obj);
        return;
      }
      if (dist <= 1 && obj.type === 'chest' && !obj.looted && obj.locked && !obj.unlocked) {
        openSkillCheckModal(obj);
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
    updateInitiativeRibbon();
    const invModal = document.getElementById('delveInventoryModal');
    if (invModal) {
      renderDelveInventoryModal(invModal);
    }
    if ((game.mode === 'victory' || game.mode === 'over' || game.mode === 'retreat') && !summaryShown) {
      summaryShown = true;
      sfx.play((game.mode === 'victory' || game.mode === 'retreat') ? 'victory' : 'death');
      openSummary();
    }
    renderLog();
    const hint = document.getElementById('mapHint');
    if (hint) {
      if (game.mode === 'combat') hint.textContent = `Combat — round ${game.combat.round}. Click to move (movement left: ${game.combat.movementLeft} ft). Space = end turn.`;
      else if (game.mode === 'over') hint.textContent = 'You have fallen…';
      else if (game.mode === 'victory') hint.textContent = 'Victory!';
      else hint.textContent = 'Click to move · click a monster to target · arrows/WASD to step';
    }
    updateHoverCues(currentHoverTile);
  }

  const dmSettingsBtn = document.getElementById('dmSettingsBtn');
  if (dmSettingsBtn) dmSettingsBtn.addEventListener('click', () => openSettingsModal());

  const pSelect = document.getElementById('personaQuickSelect');
  if (pSelect) {
    pSelect.value = game.dmPersona || (appState.settings && appState.settings.llm && appState.settings.llm.persona) || 'classic';
    pSelect.addEventListener('change', async () => {
      game.dmPersona = pSelect.value;
      try {
        const s = await api.getSettings();
        if (s && s.settings && s.settings.llm) {
          s.settings.llm.persona = pSelect.value;
          await api.saveSettings(s.settings);
        }
        toast(`DM Persona switched to ${pSelect.options[pSelect.selectedIndex].text}`);
      } catch (e) {
        toast(`DM Persona set to ${pSelect.options[pSelect.selectedIndex].text}`);
      }
    });
  }

  // while delving, if there is a data-nav="settings" link, wire it to the modal
  const settingsLink = document.querySelector('[data-nav="settings"]');
  const onSettingsNav = (e) => { e.preventDefault(); e.stopPropagation(); openSettingsModal(); };
  if (settingsLink) settingsLink.addEventListener('click', onSettingsNav, true);

  function openSummary() {
    const st = game.stats || { dmgDealt: 0, dmgTaken: 0, kills: 0, goldFound: 0, rounds: 0 };
    const won = game.mode === 'victory';
    const retreated = game.mode === 'retreat';
    let modal = document.getElementById('summaryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'summaryModal';
      document.body.appendChild(modal);
    }
    const dismiss = () => {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    };

    modal.innerHTML = `
      <div class="modal" style="position:relative; max-width:520px;">
        <button class="btn small" id="closeSummaryX" style="position:absolute; top:12px; right:12px; min-width:32px; padding:4px 8px; font-weight:bold; cursor:pointer;" title="Close summary">✕</button>
        <h2>${won ? '🏆 Delve Complete!' : (retreated ? '🏃 Retreated to Safety' : '💀 The Delve Ends… for now')}</h2>
        <p class="muted small">${esc(game.character.name)} · ${esc(game.mapName)} · level ${game.character.level}</p>
        <div class="stat-line"><span>⚔ Monsters slain</span><span>${st.kills || 0}</span></div>
        <div class="stat-line"><span>🗡 Damage dealt</span><span>${st.dmgDealt || 0}</span></div>
        <div class="stat-line"><span>🩸 Damage taken</span><span>${st.dmgTaken || 0}</span></div>
        <div class="stat-line"><span>💰 Gold banked</span><span>${game.character.gold || 0} gp (+${st.goldFound || 0} found)</span></div>
        <div class="stat-line"><span>⏱ Combat rounds</span><span>${st.rounds || 0}</span></div>
        <div class="stat-line"><span>📜 Side quests done</span><span>${(game.quests && game.quests.completed || []).length}</span></div>
        <div style="margin-top:16px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          ${(won || retreated)
            ? `<a class="btn primary sumNavBtn" href="#/overworld?char=${game.characterId}&return=${won ? 'victory' : 'retreat'}">🏰 Return to Oakhaven</a>
               <a class="btn sumNavBtn" href="#/overworld?char=${game.characterId}">🗺️ Region Map</a>
               <button class="btn" id="closeSummaryBtn">🔍 Review Delve</button>
               <a class="btn sumNavBtn" href="#/">Home</a>`
            : `<button class="btn primary" id="sumRespawn">🌅 Recover at camp</button>
               <a class="btn sumNavBtn" href="#/overworld?char=${game.characterId}">🏰 Retreat to Town</a>
               <button class="btn" id="closeSummaryBtn">🔍 Review Delve</button>
               <a class="btn sumNavBtn" href="#/">Home</a>`}
        </div>
      </div>`;

    // Automatically commit delve loot and progression back to persistent character
    if (game.characterId && game.id) {
      api.citySyncDelve({ charId: game.characterId, delveStateId: game.id }).catch(() => {});
    }

    modal.querySelectorAll('.sumNavBtn').forEach(btn => btn.addEventListener('click', dismiss));
    const closeX = document.getElementById('closeSummaryX');
    if (closeX) closeX.addEventListener('click', dismiss);
    const closeBtn = document.getElementById('closeSummaryBtn');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) dismiss();
    });

    const rr = document.getElementById('sumRespawn');
    if (rr) rr.addEventListener('click', () => { dismiss(); summaryShown = false; act({ type: 'respawn' }); });
  }

  function openDelveInventoryModal() {
    let modal = document.getElementById('delveInventoryModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-back';
      modal.id = 'delveInventoryModal';
      document.body.appendChild(modal);
    }
    renderDelveInventoryModal(modal);
  }

  function renderDelveInventoryModal(modal) {
    if (!modal) modal = document.getElementById('delveInventoryModal');
    if (!modal) return;
    const char = game.character;
    const eq = char.equipped || {};
    const rules = appState.rules;

    const getItemName = (id) => {
      if (!id || id === 'none') return null;
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.name) return own.name;
      const w = rules.weapons.find(x => x.id === id);
      const a = rules.armor.find(x => x.id === id);
      const g = rules.gear.find(x => x.id === id);
      return (w || a || g)?.name || id;
    };

    const getItemDesc = (id) => {
      if (!id || id === 'none') return '';
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.desc) return own.desc;
      const w = rules.weapons.find(x => x.id === id);
      if (w) return `${w.damage} ${w.damageType || ''}`;
      const a = rules.armor.find(x => x.id === id);
      if (a) return `AC ${a.ac}`;
      const g = rules.gear.find(x => x.id === id);
      if (g) return g.desc || (g.acBonus ? `+${g.acBonus} AC` : '');
      return '';
    };

    const tooltipPayload = (id) => {
      const own = (char.inventory || []).find(i => i.uniqueId === id);
      if (own && own.rarity) return esc(JSON.stringify({ ...own, ...(rules.weapons.find(x => x.id === own.itemId) || {}) }));
      return id;
    };

    const slots = [
      { key: 'armor', label: '🦺 Armor', item: eq.armor, emptyText: 'Unarmored' },
      { key: 'mainHand', label: '🗡️ Main Hand', item: eq.mainHand, emptyText: 'Unarmed' },
      { key: 'offHand', label: '🛡️ Off-Hand', item: eq.offHand, emptyText: 'Empty' },
      { key: 'cloak', label: '🧥 Cloak', item: eq.cloak, emptyText: 'None' },
      { key: 'ring1', label: '💍 Ring', item: eq.ring1, emptyText: 'None' },
    ];

    modal.innerHTML = `
      <div class="modal delve-inventory-modal" style="position:relative; max-width:680px; width:94%; max-height:86vh; display:flex; flex-direction:column; text-align:left; padding:20px 24px;">
        <button class="btn small" id="closeDelveInvX" style="position:absolute; top:14px; right:14px; min-width:32px; padding:4px 8px; font-weight:bold; cursor:pointer;" title="Close">✕</button>
        <h2 style="margin:0 0 4px; display:flex; align-items:center; gap:8px;">
          🎒 Backpack & Equipment
        </h2>
        <div class="muted small" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <span>${esc(char.name)} · Level ${char.level} · AC ${acNow()} · Speed ${speedNow()} ft</span>
          <span style="color:var(--gold); font-weight:600;">💰 ${char.gold || 0} gp</span>
        </div>

        <div style="font-size:12px; font-weight:700; color:var(--gold); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
          ⚔️ Equipped Loadout
        </div>
        <div class="delve-inv-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(115px, 1fr)); gap:8px; margin-bottom:14px;">
          ${slots.map(s => {
            const hasItem = Boolean(s.item && s.item !== 'none');
            return `
              <div class="delve-inv-slot ${hasItem ? 'occupied' : ''}" style="background:var(--bg2); border:1px solid ${hasItem ? 'var(--gold-dim)' : 'var(--border)'}; border-radius:6px; padding:6px 8px; min-height:64px; display:flex; flex-direction:column; justify-content:space-between;" ${hasItem ? `data-item-tooltip="${tooltipPayload(s.item)}" style="cursor:help;"` : ''}>
                <div>
                  <div style="font-size:10px; text-transform:uppercase; color:var(--muted); font-weight:600;">${s.label}</div>
                  <div style="font-size:12px; font-weight:600; color:${hasItem ? 'var(--gold)' : 'var(--muted)'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${hasItem ? esc(getItemName(s.item)) : s.emptyText}
                  </div>
                  ${hasItem && getItemDesc(s.item) ? `<div style="font-size:10px; color:var(--muted);">${esc(getItemDesc(s.item))}</div>` : ''}
                </div>
                ${hasItem ? `
                  <button class="btn small" data-delve-inv-unequip="${s.key}" style="padding:1px 5px; font-size:10px; align-self:flex-start; margin-top:4px;">Doff / Stow</button>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size:12px; font-weight:700; color:var(--gold); text-transform:uppercase; letter-spacing:0.5px;">
            📦 Backpack Inventory (${(char.inventory || []).length} items)
          </div>
          <span class="muted small">Click an item or button to use / equip</span>
        </div>

        <div class="delve-inv-scroll-list" style="flex:1; overflow-y:auto; border:1px solid var(--border); border-radius:6px; background:var(--bg); padding:6px 10px; max-height:280px;">
          ${(char.inventory || []).length === 0 ? `
            <div class="muted small" style="padding:16px; text-align:center;">Backpack is empty.</div>
          ` : (char.inventory || []).map(i => {
            const def = (rules.weapons || []).find(w => w.id === i.itemId)
              || (rules.armor || []).find(w => w.id === i.itemId)
              || (rules.gear || []).find(w => w.id === i.itemId);
            const entry = { ...(def || {}), ...i }; // rolled affix gear keeps its own name, rarity and modifiers
            const usable = def && (def.type === 'potion' || def.type === 'scroll');
            const isWeapon = (rules.weapons || []).some(w => w.id === i.itemId);
            const isArmor = (rules.armor || []).some(a => a.id === i.itemId && a.type !== 'shield');
            const isShield = i.itemId === 'shield' || (def && def.type === 'shield') || i.type === 'shield';
            const isCloak = i.itemId.includes('cloak');
            const isRing = i.itemId.includes('ring');
            const ref = i.uniqueId || i.itemId; // rolled items are addressed by unique id
            const worn = (slot) => eq[slot] === ref || eq[slot] === i.itemId;

            let actionHtml = '';
            if (isWeapon) {
              if (worn('mainHand')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Wielded</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="mainHand" data-item="${ref}">Wield</button>`;
              }
            } else if (isArmor) {
              if (worn('armor')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Worn</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="armor" data-item="${ref}">Wear</button>`;
              }
            } else if (isShield) {
              if (worn('offHand')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Shielded</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="offHand" data-item="${ref}">Hold</button>`;
              }
            } else if (isCloak) {
              if (worn('cloak')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Donned</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="cloak" data-item="${ref}">Don</button>`;
              }
            } else if (isRing) {
              if (worn('ring1')) {
                actionHtml = `<span class="chip" style="color:var(--gold); border-color:var(--gold-dim); font-size:11px; margin:0;">Attuned</span>`;
              } else {
                actionHtml = `<button class="btn small" data-delve-inv-equip="ring1" data-item="${ref}">Attune</button>`;
              }
            }

            const meta = i.rarity ? null : def;
            const detail = i.desc || (meta && (meta.damage || meta.ac || meta.desc)
              ? (meta.damage ? `${meta.damage} ${meta.damageType || ''}` : (meta.ac ? `AC ${meta.ac}` : meta.desc))
              : '');

            // experimental brews: hidden until identified or drunk
            if (i.kind === 'mystery_potion') {
              const kindTag = i.identified
                ? (i.effect.kind === 'good' ? '🔵 有益' : i.effect.kind === 'bad' ? '🟣 有害' : '🟠 复杂')
                : '❓ 未鉴定';
              const row = i.identified
                ? `${i.effect.name} — ${i.effect.desc}`
                : (i.clues || []).join(' · ');
              return `
                <div class="stat-line item-row potion-row ${i.identified ? 'rarity-' + (i.effect.kind === 'good' ? 'magic' : i.effect.kind === 'bad' ? 'rare' : 'legendary') : 'potion-unknown'}"
                     data-item-tooltip='${esc(JSON.stringify({ ...entry, rarity: i.identified ? (i.effect.kind === 'good' ? 'magic' : i.effect.kind === 'bad' ? 'rare' : 'legendary') : 'common' }))}' style="cursor:help; padding:6px 2px; align-items:center;">
                  <div style="min-width:0; flex:1; padding-right:8px;">
                    <span class="item-affix-tag ${i.identified ? 'rarity-magic-tag' : 'rarity-common-tag'}">${kindTag}</span>
                    <span style="font-weight:600;">${esc(i.name)}</span>
                    <span class="muted small" style="margin-left:6px;">(${esc(row)})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <button class="btn small primary" data-delve-inv-use="${ref}">${i.identified ? '饮下' : '盲饮'}</button>
                    <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                  </div>
                </div>
              `;
            }

            // delve-only prize tokens won at the tavern
            if (i.kind === 'delve_token') {
              return `
                <div class="stat-line item-row rarity-legendary" data-item-tooltip='${esc(JSON.stringify(entry))}' style="cursor:help; padding:6px 2px; align-items:center;">
                  <div style="min-width:0; flex:1; padding-right:8px;">
                    <span class="item-affix-tag rarity-legendary-tag">⏳ 仅本场地牢</span>
                    <span style="font-weight:600;">${esc(i.name)}</span>
                    <span class="muted small" style="margin-left:6px;">(${esc(i.desc || '')})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                    <button class="btn small primary" data-delve-inv-use="${ref}">使用</button>
                    <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                  </div>
                </div>
              `;
            }

            return `
              <div class="stat-line item-row ${i.rarity ? 'rarity-' + i.rarity : ''}" data-item-tooltip='${i.rarity ? esc(JSON.stringify(entry)) : i.itemId}' style="cursor:help; padding:6px 2px; align-items:center;">
                <div style="min-width:0; flex:1; padding-right:8px;">
                  ${i.rarity ? `<span class="item-affix-tag rarity-${i.rarity}-tag">${i.rarity === 'legendary' ? '🟠 传奇' : i.rarity === 'rare' ? '🟣 稀有' : '🔵 魔法'}</span>` : ''}
                  <span style="font-weight:600;">${esc(i.name || (def ? def.name : i.itemId))}</span>
                  ${detail ? `<span class="muted small" style="margin-left:6px;">(${esc(detail)})</span>` : ''}
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                  ${usable && i.qty > 0 ? `<button class="btn small primary" data-delve-inv-use="${i.itemId}">Use</button>` : ''}
                  ${actionHtml}
                  <span class="muted small" style="min-width:26px; text-align:right;">×${i.qty}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
          <a href="#/sheet/${game.characterId}" target="_blank" class="btn small" title="Open full character sheet in new tab">📜 Full Character Sheet ↗</a>
          <button class="btn primary" id="closeDelveInvDone">Done</button>
        </div>
      </div>
    `;

    initTooltips(modal, rules);

    const dismiss = () => {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    };

    const closeX = modal.querySelector('#closeDelveInvX');
    if (closeX) closeX.addEventListener('click', dismiss);
    const closeDone = modal.querySelector('#closeDelveInvDone');
    if (closeDone) closeDone.addEventListener('click', dismiss);
    modal.onclick = (e) => {
      if (e.target === modal) dismiss();
    };

    modal.querySelectorAll('[data-delve-inv-equip]').forEach(b => b.addEventListener('click', async () => {
      const slot = b.dataset.delveInvEquip;
      const itemId = b.dataset.item;
      sfx.play('equip');
      await act({ type: 'equip', slot, itemId });
      toast(`Equipped ${itemId}!`);
    }));

    modal.querySelectorAll('[data-delve-inv-unequip]').forEach(b => b.addEventListener('click', async () => {
      const slot = b.dataset.delveInvUnequip;
      sfx.play('equip');
      await act({ type: 'unequip', slot });
      toast(`Unequipped ${slot}!`);
    }));

    modal.querySelectorAll('[data-delve-inv-use]').forEach(b => b.addEventListener('click', async () => {
      const itemId = b.dataset.delveInvUse;
      const def = (rules.gear || []).find(g => g.id === itemId);
      if (def && def.type === 'scroll' && def.spell) {
        const sp = (rules.spells || []).find(x => x.id === def.spell);
        if (sp && ['enemy', 'burst'].includes(sp.target) && !selectedTarget) {
          return toast('Target a creature first on the map.');
        }
        await act({ type: 'useItem', itemId, targetId: selectedTarget ? selectedTarget.id : 'player' });
      } else {
        await act({ type: 'useItem', itemId });
      }
    }));
  }

  function renderSide() {
    const char = game.character;
    const p = player();
    const rules = appState.rules;
    const cls = rules.classes.find(c => c.id === char.className);
    const subDef = (cls.subclass && char.subclass === cls.subclass.id) ? cls.subclass : null;
    const myTurn = game.mode !== 'combat' || game.combat.order[game.combat.turnIdx].id === 'player';
    const potCount = (game.character.inventory || [])
      .filter(i => ['potion_healing', 'potion_greater'].includes(i.itemId))
      .reduce((s, i) => s + i.qty, 0);

    document.getElementById('sidePanel').innerHTML = `
      <div class="card">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:8px;">
          <img src="${char.portraitUrl || '/portraits/hero_' + (char.id || game.characterId) + '.svg'}"
               alt="Hero"
               style="width:44px; height:50px; object-fit:cover; border-radius:6px; border:1.5px solid var(--border); background:#15120e; flex-shrink:0;"
               onerror="this.style.display='none'">
          <div style="min-width:0; flex:1;">
            <h3 style="margin:0 0 2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(char.name)}</h3>
            <div class="muted small">Lv ${char.level} ${esc(cls.name)}</div>
          </div>
        </div>
        <div style="margin-bottom:6px; display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
          <span class="chip ${game.difficulty === 'hard' ? 'red' : game.difficulty === 'easy' ? 'blue' : ''}">${esc((appState.rules.difficulty || {})[game.difficulty]?.label || 'Normal')}</span>
          ${(() => {
            const allyEnt = (game.entities || []).find(e => e.kind === 'ally');
            if (!allyEnt) return '';
            const status = allyEnt.alive ? `${allyEnt.hp}/${allyEnt.hpMax} HP` : 'Downed';
            return `<span class="chip blue" title="${esc(allyEnt.name)} (${status})">${allyEnt.icon || '🏹'} ${esc(allyEnt.name.split(' ')[0])} (${allyEnt.hp} HP)</span>`;
          })()}
          ${subDef ? `<span class="chip">⚔ ${esc(subDef.name)}</span>` : ''}
          <span style="flex:1"></span>
          <button class="btn small" id="sfxBtn" title="Sound effects">${sfx.isEnabled() ? '🔊' : '🔇'}</button>
          <button class="btn small" id="ttsBtn" title="AI DM voice-over">${tts.isEnabled() ? '🗣️' : '🤐'}</button>
          <input type="range" id="volSlider" min="0" max="100" value="${Math.round(sfx.getVolume() * 100)}" style="width:70px;" title="Volume">
        </div>
        <div class="hp-bar"><div class="fill" style="width:${Math.max(0, (p.hp / p.hpMax) * 100)}%"></div></div>
        <div class="hp-text"><span>${p.hp}/${p.hpMax} HP${p.tempHp ? ` (+${p.tempHp} temp)` : ''}</span><span>AC ${acNow()}</span></div>
        <div class="hp-text"><span>Speed ${speedNow()} ft</span><span>XP ${char.xp} · ${char.gold} gp</span></div>
        <div class="hp-text"><span>Slots: ${slotText()}</span><span>HD left: ${char.level - (char.hdUsed || 0)}</span></div>
        ${(() => {
          const lu = game.levelUp || {};
          const canLvl = !!lu.canLevelUp;
          const nextLvl = lu.nextLevel || ((char.level || 1) + 1);
          return canLvl ? `<button class="btn small levelup-badge-btn" id="btnDelveLevelUp" style="width:100%; margin-top:8px;" title="${lu.currentXp || char.xp || 0} / ${lu.xpNeeded || '—'} XP">⚡ LEVEL UP AVAILABLE (Ascend to Lvl ${nextLvl})</button>` : '';
        })()}
        ${(p.conditions.length || (p.buffs || []).filter(b => b.id !== 'concentrating').length) ? `<div style="margin-top:6px;">${p.conditions.map(c => `<span class="chip red">${esc(c)}</span>`).join('')}${(p.buffs || []).filter(b => b.id !== 'concentrating' && b.id !== 'cond_' ).map(b => `<span class="chip blue">${esc(b.id)}</span>`).join('')}</div>` : ''}
        ${((game.flags && game.flags.restsBlocked) || (char.tempHpMod || 0) !== 0 || (char.inventory || []).some(i => i.delveOnly)) ? `
          <div style="margin-top:6px;">
            ${(game.flags && game.flags.restsBlocked) ? `<span class="chip red" title="本场地牢的休息被药剂或诅咒夺走">🕯️ 安息被打断 ×${game.flags.restsBlocked}</span>` : ''}
            ${(char.tempHpMod || 0) < 0 ? `<span class="chip red" title="本场地牢的最大生命被削弱">💔 最大生命 ${char.tempHpMod}（本场）</span>` : ''}
            ${(char.tempHpMod || 0) > 0 ? `<span class="chip blue" title="本场地牢的最大生命被强化">❤️ 最大生命 +${char.tempHpMod}（本场）</span>` : ''}
            ${(char.inventory || []).filter(i => i.delveOnly && i.kind === 'delve_token' && i.qty > 0).map(i => `<span class="chip gold-chip" title="${esc(i.desc || '')}">${esc(i.name)}</span>`).join('')}
          </div>` : ''}
        
        <div style="display:flex; gap:6px; margin-top:10px;">
          <button class="btn small" id="btnOpenDelveInventory" style="flex:1; background:var(--bg2); border-color:var(--gold-dim); color:var(--parchment); font-weight:600;" title="Open inventory and manage equipment (Hotkey [B] or [I])">
            🎒 Backpack & Gear (${(char.inventory || []).length})
          </button>
          <a href="#/sheet/${game.characterId}" target="_blank" class="btn small" title="Open full character sheet in new tab" style="text-decoration:none; padding:4px 8px;">📜 Sheet</a>
        </div>
      </div>

      ${(() => {
        const pk = selectedTarget ? (selectedTarget.monsterId || selectedTarget.npcId) : null;
        const port = pk ? (game.portraits || {})[pk] : null;
        if (!port) return '';
        return `
      <div class="card" style="border-color:var(--gold-dim); text-align:center;">
        <img src="${port.url}" alt="portrait" style="width:100%; max-width:180px; border-radius:8px;" onerror="this.style.display='none'">
        <p class="small" style="font-family:var(--font-serif); color:var(--parchment); margin:6px 0 0;">${esc(appearanceShown || (selectedTarget && selectedTarget.name) || '')}</p>
      </div>`;
      })()}

      ${p.conditions.includes('unconscious') ? `
      <div class="card" style="border-color:#6b3a35;">
        <h3 style="color:#d98a80;">💀 Dying</h3>
        <p class="small">Success&nbsp;&nbsp;${'●'.repeat((p.deathSaves || {}).succ || 0)}${'○'.repeat(3 - ((p.deathSaves || {}).succ || 0))}</p>
        <p class="small">Failures&nbsp;&nbsp;${'●'.repeat((p.deathSaves || {}).fail || 0)}${'○'.repeat(3 - ((p.deathSaves || {}).fail || 0))}</p>
        <p class="small muted" style="margin-top:4px;">Death saves roll automatically at the start of your turn. 3 successes stabilize you; 3 failures…</p>
      </div>` : ''}

      ${game.mode === 'over' ? `
      <div class="card" style="border-color:#6b3a35;">
        <h3 style="color:#d98a80;">You have fallen</h3>
        <p class="small muted">The crypt claims another soul… but Bram drags you back to the firelight.</p>
        <button class="btn primary" data-act="respawn">🌅 Recover at camp (half HP)</button>
      </div>
      ` : game.mode === 'combat' ? combatHud(myTurn) : `
      ${renderQuickSlots(true)}
      <div class="card">
        <h3>Actions</h3>
        <div class="action-grid">
          <button class="btn" data-act="rest">🛏 Short Rest</button>
          <button class="btn" data-act="longrest">🔥 Long Rest</button>
          <button class="btn" data-act="potion">🧪 Potion (${potCount})</button>
          ${atCampfire() ? `<button class="btn" data-act="recap" style="grid-column:1 / -1;">✍ Write journal entry</button>` : ''}
          ${(atCampfire() || atEntrance() || game.mode === 'retreat' || game.mode === 'victory' || isAreaCleared(game)) ? `<button class="btn primary ${isAreaCleared(game) ? 'cleared-beacon-btn' : ''}" data-act="retreat" style="grid-column:1 / -1; background:linear-gradient(180deg, #3d5a42, #29422e); border-color:#508059;">${game.mode === 'retreat' || game.mode === 'victory' ? '🏆 View Summary / Return to Town' : (isAreaCleared(game) ? '🏆 Area Cleared! Return to Oakhaven' : '🏰 Retreat to Oakhaven')}</button>` : `<button class="btn" data-act="retreat" style="grid-column:1 / -1;">🏰 Retreat to Oakhaven</button>`}
          <button class="btn" data-act="journal" style="grid-column:1 / -1;">📖 Journal${(game.journal || []).length ? ` (${game.journal.length})` : ''}</button>
        </div>
        <div style="margin-top:8px;">${classActions()}</div>
      </div>`}

      <div class="card quest-objective-card" style="border-color:var(--gold-dim);">
        <div class="quest-fold-header" id="toggleQuestFoldBtn" title="Click to fold or expand quests & goals">
          <h3 style="margin:0; display:flex; align-items:center; gap:6px;">
            📜 Quests & Goals
            <span class="chip ${questObjectiveFolded ? '' : 'blue'}" style="font-size:10px; padding:1px 6px;">${questObjectiveFolded ? 'Folded' : 'Active'}</span>
          </h3>
          <button class="btn small" style="padding:2px 8px; font-size:11px;" id="btnQuestFoldToggle">
            ${questObjectiveFolded ? '▶ Expand' : '▼ Fold'}
          </button>
        </div>
        ${questObjectiveFolded ? `
          <div class="small muted" style="margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${esc(charObjective(game))}">
            🎯 ${esc(charObjective(game))}
          </div>
        ` : `
          <div style="margin-top:8px;">
            <div style="font-size:12px; font-weight:600; color:var(--gold); margin-bottom:3px;">🎯 Dungeon Objective</div>
            <p class="small muted" style="margin:0 0 8px;">${esc(charObjective(game))}</p>
            ${game.quests && game.quests.active ? `
              <div style="border-top:1px dashed var(--border); padding-top:6px; margin-top:6px;">
                <div style="font-size:12px; font-weight:600; color:var(--parchment); margin-bottom:2px;">📜 ${esc(game.quests.active.shortText)}</div>
                <p class="small muted" style="margin:0 0 6px;">${esc(game.quests.active.text)}</p>
                <div class="small"><span class="chip">💰 ${game.quests.active.reward.gold} gp</span> <span class="chip blue">✨ ${game.quests.active.reward.xp} XP</span></div>
              </div>
            ` : ''}
          </div>
        `}
      </div>
    `;

    wireSide(myTurn);
    initTooltips(document.getElementById('sidePanel'), appState.rules);
    document.getElementById('sfxBtn').addEventListener('click', () => { sfx.toggle(); renderSide(); });
    document.getElementById('volSlider').addEventListener('input', (e) => { sfx.setVolume(+(e.target.value) / 100); });
    const vt = document.getElementById('viewToggle');
    if (vt) vt.onclick = toggleView;
    document.getElementById('ttsBtn').addEventListener('click', () => { tts.toggle(); renderSide(); toast(tts.isEnabled() ? '🗣️ AI DM voice-on' : '🤐 AI DM voice-off'); });
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
          name: def ? def.name : it.itemId,
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
          <div class="quick-slot-card ${disClass}" data-quickslot="${i}" data-item-tooltip="${item.itemId}" title="${esc(item.name)} (Key [${i + 1}])">
            <span class="slot-key-badge">${i + 1}</span>
            <span class="slot-icon">${item.icon}</span>
            <span class="slot-label">${esc(item.shortName)}</span>
            <span class="slot-qty-badge">×${item.qty}</span>
          </div>
        `);
      } else {
        slots.push(`
          <div class="quick-slot-card slot-empty" title="Empty quick-slot (Key [${i + 1}])">
            <span class="slot-key-badge">${i + 1}</span>
            <span style="opacity:0.35;">—</span>
          </div>
        `);
      }
    }
    return `
      <div class="quickbar-wrap">
        <div class="quickbar-header">
          <span>⚡ Quick-Slots Belt</span>
          <span class="muted" style="font-weight:normal; font-size:10px;">Hotkeys [1–5]</span>
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
      if (!actor || actor.id !== 'player') return toast("Wait for your turn in combat.");
    }
    const items = getConsumables();
    const item = items[slotIdx];
    if (!item) return;

    if (item.isScroll) {
      const def = item.def;
      if (def && def.spell) {
        const sp = (appState.rules.spells || []).find(x => x.id === def.spell);
        if (sp && ['enemy', 'burst'].includes(sp.target) && !selectedTarget) {
          return toast(`Target a monster first to use ${item.name}.`);
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
      ? `Target: <b>${esc(selectedTarget.name)}</b> (${selectedTarget.hpMax ? selectedTarget.hp + '/' + selectedTarget.hpMax + ' HP, ' : 'Object, '}AC ${selectedTarget.ac || 10})${selectedTarget.isElite ? ` <span class="elite-monster-label" style="--elite-color:${esc((selectedTarget.affix && selectedTarget.affix.color) || '#f59e0b')}" title="${esc((selectedTarget.affix && selectedTarget.affix.desc) || 'Elite Champion')}">★ 精英：${esc((selectedTarget.affix && selectedTarget.affix.desc) || 'Champion')}</span>` : ''}`
      : 'Click a monster or object on the map to target it.';
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
      <div class="combat-banner">
        <span class="round">⚔ Round ${c.round}</span> — ${myTurn ? '<b style="color:var(--gold);">Your turn!</b>' : '<span class="muted">Enemies act…</span>'}
        <div class="init-chips">${c.order.map((o, i) => {
          const ent = game.entities.find(e => e.id === o.id);
          return `<span class="init-chip ${i === c.turnIdx ? 'active' : ''} ${ent && ent.alive === false ? 'dead' : ''}">${esc(o.name)} ${o.total}</span>`;
        }).join('')}</div>
      </div>
      <div class="card">
        <p class="target-line">${targetLine}</p>
        
        <div class="turn-economy-bar" title="Turn Economy: Action, Bonus Action, Movement, and Reaction">
          <span class="economy-pill ${actionUsed ? 'spent' : 'ready'}" title="${actionUsed ? 'Action spent this turn (cannot Attack, Cast, Dodge, or Dash)' : 'Action ready — use for Attack, Cast Spell, Dodge, or Dash'}">
            <span class="economy-dot"></span> Action: ${actionUsed ? 'Spent' : 'Ready'}
          </span>
          <span class="economy-pill ${bonusUsed ? 'spent' : 'ready'}" title="${bonusUsed ? 'Bonus action spent this turn' : 'Bonus action ready — use for Potion or bonus class abilities'}">
            <span class="economy-dot"></span> Bonus: ${bonusUsed ? 'Spent' : 'Ready'}
          </span>
          <span class="economy-pill ${mvLeft > 0 ? 'ready' : 'spent'}" title="Movement remaining this turn (click tiles or WASD to step)">
            👣 ${mvLeft} ft (${Math.floor(mvLeft / 5)} sq)
          </span>
          <span class="economy-pill ${reactionUsed ? 'spent' : 'ready'}" title="${reactionUsed ? 'Reaction spent this round' : 'Reaction ready for Opportunity Attacks & Shield'}">
            ⚡ Reaction: ${reactionUsed ? 'Spent' : 'Ready'}
          </span>
        </div>

        ${renderQuickSlots(myTurn)}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <h3 style="margin:0;">Combat Actions</h3>
          ${myTurn && actionUsed ? '<span class="muted small" style="font-size:11px; color:#f87171;">Action spent</span>' : ''}
        </div>

        <div class="action-grid">
          <button class="btn" data-act="attack" ${canAttack ? '' : 'disabled'} title="${actionUsed ? 'Action already spent this turn' : 'Perform a weapon attack on the targeted enemy'}">
            🗡 Attack <span class="action-cost-badge action">Act</span>
          </button>
          <button class="btn" data-act="castmenu" ${canCast ? '' : 'disabled'} title="${actionUsed ? 'Action already spent this turn' : 'Cast a cantrip or spell'}">
            ✨ Cast… <span class="action-cost-badge action">Act</span>
          </button>
          <button class="btn" data-act="dodge" ${canDodge ? '' : 'disabled'} title="${actionUsed ? 'Action already spent this turn' : 'Take Dodge action — attacks against you have disadvantage'}">
            🛡 Dodge <span class="action-cost-badge action">Act</span>
          </button>
          <button class="btn" data-act="dash" ${canDash ? '' : 'disabled'} title="${actionUsed ? 'Action already spent this turn' : 'Take Dash action — double your movement speed'}">
            💨 Dash <span class="action-cost-badge action">Act</span>
          </button>
          <button class="btn" data-act="potion" ${canPotion ? '' : (potCount > 0 && !myTurn ? 'disabled' : (bonusUsed ? 'disabled' : ''))} title="${bonusUsed ? 'Bonus action already spent this turn' : (potCount === 0 ? 'No potions left' : 'Drink a healing potion')}">
            🧪 Potion (${potCount}) <span class="action-cost-badge bonus">Bns</span>
          </button>
          <button class="btn primary" data-act="endturn" ${myTurn ? '' : 'disabled'} title="Finish your turn and let other combatants act (Hotkey [Space])">
            ⏭ End Turn
          </button>
        </div>
        ${allMainActionsSpent ? `
          <div class="all-spent-notice">
            💡 All actions and movement spent! Press <b>Space</b> or click <b>End Turn</b>.
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
      let label = f.name;
      let disabled = !myTurn;
      if (f.uses === 'cha/short') { const max = 2 + Math.floor((char.abilities.cha - 10) / 2); label += ` (${uses[f.id] ?? max}/${max})`; if ((uses[f.id] ?? max) <= 0) disabled = true; }
      else if (f.uses && f.uses !== 'pool5xlevel/long') { label += ` (${uses[f.id] ?? 0})`; if ((uses[f.id] ?? 0) <= 0) disabled = true; }
      else if (f.uses === 'pool5xlevel/long') { label += ` (${char.pools.lay_on_hands || 0})`; if ((char.pools.lay_on_hands || 0) <= 0) disabled = true; }
      btns.push(`<button class="btn small" data-classact="${f.id}" ${disabled}>${esc(label)}</button>`);
    });
    if (char.breathWeapon) btns.push(`<button class="btn small" data-classact="breath_weapon" ${myTurn ? '' : 'disabled'}>🐉 Breath Weapon (${uses.breath_weapon ?? 0})</button>`);
    if (char.healingHands) btns.push(`<button class="btn small" data-classact="healing_hands" ${myTurn ? '' : 'disabled'}>🖐 Healing Hands</button>`);
    if (char.className === 'ranger' && game.mode === 'combat') btns.push(`<button class="btn small" data-classact="hunters_mark_free" ${myTurn && (uses.hunters_mark_free ?? 0) > 0 ? '' : 'disabled'}>🏹 Mark Prey (${uses.hunters_mark_free ?? 0})</button>`);
    if (char.feat === 'healer') btns.push(`<button class="btn small" data-classact="healer_feat" ${myTurn ? '' : 'disabled'}>🩹 Healer's Kit</button>`);
    if (char.className === 'barbarian' && char.level >= 2) btns.push(`<button class="btn small" data-classact="reckless_toggle" ${myTurn ? '' : 'disabled'}> ${(game.flags.reckless ? '☑' : '☐')} Reckless</button>`);
    return btns.join(' ');
  }

  function wireSide(myTurn) {
    document.querySelectorAll('[data-quickslot]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.quickslot, 10);
      useQuickSlot(idx);
    }));

    document.querySelectorAll('[data-useitem]').forEach(b => b.addEventListener('click', () => {
      const itemId = b.dataset.useitem;
      const def = appState.rules.gear.find(g => g.id === itemId);
      if (def && def.type === 'scroll' && def.spell) {
        const sp = appState.rules.spells.find(x => x.id === def.spell);
        if (sp && ['enemy', 'burst'].includes(sp.target) && !selectedTarget) return toast('Target a creature first.');
        act({ type: 'useItem', itemId, targetId: selectedTarget ? selectedTarget.id : 'player' });
      } else act({ type: 'useItem', itemId });
    }));

    document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'rest') act({ type: 'rest', kind: 'short' });
      if (a === 'longrest') act({ type: 'rest', kind: 'long' });
      if (a === 'potion') {
        const inv = game.character.inventory || [];
        const pot = inv.find(i => i.itemId === 'potion_healing' && i.qty > 0) || inv.find(i => i.itemId === 'potion_greater' && i.qty > 0);
        if (pot) act({ type: 'useItem', itemId: pot.itemId });
        else toast('No potions left — Marla sells more.');
      }
      if (a === 'search') act({ type: 'freeform', text: 'search the area carefully' });
      if (a === 'respawn') act({ type: 'respawn' });
      if (a === 'journal') openJournal();
      if (a === 'recap') act({ type: 'recap' });
      if (a === 'askwork') act({ type: 'quest' });
      if (a === 'retreat') {
        if (game.mode === 'retreat' || game.mode === 'victory') openSummary();
        else act({ type: 'retreat' });
      }
      if (a === 'dodge') act({ type: 'dodge' });
      if (a === 'dash') act({ type: 'dash' });
      if (a === 'endturn') act({ type: 'endTurn' });
      if (a === 'attack') {
        if (!selectedTarget) return toast('Click a monster or object first to target it.');
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
      if (a === 'castmenu') renderCastMenu();
    }));
    document.querySelectorAll('[data-classact]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.classact;
      const action = { type: 'classAction', id, targetId: selectedTarget ? selectedTarget.id : null };
      if (id === 'cunning_action') {
        const mode = prompt('Cunning Action — type: dash / disengage / hide', 'dash');
        if (!mode) return; action.mode = mode;
      }
      if (id === 'step_of_wind') {
        const mode = prompt('Step of the Wind — type: dash / disengage', 'dash');
        if (!mode) return; action.mode = mode;
      }
      if (id === 'divine_spark') {
        const mode = prompt('Divine Spark — type: attack / heal', 'attack');
        if (!mode) return; action.mode = mode;
        if (mode === 'attack' && !selectedTarget) return toast('Target a monster first.');
      }
      if (id === 'hunters_mark_free' && !selectedTarget) return toast('Target a monster first.');
      act(action);
    }));

    const btnLvl = document.getElementById('btnDelveLevelUp');
    if (btnLvl) {
      btnLvl.onclick = () => {
        openLevelUpModal(game.character.id, async (upd) => {
          game.character = upd;
          // re-read the server's level-up verdict so the badge reflects the new level
          try {
            const fresh = await api.getGame(game.id);
            game = fresh.state;
          } catch {}
          update();
          toast(`⚡ Level Up applied: Level ${upd.level}!`);
        });
      };
    }

    const btnOpenInv = document.getElementById('btnOpenDelveInventory');
    if (btnOpenInv) {
      btnOpenInv.addEventListener('click', () => openDelveInventoryModal());
    }

    const toggleQuestFold = document.getElementById('toggleQuestFoldBtn');
    if (toggleQuestFold) {
      toggleQuestFold.addEventListener('click', () => {
        questObjectiveFolded = !questObjectiveFolded;
        renderSide();
      });
    }

    document.querySelectorAll('[data-equip-slot]').forEach(b => b.addEventListener('click', async () => {
      const slot = b.dataset.equipSlot;
      const itemId = b.dataset.equipItem;
      sfx.play('equip');
      await act({ type: 'equip', slot, itemId });
      toast(`Equipped ${itemId}!`);
    }));

    document.querySelectorAll('[data-unequip-slot]').forEach(b => b.addEventListener('click', async () => {
      const slot = b.dataset.unequipSlot;
      sfx.play('equip');
      await act({ type: 'unequip', slot });
      toast(`Unequipped ${slot}!`);
    }));
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
        <label>Cantrips</label>
        <div class="action-grid">${cantrips.map(s => `<button class="btn small" data-cast="${s.id}">${s.name}</button>`).join('') || '<span class="muted small">none</span>'}</div>
        ${spells.length || free.length ? `<label style="margin-top:6px;">Spells (L1 slots: ${char.slots[1] || 0}${free.length ? ' +1 free' : ''})</label>
        <div class="action-grid">${[...free, ...spells].map(s => `<button class="btn small" data-cast="${s.id}">${s.name}${free.some(f => f.id === s.id) ? ' ✨' : ''}</button>`).join('')}</div>` : ''}
      </div>`;
    menu.querySelectorAll('[data-cast]').forEach(b => b.addEventListener('click', () => {
      const spell = appState.rules.spells.find(s => s.id === b.dataset.cast);
      if (['self', 'flavor'].includes(spell.target)) act({ type: 'cast', spellId: spell.id });
      else if (!selectedTarget) toast('Target a monster or object first (or yourself for buffs via "self").');
      else act({ type: 'cast', spellId: spell.id, targetId: spell.target === 'ally' ? 'player' : selectedTarget.id });
      menu.innerHTML = '';
    }));
  }

  function renderLog() {
    const el = document.getElementById('logEntries');
    el.innerHTML = game.log.map(l => `<div class="log-entry ${esc(l.kind)}">${esc(l.text)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
    const input = document.getElementById('chatInput');
    input.placeholder = activeNpc ? `Speak to ${activeNpc.name}…` : 'Describe an action — "search the room", "listen at the door", "hide in the shadows"…';
  }

  update();
  renderLog();

  // poll while enemies might be acting (cheap: only in combat, 4s)
  const pollTimer = setInterval(async () => {
    if (busy || !game) return;
    try {
      const data = await api.getGame(game.id);
      if (JSON.stringify(data.state.entities.map(e => [e.x, e.y, e.hp])) !== JSON.stringify(game.entities.map(e => [e.x, e.y, e.hp]))) {
        game = data.state; update();
      }
    } catch {}
  }, 4000);

  return () => {
    clearInterval(pollTimer);
    document.removeEventListener('keydown', onKey);
    tts.stop();
    sfx.stopAmbient();
    if (renderer3d) renderer3d.dispose();
    if (settingsLink) settingsLink.removeEventListener('click', onSettingsNav, true);
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
  };
}
