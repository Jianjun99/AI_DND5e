// referee.js — maps freeform player text to deterministic game mechanics.
// The referee decides IF and HOW the world changes; the DM (LLM) only narrates.
const engine = require('./engine');

function nearLockedDoor(state) {
  const p = engine.playerEntity(state);
  return state.objects.find(o => o.type === 'door' && !o.open && o.locked && !o.unlocked && engine.manhattan(p, o) <= 1);
}
function nearObj(state, id) {
  const p = engine.playerEntity(state);
  return state.objects.find(o => o.id === id && engine.manhattan(p, o) <= 1);
}
function nearestVisibleMonster(state, nameGuess) {
  const p = engine.playerEntity(state);
  const monsters = state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled);
  let list = monsters.filter(m => engine.los(state, p.x, p.y, m.x, m.y) && engine.manhattan(p, m) <= 10);
  if (!list.length) list = monsters.filter(m => engine.manhattan(p, m) <= 3);
  if (nameGuess) {
    const named = list.find(m => m.name.toLowerCase().includes(nameGuess)) || monsters.find(m => m.name.toLowerCase().includes(nameGuess));
    if (named) return named;
  }
  return list.sort((a, b) => engine.manhattan(p, a) - engine.manhattan(p, b))[0] || null;
}

function resolveFreeform(state, text) {
  const events = [];
  const t = text.toLowerCase();
  const p = engine.playerEntity(state);
  const char = state.character;

  // --- stealth / hide ---
  if (/\b(hide|sneak|stealth|creep|tiptoe)\b/.test(t)) {
    const check = engine.skillCheck(state, 'stealth', 99);
    state.stealth = check;
    const ev = {
      type: 'stealth', narrate: true,
      text: `${p.name} melts into the shadows (Stealth: ${check.detail.split(' vs')[0]}). You move quietly — monsters will struggle to notice you until you attack or make noise.`
    };
    events.push(ev); engine.addLog(state, 'mech', ev.text);
    return { handled: true, events };
  }

  // --- search / investigate ---
  if (/\b(search|investigate|examine|inspect|look around|study|check)\b/.test(t)) {
    // reveal traps within 2 tiles
    let found = false;
    state.objects.filter(o => o.type === 'trap' && !o.revealed && !o.triggered && engine.manhattan(o, p) <= 2).forEach(trap => {
      const check = engine.skillCheck(state, 'investigation', 12);
      if (check.success) {
        trap.revealed = true; found = true;
        const ev = { type: 'trap_found', narrate: true, text: `Searching carefully, ${p.name} finds a ${trap.name} hidden on the floor (Investigation ${check.detail}). Avoid it — or disarm it from an adjacent tile.` };
        events.push(ev); engine.addLog(state, 'mech', ev.text);
      } else {
        const ev = { type: 'info', narrate: true, text: `${p.name} searches (Investigation ${check.detail}) but finds nothing amiss... though the floor here makes you uneasy.` };
        events.push(ev);
      }
    });
    // Morthek's gift: searching the dying adventurer
    const morthek = state.entities.find(e => e.kind === 'npc' && e.npcId === 'morthek' && engine.manhattan(e, p) <= 2);
    if (morthek && !state.flags.morthek_potion) {
      state.flags.morthek_potion = true;
      const inv = char.inventory.find(x => x.itemId === 'potion_healing');
      if (inv) inv.qty++; else char.inventory.push({ itemId: 'potion_healing', qty: 1 });
      const ev = { type: 'loot', narrate: true, text: `Morthek presses a Potion of Healing into your hands with shaking fingers. "For luck," he rasps. "You'll need it."` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
    }
    if (!found && !state.flags.morthek_potion) {
      const ev = { type: 'info', narrate: true, text: `${p.name} searches the area but finds nothing of note.` };
      events.push(ev);
    }
    return { handled: true, events };
  }

  // --- listen ---
  if (/\b(listen|hear)\b/.test(t)) {
    const check = engine.skillCheck(state, 'perception', 12);
    const monsters = state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled && engine.manhattan(e, p) <= 12);
    const near = monsters.sort((a, b) => engine.manhattan(p, a) - engine.manhattan(p, b))[0];
    if (check.success && near) {
      const dx = near.x - p.x, dy = near.y - p.y;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : (dy > 0 ? 'south' : 'north');
      const ev = { type: 'listen', narrate: true, text: `${p.name} listens (Perception ${check.detail}). From the ${dir}, you hear ${near.name === near.name && near.monsterId === 'giant_rat' ? 'the skitter of claws' : near.monsterId === 'skeleton' ? 'the rattle of dry bones' : near.monsterId === 'goblin' ? 'a hoarse goblin argument' : near.monsterId === 'ogre' ? 'a slow, thunderous snoring' : 'movement in the dark'}. Something waits that way.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
    } else {
      const ev = { type: 'listen', narrate: true, text: `${p.name} listens (Perception ${check.detail}) — only dripping water and your own heartbeat.` };
      events.push(ev);
    }
    return { handled: true, events };
  }

  // --- disarm trap ---
  if (/\b(disarm|disable)\b/.test(t)) {
    const trap = state.objects.find(o => o.type === 'trap' && o.revealed && !o.disarmed && !o.triggered && engine.manhattan(o, p) <= 1);
    if (!trap) { events.push({ type: 'error', text: 'No revealed trap within reach.' }); return { handled: true, events }; }
    const hasTools = char.inventory.some(i => i.itemId === 'thieves_tools');
    if (!hasTools) { events.push({ type: 'error', text: 'You need thieves\' tools to disarm a trap.' }); return { handled: true, events }; }
    let check = engine.skillCheck(state, 'sleight_of_hand', 13);
    if (char.className === 'rogue' && !check.success) check = engine.skillCheck(state, 'sleight_of_hand', 13);
    if (check.success) {
      trap.disarmed = true;
      const ev = { type: 'trap_disarmed', narrate: true, text: `${p.name} carefully snips the trigger mechanism (SoH ${check.detail}) — the ${trap.name} is disarmed.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
    } else {
      const ev = { type: 'trap_fail', narrate: true, text: `${p.name}'s picks slip (SoH ${check.detail}) — the trap remains armed. Try again, or step wide.` };
      events.push(ev); engine.addLog(state, 'mech', ev.text);
      engine.triggerTrap(state, trap, events);
    }
    return { handled: true, events };
  }

  // --- doors: pick lock / force ---
  const door = nearLockedDoor(state);
  if (door && /\b(pick|unlock|lockpick|lock pick|open|force|break|smash|pry|bash)\b/.test(t)) {
    engine.interactDoor(state, door, events);
    return { handled: true, events };
  }

  // --- altar / pray ---
  if (/\b(pray|altar|bless)\b/.test(t)) {
    const altar = nearObj(state, 'altar');
    if (altar) { engine.interactObject(state, 'altar', events); return { handled: true, events }; }
    events.push({ type: 'info', text: 'There is nothing here to pray to. The altar lies in the deepest sanctum.' });
    return { handled: true, events };
  }

  // --- potion ---
  if (/\b(drink|quaff|sip)\b/.test(t) || /\b(use|take)\b.*potion/.test(t) || /\bheal\b/.test(t)) {
    const potionIds = ['potion_healing', 'potion_greater'];
    const entry = potionIds
      .map(id => ({ id, inv: char.inventory.find(x => x.itemId === id && x.qty > 0) }))
      .find(p => p.inv);
    if (!entry) { events.push({ type: 'error', text: 'You have no potions left.' }); return { handled: true, events }; }
    entry.inv.qty--;
    const def = engine.byId(engine.GEAR, entry.id);
    const r = engine.rollExpr(def.heal);
    engine.healEntity(state, p, r.total, events, def.name);
    engine.addLog(state, 'mech', `${p.name} drinks a ${def.name}. ${entry.inv.qty} left.`);
    return { handled: true, events };
  }

  // --- rest ---
  if (/\b(rest|camp|sleep)\b/.test(t)) {
    const camp = state.map.victoryTile;
    if (p.x === camp.x && p.y === camp.y && /\b(long|sleep|night|dawn)\b/.test(t)) engine.longRest(state, events);
    else engine.shortRest(state, events);
    return { handled: true, events };
  }

  // --- attack something by name ---
  const attackMatch = /\b(attack|strike|shoot|stab|smite|hit|fight)\b\s*(the\s+|at\s+)?(\w+)?/.exec(t);
  if (attackMatch) {
    const guess = attackMatch[3];
    const target = nearestVisibleMonster(state, guess && guess !== 'it' ? guess : null);
    if (target) {
      if (state.mode === 'explore') {
        target.aware = true;
        engine.startCombat(state, [target.id, ...state.entities.filter(m => m.kind === 'monster' && m.alive && !m.fled && engine.manhattan(m, p) <= 3).map(m => m.id)], events);
      }
      const atk = char.attacks.find(a => a.ranged === false && a.weaponId !== 'unarmed') || char.attacks[0];
      engine.playerAttack(state, target.id, atk.weaponId, events);
      if (state.mode === 'combat' && state.combat) state.combat.actionUsed = true;
      return { handled: true, events };
    }
    events.push({ type: 'error', text: 'You see nothing to attack.' });
    return { handled: true, events };
  }

  // --- move in a direction ---
  const dirMatch = /\b(?:go|move|walk|head|run)\b.*\b(north|south|east|west)\b/.exec(t) || /\b(north|south|east|west)\b/.exec(t);
  if (dirMatch) {
    const dir = dirMatch[1] || dirMatch[0];
    const delta = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[dir] || { north: [0, -1] }[dir];
    if (delta) {
      const tx = p.x + delta[0] * 3, ty = p.y + delta[1] * 3;
      engine.movePlayer(state, Math.max(0, Math.min(state.map.width - 1, tx)), Math.max(0, Math.min(state.map.height - 1, ty)), events);
      return { handled: true, events };
    }
  }

  // --- parley with NPCs via social skill ---
  const social = /\b(persuade|convince|intimidate|threaten|deceive|lie|bluff|parley|bribe|pay|talk|speak)\b/.exec(t);
  if (social) {
    const griznak = state.entities.find(e => e.id === 'griznak' && e.alive && !e.fled && engine.manhattan(e, p) <= 6);
    if (griznak) {
      if (!state.mode || state.mode === 'explore') {
        griznak.aware = true;
      }
      const skill = /\b(intimidate|threaten)\b/.test(t) ? 'intimidation' : /\b(deceive|lie|bluff)\b/.test(t) ? 'deception' : 'persuasion';
      const check = engine.skillCheck(state, skill, 13);
      if (check.success) {
        state.entities.filter(e => e.chief || (e.monsterId === 'goblin' && e.id !== 'griznak' && engine.manhattan(e, p) <= 10)).forEach(g => { g.fled = true; g.alive = true; });
        griznak.fled = true;
        engine.awardXp(state, 50, events);
        const ev = { type: 'parley', narrate: true, text: `${p.name} ${skill === 'intimidation' ? 'looms over' : 'talks rings around'} Griznak (${engine.cap(skill)} ${check.detail}). The goblin chief's bravado crumbles — he squeals for his band and they scatter into the dark. (+50 XP)` };
        events.push(ev); engine.addLog(state, 'mech', ev.text);
        if (state.mode === 'combat') { engine.checkCombatEnd(state, events); }
      } else {
        const ev = { type: 'parley_fail', narrate: true, text: `${p.name} tries to ${skill === 'intimidation' ? 'menace' : 'reason with'} Griznak (${engine.cap(skill)} ${check.detail}) — the goblin just grins, all yellow teeth. "Bad deal, soft-skin!" He whistles for his warriors...` };
        events.push(ev); engine.addLog(state, 'mech', ev.text);
        if (state.mode !== 'combat') {
          const ids = state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled && ['griznak', 'gob2', 'gob3'].includes(e.id)).map(e => e.id);
          engine.startCombat(state, ids, events);
        }
      }
      return { handled: true, events };
    }
    const npc = state.entities.find(e => e.kind === 'npc' && engine.manhattan(e, p) <= 4);
    if (npc) {
      events.push({ type: 'chat_open', narrate: false, text: `${npc.name} looks at you expectantly.`, data: { npcId: npc.npcId, name: npc.name } });
      return { handled: true, events };
    }
    events.push({ type: 'info', text: 'There is no one here to talk to.' });
    return { handled: true, events };
  }

  // --- dodge / dash ---
  if (/\b(dodge|defend|guard)\b/.test(t) && state.mode === 'combat') {
    engine.addBuff(p, { id: 'dodge', rounds: 2 });
    if (state.combat) state.combat.actionUsed = true;
    const ev = { type: 'dodge', narrate: true, text: `${p.name} takes a defensive stance — attacks against them have disadvantage.` };
    events.push(ev); engine.addLog(state, 'mech', ev.text);
    return { handled: true, events };
  }

  // --- interact with nearby object ---
  if (/\b(open|take|grab|loot|touch|collect|relic)\b/.test(t)) {
    const interactables = state.objects.filter(o => ['door', 'chest'].includes(o.type) || ['relic', 'altar', 'campfire'].includes(o.id));
    const near = interactables.filter(o => engine.manhattan(o, p) <= 1).sort((a, b) => engine.manhattan(p, a) - engine.manhattan(p, b))[0];
    if (near) { engine.interactObject(state, near.id, events); return { handled: true, events }; }
  }

  // --- buy from Marla ---
  const buyMatch = /\b(buy|purchase|shop|stock up)\b/.exec(t);
  if (buyMatch) {
    const marla = state.entities.find(e => e.kind === 'npc' && e.npcId === 'marla' && engine.manhattan(e, p) <= 3);
    if (!marla) {
      events.push({ type: 'error', text: "No shop here — Marla's stall is by the entrance camp." });
      return { handled: true, events };
    }
    let itemId = null;
    if (/potion|healing|heal/.test(t)) itemId = 'potion_healing';
    else if (/kit|bandage/.test(t)) itemId = 'healers_kit';
    else if (/tools|lockpick|thieve/.test(t)) itemId = 'thieves_tools';
    if (!itemId) {
      events.push({ type: 'chat_open', narrate: false, text: `Marla pats her stall. "Potions, kits, or thieves' tools, dear — what'll it be?"`, data: { npcId: 'marla', name: 'Marla the Peddler' } });
      return { handled: true, events };
    }
    const item = engine.SHOP_ITEMS.find(i => i.id === itemId);
    const char = state.character;
    if (char.gold < item.price) {
      events.push({ type: 'error', text: `You can't afford ${item.name} (${item.price} gp) — you carry ${char.gold} gp.` });
      return { handled: true, events };
    }
    char.gold -= item.price;
    const inv = char.inventory.find(x => x.itemId === itemId);
    if (inv) inv.qty++; else char.inventory.push({ itemId, qty: 1 });
    const ev = { type: 'shop', narrate: true, text: `${p.name} buys ${item.name} from Marla for ${item.price} gp.` };
    events.push(ev); engine.addLog(state, 'mech', `${p.name} buys ${item.name} (−${item.price} gp, ${char.gold} left).`);
    return { handled: true, events };
  }

  // --- class flavor freeform (consult the die: give a small perk or just flavor) ---
  return { handled: false, events };
}

module.exports = { resolveFreeform };
