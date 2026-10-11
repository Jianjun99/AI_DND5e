const presentation = require("./presentation");
// referee.js — maps freeform player text to deterministic game mechanics.
// The referee decides IF and HOW the world changes; the DM (LLM) only narrates.
const engine = require('./engine');
const executor = require('./action-executor');

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

const boundedActions = require('./bounded-actions');

function resolveFreeform(state, text, locale = 'en') {
  const boundedResult = boundedActions.parseDeterministicAction(state, text, locale);
  if (boundedResult.handled) {
    const events = boundedResult.events || [];
    if (boundedResult.clarification) {
      return { handled: true, clarification: boundedResult.clarification, events };
    }
    if (boundedResult.confirmation) {
      return { handled: true, confirmation: boundedResult.confirmation, events };
    }
    if (boundedResult.error) {
      events.push(boundedResult.error);
      return { handled: true, error: boundedResult.error, events };
    }
    if (boundedResult.proposal) {
      boundedActions.executeProposal(state, boundedResult.proposal, locale, events);
      return { handled: true, proposal: boundedResult.proposal, events };
    }
    return { handled: true, events };
  }

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
      ...presentation.eventMessage("event.referee.resolveFreeform.1",[presentation.name(p,state),check.detail.split(' vs')[0]],[""," melts into the shadows (Stealth: ","). You move quietly — monsters will struggle to notice you until you attack or make noise."])
    };
    events.push(ev); engine.addLog(state, 'mech', ev);
    return { handled: true, events };
  }

  // --- search / investigate ---
  if (/\b(search|investigate|examine|inspect|look around|study|check)\b/.test(t)) {
    // The same single search rule the bounded natural-language path uses.
    executor.searchArea(state, events);
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
      const ev = { type: 'listen', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.6",[presentation.name(p,state),check.detail,dir,(near.name === near.name && near.monsterId === 'giant_rat' ? presentation.eventMessage("event.referee.resolveFreeform.7",[],["the skitter of claws"]) : (near.monsterId === 'skeleton' ? presentation.eventMessage("event.referee.resolveFreeform.8",[],["the rattle of dry bones"]) : (near.monsterId === 'goblin' ? presentation.eventMessage("event.referee.resolveFreeform.9",[],["a hoarse goblin argument"]) : (near.monsterId === 'ogre' ? presentation.eventMessage("event.referee.resolveFreeform.10",[],["a slow, thunderous snoring"]) : presentation.eventMessage("event.referee.resolveFreeform.11",[],["movement in the dark"])))))],[""," listens (Perception ","). From the ",", you hear ",". Something waits that way."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
    } else {
      const ev = { type: 'listen', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.12",[presentation.name(p,state),check.detail],[""," listens (Perception ",") — only dripping water and your own heartbeat."]) };
      events.push(ev);
    }
    return { handled: true, events };
  }

  // --- disarm trap ---
  if (/\b(disarm|disable)\b/.test(t)) {
    const trap = state.objects.find(o => o.type === 'trap' && o.revealed && !o.disarmed && !o.triggered && engine.manhattan(o, p) <= 1);
    if (!trap) { events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.13",[],["No revealed trap within reach."]) }); return { handled: true, events }; }
    const hasTools = char.inventory.some(i => i.itemId === 'thieves_tools');
    if (!hasTools) { events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.14",[],["You need thieves' tools to disarm a trap."]) }); return { handled: true, events }; }
    let check = engine.skillCheck(state, 'sleight_of_hand', 13);
    if (char.className === 'rogue' && !check.success) check = engine.skillCheck(state, 'sleight_of_hand', 13);
    if (check.success) {
      trap.disarmed = true;
      const ev = { type: 'trap_disarmed', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.15",[presentation.name(p,state),check.detail,presentation.name(trap,state)],[""," carefully snips the trigger mechanism (SoH ",") — the "," is disarmed."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
    } else {
      const ev = { type: 'trap_fail', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.16",[presentation.name(p,state),check.detail],["","'s picks slip (SoH ",") — the trap remains armed. Try again, or step wide."]) };
      events.push(ev); engine.addLog(state, 'mech', ev);
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
    events.push({ type: 'info', ...presentation.eventMessage("event.referee.resolveFreeform.17",[],["There is nothing here to pray to. The altar lies in the deepest sanctum."]) });
    return { handled: true, events };
  }

  // --- potion ---
  if (/\b(drink|quaff|sip)\b/.test(t) || /\b(use|take)\b.*potion/.test(t) || /\bheal\b/.test(t)) {
    // Same executor as the useItem button: turn, bonus-action economy and the real instance.
    executor.drinkPotion(state, null, events, text);
    return { handled: true, events };
  }

  // --- rest ---
  if (/\b(rest|camp|sleep)\b/.test(t)) {
    const camp = (state.map.victory && state.map.victory.campfire) || state.map.victoryTile;
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
      const atk = char.attacks.find(a => a.ranged === false && a.weaponId !== 'unarmed') || char.attacks[0];
      executor.attack(state, { targetId: target.id, weaponId: atk.weaponId }, events);
      return { handled: true, events };
    }
    events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.20",[],["You see nothing to attack."]) });
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
        const ev = { type: 'parley', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.21",[presentation.name(p,state),(skill === 'intimidation' ? presentation.eventMessage("event.referee.resolveFreeform.22",[],["looms over"]) : presentation.eventMessage("event.referee.resolveFreeform.23",[],["talks rings around"])),{key:'content.skill.'+skill,fallback:engine.cap(skill)},check.detail],[""," "," Griznak ("," ","). The goblin chief's bravado crumbles — he squeals for his band and they scatter into the dark. (+50 XP)"]) };
        events.push(ev); engine.addLog(state, 'mech', ev);
        if (state.mode === 'combat') { engine.checkCombatEnd(state, events); }
      } else {
        const ev = { type: 'parley_fail', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.24",[presentation.name(p,state),(skill === 'intimidation' ? presentation.eventMessage("event.referee.resolveFreeform.25",[],["menace"]) : presentation.eventMessage("event.referee.resolveFreeform.26",[],["reason with"])),{key:'content.skill.'+skill,fallback:engine.cap(skill)},check.detail],[""," tries to "," Griznak ("," ",") — the goblin just grins, all yellow teeth. \"Bad deal, soft-skin!\" He whistles for his warriors..."]) };
        events.push(ev); engine.addLog(state, 'mech', ev);
        if (state.mode !== 'combat') {
          const ids = state.entities.filter(e => e.kind === 'monster' && e.alive && !e.fled && ['griznak', 'gob2', 'gob3'].includes(e.id)).map(e => e.id);
          engine.startCombat(state, ids, events);
        }
      }
      return { handled: true, events };
    }
    const npc = state.entities.find(e => e.kind === 'npc' && engine.manhattan(e, p) <= 4);
    if (npc) {
      events.push({ type: 'chat_open', narrate: false, ...presentation.eventMessage("event.referee.resolveFreeform.27",[presentation.name(npc,state)],[""," looks at you expectantly."]), data: { npcId: npc.npcId, name: npc.name, sceneId: engine.activeSceneView(state, npc.npcId)?.id } });
      return { handled: true, events };
    }
    events.push({ type: 'info', ...presentation.eventMessage("event.referee.resolveFreeform.28",[],["There is no one here to talk to."]) });
    return { handled: true, events };
  }

  // --- dodge / dash ---
  if (/\b(dodge|defend|guard)\b/.test(t) && state.mode === 'combat') {
    engine.addBuff(p, { id: 'dodge', rounds: 2 });
    if (state.combat) state.combat.actionUsed = true;
    const ev = { type: 'dodge', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.29",[presentation.name(p,state)],[""," takes a defensive stance — attacks against them have disadvantage."]) };
    events.push(ev); engine.addLog(state, 'mech', ev);
    return { handled: true, events };
  }

  // --- font / drink from font ---
  if (/\b(font|sacred water|holy water)\b/.test(t) || (/\b(drink|quaff|sip)\b/.test(t) && !/\bpotion\b/.test(t) && state.objects.some(o => o.type === 'font' && engine.manhattan(o, p) <= 1))) {
    const font = state.objects.find(o => o.type === 'font' && engine.manhattan(o, p) <= 1);
    if (font) { engine.interactObject(state, font.id, events); return { handled: true, events }; }
  }

  // --- lever / pull lever ---
  if (/\b(lever|switch)\b/.test(t) || (/\b(pull|throw|flip)\b/.test(t) && state.objects.some(o => o.type === 'lever' && engine.manhattan(o, p) <= 1))) {
    const lever = state.objects.find(o => o.type === 'lever' && engine.manhattan(o, p) <= 1);
    if (lever) { engine.interactObject(state, lever.id, events); return { handled: true, events }; }
  }

  // --- interact with nearby object ---
  if (/\b(open|take|grab|loot|touch|collect|relic|drink|font|pull|lever|barrel|detonate|spore)\b/.test(t)) {
    const interactables = state.objects.filter(o => ['door', 'chest', 'font', 'lever', 'barrel', 'spores'].includes(o.type) || ['relic', 'altar', 'campfire'].includes(o.id));
    const near = interactables.filter(o => engine.manhattan(o, p) <= 1).sort((a, b) => engine.manhattan(p, a) - engine.manhattan(p, b))[0];
    if (near) { engine.interactObject(state, near.id, events); return { handled: true, events }; }
  }

  // --- buy from Marla ---
  const buyMatch = /\b(buy|purchase|shop|stock up)\b/.exec(t);
  if (buyMatch) {
    const marla = state.entities.find(e => e.kind === 'npc' && e.npcId === 'marla' && engine.manhattan(e, p) <= 3);
    if (!marla) {
      events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.30",[],["No shop here — Marla's stall is by the entrance camp."]) });
      return { handled: true, events };
    }
    let itemId = null;
    if (/potion|healing|heal/.test(t)) itemId = 'potion_healing';
    else if (/kit|bandage/.test(t)) itemId = 'healers_kit';
    else if (/tools|lockpick|thieve/.test(t)) itemId = 'thieves_tools';
    if (!itemId) {
      events.push({ type: 'chat_open', narrate: false, ...presentation.eventMessage("event.referee.resolveFreeform.31",[],["Marla pats her stall. \"Potions, kits, or thieves' tools, dear — what'll it be?\""]), data: { npcId: 'marla', name: 'Marla the Peddler' } });
      return { handled: true, events };
    }
    const item = engine.SHOP_ITEMS.find(i => i.id === itemId);
    const char = state.character;
    if (char.gold < item.price) {
      events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.32",[presentation.name(item,state),item.price,char.gold],["You can't afford "," ("," gp) — you carry "," gp."]) });
      return { handled: true, events };
    }
    char.gold -= item.price;
    const inv = char.inventory.find(x => x.itemId === itemId);
    if (inv) inv.qty++; else char.inventory.push({ itemId, qty: 1 });
    const ev = { type: 'shop', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.33",[presentation.name(p,state),presentation.name(item,state),item.price],[""," buys "," from Marla for "," gp."]) };
    events.push(ev); engine.addLog(state, 'mech', presentation.eventMessage("event.referee.resolveFreeform.34",[presentation.name(p,state),presentation.name(item,state),item.price,char.gold],[""," buys "," (−"," gp, "," left)."]));
    return { handled: true, events };
  }

  // --- disengage ---
  if (/\b(disengage|back off|withdraw)\b/.test(t) && state.mode === 'combat') {
    if (state.combat && state.combat.order[state.combat.turnIdx].id !== 'player') { events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.35",[],["Not your turn!"]) }); return { handled: true, events }; }
    events.push({ type: 'disengage', narrate: true, ...presentation.eventMessage("event.referee.resolveFreeform.36",[presentation.name(p,state)],[""," disengages carefully, shielding against reprisal."]) });
    engine.addBuff(p, { id: 'disengaged', rounds: 1 });
    state.flags.noOaFor = 'player';
    if (state.mode === 'combat' && state.combat) state.combat.actionUsed = true;
    return { handled: true, events };
  }

  // --- shove ---
  if (/\b(shove|push)\b/.test(t) && state.mode === 'combat') {
    const foe = state.entities.find(e => e.kind === 'monster' && e.alive && !e.fled && engine.manhattan(e, p) <= 1);
    if (!foe) { events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.37",[],["No adjacent enemy to shove."]) }); return { handled: true, events }; }
    engine.shoveTarget(state, foe.id, events);
    if (state.combat) state.combat.actionUsed = true;
    return { handled: true, events };
  }

  // --- side quests ---
  if (/\b(quest|work|job|bounty|gig)\b/.test(t)) {
    const camp = (state.map.victory && state.map.victory.campfire) || state.map.victoryTile;
    if (!camp || !(p.x === camp.x && p.y === camp.y)) {
      events.push({ type: 'error', ...presentation.eventMessage("event.referee.resolveFreeform.38",[],["Work is offered around the campfire — go back and ask around."]) });
      return { handled: true, events };
    }
    if (state.quests && state.quests.active) {
      events.push({ type: 'info', ...presentation.eventMessage("event.referee.resolveFreeform.39",[presentation.field(state.quests.active,"shortText")],["You already have work: ","."]) });
      return { handled: true, events };
    }
    const quest = engine.rollSideQuest(state);
    if (!quest) { events.push({ type: 'info', ...presentation.eventMessage("event.referee.resolveFreeform.40",[],["No one has work to offer tonight."]) }); return { handled: true, events }; }
    const ev = { type: 'quest_offer', narrate: true, text: quest.text, textDisplay:quest.textDisplay, data: { quest } };
    events.push(ev);
    engine.addLog(state, 'system', presentation.eventMessage("event.referee.resolveFreeform.41",[presentation.field(quest,"shortText"),quest.reward.gold,quest.reward.xp],["📜 New side quest: "," ("," gp, "," XP)"]));
    return { handled: true, events };
  }

  // --- class flavor freeform (consult the die: give a small perk or just flavor) ---
  return { handled: false, events };
}

module.exports = { resolveFreeform };
