// play.js — the delve: canvas map, combat HUD, log, chat
import { api } from '../api.js';
import { esc, toast, state as appState, charObjective } from '../app.js';
import { createMapRenderer } from '../map.js';
import { showDice } from '../dice.js';

let game = null;
let selectedTarget = null;
let activeNpc = null;
let appearanceShown = null;
let busy = false;

export async function playView(main, saveRef) {
  // Start a fresh delve: show the setup modal (difficulty + companion)
  if (saveRef === 'new') {
    const charId = new URLSearchParams(location.hash.split('?')[1] || '').get('char');
    if (!charId) { location.hash = '#/'; return; }
    const chars = await api.listCharacters();
    const char = chars.find(c => c.id === charId);
    const rules = appState.rules;
    main.innerHTML = `
      <div class="modal-back" style="position:static; background:none; display:block; padding-top:30px;">
        <div class="modal" style="max-width:640px; margin:0 auto;">
          <h2>Prepare the delve</h2>
          <p class="muted small">${esc(char ? char.name : 'Your hero')} descends into <b>The Sunless Crypt</b>. Choose the terms:</p>
          <div class="card" style="margin:12px 0;">
            <h3>Difficulty</h3>
            ${Object.entries(rules.difficulty || {}).map(([id, d]) => `
              <label style="display:block; margin:8px 0; color:var(--text);">
                <input type="radio" name="difficulty" value="${id}" ${id === 'normal' ? 'checked' : ''} style="width:auto">
                <b>${d.label}</b> <span class="muted small">— ${esc(d.blurb)}</span>
              </label>`).join('')}
          </div>
          <div class="card" style="margin:12px 0;">
            <label style="display:block; margin:0; color:var(--text);">
              <input type="checkbox" id="allyToggle" checked style="width:auto">
              🏹 Bring <b>Bram the Scout</b> as an AI companion <span class="muted small">(recommended for solo balance)</span>
            </label>
          </div>
          <button class="btn primary big" id="beginBtn" style="width:100%;">⚔ Descend into the Crypt</button>
        </div>
      </div>`;
    document.getElementById('beginBtn').addEventListener('click', async () => {
      const difficulty = document.querySelector('input[name="difficulty"]:checked').value;
      const bringAlly = document.getElementById('allyToggle').checked;
      try {
        const { state } = await api.startGame(charId, { bringAlly, difficulty });
        location.hash = `#/play/${state.id}`;
      } catch (e) { toast(e.message); }
    });
    return () => {};
  }
  const data = await api.getGame(saveRef);
  game = data.state;
  selectedTarget = null; activeNpc = null; appearanceShown = null;

  main.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:baseline;">
      <h1 style="font-size:24px;">${esc(game.mapName)}</h1>
      <div>
        <a class="btn small" href="#/character/${game.characterId}">Sheet</a>
        <a class="btn small" href="#/">Heroes</a>
      </div>
    </div>
    <div class="play-layout">
      <div>
        <div class="map-wrap">
          <canvas id="mapCanvas"></canvas>
          <div class="map-hint" id="mapHint">Click to move · click a monster to target · arrows/WASD to step</div>
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

  canvas.addEventListener('click', ev => {
    const t = renderer.tileFromEvent(ev);
    handleTileClick(t.x, t.y);
  });

  const onKey = (e) => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const dirs = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
    const d = dirs[e.key];
    if (d) {
      e.preventDefault();
      const p = player();
      act({ type: 'move', x: p.x + d[0], y: p.y + d[1] });
    }
    if (e.key === ' ' && game.mode === 'combat') { e.preventDefault(); act({ type: 'endTurn' }); }
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
    const camp = game.map.victoryTile;
    const p = player();
    return p.x === camp.x && p.y === camp.y;
  }

  // Fetch (and cache server-side) a vivid appearance description for a monster/NPC
  async function fetchAppearance(ent) {
    const key = ent.kind === 'monster' ? ent.monsterId : ent.npcId;
    game.appearances = game.appearances || {};
    if (game.appearances[key]) { appearanceShown = game.appearances[key]; update(); return; }
    try {
      const res = await api.gameAction(game.id, { type: 'describe', targetId: ent.id });
      game = res.state;
      appearanceShown = res.appearance || null;
      update();
    } catch { /* appearance is optional flavor */ }
  }

  // Marla's shop
  function openShop() {
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
          <h2>🧺 Marla's Stall</h2>
          <p class="muted small">"Potions, tools, and luck, dear — I sell the first two."</p>
          <p class="small">Your gold: <b style="color:var(--gold)">${game.character.gold} gp</b></p>
          ${items.map(i => `
            <div class="stat-line"><span>${i.name} <span class="muted small">— ${esc(i.desc)}</span></span>
              <span><button class="btn small" data-buy="${i.id}" ${game.character.gold >= i.price ? '' : 'disabled'}>${i.price} gp</button></span></div>`).join('')}
          <div style="margin-top:12px; display:flex; gap:8px; justify-content:center;">
            <button class="btn small" id="talkMarla">💬 Talk to Marla</button>
            <button class="btn small" id="closeShop">Leave</button>
          </div>
        </div>`;
      modal.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
        await act({ type: 'buy', itemId: b.dataset.buy });
        render();
      }));
      document.getElementById('closeShop').addEventListener('click', () => modal.remove());
      document.getElementById('talkMarla').addEventListener('click', () => {
        activeNpc = { id: 'marla', name: 'Marla the Peddler' };
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
        <div style="text-align:center; margin-top:12px;">
          <button class="btn small" id="closeJournal">Close</button>
        </div>
      </div>`;
    document.getElementById('closeJournal').addEventListener('click', () => modal.remove());
  }

  async function act(action) {
    if (busy) return;
    busy = true;
    try {
      const res = await api.gameAction(game.id, action);
      game = res.state;
      // dice flourish on notable rolls
      const dmg = res.events.find(e => ['attack', 'spell_hit', 'attack_in', 'save'].includes(e.type));
      if (dmg && dmg.data && dmg.data.dmg) showDice(20, dmg.data.dmg, 'damage');
      if (res.events.some(e => e.type === 'chat_open')) {
        const ev = res.events.find(e => e.type === 'chat_open');
        activeNpc = { id: ev.data.npcId, name: ev.data.name };
      }
      if (res.events.some(e => e.type === 'journal')) toast('📖 Journal updated');
      if (res.chatReply) toast('The NPC answers…');
      selectedTarget = null;
      appearanceShown = null;
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
      if (ent.npcId === 'marla' && Math.abs(player().x - x) + Math.abs(player().y - y) <= 3) {
        openShop();
        return;
      }
      act({ type: 'freeform', text: 'talk to ' + ent.name });
      return;
    }
    const obj = (game.objects || []).find(o => o.x === x && o.y === y && o.type !== 'npcMarker');
    if (obj) {
      const p = player();
      const dist = Math.abs(p.x - x) + Math.abs(p.y - y);
      if (dist <= 1 && ['door', 'chest'].includes(obj.type)) { act({ type: 'interact', objectId: obj.id }); return; }
      if (dist <= 1 && ['relic', 'altar', 'campfire'].includes(obj.id)) { act({ type: 'interact', objectId: obj.id }); return; }
    }
    act({ type: 'move', x, y });
  }

  // ---------------- rendering ----------------
  function update() {
    renderer.render(game);
    renderSide();
    renderLog();
    const hint = document.getElementById('mapHint');
    if (game.mode === 'combat') hint.textContent = `Combat — round ${game.combat.round}. Click to move (movement left: ${game.combat.movementLeft} ft). Space = end turn.`;
    else if (game.mode === 'over') hint.textContent = 'You have fallen…';
    else if (game.mode === 'victory') hint.textContent = 'Victory!';
    else hint.textContent = 'Click to move · click a monster to target · arrows/WASD to step';
  }

  function renderSide() {
    const char = game.character;
    const p = player();
    const rules = appState.rules;
    const cls = rules.classes.find(c => c.id === char.className);
    const myTurn = game.mode !== 'combat' || game.combat.order[game.combat.turnIdx].id === 'player';
    const potCount = (char.inventory.find(i => i.itemId === 'potion_healing') || {}).qty || 0;

    document.getElementById('sidePanel').innerHTML = `
      <div class="card">
        <h3>${esc(char.name)} <span class="muted" style="text-transform:none;">Lv ${char.level} ${esc(cls.name)}</span></h3>
        <div style="margin-bottom:6px;">
          <span class="chip ${game.difficulty === 'hard' ? 'red' : game.difficulty === 'easy' ? 'blue' : ''}">${esc((appState.rules.difficulty || {})[game.difficulty]?.label || 'Normal')}</span>
          ${game.flags.ally ? '<span class="chip blue">🏹 Bram</span>' : ''}
        </div>
        <div class="hp-bar"><div class="fill" style="width:${Math.max(0, (p.hp / p.hpMax) * 100)}%"></div></div>
        <div class="hp-text"><span>${p.hp}/${p.hpMax} HP${p.tempHp ? ` (+${p.tempHp} temp)` : ''}</span><span>AC ${acNow()}</span></div>
        <div class="hp-text"><span>Speed ${speedNow()} ft</span><span>XP ${char.xp} · ${char.gold} gp</span></div>
        <div class="hp-text"><span>Slots: ${slotText()}</span><span>HD left: ${char.level - (char.hdUsed || 0)}</span></div>
        ${(p.conditions.length || (p.buffs || []).filter(b => b.id !== 'concentrating').length) ? `<div style="margin-top:6px;">${p.conditions.map(c => `<span class="chip red">${esc(c)}</span>`).join('')}${(p.buffs || []).filter(b => b.id !== 'concentrating' && b.id !== 'cond_' ).map(b => `<span class="chip blue">${esc(b.id)}</span>`).join('')}</div>` : ''}
      </div>

      ${appearanceShown && selectedTarget ? `
      <div class="card" style="border-color:var(--gold-dim);">
        <p class="small" style="font-family:var(--font-serif); color:var(--parchment); margin:0;">${esc(appearanceShown)}</p>
      </div>` : ''}

      ${game.mode === 'over' ? `
      <div class="card" style="border-color:#6b3a35;">
        <h3 style="color:#d98a80;">You have fallen</h3>
        <p class="small muted">The crypt claims another soul… but Bram drags you back to the firelight.</p>
        <button class="btn primary" data-act="respawn">🌅 Recover at camp (half HP)</button>
      </div>
      ` : game.mode === 'combat' ? combatHud(myTurn) : `
      <div class="card">
        <h3>Actions</h3>
        <div class="action-grid">
          <button class="btn" data-act="rest">🛏 Short Rest</button>
          <button class="btn" data-act="longrest">🔥 Long Rest</button>
          <button class="btn" data-act="potion">🧪 Potion (${potCount})</button>
          <button class="btn" data-act="search">🔍 Search</button>
          ${atCampfire() ? '<button class="btn" data-act="recap" style="grid-column:1 / -1;">✍ Write journal entry</button>' : ''}
          <button class="btn" data-act="journal" style="grid-column:1 / -1;">📖 Journal${(game.journal || []).length ? ` (${game.journal.length})` : ''}</button>
        </div>
        <div style="margin-top:8px;">${classActions()}</div>
      </div>`}

      <div class="card">
        <h3>Inventory</h3>
        ${char.inventory.map(i => {
          const def = appState.rules.weapons.find(w => w.id === i.itemId) || appState.rules.armor.find(w => w.id === i.itemId) || appState.rules.gear.find(w => w.id === i.itemId);
          return `<div class="stat-line"><span>${def ? def.name : i.itemId}</span><span>×${i.qty}</span></div>`;
        }).join('')}
      </div>

      <div class="card">
        <h3>Objective</h3>
        <p class="small muted">${charObjective(game)}</p>
      </div>
    `;

    wireSide(myTurn);
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
      ? `Target: <b>${esc(selectedTarget.name)}</b> (${selectedTarget.hp}/${selectedTarget.hpMax} HP, AC ${selectedTarget.ac})`
      : 'Click a monster on the map to target it.';
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
        <h3>Your turn</h3>
        <div class="action-grid">
          <button class="btn" data-act="attack" ${myTurn ? '' : 'disabled'}>🗡 Attack</button>
          <button class="btn" data-act="castmenu" ${myTurn ? '' : 'disabled'}>✨ Cast…</button>
          <button class="btn" data-act="dodge" ${myTurn ? '' : 'disabled'}>🛡 Dodge</button>
          <button class="btn" data-act="dash" ${myTurn ? '' : 'disabled'}>💨 Dash</button>
          <button class="btn" data-act="potion">🧪 Potion (${(game.character.inventory.find(i => i.itemId === 'potion_healing') || {}).qty || 0})</button>
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
    document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'rest') act({ type: 'rest', kind: 'short' });
      if (a === 'longrest') act({ type: 'rest', kind: 'long' });
      if (a === 'potion') act({ type: 'useItem', itemId: 'potion_healing' });
      if (a === 'search') act({ type: 'freeform', text: 'search the area carefully' });
      if (a === 'respawn') act({ type: 'respawn' });
      if (a === 'journal') openJournal();
      if (a === 'recap') act({ type: 'recap' });
      if (a === 'dodge') act({ type: 'dodge' });
      if (a === 'dash') act({ type: 'dash' });
      if (a === 'endturn') act({ type: 'endTurn' });
      if (a === 'attack') {
        if (!selectedTarget) return toast('Click a monster first to target it.');
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
      else if (!selectedTarget) toast('Target a monster first (or yourself for buffs via "self").');
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

  return () => { clearInterval(pollTimer); document.removeEventListener('keydown', onKey); };
}
