// play.js — the delve: canvas map, combat HUD, log, chat
import { api } from '../api.js';
import { esc, toast, state as appState, charObjective } from '../app.js';
import { createMapRenderer } from '../map.js';
import { createMap3D } from '../map3d.js';
import { settingsView } from './settings.js';
import { showDice, rollAnimated } from '../dice.js';
import { sfx } from '../sfx.js';
import { tts } from '../tts.js';

let game = null;
let selectedTarget = null;
let activeNpc = null;
let appearanceShown = null;
let portraitShown = null;
let summaryShown = false;
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
  sfx.startAmbient((game.map && game.map.theme) || 'crypt');
  selectedTarget = null; activeNpc = null; appearanceShown = null; portraitShown = null;

  main.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:8px; margin-bottom:4px;">
      <div style="display:flex; align-items:baseline; gap:10px;">
        <h1 style="font-size:24px; margin:0;">${esc(game.mapName)}</h1>
        <select id="personaQuickSelect" class="small" style="background:var(--card); border:1px solid var(--border); color:var(--text); padding:3px 8px; border-radius:4px; font-size:12px; cursor:pointer;" title="Change AI DM Narrative Persona">
          <option value="classic">🎲 Classic DM</option>
          <option value="grimdark">💀 Grimdark DM</option>
          <option value="epic">⚔️ Epic DM</option>
          <option value="snarky">🃏 Snarky DM</option>
          <option value="eldritch">👁️ Eldritch DM</option>
        </select>
      </div>
      <div>
        <a class="btn small" href="#/character/${game.characterId}">Sheet</a>
        <button class="btn small" id="dmSettingsBtn">⚙ DM Settings</button>
        <a class="btn small" href="#/">Heroes</a>
      </div>
    </div>
    <div class="play-layout">
      <div>
        <div class="map-wrap" id="mapWrap">
          <div id="map3d" style="width:100%; height:560px;"></div>
          
          <!-- 2D Minimap (Corner overlay in 3D mode, full in 2D mode) -->
          <div id="minimapContainer" class="minimap-container">
            <div class="minimap-header">
              <span class="minimap-title">🧭 Minimap</span>
              <div class="minimap-controls">
                <button class="minimap-btn" id="minimapExpandBtn" title="Toggle Minimap Size">⤢</button>
                <button class="minimap-btn" id="viewToggleMinimap" title="Switch to Full 2D View">2D Full</button>
              </div>
            </div>
            <div class="minimap-body">
              <canvas id="mapCanvas"></canvas>
            </div>
          </div>

          <div id="fctLayer" class="fct-layer"></div>
          <div class="map-hint" id="mapHint">Click to move · click a monster to target · arrows/WASD to step</div>
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

  const canvas = document.getElementById('mapCanvas');
  const renderer = createMapRenderer(canvas, { isSelected: e => selectedTarget && e.id === selectedTarget.id });
  let renderer3d = null;
  // Default to 3D mode unless explicitly turned off
  let activeView = localStorage.getItem('dnd_3d') === 'off' ? '2d' : '3d';

  function toggleView() {
    activeView = activeView === '3d' ? '2d' : '3d';
    localStorage.setItem('dnd_3d', activeView === '3d' ? 'on' : 'off');
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

  function activeRender(gameState) {
    const wrap = document.getElementById('mapWrap');
    const map3dEl = document.getElementById('map3d');
    const btn2D = document.getElementById('viewToggle2D');

    if (activeView === '3d') {
      if (!renderer3d) {
        renderer3d = createMap3D(map3dEl, {
          onTileClick: (x, y) => handleTileClick(x, y),
          isSelected: e => selectedTarget && e.id === selectedTarget.id
        });
      }
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
      renderer.render(gameState);
    }
  }

  canvas.addEventListener('click', ev => {
    const t = renderer.tileFromEvent(ev);
    if (t) handleTileClick(t.x, t.y);
  });

  const onKey = (e) => {
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
    if (game.portraits[key]) { portraitShown = game.portraits[key]; update(); return; }
    try {
      const res = await api.gameAction(game.id, { type: 'portrait', targetId: ent.id });
      game = res.state;
      if (res.portrait && res.portrait.url) {
        game.portraits[key] = res.portrait;
        if (selectedTarget && (selectedTarget.monsterId === key || selectedTarget.npcId === key)) {
          portraitShown = res.portrait;
        }
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
            <div class="stat-line"><span>${i.name} <span class="muted small">— ${esc(i.desc)}</span></span>
              <span><button class="btn small" data-buy="${i.id}" ${game.character.gold >= i.price ? '' : 'disabled'}>${i.price} gp</button></span></div>`).join('')}
          <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
            <button class="btn small" id="talkMarla">💬 Talk to the trader</button>
            <button class="btn small" id="closeShop">Leave</button>
          </div>
        </div>`;
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
    quest_done: 'quest', quest_offer: 'quest', loot: 'coin', magic_item: 'coin', trap: 'trap',
    trap_spotted: 'trap', trap_disarmed: 'victory', trap_disarm_failed: 'trap',
    chest_unlocked: 'coin', chest_locked: 'miss',
    dying: 'death', player_down: 'death', victory: 'victory', door: 'door', blessing: 'heal'
  };

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
    try {
      const res = await api.gameAction(game.id, action);
      game = res.state;
      // dice flourish on notable rolls
      const dmg = res.events.find(e => ['attack', 'spell_hit', 'attack_in', 'save'].includes(e.type));
      if (dmg && dmg.data && dmg.data.dmg) showDice(20, dmg.data.dmg, 'damage');
      // floating combat text popups for hits, crits, misses, heals, kills
      res.events.forEach((e, idx) => {
        let x = e.data?.targetX;
        let y = e.data?.targetY;
        if (x == null || y == null) {
          const tid = e.data?.targetId || (e.type === 'attack_in' ? 'player' : (selectedTarget?.id || action.targetId));
          const ent = game.entities.find(ent => ent.id === tid);
          if (ent) { x = ent.x; y = ent.y; }
          else if (tid === 'player' && player()) { x = player().x; y = player().y; }
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
      selectedTarget = null;
      appearanceShown = null;
      portraitShown = null;
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
    if ((game.mode === 'victory' || game.mode === 'over' || game.mode === 'retreat') && !summaryShown) {
      summaryShown = true;
      sfx.play((game.mode === 'victory' || game.mode === 'retreat') ? 'victory' : 'death');
      openSummary();
    }
    renderLog();
    const hint = document.getElementById('mapHint');
    if (game.mode === 'combat') hint.textContent = `Combat — round ${game.combat.round}. Click to move (movement left: ${game.combat.movementLeft} ft). Space = end turn.`;
    else if (game.mode === 'over') hint.textContent = 'You have fallen…';
    else if (game.mode === 'victory') hint.textContent = 'Victory!';
    else hint.textContent = 'Click to move · click a monster to target · arrows/WASD to step';
  }

  function openSettingsModal() {
    let modal = document.getElementById('settingsModal');
    if (modal) { modal.remove(); }
    modal = document.createElement('div');
    modal.className = 'modal-back';
    modal.id = 'settingsModal';
    modal.innerHTML = `
      <div class="modal" style="max-width:900px; max-height:90vh; overflow-y:auto; text-align:left;">
        <div style="display:flex; justify-content:space-between; align-items:center; position:sticky; top:0; background:var(--panel); padding:10px 6px; z-index:2;">
          <span></span>
          <button class="btn small" id="closeSettingsModal" style="position:absolute; right:14px; top:14px;">Done — back to the delve ✕</button>
        </div>
        <div id="settingsBody"></div>
      </div>`;
    document.body.appendChild(modal);
    settingsView(document.getElementById('settingsBody'));
    document.getElementById('closeSettingsModal').addEventListener('click', () => modal.remove());
  }

  const dmSettingsBtn = document.getElementById('dmSettingsBtn');
  if (dmSettingsBtn) dmSettingsBtn.addEventListener('click', openSettingsModal);

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

  // while delving, the topbar DM Settings opens as a modal so the delve stays open
  const settingsLink = document.querySelector('[data-nav="settings"]');
  const onSettingsNav = (e) => { e.preventDefault(); e.stopPropagation(); openSettingsModal(); };
  settingsLink.addEventListener('click', onSettingsNav, true);

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
    modal.innerHTML = `
      <div class="modal">
        <h2>${won ? '🏆 Delve Complete!' : (retreated ? '🏃 Retreated to Safety' : '💀 The Delve Ends… for now')}</h2>
        <p class="muted small">${esc(game.character.name)} · ${esc(game.mapName)} · level ${game.character.level}</p>
        <div class="stat-line"><span>⚔ Monsters slain</span><span>${st.kills || 0}</span></div>
        <div class="stat-line"><span>🗡 Damage dealt</span><span>${st.dmgDealt || 0}</span></div>
        <div class="stat-line"><span>🩸 Damage taken</span><span>${st.dmgTaken || 0}</span></div>
        <div class="stat-line"><span>💰 Gold banked</span><span>${game.character.gold || 0} gp (+${st.goldFound || 0} found)</span></div>
        <div class="stat-line"><span>⏱ Combat rounds</span><span>${st.rounds || 0}</span></div>
        <div class="stat-line"><span>📜 Side quests done</span><span>${(game.quests && game.quests.completed || []).length}</span></div>
        <div style="margin-top:14px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
          ${(won || retreated)
            ? `<a class="btn primary" href="#/overworld?char=${game.characterId}&return=${won ? 'victory' : 'retreat'}">🏰 Return to Oakhaven</a>
               <a class="btn" href="#/overworld?char=${game.characterId}">🗺️ Region Map</a>
               <a class="btn" href="#/">Home</a>`
            : `<button class="btn primary" id="sumRespawn">🌅 Recover at camp</button>
               <a class="btn" href="#/overworld?char=${game.characterId}">🏰 Retreat to Town</a>
               <a class="btn" href="#/">Home</a>`}
        </div>
      </div>`;
    // Automatically commit delve loot and progression back to persistent character
    if (game.characterId && game.id) {
      api.citySyncDelve({ charId: game.characterId, delveStateId: game.id }).catch(() => {});
    }
    const rr = document.getElementById('sumRespawn');
    if (rr) rr.addEventListener('click', () => { modal.remove(); summaryShown = false; act({ type: 'respawn' }); });
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
        ${(p.conditions.length || (p.buffs || []).filter(b => b.id !== 'concentrating').length) ? `<div style="margin-top:6px;">${p.conditions.map(c => `<span class="chip red">${esc(c)}</span>`).join('')}${(p.buffs || []).filter(b => b.id !== 'concentrating' && b.id !== 'cond_' ).map(b => `<span class="chip blue">${esc(b.id)}</span>`).join('')}</div>` : ''}
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

      ${game.quests && game.quests.active ? `
      <div class="card" style="border-color:var(--gold-dim);">
        <h3>📜 Side Quest</h3>
        <p class="small" style="color:var(--gold); font-weight:600;">${esc(game.quests.active.shortText)}</p>
        <p class="small muted">${esc(game.quests.active.text)}</p>
        <p class="small" style="margin-top:6px;"><span class="chip">💰 ${game.quests.active.reward.gold} gp</span> <span class="chip blue">✨ ${game.quests.active.reward.xp} XP</span></p>
      </div>` : ''}

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
          ${atCampfire() && !(game.quests && game.quests.active) ? '<button class="btn" data-act="askwork" style="grid-column:1 / -1;">🎲 Ask around for work</button>' : ''}
          ${(atCampfire() || atEntrance()) ? '<button class="btn primary" data-act="retreat" style="grid-column:1 / -1; background:linear-gradient(180deg, #3d5a42, #29422e); border-color:#508059;">🏰 Retreat to Oakhaven</button>' : ''}
          <button class="btn" data-act="journal" style="grid-column:1 / -1;">📖 Journal${(game.journal || []).length ? ` (${game.journal.length})` : ''}</button>
        </div>
        <div style="margin-top:8px;">${classActions()}</div>
      </div>`}

      <div class="card">
        <h3>Inventory</h3>
        ${char.inventory.map(i => {
          const def = appState.rules.weapons.find(w => w.id === i.itemId) || appState.rules.armor.find(w => w.id === i.itemId) || appState.rules.gear.find(w => w.id === i.itemId);
          const usable = def && (def.type === 'potion' || def.type === 'scroll');
          return `<div class="stat-line"><span>${def ? def.name : i.itemId}</span><span>${usable && i.qty > 0 ? `<button class="btn small" data-useitem="${i.itemId}">Use</button>` : ''} ×${i.qty}</span></div>`;
        }).join('')}
      </div>

      <div class="card">
        <h3>Objective</h3>
        <p class="small muted">${charObjective(game)}</p>
      </div>
    `;

    wireSide(myTurn);
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
          <div class="quick-slot-card ${disClass}" data-quickslot="${i}" title="${esc(item.name)} (Key [${i + 1}])">
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
      ? `Target: <b>${esc(selectedTarget.name)}</b> (${selectedTarget.hpMax ? selectedTarget.hp + '/' + selectedTarget.hpMax + ' HP, ' : 'Object, '}AC ${selectedTarget.ac || 10})`
      : 'Click a monster or object on the map to target it.';
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
        ${renderQuickSlots(myTurn)}
        <h3>Your turn</h3>
        <div class="action-grid">
          <button class="btn" data-act="attack" ${myTurn ? '' : 'disabled'}>🗡 Attack</button>
          <button class="btn" data-act="castmenu" ${myTurn ? '' : 'disabled'}>✨ Cast…</button>
          <button class="btn" data-act="dodge" ${myTurn ? '' : 'disabled'}>🛡 Dodge</button>
          <button class="btn" data-act="dash" ${myTurn ? '' : 'disabled'}>💨 Dash</button>
          <button class="btn" data-act="potion">🧪 Potion (${(game.character.inventory || []).filter(i => ['potion_healing', 'potion_greater'].includes(i.itemId)).reduce((s, i) => s + i.qty, 0)})</button>
          <button class="btn" data-act="endturn" ${myTurn ? '' : 'disabled'}>⏭ End Turn</button>
        </div>
        <div style="margin-top:8px;">${classActions(myTurn)}</div>
        <div id="castMenu"></div>
      </div>`;
  }

  function classActions(myTurn = true) {
    const char = game.character;
    const cls = appState.rules.classes.find(c => c.id === char.className);
    const uses = char.uses || {};
    const btns = [];
    const dis = myTurn ? '' : 'disabled';
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
      if (a === 'retreat') act({ type: 'retreat' });
      if (a === 'dodge') act({ type: 'dodge' });
      if (a === 'dash') act({ type: 'dash' });
      if (a === 'endturn') act({ type: 'endTurn' });
      if (a === 'attack') {
        if (!selectedTarget) return toast('Click a monster or object first to target it.');
        const char = game.character;
        const melee = char.attacks.find(x => !x.ranged && x.weaponId !== 'unarmed');
        const atk = selectedTarget && Math.abs(player().x - selectedTarget.x) + Math.abs(player().y - selectedTarget.y) <= 1
          ? (melee || char.attacks[0])
          : (char.attacks.find(x => x.ranged) || char.attacks[0]);
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

  sfx.stopAmbient();
  return () => { clearInterval(pollTimer); document.removeEventListener('keydown', onKey); tts.stop(); sfx.stopAmbient(); if (renderer3d) renderer3d.dispose(); settingsLink.removeEventListener('click', onSettingsNav, true); };
}
